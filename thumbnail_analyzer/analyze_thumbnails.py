"""
썸네일 이미지 일괄 분석 스크립트 (Batch API / ant CLI 방식)
==========================================================
사용법:
    # 1) 제출 - 이미지를 묶어서 보내고 바로 끝납니다 (터미널 닫아도 됩니다)
    python analyze_thumbnails.py submit --folder ./images/쿠팡_캡슐세제 \
        --channel 쿠팡 --category 캡슐세제

    # 2) 확인 - 다 됐는지 봅니다
    python analyze_thumbnails.py status

    # 3) 회수 - 끝난 작업의 결과를 엑셀로 받습니다
    python analyze_thumbnails.py fetch --output 결과/캡슐세제_분석.xlsx

무엇을 하는 스크립트인가?
    1. 폴더 안의 제품 썸네일을 전부 하나의 "배치"로 묶어 Claude에게 한 번에 맡깁니다.
       한 장씩 즉시 처리하는 대신 맡겨두고 나중에 찾아가는 방식이라 요금이 절반입니다.
       (퀵서비스 대신 택배로 보내는 셈입니다. 보통 1시간 이내에 끝납니다.)
    2. Claude가 이미지 안의 텍스트(브랜드명/용량/가격 등)를 읽고,
       이미지 형태(본품 용기인지, 리필 파우치인지, 말통인지)까지 판단합니다.
       이때 Structured Outputs(구조화 출력)로 아래 ProductInfo 스키마를 강제하므로,
       틀을 벗어난 응답 자체가 나올 수 없습니다.
    3. "용량당 가격(단위당단가)"은 AI가 아니라 파이썬이 직접 계산합니다.
       (AI에게 계산까지 시키면 가끔 산수를 틀리기 때문에, 텍스트 인식은 AI /
        숫자 계산은 코드, 로 역할을 나눴습니다.)
    4. 결과를 엑셀 파일로 저장합니다. 이미 같은 엑셀 파일이 있으면
       새로 분석한 내용을 아래에 이어 붙입니다 (누적 데이터베이스처럼 사용 가능).

준비물:
    pip install -r requirements.txt

    Anthropic 공식 CLI(`ant`)를 설치하고 로그인해 두어야 합니다.
    API 키를 따로 발급받을 필요가 없습니다 - 브라우저 로그인 한 번이면 됩니다.

        brew install anthropics/tap/ant      # macOS
        ant auth login                       # 브라우저가 열립니다
        ant auth status                      # 로그인 확인

    (그 외 OS 설치 방법은 https://github.com/anthropics/anthropic-cli 참고)

비용 참고:
    Batch API는 일반 요청의 50% 가격입니다. 대신 즉시 답이 오지 않고
    보통 1시간 이내(최대 24시간)에 완료됩니다. 24시간을 넘기면 만료되며,
    만료된 요청은 요금이 청구되지 않습니다.
"""

import argparse
import base64
import io
import json
import re
import shutil
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal

import pandas as pd
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, ValidationError

# ------------------------------------------------------------
# 1. 뽑아낼 항목의 "설계도" (스키마)
# ------------------------------------------------------------
# 이 클래스가 곧 출력 양식입니다. Claude는 이 틀을 벗어난 답을 만들 수 없습니다.
# (빈칸이 정해진 서류를 건네주는 것과 같습니다. 칸 밖에 쓸 수가 없습니다.)
#
# - `| None` 은 "이미지에서 확인 못 하면 비워도 된다"는 뜻입니다.
# - `price_krw: int | None` 처럼 타입을 못박아두면, "12,900원" 같은 글자가
#   섞여 들어오는 일 자체가 생기지 않습니다. 뒤에서 하는 나눗셈이 안전해집니다.
# - Field(description=...) 에 적은 설명도 Claude가 함께 읽습니다.
#   즉 "무엇을 어떻게 채울지"에 대한 지시를 프롬프트가 아니라 여기에 적습니다.
# - extra="forbid" 는 "정해준 칸 외에 다른 칸을 만들지 마라"는 뜻입니다.


class ProductInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brand: str | None = Field(description="브랜드명. 이미지에서 확인 불가하면 null")
    product_name: str | None = Field(description="제품명. 확인 불가하면 null")
    price_krw: int | None = Field(
        description="판매가를 원 단위 정수로. 쉼표·'원' 같은 글자는 빼고 숫자만 "
                    "(예: 12900). 가격이 안 보이면 null"
    )
    capacity_text: str | None = Field(
        description="용량 표기를 이미지에 적힌 원문 그대로 (예: '500ml', '1L', '3kg'). "
                    "단위 환산은 하지 말 것. 없으면 null"
    )
    composition_text: str | None = Field(
        description="구성/수량 표기 원문 (예: '2개입', '1개', '리필 3개 세트'). 없으면 null"
    )
    product_form: Literal["용기", "리필파우치", "말통", "세트", "기타"] = Field(
        description="제품 이미지의 겉모습으로 판단한 포장 형태"
    )
    form_reason: str | None = Field(
        description="product_form을 그렇게 판단한 짧은 근거 "
                    "(예: '파우치형 포장에 리필 문구 확인')"
    )
    notes: str | None = Field(
        description="특이사항이나 애매해서 사람이 재확인해야 할 부분. 없으면 null"
    )


# ------------------------------------------------------------
# 2. Claude에게 줄 지시 (항목 정의는 위 스키마가 대신하므로 태도/원칙만 남김)
# ------------------------------------------------------------
SYSTEM_PROMPT = """너는 한국 이커머스(쿠팡 등) 생활용품 카테고리 제품 썸네일 이미지를 분석하는 MD 보조원이다.

원칙:
- 이미지 안에 실제로 보이는 텍스트와, 제품 이미지 자체의 형태(용기 모양)만을 근거로 삼아라.
- 확인할 수 없는 항목은 반드시 null로 두어라. 절대 추측으로 숫자를 지어내지 마라.
- 용량·가격은 이미지에 적힌 그대로 읽어라. 단위 환산이나 계산은 네 일이 아니다
  (그건 프로그램이 따로 처리한다).
- 할인 전 정가와 할인가가 같이 보이면, 실제 판매가(더 낮은 쪽)를 price_krw에 넣어라.
"""

USER_PROMPT = "이 제품 썸네일 이미지를 분석해줘."

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
MAX_BATCH_BYTES = 256 * 1024 * 1024  # 배치 하나의 크기 상한 (API 제한)


# ------------------------------------------------------------
# 3. ant CLI 호출 (API 키 대신 `ant auth login` 자격증명을 사용)
# ------------------------------------------------------------
def ant_path() -> str:
    """`ant` 실행파일을 찾습니다. 없으면 설치 안내와 함께 종료합니다."""
    found = shutil.which("ant")
    if not found:
        sys.exit(
            "`ant`(Anthropic 공식 CLI)를 찾을 수 없습니다.\n"
            "  설치: brew install anthropics/tap/ant   (macOS)\n"
            "        https://github.com/anthropics/anthropic-cli  (그 외 OS)\n"
            "  로그인: ant auth login"
        )
    return found


def run_ant(args: list[str], stdin_data: bytes | None = None) -> str:
    """`ant ...`를 실행하고 표준출력을 돌려줍니다."""
    proc = subprocess.run([ant_path(), *args], input=stdin_data, capture_output=True)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()
        sys.exit(f"ant 명령 실패 ({' '.join(args)}):\n{err}\n\n"
                 "인증 문제라면 `ant auth status`로 로그인 상태를 확인해 보세요.")
    return proc.stdout.decode("utf-8", "replace")


# ------------------------------------------------------------
# 4. 이미지 인코딩 (용량이 크면 리사이즈해서 비용/속도 절약)
# ------------------------------------------------------------
def encode_image(path: Path, max_dim: int = 1024) -> tuple[str, str]:
    img = Image.open(path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    if max(img.size) > max_dim:
        ratio = max_dim / max(img.size)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    b64 = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
    return b64, "image/jpeg"


# ------------------------------------------------------------
# 5. "500ml", "1L", "3kg" 같은 텍스트를 표준 단위(ml 또는 g)로 환산
# ------------------------------------------------------------
def parse_capacity(text: str | None):
    if not text:
        return None, None
    text = text.replace(" ", "").lower()
    m = re.search(r"([\d.]+)\s*(ml|l|g|kg)", text)
    if not m:
        return None, None
    value, unit = float(m.group(1)), m.group(2)
    if unit == "l":
        return value * 1000, "ml"
    if unit == "kg":
        return value * 1000, "g"
    return value, unit  # ml 또는 g 그대로


def parse_composition_count(text: str | None) -> float:
    """'2개입', '리필 3개 세트' 같은 텍스트에서 수량만 뽑아냄. 못 찾으면 1로 간주."""
    if not text:
        return 1.0
    m = re.search(r"(\d+)\s*개", text)
    return float(m.group(1)) if m else 1.0


# ------------------------------------------------------------
# 6. 작업 기록 파일 (제출과 회수 사이를 이어주는 메모)
# ------------------------------------------------------------
# 제출과 회수가 서로 다른 실행이라, 그 사이의 기억을 파일로 남겨둡니다.
# (세탁소 보관증과 같습니다. 이 종이가 있어야 나중에 찾아올 수 있습니다.)
# 배치 결과에는 custom_id(img-0001 같은 번호)만 돌아오므로,
# 그 번호가 어느 파일이었는지도 여기에 적어둡니다.
def job_path(jobs_dir: Path, batch_id: str) -> Path:
    return jobs_dir / f"{batch_id}.json"


def load_jobs(jobs_dir: Path) -> list[dict]:
    if not jobs_dir.is_dir():
        return []
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(jobs_dir.glob("*.json"))]


def save_job(jobs_dir: Path, job: dict) -> None:
    jobs_dir.mkdir(parents=True, exist_ok=True)
    job_path(jobs_dir, job["batch_id"]).write_text(
        json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def batch_state(batch_id: str) -> dict:
    """배치의 현재 상태를 조회합니다."""
    return json.loads(run_ant(
        ["messages:batches", "retrieve", "--message-batch-id", batch_id, "--format", "json"]
    ))


# ------------------------------------------------------------
# 7. submit - 이미지를 묶어서 제출
# ------------------------------------------------------------
def cmd_submit(args) -> None:
    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"폴더를 찾을 수 없습니다: {folder}")

    image_paths = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if not image_paths:
        sys.exit("폴더 안에 이미지 파일이 없습니다.")

    ant_path()  # 이미지를 다 읽고 나서 실패하지 않도록, 미리 확인해 둡니다

    schema = ProductInfo.model_json_schema()
    print(f"총 {len(image_paths)}장 준비 중...")

    requests = []
    id_to_name: dict[str, str] = {}

    for i, path in enumerate(image_paths, 1):
        custom_id = f"img-{i:04d}"  # 파일명에 한글·공백이 섞여도 안전하도록 번호를 씁니다
        id_to_name[custom_id] = path.name
        b64, media_type = encode_image(path)
        requests.append({
            "custom_id": custom_id,
            "params": {
                "model": args.model,
                "max_tokens": 2000,
                "system": SYSTEM_PROMPT,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image",
                         "source": {"type": "base64", "media_type": media_type, "data": b64}},
                        {"type": "text", "text": USER_PROMPT},
                    ],
                }],
                # 여기가 스키마를 강제하는 부분입니다.
                "output_config": {"format": {"type": "json_schema", "schema": schema}},
            },
        })

    payload = json.dumps({"requests": requests}, ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_BATCH_BYTES:
        sys.exit(f"배치 크기가 상한(256MB)을 넘었습니다: {len(payload) / 1024 / 1024:.0f}MB\n"
                 "폴더를 나눠서 여러 번 제출해 주세요.")

    print(f"제출 중... ({len(payload) / 1024 / 1024:.1f}MB)")
    created = json.loads(run_ant(["messages:batches", "create", "--format", "json"], payload))
    batch_id = created["id"]

    jobs_dir = Path(args.jobs_dir)
    save_job(jobs_dir, {
        "batch_id": batch_id,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "survey_date": date.today().isoformat(),
        "channel": args.channel,
        "category": args.category,
        "model": args.model,
        "folder": str(folder),
        "images": id_to_name,
        "fetched": False,
    })

    print(f"\n제출 완료: {batch_id}")
    print(f"  기록 위치: {job_path(jobs_dir, batch_id)}")
    print("  보통 1시간 이내에 끝납니다. 터미널을 닫아도 됩니다.")
    print("\n  진행 확인:  python analyze_thumbnails.py status")
    print("  결과 회수:  python analyze_thumbnails.py fetch --output 결과.xlsx")


# ------------------------------------------------------------
# 8. status - 진행 상황 확인
# ------------------------------------------------------------
def cmd_status(args) -> None:
    jobs = [j for j in load_jobs(Path(args.jobs_dir)) if not j["fetched"]]
    if not jobs:
        print("회수 대기 중인 작업이 없습니다.")
        return

    for job in jobs:
        state = batch_state(job["batch_id"])
        counts = state.get("request_counts", {})
        done = sum(counts.get(k, 0) for k in ("succeeded", "errored", "canceled", "expired"))
        ended = state.get("processing_status") == "ended"

        print(f"[{'완료 - 회수 가능' if ended else '처리 중'}] {job['batch_id']}")
        print(f"    {job['channel']} / {job['category']} · 이미지 {len(job['images'])}장"
              f" · 제출 {job['submitted_at'][:16].replace('T', ' ')} UTC")
        print(f"    진행: {done}/{len(job['images'])}  "
              f"(성공 {counts.get('succeeded', 0)} / 실패 {counts.get('errored', 0)}"
              f" / 만료 {counts.get('expired', 0)})")


# ------------------------------------------------------------
# 9. fetch - 끝난 작업의 결과를 엑셀로
# ------------------------------------------------------------
def row_from_result(entry: dict, job: dict) -> dict:
    """배치 결과 한 줄(jsonl 한 행)을 엑셀 한 행으로 바꿉니다."""
    custom_id = entry["custom_id"]
    filename = job["images"].get(custom_id, custom_id)
    outcome = entry.get("result", {})
    kind = outcome.get("type")

    info: ProductInfo | None = None
    note: str | None = None

    if kind == "succeeded":
        message = outcome.get("message", {})
        text = next((b.get("text", "") for b in message.get("content", [])
                     if b.get("type") == "text"), "")
        try:
            info = ProductInfo.model_validate_json(text)
        except ValidationError as e:
            # 스키마는 강제되지만, 답이 중간에 잘리면(max_tokens) 내용이 부족할 수 있습니다.
            note = (f"[분석 실패] 응답 종료 사유: {message.get('stop_reason')} / "
                    f"{str(e).splitlines()[0]}")
    elif kind == "errored":
        err = outcome.get("error", {}).get("error", {})
        note = f"[요청 오류] {err.get('type')}: {err.get('message')}"
    elif kind == "expired":
        note = "[만료] 24시간 안에 처리되지 못했습니다 (요금 미청구). 다시 제출해 주세요."
    elif kind == "canceled":
        note = "[취소됨]"
    else:
        note = f"[알 수 없는 결과] {kind}"

    if info is None:
        info = ProductInfo(
            brand=None, product_name=None, price_krw=None,
            capacity_text=None, composition_text=None,
            product_form="기타", form_reason=None, notes=note,
        )

    capacity_val, unit = parse_capacity(info.capacity_text)
    comp_count = parse_composition_count(info.composition_text)
    price = info.price_krw  # 스키마가 int|None 을 보장하므로 바로 계산에 씁니다

    total_capacity = capacity_val * comp_count if capacity_val else None
    unit_price = None
    if total_capacity and price:
        unit_price = round(price / total_capacity * 100, 1)  # 100ml/g당 가격

    return {
        "조사일자": job["survey_date"],
        "채널": job["channel"],
        "카테고리": job["category"],
        "원본파일명": filename,
        "브랜드명": info.brand,
        "제품명": info.product_name,
        "판매가(원)": price,
        "용량_원문": info.capacity_text,
        "구성_원문": info.composition_text,
        "총용량": total_capacity,
        "단위": unit,
        "단위당가격(100당,원)": unit_price,
        "제품형태": info.product_form,
        "형태_판단근거": info.form_reason,
        "비고": info.notes,
    }


def cmd_fetch(args) -> None:
    jobs_dir = Path(args.jobs_dir)
    jobs = [j for j in load_jobs(jobs_dir) if not j["fetched"]]
    if not jobs:
        print("회수 대기 중인 작업이 없습니다.")
        return

    rows: list[dict] = []
    fetched_jobs: list[dict] = []

    for job in jobs:
        if batch_state(job["batch_id"]).get("processing_status") != "ended":
            print(f"아직 처리 중이라 건너뜁니다: {job['batch_id']} "
                  f"({job['channel']}/{job['category']})")
            continue

        print(f"회수 중: {job['batch_id']} ({job['channel']}/{job['category']})")
        out = run_ant(["messages:batches", "results",
                       "--message-batch-id", job["batch_id"],
                       "--format", "jsonl", "--max-items", "-1"])
        got = 0
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append(row_from_result(json.loads(line), job))
            got += 1
        print(f"    {got}건 수집")
        fetched_jobs.append(job)

    if not rows:
        print("회수할 결과가 없습니다.")
        return

    new_df = pd.DataFrame(rows)

    out_path = Path(args.output)
    if out_path.parent != Path(""):
        out_path.parent.mkdir(parents=True, exist_ok=True)

    if out_path.exists():
        old_df = pd.read_excel(out_path)
        combined = pd.concat([old_df, new_df], ignore_index=True)
        print(f"기존 파일에 이어붙임: {len(old_df)}행 + {len(new_df)}행 = {len(combined)}행")
    else:
        combined = new_df

    combined.to_excel(out_path, index=False)

    # 엑셀에 무사히 저장된 뒤에야 "회수 완료" 표시를 합니다.
    # (저장이 실패하면 표시도 안 되므로, fetch를 다시 실행하면 됩니다.)
    for job in fetched_jobs:
        job["fetched"] = True
        save_job(jobs_dir, job)

    print(f"완료: {out_path.resolve()}")


# ------------------------------------------------------------
# 10. 명령 정의
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="제품 썸네일 이미지 일괄 분석 (Batch API) → 엑셀 출력")
    parser.add_argument("--jobs-dir", default=".batch_jobs",
                        help="제출 기록을 보관할 폴더 (기본: .batch_jobs)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_submit = sub.add_parser("submit", help="폴더의 이미지를 배치로 제출")
    p_submit.add_argument("--folder", required=True, help="이미지가 들어있는 폴더 경로")
    p_submit.add_argument("--channel", default="", help="채널명 (예: 쿠팡)")
    p_submit.add_argument("--category", default="", help="카테고리명 (예: 캡슐세제)")
    p_submit.add_argument("--model", default="claude-sonnet-5", help="사용할 모델")
    p_submit.set_defaults(func=cmd_submit)

    p_status = sub.add_parser("status", help="제출한 배치의 진행 상황 확인")
    p_status.set_defaults(func=cmd_status)

    p_fetch = sub.add_parser("fetch", help="완료된 배치 결과를 엑셀로 회수")
    p_fetch.add_argument("--output", default="thumbnail_analysis.xlsx",
                         help="출력 엑셀 파일 경로")
    p_fetch.set_defaults(func=cmd_fetch)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
