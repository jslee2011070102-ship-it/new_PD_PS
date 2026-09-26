#!/usr/bin/env python3
"""견적요청서에 들어갈 숫자를 data/extracted 추출 결과에서 계산해 JSON으로 내보낸다.

손으로 옮겨 적지 않는 이유: 판매가·원가·단가는 모두 서로 맞물린 값이라
한 곳을 고치면 나머지도 따라 바뀐다. 사람이 옮겨 적으면 반드시 어긋난다.

분류 원칙 (2026-09-26 변경):
  본품/리필 같은 '역할'로 나누지 않고 '형태'(용기/파우치/말통)로만 나눈다.
  역할은 브랜드가 자기 라인업 안에서 붙이는 이름이라, 인지도가 다른 브랜드끼리
  1:1로 비교하면 "리필을 본품보다 비싸게 만들자" 같은 결론이 나온다.
  형태는 눈에 보이는 사실이라 브랜드와 무관하게 비교할 수 있다.

  그리고 카테고리마다 형태별로 다 만들지 않고, 단위당 가격이 가장 싼 형태
  하나만 1순위로 생산한다. 형태를 늘리면 용량이 커질수록 실현 불가능한
  원가가 나오기 때문이다. 나머지 형태는 기능을 더해 확장하는 2순위로 둔다.
"""
import json, glob, os, importlib.util, collections, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    "at", os.path.join(ROOT, "thumbnail_analyzer", "analyze_thumbnails.py"))
at = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(at)

MARKUP = 3.5           # 목표 판매가 = 생산원가 x 3.5
TARGET_DISCOUNT = 0.95 # 가격대 최저가보다 5% 낮게
OUTLIER_GAP = 1.5      # 다음 값보다 이 배수 이상 싸면 단독 최저가로 보고 제외
MIN_SAMPLE = 4         # 이보다 적으면 '표본 부족'으로 제안에서 제외

# 카테고리별로 생산할 형태. 단위당 가격이 가장 싼 형태를 고른 결과다.
# max_total: 같은 형태 안에 성격이 다른 규격군이 섞여 있을 때 상한을 둔다.
PLAN = {
    "세탁세제":   dict(form="용기"),
    "주방세제":   dict(form="말통"),
    "캡슐세제":   dict(form="파우치"),
    "섬유유연제": dict(form="용기"),
    "섬유탈취제": dict(form="용기"),
    "살균소독제": dict(form="말통", max_total=8000,
                      size_note="같은 말통 안에 가정용 4L군과 업소용 19~20L군이 섞여 있어 "
                                "가정용 4L군만 비교 대상으로 삼았다"),
}


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
                brand=r.get("brand") or "무명", total=total, unit=unit, qty=cnt,
                cap_text=r.get("capacity_text"), comp_text=r.get("composition_text"),
                price=r["price_krw"], basis=basis, scale=scale,
                up=round(r["price_krw"] / total * scale, 1),
                rank=at.parse_category_rank(r.get("category_rank_text") or "") or 0,
                review=r.get("review_count") or 0,
                revenue=(buyers * r["price_krw"] * at.REVENUE_OPTION_MULTIPLIER) if buyers else 0,
            ))
    return rows


def main_basis(group):
    """한 무리 안에 100ml당과 100g당이 섞이면 비교가 안 되므로 다수 기준만 남긴다."""
    if not group:
        return group, None
    basis = collections.Counter(r["basis"] for r in group).most_common(1)[0][0]
    return [r for r in group if r["basis"] == basis], basis


def band_floor(values):
    """가격대의 최저가를 찾는다. 다음 값보다 1.5배 이상 싼 앞쪽 값은 버린다."""
    v = sorted(values)
    i = 0
    while i + 1 < len(v) and v[i + 1] / v[i] >= OUTLIER_GAP:
        i += 1
    return v[i], v[:i]


def spec_text(r):
    return f"{r['cap_text']} x {r['comp_text']}" if r["qty"] > 1 else str(r["cap_text"])


def summarize_form(rows, cat, form):
    g = [r for r in rows if r["cat"] == cat and r["form"] == form]
    g, basis = main_basis(g)
    if not g:
        return None
    floor, dropped = band_floor([r["up"] for r in g])
    return dict(form=form, n=len(g), basis=basis, floor=floor,
                dropped=len(dropped), rows=g,
                revenue=sum(r["revenue"] for r in g))


def build():
    rows = load_rows()
    cats = sorted({r["cat"] for r in rows})
    forms = ["용기", "파우치", "말통", "기타"]

    # 1) 카테고리별 형태 비교표 — 왜 그 형태를 골랐는지의 근거
    compare = {}
    for cat in cats:
        entries = []
        for form in forms:
            s = summarize_form(rows, cat, form)
            if s:
                entries.append(dict(form=form, n=s["n"], floor=s["floor"], basis=s["basis"],
                                    revenue=round(s["revenue"] / 1e8, 1),
                                    thin=s["n"] < MIN_SAMPLE))
            else:
                entries.append(dict(form=form, n=0, floor=None, basis=None, revenue=0.0, thin=True))
        compare[cat] = [e for e in entries if e["n"] > 0 or e["form"] != "기타"]

    # 2) 생산 스펙
    specs = []
    for cat, plan in PLAN.items():
        form = plan["form"]
        g = [r for r in rows if r["cat"] == cat and r["form"] == form]
        g, basis = main_basis(g)
        pool = [r for r in g if r["total"] <= plan["max_total"]] if plan.get("max_total") else g
        floor, dropped_vals = band_floor([r["up"] for r in pool])
        in_band = [r for r in pool if r["up"] >= floor]
        dropped = sorted([r for r in pool if r["up"] < floor], key=lambda r: r["up"])

        bench = min(in_band, key=lambda r: r["up"])
        # 규격: 가격대 최저가 제품의 규격을 따른다. 같은 밴드에서 총량이 더 큰
        # 규격이 단가 5% 안에 있으면 그쪽(더 큰 묶음)을 택한다.
        cand = [r for r in in_band if r["up"] <= floor * 1.05]
        target_spec = max(cand, key=lambda r: r["total"])

        scale = target_spec["scale"]
        raw = floor * TARGET_DISCOUNT * target_spec["total"] / scale
        price = int(round(raw / 100.0)) * 100          # 100원 단위로 정리
        unit = round(price / target_spec["total"] * scale, 1)
        cost = int(round(price / MARKUP))

        specs.append(dict(
            cat=cat, form=form,
            spec=spec_text(target_spec), qty=target_spec["qty"],
            total=target_spec["total"], unitOfMeasure=target_spec["unit"],
            price=price, priceEach=int(round(price / target_spec["qty"])) if target_spec["qty"] > 1 else None,
            cost=cost, costEach=int(round(cost / target_spec["qty"])) if target_spec["qty"] > 1 else None,
            unit=unit, basis=basis,
            benchBrand=bench["brand"], benchRank=bench["rank"], benchUnit=bench["up"],
            benchSpec=spec_text(bench), benchPrice=bench["price"],
            benchDiff=round((unit / floor - 1) * 100, 1),
            market=round(sum(r["revenue"] for r in pool) / 1e8, 1),
            sampleN=len(pool),
            sizeNote=plan.get("size_note"),
            excluded=[dict(brand=r["brand"], spec=spec_text(r), price=r["price"],
                           unit=r["up"], rank=r["rank"], review=r["review"]) for r in dropped],
            evidence=[dict(rank=r["rank"], brand=r["brand"], spec=spec_text(r),
                           total=r["total"], price=r["price"], unit=r["up"], review=r["review"])
                      for r in sorted(in_band, key=lambda r: r["up"])[:4]],
        ))

    specs.sort(key=lambda s: -s["market"])

    # 3) 확장 후보 (지금은 만들지 않는 형태)
    later = []
    for cat, plan in PLAN.items():
        chosen = plan["form"]
        for e in compare[cat]:
            if e["form"] == chosen or e["n"] == 0:
                continue
            base = next(x for x in compare[cat] if x["form"] == chosen)
            later.append(dict(cat=cat, form=e["form"], n=e["n"], floor=e["floor"],
                              basis=e["basis"], thin=e["thin"],
                              ratio=round(e["floor"] / base["floor"], 1),
                              chosen=chosen, revenue=e["revenue"]))
    later.sort(key=lambda x: (x["thin"], -x["revenue"]))

    out = dict(
        meta=dict(markup=MARKUP, discount=TARGET_DISCOUNT, outlierGap=OUTLIER_GAP,
                  minSample=MIN_SAMPLE, surveyDate="2026년 9월 21일",
                  docDate="2026년 9월 26일", sampleTotal=150),
        specs=specs, compare=compare, later=later,
    )
    path = os.path.join(HERE, "견적요청서_데이터.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"생성 완료: {path}  스펙 {len(specs)}종 / 확장후보 {len(later)}건")
    for s in specs:
        print(f"  {s['cat']:6} {s['form']:4} {s['spec']:16} {s['price']:>7,}원  "
              f"{s['unit']:>8.1f}{s['basis']:8} 원가 {s['cost']:>6,}원  "
              f"밴드대비 {s['benchDiff']:+.1f}%  시장 {s['market']}억  n={s['sampleN']}"
              f"{'  이상치제외 '+str(len(s['excluded'])) if s['excluded'] else ''}")


if __name__ == "__main__":
    build()
