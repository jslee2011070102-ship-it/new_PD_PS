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

const DEFAULTS = {
  gapMin: 12,      // 상품 사이 최소 대기(초)
  gapMax: 25,      // 상품 사이 최대 대기(초)
  stopAfterFails: 3,
  folder: "coupang_usp",
  saveImages: true,  // false 면 주소만 모은다 (훨씬 빠르고 디스크도 안 쓴다)
  tryMobile: true,   // 실패하면 모바일 주소로 한 번 더
};

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
  return String(s).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function extOf(url) {
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp)$/i);
  return m ? m[1].toLowerCase() : "jpg";
}

async function downloadImages(id, images, folder, log) {
  let ok = 0;
  for (let i = 0; i < images.length; i++) {
    const url = images[i].url;
    const filename = `${folder}/${safeName(id)}/${String(i + 1).padStart(3, "0")}.${extOf(url)}`;
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
    images: 0, imageUrls: [], savedFiles: 0, log, at: new Date().toISOString(),
  };
  try {
    let r = await visitAndCollect(item.url, log);
    if (r) log.push(...(r.log || []));

    // PC 주소가 막히거나 이미지를 못 찾으면 모바일 주소로 한 번 더 시도한다.
    // 모바일 화면은 구조가 단순해 이미지가 더 잘 잡히는 경우가 있다.
    if (opts.tryMobile && (!r || r.reason === "blocked" || !r.images || r.images.length === 0)) {
      for (const mu of mobileCandidates(item.url)) {
        log.push(`모바일 주소로 재시도: ${mu}`);
        await sleep(rand(2000, 4000));
        const r2 = await visitAndCollect(mu, log);
        if (r2) log.push(...(r2.log || []));
        if (r2 && r2.images && r2.images.length > 0) {
          r = r2; rec.usedUrl = mu;
          log.push("모바일 주소에서 성공");
          break;
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
      rec.savedFiles = await downloadImages(item.id, r.images, opts.folder, log);
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
      // 이미 성공한 항목은 건너뛴다 (이어하기)
      state.queue = (msg.items || []).filter(
        (it) => !(state.done[it.id] && state.done[it.id].status === "ok"));
      await save();
      sendResponse({ ok: true, queued: state.queue.length });
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
        message: state.message,
      });
      return;
    }
    if (msg.cmd === "export") {
      sendResponse({ ok: true, results: state.done });
      return;
    }
    if (msg.cmd === "reset") {
      state.done = {}; state.queue = []; state.message = "";
      await save();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "알 수 없는 명령" });
  })();
  return true;   // 비동기 응답
});
