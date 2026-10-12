#!/usr/bin/env python3
"""data/순위/<카테고리>.json 에서 확장프로그램용 검색목록을 만든다.

size / count 는 **직접 적지 않고 쿠팡 제목에서 뽑는다.**

왜 그래야 하나: 확장의 hasSpec() 은 적어 둔 규격 문자열이 쿠팡 제목 안에
글자 그대로 있는지를 본다. 우리가 "4개입 1세트" 처럼 보기 좋게 적어 두면
제목에는 그런 토막이 없으니 '구성 불일치'가 되어 멀쩡한 것이 '애매'로 떨어진다.
제목에서 뽑으면 애초에 어긋날 수가 없다.

제목에 규격이 아예 없는 상품(예: 티타드)은 size/count 를 비워 둔다.
비워 두면 hasSpec 이 null(=알 수 없음)을 돌려주고, 확장은 이름만으로 판단한다.
없는 걸 '불일치'로 치는 것과 '모름'으로 치는 것은 전혀 다르다.
"""
import json
import re
import sys

SIZE = re.compile(r"^[\d.]+\s*(?:g|kg|ml|l|매|정)$", re.I)
COUNT = re.compile(r"^\d+\s*(?:개입|개|세트|팩|박스)$")


def split_title(title):
    parts = [p.strip() for p in title.split(",")]
    name = parts[0]
    size = count = None
    for p in parts[1:]:
        if SIZE.match(p):
            size = p
        elif COUNT.match(p):
            count = p          # 마지막 것이 남는다 (…, 1개입, 4개 -> "4개")
    return name, size, count


def build(cat):
    src = f"data/순위/{cat}.json"
    d = json.load(open(src, encoding="utf-8"))
    out = []
    for x in sorted(d["제품"], key=lambda z: z["순위"]):
        name, size, count = split_title(x["제품명"])
        out.append({
            "id": f"{cat}-{x['순위']:02d}",
            "cat": cat,
            "brand": x["브랜드명"],
            "name": name,
            "query": name,
            "price": x["판매가"],
            "size": size,
            "count": count,
            "listName": d.get("랭킹명", cat),
        })
    return out


if __name__ == "__main__":
    cats = sys.argv[1:] or ["유아치약"]
    items = []
    for c in cats:
        items += build(c)
    dst = "coupang_extension/search_list.json"
    json.dump(items, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{dst} <- {len(items)}건")
    miss = [i for i in items if not i["size"]]
    for i in items:
        print(f"  {i['id']}  size={i['size'] or '(없음)':>7}  count={i['count'] or '(없음)':>6}  {i['name']}")
    if miss:
        print(f"\n제목에 용량이 없는 것 {len(miss)}건 — 이름만으로 판단합니다: "
              + ", ".join(i["id"] for i in miss))
