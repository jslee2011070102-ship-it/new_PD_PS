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
  const EXPAND_TEXTS = [
    "상품정보 더보기", "상세정보 더보기", "상품상세 더보기",
    "더보기", "펼쳐보기", "전체보기", "자세히 보기",
  ];

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  async function clickExpand(log) {
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

  // 상세 영역으로 보이는 곳. 여기 안쪽만 보는 것이 원칙이다.
  const DETAIL_SELECTORS = [
    "#productDetail", ".product-detail", ".vendor-item",
    "[class*=productDetail]", "[class*=product-detail]", "[class*=detail-content]",
    "[class*=subType-IMAGE]", "[id*=productDetail]",
  ];

  // 상세 영역을 못 찾았을 때 페이지 전체를 훑게 되는데, 그러면 상단 상품 사진
  // (썸네일·갤러리)이 섞여 들어온다. 우리가 보려는 건 상세페이지의 소구점 이미지이지
  // 제품 사진이 아니므로, 이 영역들은 명시적으로 뺀다.
  const EXCLUDE_SELECTORS = [
    "[class*=gallery]", "[class*=thumbnail]", "[class*=thumb]",
    "[class*=prod-image]", "[class*=product-image]", "[class*=image-list]",
    "header", "nav", "footer", "[class*=recommend]", "[class*=relate]",
    "[class*=review]", "[class*=banner]", "[class*=ad-]",
  ];

  function inExcluded(img) {
    for (const sel of EXCLUDE_SELECTORS) {
      if (img.closest(sel)) return sel;
    }
    return null;
  }

  function collectImages(log) {
    let scope = null, scopeName = "";
    for (const sel of DETAIL_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.querySelectorAll("img").length >= 1) {
        scope = el; scopeName = sel;
        log.push(`상세 영역 찾음: ${sel}`);
        break;
      }
    }
    const fallback = !scope;
    if (fallback) {
      scope = document.body; scopeName = "(페이지 전체)";
      log.push("상세 영역을 못 찾아 페이지 전체에서 수집 — 상단 상품사진 영역은 제외함");
    }

    const seen = new Set();
    const out = [];
    let skippedGallery = 0, skippedSmall = 0;
    for (const img of scope.querySelectorAll("img")) {
      const u = imgUrl(img);
      if (!u || seen.has(u)) continue;
      // 상세 영역을 못 찾은 경우에만 갤러리·리뷰·배너 영역을 걸러낸다.
      // 상세 영역을 찾았다면 그 안은 전부 소구점 이미지로 본다.
      if (fallback) {
        const hit = inExcluded(img);
        if (hit) { skippedGallery++; continue; }
      }
      const w = img.naturalWidth || parseInt(img.getAttribute("width") || "0", 10) || img.clientWidth;
      const h = img.naturalHeight || parseInt(img.getAttribute("height") || "0", 10) || img.clientHeight;
      // 상세 이미지는 폭이 크다. 아직 안 뜬 것(0)은 남겨 둔다.
      const big = (w === 0 && h === 0) || w >= 300 || h >= 300;
      if (!big) { skippedSmall++; continue; }
      if (/\.(svg|gif)(\?|$)/i.test(u)) continue;
      seen.add(u);
      out.push({ url: u, w, h });
    }
    if (skippedGallery) log.push(`상단 상품사진·리뷰·배너 영역에서 ${skippedGallery}장 제외`);
    if (skippedSmall) log.push(`작은 아이콘 ${skippedSmall}장 제외`);
    log.push(`수집 범위: ${scopeName}${fallback ? " [상세영역 못찾음]" : ""}`);
    return { images: out, scope: scopeName, fallback };
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
      log,
      bodyHead: bodyText.slice(0, 200),
    };
  }

  return main();
})();
