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

const LABEL = { ok: "성공", blocked: "차단", no_images: "이미지없음", fail: "실패" };

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderReview() {
  // 후보를 전부 보여주면 눈이 피곤하다. 이름이 반도 안 맞는 건 볼 가치가 없다.
  // 사람이 판단할 만한 것만 남기고, 그럴듯한 순서로 세운다.
  const plausible = (r) => (r.candidates || [])
    .filter((c) => (c.nameScore || 0) >= 0.5)
    .sort((a, b) => (b.nameScore || 0) - (a.nameScore || 0));

  const need = Object.entries(FOUND)
    .filter(([, r]) => r.verdict !== "확실" && plausible(r).length)
    .sort((a, b) => (plausible(b[1])[0].nameScore || 0) - (plausible(a[1])[0].nameScore || 0));
  if (!need.length) {
    const stuck = Object.values(FOUND).filter((r) => r.verdict !== "확실").length;
    $("reviewWrap").innerHTML = stuck
      ? `<div class="empty">볼 만한 후보가 있는 항목이 없습니다.<br>
         아직 못 찾은 ${stuck}건은 화면에 그 제품이 없었다는 뜻입니다 —
         다른 화면에서 다시 읽어 보세요.</div>`
      : '<div class="empty">확인할 항목이 없습니다.</div>';
    $("reviewNote").style.display = "none";
    return;
  }
  $("reviewNote").style.display = "";
  $("reviewWrap").innerHTML = need.map(([id, r]) => {
    const cands = plausible(r).slice(0, 4).map((c) => `
      <tr>
        <td>${esc(c.pid)}</td>
        <td>${esc((c.name || "").slice(0, 60))}</td>
        <td class="num">${c.price ? c.price.toLocaleString() : "-"}</td>
        <td>${esc(c.why || "")}</td>
        <td><button class="pick" data-id="${esc(id)}" data-pid="${esc(c.pid)}">이게 맞음</button></td>
      </tr>`).join("");
    return `<div class="rev">
      <div class="want"><b>${esc(id)}</b> — 찾는 것:
        ${esc(r.name || "")} <b>/ ${esc(r.wantSize || "?")} / ${esc(r.wantCount || "?")}
        / ${r.wantPrice ? r.wantPrice.toLocaleString() + "원" : "?"}</b></div>
      <table>
        <tr><th>딜번호</th><th>화면에서 찾은 것</th><th>가격</th><th>왜 보류했나</th><th></th></tr>
        ${cands}
      </table>
      <div style="margin:4px 0 0"><button class="nope" data-id="${esc(id)}">전부 아님 — 직접 찾겠음</button></div>
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
  for (const b of document.querySelectorAll(".nope")) {
    b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await send({ cmd: "rejectMatch", id: b.dataset.id });
      if (r && r.ok) await load(); else b.disabled = false;
    });
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
