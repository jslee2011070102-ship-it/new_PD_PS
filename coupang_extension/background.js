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
  saveImages: true,  // false 면 주소만 모은다 (훨씬 빠르고 디스크도 안 쓴다)
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
      // 주소만 모으는 방식. 이미지 서버(coupangcdn)는 따로 막혀 있지 않아
      // 주소만 있으면 나중에 받아서 볼 수 있다. 훨씬 빠르고 디스크도 안 쓴다.
      rec.status = "ok";
      log.push(`주소만 수집 (내려받기 건너뜀): ${rec.images}개`);
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
    if (msg.cmd === "stop") {
      state.stopRequested = true;
      await save();
      sendResponse({ ok: true });
      return;
    }
    if (msg.cmd === "status") {
      sendResponse({
        ok: true,
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
    if (msg.cmd === "export") {
      sendResponse({ ok: true, results: state.done });
      return;
    }
    if (msg.cmd === "reset") {
      state.done = {}; state.queue = []; state.message = ""; state.notice = "";
      await save();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "알 수 없는 명령" });
  })();
  return true;   // 비동기 응답
});
