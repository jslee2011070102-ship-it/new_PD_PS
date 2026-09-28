#!/usr/bin/env python3
"""쿠팡 상세페이지를 로컬 브라우저로 자동 캡처한다.

왜 로컬인가
-----------
쿠팡은 데이터센터 IP를 막는다(서버에서 접속하면 403). 반면 사람이 쓰는 PC의
브라우저는 막히지 않는다. 그래서 캡처만큼은 **사용자 PC에서 돌린다.**
이 스크립트는 사람이 손으로 하던 다음 네 가지를 대신한다.

  1) 제품명으로 쿠팡 검색
  2) 검색 결과에서 목표 상품을 골라 열기
  3) '더보기'를 눌러 상세를 펼치고 끝까지 스크롤(이미지 지연 로딩 때문에 필수)
  4) PDF 또는 이미지로 저장

분석(5단계)은 이 스크립트가 하지 않는다. 저장된 파일을
`thumbnail_analyzer/analyze_details.py` 쪽으로 넘기면 된다. 역할을 나눠둔 이유는
캡처가 실패하는 지점과 분석이 실패하는 지점이 완전히 다르기 때문이다. 한 덩어리로
만들면 무엇 때문에 멈췄는지 알 수 없다.

주의
----
- 쿠팡 이용약관은 자동 수집을 제한한다. 이 스크립트는 사용자 본인의 PC·브라우저로
  사람이 보는 속도(기본 상품당 20~40초)로 동작하도록 만들어져 있다. 사용 여부와
  범위에 대한 판단은 사용자가 한다. 속도를 올리지 말 것.
- 화면이 보이는 상태(headful)로 동작한다. 무엇을 하고 있는지 눈으로 보이는 편이
  중간에 막혔을 때 원인을 찾기 쉽다.
- 셀렉터(버튼을 찾는 규칙)는 쿠팡이 화면을 바꾸면 깨진다. 그래서 CSS 클래스명이
  아니라 **버튼에 적힌 글자**로 찾고, 후보를 여러 개 두고, 못 찾으면 조용히
  넘어가지 않고 그 사실을 기록한다.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
except ImportError:
    sys.exit("playwright가 설치되어 있지 않습니다.\n"
             "  pip install playwright\n"
             "  python -m playwright install chromium")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_PROFILE = HERE / ".browser_profile"
DEFAULT_OUT = HERE / "captures"

SEARCH_URL = "https://www.coupang.com/np/search?q={}"

# '더보기' 버튼 후보. 쿠팡이 문구를 바꿔도 하나는 걸리도록 여러 개를 둔다.
# 클래스명 대신 글자로 찾는 이유: 클래스명은 배포할 때마다 바뀌지만 글자는 덜 바뀐다.
EXPAND_TEXTS = ["상품정보 더보기", "상세정보 더보기", "더보기", "펼쳐보기", "전체보기"]

# 검색 결과에서 상품 링크를 찾는 후보
RESULT_LINK_SELECTORS = [
    "a[href*='/vp/products/']",
    "li.search-product a",
    "ul#productList li a",
]


# ────────────────────────────────────────────────────────────────
# 대상 목록
# ────────────────────────────────────────────────────────────────
def load_targets(path: Path, categories: list[str] | None) -> list[dict]:
    """썸네일 추출 결과(data/extracted)에서 캡처 대상을 만든다.

    항목 ID는 analyze_details.py와 같은 규칙(`카테고리-파일번호`)을 쓴다.
    두 도구가 같은 이름으로 같은 제품을 가리켜야 이어붙일 수 있다.
    """
    if not path.is_dir():
        sys.exit(f"추출 결과 폴더를 찾을 수 없습니다: {path}")
    out = []
    for f in sorted(path.glob("*.json")):
        cat = f.stem
        if categories and cat not in categories:
            continue
        for r in json.loads(f.read_text(encoding="utf-8")):
            stem = str(r.get("file") or "").rsplit(".", 1)[0] or "00"
            name = (r.get("product_name") or "").strip()
            brand = (r.get("brand") or "").strip()
            if not name:
                continue
            query = name if (not brand or brand in name) else f"{brand} {name}"
            out.append(dict(
                id=f"{cat}-{stem}", category=cat, brand=brand or None,
                product_name=name, query=query,
                capacity_text=r.get("capacity_text"),
                composition_text=r.get("composition_text"),
                price_krw=r.get("price_krw"),
                product_url=r.get("product_url"),
            ))
    if not out:
        sys.exit("대상이 없습니다. --category 를 확인하세요.")
    return out


# ────────────────────────────────────────────────────────────────
# 제목 대조
# ────────────────────────────────────────────────────────────────
def norm(s: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "", (s or "").lower())


def title_score(target: str, candidate: str) -> float:
    """검색 결과 제목이 목표 제품과 얼마나 겹치는지 (0~1).

    엉뚱한 상품을 열고도 모르는 것이 가장 나쁘므로, 점수를 기록해두고
    낮으면 경고한다. 사람이 나중에 확인할 수 있게 하기 위함이다.
    """
    a, b = norm(target), norm(candidate)
    if not a or not b:
        return 0.0
    # 목표 제품명을 2글자 단위로 쪼개 후보에 몇 개나 들어있는지 본다
    grams = {a[i:i + 2] for i in range(len(a) - 1)}
    if not grams:
        return 0.0
    hit = sum(1 for g in grams if g in b)
    return round(hit / len(grams), 3)


# ────────────────────────────────────────────────────────────────
# 페이지 조작
# ────────────────────────────────────────────────────────────────
def human_pause(lo: float, hi: float) -> None:
    time.sleep(random.uniform(lo, hi))


def click_expand(page, log: list[str]) -> bool:
    """'더보기'를 눌러 상세 영역을 펼친다. 눌렀으면 True."""
    for txt in EXPAND_TEXTS:
        try:
            loc = page.get_by_text(txt, exact=False)
            n = loc.count()
        except Exception:
            continue
        for i in range(min(n, 3)):
            item = loc.nth(i)
            try:
                if not item.is_visible():
                    continue
                item.scroll_into_view_if_needed(timeout=3000)
                human_pause(0.6, 1.4)
                item.click(timeout=3000)
                log.append(f"더보기 클릭: '{txt}'")
                human_pause(1.5, 3.0)
                return True
            except Exception:
                continue
    log.append("더보기 버튼을 찾지 못함 (이미 펼쳐져 있거나 문구가 바뀌었을 수 있음)")
    return False


def scroll_to_bottom(page, log: list[str], max_rounds: int = 120) -> int:
    """끝까지 스크롤해서 지연 로딩 이미지를 모두 불러온다.

    한 번에 맨 아래로 보내면 중간 이미지가 로딩되지 않는다. 화면 높이만큼씩
    내려가면서, 문서 높이가 더 이상 늘지 않을 때까지 반복한다.
    """
    last_h, stable = 0, 0
    for i in range(max_rounds):
        h = page.evaluate("document.body.scrollHeight")
        page.mouse.wheel(0, page.viewport_size["height"] * 0.85)
        human_pause(0.35, 0.75)
        if h == last_h:
            stable += 1
            if stable >= 4:      # 네 번 연속 높이가 그대로면 끝으로 본다
                log.append(f"스크롤 완료: {i + 1}회, 최종 높이 {h}px")
                page.evaluate("window.scrollTo(0, 0)")
                human_pause(1.0, 2.0)
                return h
        else:
            stable = 0
            last_h = h
    log.append(f"스크롤 상한({max_rounds}회) 도달. 페이지가 매우 길거나 무한 로딩일 수 있음")
    page.evaluate("window.scrollTo(0, 0)")
    return last_h


def save_pdf(page, out_file: Path, log: list[str]) -> bool:
    """CDP로 PDF 저장. 화면이 보이는 모드에서도 동작한다.

    page.pdf()는 headless에서만 되므로, CDP의 Page.printToPDF를 직접 쓴다.
    """
    try:
        import base64
        cdp = page.context.new_cdp_session(page)
        res = cdp.send("Page.printToPDF", {
            "printBackground": True,
            "preferCSSPageSize": False,
            "paperWidth": 8.27, "paperHeight": 11.69,   # A4
            "marginTop": 0.2, "marginBottom": 0.2,
            "marginLeft": 0.2, "marginRight": 0.2,
        })
        out_file.write_bytes(base64.b64decode(res["data"]))
        log.append(f"PDF 저장: {out_file.name} ({out_file.stat().st_size:,} bytes)")
        return True
    except Exception as e:
        log.append(f"PDF 저장 실패: {e}")
        return False


def save_slices(page, out_dir: Path, item_id: str, log: list[str],
                max_slices: int = 40) -> int:
    """화면 높이만큼 잘라가며 이미지로 저장한다.

    한 장짜리 전체 스크린샷은 페이지가 길면 브라우저 한계를 넘어 실패한다.
    상세페이지는 수만 픽셀이 되는 일이 흔해서 잘라 담는 편이 안전하다.
    """
    vh = page.viewport_size["height"]
    total = page.evaluate("document.body.scrollHeight")
    n = min(max_slices, max(1, -(-total // vh)))
    saved = 0
    for i in range(n):
        page.evaluate(f"window.scrollTo(0, {i * vh})")
        human_pause(0.4, 0.8)
        f = out_dir / f"{item_id}_{i + 1:02d}.png"
        try:
            page.screenshot(path=str(f))
            saved += 1
        except Exception as e:
            log.append(f"슬라이스 {i + 1} 저장 실패: {e}")
            break
    log.append(f"이미지 {saved}장 저장 (총 높이 {total}px)")
    page.evaluate("window.scrollTo(0, 0)")
    return saved


def find_product(page, target: dict, log: list[str]) -> tuple[str | None, str | None, float]:
    """검색 결과에서 목표 상품을 찾아 (url, 제목, 점수)를 돌려준다."""
    best = (None, None, 0.0)
    for sel in RESULT_LINK_SELECTORS:
        try:
            links = page.locator(sel)
            n = min(links.count(), 12)
        except Exception:
            continue
        for i in range(n):
            a = links.nth(i)
            try:
                href = a.get_attribute("href") or ""
                if "/vp/products/" not in href:
                    continue
                text = (a.inner_text(timeout=2000) or "").replace("\n", " ")
            except Exception:
                continue
            sc = title_score(target["product_name"], text)
            if sc > best[2]:
                url = href if href.startswith("http") else "https://www.coupang.com" + href
                best = (url, text.strip()[:160], sc)
        if best[0]:
            break
    if best[0]:
        log.append(f"검색 결과 선택: 일치도 {best[2]:.2f} / {best[1]}")
    else:
        log.append("검색 결과에서 상품 링크를 찾지 못함")
    return best


# ────────────────────────────────────────────────────────────────
# 브라우저
# ────────────────────────────────────────────────────────────────
def open_browser(pw, profile: Path, use_chrome: bool, headless: bool):
    profile.mkdir(parents=True, exist_ok=True)
    kw = dict(
        user_data_dir=str(profile),
        headless=headless,
        viewport={"width": 1440, "height": 1000},
        locale="ko-KR",
        timezone_id="Asia/Seoul",
        args=["--disable-blink-features=AutomationControlled"],
    )
    # 브라우저 실행 파일을 직접 지정할 수 있게 둔다.
    # playwright 버전과 설치된 브라우저 버전이 어긋나면 "Executable doesn't exist"로
    # 죽는데, 그때 재설치 대신 경로만 알려주면 된다. PC마다 Chrome 위치도 다르다.
    exe = os.environ.get("COUPANG_CHROME_PATH")
    if exe:
        kw["executable_path"] = exe
    elif use_chrome:
        kw["channel"] = "chrome"
    try:
        ctx = pw.chromium.launch_persistent_context(**kw)
    except Exception as e:
        if "Executable doesn't exist" in str(e):
            raise SystemExit(
                "브라우저 실행 파일을 찾지 못했습니다.\n"
                "  해결 1) python -m playwright install chromium\n"
                "  해결 2) 이미 설치된 Chrome 경로를 알려주기\n"
                "         Windows: set COUPANG_CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\n"
                "         Mac:     export COUPANG_CHROME_PATH=\"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\"\n"
                f"\n원본 오류: {e}") from None
        raise
    # navigator.webdriver 흔적 제거. 로그인 세션을 그대로 쓰는 일반 브라우저처럼 동작시킨다.
    ctx.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
    return ctx


def blocked(page) -> bool:
    """접근이 막혔는지 본다. 막힌 걸 모르고 빈 파일을 쌓는 것이 최악이다."""
    try:
        body = (page.inner_text("body", timeout=5000) or "")[:400]
    except Exception:
        return False
    marks = ["Access Denied", "비정상적인 접근", "접근이 차단", "Forbidden",
             "일시적으로 접속", "로봇이 아닙니다", "보안 문자"]
    return any(m in body for m in marks)


# ────────────────────────────────────────────────────────────────
# 명령
# ────────────────────────────────────────────────────────────────
def cmd_login(args) -> None:
    """브라우저를 열어두고 사람이 직접 로그인하게 한다. 세션은 프로필에 남는다."""
    with sync_playwright() as pw:
        ctx = open_browser(pw, Path(args.profile), args.chrome, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.coupang.com/", timeout=60000)
        print("브라우저를 열었습니다. 필요하면 로그인하세요.")
        print("끝나면 이 창에서 Enter를 누르세요. 로그인 상태는 프로필에 저장됩니다.")
        print(f"  프로필 위치: {Path(args.profile).resolve()}")
        try:
            input()
        except (EOFError, KeyboardInterrupt):
            pass
        ctx.close()
        print("저장했습니다.")


def cmd_probe(args) -> None:
    """상품 하나로 전 과정을 시험하고, 페이지에서 무엇을 찾았는지 그대로 보여준다.

    셀렉터가 깨졌을 때 추측으로 고치지 않기 위한 명령. 화면에서 실제로 보이는
    버튼 글자를 뽑아 보여주므로, EXPAND_TEXTS를 무엇으로 고쳐야 하는지 알 수 있다.
    """
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    log: list[str] = []
    with sync_playwright() as pw:
        ctx = open_browser(pw, Path(args.profile), args.chrome, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            url = args.url
            if not url:
                page.goto(SEARCH_URL.format(quote_plus(args.query)), timeout=60000)
                human_pause(2, 4)
                if blocked(page):
                    print("!! 검색 페이지에서 접근이 차단되었습니다.")
                    print("   login 명령으로 먼저 로그인해 보세요.")
                    ctx.close(); return
                url, title, sc = find_product(page, {"product_name": args.query}, log)
                if not url:
                    print("\n".join(log)); print("상품을 찾지 못했습니다."); ctx.close(); return
            page.goto(url, timeout=60000)
            human_pause(2, 4)
            if blocked(page):
                print("!! 상세페이지에서 접근이 차단되었습니다."); ctx.close(); return

            print("\n=== 페이지에서 보이는 버튼/링크 글자 (더보기 후보 찾기용) ===")
            try:
                texts = page.eval_on_selector_all(
                    "button, a, div[role=button], span",
                    "els => els.map(e => (e.innerText||'').trim())"
                    ".filter(t => t && t.length <= 20)")
                seen, shown = set(), 0
                for t in texts:
                    if t in seen:
                        continue
                    seen.add(t)
                    if any(k in t for k in ["더보기", "보기", "펼", "전체", "상세", "정보"]):
                        print(f"   {t!r}")
                        shown += 1
                    if shown >= 40:
                        break
            except Exception as e:
                print("   글자 수집 실패:", e)

            click_expand(page, log)
            h = scroll_to_bottom(page, log)
            stem = args.id or "probe"
            if args.format == "pdf":
                save_pdf(page, out / f"{stem}.pdf", log)
            else:
                save_slices(page, out, stem, log)
            print("\n=== 진행 기록 ===")
            for l in log:
                print("  " + l)
            print(f"\n최종 URL: {page.url}")
            print(f"저장 위치: {out.resolve()}")
        finally:
            if not args.keep_open:
                ctx.close()
            else:
                print("\n--keep-open: 브라우저를 열어둡니다. Enter로 종료.")
                try:
                    input()
                except (EOFError, KeyboardInterrupt):
                    pass
                ctx.close()


def cmd_run(args) -> None:
    targets = load_targets(Path(args.extracted), args.category)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    man_path = out / "manifest.json"
    manifest = json.loads(man_path.read_text(encoding="utf-8")) if man_path.is_file() else {}

    todo = [t for t in targets if t["id"] not in manifest or
            manifest[t["id"]].get("status") != "ok"]
    if args.limit:
        todo = todo[:args.limit]
    print(f"전체 {len(targets)}개 / 완료 {len(targets) - len([t for t in targets if t['id'] not in manifest or manifest[t['id']].get('status') != 'ok'])}개 "
          f"/ 이번 실행 {len(todo)}개")
    if not todo:
        print("남은 항목이 없습니다."); return

    with sync_playwright() as pw:
        ctx = open_browser(pw, Path(args.profile), args.chrome, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        consecutive_fail = 0
        try:
            for i, tg in enumerate(todo, 1):
                log: list[str] = []
                rec = dict(id=tg["id"], category=tg["category"],
                           product_name=tg["product_name"], status="fail",
                           url=None, matched_title=None, match_score=0.0,
                           files=[], log=log, at=time.strftime("%Y-%m-%d %H:%M:%S"))
                print(f"\n[{i}/{len(todo)}] {tg['id']}  {tg['product_name'][:50]}")
                try:
                    url = tg.get("product_url")
                    if not url:
                        page.goto(SEARCH_URL.format(quote_plus(tg["query"])), timeout=60000)
                        human_pause(args.gap_min * 0.3, args.gap_max * 0.3)
                        if blocked(page):
                            log.append("검색 페이지 접근 차단")
                            raise RuntimeError("blocked")
                        url, title, sc = find_product(page, tg, log)
                        rec["matched_title"], rec["match_score"] = title, sc
                        if not url:
                            raise RuntimeError("상품 링크 없음")
                        if sc < args.min_score:
                            log.append(f"일치도 {sc} < 기준 {args.min_score} — 건너뜀")
                            rec["status"] = "low_match"
                            raise RuntimeError("low match")
                    page.goto(url, timeout=60000)
                    human_pause(2, 4)
                    if blocked(page):
                        log.append("상세페이지 접근 차단")
                        raise RuntimeError("blocked")
                    rec["url"] = page.url

                    click_expand(page, log)
                    scroll_to_bottom(page, log)
                    if args.format == "pdf":
                        f = out / f"{tg['id']}.pdf"
                        if save_pdf(page, f, log):
                            rec["files"] = [f.name]
                    else:
                        n = save_slices(page, out, tg["id"], log)
                        rec["files"] = [f"{tg['id']}_{k + 1:02d}.png" for k in range(n)]
                    rec["status"] = "ok" if rec["files"] else "fail"
                    consecutive_fail = 0 if rec["status"] == "ok" else consecutive_fail + 1
                except Exception as e:
                    log.append(f"오류: {e}")
                    consecutive_fail += 1
                finally:
                    manifest[tg["id"]] = rec
                    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                        encoding="utf-8")
                    for l in log:
                        print("   " + l)
                    print(f"   -> {rec['status']}")

                # 연속 실패가 쌓이면 멈춘다. 막힌 채로 계속 두드리면 상황이 나빠진다.
                if consecutive_fail >= args.stop_after_fails:
                    print(f"\n연속 {consecutive_fail}회 실패해 중단합니다.")
                    print("  차단되었거나 화면 구조가 바뀌었을 수 있습니다.")
                    print("  probe 명령으로 한 건만 확인해 보세요.")
                    break
                if i < len(todo):
                    gap = random.uniform(args.gap_min, args.gap_max)
                    print(f"   다음까지 {gap:.0f}초 대기")
                    time.sleep(gap)
        finally:
            ctx.close()
    ok = sum(1 for v in manifest.values() if v.get("status") == "ok")
    print(f"\n누적 완료 {ok}/{len(targets)}건")
    print(f"저장 위치: {out.resolve()}")
    print(f"진행 기록: {man_path.resolve()}")


def cmd_status(args) -> None:
    out = Path(args.out)
    man = out / "manifest.json"
    if not man.is_file():
        print(f"진행 기록이 없습니다: {man}"); return
    m = json.loads(man.read_text(encoding="utf-8"))
    targets = load_targets(Path(args.extracted), args.category)
    by_status: dict[str, int] = {}
    for v in m.values():
        by_status[v.get("status", "?")] = by_status.get(v.get("status", "?"), 0) + 1
    print(f"대상 {len(targets)}개 / 기록 {len(m)}건")
    for k, v in sorted(by_status.items()):
        print(f"  {k}: {v}건")
    low = [v for v in m.values() if v.get("status") == "ok" and v.get("match_score", 1) < 0.6]
    if low:
        print(f"\n일치도가 낮은 채로 저장된 건 {len(low)}개 — 엉뚱한 상품일 수 있으니 확인하세요:")
        for v in low[:10]:
            print(f"  {v['id']}  {v.get('match_score')}  {v.get('matched_title')}")
    urls = [v for v in m.values() if v.get("url")]
    print(f"\n상품 URL 확보: {len(urls)}건")


def cmd_export_urls(args) -> None:
    """수집한 실제 상품 URL을 추출 결과(data/extracted)에 채워 넣는다.

    URL을 한 번 확보하면 다음 회차부터 검색 단계가 통째로 사라진다.
    """
    out = Path(args.out)
    man = out / "manifest.json"
    if not man.is_file():
        sys.exit(f"진행 기록이 없습니다: {man}")
    m = json.loads(man.read_text(encoding="utf-8"))
    ext = Path(args.extracted)
    filled = 0
    for f in sorted(ext.glob("*.json")):
        cat = f.stem
        rows = json.loads(f.read_text(encoding="utf-8"))
        changed = False
        for r in rows:
            stem = str(r.get("file") or "").rsplit(".", 1)[0] or "00"
            rec = m.get(f"{cat}-{stem}")
            if rec and rec.get("url") and not r.get("product_url"):
                r["product_url"] = rec["url"]
                filled += 1
                changed = True
        if changed and not args.dry_run:
            f.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")
    print(f"{'(미적용) ' if args.dry_run else ''}상품 URL {filled}건을 추출 결과에 채웠습니다.")


def cmd_selftest(args) -> None:
    """쿠팡 없이 스크롤·PDF·슬라이스 저장이 되는지만 확인한다.

    쿠팡 접근 여부와 무관하게 '저장 기계'가 멀쩡한지 먼저 가려내기 위한 명령.
    문제가 생겼을 때 어느 쪽이 원인인지 나누는 데 쓴다.
    """
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    html = out / "_selftest.html"
    blocks = "\n".join(
        f'<div style="height:800px;background:hsl({i * 24},70%,90%);'
        f'font:28px sans-serif;padding:40px">블록 {i + 1} / 15</div>'
        for i in range(15))
    html.write_text(f"<html><body style='margin:0'>{blocks}</body></html>",
                    encoding="utf-8")
    log: list[str] = []
    with sync_playwright() as pw:
        ctx = open_browser(pw, Path(args.profile), False, headless=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(html.as_uri(), timeout=30000)
        h = scroll_to_bottom(page, log)
        ok_pdf = save_pdf(page, out / "_selftest.pdf", log)
        n = save_slices(page, out, "_selftest", log, max_slices=5)
        ctx.close()
    for l in log:
        print("  " + l)
    print(f"\n스크롤 높이 {h}px / PDF {'성공' if ok_pdf else '실패'} / 이미지 {n}장")
    print("이 시험이 통과하면 저장 기계는 정상입니다. "
          "이후 실패는 쿠팡 접근이나 화면 구조 쪽 문제입니다.")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="쿠팡 상세페이지 로컬 캡처 (검색 → 더보기 → 스크롤 → 저장)")
    sub = ap.add_subparsers(dest="command", required=True)

    def common(p, need_targets=True):
        p.add_argument("--profile", default=str(DEFAULT_PROFILE),
                       help="브라우저 프로필 폴더 (로그인 상태가 여기 남는다)")
        p.add_argument("--chrome", action="store_true",
                       help="번들 크로미움 대신 설치된 Chrome 사용")
        p.add_argument("--out", default=str(DEFAULT_OUT), help="저장 폴더")
        if need_targets:
            p.add_argument("--extracted", default=str(ROOT / "data" / "extracted"),
                           help="썸네일 추출 결과 폴더")
            p.add_argument("--category", nargs="*", default=None, help="대상 카테고리")

    p = sub.add_parser("login", help="브라우저를 열어 직접 로그인 (세션 저장)")
    common(p, need_targets=False); p.set_defaults(func=cmd_login)

    p = sub.add_parser("selftest", help="쿠팡 없이 스크롤·저장 기계만 점검")
    common(p, need_targets=False); p.set_defaults(func=cmd_selftest)

    p = sub.add_parser("probe", help="한 건만 시험하고 페이지 구조를 보여준다")
    common(p, need_targets=False)
    p.add_argument("--query", help="검색할 제품명")
    p.add_argument("--url", help="상품 URL을 직접 지정 (검색 건너뜀)")
    p.add_argument("--id", help="저장 파일 이름")
    p.add_argument("--format", choices=["pdf", "png"], default="pdf")
    p.add_argument("--keep-open", action="store_true", help="끝나도 브라우저를 닫지 않음")
    p.set_defaults(func=cmd_probe)

    p = sub.add_parser("run", help="대상 목록을 순서대로 캡처 (이어하기 지원)")
    common(p)
    p.add_argument("--format", choices=["pdf", "png"], default="pdf")
    p.add_argument("--limit", type=int, default=0, help="이번 실행에서 처리할 최대 개수")
    p.add_argument("--gap-min", type=float, default=20.0, help="상품 간 최소 대기(초)")
    p.add_argument("--gap-max", type=float, default=40.0, help="상품 간 최대 대기(초)")
    p.add_argument("--min-score", type=float, default=0.45,
                   help="검색 결과 일치도가 이보다 낮으면 저장하지 않는다")
    p.add_argument("--stop-after-fails", type=int, default=3,
                   help="연속 실패가 이만큼 쌓이면 중단")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("status", help="진행 상황 확인")
    common(p); p.set_defaults(func=cmd_status)

    p = sub.add_parser("export-urls", help="확보한 상품 URL을 추출 결과에 채워 넣기")
    common(p)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_export_urls)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
