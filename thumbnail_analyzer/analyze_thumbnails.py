"""
썸네일 이미지 일괄 분석 스크립트
=================================
사용법:
    python analyze_thumbnails.py --folder ./images --channel 쿠팡 --category 캡슐세제

무엇을 하는 스크립트인가?
    1. 지정한 폴더 안의 이미지(제품 썸네일)를 하나씩 Claude Vision에게 보여줍니다.
    2. Claude가 이미지 안의 텍스트(브랜드명/용량/가격 등)를 읽고,
       이미지 형태(본품 용기인지, 리필 파우치인지, 말통인지)까지 판단합니다.
       이때 Structured Outputs(구조화 출력) 기능을 써서, 아래 ProductInfo
       스키마를 벗어난 응답 자체가 나올 수 없도록 API가 강제합니다.
       (예전에는 "JSON으로 답해줘"라고 부탁한 뒤 받은 글자를 직접 파싱했는데,
        가끔 설명이 섞이거나 형식이 깨져서 실패하는 일이 있었습니다.)
    3. "용량당 가격(단위당단가)"은 AI가 아니라 파이썬이 직접 계산합니다.
       (AI에게 계산까지 시키면 가끔 산수를 틀리기 때문에, 텍스트 인식은 AI /
        숫자 계산은 코드, 로 역할을 나눴습니다.)
    4. 결과를 엑셀 파일로 저장합니다. 이미 같은 엑셀 파일이 있으면
       새로 분석한 내용을 아래에 이어 붙입니다 (누적 데이터베이스처럼 사용 가능).

준비물:
    pip install -r requirements.txt
    (anthropic 1.7.0 이상 필요 - Structured Outputs를 쓰기 때문입니다)
    export ANTHROPIC_API_KEY="본인 API 키"   (Claude Console에서 발급)

비용 참고:
    이미지 1장당 대략 수백~수천 토큰 소모. 150장이면 모델에 따라
    보통 몇천원 이내입니다 (claude-sonnet-5 기준). 비용을 더 줄이고 싶으면
    --model claude-haiku-4-5-20251001 옵션을 쓰세요 (정확도는 약간 낮아질 수 있음).
"""

import argparse
import base64
import io
import re
import sys
from datetime import date
from pathlib import Path
from typing import Literal

import pandas as pd
from anthropic import Anthropic
from PIL import Image
from pydantic import BaseModel, Field

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


class ProductInfo(BaseModel):
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


# ------------------------------------------------------------
# 3. 이미지 인코딩 (용량이 크면 리사이즈해서 비용/속도 절약)
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
# 4. Claude Vision 호출
# ------------------------------------------------------------
def _blank(reason: str) -> ProductInfo:
    """분석에 실패했을 때, 비고란에 사유만 남긴 빈 행을 돌려줍니다."""
    return ProductInfo(
        brand=None, product_name=None, price_krw=None,
        capacity_text=None, composition_text=None,
        product_form="기타", form_reason=None, notes=reason,
    )


def extract_product_info(client: Anthropic, image_path: Path, model: str) -> ProductInfo:
    b64, media_type = encode_image(image_path)

    # messages.parse() = "이 양식(ProductInfo)대로만 답해라"라고 API에 못박는 호출.
    # 응답은 이미 검증을 마친 ProductInfo 객체로 돌아옵니다.
    # (예전처럼 ```json 코드블록을 벗겨내거나 json.loads를 감싸줄 필요가 없습니다.)
    response = client.messages.parse(
        model=model,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64},
                    },
                    {"type": "text", "text": USER_PROMPT},
                ],
            }
        ],
        output_format=ProductInfo,
    )

    # 양식은 강제되지만, 답이 중간에 잘리거나(max_tokens) 모델이 응답을 거부하면
    # 채워진 결과가 없을 수 있습니다. 그 경우만 빈 행으로 처리합니다.
    if response.parsed_output is None:
        return _blank(f"[분석 실패] 응답 종료 사유: {response.stop_reason}")

    return response.parsed_output


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
# 6. 메인 로직
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="제품 썸네일 이미지 일괄 분석 → 엑셀 출력")
    parser.add_argument("--folder", required=True, help="이미지가 들어있는 폴더 경로")
    parser.add_argument("--output", default="thumbnail_analysis.xlsx", help="출력 엑셀 파일 경로")
    parser.add_argument("--channel", default="", help="채널명 (예: 쿠팡)")
    parser.add_argument("--category", default="", help="카테고리명 (예: 캡슐세제)")
    parser.add_argument("--model", default="claude-sonnet-5", help="사용할 모델")
    args = parser.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"폴더를 찾을 수 없습니다: {folder}")

    image_paths = sorted(
        p for p in folder.iterdir()
        if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
    )
    if not image_paths:
        sys.exit("폴더 안에 이미지 파일이 없습니다.")

    print(f"총 {len(image_paths)}장 분석 시작...")

    client = Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용
    rows = []

    for i, path in enumerate(image_paths, 1):
        print(f"  [{i}/{len(image_paths)}] {path.name} 분석 중...")
        try:
            info = extract_product_info(client, path, args.model)
        except Exception as e:
            print(f"    -> 오류 발생, 건너뜀: {e}")
            continue

        capacity_val, unit = parse_capacity(info.capacity_text)
        comp_count = parse_composition_count(info.composition_text)
        price = info.price_krw  # 스키마가 int|None 을 보장하므로 바로 계산에 씁니다

        total_capacity = capacity_val * comp_count if capacity_val else None
        unit_price = None
        if total_capacity and price:
            unit_price = round(price / total_capacity * 100, 1)  # 100ml/g당 가격

        rows.append({
            "조사일자": date.today().isoformat(),
            "채널": args.channel,
            "카테고리": args.category,
            "원본파일명": path.name,
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
        })

    new_df = pd.DataFrame(rows)

    out_path = Path(args.output)
    if out_path.exists():
        old_df = pd.read_excel(out_path)
        combined = pd.concat([old_df, new_df], ignore_index=True)
        print(f"기존 파일에 이어붙임: {len(old_df)}행 + {len(new_df)}행 = {len(combined)}행")
    else:
        combined = new_df

    combined.to_excel(out_path, index=False)
    print(f"완료: {out_path.resolve()}")


if __name__ == "__main__":
    main()
