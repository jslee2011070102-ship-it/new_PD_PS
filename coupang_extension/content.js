/* 상품 상세페이지 안에서 실행되는 부분.
 *
 * 하는 일은 셋뿐이다.
 *   1) '더보기'를 눌러 접혀 있는 상세 영역을 편다
 *   2) 상세 영역의 이미지 주소를 모은다
 *   3) 무엇을 했고 무엇을 찾았는지 그대로 보고한다
 *
 * 브라우저를 속이거나 숨기는 코드는 없다. 사용자가 평소 쓰는 브라우저에서
 * 사용자가 시작시킨 동작을, 화면에 있는 그대로 읽을 뿐이다.
 *
 * 스크롤을 굳이 다 내리지 않는 이유: 쿠팡의 지연 로딩 이미지는 화면에 보이기
 * 전에도 data-src 같은 칸에 주소를 이미 담고 있다. 그 주소를 읽으면 되므로
 * 끝까지 내릴 필요가 없다. (그래도 못 찾으면 아래에서 한 번 훑는다.)
 */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  // 버튼을 클래스 이름이 아니라 적힌 글자로 찾는다.
  // 클래스 이름은 배포할 때마다 바뀌지만 글자는 덜 바뀐다.
  // 실제 확인된 문구: "상품정보 더보기"
  // (버튼 안에 <span class="product-detail-seemore-icon-wpui"> 가 함께 들어 있다)
  const EXPAND_TEXTS = [
    "상품정보 더보기", "상세정보 더보기", "상품상세 더보기",
    "더보기", "펼쳐보기", "전체보기", "자세히 보기",
  ];
  // 글자보다 확실한 단서. 이 아이콘을 품은 버튼이 곧 '더보기' 버튼이다.
  const EXPAND_SELECTORS = [
    ".product-detail-seemore-icon-wpui",
    "[class*=seemore]", "[class*=see-more]",
  ];

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  async function clickExpand(log) {
    // 클래스로 먼저 찾는다. 글자 비교보다 정확하다.
    for (const sel of EXPAND_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        const btn = el.closest("button, a, div[role=button]") || el;
        if (!visible(btn)) continue;
        try {
          btn.scrollIntoView({ block: "center" });
          await sleep(rand(400, 900));
          btn.click();
          log.push(`더보기 클릭(클래스): ${sel}`);
          await sleep(rand(1500, 2800));
          return true;
        } catch (e) { /* 다음 후보 */ }
      }
    }
    const cands = Array.from(
      document.querySelectorAll("button, a, div[role=button], span, div")
    ).filter((el) => {
      const t = (el.textContent || "").trim();
      return t.length > 0 && t.length <= 20 && EXPAND_TEXTS.some((k) => t.includes(k));
    });
    // 바깥쪽 큰 요소보다 실제로 눌리는 작은 요소가 낫다
    cands.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
    for (const el of cands.slice(0, 6)) {
      if (!visible(el)) continue;
      try {
        el.scrollIntoView({ block: "center" });
        await sleep(rand(400, 900));
        el.click();
        log.push(`더보기 클릭: "${(el.textContent || "").trim().slice(0, 20)}"`);
        await sleep(rand(1200, 2200));
        return true;
      } catch (e) { /* 다음 후보로 */ }
    }
    log.push("더보기 버튼을 찾지 못함 (이미 펼쳐져 있을 수 있음)");
    return false;
  }

  function imgUrl(img) {
    const raw =
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy") ||
      img.getAttribute("data-img-src") ||
      "";
    if (!raw) return null;
    try {
      const u = new URL(raw, location.href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      return u.href;
    } catch (e) { return null; }
  }

  // 상세 영역으로 보이는 곳. 실제 쿠팡 구조에서 확인한 경로:
  //   .product-detail-content-inside > .vendor-item
  //     > .type-IMAGE_NO_SPACE > .subType-IMAGE.with-width-780 > img
  const DETAIL_SELECTORS = [
    ".product-detail-content-inside",
    "#productDetail", ".product-detail", ".vendor-item",
    "[class*=productDetail]", "[class*=product-detail]", "[class*=detail-content]",
    "[class*=subType-IMAGE]", "[class*=type-IMAGE]", "[id*=productDetail]",
  ];

  const EXCLUDE_SELECTORS = [
    "[class*=gallery]", "[class*=thumbnail-item]", "[class*=image-list]",
    "[class*=prod-image]", "[class*=product-image]",
    "header", "nav", "footer", "[class*=recommend]", "[class*=relate]",
    "[class*=review]", "[class*=banner]", "[class*=also-view]",
  ];

  function inExcluded(img) {
    for (const sel of EXCLUDE_SELECTORS) {
      if (img.closest(sel)) return sel;
    }
    return null;
  }

  function pxAttr(v) {
    // width="100%" 같은 값은 픽셀 크기가 아니다.
    // 이걸 parseInt 하면 100 이 되어 '작은 아이콘'으로 오해하고 버리게 된다.
    // 실제로 그렇게 해서 상세 이미지를 전부 놓쳤다. 숫자+px 만 인정한다.
    if (!v) return 0;
    const t = String(v).trim();
    if (!/^\d+(\.\d+)?(px)?$/i.test(t)) return 0;
    return Math.round(parseFloat(t)) || 0;
  }

  function sizeOf(img) {
    const w = img.naturalWidth || pxAttr(img.getAttribute("width")) || img.clientWidth || 0;
    const h = img.naturalHeight || pxAttr(img.getAttribute("height")) || img.clientHeight || 0;
    return [w, h];
  }

  function collectImages(log) {
    // 후보 컨테이너를 전부 모은다. 첫 번째 하나만 보면 앞쪽 광고 영역만 긁게 된다.
    const scopes = [], names = [];
    for (const sel of DETAIL_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.querySelectorAll("img").length === 0) continue;
        if (scopes.some((s) => s.contains(el) || el.contains(s))) continue;
        scopes.push(el);
        names.push(sel);
      }
    }
    const fallback = scopes.length === 0;
    if (fallback) {
      scopes.push(document.body);
      names.push("(페이지 전체)");
      log.push("상세 영역을 못 찾아 페이지 전체에서 수집 — 상단 상품사진 영역은 제외함");
    } else {
      log.push(`상세 영역 ${scopes.length}곳: ${[...new Set(names)].join(", ")}`);
    }

    const totalImgs = document.querySelectorAll("img").length;
    const seen = new Set();
    const out = [];
    let skippedGallery = 0, skippedSmall = 0, skippedBanner = 0;

    for (const scope of scopes) {
      for (const img of scope.querySelectorAll("img")) {
        const u = imgUrl(img);
        if (!u || seen.has(u)) continue;
        if (fallback && inExcluded(img)) { skippedGallery++; continue; }
        // 브랜드관으로 보내는 광고 배너. 상세 내용이 아니다.
        if (img.closest('a[href*="brandstore"], a[href*="/np/campaigns"], [class*=banner]')) {
          skippedBanner++; continue;
        }
        if (/\.(svg|gif)(\?|$)/i.test(u)) continue;

        const [w, h] = sizeOf(img);
        // 상세 영역 안이면 크기로 거르지 않는다.
        // 지연 로딩 상태에서는 실제 크기를 알 수 없고(naturalWidth 0),
        // width="100%" 처럼 픽셀이 아닌 값도 흔하다. 상세 영역 안에 있다는 것
        // 자체가 이미 충분한 근거다. 명백히 작은 것(양쪽 다 100 미만)만 뺀다.
        const tooSmall = fallback
          ? !((w === 0 && h === 0) || w >= 300 || h >= 300)
          : (w > 0 && h > 0 && w < 100 && h < 100);
        if (tooSmall) { skippedSmall++; continue; }

        seen.add(u);
        out.push({ url: u, w, h });
      }
    }
    if (skippedBanner) log.push(`브랜드관 광고 배너 ${skippedBanner}장 제외`);
    if (skippedGallery) log.push(`상단 상품사진·리뷰·배너 영역에서 ${skippedGallery}장 제외`);
    if (skippedSmall) log.push(`작은 아이콘 ${skippedSmall}장 제외`);
    log.push(`페이지 전체 img 태그 ${totalImgs}개 중 ${out.length}장 채택`);
    return { images: out, scope: [...new Set(names)].join(", "), fallback, totalImgs };
  }

  async function nudgeScroll(log) {
    // 주소가 안 잡히면 한 번만 훑어 지연 로딩을 깨운다
    const step = Math.max(600, window.innerHeight * 0.9);
    for (let y = 0; y < document.body.scrollHeight && y < 60000; y += step) {
      window.scrollTo(0, y);
      await sleep(rand(120, 260));
    }
    window.scrollTo(0, 0);
    await sleep(500);
    log.push("지연 로딩을 깨우려고 한 번 훑음");
  }

  async function main() {
    const log = [];
    log.push(`주소: ${location.href}`);
    log.push(`제목: ${document.title}`);

    const bodyText = (document.body.innerText || "").slice(0, 200);
    const blockMarks = ["비정상적인 접근", "접근이 차단", "Access Denied", "로봇이 아닙니다",
                        "보안 문자", "잠시 후 다시", "자동 입력 방지"];
    const hit = blockMarks.filter((m) => bodyText.includes(m) || document.title.includes(m));
    if (hit.length) {
      log.push(`차단 문구 발견: ${hit.join(", ")}`);
      return { ok: false, reason: "blocked", title: document.title, url: location.href,
               images: [], log, bodyHead: bodyText };
    }

    await clickExpand(log);
    let got = collectImages(log);
    if (got.images.length < 2) {
      await nudgeScroll(log);
      got = collectImages(log);
    }
    const images = got.images;
    log.push(`상세 이미지 ${images.length}장 수집`);

    return {
      ok: images.length > 0,
      reason: images.length > 0 ? "" : "no_images",
      title: document.title,
      url: location.href,
      images,
      scope: got.scope,
      fallback: got.fallback,
      totalImgs: got.totalImgs,
      frameUrl: location.href,
      log,
      bodyHead: bodyText.slice(0, 200),
    };
  }

  return main();
})();
