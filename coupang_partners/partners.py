#!/usr/bin/env python3
"""쿠팡 파트너스 API 클라이언트.

표준 라이브러리만 쓴다. 설치할 것 없음.

키는 환경변수에서 읽는다. 코드에도 저장소에도 키를 적지 않는다.
    COUPANG_ACCESS_KEY
    COUPANG_SECRET_KEY

쓰는 법:
    python3 partners.py probe "어린이 치약"
        -> 1회만 호출하고 응답 원문을 그대로 보여준다.
           productId / productUrl 이 실제로 어떤 모양인지 눈으로 확인하는 용도.

    python3 partners.py measure
        -> 429(한도초과)가 뜰 때까지 호출해서 "진짜 시간당 몇 회인지" 직접 잰다.
           블로그 숫자 말고 우리 계정의 실제 한도를 확인하는 용도.
"""
import hashlib
import hmac
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from time import gmtime, strftime

DOMAIN = "https://api-gateway.coupang.com"
SEARCH_PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/search"


def _keys():
    ak = os.environ.get("COUPANG_ACCESS_KEY")
    sk = os.environ.get("COUPANG_SECRET_KEY")
    if not ak or not sk:
        sys.exit(
            "키가 없습니다. 환경변수 COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 를 설정하세요.\n"
            "채팅창에 키를 붙여넣지 마세요 — 환경 설정에 넣으면 됩니다."
        )
    return ak, sk


def _auth(method, url_with_query, access_key, secret_key):
    """CEA HMAC-SHA256 서명. url_with_query 는 도메인 뺀 경로+쿼리."""
    path, _, query = url_with_query.partition("?")
    stamp = strftime("%y%m%d", gmtime()) + "T" + strftime("%H%M%S", gmtime()) + "Z"
    message = stamp + method + path + query
    signature = hmac.new(
        secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return (
        f"CEA algorithm=HmacSHA256, access-key={access_key}, "
        f"signed-date={stamp}, signature={signature}"
    )


def search(keyword, limit=10):
    """키워드 1건 검색. 반환: (http상태, 파싱된 본문 또는 원문문자열)"""
    ak, sk = _keys()
    query = urllib.parse.urlencode({"keyword": keyword, "limit": limit})
    rel = f"{SEARCH_PATH}?{query}"
    req = urllib.request.Request(
        DOMAIN + rel,
        method="GET",
        headers={
            "Authorization": _auth("GET", rel, ak, sk),
            "Content-Type": "application/json;charset=UTF-8",
        },
    )
    ctx = ssl.create_default_context()
    bundle = "/root/.ccr/ca-bundle.crt"
    if os.path.exists(bundle):
        ctx.load_verify_locations(bundle)
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            body = r.read().decode("utf-8")
            return r.status, json.loads(body)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # 네트워크 등
        return 0, f"{type(e).__name__}: {e}"


def cmd_probe(keyword):
    status, body = search(keyword, limit=10)
    print(f"HTTP {status}")
    if isinstance(body, dict):
        print(json.dumps(body, ensure_ascii=False, indent=2))
        items = (body.get("data") or {}).get("productData") or []
        print(f"\n--- 요약: {len(items)}건 ---")
        for it in items:
            pid = it.get("productId")
            print(f"  productId={pid}")
            print(f"  productUrl={it.get('productUrl')}")
            print(f"  조립한주소=https://www.coupang.com/vp/products/{pid}")
            print(f"  {it.get('productName')}  {it.get('productPrice')}원")
            print()
    else:
        print(body)


def cmd_measure(keyword="치약", cap=40, gap=3):
    """429가 뜰 때까지 호출해서 실제 한도를 잰다."""
    ok = 0
    for i in range(1, cap + 1):
        status, body = search(f"{keyword} {i}", limit=1)
        if status == 200:
            ok += 1
            print(f"{i:>3}회차  200 OK   (누적 성공 {ok})")
        else:
            print(f"{i:>3}회차  {status}  <- 여기서 막힘")
            print(f"       응답: {str(body)[:300]}")
            print(f"\n실제 한도: 연속 {ok}회 성공 후 차단")
            return
        time.sleep(gap)
    print(f"\n{cap}회까지 안 막힘. 한도가 {cap}회보다 높습니다.")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
    elif args[0] == "probe":
        cmd_probe(args[1] if len(args) > 1 else "어린이 치약")
    elif args[0] == "measure":
        cmd_measure(*args[1:])
    else:
        print(__doc__)
