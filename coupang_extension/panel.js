/* 사이드 패널 화면. 목록을 받아 background 로 넘기고, 진행 상황을 보여준다. */

const $ = (id) => document.getElementById(id);

/* ── 주소 목록 읽기 ──────────────────────────────────────────────
 *
 * 예전 방식은 정규식 하나로 "이름 주소" 를 한 번에 맞추려 했다.
 * 쿠팡 주소는 ?searchId=...&clickEventId=...&q=%EB%9D%BC... 처럼 아주 길어서
 * 붙여넣을 때 줄이 접히거나 뒤가 잘리는 일이 생긴다. 그러면 잘린 주소가
 * 조용히 목록에 들어가 엉뚱한 페이지를 긁고도 "성공" 으로 끝난다.
 *
 * 그래서 방식을 바꿨다.
 *   1) 줄에서 http 가 처음 나오는 자리를 찾는다. 그 앞은 이름, 뒤는 주소다.
 *      → 이름과 주소를 나누는 구분자로 | , 쉼표 , 탭 , 공백 아무거나 쓸 수 있다.
 *   2) 주소에서 딜번호(.../vp/products/숫자)를 뽑아 본다.
 *      못 뽑으면 잘린 주소다. 버리지 않고 화면에 경고로 보여준다.
 *   3) 이름을 안 붙였으면 딜번호를 이름으로 쓴다. 001, 002 보다 안전하다.
 *      줄 순서가 바뀌어도 같은 상품은 늘 같은 이름·같은 폴더로 간다.
 */

const PID_RE = /\/v[pm]\/products\/(\d+)/;

function pidOf(url) {
  try {
    const m = new URL(url).pathname.match(PID_RE);
    return m ? m[1] : "";
  } catch (e) {
    const m = String(url).match(PID_RE);   // new URL 이 실패해도 한 번 더 본다
    return m ? m[1] : "";
  }
}

function cleanUrl(url) {
  // 검색 추적용 꼬리표를 떼어낸다. 상품을 가리키는 데 필요한 건 옵션 번호뿐이다.
  try {
    const u = new URL(url);
    const sp = new URLSearchParams();
    for (const k of ["itemId", "vendorItemId"]) {
      const v = u.searchParams.get(k);
      if (v) sp.set(k, v);
    }
    const q = sp.toString();
    u.search = q ? "?" + q : "";
    u.hash = "";
    return u.href;
  } catch (e) { return url; }
}

function parseItems(text) {
  const items = [];
  const problems = [];
  const seen = new Set();
  let auto = 0;

  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const no = i + 1;

    const at = line.search(/https?:\/\//);
    if (at < 0) {
      problems.push({ no, text: line, why: "주소(http…)가 없는 줄이라 건너뜁니다" });
      return;
    }

    // 이름: 주소 앞부분에서 구분자(| , 탭 공백)를 떼어낸다
    let label = line.slice(0, at).replace(/[|,\t\s]+$/, "").trim();
    // 주소: http 부터 공백이나 | 가 나올 때까지
    let url = line.slice(at).split(/[\s|]/)[0];

    if (!/coupang\.com/.test(url)) {
      problems.push({ no, text: url.slice(0, 50), why: "쿠팡 주소가 아닙니다" });
      return;
    }

    const pid = pidOf(url);
    if (!pid) {
      problems.push({
        no, text: url.slice(0, 50) + (url.length > 50 ? "…" : ""),
        why: "딜번호를 찾을 수 없습니다 — 주소가 잘린 것 같습니다",
      });
      return;
    }

    url = cleanUrl(url);
    if (!label) { label = pid; }                       // 이름이 없으면 딜번호를 쓴다
    let id = label;
    if (seen.has(id)) {
      // 같은 딜번호가 두 번 들어오면 뒤의 것은 버린다. 같은 상품이니 한 번만 하면 된다.
      if (id === pid) { problems.push({ no, text: pid, why: "같은 딜번호가 이미 있어 건너뜁니다" }); return; }
      auto++; id = `${label}_${auto}`;                 // 이름만 겹치면 번호를 붙인다
    }
    seen.add(id);
    items.push({ id, label, url, pid });
  });

  return { items, problems };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function preview() {
  const { items, problems } = parseItems($("urls").value);
  const mode = $("folderMode").value;
  if (!items.length && !problems.length) { $("preview").innerHTML = ""; return { items, problems }; }

  const rows = items.map((it) => {
    const folder =
      mode === "label" ? it.label :
      mode === "id_title" ? `${it.pid}_제품명` :
      it.pid;
    return `<tr><td>${esc(it.id)}</td><td class="pid">${esc(it.pid)}</td><td>${esc(folder)}/</td></tr>`;
  }).join("");

  const probs = problems.map((p) =>
    `<div class="bad">${p.no}번째 줄 — ${esc(p.why)}<br><span class="mono">${esc(p.text)}</span></div>`
  ).join("");

  $("preview").innerHTML =
    (items.length
      ? `<div class="okline">확인된 상품 ${items.length}개</div>
         <table><tr><th>항목</th><th>딜번호</th><th>저장될 폴더</th></tr>${rows}</table>`
      : `<div class="bad">확인된 상품이 없습니다.</div>`) + probs;

  return { items, problems };
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

/* ── ① 주소 찾기 ────────────────────────────────────────────────
 * 검색목록.json 을 붙여넣으면 제품명으로 쿠팡을 검색해 주소를 찾는다.
 * 여기서는 목록을 읽어 넘기기만 하고, 맞는지 따지는 일은 background 가 한다.
 */
function parseJobs(text) {
  const t = String(text || "").trim();
  if (!t) return { items: [], error: "" };
  let data;
  try { data = JSON.parse(t); }
  catch (e) { return { items: [], error: "JSON 을 읽지 못했습니다. 파일 내용을 통째로 붙여넣었는지 확인해 주세요." }; }
  if (!Array.isArray(data)) return { items: [], error: "목록(대괄호 [ ] 로 시작하는 형태)이어야 합니다." };
  const items = data.filter((x) => x && x.id && (x.query || x.name));
  if (items.length === 0) return { items: [], error: "id 와 제품명이 있는 항목이 없습니다." };
  return { items, error: "" };
}

function jobsInfo() {
  const { items, error } = parseJobs($("jobs").value);
  if (error) { $("jobsInfo").innerHTML = `<span class="warn">${error}</span>`; return items; }
  if (!items.length) { $("jobsInfo").textContent = ""; return items; }
  const cats = {};
  for (const x of items) cats[x.cat || "-"] = (cats[x.cat || "-"] || 0) + 1;
  const withPrice = items.filter((x) => x.price).length;
  $("jobsInfo").textContent =
    `${items.length}개 읽음 (${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(", ")})` +
    `\n가격이 있어 대조 가능한 것 ${withPrice}개`;
  return items;
}

function showPane(id) {
  for (const b of document.querySelectorAll(".tabs button")) {
    b.classList.toggle("on", b.dataset.pane === id);
  }
  for (const d of document.querySelectorAll(".pane")) {
    d.classList.toggle("on", d.id === id);
  }
  send({ cmd: "setMode", mode: id === "paneSearch" ? "search" : "collect" }).then(refresh);
}
for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => showPane(b.dataset.pane));
}
$("jobs").addEventListener("input", jobsInfo);

$("readList").addEventListener("click", async () => {
  const items = jobsInfo();
  if (!items.length) { $("status").textContent = "먼저 검색목록.json 내용을 붙여넣어 주세요."; return; }
  $("status").textContent = "지금 보는 화면을 읽는 중…";
  const r = await send({ cmd: "readList", items });
  if (!r || !r.ok) {
    $("status").textContent = (r && r.error) || "읽지 못했습니다.";
    if (r && r.log) $("status").textContent += "\n\n" + r.log.join("\n");
    return;
  }
  $("status").textContent =
    `이 화면에서 상품 ${r.total}개를 읽어\n` +
    `확실 ${r.found}개 / 애매 ${r.vague}개를 맞췄습니다.\n` +
    (r.left > 0
      ? `아직 못 찾은 것 ${r.left}개.\n\n다른 화면으로 옮겨서 또 누르시면 됩니다. 결과는 쌓입니다.`
      : `\n다 찾았습니다. '결과 내보내기' 로 저장해 주세요.`);
  refresh();
});

$("startSearch").addEventListener("click", async () => {
  const items = jobsInfo();
  if (!items.length) return;
  const gapMin = Math.max(5, parseInt($("gapMin").value, 10) || 12);
  const gapMax = Math.max(gapMin, parseInt($("gapMax").value, 10) || 25);
  const r = await send({ cmd: "startSearch", items, opts: { gapMin, gapMax } });
  if (!r || !r.ok) { $("status").textContent = r ? r.error : "시작하지 못했습니다."; return; }
  const skipped = r.total - r.queued;
  $("status").textContent = `${r.queued}개를 검색합니다.` +
    (skipped > 0 ? ` (이미 확실하게 찾은 ${skipped}개는 건너뜁니다)` : "") +
    `\n패널을 닫아도 계속 진행됩니다.`;
  refresh();
});

$("stopSearch").addEventListener("click", async () => {
  await send({ cmd: "stop" });
  $("status").textContent = "중단 요청을 보냈습니다. 진행 중인 한 건을 마치고 멈춥니다.";
});

$("resetSearch").addEventListener("click", async () => {
  if (!confirm("지금까지 찾은 주소 기록을 지웁니다. 계속할까요?")) return;
  await send({ cmd: "resetSearch" });
  refresh();
});

async function refresh() {
  const s = await send({ cmd: "status" });
  if (!s || !s.ok) { $("status").textContent = "상태를 읽지 못했습니다."; return; }
  const c = s.counts || {};
  const label = { ok: "성공", blocked: "차단", no_images: "이미지없음", fail: "실패" };
  const parts = Object.entries(c).map(([k, v]) => `${label[k] || k} ${v}`);
  const what = s.mode === "search" ? "주소 찾기" : "이미지 수집";
  const lines = [];
  lines.push(s.running ? `${what} 진행 중 — 남은 ${s.remaining}개`
                       : `${what} 대기 중 — 남은 ${s.remaining}개`);
  if (s.current) lines.push(`지금: ${s.current}`);
  if (parts.length) lines.push(`결과: ${parts.join(" / ")}`);
  if (s.message) lines.push(s.message);
  if (s.recent && s.recent.length) {
    lines.push("");
    for (const x of s.recent) lines.push(`  ${x}`);
  }
  $("status").textContent = lines.join("\n");
  $("start").disabled = s.running;
  $("stop").disabled = !s.running;
  $("startSearch").disabled = s.running;
  $("stopSearch").disabled = !s.running;
}

$("useTab").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/coupang\.com/.test(tab.url || "")) {
    $("status").textContent = "지금 탭이 쿠팡 상품 페이지가 아닙니다.";
    return;
  }
  const box = $("urls");
  box.value = (box.value ? box.value.replace(/\s*$/, "") + "\n" : "") + tab.url;
  preview();
});

$("clear").addEventListener("click", () => { $("urls").value = ""; preview(); });

// 주소를 고치면 바로 미리보기를 다시 그린다. 시작 전에 눈으로 확인할 수 있게.
$("urls").addEventListener("input", preview);
$("folderMode").addEventListener("change", preview);

$("start").addEventListener("click", async () => {
  const { items, problems } = preview();
  if (items.length === 0) {
    $("status").textContent = "쿠팡 상품 주소를 한 줄에 하나씩 넣어 주세요.";
    return;
  }
  if (problems.length) {
    const ok = confirm(
      `읽을 수 없는 줄이 ${problems.length}개 있습니다.\n` +
      `이 줄들은 건너뛰고 ${items.length}개만 수집합니다.\n\n그대로 시작할까요?`);
    if (!ok) return;
  }
  const gapMin = Math.max(5, parseInt($("gapMin").value, 10) || 12);
  const gapMax = Math.max(gapMin, parseInt($("gapMax").value, 10) || 25);
  const saveImages = !$("urlOnly").checked;
  const tryMobile = $("tryMobile").checked;
  const folderMode = $("folderMode").value;
  const r = await send({
    cmd: "start",
    items: items.map(({ id, label, url }) => ({ id, label, url })),
    opts: { gapMin, gapMax, saveImages, tryMobile, folderMode },
  });
  if (!r || !r.ok) { $("status").textContent = r ? r.error : "시작하지 못했습니다."; return; }
  $("status").textContent = `${r.queued}개를 시작했습니다. 패널을 닫아도 계속 진행됩니다.` +
    (saveImages ? "" : "\n이미지 파일은 저장하지 않습니다. 이미지 주소는 기록에 남습니다.");
  refresh();
});

$("stop").addEventListener("click", async () => {
  await send({ cmd: "stop" });
  $("status").textContent = "중단 요청을 보냈습니다. 진행 중인 한 건을 마치고 멈춥니다.";
});

$("export").addEventListener("click", async () => {
  // 패널에서 직접 내려받지 않는다. 패널이 닫히면 임시 주소가 사라져서 저장이
  // 조용히 실패한다(실제로 그렇게 실패했다). 닫히지 않는 탭에서 처리한다.
  await chrome.tabs.create({ url: chrome.runtime.getURL("results.html") });
  $("status").textContent = "결과 페이지를 새 탭에 열었습니다.\n거기서 저장하거나 복사하시면 됩니다.";
});

$("reset").addEventListener("click", async () => {
  if (!confirm("지금까지의 수집 기록을 지웁니다. 계속할까요?\n(내려받은 이미지는 지워지지 않습니다)")) return;
  await send({ cmd: "reset" });
  refresh();
});

preview();
jobsInfo();
refresh();
setInterval(refresh, 2000);
