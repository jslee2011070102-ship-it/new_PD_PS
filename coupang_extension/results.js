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
    const gap = r.candidates && r.candidates[0] && r.candidates[0].priceGap !== null
      ? Math.round(r.candidates[0].priceGap * 100) + "%" : "-";
    return `<tr class="${cls}">
      <td>${esc(id)}</td>
      <td><b>${esc(r.verdict)}</b></td>
      <td>${esc(r.pid || "-")}</td>
      <td>${esc((r.name || "").slice(0, 34))}</td>
      <td>${esc((r.matchedName || "").slice(0, 34))}</td>
      <td class="num">${r.wantPrice ? r.wantPrice.toLocaleString() : "-"}</td>
      <td class="num">${r.matchedPrice ? r.matchedPrice.toLocaleString() : "-"}</td>
      <td class="num">${gap}</td>
    </tr>`;
  }).join("");
  $("foundWrap").innerHTML = `<table>
    <tr><th>항목</th><th>판정</th><th>딜번호</th><th>찾던 제품</th><th>찾은 제품</th>
        <th>기대가</th><th>실제가</th><th>가격차</th></tr>${rows}</table>`;
}

function render() {
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
