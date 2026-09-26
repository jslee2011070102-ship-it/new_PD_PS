#!/usr/bin/env python3
"""견적요청서에 들어갈 숫자를 data/extracted 추출 결과에서 계산해 JSON으로 내보낸다.

손으로 옮겨 적지 않는 이유: 판매가·원가·단가는 모두 서로 맞물린 값이라
한 곳을 고치면 나머지도 따라 바뀐다. 사람이 옮겨 적으면 반드시 어긋난다.

분류 원칙
  1) 본품/리필 같은 '역할'로 나누지 않고 '형태'(용기/파우치/말통)로만 나눈다.
     역할은 브랜드가 자기 라인업 안에서 붙이는 이름이라, 인지도가 다른 브랜드끼리
     1:1로 비교하면 "리필을 본품보다 비싸게 만들자" 같은 결론이 나온다.
     형태는 눈에 보이는 사실이라 브랜드와 무관하게 비교할 수 있다.
  2) 카테고리마다 형태별로 다 만들지 않고, 단위당 가격이 가장 싼 형태 하나만
     생산한다. 형태를 늘리면 비싼 형태는 가성비 제품으로 성립하지 않고, 용량이
     커질수록 실현 불가능한 원가가 나온다. 나머지 형태는 확장 후보로 둔다.
  3) 한 형태 안에 쓰임이 다른 규격군이 섞여 있으면 나눠서 각각 제안한다
     (살균소독제 말통 = 가정용 4L군 / 업소용 19~20L군).
"""
import json, glob, os, importlib.util, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    "at", os.path.join(ROOT, "thumbnail_analyzer", "analyze_thumbnails.py"))
at = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(at)

MARKUP = 3.5            # 목표 판매가 = 생산원가 x 3.5
TARGET_DISCOUNT = 0.95  # 가격대 최저가보다 5% 낮게
MIN_SAMPLE = 4          # 이보다 적으면 표본 부족으로 표시

# ── 단독 최저가 자동 제외를 폐기한 이유 ────────────────────────────────
# 처음에는 "다음 값보다 1.5배 이상 싸면 버린다"는 규칙을 뒀다. 섬유유연제에서
# 브랜드 표기가 없던 10L 6,890원이 시장에 없는 가격처럼 보였기 때문이다.
# 확인해보니 '리퀴드'라는 실재 브랜드였고, 같은 브랜드가 세탁세제 10L도 팔고
# 있어 가격이 서로 일관됐다. 유별나게 싼 값이 아니라 그 형태의 실제 최저가였다.
# 그 형태·그 가격에 파는 곳이 실제로 있으면 그것이 시장 가격이다.
# 그래서 비율로 걸러내지 않는다. 대신 브랜드가 식별되는 실제 판매 제품인지를
# 사람이 확인한다(브랜드 미상이면 추출 원본에서 먼저 확인할 것).

# ── 무게와 부피를 같은 선에서 비교하는 이유 ────────────────────────────
# 물리적으로는 다른 단위지만, 생활용품 시장은 g과 ml을 병행 표기하고 소비자도
# 100g당과 100ml당을 나란히 놓고 비교한다(주방세제 트리오 14kg가 그 예).
# 시장의 비교 방식을 따르는 것이 목적이므로 한 무리로 묶는다.
# 개수(캡슐세제의 1개당)는 성질이 달라 따로 둔다.
BASIS_MIXED = "100ml·100g당"


def basis_key(basis):
    """비교 가능한 무리를 나누는 열쇠. 부피와 무게는 한 무리, 개수는 별도."""
    return "count" if basis == "1개당" else "vm"


# 생산할 품목. label은 같은 형태를 규격군으로 나눌 때만 쓴다.
PLAN = [
    dict(cat="세탁세제", form="용기"),
    dict(cat="섬유유연제", form="용기"),
    dict(cat="캡슐세제", form="파우치"),
    dict(cat="섬유탈취제", form="용기"),
    dict(cat="주방세제", form="말통"),
    dict(cat="살균소독제", form="말통", label="가정용", max_total=8000,
         size_note="살균소독제 말통은 가정용 4L군과 업소용 19~20L군으로 갈립니다. "
                   "쓰임과 구매자가 다르므로 각각 제안합니다"),
    dict(cat="살균소독제", form="말통", label="업소용", min_total=19000,
         size_note="업소용 19~20L군입니다. 가정용 4L군과는 별개 시장으로 봅니다"),
]

FORMS = ["용기", "파우치", "말통", "기타"]


def load_rows():
    rows = []
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "extracted", "*.json"))):
        cat = os.path.basename(path)[:-5]
        for r in json.load(open(path, encoding="utf-8")):
            cap, unit = at.parse_capacity(r.get("capacity_text") or "")
            cnt = at.parse_composition_count(r.get("composition_text") or "") or 1
            if not cap or not r.get("price_krw"):
                continue
            total = cap * cnt
            scale, basis = at.unit_price_basis(unit)
            buyers = at.parse_monthly_buyers(r.get("monthly_buyers_text") or "")
            rows.append(dict(
                cat=cat, form=r["product_form"], role=r["product_role"],
                brand=r.get("brand") or "브랜드 미상", total=total, unit=unit, qty=cnt,
                cap_text=r.get("capacity_text"), comp_text=r.get("composition_text"),
                price=r["price_krw"], basis=basis, scale=scale,
                up=round(r["price_krw"] / total * scale, 1),
                rank=at.parse_category_rank(r.get("category_rank_text") or "") or 0,
                review=r.get("review_count") or 0,
                revenue=(buyers * r["price_krw"] * at.REVENUE_OPTION_MULTIPLIER) if buyers else 0,
            ))
    return rows


def comparable(group):
    """다수 기준(부피·무게 / 개수)만 남기고, 표시할 기준 이름을 함께 돌려준다."""
    if not group:
        return [], None
    key = collections.Counter(basis_key(r["basis"]) for r in group).most_common(1)[0][0]
    kept = [r for r in group if basis_key(r["basis"]) == key]
    labels = sorted({r["basis"] for r in kept})
    return kept, (labels[0] if len(labels) == 1 else BASIS_MIXED)


def spec_text(r):
    return f"{r['cap_text']} x {r['comp_text']}" if r["qty"] > 1 else str(r["cap_text"])


def build():
    rows = load_rows()
    cats = sorted({r["cat"] for r in rows})

    # 1) 카테고리별 형태 비교 — 왜 그 형태를 골랐는지의 근거
    compare = {}
    for cat in cats:
        entries = []
        for form in FORMS:
            g, basis = comparable([r for r in rows if r["cat"] == cat and r["form"] == form])
            if not g:
                if form != "기타":
                    entries.append(dict(form=form, n=0, floor=None, basis=None,
                                        revenue=0.0, thin=True))
                continue
            entries.append(dict(form=form, n=len(g), floor=min(r["up"] for r in g),
                                basis=basis, revenue=round(sum(r["revenue"] for r in g) / 1e8, 1),
                                thin=len(g) < MIN_SAMPLE))
        compare[cat] = entries

    # 2) 생산 스펙
    specs = []
    for plan in PLAN:
        g, basis = comparable([r for r in rows
                               if r["cat"] == plan["cat"] and r["form"] == plan["form"]])
        pool = g
        if plan.get("max_total"):
            pool = [r for r in pool if r["total"] <= plan["max_total"]]
        if plan.get("min_total"):
            pool = [r for r in pool if r["total"] >= plan["min_total"]]

        floor = min(r["up"] for r in pool)
        bench = min(pool, key=lambda r: r["up"])
        # 규격: 가격대 최저가 제품의 규격을 따른다. 단가가 5% 안에 있는 제품 중
        # 총량이 더 큰 규격이 있으면 그쪽(더 큰 묶음)을 택한다.
        cand = [r for r in pool if r["up"] <= floor * 1.05]
        target = max(cand, key=lambda r: r["total"])

        ordered = sorted(pool, key=lambda r: r["up"])
        # 최저가와 그 다음 제품의 격차. 크면 목표가가 시장 대다수보다 한참 아래라는
        # 뜻이므로 문서에서 그 사실을 밝힌다(공장이 원가를 오해하지 않도록).
        gap_ratio = round(ordered[1]["up"] / ordered[0]["up"], 1) if len(ordered) > 1 else None

        # 근거표: 싼 순으로 5개. 단위 기준이 섞인 무리라면 소수 기준(g 등) 제품도
        # 한 줄은 반드시 넣는다. 같은 선에서 비교했음을 보여주기 위함이다.
        ev = ordered[:5]
        if basis == BASIS_MIXED:
            shown = {r["basis"] for r in ev}
            for r in ordered:
                if r["basis"] not in shown:
                    ev = ev + [r]
                    shown.add(r["basis"])

        raw = floor * TARGET_DISCOUNT * target["total"] / target["scale"]
        price = int(round(raw / 100.0)) * 100          # 100원 단위로 정리
        unit = round(price / target["total"] * target["scale"], 1)
        cost = int(round(price / MARKUP))
        qty = target["qty"]

        specs.append(dict(
            cat=plan["cat"], form=plan["form"], label=plan.get("label"),
            # 규격군 경계를 결과에 남긴다. 상세페이지 분석(analyze_details.py targets)이
            # 이 값으로 '우리 직접 경쟁자'를 같은 규격군 안에서 고른다.
            minTotal=plan.get("min_total"), maxTotal=plan.get("max_total"),
            spec=spec_text(target), qty=qty,
            total=target["total"], unitOfMeasure=target["unit"],
            price=price, priceEach=int(round(price / qty)) if qty > 1 else None,
            cost=cost, costEach=int(round(cost / qty)) if qty > 1 else None,
            unit=unit, basis=basis,
            benchBrand=bench["brand"], benchRank=bench["rank"], benchUnit=bench["up"],
            benchSpec=spec_text(bench), benchPrice=bench["price"],
            benchDiff=round((unit / floor - 1) * 100, 1),
            market=round(sum(r["revenue"] for r in pool) / 1e8, 1),
            sampleN=len(pool), thin=len(pool) < MIN_SAMPLE,
            sizeNote=plan.get("size_note"),
            mixedBasis=basis == BASIS_MIXED,
            gapRatio=gap_ratio,
            evidence=[dict(rank=r["rank"], brand=r["brand"], spec=spec_text(r),
                           total=r["total"], price=r["price"], unit=r["up"],
                           basis=r["basis"], review=r["review"])
                      for r in ev],
        ))

    specs.sort(key=lambda s: -s["market"])

    # 3) 확장 후보 — 생산하지 않는 형태
    chosen = {}
    for s in specs:
        # 같은 카테고리에서 여러 규격군을 제안하면 가장 싼 쪽을 기준으로 삼는다
        cur = chosen.get(s["cat"])
        if cur is None or s["benchUnit"] < cur["benchUnit"]:
            chosen[s["cat"]] = s
    later = []
    for cat, base in chosen.items():
        for e in compare[cat]:
            if e["form"] == base["form"] or e["n"] == 0:
                continue
            later.append(dict(cat=cat, form=e["form"], n=e["n"], floor=e["floor"],
                              basis=e["basis"], thin=e["thin"], chosen=base["form"],
                              ratio=round(e["floor"] / base["benchUnit"], 1),
                              revenue=e["revenue"]))
    later.sort(key=lambda x: (x["thin"], -x["revenue"]))

    out = dict(
        meta=dict(markup=MARKUP, discount=TARGET_DISCOUNT, minSample=MIN_SAMPLE,
                  surveyDate="2026년 9월 21일", docDate="2026년 9월 26일",
                  sampleTotal=150, mixedBasisLabel=BASIS_MIXED),
        specs=specs, compare=compare, later=later,
    )
    path = os.path.join(HERE, "견적요청서_데이터.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"생성 완료: {path}  스펙 {len(specs)}종 / 확장후보 {len(later)}건")
    for s in specs:
        name = f"{s['cat']} {s['form']}" + (f"({s['label']})" if s["label"] else "")
        print(f"  {name:20} {s['spec']:14} {s['price']:>7,}원  {s['unit']:>8.1f} {s['basis']:12}"
              f" 원가 {s['cost']:>6,}원  기준 {s['benchBrand']}({s['benchUnit']}) {s['benchDiff']:+.1f}%"
              f"  시장 {s['market']}억  n={s['sampleN']}{'  표본부족' if s['thin'] else ''}")


if __name__ == "__main__":
    build()
