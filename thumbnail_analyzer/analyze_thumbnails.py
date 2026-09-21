"""
썸네일 이미지 일괄 분석 스크립트
=================================
사용법:
    python analyze_thumbnails.py --folder ./images --channel 쿠팡 --category 캡슐세제

무엇을 하는 스크립트인가?
    1. 지정한 폴더 안의 이미지(제품 썸네일)를 하나씩 Claude Vision에게 보여줍니다.
    2. Claude가 이미지 안의 텍스트(브랜드명/용량/가격 등)를 읽고,
       이미지 형태(본품 용기인지, 리필 파우치인지, 말통인지)까지 판단해서
       JSON 형태로 대답하게 합니다.
    3. "용량당 가격(단위당단가)"은 AI가 아니라 파이썬이 직접 계산합니다.
       (AI에게 계산까지 시키면 가끔 산수를 틀리기 때문에, 텍스트 인식은 AI /
        숫자 계산은 코드, 로 역할을 나눴습니다.)
    4. 결과를 엑셀 파일로 저장합니다. 이미 같은 엑셀 파일이 있으면
       새로 분석한 내용을 아래에 이어 붙입니다 (누적 데이터베이스처럼 사용 가능).

준비물:
    pip install anthropic pandas openpyxl pillow
    export ANTHROPIC_API_KEY="본인 API 키"   (Claude Console에서 발급)

비용 참고:
    이미지 1장당 대략 수백~수천 토큰 소모. 150장이면 모델에 따라
    보통 몇천원 이내입니다 (claude-sonnet-5 기준). 비용을 더 줄이고 싶으면
    --model claude-haiku-4-5-20251001 옵션을 쓰세요 (정확도는 약간 낮아질 수 있음).
"""

import argparse
import base64
import io
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd
from anthropic import Anthropic
from PIL import Image

# ------------------------------------------------------------
# 1. Claude에게 보낼 프롬프트 (여기서 "무엇을 뽑아낼지" 정의)
# ------------------------------------------------------------
SYSTEM_PROMPT = """너는 한국 이커머스(쿠팡 등) 생활용품 카테고리 제품 썸네일 이미지를 분석하는 MD 보조원이다.
이미지 안에 보이는 텍스트와, 제품 이미지 자체의 형태(용기 모양)를 근거로 아래 JSON 스키마에 맞춰 답하라.
정보를 이미지에서 확인할 수 없으면 null로 표기하라. 절대 추측으로 숫자를 지어내지 마라.

출력은 아래 키를 가진 JSON 객체 하나만 출력한다. 다른 설명 텍스트는 절대 붙이지 마라.

{
  "brand": "브랜드명 (문자열 또는 null)",
  "product_name": "제품명 (문자열 또는 null)",
  "price_krw": "판매가, 숫자만 (예: 12900) 또는 null",
  "capacity_text": "용량 표기 원문 그대로 (예: '500ml', '1L', '3kg') 또는 null",
  "composition_text": "구성/수량 표기 원문 (예: '2개입', '1개', '리필 3개 세트') 또는 null",
  "product_form": "용기 | 리필파우치 | 말통 | 세트 | 기타",
  "form_reason": "product_form을 그렇게 판단한 짧은 근거 (예: '파우치형 포장에 리필 문구 확인')",
  "notes": "기타 특이사항이나 애매해서 사람이 재확인해야 할 부분 (없으면 null)"
}
"""

USER_PROMPT = "이 제품 썸네일 이미지를 분석해서 위 JSON 스키마대로 답해줘."


# ------------------------------------------------------------
# 2. 이미지 인코딩 (용량이 크면 리사이즈해서 비용/속도 절약)
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
# 3. Claude Vision 호출 + JSON 파싱
# ------------------------------------------------------------
def extract_product_info(client: Anthropic, image_path: Path, model: str) -> dict:
    b64, media_type = encode_image(image_path)

    response = client.messages.create(
        model=model,
        max_tokens=600,
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
    )

    raw_text = "".join(block.text for block in response.content if block.type == "text")
    # 혹시 ```json 코드블록으로 감싸서 나오면 제거
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw_text.strip(), flags=re.MULTILINE).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {
            "brand": None, "product_name": None, "price_krw": None,
            "capacity_text": None, "composition_text": None,
            "product_form": "기타", "form_reason": None,
            "notes": f"[파싱 실패] 원본 응답: {raw_text[:200]}",
        }


# ------------------------------------------------------------
# 4. "500ml", "1L", "3kg" 같은 텍스트를 표준 단위(ml 또는 g)로 환산
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
# 5. 메인 로직
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

        capacity_val, unit = parse_capacity(info.get("capacity_text"))
        comp_count = parse_composition_count(info.get("composition_text"))
        price = info.get("price_krw")

        total_capacity = capacity_val * comp_count if capacity_val else None
        unit_price = None
        if total_capacity and price:
            try:
                unit_price = round(float(price) / total_capacity * 100, 1)  # 100ml/g당 가격
            except (TypeError, ValueError, ZeroDivisionError):
                unit_price = None

        rows.append({
            "조사일자": date.today().isoformat(),
            "채널": args.channel,
            "카테고리": args.category,
            "원본파일명": path.name,
            "브랜드명": info.get("brand"),
            "제품명": info.get("product_name"),
            "판매가(원)": price,
            "용량_원문": info.get("capacity_text"),
            "구성_원문": info.get("composition_text"),
            "총용량": total_capacity,
            "단위": unit,
            "단위당가격(100당,원)": unit_price,
            "제품형태": info.get("product_form"),
            "형태_판단근거": info.get("form_reason"),
            "비고": info.get("notes"),
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
