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
# 2. prompt - 다른 곳(Claude in Chrome 등)에 붙여넣을 추출 지시문 생성
# ------------------------------------------------------------
# 상세페이지를 사람이 캡처하는 대신, 브라우저에서 읽게 할 수도 있습니다.
# 그때 쓸 지시문을 여기서 만들어 줍니다.
#
# 지시문을 손으로 적어두지 않고 코드로 만드는 이유:
# 스키마(DetailPageInfo)를 고치면 지시문도 자동으로 따라 바뀝니다.
# 따로 적어두면 둘이 어긋나고, 그러면 받은 결과가 build에서 전부 튕깁니다.
# (계약서 원본과 사본을 따로 관리하지 않고, 원본에서 사본을 뽑아 쓰는 것과 같습니다.)
TYPE_NAMES = {str: "문자열", int: "정수", bool: "true 또는 false", type(None): "null"}


def type_label(ann) -> str:
    """파이썬 타입을 사람이 읽을 말로 바꿉니다."""
    if ann in TYPE_NAMES:
        return TYPE_NAMES[ann]
    args = getattr(ann, "__args__", None)
    if args:
        # Literal["가","나"] -> 고를 수 있는 값을 그대로 보여줍니다.
        if all(isinstance(a, str) for a in args):
            return "다음 중 하나: " + " / ".join(f'"{a}"' for a in args)
        # list[UspItem] -> 항목 설명은 따로 적으므로 이름만.
        if getattr(ann, "__origin__", None) is list:
            return f"{type_label(args[0])} 배열"
        # str | None 같은 조합
        return " 또는 ".join(type_label(a) for a in args)
    return getattr(ann, "__name__", str(ann))


def field_lines(model, indent="  ") -> list[str]:
    """스키마의 각 칸을 '이름 (타입): 설명' 형태로 풀어 씁니다."""
    return [f"{indent}- {name} ({type_label(f.annotation)})\n{indent}    {f.description}"
            for name, f in model.model_fields.items()]


def cmd_prompt(args) -> None:
    n = args.count
    print(f"""아래 작업을 해줘.

[대상]
지금 열려 있는 쿠팡 상품 상세페이지{"들" if n != 1 else ""}. 총 {n}개.

[먼저 할 일]
각 페이지마다 **맨 아래까지 끝까지 스크롤**해서 모든 이미지가 불러와지게 해.
쿠팡 상세 이미지는 화면에 보여야 로딩되기 때문에, 스크롤하지 않으면 내용이 비어 있어.

[역할]
{SYSTEM_PROMPT.strip()}

[출력 형식]
제품 하나당 객체 하나씩, JSON 배열로만 출력해. 설명 문장은 붙이지 마.
각 객체는 아래 칸을 모두 가져야 해.

{chr(10).join(field_lines(DetailPageInfo))}

  usps 배열의 각 항목은 아래 칸을 모두 가져야 해.

{chr(10).join(field_lines(UspItem, indent="    "))}

  추가로 각 객체에 "file" 칸을 넣고, 그 제품을 알아볼 수 있는 이름을 적어줘
  (예: "액츠_캡슐세제"). 나중에 결과를 맞춰보는 데 쓴다.

[주의]
- 값이 정해져 있는 칸은 반드시 그 목록 안에서 골라. 다른 말을 지어내면 안 된다.
- evidence는 페이지에 적힌 문구 그대로. 요약하지 마라.
- 확인할 수 없는 칸은 null로 두고, 왜 못 봤는지 notes에 적어라.
""")


# ------------------------------------------------------------
# 3. targets - 어느 제품의 상세페이지를 볼지 데이터로 고르기
# ------------------------------------------------------------
# 전수조사하지 않는 이유: 150개를 다 뽑으면 대부분 쓸 데 없는 데이터가 되고
# 사람 시간도 많이 듭니다. 썸네일 분석이 "어디를 봐야 하는지"를 이미 알려주므로,
# 질문에 답하는 데 필요한 제품만 고릅니다.
#
# 우리가 답해야 하는 질문은 두 갈래입니다.
#   (1) 싸게 파는 제품들은 무엇으로 설득하나  -> 우리가 반드시 말해야 하는 것
#   (2) 비싼데도 잘 팔리는 제품은 왜 값을 받나 -> 우리가 포기하는 것 / 싸게 흉내낼 것
# 그래서 카테고리마다 '단가 최저군'과 '상위권 고가군'을 함께 고릅니다.
#
# 제품명을 사람이 옮겨 적다 빠뜨리는 것을 막기 위해, 지시문에 목록을 전부 채워
# 내보냅니다(자리표시자를 남기면 그대로 붙여넣게 됩니다).

def load_extracted(folder: Path) -> dict[str, list[dict]]:
    """썸네일 추출 결과(카테고리별 JSON)를 읽어 카테고리 -> 행 목록으로 돌려줍니다."""
    if not folder.is_dir():
        sys.exit(f"추출 결과 폴더를 찾을 수 없습니다: {folder}")
    out = {}
    for path in sorted(folder.glob("*.json")):
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            sys.exit(f"{path.name} 을 읽을 수 없습니다: {e}")
        if isinstance(rows, list) and rows:
            out[path.stem] = rows
    if not out:
        sys.exit(f"{folder} 안에 추출 결과 JSON이 없습니다")
    return out


def item_id(cat: str, r: dict) -> str:
    """전수조사를 이어서 하기 위한 안정된 식별자.

    제품명으로는 안 된다. 같은 카테고리에 제품명이 똑같고 가격만 다른 옵션이
    실제로 있다(스너글 섬유탈취제, 프릴 주방세제). 추출 원본의 파일명은
    카테고리별로 01~25로 고유하므로 이것을 쓴다. 원본 캡처까지 거슬러 갈 수도 있다.
    """
    stem = str(r.get("file") or "").rsplit(".", 1)[0] or "00"
    return f"{cat}-{stem}"


def with_unit_price(rows: list[dict], cat: str = "") -> list[dict]:
    """단가·순위를 계산해 붙입니다. 계산은 썸네일 도구의 함수를 그대로 씁니다."""
    import analyze_thumbnails as at

    out = []
    for r in rows:
        cap, unit = at.parse_capacity(r.get("capacity_text") or "")
        cnt = at.parse_composition_count(r.get("composition_text") or "") or 1
        price = r.get("price_krw")
        if not cap or not price:
            continue
        scale, basis = at.unit_price_basis(unit)
        out.append({
            **r,
            "_id": item_id(cat, r),
            "_total": cap * cnt,
            "_unit_price": round(price / (cap * cnt) * scale, 1),
            "_basis": basis,
            "_rank": at.parse_category_rank(r.get("category_rank_text") or "") or 999,
            "_search": at.coupang_search_url(r.get("product_name"), r.get("brand")),
        })
    return out


def load_specs(path: Path) -> list[dict]:
    """생산 스펙(견적요청서 데이터)을 읽습니다. 없으면 빈 목록.

    이 파일이 있으면 '우리 직접 경쟁자'를 우리가 실제로 만들려는 형태·규격군
    안에서 고를 수 있습니다. 없으면 카테고리 전체에서 가장 싼 것을 고릅니다
    (형태를 벗어난 제품이 섞일 수 있으니, 되도록 스펙 파일을 두는 편이 좋습니다).
    """
    if not path or not Path(path).is_file():
        return []
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"{path} 을 읽을 수 없습니다: {e}")
    return data.get("specs", []) if isinstance(data, dict) else []


def in_spec(r: dict, spec: dict) -> bool:
    """이 제품이 그 생산 스펙과 같은 형태·규격군에 속하는지."""
    if r.get("product_form") != spec.get("form"):
        return False
    total = r["_total"]
    if spec.get("minTotal") and total < spec["minTotal"]:
        return False
    if spec.get("maxTotal") and total > spec["maxTotal"]:
        return False
    return True


def pick_targets(rows: list[dict], specs: list[dict], cat: str,
                 cheap: int, premium: int, top_rank: int) -> list[dict]:
    """직접 경쟁자(우리 스펙과 같은 형태·규격군의 최저가) + 상위권 고가 제품.

    저가군을 카테고리 전체가 아니라 '우리가 만들려는 형태' 안에서 고르는 이유:
    형태가 다르면 가격 구조가 달라 경쟁 상대가 아니다. 섬유탈취제를 용기로
    만드는데 파우치 최저가의 소구점을 참고하면 엉뚱한 결론이 나온다.
    """
    rows = with_unit_price(rows, cat)
    picked, seen = [], set()

    def add(r, why):
        key = (r.get("brand"), r.get("product_name"), r.get("price_krw"))
        if key in seen:
            return False
        seen.add(key)
        picked.append({**r, "_why": why})
        return True

    mine = [sp for sp in specs if sp.get("cat") == cat]
    if mine:
        for sp in mine:
            pool = sorted((r for r in rows if in_spec(r, sp)),
                          key=lambda r: r["_unit_price"])
            label = sp["form"] + (f"/{sp['label']}" if sp.get("label") else "")
            n = 0
            for r in pool:
                if n >= cheap:
                    break
                if add(r, f"경쟁 {label}"):
                    n += 1
    else:
        # 스펙 정보가 없으면 카테고리 전체에서 가장 싼 것으로 대체한다
        for r in sorted(rows, key=lambda r: r["_unit_price"])[:cheap]:
            add(r, "경쟁 (형태 미지정)")

    # 상위권 중에서 단가가 비싼 쪽 - '비싼데도 잘 팔리는' 제품
    top = [r for r in rows if r["_rank"] <= top_rank]
    n = 0
    for r in sorted(top, key=lambda r: -r["_unit_price"]):
        if n >= premium:
            break
        if add(r, "고가 상위권"):
            n += 1
    return picked


def done_ids(path: str | None) -> tuple[set[str], list[str]]:
    """이미 수집한 항목의 ID를 누적 USP 엑셀에서 읽습니다.

    진행 상황을 따로 파일에 적지 않는 이유: 상태 파일과 실제 결과가 어긋나면
    무엇이 맞는지 알 수 없게 된다. 결과물 자체를 상태로 쓰면 어긋날 일이 없다
    (썸네일 도구가 엑셀에 이어붙이는 것과 같은 방식).
    """
    if not path:
        return set(), []
    f = Path(path)
    if not f.is_file():
        return set(), []
    try:
        df = pd.read_excel(f, sheet_name="제품별요약")
    except Exception as e:
        sys.exit(f"{f} 에서 제품별요약 시트를 읽을 수 없습니다: {e}")
    if "원본파일명" not in df.columns:
        sys.exit(f"{f} 의 제품별요약 시트에 '원본파일명' 칸이 없습니다")
    ids = [str(v).strip() for v in df["원본파일명"].dropna()]
    return set(ids), ids


def cmd_targets(args) -> None:
    data = load_extracted(Path(args.extracted))
    specs = load_specs(Path(args.specs)) if args.specs else []
    cats = args.category or list(data.keys())
    unknown = [c for c in cats if c not in data]
    if unknown:
        sys.exit(f"추출 결과에 없는 카테고리: {', '.join(unknown)}\n"
                 f"  사용 가능: {', '.join(data.keys())}")

    if args.all:
        # 전수조사. USP는 가격·판매량과 무관하게 제품마다 다른 소구점이 있으므로
        # 어느 제품이 쓸모 있는지 미리 알 수 없다. 그래서 전부 본다.
        selected = [(cat, r) for cat in cats
                    for r in sorted(with_unit_price(data[cat], cat),
                                    key=lambda r: r["_id"])]
        mode = "전수조사"
    else:
        selected = [(cat, r) for cat in cats
                    for r in pick_targets(data[cat], specs, cat,
                                          args.cheap, args.premium, args.top_rank)]
        mode = "표본(테스트용)"

    done, done_list = done_ids(args.done)
    known = {r["_id"] for _, r in selected}
    stray = [i for i in sorted(done) if i not in known]
    remaining = [(cat, r) for cat, r in selected if r["_id"] not in done]

    print("=" * 76)
    print(f"USP 수집 대상 - {mode}")
    print(f"  전체 {len(selected)}개", end="")
    if args.done:
        print(f" / 완료 {len(selected) - len(remaining)}개 / 남음 {len(remaining)}개")
    else:
        print()
    if not args.all:
        print("  저가군은 생산 스펙과 같은 형태·규격군 안에서 골랐습니다"
              if specs else "  생산 스펙 파일이 없어 카테고리 전체에서 골랐습니다")
        print("  전수조사로 돌리려면 --all 을 붙이세요")
    print("=" * 76)
    if stray:
        print(f"\n참고: 완료 목록에 있으나 대상에 없는 ID {len(stray)}개 - "
              f"{', '.join(stray[:6])}{' ...' if len(stray) > 6 else ''}")
        print("  (카테고리를 좁혀서 돌렸거나, 브라우저가 ID를 다르게 적었을 수 있습니다)")
    if len(done_list) != len(set(done_list)):
        dups = [i for i in set(done_list) if done_list.count(i) > 1]
        print(f"\n주의: 완료 목록에 같은 ID가 두 번 이상 있습니다 - {', '.join(sorted(dups)[:6])}")
        print("  같은 제품을 두 번 수집했을 수 있으니 엑셀을 확인하세요")

    if not remaining:
        print("\n남은 항목이 없습니다. 수집이 끝났습니다.")
        return

    batch = remaining if args.batch <= 0 else remaining[:args.batch]
    cur = None
    for cat, r in batch:
        if cat != cur:
            print(f"\n[{cat}]")
            cur = cat
        rank = "-" if r["_rank"] == 999 else f"{r['_rank']}위"
        why = f"  {r['_why']:14}" if r.get("_why") else "  "
        print(f"{why}{r['_id']:14} {rank:>5}  {(r.get('brand') or '브랜드 미상'):12} "
              f"{r['_unit_price']:>8.1f} {r['_basis']:9} {r.get('price_krw'):>7,}원")
        print(f"      {r.get('product_name')}")

    print("\n" + "=" * 76)
    if args.batch > 0 and len(remaining) > len(batch):
        print(f"이번 묶음 {len(batch)}개 (남은 {len(remaining)}개 중). "
              f"결과를 build 로 넣은 뒤 같은 명령을 다시 실행하면 다음 묶음이 나옵니다")
    else:
        print(f"이번 묶음 {len(batch)}개")
    print("아래부터 브라우저(Claude in Chrome 등)에 그대로 붙여넣으세요")
    print("=" * 76 + "\n")
    print(browser_prompt(batch, args.pace))


def browser_prompt(selected: list[tuple[str, dict]], pace: int) -> str:
    lines = [
        "아래 쿠팡 상품들의 상세페이지를 열어서 판매자가 내세우는 소구점(USP)을 뽑아줘.",
        "",
        "[대상 상품]",
    ]
    for i, (cat, r) in enumerate(selected, 1):
        name = r.get("product_name") or "(제품명 미상)"
        brand = (r.get("brand") or "").strip()
        # 쿠팡 제품명에 브랜드가 빠져 있는 경우가 많다. 브랜드를 앞에 붙여야
        # 검색 결과에서 맞는 상품을 골라낼 수 있다.
        head = name if (not brand or brand in name) else f"{brand} / {name}"
        lines.append(f"{i}. [{r['_id']}] {head}")
        # 용량·가격은 같은 이름의 다른 옵션을 열지 않게 하는 확인용 정보다.
        cap = r.get("capacity_text") or ""
        comp = r.get("composition_text") or ""
        size = f"{cap} x {comp}" if comp and comp not in ("1개", "") else cap
        rank = "" if r["_rank"] == 999 else f" / 카테고리 {r['_rank']}위"
        lines.append(f"   확인용 - 규격 {size} / 조사 시점 판매가 "
                     f"{r.get('price_krw'):,}원{rank}")
        if r.get("product_url"):
            lines.append(f"   {r['product_url']}")
        elif r.get("_search"):
            lines.append(f"   {r['_search']}")
    lines += [
        "",
        "[각 상품마다 먼저 할 일]",
        "상세페이지를 **맨 아래까지 끝까지 스크롤**해. 쿠팡 상세 이미지는 화면에 보여야",
        "불러와지기 때문에, 스크롤하지 않으면 내용이 비어 있어서 아무것도 못 읽는다.",
        "",
        "[역할]",
        SYSTEM_PROMPT.strip(),
        "",
        "[출력 형식]",
        "상품 하나당 객체 하나씩, JSON 배열로만 출력해. 설명 문장은 붙이지 마.",
        "각 객체는 아래 칸을 모두 가져야 해.",
        "",
        *field_lines(DetailPageInfo),
        "",
        "  usps 배열의 각 항목은 아래 칸을 모두 가져야 해.",
        "",
        *field_lines(UspItem, indent="    "),
        "",
        '  추가로 각 객체에 "file" 칸을 넣고, 위 목록 대괄호 안의 ID를 **그대로** 적어줘',
        '  (예: "세탁세제-09"). 이 ID로 어디까지 수집했는지 추적하니, 임의로 바꾸거나',
        '  제품명으로 대체하면 안 된다.',
    ]
    if pace and len(selected) > pace:
        lines += [
            "",
            "[진행 방식]",
            f"한 번에 다 하지 말고 {pace}개씩 묶어서 진행해. 묶음을 마칠 때마다 그때까지의",
            "JSON을 먼저 출력하고, 그다음 묶음으로 넘어가. 중간에 끊겨도 앞의 결과는",
            "남아야 하기 때문이다. 상품과 상품 사이에는 잠깐 쉬어라.",
        ]
    lines += [
        "",
        "[주의]",
        "- 값이 정해져 있는 칸은 반드시 그 목록 안에서 골라. 다른 말을 지어내면 안 된다.",
        "- evidence는 페이지에 적힌 문구 그대로. 요약하지 마라.",
        "- 확인할 수 없는 칸은 null로 두고, 왜 못 봤는지 notes에 적어라.",
        "- 검색해서 열었을 때 상품이 여럿 나오면, 위의 '확인용' 규격과 브랜드가 맞는 것을 골라라.",
        "- 판매가는 조사 시점(2026-09-21) 기준이라 지금은 다를 수 있다. 가격이 다르더라도",
        "  브랜드와 규격이 맞으면 그 상품이다. 규격이 다른 옵션을 열었으면 notes에 적어라.",
        "- 목록의 상품을 찾을 수 없으면 비슷한 걸 대신 넣지 말고, 그 번호는 건너뛰고 notes에 적어라.",
    ]
    return "\n".join(lines)


# ------------------------------------------------------------
# 3. inventory - 캡처 파일 확인
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
# 4. build - 검증 + 집계 + 엑셀
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

    out_path = Path(args.output)
    if str(out_path.parent) not in ("", "."):
        out_path.parent.mkdir(parents=True, exist_ok=True)

    # 기존 파일이 있으면 이어붙입니다 (누적 데이터베이스처럼 사용).
    # 150개를 여러 묶음에 걸쳐 나눠 수집하므로 덮어쓰면 앞 묶음이 통째로 날아갑니다.
    # 진행 상황을 이 엑셀에서 읽어(targets --done) 다음 묶음을 정하기 때문에,
    # 덮어쓰기는 "일부만 수집된 결과를 전부인 줄 알고 받는" 최악의 실패가 됩니다.
    if out_path.exists():
        try:
            old_products = pd.read_excel(out_path, sheet_name="제품별요약")
            old_usps = pd.read_excel(out_path, sheet_name="USP전체")
        except Exception as e:
            sys.exit(f"기존 파일을 읽을 수 없어 이어붙일 수 없습니다: {out_path}\n  {e}\n"
                     f"  덮어쓰면 기존 결과가 사라지므로 중단합니다. "
                     f"다른 --output 경로를 쓰거나 파일을 확인하세요.")
        # 같은 제품을 두 번 넣은 경우, 나중 것으로 바꿉니다(재수집 = 수정 의도).
        again = set(products["원본파일명"]) & set(old_products["원본파일명"])
        if again:
            print(f"이미 있던 {len(again)}건을 새 결과로 교체: "
                  f"{', '.join(sorted(again)[:6])}{' ...' if len(again) > 6 else ''}")
            old_products = old_products[~old_products["원본파일명"].isin(again)]
            old_usps = old_usps[~old_usps["원본파일명"].isin(again)]
        products = pd.concat([old_products, products], ignore_index=True)
        usps = pd.concat([old_usps, usps], ignore_index=True)
        print(f"기존 파일에 이어붙임: 제품 {len(products)}건 / USP {len(usps)}건")

    # 유형별 빈도 - 이 카테고리에서 무엇이 표준 소구점인지 드러납니다.
    # 누적된 전체를 기준으로 다시 계산합니다.
    by_kind = (usps.groupby("유형")
               .agg(등장수=("소구점", "size"),
                    제품수=("제품명", "nunique"),
                    상단배치=("위치", lambda s: (s == "상단").sum()),
                    강조=("강조도", lambda s: (s == "강조").sum()))
               .sort_values("등장수", ascending=False).reset_index()
               if not usps.empty else pd.DataFrame())

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
# 5. 명령 정의
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="상세페이지 USP 분석 → 엑셀 출력")
    sub = parser.add_subparsers(dest="command", required=True)

    p_prompt = sub.add_parser("prompt",
                              help="브라우저 등 다른 곳에 붙여넣을 추출 지시문 출력")
    p_prompt.add_argument("--count", type=int, default=1, help="한 번에 분석할 제품 수")
    p_prompt.set_defaults(func=cmd_prompt)

    p_tg = sub.add_parser("targets",
                          help="썸네일 분석 결과에서 상세페이지를 볼 제품을 고르고 지시문 생성")
    p_tg.add_argument("--extracted", default=str(Path(__file__).parent.parent / "data" / "extracted"),
                      help="썸네일 추출 결과 JSON 폴더 (기본: ../data/extracted)")
    p_tg.add_argument("--category", nargs="*", default=None,
                      help="대상 카테고리 (기본: 전체)")
    p_tg.add_argument("--specs",
                      default=str(Path(__file__).parent.parent / "문서생성" / "견적요청서_데이터.json"),
                      help="생산 스펙 JSON. 있으면 저가군을 그 형태·규격군 안에서 고른다")
    p_tg.add_argument("--cheap", type=int, default=1,
                      help="생산 스펙당 직접 경쟁자 개수 (기본 1)")
    p_tg.add_argument("--premium", type=int, default=1,
                      help="카테고리당 상위권 고가군 개수 (기본 1)")
    p_tg.add_argument("--top-rank", type=int, default=10,
                      help="'상위권'으로 볼 순위 상한 (기본 10위)")
    p_tg.add_argument("--all", action="store_true",
                      help="전수조사. 표본 선정 없이 카테고리의 모든 제품을 대상으로 한다")
    p_tg.add_argument("--batch", type=int, default=0,
                      help="한 번에 내보낼 개수 (0이면 남은 전부). 전수조사 시 10~15 권장")
    p_tg.add_argument("--done", default=None,
                      help="누적 USP 엑셀. 이미 수집한 항목을 빼고 다음 묶음만 내보낸다")
    p_tg.add_argument("--pace", type=int, default=3,
                      help="브라우저에서 몇 개씩 묶어 진행할지 (0이면 지시 없음)")
    p_tg.set_defaults(func=cmd_targets)

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
