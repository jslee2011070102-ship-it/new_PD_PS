/* 수집 결과 페이지.
 *
 * 왜 팝업이 아니라 별도 페이지인가
 * --------------------------------
 * 팝업에서 URL.createObjectURL 로 만든 임시 주소는 팝업이 닫히는 순간 사라진다.
 * 다운로드가 시작되기도 전에 주소가 없어져서, 아무 오류 없이 파일이 생기지 않았다.
 * (실제로 그렇게 실패했다.)
 *
 * 이 페이지는 탭으로 열리므로 닫히지 않는다. 여기서 만든 주소는 살아 있고,
 * 저장이 안 되더라도 화면에서 바로 복사할 수 있다. 저장 경로를 둘로 둔 이유다.
 */

const $ = (id) => document.getElementById(id);
let RESULTS = {};
let FOUND = {};
let JOBS = [];   // 확장에 들어 있는 전체 목록 (아직 손도 못 댄 항목까지 보려면 필요)

const LABEL = { ok: "성공", blocked: "차단", no_images: "이미지없음", fail: "실패" };

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderReview() {
  // 확정되지 않은 **모든** 항목을 보여준다.
  //
  // 예전에는 '쓸 만한 후보(이름 50% 이상)가 있는 것'만 보여줬다. 그래서
  // 후보가 시원찮은 19건은 **화면에 뜨지도 않으면서 '애매'로 집계만** 됐다.
  // 사용자는 "다 집어넣었는데 왜 애매가 남아 있냐"고 물을 수밖에 없었다.
  // 끝내지 못한 일은 전부 보여야 하고, 전부 끝낼 수단이 있어야 한다.
  const plausible = (r) => (r.candidates || [])
    .filter((c) => (c.nameScore || 0) >= 0.5)
    .sort((a, b) => (b.nameScore || 0) - (a.nameScore || 0));

  // 목록 전체를 기준으로 삼는다. 기록이 아예 없는 항목(한 번도 안 걸린 것)도 포함.
  const base = JOBS.length
    ? JOBS.map((j) => [j.id, FOUND[j.id] || {
        id: j.id, name: j.name, wantSize: j.size, wantCount: j.count,
        wantPrice: j.price, verdict: "못찾음", candidates: [] }])
    : Object.entries(FOUND);

  const need = base
    .filter(([, r]) => r.verdict !== "확실")
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ko"));

  if (!need.length) {
    $("reviewWrap").innerHTML = '<div class="empty">모두 확정됐습니다. 남은 항목이 없습니다.</div>';
    $("reviewNote").style.display = "none";
    return;
  }
  $("reviewNote").style.display = "";

  $("reviewWrap").innerHTML =
    `<div style="margin-bottom:10px"><b>아직 확정되지 않은 ${need.length}건</b> —
      맞는 후보를 누르거나, 주소를 직접 넣어 끝내시면 됩니다.</div>` +
    need.map(([id, r]) => {
      const ok = plausible(r);
      const body = ok.length
        ? `<table>
             <tr><th>딜번호</th><th>화면에서 찾은 것</th><th>가격</th><th>왜 보류했나</th><th></th></tr>
             ${ok.slice(0, 4).map((c) => `
               <tr>
                 <td>${esc(c.pid)}</td>
                 <td>${esc((c.name || "").slice(0, 60))}</td>
                 <td class="num">${c.price ? c.price.toLocaleString() : "-"}</td>
                 <td>${esc(c.why || "")}</td>
                 <td><button class="pick" data-id="${esc(id)}" data-pid="${esc(c.pid)}">이게 맞음</button></td>
               </tr>`).join("")}
           </table>`
        : `<div class="nocand">볼 만한 후보가 없습니다 —
             화면에 이 제품이 없었다는 뜻입니다. 주소를 직접 넣어 주세요.</div>`;
      return `<div class="rev">
        <div class="want"><b>${esc(id)}</b> — 찾는 것:
          ${esc(r.name || "")} <b>/ ${esc(r.wantSize || "?")} / ${esc(r.wantCount || "?")}
          / ${r.wantPrice ? r.wantPrice.toLocaleString() + "원" : "?"}</b></div>
        ${body}
        <div class="manual">
          <b>쿠팡에서 그 제품을 찾아 주소창을 복사</b>해 여기 붙여넣으세요 (엔터로도 됩니다).
          <div class="manualrow">
            <input type="text" class="murl" data-id="${esc(id)}"
                   placeholder="https://www.coupang.com/vp/products/...">
            <button class="msave" data-id="${esc(id)}">주소로 확정</button>
          </div>
          <div class="merr" data-id="${esc(id)}"></div>
        </div>
      </div>`;
    }).join("");

  for (const b of document.querySelectorAll(".pick")) {
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "확정 중…";
      const r = await send({ cmd: "confirmMatch", id: b.dataset.id, pid: b.dataset.pid });
      if (r && r.ok) await load();
      else { b.disabled = false; b.textContent = "이게 맞음"; alert((r && r.error) || "실패"); }
    });
  }
  const saveManual = async (id) => {
    const input = document.querySelector(`.murl[data-id="${CSS.escape(id)}"]`);
    const err = document.querySelector(`.merr[data-id="${CSS.escape(id)}"]`);
    if (!input) return;
    const url = input.value.trim();
    if (!url) { err.textContent = "주소를 붙여넣어 주세요."; return; }
    err.textContent = "확인 중…";
    // 기록이 없는 항목이면 background 가 새로 만들 수 있도록 정보를 함께 보낸다.
    const job = JOBS.find((j) => j.id === id) || {};
    const r = await send({ cmd: "setUrlManually", id, url, item: job });
    if (r && r.ok) await load();
    else err.textContent = (r && r.error) || "실패했습니다.";
  };
  for (const b of document.querySelectorAll(".msave")) {
    b.addEventListener("click", () => saveManual(b.dataset.id));
  }
  for (const i of document.querySelectorAll(".murl")) {
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") saveManual(i.dataset.id); });
  }
}

function renderFound() {
  const ids = Object.keys(FOUND);
  if (!ids.length) { $("foundWrap").innerHTML = ""; $("foundSummary").textContent = ""; return; }
  const c = {};
  for (const r of Object.values(FOUND)) c[r.verdict] = (c[r.verdict] || 0) + 1;
  $("foundSummary").textContent =
    `주소 찾기 ${ids.length}건 · ` + Object.entries(c).map(([k, v]) => `${k} ${v}`).join(" / ");

  const rows = ids.map((id) => {
    const r = FOUND[id];
    const cls = r.verdict === "확실" ? "ok" : r.verdict === "애매" ? "warn" : "bad";
    const c0 = (r.candidates && r.candidates[0]) || {};
    const gap = c0.priceGap !== null && c0.priceGap !== undefined
      ? Math.round(c0.priceGap * 100) + "%" : "-";
    return `<tr class="${cls}">
      <td>${esc(id)}</td>
      <td><b>${esc(r.verdict)}</b></td>
      <td>${esc(r.pid || "-")}</td>
      <td>${esc((r.name || "").slice(0, 34))}</td>
      <td>${esc((r.matchedName || "").slice(0, 34))}</td>
      <td class="num">${r.wantPrice ? r.wantPrice.toLocaleString() : "-"}</td>
      <td class="num">${r.matchedPrice ? r.matchedPrice.toLocaleString() : "-"}</td>
      <td class="num">${gap}</td>
      <td>${esc(c0.why || "")}</td>
    </tr>`;
  }).join("");
  $("foundWrap").innerHTML = `<table>
    <tr><th>항목</th><th>판정</th><th>딜번호</th><th>찾던 제품</th><th>찾은 제품</th>
        <th>기대가</th><th>실제가</th><th>가격차</th><th>판정 사유</th></tr>${rows}</table>`;
}

function render() {
  renderReview();
  renderFound();
  const ids = Object.keys(RESULTS);
  const counts = {};
  let imgTotal = 0;
  for (const r of Object.values(RESULTS)) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    imgTotal += r.images || 0;
  }
  const parts = Object.entries(counts).map(([k, v]) => `${LABEL[k] || k} ${v}`);
  $("summary").textContent = ids.length
    ? `${ids.length}건 · ${parts.join(" / ")} · 이미지 합계 ${imgTotal}장`
    : "아직 수집한 것이 없습니다.";

  if (!ids.length) {
    $("tableWrap").innerHTML = Object.keys(FOUND).length
      ? '<div class="empty">이미지 수집은 아직 하지 않았습니다.</div>'
      : '<div class="empty">수집을 먼저 실행해 주세요.</div>';
    $("json").value = Object.keys(FOUND).length ? JSON.stringify(FOUND, null, 2) : "";
    return;
  }

  const rows = ids.map((id) => {
    const r = RESULTS[id];
    const good = r.status === "ok";
    // 어디서 긁었는지, 몇 장을 걸러냈는지가 판단에 가장 중요한 정보다.
    const keep = (r.log || []).filter((l) =>
      /영역|제외|채택|더보기|차단|프레임|모바일|오류|딜번호|폴더|적습니다|기다림|도착/.test(l));
    return `<tr class="${good ? "ok" : "bad"}">
      <td>${esc(id)}</td>
      <td>${esc(r.productId || "-")}</td>
      <td>${esc(LABEL[r.status] || r.status)}</td>
      <td class="num">${r.images || 0}${r.lowYield ? " ⚠" : ""}</td>
      <td>${esc(r.folder ? r.folder + "/" : "")}</td>
      <td>${esc(r.scope || "")}${r.fallback ? " <b>[상세영역 못찾음]</b>" : ""}</td>
      <td>${esc((r.title || "").slice(0, 45))}</td>
      <td class="log">${esc(keep.join("\n"))}</td>
    </tr>`;
  }).join("");

  $("tableWrap").innerHTML = `<table>
    <tr><th>항목</th><th>딜번호</th><th>결과</th><th>이미지</th><th>폴더</th>
        <th>수집 범위</th><th>제목</th><th>진행 기록</th></tr>
    ${rows}</table>`;
  $("json").value = JSON.stringify(RESULTS, null, 2);
}

async function load() {
  if (!JOBS.length) {
    // 확장에 들어 있는 전체 목록. 기록이 없는 항목도 확인 화면에 띄우려면 필요하다.
    try {
      const res = await fetch(chrome.runtime.getURL("search_list.json"));
      if (res.ok) JOBS = await res.json();
    } catch (e) { JOBS = []; }
  }
  const r = await send({ cmd: "export" });
  RESULTS = (r && r.ok && r.results) || {};
  FOUND = (r && r.ok && r.found) || {};
  render();
}

$("save").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(RESULTS, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  // 이 페이지는 닫히지 않으므로 주소가 살아 있다. 브라우저 기본 저장 기능을 쓴다.
  const a = document.createElement("a");
  a.href = url;
  a.download = "수집기록.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  $("summary").textContent += "  —  저장했습니다 (다운로드 폴더)";
});

$("saveFound").addEventListener("click", () => {
  if (!Object.keys(FOUND).length) { $("foundSummary").textContent = "찾은 주소가 없습니다."; return; }
  const blob = new Blob([JSON.stringify(FOUND, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "검색결과.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  send({ cmd: "markExported" });   // 패널의 '아직 안 내보냈다' 경고를 끈다
  $("foundSummary").textContent += "  —  저장했습니다 (다운로드 폴더)";
});

$("copy").addEventListener("click", async () => {
  const t = $("json");
  try {
    await navigator.clipboard.writeText(t.value);
    $("summary").textContent += "  —  복사했습니다";
  } catch (e) {
    t.select();
    document.execCommand("copy");
    $("summary").textContent += "  —  복사했습니다";
  }
});

$("reload").addEventListener("click", load);
load();
