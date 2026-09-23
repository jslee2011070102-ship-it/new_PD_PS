"""No network calls: injected extractor verifies processing, retries and persistence."""
import copy
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from test_dashboard import server

jobs = server.image_jobs


class ImageJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=server.ROOT / "tests")
        self.store = patch.object(jobs, "STORE", Path(self.temp.name))
        self.store.start()
        self.raw_entry = {k: v for k, v in server.load_products()[0].items() if k in server.ProductInfo.model_fields}
        image = Image.new("RGB", (1400, 700), "white")
        output = BytesIO()
        image.save(output, "PNG")
        self.raw = output.getvalue()

    def tearDown(self):
        self.store.stop()
        self.temp.cleanup()

    def new_job(self, count=2):
        return jobs.create_job({"category": "핸드워시", "survey_date": "2026-09-23", "mode": "append",
                                "files": [{"name": f"folder/sub/{i}.png", "size": len(self.raw)} for i in range(count)]})

    def ready_job(self, count=2):
        job = self.new_job(count)
        for i in range(count):
            job = jobs.upload_image(job["id"], i, self.raw)
        return job

    def run_sync(self, job, extractor):
        self.assertTrue(jobs.WORKER.acquire(False))
        jobs.run_job(job["id"], server.normalize, extractor)
        return jobs.get_job(job["id"])

    def test_custom_category_summary_and_safe_names(self):
        products = server.products_from_payload({"overrides": {"핸드워시": [self.raw_entry]}})
        summary = server.summarize(products)
        self.assertEqual(summary["count"], 151)
        self.assertIn("핸드워시", [c["name"] for c in summary["categories"]])
        for name in ["", "../escape", "/etc", "<script>", "__proto__", "전체", "a" * 41]:
            with self.assertRaises(ValueError):
                jobs.category_name(name)

    def test_validate_file_manifest_and_limits(self):
        payload = {"category": "샴푸", "survey_date": "2026-09-23", "mode": "append"}
        for files in [[], [{"name": "../a.png", "size": 1}], [{"name": "a.pdf", "size": 1}],
                      [{"name": "a.png", "size": 16 * 1024 * 1024}], [{"name": "a.png", "size": 1}] * 101]:
            with self.assertRaises(ValueError):
                jobs.create_job({**payload, "files": files})
        with self.assertRaises(ValueError):
            jobs.job_path("../../escape")

    def test_images_are_decoded_resized_and_corruption_visible(self):
        job = self.ready_job(1)
        self.assertEqual(job["status"], "ready")
        with Image.open(jobs.job_path(job["id"]).parent / "0.jpg") as im:
            self.assertEqual(im.size, (1024, 512))
        broken = jobs.create_job({"category": "샴푸", "survey_date": "2026-09-23", "mode": "append", "files": [{"name": "broken.png", "size": 4}]})
        with self.assertRaises(ValueError):
            jobs.upload_image(broken["id"], 0, b"nope")
        self.assertEqual(jobs.get_job(broken["id"])["files"][0]["status"], "upload_error")

    def test_successful_analysis_requires_review_then_persists_once(self):
        job = self.ready_job()
        job = self.run_sync(job, lambda raw, category: [copy.deepcopy(self.raw_entry)])
        self.assertEqual(job["status"], "review")
        self.assertEqual(len(server.load_products()), 150)
        jobs.apply_job(job["id"], server.normalize)
        jobs.apply_job(job["id"], server.normalize)
        products = server.load_products()
        self.assertEqual(len(products), 152)
        self.assertEqual(products[-1]["row"]["조사일자"], "2026-09-23")
        self.assertFalse(list(jobs.job_path(job["id"]).parent.glob("*.jpg")))
        self.assertEqual(len(jobs.datasets()["핸드워시"]["entries"]), 2)

    def test_failed_file_retry_does_not_repeat_successful_calls(self):
        job = self.ready_job()
        call_count = 0
        def extractor(raw, category):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise ValueError("test provider timeout")
            return [copy.deepcopy(self.raw_entry)]
        job = self.run_sync(job, extractor)
        self.assertEqual(job["status"], "partial")
        with self.assertRaises(ValueError):
            jobs.apply_job(job["id"], server.normalize)
        job = self.run_sync(job, extractor)
        self.assertEqual(call_count, 3)
        self.assertEqual(job["status"], "review")

    def test_restart_marks_interrupted_job_and_keeps_successes(self):
        job = self.ready_job()
        job["status"] = "running"
        job["files"][0]["status"] = "done"
        job["files"][1]["status"] = "analyzing"
        jobs.atomic_json(jobs.job_path(job["id"]), job)
        jobs.recover_jobs()
        recovered = jobs.get_job(job["id"])
        self.assertEqual(recovered["status"], "interrupted")
        self.assertEqual(recovered["files"][0]["status"], "done")
        self.assertEqual(recovered["files"][1]["status"], "error")

    def test_append_preserves_original_dates_and_replace_is_explicit(self):
        jobs.save_category("세탁세제", [self.raw_entry], "2026-09-23", "append")
        products = [p for p in server.load_products() if p["category"] == "세탁세제"]
        self.assertEqual(len(products), 26)
        self.assertEqual(products[0]["row"]["조사일자"], "2026-09-21")
        self.assertEqual(products[-1]["row"]["조사일자"], "2026-09-23")
        jobs.save_category("세탁세제", [self.raw_entry], "2026-09-23", "replace")
        self.assertEqual(len([p for p in server.load_products() if p["category"] == "세탁세제"]), 1)
        self.assertEqual(len(json.loads((server.ROOT / "data/extracted/세탁세제.json").read_text())), 25)

    def test_analysis_requires_consent_and_configuration(self):
        job = self.ready_job()
        with self.assertRaises(ValueError):
            jobs.start_job(job["id"], False, server.normalize)
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            self.assertFalse(jobs.capabilities()["configured"])
            with self.assertRaises(ValueError):
                jobs.start_job(job["id"], True, server.normalize)

    def test_provider_schema_and_malformed_results_fail_closed(self):
        result = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"products": [self.raw_entry]})}}]}
        with patch.object(jobs, "config", return_value=("test-only", "https://example.invalid/v1", "gpt-5-mini")), patch.object(jobs, "urlopen", return_value=BytesIO(json.dumps(result).encode())) as request:
            self.assertEqual(jobs.extract_image(self.raw, "핸드워시")[0]["price_krw"], self.raw_entry["price_krw"])
            payload = json.loads(request.call_args.args[0].data)
            self.assertTrue(payload["response_format"]["json_schema"]["strict"])
            self.assertIn('capacity_text', payload["messages"][0]["content"])
        result["choices"][0]["message"]["content"] = '{"products": []}'
        with patch.object(jobs, "config", return_value=("test-only", "https://example.invalid/v1", "gpt-5-mini")), patch.object(jobs, "urlopen", return_value=BytesIO(json.dumps(result).encode())):
            with self.assertRaises(ValueError):
                jobs.extract_image(self.raw, "핸드워시")
