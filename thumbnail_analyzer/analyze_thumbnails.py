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
from PIL import Image, ImageOps
from pydantic import BaseModel, ConfigDict, Field, ValidationError

# 아이폰으로 캡처하면 .HEIC 형식으로 저장됩니다. Pillow는 이 형식을 기본으로
# 못 읽기 때문에, pillow-heif가 "이 형식도 읽을 줄 안다"고 등록해 줍니다.
# (외국어 사전을 한 권 꽂아주는 것과 같습니다. 꽂아야 그 언어를 읽습니다.)
# 설치돼 있지 않아도 jpg/png 작업은 그대로 되도록, 없으면 넘어갑니다.
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:
    HEIF_SUPPORTED = False

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
        description="한 팩(한 개)의 크기 표기를 원문 그대로. 액체류는 용량 "
                    "(예: '500ml', '1L', '3kg'), 캡슐·시트처럼 개수로 파는 제품은 "
                    "개수 (예: '26개입', '100개입'). 제품명이 '...,26개입, 1개' 형태면 "
                    "앞쪽('26개입')이 여기에 해당한다. 단위 환산이나 곱셈은 하지 말 것. "
                    "없으면 null"
    )
    composition_text: str | None = Field(
        description="몇 팩 묶음인지를 나타내는 수량 표기 원문 (예: '1개', '2개'). "
                    "제품명이 '...,26개입, 1개' 형태면 뒤쪽('1개')이 여기에 해당한다. "
                    "없으면 null"
    )
    unit_price_text: str | None = Field(
        description="화면에 이미 적혀 있는 단위당 가격 표기를 원문 그대로 "
                    "(예: '100ml당 1,190원', '1개입당 545원'). 이건 우리 계산이 맞는지 "
                    "대조하는 용도이므로 직접 계산하지 말고, 적혀 있을 때만 그대로 옮겨라. "
                    "없으면 null"
    )
    product_form: Literal["용기", "파우치", "말통", "기타"] = Field(
        description="제품의 겉모습(포장 형태)만 판단. 본품인지 리필인지는 여기 넣지 말 것. "
                    "용기=뚜껑·펌프·스프레이가 달린 통, 파우치=비닐 주머니, "
                    "말통=손잡이 달린 대용량 통"
    )
    product_role: Literal["본품", "리필", "불명"] = Field(
        description="이 제품이 본품인지 리필인지. 보통 제품명에 '본품'/'리필'로 적혀 있으니 "
                    "그 글자를 근거로 판단하라. 적혀 있지 않고 확신할 수 없으면 '불명'"
    )
    form_reason: str | None = Field(
        description="product_form과 product_role을 그렇게 판단한 짧은 근거 "
                    "(예: '주둥이 달린 파우치, 제품명에 리필 표기')"
    )
    category_rank_text: str | None = Field(
        description="카테고리 순위 표기를 원문 그대로 (예: '살균소독제 구매 25위', "
                    "'액체섬유유연제 구매 4위'). 순위 표기가 없으면 null"
    )
    review_count: int | None = Field(
        description="별점 옆 괄호 안의 리뷰 수를 정수로 (예: (46,753) -> 46753). "
                    "안 보이면 null"
    )
    monthly_buyers_text: str | None = Field(
        description="'한 달간 300명 이상 구매했어요' 같은 구매자수 문구를 원문 그대로. "
                    "주의: '만족했어요'로 끝나는 문구는 구매자수가 아니라 만족한 사람 수이다. "
                    "그 경우에도 본 문구를 그대로 옮겨 적되 임의로 바꾸지 마라 "
                    "(구매인지 만족인지는 프로그램이 문구를 보고 판단한다). 없으면 null"
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
- '겉모습(product_form)'과 '본품/리필(product_role)'은 서로 다른 질문이다.
  손잡이 달린 말통이면서 동시에 리필 제품일 수 있으니 각각 따로 판단하라.
- 화면 하단이 버튼 바 등에 가려 일부 정보가 안 보이면, 추측하지 말고 null로 두고
  notes에 가려서 확인 불가라고 적어라.
"""

USER_PROMPT = "이 제품 썸네일 이미지를 분석해줘."

HEIF_SUFFIXES = (".heic", ".heif")
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", *HEIF_SUFFIXES)
MAX_BATCH_BYTES = 256 * 1024 * 1024  # 배치 하나의 크기 상한 (API 제한)

# 추정 월매출 = 월구매자수 x 판매가 x 아래 배수
# 한 상품 페이지에 여러 옵션(용량·향 등)이 묶여 있고 구매자수는 페이지 단위로
# 표시되므로, 다른 옵션 매출을 감안해 2를 곱한다. 어디까지나 어림값이다.
REVENUE_OPTION_MULTIPLIER = 2


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

    # 폰 사진은 "세로로 찍었음" 같은 회전 정보를 파일 안에 따로 들고 있습니다.
    # 이걸 실제 픽셀에 반영해두지 않으면 옆으로 누운 이미지가 전달되어
    # 글자를 제대로 못 읽습니다.
    img = ImageOps.exif_transpose(img)

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
    """'500ml' -> (500, 'ml'), '1L' -> (1000, 'ml'), '26개입' -> (26, '개')

    생활용품은 액체처럼 용량으로 파는 것도 있고, 캡슐세제처럼 개수로 파는 것도
    있습니다. 둘을 같은 함수에서 처리하고 단위를 함께 돌려줍니다.
    """
    if not text:
        return None, None
    text = text.replace(" ", "").lower()
    m = re.search(r"([\d.]+)\s*(ml|l|kg|g|개)", text)
    if not m:
        return None, None
    value, unit = float(m.group(1)), m.group(2)
    if unit == "l":
        return value * 1000, "ml"
    if unit == "kg":
        return value * 1000, "g"
    return value, unit  # ml / g / 개 그대로


# 개수로 파는 제품은 '1개당 얼마'가, 액체는 '100ml당 얼마'가 자연스러운 기준입니다.
# (달걀은 한 알에 얼마, 우유는 100ml에 얼마로 따지는 것과 같습니다.)
def unit_price_basis(unit: str | None) -> tuple[int, str] | tuple[None, None]:
    """단위에 맞는 (기준 수량, 표시용 이름)을 돌려줍니다."""
    if unit == "개":
        return 1, "1개당"
    if unit in ("ml", "g"):
        return 100, f"100{unit}당"
    return None, None


def parse_composition_count(text: str | None) -> float:
    """'2개입', '리필 3개 세트' 같은 텍스트에서 수량만 뽑아냄. 못 찾으면 1로 간주."""
    if not text:
        return 1.0
    m = re.search(r"(\d+)\s*개", text)
    return float(m.group(1)) if m else 1.0


def parse_unit_price_text(text: str | None):
    """'100ml당 1,190원' 같은 표기를 (100단위당 가격, 단위)로 환산.

    쿠팡은 단위당 가격을 이미 화면에 찍어줍니다. 그걸 그대로 읽어두면
    우리 계산이 맞는지 대조할 수 있습니다 (문제집에 딸려온 답안지인 셈).
    기준이 100이 아닌 경우(예: '1L당')도 100 기준으로 맞춰서 돌려줍니다.
    """
    if not text:
        return None, None
    t = text.replace(" ", "").replace(",", "").lower()
    m = re.search(r"([\d.]+)(ml|l|kg|g|개)(?:입)?당([\d.]+)원", t)
    if not m:
        return None, None
    basis, unit, price = float(m.group(1)), m.group(2), float(m.group(3))
    if unit == "l":
        basis, unit = basis * 1000, "ml"
    elif unit == "kg":
        basis, unit = basis * 1000, "g"
    if basis <= 0:
        return None, None
    scale, _ = unit_price_basis(unit)
    if scale is None:
        return None, None
    return price / basis * scale, unit  # 우리 계산과 같은 기준으로 맞춤


def parse_category_rank(text: str | None) -> int | None:
    """'액체섬유유연제 구매 4위' -> 4"""
    if not text:
        return None
    m = re.search(r"(\d+)\s*위", text)
    return int(m.group(1)) if m else None


def parse_monthly_buyers(text: str | None) -> int | None:
    """'한 달간 2만명 이상 구매했어요' -> 20000

    주의: 쿠팡은 같은 자리에 '만족했어요' 문구를 보여주기도 하는데, 그건
    구매자수가 아니다. 그래서 '구매'라는 글자가 있을 때만 숫자로 인정한다.
    (문구 판단을 AI에게 맡기지 않고 코드가 직접 확인한다.)
    '이상'이 붙은 하한값이므로, 나온 숫자는 최소치로 봐야 한다.
    """
    if not text or "구매" not in text:
        return None
    m = re.search(r"([\d,.]+)\s*(만|천)?\s*명", text.replace(" ", ""))
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    scale = {"만": 10_000, "천": 1_000}.get(m.group(2), 1)
    return int(value * scale)


def compare_unit_price(ours: float | None, shown: float | None,
                       our_unit: str | None, shown_unit: str | None) -> str:
    """우리 계산과 화면 표기를 대조합니다."""
    if shown is None:
        return "표기없음"
    if ours is None:
        return "계산불가"
    if our_unit != shown_unit:
        return f"단위불일치({our_unit} vs {shown_unit})"
    # 반올림 차이는 허용하고, 그보다 크게 벌어질 때만 확인 대상으로 봅니다.
    if abs(ours - shown) <= max(1.0, shown * 0.01):
        return "일치"
    return f"불일치(표기 {shown:.0f} / 계산 {ours:.0f})"


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

    files = [f for f in folder.iterdir() if f.is_file() and not f.name.startswith(".")]
    image_paths = sorted(f for f in files if f.suffix.lower() in IMAGE_SUFFIXES)
    skipped = sorted(f for f in files if f.suffix.lower() not in IMAGE_SUFFIXES)

    # HEIC 파일이 있는데 읽을 준비가 안 됐다면, 조용히 건너뛰지 않고 여기서 멈춥니다.
    # (모르고 일부만 분석한 엑셀을 받는 것이 제일 나쁜 결과이기 때문입니다.)
    heic_found = [f for f in image_paths if f.suffix.lower() in HEIF_SUFFIXES]
    if heic_found and not HEIF_SUPPORTED:
        sys.exit(f"HEIC 이미지가 {len(heic_found)}장 있는데 읽을 수 없습니다.\n"
                 "  다음을 실행해 주세요:  pip install pillow-heif\n"
                 "  (아이폰 캡처는 보통 .HEIC로 저장됩니다)")

    if not image_paths:
        sys.exit(f"폴더 안에 분석할 이미지가 없습니다: {folder}\n"
                 f"  지원 형식: {', '.join(IMAGE_SUFFIXES)}")

    # 이미지가 아닌 파일이 섞여 있으면 알려줍니다 (무엇이 빠졌는지 알 수 있도록).
    if skipped:
        names = ", ".join(f.name for f in skipped[:5])
        more = f" 외 {len(skipped) - 5}개" if len(skipped) > 5 else ""
        print(f"참고: 이미지가 아니라 제외한 파일 {len(skipped)}개 - {names}{more}")

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
            capacity_text=None, composition_text=None, unit_price_text=None,
            product_form="기타", product_role="불명", form_reason=None,
            category_rank_text=None, review_count=None, monthly_buyers_text=None,
            notes=note,
        )

    capacity_val, unit = parse_capacity(info.capacity_text)
    comp_count = parse_composition_count(info.composition_text)
    price = info.price_krw  # 스키마가 int|None 을 보장하므로 바로 계산에 씁니다

    total_capacity = capacity_val * comp_count if capacity_val else None

    # 기준은 단위에 따라 달라집니다: 액체는 100ml/100g당, 개수 제품은 1개당.
    scale, basis_label = unit_price_basis(unit)
    unit_price = None
    if total_capacity and price and scale:
        unit_price = round(price / total_capacity * scale, 1)

    # 화면에 적혀 있던 단가와 대조 (읽기는 AI, 환산·비교는 코드)
    shown_price, shown_unit = parse_unit_price_text(info.unit_price_text)
    verdict = compare_unit_price(unit_price, shown_price, unit, shown_unit)

    rank = parse_category_rank(info.category_rank_text)
    buyers = parse_monthly_buyers(info.monthly_buyers_text)

    # 추정 월매출. 구매자수가 '이상'으로 표시되는 하한값이고 옵션 배수도 어림이므로,
    # 절대액보다는 제품 간 규모 비교용으로 쓰는 것이 맞다.
    est_revenue = None
    if buyers and price:
        est_revenue = buyers * price * REVENUE_OPTION_MULTIPLIER

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
        "단위당가격(원)": unit_price,
        "단가기준": basis_label,
        "쿠팡표기단가": info.unit_price_text,
        "단가검증": verdict,
        "제품형태": info.product_form,
        "제품역할": info.product_role,
        "순위": rank,
        "순위_원문": info.category_rank_text,
        "리뷰수": info.review_count,
        "월구매자수(명)": buyers,
        "구매자수_원문": info.monthly_buyers_text,
        "추정월매출(원)": est_revenue,
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
