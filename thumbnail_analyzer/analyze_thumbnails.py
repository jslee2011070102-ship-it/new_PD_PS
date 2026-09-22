"""
썸네일 분석 도구
================
쿠팡 등 이커머스 제품 썸네일에서 가격·용량·시장지표를 뽑아 엑셀로 정리합니다.

작업 흐름 (Claude가 이미지를 읽는 방식)
    1) prepare - 캡처 폴더를 읽기 좋게 정리합니다.
                 HEIC를 JPG로 바꾸고, 회전 정보를 반영하고, 크기를 줄이고,
                 01.jpg, 02.jpg ... 로 번호를 매깁니다.

           python analyze_thumbnails.py prepare --folder ./캡처 --out ./준비됨

    2) (사람/Claude) 준비된 이미지를 보고 아래 ProductInfo 스키마대로
       추출 결과를 JSON 파일로 적습니다. 형식은 다음과 같습니다.

           [ {"file": "01.jpg", "brand": "...", "price_krw": 14160, ... }, ... ]

    3) build - 그 JSON을 검증하고, 계산하고, 엑셀로 저장합니다.

           python analyze_thumbnails.py build --input 추출.json \
               --channel 쿠팡 --category 캡슐세제 --output 결과/캡슐세제.xlsx

왜 이렇게 나눠져 있나?
    "이미지를 읽는 일"과 "숫자를 다루는 일"을 분리하기 위해서입니다.
    읽기는 사람이나 AI가 하지만, 환산·계산·검산은 전부 이 코드가 합니다.
    (AI에게 산수를 맡기면 가끔 틀리기 때문에 의도적으로 갈라놨습니다.)

    build 단계에서 추출 결과를 ProductInfo 스키마로 검증하므로,
    칸을 빠뜨리거나 정해진 값이 아닌 걸 적으면 그 자리에서 걸러집니다.

준비물:
    pip install -r requirements.txt
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import quote_plus

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

HEIF_SUFFIXES = (".heic", ".heif")
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", *HEIF_SUFFIXES)

# 추정 월매출 = 월구매자수 x 판매가 x 아래 배수
# 한 상품 페이지에 여러 옵션(용량·향 등)이 묶여 있고 구매자수는 페이지 단위로
# 표시되므로, 다른 옵션 매출을 감안해 2를 곱합니다. 어디까지나 어림값입니다.
REVENUE_OPTION_MULTIPLIER = 2


# ------------------------------------------------------------
# 1. 뽑아낼 항목의 "설계도" (스키마)
# ------------------------------------------------------------
# 이 클래스가 곧 추출 양식이자 검증 규칙입니다.
# (빈칸이 정해진 서류와 같습니다. 칸 밖에 쓰거나 칸을 비우면 build가 거부합니다.)
#
# - `| None` 은 "이미지에서 확인 못 하면 비워도 된다"는 뜻입니다.
# - `price_krw: int | None` 처럼 타입을 못박아두면, "12,900원" 같은 글자가
#   섞여 들어오는 일 자체가 생기지 않습니다. 뒤에서 하는 나눗셈이 안전해집니다.
# - Field(description=...) 이 각 칸을 어떻게 채워야 하는지 설명합니다.
#   추출 항목을 바꾸려면 이 클래스만 고치면 됩니다.
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
    product_url: str | None = Field(
        description="상품 페이지 주소. 브라우저에서 보고 있다면 주소창의 URL을 그대로 옮겨라. "
                    "앱 화면 캡처처럼 주소를 알 수 없으면 null. 절대 추측해서 만들지 마라"
    )
    notes: str | None = Field(
        description="특이사항이나 애매해서 사람이 재확인해야 할 부분. 없으면 null"
    )

# ------------------------------------------------------------
# 2. 이미지를 읽을 때 지켜야 할 원칙
# ------------------------------------------------------------
# 항목별 설명은 위 스키마가 담당하므로, 여기에는 태도/원칙만 남깁니다.
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


# ------------------------------------------------------------
# 3. prepare - 캡처 폴더를 읽기 좋게 정리
# ------------------------------------------------------------
def normalize_image(src: Path, dst: Path, max_dim: int = 1024) -> tuple[int, int]:
    """HEIC 변환 + 회전 반영 + 축소해서 JPG로 저장합니다."""
    img = Image.open(src)

    # 폰 사진은 "세로로 찍었음" 같은 회전 정보를 파일 안에 따로 들고 있습니다.
    # 이걸 실제 픽셀에 반영해두지 않으면 옆으로 누운 이미지가 되어
    # 글자를 제대로 읽을 수 없습니다.
    img = ImageOps.exif_transpose(img)

    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    if max(img.size) > max_dim:
        ratio = max_dim / max(img.size)
        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)

    img.save(dst, format="JPEG", quality=88)
    return img.size


def cmd_prepare(args) -> None:
    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"폴더를 찾을 수 없습니다: {folder}")

    files = [f for f in folder.iterdir() if f.is_file() and not f.name.startswith(".")]
    images = sorted(f for f in files if f.suffix.lower() in IMAGE_SUFFIXES)
    skipped = sorted(f for f in files if f.suffix.lower() not in IMAGE_SUFFIXES)

    # HEIC가 있는데 읽을 준비가 안 됐다면 조용히 건너뛰지 않고 여기서 멈춥니다.
    # (모르고 일부만 분석한 엑셀을 받는 것이 제일 나쁜 결과이기 때문입니다.)
    heic = [f for f in images if f.suffix.lower() in HEIF_SUFFIXES]
    if heic and not HEIF_SUPPORTED:
        sys.exit(f"HEIC 이미지가 {len(heic)}장 있는데 읽을 수 없습니다.\n"
                 "  다음을 실행해 주세요:  pip install pillow-heif\n"
                 "  (아이폰 캡처는 보통 .HEIC로 저장됩니다)")

    if not images:
        sys.exit(f"폴더 안에 이미지가 없습니다: {folder}\n"
                 f"  지원 형식: {', '.join(IMAGE_SUFFIXES)}")

    if skipped:
        names = ", ".join(f.name for f in skipped[:5])
        more = f" 외 {len(skipped) - 5}개" if len(skipped) > 5 else ""
        print(f"참고: 이미지가 아니라 제외한 파일 {len(skipped)}개 - {names}{more}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    mapping = {}
    for i, path in enumerate(images, 1):
        name = f"{i:02d}.jpg"
        size = normalize_image(path, out / name)
        mapping[name] = path.name
        print(f"  {name}  <-  {path.name}  ({size[0]}x{size[1]})")

    # 번호와 원본 파일명의 대응표. build가 엑셀에 원본 이름을 적을 때 씁니다.
    (out / "mapping.json").write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{len(images)}장 준비 완료: {out.resolve()}")
    print(f"  대응표: {(out / 'mapping.json').name}")


# ------------------------------------------------------------
# 4. 단위 환산과 검산 (읽기는 사람/AI, 계산은 전부 여기서)
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
# 5. build - 추출 결과를 검증하고 계산해서 엑셀로
# ------------------------------------------------------------
def coupang_search_url(product_name: str | None, brand: str | None) -> str | None:
    """제품명으로 쿠팡 검색 주소를 만듭니다.

    상품 페이지 주소가 아니라 '검색 결과' 주소입니다. 캡처 화면에는 주소가 찍히지
    않아 실제 URL을 알 수 없기 때문에, 추측해서 만드는 대신 한 번에 찾아갈 수 있는
    검색 링크를 대신 넣습니다. (주소를 지어내면 엉뚱한 상품으로 가게 됩니다.)
    """
    # 쿠팡 제품명에는 브랜드가 이미 들어 있는 경우가 많아, 그대로 붙이면
    # "피지 피지 모락셀라..."처럼 중복됩니다. 없을 때만 앞에 붙입니다.
    name = (product_name or "").strip()
    b = (brand or "").strip()
    q = name if (not b or b in name) else f"{b} {name}".strip()
    if not q:
        return None
    return "https://www.coupang.com/np/search?q=" + quote_plus(q)


def row_from_info(info: ProductInfo, filename: str, meta: dict) -> dict:
    """검증을 마친 추출 결과 하나를 엑셀 한 행으로 바꿉니다."""
    capacity_val, unit = parse_capacity(info.capacity_text)
    comp_count = parse_composition_count(info.composition_text)
    price = info.price_krw  # 스키마가 int|None 을 보장하므로 바로 계산에 씁니다

    total_capacity = capacity_val * comp_count if capacity_val else None

    # 기준은 단위에 따라 달라집니다: 액체는 100ml/100g당, 개수 제품은 1개당.
    scale, basis_label = unit_price_basis(unit)
    unit_price = None
    if total_capacity and price and scale:
        unit_price = round(price / total_capacity * scale, 1)

    # 화면에 적혀 있던 단가와 대조 (읽기는 사람/AI, 환산·비교는 코드)
    shown_price, shown_unit = parse_unit_price_text(info.unit_price_text)
    verdict = compare_unit_price(unit_price, shown_price, unit, shown_unit)

    rank = parse_category_rank(info.category_rank_text)
    buyers = parse_monthly_buyers(info.monthly_buyers_text)

    # 추정 월매출. 구매자수가 '이상'으로 표시되는 하한값이고 옵션 배수도 어림이므로,
    # 절대액보다는 제품 간 규모 비교용으로 쓰는 것이 맞습니다.
    est_revenue = buyers * price * REVENUE_OPTION_MULTIPLIER if (buyers and price) else None

    return {
        "조사일자": meta["survey_date"],
        "채널": meta["channel"],
        "카테고리": meta["category"],
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
        "상품URL": info.product_url,
        "검색링크": coupang_search_url(info.product_name, info.brand),
        "비고": info.notes,
    }


def cmd_build(args) -> None:
    in_path = Path(args.input)
    if not in_path.is_file():
        sys.exit(f"추출 결과 파일을 찾을 수 없습니다: {in_path}")

    entries = json.loads(in_path.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not entries:
        sys.exit("추출 결과는 비어 있지 않은 JSON 배열이어야 합니다.")

    # 번호 -> 원본 파일명 대응표 (prepare가 만들어 둔 것)
    mapping = {}
    map_path = Path(args.mapping) if args.mapping else in_path.parent / "mapping.json"
    if map_path.is_file():
        mapping = json.loads(map_path.read_text(encoding="utf-8"))
        print(f"대응표 사용: {map_path}")

    meta = {"survey_date": args.date or date.today().isoformat(),
            "channel": args.channel, "category": args.category}

    rows, errors = [], []
    for i, entry in enumerate(entries, 1):
        entry = dict(entry)
        key = entry.pop("file", None) or f"{i:02d}.jpg"
        try:
            info = ProductInfo.model_validate(entry)
        except ValidationError as e:
            # 조용히 넘기지 않습니다. 어느 항목이 왜 틀렸는지 알려주고 멈춥니다.
            first = e.errors()[0]
            errors.append(f"  {key}: {'.'.join(str(x) for x in first['loc'])} - {first['msg']}")
            continue
        rows.append(row_from_info(info, mapping.get(key, key), meta))

    if errors:
        sys.exit(f"추출 결과 {len(errors)}건이 스키마에 맞지 않습니다:\n" + "\n".join(errors))

    new_df = pd.DataFrame(rows)

    out_path = Path(args.output)
    if str(out_path.parent) not in ("", "."):
        out_path.parent.mkdir(parents=True, exist_ok=True)

    if out_path.exists():
        old_df = pd.read_excel(out_path)
        combined = pd.concat([old_df, new_df], ignore_index=True)
        print(f"기존 파일에 이어붙임: {len(old_df)}행 + {len(new_df)}행 = {len(combined)}행")
    else:
        combined = new_df

    combined.to_excel(out_path, index=False)

    # 단가검증 결과를 요약해 줍니다. '일치'가 아닌 행만 확인하면 됩니다.
    counts = new_df["단가검증"].value_counts()
    print("\n단가검증:", ", ".join(f"{k} {v}건" for k, v in counts.items()))
    bad = new_df[~new_df["단가검증"].isin(["일치", "표기없음"])]
    if not bad.empty:
        print("확인 필요:", ", ".join(bad["원본파일명"].tolist()))

    print(f"완료: {out_path.resolve()}")


# ------------------------------------------------------------
# 6. urls - 브라우저에 붙여넣을 "상품 URL 수집" 지시문 생성
# ------------------------------------------------------------
# 캡처 화면에는 주소가 없어 상품 URL을 알 수 없습니다. 브라우저(Claude in Chrome 등)에
# 대신 찾아달라고 할 때 쓸 지시문을, 엑셀의 제품명으로 채워서 만들어 줍니다.
# 제품명을 손으로 옮기다 빠뜨리는 일을 막기 위한 것입니다.
def read_product_sheet(src: Path, sheet: str | None = None) -> pd.DataFrame:
    """엑셀에서 제품 목록이 들어 있는 시트를 찾아 읽습니다.

    우리가 만든 엑셀은 첫 시트가 '요약'이라 그냥 읽으면 제품명 칸이 없습니다.
    그래서 필요한 칸(제품명)이 있는 시트를 찾아서 씁니다.
    """
    book = pd.read_excel(src, sheet_name=None)  # 전체 시트를 딕셔너리로
    if sheet:
        if sheet not in book:
            sys.exit(f"'{sheet}' 시트가 없습니다. 있는 시트: {', '.join(book)}")
        return book[sheet]
    for name in ("전체", *book):          # '전체' 시트를 우선 보고, 없으면 순서대로
        if name in book and "제품명" in book[name].columns:
            return book[name]
    sys.exit(f"제품명 칸이 있는 시트를 찾지 못했습니다. 있는 시트: {', '.join(book)}")


def cmd_urls(args) -> None:
    src = Path(args.excel)
    if not src.is_file():
        sys.exit(f"엑셀을 찾을 수 없습니다: {src}")

    df = read_product_sheet(src, args.sheet)

    # --select 로 "카테고리:순위,순위" 를 여러 개 줄 수 있습니다.
    # (여러 카테고리에서 골라 뽑는 일이 잦아서, 명령 한 번으로 끝나게 했습니다.)
    if args.select:
        picked = []
        for spec in args.select:
            if ":" not in spec:
                sys.exit(f"--select 형식이 잘못됐습니다: {spec}\n"
                         "  예: --select 캡슐세제:11,12,13 세탁세제:1,2,3")
            cat, ranks = spec.split(":", 1)
            try:
                want = {int(x) for x in ranks.split(",") if x.strip()}
            except ValueError:
                sys.exit(f"--select 의 순위는 숫자여야 합니다: {spec}")
            sub = df[(df["카테고리"] == cat) & (df["순위"].isin(want))]
            missing = want - set(sub["순위"].dropna().astype(int))
            if missing:
                sys.exit(f"'{cat}'에서 순위 {sorted(missing)}를 찾지 못했습니다.")
            picked.append(sub)
        df = pd.concat(picked)
    else:
        if args.category:
            df = df[df["카테고리"] == args.category]
        if args.ranks:
            want = {int(x) for x in args.ranks.split(",")}
            df = df[df["순위"].isin(want)]

    df = df[df["제품명"].notna()].sort_values(["카테고리", "순위"])
    if df.empty:
        sys.exit("조건에 맞는 제품이 없습니다. --select / --category / --ranks 를 확인해 주세요.")

    names = []
    for _, r in df.iterrows():
        brand = r.get("브랜드명")
        name = str(r["제품명"])
        # 제품명에 브랜드가 이미 있으면 중복해서 붙이지 않습니다.
        label = name if (not isinstance(brand, str) or brand in name) else f"{brand} {name}"
        names.append(f"- {label}")

    # 한 번에 몰아서 시키면 중간에 멈췄을 때 그때까지 한 게 통째로 날아갑니다.
    # 묶음마다 결과를 내놓게 하면, 멈춰도 거기까지는 건집니다.
    # (등산 중간중간 베이스캠프를 두는 것과 같습니다.)
    pace = ""
    if args.pace and args.pace < len(names):
        batches = (len(names) + args.pace - 1) // args.pace
        pace = f"""
[진행 방식]
- {args.pace}개씩 묶어서 처리해라. 총 {batches}묶음이다.
- **한 묶음이 끝날 때마다 그 묶음의 JSON 배열을 먼저 출력하고** 다음 묶음으로 넘어가라.
  마지막에 한꺼번에 모아서 내지 마라. 중간에 중단되면 그때까지 한 것이 사라진다.
- 검색과 검색 사이에는 몇 초 쉬어라. 쉬지 않고 연달아 요청하지 마라.
- 도중에 오류가 나거나 막히면, 멈추기 전에 그때까지의 결과를 먼저 출력해라.
"""

    print(f"""쿠팡에서 아래 제품들을 하나씩 검색해서, 검색 결과 중 제품명이 가장 잘 맞는
상품의 제품명과 URL을 찾아줘. 총 {len(names)}개다.

찾은 결과는 아래 형태의 JSON 배열로만 출력해. 설명 문장은 붙이지 마.

[{{"query": "내가 준 제품명 그대로", "product_name": "쿠팡에 표시된 제품명", "product_url": "https://www.coupang.com/vp/products/..."}}]

주의:
- product_url은 주소창의 실제 주소를 그대로 옮겨라. 만들어내지 마라.
- 검색 결과에 확실히 같은 제품이 없으면 product_url을 null로 두고
  product_name에 가장 비슷했던 상품명을 적어라. 억지로 고르지 마라.
- 광고(AD) 표시가 붙은 상품은 건너뛰고 일반 검색 결과에서 골라라.
{pace}
[제품 목록]
{chr(10).join(names)}
""")


# ------------------------------------------------------------
# 7. 명령 정의
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="제품 썸네일 분석 → 엑셀 출력")
    sub = parser.add_subparsers(dest="command", required=True)

    p_prep = sub.add_parser("prepare", help="캡처 폴더를 읽기 좋게 정리 (HEIC/회전/축소/번호)")
    p_prep.add_argument("--folder", required=True, help="원본 캡처가 들어있는 폴더")
    p_prep.add_argument("--out", required=True, help="정리된 이미지를 저장할 폴더")
    p_prep.set_defaults(func=cmd_prepare)

    p_urls = sub.add_parser("urls", help="상품 URL 수집용 지시문 생성 (브라우저에 붙여넣기)")
    p_urls.add_argument("--excel", required=True, help="썸네일 분석 엑셀 경로")
    p_urls.add_argument("--category", default=None, help="특정 카테고리만 (예: 캡슐세제)")
    p_urls.add_argument("--ranks", default=None, help="특정 순위만, 쉼표로 구분 (예: 11,12,13)")
    p_urls.add_argument("--pace", type=int, default=4,
                        help="몇 개씩 묶어서 처리하게 할지 (기본 4). 0이면 진행 방식 지시를 넣지 않음")
    p_urls.add_argument("--select", nargs="+", default=None,
                        help='여러 카테고리에서 골라 뽑기. "카테고리:순위,순위" 형식 '
                             '(예: --select 캡슐세제:11,12 세탁세제:1,2)')
    p_urls.add_argument("--sheet", default=None, help="읽을 시트 이름 (기본: 제품명 칸이 있는 시트)")
    p_urls.set_defaults(func=cmd_urls)

    p_build = sub.add_parser("build", help="추출 결과 JSON을 검증·계산해 엑셀로 저장")
    p_build.add_argument("--input", required=True, help="추출 결과 JSON 경로")
    p_build.add_argument("--output", default="thumbnail_analysis.xlsx", help="출력 엑셀 경로")
    p_build.add_argument("--channel", default="", help="채널명 (예: 쿠팡)")
    p_build.add_argument("--category", default="", help="카테고리명 (예: 캡슐세제)")
    p_build.add_argument("--mapping", default=None,
                         help="번호-원본파일명 대응표 (기본: 입력 파일 옆의 mapping.json)")
    p_build.add_argument("--date", default=None, help="조사일자 (기본: 오늘)")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
