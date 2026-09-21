"""
상세페이지 USP 분석 도구
========================
제품 상세페이지에서 "무엇을 내세워 파는가"(USP)를 뽑아 엑셀로 정리합니다.
썸네일 분석(analyze_thumbnails.py)이 '얼마에 파는가'를 담당한다면,
이 도구는 '왜 그 값을 받는가'를 담당합니다.

작업 흐름
    1) inventory - 캡처한 상세페이지 파일들을 확인합니다.
       PDF는 쪽수를, 이미지는 크기를 알려주고 번호를 매깁니다.

           python analyze_details.py inventory --folder ./상세캡처 --out ./상세준비됨

    2) (Claude) 준비된 파일을 보고 아래 DetailPageInfo 스키마대로
       추출 결과를 JSON 파일로 적습니다.

    3) build - 검증하고 집계해서 엑셀로 저장합니다.

           python analyze_details.py build --input usp추출.json \
               --category 캡슐세제 --output 결과/캡슐세제_USP.xlsx \
               --thumbnails 결과/쿠팡_생활용품_전체.xlsx

설계 의도
    USP는 숫자가 아니라 문장이라 자유롭게 적고 싶어지지만, 그러면 제품끼리
    비교·집계가 안 됩니다. 그래서 **틀은 고정하고 내용은 자유**로 두었습니다.
      - kind(유형)는 정해진 값 중 하나  -> 유형별 빈도 집계가 가능해짐
      - claim(소구점)은 자유 문장       -> 실제 내용을 잃지 않음
      - evidence(근거)는 페이지에 적힌 문구 그대로 -> 지어내기 방지

    (설문지에 비유하면, 객관식 문항으로 분류는 고정하되 주관식 칸에
     원문을 그대로 옮겨 적게 하는 방식입니다.)
"""

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, ValidationError

# PDF 쪽수 세기는 "스크롤 전에 저장했는지" 알려주는 참고 기능입니다.
# pypdf가 없거나 설치가 깨져 있어도 전체 작업은 그대로 되어야 하므로,
# 여기서 한 번만 시도해보고 실패하면 조용히 포기합니다.
# (한 번만 하는 이유: 파일마다 시도하면 같은 오류 메시지가 반복해서 쏟아집니다.)
try:
    from pypdf import PdfReader as _PdfReader
except BaseException:
    _PdfReader = None

PDF_SUFFIXES = (".pdf",)
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")


# ------------------------------------------------------------
# 1. 뽑아낼 항목의 설계도
# ------------------------------------------------------------
class UspItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str = Field(
        description="소구점을 한 줄로 요약 (예: '8배 초고농축으로 적은 양만 사용'). "
                    "페이지의 표현을 살리되 문장으로 정리하라"
    )
    kind: Literal["성분·원료", "인증·수상", "기능·성능", "용량·가격",
                  "사용편의", "향·감성", "안전성", "비교·우위", "프로모션", "기타"] = Field(
        description="이 소구점이 어느 유형인지. 집계를 위해 반드시 목록 중에서 고를 것"
    )
    evidence: str = Field(
        description="페이지에 실제로 적혀 있는 문구를 그대로 옮긴 것. "
                    "요약하거나 바꿔 쓰지 말 것. 이미지 속 글자도 그대로 옮긴다"
    )
    emphasis: Literal["강조", "보통", "약함"] = Field(
        description="페이지에서 얼마나 크게 다루는지. 큰 글씨·전용 섹션이면 '강조', "
                    "작은 글씨나 스펙표 한 줄이면 '약함'"
    )
    position: Literal["상단", "중단", "하단"] = Field(
        description="페이지 어느 위치에 나오는지. 위쪽일수록 판매자가 중요하게 여긴다는 뜻"
    )


class DetailPageInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brand: str | None = Field(description="브랜드명. 확인 불가하면 null")
    product_name: str | None = Field(description="제품명. 확인 불가하면 null")
    usps: list[UspItem] = Field(
        description="페이지가 내세우는 소구점 목록. 눈에 띄는 것부터 최대 12개까지. "
                    "같은 내용이 반복되면 하나로 합칠 것"
    )
    target_audience: str | None = Field(
        description="특정 대상을 겨냥한다면 그 대상 (예: '신생아·유아', '반려동물 가정', "
                    "'드럼세탁기 전용'). 명시가 없으면 null"
    )
    has_comparison: bool = Field(
        description="경쟁사·타사 제품과 비교하는 표나 그림이 있으면 true"
    )
    certifications: list[str] = Field(
        description="인증·수상 표기를 적힌 그대로 나열 (예: 'Dermatest Excellent', "
                    "'환경표지 인증', '비건 인증'). 없으면 빈 목록"
    )
    notes: str | None = Field(
        description="특이사항이나 사람이 재확인해야 할 부분. 페이지가 잘려 확인 불가한 "
                    "구간이 있으면 여기에 적을 것. 없으면 null"
    )


SYSTEM_PROMPT = """너는 한국 이커머스 제품 상세페이지를 분석해 판매자의 소구점(USP)을 정리하는 MD 보조원이다.

원칙:
- 페이지에 실제로 적혀 있는 것만 근거로 삼아라. 일반 상식이나 브랜드 이미지로 채우지 마라.
- evidence에는 반드시 페이지의 문구를 그대로 옮겨라. 요약본을 넣지 마라.
  이미지 안에 글자로 박혀 있는 문구도 그대로 옮긴다.
- claim은 그 evidence가 무엇을 주장하는지 한 줄로 정리한 것이다.
- 같은 주장이 여러 번 반복되면 하나로 합치되, emphasis를 '강조'로 올려라.
- 판매자가 위쪽에 배치한 것일수록 중요하게 여기는 것이다. position을 정확히 기록하라.
- 페이지가 잘려서 확인할 수 없는 구간이 있으면 추측하지 말고 notes에 적어라.
"""


# ------------------------------------------------------------
# 2. inventory - 캡처 파일 확인
# ------------------------------------------------------------
def cmd_inventory(args) -> None:
    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"폴더를 찾을 수 없습니다: {folder}")

    files = sorted(f for f in folder.iterdir()
                   if f.is_file() and not f.name.startswith("."))
    pdfs = [f for f in files if f.suffix.lower() in PDF_SUFFIXES]
    imgs = [f for f in files if f.suffix.lower() in IMAGE_SUFFIXES]
    other = [f for f in files if f not in pdfs and f not in imgs]

    if not pdfs and not imgs:
        sys.exit(f"폴더 안에 PDF나 이미지가 없습니다: {folder}\n"
                 f"  지원 형식: {', '.join(PDF_SUFFIXES + IMAGE_SUFFIXES)}")

    if other:
        names = ", ".join(f.name for f in other[:5])
        more = f" 외 {len(other) - 5}개" if len(other) > 5 else ""
        print(f"참고: 분석 대상이 아니라 제외한 파일 {len(other)}개 - {names}{more}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    mapping = {}
    thin = []
    for i, path in enumerate(pdfs + imgs, 1):
        name = f"{i:02d}{path.suffix.lower()}"
        (out / name).write_bytes(path.read_bytes())
        mapping[name] = path.name

        if path.suffix.lower() in PDF_SUFFIXES:
            pages = pdf_page_count(path)
            label = f"{pages}쪽" if pages else "쪽수 확인 불가"
            # 상세페이지인데 1~2쪽이면 스크롤 전에 저장했을 가능성이 큽니다.
            if pages is not None and pages <= 2:
                thin.append((path.name, pages))
        else:
            label = image_size_label(path)
        print(f"  {name}  <-  {path.name}  ({label})")

    (out / "mapping.json").write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{len(mapping)}건 준비 완료: {out.resolve()}")
    if thin:
        print("\n확인 필요 - 쪽수가 너무 적습니다. 페이지를 끝까지 스크롤하기 전에")
        print("저장하면 이미지가 안 불러와져 내용이 비게 됩니다:")
        for n, p in thin:
            print(f"  - {n} ({p}쪽)")


def pdf_page_count(path: Path) -> int | None:
    """PDF 쪽수를 셉니다. 못 읽으면 None.

    pypdf를 쓸 수 없으면 None을 돌려주고 그냥 넘어갑니다.
    """
    if _PdfReader is None:
        return None
    try:
        return len(_PdfReader(str(path)).pages)
    except BaseException:
        return None


def image_size_label(path: Path) -> str:
    try:
        from PIL import Image
        with Image.open(path) as im:
            return f"{im.width}x{im.height}"
    except BaseException:
        return "크기 확인 불가"


# ------------------------------------------------------------
# 3. build - 검증 + 집계 + 엑셀
# ------------------------------------------------------------
def cmd_build(args) -> None:
    in_path = Path(args.input)
    if not in_path.is_file():
        sys.exit(f"추출 결과 파일을 찾을 수 없습니다: {in_path}")

    entries = json.loads(in_path.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not entries:
        sys.exit("추출 결과는 비어 있지 않은 JSON 배열이어야 합니다.")

    mapping = {}
    map_path = Path(args.mapping) if args.mapping else in_path.parent / "mapping.json"
    if map_path.is_file():
        mapping = json.loads(map_path.read_text(encoding="utf-8"))
        print(f"대응표 사용: {map_path}")

    survey_date = args.date or date.today().isoformat()
    usp_rows, product_rows, errors = [], [], []

    for i, entry in enumerate(entries, 1):
        entry = dict(entry)
        key = entry.pop("file", None) or f"{i:02d}.pdf"
        try:
            info = DetailPageInfo.model_validate(entry)
        except ValidationError as e:
            first = e.errors()[0]
            errors.append(f"  {key}: {'.'.join(str(x) for x in first['loc'])} - {first['msg']}")
            continue

        src = mapping.get(key, key)
        product_rows.append({
            "조사일자": survey_date, "채널": args.channel, "카테고리": args.category,
            "원본파일명": src, "브랜드명": info.brand, "제품명": info.product_name,
            "USP개수": len(info.usps),
            "상단배치수": sum(1 for u in info.usps if u.position == "상단"),
            "강조수": sum(1 for u in info.usps if u.emphasis == "강조"),
            "주요유형": Counter(u.kind for u in info.usps).most_common(1)[0][0] if info.usps else None,
            "타겟": info.target_audience,
            "경쟁사비교": "있음" if info.has_comparison else "없음",
            "인증수": len(info.certifications),
            "인증목록": " / ".join(info.certifications) or None,
            "비고": info.notes,
        })
        for u in info.usps:
            usp_rows.append({
                "조사일자": survey_date, "채널": args.channel, "카테고리": args.category,
                "원본파일명": src, "브랜드명": info.brand, "제품명": info.product_name,
                "유형": u.kind, "소구점": u.claim, "근거문구": u.evidence,
                "강조도": u.emphasis, "위치": u.position,
            })

    if errors:
        sys.exit(f"추출 결과 {len(errors)}건이 스키마에 맞지 않습니다:\n" + "\n".join(errors))

    products = pd.DataFrame(product_rows)
    usps = pd.DataFrame(usp_rows)

    # 썸네일 분석 결과(가격·순위)와 붙이면 "비싼 제품은 뭘 내세우나"를 볼 수 있습니다.
    if args.thumbnails:
        products = join_thumbnails(products, Path(args.thumbnails), args.category)

    # 유형별 빈도 - 이 카테고리에서 무엇이 표준 소구점인지 드러납니다.
    by_kind = (usps.groupby("유형")
               .agg(등장수=("소구점", "size"),
                    제품수=("제품명", "nunique"),
                    상단배치=("위치", lambda s: (s == "상단").sum()),
                    강조=("강조도", lambda s: (s == "강조").sum()))
               .sort_values("등장수", ascending=False).reset_index()
               if not usps.empty else pd.DataFrame())

    out_path = Path(args.output)
    if str(out_path.parent) not in ("", "."):
        out_path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(out_path, engine="openpyxl") as w:
        by_kind.to_excel(w, sheet_name="유형별집계", index=False)
        products.to_excel(w, sheet_name="제품별요약", index=False)
        usps.to_excel(w, sheet_name="USP전체", index=False)

    print(f"\n제품 {len(products)}건 / USP {len(usps)}건")
    if not by_kind.empty:
        print("\n유형별 등장 빈도:")
        for _, r in by_kind.head(6).iterrows():
            print(f"  {r['유형']:8s} {r['등장수']:3d}회  (제품 {r['제품수']}개, 상단 {r['상단배치']}, 강조 {r['강조']})")
    print(f"\n완료: {out_path.resolve()}")


def join_thumbnails(products: pd.DataFrame, path: Path, category: str) -> pd.DataFrame:
    """썸네일 분석 엑셀에서 순위·단가를 가져와 붙입니다 (제품명 기준)."""
    if not path.is_file():
        print(f"참고: 썸네일 결과를 찾을 수 없어 가격·순위는 붙이지 않습니다 ({path})")
        return products
    t = pd.read_excel(path)
    t = t[t["카테고리"] == category] if "카테고리" in t.columns else t
    cols = [c for c in ["제품명", "순위", "판매가(원)", "단위당가격(원)", "단가기준",
                        "리뷰수", "추정월매출(원)"] if c in t.columns]
    merged = products.merge(t[cols].drop_duplicates("제품명"), on="제품명", how="left")
    matched = merged["순위"].notna().sum() if "순위" in merged.columns else 0
    print(f"썸네일 결과와 연결: {matched}/{len(products)}건 (제품명 기준)")
    if matched < len(products):
        print("  연결 안 된 건은 제품명 표기가 달라서입니다. 엑셀에서 직접 맞춰주세요.")
    return merged


# ------------------------------------------------------------
# 4. 명령 정의
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="상세페이지 USP 분석 → 엑셀 출력")
    sub = parser.add_subparsers(dest="command", required=True)

    p_inv = sub.add_parser("inventory", help="캡처한 상세페이지 파일 확인 및 번호 매기기")
    p_inv.add_argument("--folder", required=True, help="상세페이지 캡처가 들어있는 폴더")
    p_inv.add_argument("--out", required=True, help="정리된 파일을 저장할 폴더")
    p_inv.set_defaults(func=cmd_inventory)

    p_build = sub.add_parser("build", help="USP 추출 결과를 검증·집계해 엑셀로 저장")
    p_build.add_argument("--input", required=True, help="USP 추출 결과 JSON 경로")
    p_build.add_argument("--output", default="detail_usp.xlsx", help="출력 엑셀 경로")
    p_build.add_argument("--channel", default="쿠팡", help="채널명")
    p_build.add_argument("--category", default="", help="카테고리명 (예: 캡슐세제)")
    p_build.add_argument("--mapping", default=None,
                         help="번호-원본파일명 대응표 (기본: 입력 파일 옆의 mapping.json)")
    p_build.add_argument("--thumbnails", default=None,
                         help="썸네일 분석 엑셀 경로. 주면 순위·단가를 함께 붙임")
    p_build.add_argument("--date", default=None, help="조사일자 (기본: 오늘)")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
