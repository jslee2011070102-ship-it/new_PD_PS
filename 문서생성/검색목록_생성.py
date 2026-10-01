# -*- coding: utf-8 -*-
"""엑셀에서 '쿠팡URL이 아직 없는 제품'만 뽑아 검색 목록을 만든다.

왜 이게 필요한가
----------------
URL 취합이 병목이다. 275개 중 121개만 URL이 있고 154개가 비어 있다.
손으로 검색해서 주소를 복사하면 한 건에 30초만 잡아도 1시간이 넘는다.

그런데 개발 환경에서는 쿠팡에 접속할 수 없다(403). 그래서 여기서 검색해
주소를 채워 넣을 수가 없고, **주소를 지어내는 것은 절대 안 된다** —
엉뚱한 제품으로 사람을 보내게 된다.

그래서 역할을 나눈다.
  - 여기(파이썬): 무엇을 찾아야 하는지 목록을 만든다. 기대 가격까지 함께 담는다.
  - 크롬 확장(사장님 브라우저): 실제로 검색하고 후보를 읽어 온다.
  - 다시 여기: 후보가 맞는지 이름·가격으로 채점해 확정한다.

기대 가격을 함께 싣는 이유가 핵심이다. 검색 결과 1등을 그냥 집으면
엉뚱한 제품이나 다른 용량을 집어도 알 수가 없다. 가격이 맞으면 거의 확실하고,
다르면 '애매'로 남겨 사람이 눈으로 보게 한다.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

PID_RE = re.compile(r"/v[pm]/products/(\d+)")


def has_url(v):
    return bool(v and isinstance(v, str) and PID_RE.search(v))


def build(xlsx_path, out_path):
    ws = openpyxl.load_workbook(xlsx_path, data_only=True)["전체"]
    hdr = [c.value for c in ws[1]]
    col = {name: i for i, name in enumerate(hdr)}

    need, done = [], 0
    for r in ws.iter_rows(min_row=2, values_only=True):
        cat = r[col["카테고리"]]
        if not cat:
            continue
        if has_url(r[col.get("쿠팡URL", -1)] if "쿠팡URL" in col else None):
            done += 1
            continue

        rank = r[col["순위"]]
        # 순위_원문 = "액체세제 구매 1위" -> "액체세제"
        # 이게 쿠팡에서 그 제품이 속한 목록 이름이다. 검색창에 칠 말로 그대로 쓴다.
        raw_rank = str(r[col["순위_원문"]] or "")
        list_name = re.sub(r"\s*구매\s*\d+\s*위\s*$", "", raw_rank).strip()
        name = (r[col["제품명"]] or "").strip()
        brand = (r[col["브랜드명"]] or "").strip()
        size = (r[col["용량_원문"]] or "").strip()
        cnt = (r[col["구성_원문"]] or "").strip()
        price = r[col["판매가(원)"]]

        need.append({
            "id": f"{cat}-{int(rank):02d}" if rank else f"{cat}-{len(need)+1:02d}",
            "cat": cat,
            "brand": brand,
            "name": name,
            # 검색어는 제품명 그대로 쓴다. 쿠팡 검색은 전체 이름에 잘 맞는다.
            "query": name,
            # 아래 셋이 '맞는 제품인지' 판정하는 근거다.
            "price": int(price) if price else None,
            "size": size,
            "count": cnt,
            # 이 제품이 쿠팡의 어느 목록에서 나왔는지. 확장이 "이걸 검색하세요"로 띄운다.
            "listName": list_name or cat,
        })

    Path(out_path).write_text(
        json.dumps(need, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"URL 이미 있음 : {done}개")
    print(f"찾아야 함     : {len(need)}개  ->  {out_path}")
    by = {}
    for x in need:
        by[x["cat"]] = by.get(x["cat"], 0) + 1
    for k, v in by.items():
        print(f"   {k:<8} {v}개")
    return need


if __name__ == "__main__":
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "검색목록.json"
    build(src, out)
