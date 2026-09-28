/* 팝업 화면. 목록을 받아 background 로 넘기고, 진행 상황을 보여준다. */

const $ = (id) => document.getElementById(id);

function parseItems(text) {
  const out = [];
  const seen = new Set();
  let auto = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // "이름 주소" 또는 "이름,주소" 또는 주소만
    const m = line.match(/^(\S+)[\s,]+(https?:\/\/\S+)$/);
    let id, url;
    if (m) { id = m[1]; url = m[2]; }
    else if (/^https?:\/\//.test(line)) { auto++; id = String(auto).padStart(3, "0"); url = line; }
    else continue;
    if (!/coupang\.com/.test(url)) continue;
    if (seen.has(id)) id = `${id}_${out.length + 1}`;
    seen.add(id);
    out.push({ id, url });
  }
  return out;
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function refresh() {
  const s = await send({ cmd: "status" });
  if (!s || !s.ok) { $("status").textContent = "상태를 읽지 못했습니다."; return; }
  const c = s.counts || {};
  const label = { ok: "성공", blocked: "차단", no_images: "이미지없음", fail: "실패" };
  const parts = Object.entries(c).map(([k, v]) => `${label[k] || k} ${v}`);
  const lines = [];
  lines.push(s.running ? `진행 중 — 남은 ${s.remaining}개` : `대기 중 — 남은 ${s.remaining}개`);
  if (s.current) lines.push(`지금: ${s.current}`);
  if (parts.length) lines.push(`결과: ${parts.join(" / ")}`);
  if (s.message) lines.push(s.message);
  $("status").textContent = lines.join("\n");
  $("start").disabled = s.running;
  $("stop").disabled = !s.running;
}

$("useTab").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/coupang\.com/.test(tab.url || "")) {
    $("status").textContent = "지금 탭이 쿠팡 상품 페이지가 아닙니다.";
    return;
  }
  const box = $("urls");
  box.value = (box.value ? box.value.replace(/\s*$/, "") + "\n" : "") + tab.url;
});

$("clear").addEventListener("click", () => { $("urls").value = ""; });

$("start").addEventListener("click", async () => {
  const items = parseItems($("urls").value);
  if (items.length === 0) {
    $("status").textContent = "쿠팡 상품 주소를 한 줄에 하나씩 넣어 주세요.";
    return;
  }
  const gapMin = Math.max(5, parseInt($("gapMin").value, 10) || 12);
  const gapMax = Math.max(gapMin, parseInt($("gapMax").value, 10) || 25);
  const saveImages = !$("urlOnly").checked;
  const tryMobile = $("tryMobile").checked;
  const r = await send({ cmd: "start", items, opts: { gapMin, gapMax, saveImages, tryMobile } });
  if (!r || !r.ok) { $("status").textContent = r ? r.error : "시작하지 못했습니다."; return; }
  $("status").textContent = `${r.queued}개를 시작했습니다. 창을 닫아도 계속 진행됩니다.` +
    (saveImages ? "" : "\n주소만 모으는 방식이라 이미지는 저장되지 않습니다.");
  refresh();
});

$("stop").addEventListener("click", async () => {
  await send({ cmd: "stop" });
  $("status").textContent = "중단 요청을 보냈습니다. 진행 중인 한 건을 마치고 멈춥니다.";
});

$("export").addEventListener("click", async () => {
  const r = await send({ cmd: "export" });
  if (!r || !r.ok) return;
  const blob = new Blob([JSON.stringify(r.results, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: "coupang_usp/수집기록.json", conflictAction: "overwrite" });
  const n = Object.keys(r.results).length;
  $("status").textContent = `수집기록.json 을 내려받았습니다 (${n}건).\n` +
    `다운로드 폴더의 coupang_usp 안에 있습니다. 이 파일을 Claude 에게 보내주세요.`;
});

$("reset").addEventListener("click", async () => {
  if (!confirm("지금까지의 수집 기록을 지웁니다. 계속할까요?\n(내려받은 이미지는 지워지지 않습니다)")) return;
  await send({ cmd: "reset" });
  refresh();
});

refresh();
setInterval(refresh, 2000);
