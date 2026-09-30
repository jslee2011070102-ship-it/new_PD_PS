/* 쿠팡 검색 결과 화면에서 '후보'를 읽어 오는 부분.
 *
 * 무엇을 하고 무엇을 하지 않나
 * ----------------------------
 * 한다   : 화면에 떠 있는 검색 결과의 제품명·가격·딜번호를 읽는다
 * 안 한다: 어느 것이 맞는지 여기서 정하지 않는다
 *
 * 판정을 여기서 하지 않는 이유가 중요하다. 검색 1등이 찾던 제품이라는 보장이
 * 없다. 같은 이름의 다른 용량일 수도, 광고일 수도 있다. 그래서 여기서는
 * 후보를 있는 그대로 5개까지 담아 보내고, 맞는지는 바깥에서 이름과 가격으로
 * 따진다. 애매하면 사람이 본다.
 *
 * 그리고 클래스 이름에 기대지 않는다. 쿠팡은 배포할 때마다 클래스가 바뀐다.
 * 대신 '상품으로 가는 링크(/vp/products/숫자)'를 모두 찾는다. 이건 주소 구조라
 * 화면이 바뀌어도 그대로다. 간판 이름 대신 건물 주소를 보는 셈이다.
 */
(() => {
  const MAX = 8;

  function cleanText(el) {
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  // "14,650원" 같은 표기에서 숫자만 뽑는다.
  function pricesIn(text) {
    return [...text.matchAll(/([\d,]{3,})\s*원/g)]
      .map((m) => parseInt(m[1].replace(/,/g, ""), 10))
      .filter((n) => n >= 100 && n <= 10000000);
  }

  // 제품명으로 보이는 줄을 고른다.
  // 가격·별점·배송 문구가 아닌, 한글이 들어간 가장 그럴듯한 줄.
  function nameIn(box) {
    const lines = (box.innerText || "").split("\n")
      .map((s) => s.trim()).filter(Boolean);
    const bad = /^(광고|로켓배송|로켓프레시|무료배송|내일|오늘|모레|별점|후기|리뷰|\d)/;
    const cands = lines.filter((l) =>
      l.length >= 8 && /[가-힣]/.test(l) && !bad.test(l) && !/원$/.test(l));
    if (cands.length) return cands.sort((a, b) => b.length - a.length)[0].slice(0, 160);
    return (lines[0] || "").slice(0, 160);
  }

  const log = [];
  log.push(`검색 주소: ${location.href}`);
  log.push(`제목: ${document.title}`);

  const body = (document.body.innerText || "").slice(0, 200);
  const blockMarks = ["비정상적인 접근", "접근이 차단", "로봇이 아닙니다", "보안 문자", "자동 입력 방지"];
  const hitBlock = blockMarks.filter((m) => body.includes(m) || document.title.includes(m));
  if (hitBlock.length) {
    return { ok: false, reason: "blocked", candidates: [],
             log: [...log, `차단 문구: ${hitBlock.join(", ")}`], bodyHead: body };
  }

  const links = document.querySelectorAll('a[href*="/vp/products/"]');
  log.push(`상품 링크 ${links.length}개 발견`);

  const seen = new Set();
  const out = [];
  for (const a of links) {
    let pid = "";
    try { pid = (new URL(a.href, location.href).pathname.match(/\/vp\/products\/(\d+)/) || [])[1] || ""; }
    catch (e) { continue; }
    if (!pid || seen.has(pid)) continue;

    // 이 링크를 감싸는 '한 칸'을 찾는다. 거기 이름과 가격이 같이 들어 있다.
    let box = a.closest("li") || a.closest("[class*=product]") || a.parentElement;
    for (let k = 0; k < 4 && box && cleanText(box).length < 20; k++) box = box.parentElement;
    if (!box) continue;

    const text = cleanText(box);
    const ps = pricesIn(text);
    if (ps.length === 0 && text.length < 15) continue;   // 이름도 가격도 없으면 상품 칸이 아니다

    seen.add(pid);
    out.push({
      rank: out.length + 1,
      pid,
      url: `https://www.coupang.com/vp/products/${pid}`,
      name: nameIn(box),
      // 한 칸에 여러 금액이 뜬다(판매가·정가·100ml당). 가장 작은 값은 단가일 때가
      // 많아 오해를 부른다. 판단은 바깥에서 하도록 후보를 모두 넘긴다.
      price: ps.length ? ps[0] : null,
      pricesSeen: ps.slice(0, 5),
      isAd: /광고/.test(text) || /sourceType=srp_product_ads/.test(a.href),
    });
    if (out.length >= MAX) break;
  }

  log.push(`후보 ${out.length}개 추출`);
  return {
    ok: out.length > 0,
    reason: out.length > 0 ? "" : "no_results",
    candidates: out,
    url: location.href,
    log,
    bodyHead: body.slice(0, 200),
  };
})();
