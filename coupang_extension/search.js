/* 쿠팡 검색 결과 화면에서 '후보'를 읽어 오는 부분.
 *
 * 한다   : 화면에 떠 있는 검색 결과의 제품명·가격·딜번호를 읽는다
 * 안 한다: 어느 것이 맞는지 여기서 정하지 않는다 (바깥에서 이름·가격으로 따진다)
 *
 * ── 1차 실전에서 0개가 나온 이유와 교훈 ──────────────────────────
 * 첫 실행에서 '상품 링크 0개 발견 / 제목: 쿠팡!' 이 나왔다.
 * 제목에 검색어가 안 들어갔다는 건 결과가 아직 안 그려졌다는 뜻이다.
 * 쿠팡 검색 결과도 상세페이지처럼 **나중에 그려진다.** 페이지 로딩이
 * '완료'된 시점은 뼈대만 온 시점이지 내용이 다 온 시점이 아니다.
 *
 * 상세페이지에서 똑같은 이유로 19장을 2장으로 끝낸 적이 있는데,
 * 그 교훈을 여기에 옮기지 않아 같은 실수를 반복했다.
 * 그래서 여기서도 '링크 수가 늘다가 멈출 때까지' 기다린다.
 *
 * 그리고 클래스 이름에 기대지 않는다. 쿠팡은 배포마다 클래스가 바뀐다.
 * 대신 '상품으로 가는 링크(/vp/products/숫자)'를 찾는다. 주소 구조는 안 바뀐다.
 */
(() => {
  const MAX = 8;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const LINK_SEL = 'a[href*="/vp/products/"], a[href*="/vm/products/"]';

  function linkCount() {
    return document.querySelectorAll(LINK_SEL).length;
  }

  // 결과가 다 그려질 때까지 기다린다.
  // 숫자가 두 번 연속 같으면 다 온 것으로 본다. 최소 시간은 채운다.
  async function waitForResults(log, minMs = 3000, maxMs = 16000) {
    const t0 = Date.now();
    let prev = -1;
    while (Date.now() - t0 < maxMs) {
      const n = linkCount();
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (n >= 3 && n === prev) {
        log.push(`검색 결과 도착 (상품 링크 ${n}개, ${secs}초 기다림)`);
        return n;
      }
      if (n === prev && Date.now() - t0 >= minMs) {
        // 안 늘어난 채 최소 시간이 지났다. 한 번 훑어 지연 로딩을 깨운다.
        if (Date.now() - t0 < maxMs - 4000) {
          window.scrollTo(0, Math.max(900, window.innerHeight));
          await sleep(1200);
          window.scrollTo(0, 0);
          log.push(`아직 ${n}개뿐이라 한 번 훑어 깨움 (${secs}초)`);
          prev = -1;
          await sleep(900);
          continue;
        }
        log.push(`상품 링크 ${n}개에서 멈춤 (${secs}초 기다림)`);
        return n;
      }
      prev = n;
      await sleep(700);
    }
    const n = linkCount();
    log.push(`${maxMs / 1000}초를 기다렸으나 상품 링크 ${n}개`);
    return n;
  }

  function cleanText(el) {
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function pricesIn(text) {
    return [...text.matchAll(/([\d,]{3,})\s*원/g)]
      .map((m) => parseInt(m[1].replace(/,/g, ""), 10))
      .filter((n) => n >= 100 && n <= 10000000);
  }

  function nameIn(box) {
    const lines = (box.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const bad = /^(광고|로켓배송|로켓프레시|무료배송|내일|오늘|모레|별점|후기|리뷰|\d)/;
    const cands = lines.filter((l) =>
      l.length >= 8 && /[가-힣]/.test(l) && !bad.test(l) && !/원$/.test(l));
    if (cands.length) return cands.sort((a, b) => b.length - a.length)[0].slice(0, 160);
    return (lines[0] || "").slice(0, 160);
  }

  function collect(log) {
    const links = document.querySelectorAll(LINK_SEL);
    const seen = new Set();
    const out = [];
    for (const a of links) {
      let pid = "";
      try {
        pid = (new URL(a.href, location.href).pathname.match(/\/v[pm]\/products\/(\d+)/) || [])[1] || "";
      } catch (e) { continue; }
      if (!pid || seen.has(pid)) continue;

      let box = a.closest("li") || a.closest("[class*=product]") || a.parentElement;
      for (let k = 0; k < 4 && box && cleanText(box).length < 20; k++) box = box.parentElement;
      if (!box) continue;

      const text = cleanText(box);
      const ps = pricesIn(text);
      if (ps.length === 0 && text.length < 15) continue;

      seen.add(pid);
      out.push({
        rank: out.length + 1,
        pid,
        url: `https://www.coupang.com/vp/products/${pid}`,
        name: nameIn(box),
        price: ps.length ? ps[0] : null,
        pricesSeen: ps.slice(0, 5),
        isAd: /광고/.test(text) || /srp_product_ads/.test(a.href),
      });
      if (out.length >= MAX) break;
    }
    return out;
  }

  async function main() {
    const log = [];
    log.push(`검색 주소: ${location.href}`);

    const bodyText0 = (document.body.innerText || "");
    const blockMarks = ["비정상적인 접근", "접근이 차단", "로봇이 아닙니다", "보안 문자", "자동 입력 방지"];
    let hit = blockMarks.filter((m) => bodyText0.includes(m) || document.title.includes(m));
    if (hit.length) {
      return { ok: false, reason: "blocked", candidates: [],
               log: [...log, `차단 문구: ${hit.join(", ")}`], bodyHead: bodyText0.slice(0, 200) };
    }

    await waitForResults(log);

    const body = (document.body.innerText || "");
    hit = blockMarks.filter((m) => body.includes(m) || document.title.includes(m));
    if (hit.length) {
      return { ok: false, reason: "blocked", candidates: [],
               log: [...log, `기다린 뒤 차단 문구 발견: ${hit.join(", ")}`], bodyHead: body.slice(0, 200) };
    }

    log.push(`제목: ${document.title}`);
    const out = collect(log);
    log.push(`후보 ${out.length}개 추출`);

    if (out.length === 0) {
      // 왜 못 찾았는지 다음에 고칠 수 있도록 화면 상태를 남긴다.
      // '결과가 없다'와 '못 읽었다'는 전혀 다른 문제이고, 이걸 구분 못 하면
      // 엉뚱한 곳을 고치게 된다.
      const empty = /검색결과가 없|검색 결과가 없|일치하는 상품/.test(body);
      log.push(`진단 — 전체 링크 ${document.querySelectorAll("a").length}개 / ` +
               `본문 글자수 ${body.length} / '결과없음' 문구 ${empty ? "있음" : "없음"}`);
      const hrefs = [...document.querySelectorAll("a")].slice(0, 8)
        .map((a) => (a.getAttribute("href") || "").slice(0, 60));
      log.push(`진단 — 링크 예시: ${hrefs.join(" | ") || "(없음)"}`);
      return { ok: false, reason: empty ? "no_results" : "not_rendered",
               candidates: [], url: location.href, log, bodyHead: body.slice(0, 300) };
    }

    return { ok: true, reason: "", candidates: out, url: location.href,
             log, bodyHead: body.slice(0, 200) };
  }

  return main();
})();
