/* 수집 진행을 맡는 부분.
 *
 * 목록을 하나씩 꺼내 탭을 열고, 상세페이지 안에서 content.js 를 실행해
 * 이미지 주소를 받아온 뒤, 그 이미지를 내려받는다. 그리고 다음으로 넘어간다.
 *
 * 설계에서 신경 쓴 것
 *  - 매 건마다 결과를 저장한다. 중간에 브라우저를 닫아도 앞의 결과가 남는다.
 *  - 상품 사이에 사람이 보는 정도의 간격을 둔다. 몰아치지 않는다.
 *  - 연속으로 실패하면 스스로 멈춘다. 막힌 채로 계속 두드리지 않는다.
 *  - 실패 사유를 기록에 남긴다. '몇 건 실패'만 알면 고칠 수가 없다.
 */


// ── 아이콘을 누르면 사이드 패널이 열리게 한다 ──────────────────────
// 팝업은 다른 곳을 클릭하거나 탭을 옮기면 무조건 닫힌다(크롬 구조상 그렇다).
// 수집이 몇십 분 걸리는데 진행 상황을 보려면 매번 다시 열어야 했다.
// 사이드 패널은 탭을 옮겨도 그대로 있다.
function enableSidePanel() {
  if (!chrome.sidePanel) return false;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  return true;
}
enableSidePanel();
chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(enableSidePanel);

// 사이드 패널을 쓸 수 없는 낮은 버전의 크롬이면, 아이콘 클릭 시 탭으로 연다.
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
    });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
  }
});

const DEFAULTS = {
  gapMin: 12,      // 상품 사이 최소 대기(초)
  gapMax: 25,      // 상품 사이 최대 대기(초)
  stopAfterFails: 3,
  folder: "coupang_usp",
  saveImages: true,  // false 면 이미지 파일을 저장하지 않는다 (주소는 어차피 기록에 남는다)
  tryMobile: true,   // 실패하면 모바일 주소로 한 번 더
  folderMode: "id",  // 폴더 이름: id=딜번호 / id_title=딜번호_제품명 / label=내가 붙인 이름
};

// 이 장수 미만이면 "덜 긁혔을지 모른다"고 보고 재시도하고, 화면에도 표시한다.
const LOW_YIELD = 4;

// ── 주소에서 딜번호(상품번호)를 뽑는다 ─────────────────────────────
// 쿠팡 주소는 .../vp/products/8765432?searchId=...&searchRank=0 꼴이다.
// 앞쪽 숫자가 그 상품을 가리키는 유일한 번호(딜번호)다.
// 뒤쪽 꼬리표(searchId, clickEventId, searchRank...)는 "어느 검색에서 눌렀나"를
// 기록하는 것일 뿐, 상품과는 무관하다.
function productId(url) {
  try {
    const m = new URL(url).pathname.match(/\/v[pm]\/products\/(\d+)/);
    return m ? m[1] : "";
  } catch (e) { return ""; }
}

// 주소에서 검색 추적용 꼬리표를 떼어낸다.
// 이유가 둘이다.
//  1) 붙여넣다가 주소 끝이 잘려도(줄바꿈 등) 잘린 부분이 꼬리표면 피해가 없다.
//  2) 같은 상품을 다른 검색에서 두 번 넣어도 같은 주소로 모여 중복이 사라진다.
// itemId / vendorItemId 는 남긴다. 이 둘은 "어느 옵션"을 뜻해서 상세 내용이 달라진다.
function cleanUrl(url) {
  try {
    const u = new URL(url);
    const keep = ["itemId", "vendorItemId"];
    const sp = new URLSearchParams();
    for (const k of keep) {
      const v = u.searchParams.get(k);
      if (v) sp.set(k, v);
    }
    const q = sp.toString();
    u.search = q ? "?" + q : "";
    u.hash = "";
    return u.href;
  } catch (e) { return url; }
}

// 상품 주소를 모바일 주소 후보로 바꾼다.
// 확신할 수 없는 부분이라 후보를 여러 개 만들고, 무엇이 통했는지 기록에 남긴다.
function mobileCandidates(url) {
  try {
    const u = new URL(url);
    if (u.hostname.startsWith("m.")) return [];
    const out = [];
    const m = u.pathname.match(/\/vp\/products\/(\d+)/);
    if (m) {
      out.push(`https://m.coupang.com/vm/products/${m[1]}${u.search}`);
      out.push(`https://m.coupang.com/vp/products/${m[1]}${u.search}`);
    }
    out.push(`https://m.coupang.com${u.pathname}${u.search}`);
    return [...new Set(out)];
  } catch (e) { return []; }
}

let state = {
  running: false,
  stopRequested: false,
  queue: [],
  done: {},        // id -> 결과
  current: null,
  consecutiveFails: 0,
  message: "",
  notice: "",       // 시작할 때 제외된 주소 안내 (message 와 달리 지워지지 않는다)
  mode: "collect",  // collect = 이미지 수집 / search = 주소 찾기
  exportedCount: 0, // 마지막으로 파일로 내보낸 시점의 '확실' 건수
  exportedAt: "",
  searchQueue: [],
  found: {},        // id -> 검색 결과
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

async function save() {
  await chrome.storage.local.set({ state });
}
async function load() {
  const got = await chrome.storage.local.get("state");
  if (got.state) state = { ...state, ...got.state, running: false, stopRequested: false };
}
load();

function safeName(s) {
  // 윈도우에서 폴더 이름에 못 쓰는 글자를 바꾼다.
  // 끝에 붙은 점과 공백도 없애야 한다. 윈도우는 "이름." 같은 폴더를 못 만든다.
  return String(s)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 60) || "무제";
}

// 페이지 제목에서 제품명만 남긴다.
// 쿠팡 제목은 "제품명 - 쿠팡! " 꼴로 끝나고, 앞에 쓸데없는 말머리가 붙기도 한다.
function titleToName(title) {
  // 쿠팡 제목은 "제품명, 규격, 수량 - 카테고리 | 쿠팡" 꼴이다.
  // 뒤의 " | 쿠팡" 과 " - 카테고리" 는 제품명이 아니므로 떼어낸다.
  // (떼지 않으면 폴더 이름이 "... 2개 -" 처럼 부호로 끝나 보기 흉했다)
  let t = String(title || "")
    .replace(/\s*[-|]\s*쿠팡!?\s*$/, "")
    .replace(/^\s*쿠팡!?\s*[-|]\s*/, "")
    .replace(/\s+-\s+[^-]{1,20}$/, "")   // 끝의 " - 샴푸", " - 캡슐/시트세제"
    .trim();
  // 폴더 이름이 너무 길면 윈도우 경로 길이 제한(260자)에 걸린다. 40자로 줄인다.
  if (t.length > 40) t = t.slice(0, 40);
  // 자르다 보면 ", " 나 " -" 로 끝난다. 그 부호를 떼야 폴더 이름이 깔끔하다.
  t = t.replace(/[\s,\-·/|+]+$/, "").trim();
  return safeName(t);
}

// 이미지를 담을 폴더 이름을 정한다.
// 기본은 딜번호다. 짧고, 겹치지 않고, 같은 상품을 다시 돌리면 같은 폴더에
// 덮어써지므로 "001, 002" 처럼 순서가 밀려 엉뚱한 폴더에 섞이는 일이 없다.
function folderNameFor(item, rec, mode) {
  const pid = productId(rec.usedUrl || item.url);
  const name = titleToName(rec.title);
  if (mode === "label") return safeName(item.label || item.id);
  if (mode === "id_title" && pid && name) return safeName(pid + "_" + name);
  if (mode === "id_title" && name) return name;
  return pid || safeName(item.label || item.id);
}

function extOf(url) {
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp)$/i);
  return m ? m[1].toLowerCase() : "jpg";
}

// 같은 상품을 다시 돌릴 때, 예전 실행이 남긴 파일을 먼저 지운다.
//
// 왜 필요한가: 폴더 이름이 딜번호로 고정되니 다시 돌리면 같은 폴더에 덮어쓴다.
// 그런데 예전에 9장을 받았고 이번에 2장만 받으면 003~009 는 그대로 남는다.
// 그러면 폴더만 보고는 이번에 몇 장을 받았는지 알 수 없다.
// 지우는 범위는 "그 폴더 안의 001.jpg 같은 이름"으로 좁혀 둔다.
async function clearOldFiles(folder, sub, log) {
  if (!chrome.downloads.removeFile) return;
  const want = `${folder}/${sub}/`.toLowerCase();
  let items = [];
  try {
    items = await new Promise((res) => chrome.downloads.search({ limit: 0 }, res)) || [];
  } catch (e) { return; }
  let n = 0;
  for (const it of items) {
    const f = String(it.filename || "").replace(/\\/g, "/").toLowerCase();
    if (!f.includes(want)) continue;
    if (!/\/\d{3}\.(jpe?g|png|webp)$/.test(f)) continue;   // 우리가 만든 이름만
    await new Promise((res) => chrome.downloads.removeFile(it.id, () => {
      void chrome.runtime.lastError; res();          // 이미 없는 파일이면 그냥 넘어간다
    }));
    n++;
  }
  if (n) log.push(`예전 실행이 남긴 파일 ${n}개를 지우고 새로 저장합니다`);
}

async function downloadImages(sub, images, folder, log) {
  let ok = 0;
  for (let i = 0; i < images.length; i++) {
    const url = images[i].url;
    const filename = `${folder}/${sub}/${String(i + 1).padStart(3, "0")}.${extOf(url)}`;
    try {
      await new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, conflictAction: "overwrite" }, (dlId) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(dlId);
        });
      });
      ok++;
    } catch (e) {
      log.push(`이미지 ${i + 1} 저장 실패: ${e.message}`);
    }
    await sleep(rand(120, 300));
  }
  return ok;
}

async function waitForLoad(tabId, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("탭이 닫혔습니다");
    if (tab.status === "complete") return;
    await sleep(400);
  }
  throw new Error("페이지 로딩 시간이 너무 깁니다");
}

async function visitAndCollect(url, log) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForLoad(tab.id);
    await sleep(rand(2500, 4000));

    // 모든 프레임에서 실행한다.
    // 쿠팡은 상세 내용을 별도 iframe 에 넣는 경우가 있는데, 바깥 문서에서만
    // 찾으면 그 안의 이미지를 통째로 놓친다.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"],
    });

    // 프레임별 결과를 합친다. 이미지가 가장 많은 프레임을 대표로 삼되,
    // 다른 프레임에서 나온 이미지도 버리지 않는다.
    const frames = results.map((r) => r && r.result).filter(Boolean);
    if (frames.length === 0) return null;
    if (frames.length > 1) log.push(`프레임 ${frames.length}개에서 수집 시도`);

    const seen = new Set();
    const merged = [];
    for (const f of frames) {
      for (const im of (f.images || [])) {
        if (seen.has(im.url)) continue;
        seen.add(im.url);
        merged.push(im);
      }
    }
    const main = frames.reduce((a, b) =>
      ((b.images || []).length > (a.images || []).length ? b : a), frames[0]);

    for (const f of frames) {
      const n = (f.images || []).length;
      if (frames.length > 1) log.push(`  프레임(${(f.frameUrl || "").slice(0, 70)}): ${n}장`);
      log.push(...(f.log || []));
    }

    return {
      ok: merged.length > 0,
      reason: merged.length > 0 ? "" : (main.reason || "no_images"),
      title: main.title || "",
      images: merged,
      scope: main.scope,
      fallback: main.fallback,
      totalImgs: main.totalImgs,
      bodyHead: main.bodyHead,
      log: [],   // 위에서 이미 합쳤다
    };
  } finally {
    if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function processOne(item, opts) {
  const log = [];
  const rec = {
    id: item.id, url: item.url, usedUrl: item.url, status: "fail", title: "",
    productId: productId(item.url), folder: "",
    images: 0, imageUrls: [], savedFiles: 0, log, at: new Date().toISOString(),
  };
  log.push(`딜번호: ${rec.productId || "(주소에서 찾지 못함)"}`);
  try {
    let r = await visitAndCollect(item.url, log);
    if (r) log.push(...(r.log || []));

    // PC 주소가 막히거나 이미지가 적게 잡히면 모바일 주소로 한 번 더 시도한다.
    //
    // 예전에는 '0장일 때만' 재시도했다. 그래서 19장짜리 상세를 2장만 건지고도
    // 재시도 없이 '성공'으로 끝냈다. 이제 LOW_YIELD 미만이면 다시 해 본다.
    // 그리고 재시도 결과가 더 적으면 버린다 — 실제로 모바일 쪽이 더 적게
    // 잡힌 경우가 있었다(PC 19장 / 모바일 2장). 많은 쪽을 남기는 게 맞다.
    const have = (x) => (x && x.images ? x.images.length : 0);
    if (opts.tryMobile && (!r || r.reason === "blocked" || have(r) < LOW_YIELD)) {
      for (const mu of mobileCandidates(item.url)) {
        log.push(`이미지 ${have(r)}장뿐이라 모바일 주소로 재시도: ${mu}`);
        await sleep(rand(2000, 4000));
        const r2 = await visitAndCollect(mu, log);
        if (r2) log.push(...(r2.log || []));
        if (have(r2) > have(r)) {
          r = r2; rec.usedUrl = mu;
          log.push(`모바일 주소가 더 많음 (${have(r2)}장) — 이쪽을 씁니다`);
          if (have(r2) >= LOW_YIELD) break;
        } else if (r2) {
          log.push(`모바일은 ${have(r2)}장 — 더 적어서 버립니다`);
        }
      }
    }

    if (!r) throw new Error("페이지에서 결과를 받지 못했습니다");
    rec.title = r.title || "";
    rec.images = (r.images || []).length;
    rec.imageUrls = (r.images || []).map((x) => x.url);
    rec.imageSizes = (r.images || []).map((x) => `${x.w}x${x.h}`);
    rec.scope = r.scope || "";
    rec.fallback = !!r.fallback;
    rec.totalImgs = r.totalImgs || 0;
    rec.lowYield = rec.images > 0 && rec.images < LOW_YIELD;
    if (rec.lowYield) log.push("※ 장수가 적습니다 — 확인이 필요합니다");

    if (r.reason === "blocked" && rec.images === 0) {
      rec.status = "blocked";
      log.push(`화면 앞부분: ${(r.bodyHead || "").slice(0, 150)}`);
    } else if (rec.images === 0) {
      rec.status = "no_images";
    } else if (!opts.saveImages) {
      // 이미지 파일은 저장하지 않는다. 주소(imageUrls)는 어차피 기록에 남으므로
      // 나중에 그 주소로 받을 수 있다. 150개 기준 약 2GB와 7분을 아낀다.
      rec.status = "ok";
      log.push(`이미지 주소 ${rec.images}개 기록 (파일 저장은 건너뜀)`);
    } else {
      // 폴더 이름은 제목을 받은 뒤에 정한다. 제품명을 쓰려면 제목이 필요하다.
      rec.productId = productId(rec.usedUrl) || rec.productId;
      rec.folder = folderNameFor(item, rec, opts.folderMode);
      log.push(`저장 폴더: ${opts.folder}/${rec.folder}/`);
      await clearOldFiles(opts.folder, rec.folder, log);
      rec.savedFiles = await downloadImages(rec.folder, r.images, opts.folder, log);
      rec.status = rec.savedFiles > 0 ? "ok" : "fail";
    }
  } catch (e) {
    log.push(`오류: ${e.message}`);
  }
  return rec;
}

/* ══════════════════════════════════════════════════════════════════
   주소 찾기 (제품명 → 쿠팡 주소)
   ══════════════════════════════════════════════════════════════════
   URL 취합이 병목이라 만든 기능이다. 제품명으로 검색해 후보를 읽고,
   이름과 가격으로 맞는지 따진다.

   여기서 가장 조심한 것: **검색 1등을 그냥 집지 않는다.**
   같은 이름의 다른 용량일 수도, 광고일 수도 있다. 잘못 집으면 엉뚱한 제품의
   상세를 긁어 놓고도 맞다고 믿게 된다. 그게 제일 위험하다.
   그래서 확실 / 애매 / 못찾음 으로 나누고, 후보는 전부 기록에 남긴다.
   애매한 건 사람이 보거나, 기록을 넘겨 다시 판정하면 된다.
*/

// 이름을 낱말로 쪼갠다. 기호와 한 글자는 버린다.
function tokens(s) {
  return String(s || "").toLowerCase()
    .replace(/[^가-힣a-z0-9]+/g, " ")
    .split(/\s+/).filter((t) => t.length >= 2);
}

// 제목 안에 "2.1L", "1개" 같은 규격 표기가 들어 있는지 본다.
//
// 단순 includes 로는 안 된다. "3L" 을 찾으면 "13L" 에도 걸리고,
// "1개" 를 찾으면 "21개" 에도 걸린다. 앞뒤가 숫자가 아닌지까지 봐야 한다.
function hasSpec(title, raw) {
  if (!raw) return null;                       // 알 수 없음 (없는 것과 다르다)
  const key = String(raw).toLowerCase().replace(/\s+/g, "");
  if (!key) return null;
  const t = String(title || "").toLowerCase().replace(/\s+/g, "");
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9.])${esc}([^0-9]|$)`).test(t);
}

function scoreCandidate(item, cand) {
  const want = tokens(item.name);
  const got = new Set(tokens(cand.name));
  let hit = 0;
  for (const t of new Set(want)) if (got.has(t)) hit++;
  const nameScore = want.length ? hit / new Set(want).size : 0;

  // 가격은 '변하는' 값이다. 쿠팡은 할인이 수시로 바뀐다.
  // 그래서 가격은 **보조 증거**로만 쓴다. 예전에는 이걸 통과 조건으로 걸어서,
  // 이름이 100% 맞아도 값이 15% 넘게 움직이면 '확실'이 되지 못했다.
  let priceGap = null;
  const all = (cand.pricesSeen && cand.pricesSeen.length) ? cand.pricesSeen
            : (cand.price ? [cand.price] : []);
  if (item.price && all.length) {
    priceGap = Math.min(...all.map((p) => Math.abs(p - item.price) / item.price));
  }

  // 규격(용량·구성)은 '안 변하는' 값이고, 쿠팡 제목에 그대로 찍힌다.
  //   "피지 ... 코튼향, 2.1L, 1개"
  // 같은 이름의 다른 상품을 가르는 건 결국 이것이다. 가격이 아니라 이것으로 가른다.
  const sizeOk = hasSpec(cand.name, item.size);
  const countOk = hasSpec(cand.name, item.count);

  let verdict = "못찾음";
  let why = "";
  if (sizeOk === false) {
    // 용량이 다르면 다른 상품이다. 이름이 아무리 같아도 확정하지 않는다.
    // (실제로 "2.1L 1개" 와 "4.2L 2개" 가 이름이 100% 같았다)
    verdict = nameScore >= 0.5 ? "애매" : "못찾음";
    why = `용량이 다름 (찾는 것 ${item.size})`;
  } else if (nameScore >= 0.85 && sizeOk === true && countOk !== false) {
    // 기준을 0.6 이 아니라 0.85 로 둔 이유:
    // "피지 모락셀라 냄새제거 **세탁세제** 코튼향" 과
    // "피지 모락셀라 냄새제거 **섬유유연제** 코튼향" 은 낱말 5개 중 4개가 같아
    // 0.8 이 나온다. 용량·구성까지 같을 수 있다(둘 다 2.1L 1개).
    // 한 낱말 차이가 곧 다른 제품인 경우가 있으므로 여기서 걸러야 한다.
    verdict = "확실";
    why = `이름 ${Math.round(nameScore * 100)}% + 용량·구성 일치`;
  } else if (nameScore >= 0.6 && sizeOk === true && countOk === false) {
    verdict = "애매";
    why = `용량은 맞으나 구성이 다름 (찾는 것 ${item.count})`;
  } else if (nameScore >= 0.6 && priceGap !== null && priceGap <= 0.05) {
    verdict = "확실";
    why = `이름 ${Math.round(nameScore * 100)}% + 가격 일치`;
  } else if (nameScore >= 0.9 && sizeOk === null && countOk === null) {
    // 제목에 규격이 안 찍힌 경우. 이름만으로 판단할 수밖에 없다.
    verdict = "확실";
    why = `이름 ${Math.round(nameScore * 100)}% (제목에 규격 표기 없음)`;
  } else if (nameScore >= 0.4 &&
             (sizeOk === true || (priceGap !== null && priceGap <= 0.05) || nameScore >= 0.5)) {
    // '애매' 는 **이름이 어느 정도는 맞을 때**만 준다.
    //
    // 예전에는 `sizeOk === true` 하나만으로도 애매가 됐다. 그래서 이름이 0% 맞는
    // 엉뚱한 제품이 '용량이 1L 로 같다'는 이유만으로 애매로 올라왔다.
    // 실제로 19건이 그렇게 쌓였고, 사람이 볼 가치가 없는 후보들이었다.
    // 근거 없는 '애매'는 '못찾음'보다 나쁘다. 할 일이 있는 것처럼 보이기 때문이다.
    verdict = "애매";
    why = `이름 ${Math.round(nameScore * 100)}%` +
          (sizeOk === true ? " · 용량 일치" : "") +
          (priceGap !== null ? ` · 가격차 ${Math.round(priceGap * 100)}%` : "");
  } else {
    why = `이름 ${Math.round(nameScore * 100)}% — 기준 미달`;
  }

  return { ...cand, nameScore: Math.round(nameScore * 100) / 100,
           priceGap, sizeOk, countOk, verdict, why };
}


// 검색 화면 한 곳을 열어 후보를 읽어 온다.
async function searchAt(url, log) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForLoad(tab.id);
    await sleep(rand(2000, 3500));
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ["search.js"],
    });
    const r = results && results[0] && results[0].result;
    if (r) log.push(...(r.log || []));
    return r || null;
  } finally {
    if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function searchOne(item, opts) {
  const log = [];
  const rec = {
    id: item.id, cat: item.cat, name: item.name, wantPrice: item.price || null,
    wantSize: item.size || "", wantCount: item.count || "", verdict: "못찾음", pid: "", url: "",
    matchedName: "", matchedPrice: null, candidates: [], log,
    at: new Date().toISOString(),
  };
  try {
    const q = encodeURIComponent(item.query || item.name);
    log.push(`검색: ${item.query || item.name}`);

    // PC 검색을 먼저, 안 되면 모바일 검색으로. 모바일 화면이 단순해 더 잘 읽힐 때가 있다.
    const urls = [
      `https://www.coupang.com/np/search?q=${q}&channel=user`,
      `https://m.coupang.com/nm/search?q=${q}`,
    ];
    let r = null;
    for (let i = 0; i < urls.length; i++) {
      if (i > 0) {
        log.push(`후보를 못 읽어 다른 검색 화면으로 재시도`);
        await sleep(rand(2000, 3500));
      }
      r = await searchAt(urls[i], log);
      if (r && r.reason === "blocked") break;              // 차단이면 더 두드리지 않는다
      if (r && (r.candidates || []).length > 0) break;
    }

    if (!r) throw new Error("검색 화면에서 결과를 받지 못했습니다");

    if (r.reason === "blocked") {
      rec.verdict = "차단";
      log.push(`화면 앞부분: ${(r.bodyHead || "").slice(0, 150)}`);
      return rec;
    }
    if (r.reason === "not_rendered") {
      // '결과가 없다'와 '못 읽었다'는 전혀 다른 문제다. 섞어 놓으면 엉뚱한 곳을 고친다.
      rec.verdict = "화면못읽음";
      rec.bodyHead = (r.bodyHead || "").slice(0, 300);
      return rec;
    }

    const scored = (r.candidates || []).map((c) => scoreCandidate(item, c));
    rec.candidates = scored.slice(0, 5);
    const order = { "확실": 0, "애매": 1, "못찾음": 2 };
    const best = [...scored].sort((a, b) =>
      (order[a.verdict] - order[b.verdict]) || (b.nameScore - a.nameScore))[0];

    if (best && best.verdict !== "못찾음") {
      rec.verdict = best.verdict;
      rec.pid = best.pid;
      rec.url = best.url;
      rec.matchedName = best.name;
      rec.matchedPrice = best.price;
      log.push(`${best.verdict}: ${best.pid} · ${best.name.slice(0, 40)} · ` +
               `이름일치 ${Math.round(best.nameScore * 100)}% · ` +
               `가격차 ${best.priceGap === null ? "?" : Math.round(best.priceGap * 100) + "%"}`);
    } else {
      log.push(`후보 ${scored.length}개 모두 기준 미달`);
    }
  } catch (e) {
    log.push(`오류: ${e.message}`);
    rec.verdict = "실패";
  }
  return rec;
}

/* 지금 보고 있는 목록 페이지(카테고리 랭킹 등)에서 한꺼번에 읽어 맞춘다.
 *
 * 왜 이 길로 왔나
 * ---------------
 * 쿠팡이 검색 주소(/np/search)를 거부했다. 화면에 이렇게 뜬다.
 *   "요청하신 페이지의 사용권한이 없습니다."
 * 상품 페이지(/vp/products)는 멀쩡히 열리는데 검색만 막힌다.
 *
 * 그런데 애초에 이 목록은 '카테고리 구매 순위 1~25위'에서 뽑은 것이다.
 * 그 랭킹 페이지 한 장에 25개가 다 들어 있다.
 * 검색을 154번 하는 대신, 사장님이 그 페이지를 열고 버튼을 누르면 된다.
 *
 * 여기서는 페이지를 우리가 열지 않는다. 사장님이 평소처럼 브라우저로 연 화면을
 * 그대로 읽을 뿐이다. 주소를 대신 두드리지 않으니 막힐 일도 없다.
 */
async function readCurrentList(items) {
  const log = [];
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/coupang\.com/.test(tab.url || "")) {
    return { ok: false, error: "지금 보고 있는 탭이 쿠팡 페이지가 아닙니다." };
  }
  log.push(`읽은 화면: ${tab.title || ""}`);
  log.push(`주소: ${tab.url}`);

  // executeScript 는 여러 이유로 터질 수 있다(권한 없는 주소, 크롬 내부 페이지,
  // 아직 로딩 중인 탭). 감싸지 않으면 응답이 아예 안 가서 화면에 아무 말도
  // 안 뜬다. 사용자는 눌렀는데 아무 일도 안 일어난 것으로 보인다.
  let r = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ["search.js"],
    });
    r = results && results[0] && results[0].result;
  } catch (e) {
    return { ok: false, log,
             error: `이 화면을 읽을 수 없습니다: ${e.message}\n` +
                    `주소가 https://www.coupang.com 으로 시작하는 화면에서 눌러 주세요.` };
  }
  if (!r) return { ok: false, error: "화면에서 목록을 읽지 못했습니다.", log };
  log.push(...(r.log || []));

  const cands = r.candidates || [];
  if (cands.length === 0) {
    return { ok: false, error: "이 화면에서 상품을 찾지 못했습니다. 목록이 다 뜬 뒤에 눌러 주세요.",
             log, bodyHead: (r.bodyHead || "").slice(0, 200) };
  }

  // 아직 못 찾은 항목만 대상으로, 각 항목마다 이 화면에서 가장 잘 맞는 것을 고른다.
  // 한 상품이 두 항목에 겹쳐 붙지 않도록, 확정된 딜번호는 빼고 진행한다.
  const pending = items.filter(
    (it) => !(state.found[it.id] && state.found[it.id].verdict === "확실"));
  const used = new Set(
    Object.values(state.found).filter((f) => f.verdict === "확실" && f.pid).map((f) => f.pid));

  let added = 0, vague = 0;
  const order = { "확실": 0, "애매": 1, "못찾음": 2 };
  for (const it of pending) {
    const scored = cands
      .filter((c) => !used.has(c.pid))
      .map((c) => scoreCandidate(it, c))
      .sort((a, b) => (order[a.verdict] - order[b.verdict]) || (b.nameScore - a.nameScore));
    const best = scored[0];
    if (!best || best.verdict === "못찾음") continue;

    const rec = {
      id: it.id, cat: it.cat, name: it.name, wantPrice: it.price || null,
      wantSize: it.size || "", wantCount: it.count || "", verdict: best.verdict,
      pid: best.pid, url: best.url,
      matchedName: best.name, matchedPrice: best.price,
      candidates: scored.slice(0, 5), source: "목록화면",
      log: [`목록 화면에서 맞춤: ${tab.title || ""}`.slice(0, 120),
            `${best.verdict} · 이름일치 ${Math.round(best.nameScore * 100)}% · ` +
            `가격차 ${best.priceGap === null ? "?" : Math.round(best.priceGap * 100) + "%"}`],
      at: new Date().toISOString(),
    };
    // 이미 '애매'로 있던 것을 '애매'로 또 덮어쓰지는 않는다(기록만 늘어난다).
    const prev = state.found[it.id];
    if (prev && prev.verdict === "확실") continue;
    state.found[it.id] = rec;
    if (best.verdict === "확실") { used.add(best.pid); added++; } else { vague++; }
  }
  state.mode = "search";
  await save();
  const left = items.filter(
    (it) => !(state.found[it.id] && state.found[it.id].verdict === "확실")).length;
  log.push(`이 화면에서 확실 ${added}개 / 애매 ${vague}개를 맞췄습니다 (남은 ${left}개)`);
  return { ok: true, found: added, vague, left, total: cands.length, log };
}

async function searchLoop(opts) {
  state.running = true;
  state.stopRequested = false;
  state.consecutiveFails = 0;
  state.message = "";
  state.mode = "search";
  await save();

  while (state.searchQueue.length > 0 && !state.stopRequested) {
    const item = state.searchQueue[0];
    state.current = item.id;
    await save();

    const rec = await searchOne(item, opts);
    state.found[item.id] = rec;
    state.searchQueue.shift();
    state.current = null;

    if (["차단", "실패", "화면못읽음"].includes(rec.verdict)) state.consecutiveFails++;
    else state.consecutiveFails = 0;
    await save();

    if (state.consecutiveFails >= opts.stopAfterFails) {
      state.message = `연속 ${state.consecutiveFails}회 실패해 중단했습니다.`;
      break;
    }
    if (state.searchQueue.length > 0 && !state.stopRequested) {
      await sleep(rand(opts.gapMin * 1000, opts.gapMax * 1000));
    }
  }

  state.running = false;
  state.current = null;
  if (state.stopRequested) state.message = "사용자가 중단했습니다.";
  else if (!state.message && state.searchQueue.length === 0) state.message = "검색이 모두 끝났습니다.";
  await save();
}

async function runLoop(opts) {
  state.running = true;
  state.stopRequested = false;
  state.consecutiveFails = 0;
  state.message = "";
  await save();

  while (state.queue.length > 0 && !state.stopRequested) {
    const item = state.queue[0];
    state.current = item.id;
    await save();

    const rec = await processOne(item, opts);
    state.done[item.id] = rec;
    state.queue.shift();
    state.current = null;

    if (rec.status === "ok") state.consecutiveFails = 0;
    else state.consecutiveFails++;
    await save();

    if (state.consecutiveFails >= opts.stopAfterFails) {
      state.message = `연속 ${state.consecutiveFails}회 실패해 중단했습니다. ` +
        `결과를 내보내서 확인해 주세요.`;
      break;
    }
    if (state.queue.length > 0 && !state.stopRequested) {
      await sleep(rand(opts.gapMin * 1000, opts.gapMax * 1000));
    }
  }

  state.running = false;
  state.current = null;
  if (state.stopRequested) state.message = "사용자가 중단했습니다.";
  else if (!state.message && state.queue.length === 0) state.message = "모두 끝났습니다.";
  await save();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
   try {
    if (msg.cmd === "start") {
      if (state.running) { sendResponse({ ok: false, error: "이미 진행 중입니다." }); return; }
      const opts = { ...DEFAULTS, ...(msg.opts || {}) };
      // 주소에서 꼬리표를 떼고, 딜번호가 없는 주소는 아예 받지 않는다.
      // 예전에는 잘린 주소도 조용히 목록에 들어가 "성공"으로 끝났다.
      // 엉뚱한 페이지를 긁고도 성공으로 보이는 게 가장 위험하다.
      const bad = [];
      const items = [];
      for (const it of (msg.items || [])) {
        const url = cleanUrl(it.url);
        const pid = productId(url);
        if (!pid) { bad.push(it.id); continue; }
        items.push({ ...it, url, label: it.label || it.id, productId: pid });
      }
      if (items.length === 0) {
        sendResponse({ ok: false, error: "쓸 수 있는 주소가 없습니다. 딜번호(.../vp/products/숫자)가 있는 주소여야 합니다." });
        return;
      }
      // 이미 성공한 항목은 건너뛴다 (이어하기)
      state.queue = items.filter(
        (it) => !(state.done[it.id] && state.done[it.id].status === "ok"));
      // runLoop 이 시작할 때 message 를 비우므로 안내는 따로 담아 둔다.
      state.notice = bad.length ? `딜번호가 없어 제외한 주소 ${bad.length}개: ${bad.join(", ")}` : "";
      await save();
      sendResponse({ ok: true, queued: state.queue.length, skipped: bad });
      runLoop(opts);
      return;
    }
    // 사람이 눈으로 보고 "이게 맞다"고 확정하는 길.
    //
    // 왜 필요한가: 도구는 용량·구성이 어긋나면 확정하지 않는다(그래야 한다).
    // 그런데 쿠팡에서 같은 제품의 다른 묶음(3.05L 2개 / 4개)은 흔히
    // **같은 딜번호에 옵션만 다른** 경우가 많고, 그러면 상세페이지는 같다.
    // 상세페이지 USP 를 모으는 게 목적이라면 그 주소로 충분할 수 있다.
    // 그 판단은 도구가 아니라 사람이 해야 한다. 그래서 버튼을 준다.
    if (msg.cmd === "confirmMatch") {
      const rec = state.found[msg.id];
      if (!rec) { sendResponse({ ok: false, error: "그 항목을 찾을 수 없습니다." }); return; }
      const c = (rec.candidates || []).find((x) => x.pid === msg.pid);
      if (!c) { sendResponse({ ok: false, error: "그 후보를 찾을 수 없습니다." }); return; }
      rec.verdict = "확실";
      rec.pid = c.pid;
      rec.url = c.url;
      rec.matchedName = c.name;
      rec.matchedPrice = c.price;
      rec.confirmedByUser = true;
      rec.log = [...(rec.log || []), `사람이 확인해 확정함: ${c.pid} · ${(c.name || "").slice(0, 50)}`];
      await save();
      sendResponse({ ok: true });
      return;
    }
    // 후보가 전부 아닐 때, 사람이 직접 찾은 주소를 넣는 길.
    //
    // 전에는 '전부 아님' 버튼만 있고 **넣을 곳이 없었다.** 직접 찾겠다고 해놓고
    // 찾은 것을 둘 데를 안 만든 셈이다. 쿠팡에서 그 제품을 열어 주소창을
    // 복사해 붙여넣으면 끝나야 한다.
    if (msg.cmd === "setUrlManually") {
      const rec = state.found[msg.id];
      if (!rec) { sendResponse({ ok: false, error: "그 항목을 찾을 수 없습니다." }); return; }
      const raw = String(msg.url || "").trim();
      const pid = productId(raw);
      if (!pid) {
        sendResponse({ ok: false,
          error: "쿠팡 상품 주소가 아닙니다. .../vp/products/숫자 가 들어 있어야 합니다." });
        return;
      }
      rec.verdict = "확실";
      rec.pid = pid;
      rec.url = cleanUrl(raw);
      rec.matchedName = "(사람이 직접 넣은 주소)";
      rec.matchedPrice = null;
      rec.confirmedByUser = true;
      rec.manualUrl = true;
      rec.log = [...(rec.log || []), `사람이 주소를 직접 넣음: ${pid}`];
      await save();
      sendResponse({ ok: true, pid });
      return;
    }
    if (msg.cmd === "rejectMatch") {
      const rec = state.found[msg.id];
      if (!rec) { sendResponse({ ok: false, error: "그 항목을 찾을 수 없습니다." }); return; }
      rec.verdict = "못찾음";
      rec.pid = ""; rec.url = ""; rec.matchedName = ""; rec.matchedPrice = null;
      rec.rejectedByUser = true;
      rec.log = [...(rec.log || []), "사람이 '아님'으로 표시함"];
      await save();
      sendResponse({ ok: true });
      return;
    }
    if (msg.cmd === "readList") {
      const r = await readCurrentList(msg.items || []);
      sendResponse(r);
      return;
    }
    if (msg.cmd === "startSearch") {
      if (state.running) { sendResponse({ ok: false, error: "이미 진행 중입니다." }); return; }
      const opts = { ...DEFAULTS, ...(msg.opts || {}) };
      const items = (msg.items || []).filter((it) => it && it.id && (it.query || it.name));
      if (!items.length) {
        sendResponse({ ok: false, error: "검색할 목록이 비어 있습니다." });
        return;
      }
      // 이미 '확실'로 찾은 것은 다시 하지 않는다 (이어하기).
      // '애매'는 다시 해 본다 — 검색 결과가 그때그때 달라 다음엔 맞을 수 있다.
      state.searchQueue = items.filter(
        (it) => !(state.found[it.id] && state.found[it.id].verdict === "확실"));
      state.notice = "";
      await save();
      sendResponse({ ok: true, queued: state.searchQueue.length, total: items.length });
      searchLoop(opts);
      return;
    }
    if (msg.cmd === "stop") {
      state.stopRequested = true;
      await save();
      sendResponse({ ok: true });
      return;
    }
    if (msg.cmd === "status") {
      if (state.mode === "search") {
        sendResponse({
          ok: true, mode: "search",
          running: state.running,
          remaining: state.searchQueue.length,
          current: state.current,
          counts: Object.values(state.found).reduce((a, r) => {
            a[r.verdict] = (a[r.verdict] || 0) + 1; return a;
          }, {}),
          message: [state.notice, state.message].filter(Boolean).join("\n"),
          doneIds: Object.values(state.found)
            .filter((r) => r.verdict === "확실").map((r) => r.id),
          vagueIds: Object.values(state.found)
            .filter((r) => r.verdict === "애매").map((r) => r.id),
          exportedCount: state.exportedCount || 0,
          exportedAt: state.exportedAt || "",
          recent: Object.values(state.found).slice(-5).map((r) =>
            `${r.id}: ${r.verdict}` +
            (r.pid ? ` · ${r.pid}` : "") +
            (r.matchedName ? ` · ${r.matchedName.slice(0, 26)}` : "")),
        });
        return;
      }
      sendResponse({
        ok: true, mode: "collect",
        running: state.running,
        remaining: state.queue.length,
        current: state.current,
        counts: Object.values(state.done).reduce((a, r) => {
          a[r.status] = (a[r.status] || 0) + 1; return a;
        }, {}),
        message: [state.notice, state.message].filter(Boolean).join("\n"),
        // 항목별 결과를 몇 줄이라도 보여준다. 숫자만 보고 성공으로 오해하지
        // 않도록, 이미지 장수와 어디서 긁었는지를 함께 내보낸다.
        recent: Object.values(state.done).slice(-5).map((r) => {
          const lab = { ok: "성공", blocked: "차단", no_images: "이미지없음", fail: "실패" };
          return `${r.id}: ${lab[r.status] || r.status} · 이미지 ${r.images || 0}장` +
                 (r.lowYield ? " ⚠ 확인 필요" : "") +
                 (r.folder ? ` · ${r.folder}/` : "") +
                 (r.fallback ? " · 상세영역 못찾음" : "");
        }),
      });
      return;
    }
    // 파일로 내보낸 사실을 기록한다.
    //
    // 왜: 찾은 결과는 크롬 안에만 있다. 컴퓨터를 옮기면 따라오지 않는다.
    // 실제로 131건을 찾아 두고 내보내지 않은 채 다른 컴퓨터로 옮겨 전부 날렸다.
    // 그래서 '아직 안 내보냈다'를 눈에 보이게 한다.
    if (msg.cmd === "markExported") {
      state.exportedCount = Object.values(state.found)
        .filter((r) => r.verdict === "확실").length;
      state.exportedAt = new Date().toISOString();
      await save();
      sendResponse({ ok: true, exportedCount: state.exportedCount });
      return;
    }
    if (msg.cmd === "export") {
      sendResponse({ ok: true, results: state.done, found: state.found });
      return;
    }
    if (msg.cmd === "setMode") {
      if (!state.running) { state.mode = msg.mode === "search" ? "search" : "collect"; await save(); }
      sendResponse({ ok: true, mode: state.mode });
      return;
    }
    if (msg.cmd === "resetSearch") {
      state.found = {}; state.searchQueue = []; state.message = ""; state.notice = "";
      state.exportedCount = 0; state.exportedAt = "";
      await save();
      sendResponse({ ok: true });
      return;
    }
    if (msg.cmd === "reset") {
      state.done = {}; state.queue = []; state.message = ""; state.notice = "";
      await save();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "알 수 없는 명령" });
   } catch (e) {
     // 여기서 막지 않으면 응답이 영영 안 간다. 화면은 아무 말 없이 멈춘 것처럼 보인다.
     console.error("명령 처리 중 오류", msg && msg.cmd, e);
     sendResponse({ ok: false, error: `오류가 났습니다: ${e.message}` });
   }
  })();
  return true;   // 비동기 응답
});
