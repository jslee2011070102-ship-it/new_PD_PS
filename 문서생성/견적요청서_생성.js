const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak,
} = require("docx");

// 데이터와 결과물은 이 스크립트와 같은 폴더를 기준으로 삼는다
// (어느 위치에서 node로 실행하든 같게 동작하도록).
const HERE = __dirname;
const DATA_FILE = path.join(HERE, "견적요청서_데이터.json");
const OUT_FILE = path.join(HERE, "..", "신제품_생산견적요청서.docx");
const D = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const { specs: S, compare: C, later: L, meta: M } = D;

const won = (n) => n.toLocaleString("ko-KR") + "원";
const num = (n) => n.toLocaleString("ko-KR");
// '100ml당' -> '66.0원/100ml' 처럼 좁은 칸에 들어가게 줄인다
const shortBasis = (basis) => basis.replace("당", "").replace("1개", "개");
const perText = (unit, basis) => `${num(unit)}원/${shortBasis(basis)}`;
// 같은 카테고리에서 규격군을 나눈 경우(가정용/업소용) 이름에 붙인다
const specName = (d) => d.cat + (d.label ? ` (${d.label})` : "");

// A4 본문 폭 ≈ 9026 DXA (21cm - 좌우 여백 2cm씩)
const W = 9026;
const NAVY = "1F3864", GREY = "595959", LINE = "BFBFBF", BAND = "F2F2F2", HILITE = "FFF2CC", WARN = "FBE4D5";

const t = (text, o = {}) => new TextRun({ text, font: "맑은 고딕", size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics });
const p = (text, o = {}) => new Paragraph({
  alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 80, line: 280 },
  indent: o.indent, border: o.border,
  children: Array.isArray(text) ? text : [t(text, o)],
});

const cell = (children, o = {}) => new TableCell({
  width: { size: o.w, type: WidthType.DXA },
  shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
  margins: { top: 70, bottom: 70, left: 110, right: 110 },
  columnSpan: o.span,
  children: (Array.isArray(children) ? children : [children]).map((c) =>
    typeof c === "string" ? p(c, { size: o.size || 18, bold: o.bold, color: o.color, align: o.align, after: 0 }) : c),
});

const table = (widths, rows) => new Table({
  columnWidths: widths,
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  },
  rows,
});
const hdrRow = (labels, widths) => new TableRow({
  tableHeader: true,
  children: labels.map((h, i) => cell(h, { w: widths[i], fill: NAVY, color: "FFFFFF", bold: true, size: 17, align: AlignmentType.CENTER })),
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 380, after: 150 },
  children: [t(text, { size: 26, bold: true, color: NAVY })],
});
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 110 },
  children: [t(text, { size: 22, bold: true, color: NAVY })],
});
const br = () => new Paragraph({ children: [new PageBreak()] });
const bullet = (bold, rest) => p([t("• " + bold, { bold: true, size: 18 }), t(rest, { size: 18 })], { indent: { left: 200 }, after: 50 });

// ── 표지 ─────────────────────────────────────────────
const cover = [
  p("", { after: 1400 }),
  p([t("신제품 생산 견적 요청", { size: 44, bold: true, color: NAVY })], { align: AlignmentType.CENTER, after: 160 }),
  p([t("쿠팡 생활용품 6개 카테고리 · 가성비 라인", { size: 24, color: GREY })], { align: AlignmentType.CENTER, after: 900 }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 900 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
    children: [t("")],
  }),
  table([2400, 4200], [
    ["작성일", M.docDate],
    ["시장 조사 기준일", M.surveyDate],
    ["조사 대상", `쿠팡 6개 카테고리 상위 25개 제품 (총 ${M.sampleTotal}개)`],
    ["요청 품목", `${S.length}종 (카테고리별 1종, 살균소독제는 가정용·업소용 2종)`],
    ["발신", ""],
    ["담당자", ""],
    ["연락처", ""],
  ].map(([k, v]) => new TableRow({
    children: [cell(k, { w: 2400, fill: BAND, bold: true, size: 19 }), cell(v, { w: 4200, size: 19 })],
  }))),
  p("", { after: 600 }),
  p([t("본 문서의 목표 원가는 시장 조사로 도출한 판매가에서 역산한 값입니다.", { size: 19, color: GREY })], { align: AlignmentType.CENTER, after: 40 }),
  p([t("해당 원가를 초과할 경우 목표 판매가를 맞출 수 없습니다.", { size: 19, color: GREY })], { align: AlignmentType.CENTER }),
  br(),
];

// ── 1. 요청 취지 ──────────────────────────────────────
const intro = [
  h1("1. 요청 취지"),
  p("쿠팡에서 판매할 생활용품 신제품의 생산 견적을 요청드립니다."),
  p("본 문서에 기재된 목표 원가는 임의로 정한 값이 아니라, 쿠팡 시장 조사 결과 도출된 목표 판매가에서 역산한 값입니다. 해당 원가를 초과하면 목표 판매가를 맞출 수 없고, 목표 판매가를 벗어나면 현재 시장에서 경쟁이 어렵습니다."),
  p("따라서 본 문서는 다음 두 가지를 함께 전달드립니다."),
  p([t("① 제품별 목표 규격과 목표 원가", { bold: true })], { indent: { left: 340 }, after: 40 }),
  p([t("② 그 원가가 왜 그 금액이어야 하는지에 대한 시장 근거", { bold: true })], { indent: { left: 340 }, after: 180 }),

  h2("원가 산출 방식"),
  p(`목표 판매가는 생산원가의 ${M.markup}배로 설정했습니다. 이 배수에는 유통 수수료, 물류비, 마케팅비, 반품·재고 손실이 모두 포함되어 있으며, 사업이 유지되기 위한 최소 배수입니다.`),
  p("", { after: 60 }),
  table([1600, 7426], [
    new TableRow({
      children: [cell("산식", { w: 1600, fill: NAVY, color: "FFFFFF", bold: true, size: 19 }),
        cell([p([t(`목표 판매가 = 생산원가 × ${M.markup}`, { bold: true, size: 21 })], { after: 40 }),
          p([t(`→ 목표 생산원가 = 목표 판매가 ÷ ${M.markup}`, { size: 19, color: GREY })], { after: 0 })], { w: 7426 })],
    }),
  ]),
  p("", { after: 120 }),
  p([t("기재된 목표 원가는 ", {}), t("넘어서는 안 되는 상한값", { bold: true }), t("입니다. 부자재·포장·인쇄를 포함한 완제품 기준 단가로 회신 부탁드립니다.", {})]),

  h2("품목 선정 방식 — 포장 형태를 기준으로 나눕니다"),
  p("같은 카테고리 안에서도 제품은 포장 형태에 따라 가격 구조가 전혀 다릅니다. 그래서 본 문서는 제품을 아래 세 가지 형태로 나누어 비교했습니다."),
  p("", { after: 60 }),
  table([1500, 7526], [
    ["용기", "손잡이가 있는 플라스틱 통. 단품 또는 여러 개 묶음으로 판매"],
    ["파우치", "비닐 재질의 봉지형 포장. 주로 브랜드의 소용량 리필 제품"],
    ["말통", "대용량 통. 가정용 4~13L, 업소용 19~20L로 갈립니다"],
  ].map(([k, v]) => new TableRow({
    children: [cell(k, { w: 1500, fill: BAND, bold: true, size: 18, align: AlignmentType.CENTER }), cell(v, { w: 7526, size: 18 })],
  }))),
  p("", { after: 140 }),
  p([t("'본품'과 '리필'로 나누지 않은 이유", { bold: true })], { after: 40 }),
  p("본품·리필은 각 브랜드가 자사 라인업 안에서 붙이는 이름입니다. 브랜드 인지도에 따라 가격대가 크게 다르기 때문에, 인지도 높은 브랜드의 리필과 저가 브랜드의 본품을 같은 기준으로 비교하면 실제 시장과 맞지 않는 결론이 나옵니다. 반면 포장 형태는 브랜드와 무관한 사실이므로 비교 기준으로 삼을 수 있습니다."),

  h2("카테고리별 1종만 요청드리는 이유"),
  p("각 카테고리에서 형태별 가격대를 비교한 결과, 형태에 따라 단위당 가격이 최대 4배 이상 차이 났습니다. 같은 카테고리에서 여러 형태를 동시에 생산하면, 비싼 형태 쪽은 가성비 제품으로 성립하지 않습니다."),
  p([t("따라서 카테고리별로 ", {}), t("단위당 가격이 가장 낮은 형태 1종", { bold: true }), t("만 우선 생산하는 것으로 정했습니다. 나머지 형태는 기능·용도를 차별화한 확장 품목으로 이후 검토하며, 해당 내용은 5장에 정리했습니다.", {})]),

  h2("목표 판매가 산정 방식"),
  p("목표 판매가는 다음 세 단계로 정했습니다."),
  p([t("① ", { bold: true }), t("카테고리·형태별로 현재 쿠팡에서 판매 중인 제품의 단위당 가격(100ml당 또는 1개당)을 모두 나열합니다.", {})], { indent: { left: 340 }, after: 50 }),
  p([t("② ", { bold: true }), t("그중 가장 낮은 가격을 그 형태의 시장 최저가로 봅니다. 브랜드 인지도가 낮아 눈에 잘 띄지 않는 제품이라도, 그 형태·그 가격으로 실제 판매되고 있다면 소비자가 비교하게 되는 기준 가격입니다.", {})], { indent: { left: 340 }, after: 50 }),
  p([t("③ ", { bold: true }), t(`그 최저가보다 약 ${Math.round((1 - M.discount) * 100)}% 낮게 설정합니다. 소비자가 가격 비교 시 확실히 싸다고 인식하면서도, 생산이 불가능한 수준으로 내려가지 않는 선입니다.`, {})], { indent: { left: 340 }, after: 60 }),
  p("규격 또한 임의로 정한 것이 아니라, 해당 가격대 제품들이 실제로 채택하고 있는 용량·수량을 그대로 따랐습니다."),
  p("", { after: 100 }),
  p([t("무게(g·kg)와 부피(ml·L)는 같은 선에서 비교했습니다.", { bold: true })], { after: 40 }),
  p("물리적으로는 다른 단위이지만, 생활용품은 g과 ml을 병행 표기하는 것이 일반적이고 소비자도 100g당과 100ml당을 나란히 놓고 비교합니다. 실제 시장의 비교 방식을 따르는 것이 목적이므로 한 무리로 보았습니다. 해당 품목의 단위당 가격 기준은 \u0027100ml·100g당\u0027으로 표기했습니다."),

  h2("시장 조사 개요"),
  p(`${M.surveyDate}, 쿠팡 6개 카테고리에서 카테고리별 판매 순위 상위 25개 제품(총 ${M.sampleTotal}개)의 판매가·용량·구성·순위·리뷰수를 수집했습니다.`),
  p("수집한 값은 쿠팡이 상품 페이지에 표시하는 단위당 가격과 대조하여 검증했으며, 150개 중 145개가 일치했습니다(나머지 5개는 화면상 단가 표기가 없어 대조 불가). 계산 오류로 인한 불일치는 0건입니다."),
  br(),
];

// ── 2. 요청 품목 총괄 ─────────────────────────────────
const SW = [500, 1420, 600, 1380, 1160, 1260, 960, 900, 846];
const sumRows = [hdrRow(["순위", "카테고리", "형태", "규격", "목표 판매가", "목표 생산원가", "낱개 원가", "단위당", "최저가 대비"], SW)];
S.forEach((d, i) => {
  sumRows.push(new TableRow({
    children: [
      cell(String(i + 1), { w: SW[0], size: 17, align: AlignmentType.CENTER, fill: BAND }),
      cell(specName(d), { w: SW[1], size: 16, bold: true }),
      cell(d.form, { w: SW[2], size: 17, align: AlignmentType.CENTER }),
      cell(d.spec, { w: SW[3], size: 17 }),
      cell(won(d.price), { w: SW[4], size: 17, align: AlignmentType.RIGHT }),
      cell(won(d.cost), { w: SW[5], size: 17, bold: true, align: AlignmentType.RIGHT, fill: HILITE }),
      cell(d.costEach ? won(d.costEach) : "-", { w: SW[6], size: 17, align: AlignmentType.RIGHT }),
      cell(perText(d.unit, d.basis), { w: SW[7], size: 16, align: AlignmentType.RIGHT }),
      cell(d.benchDiff.toFixed(1) + "%", { w: SW[8], size: 17, align: AlignmentType.CENTER }),
    ],
  }));
});

const summary = [
  h1("2. 요청 품목 총괄"),
  p(`카테고리별로 단위당 가격이 가장 낮은 형태 1종씩, 총 ${S.length}종입니다. 살균소독제는 가정용(4L)과 업소용(20L)의 시장이 나뉘어 있어 2종으로 나누어 요청드립니다. 음영 표시된 열이 요청드리는 목표 생산원가입니다.`),
  p("순위는 쿠팡 내 추정 시장 규모 순이며, 위에 있는 품목의 우선순위가 높습니다.", { size: 18, color: GREY }),
  p("", { after: 100 }),
  table(SW, sumRows),
  p("", { after: 140 }),
  bullet("목표 생산원가", "는 부자재·포장·인쇄를 포함한 완제품 1세트 기준입니다."),
  bullet("낱개 원가", "는 묶음 상품의 개당 원가입니다. 4개입 세트라면 병 1개당 원가입니다."),
  bullet("단위당", "은 100ml 또는 1개 기준 가격입니다. 쿠팡이 상품 페이지에 자동으로 표시하는 값이며, 소비자가 이 숫자로 제품을 비교합니다."),
  bullet("최저가 대비", "는 같은 형태로 가장 싸게 팔리는 제품과 비교한 단위당 가격 차이입니다."),
  br(),
];

// ── 3. 형태별 가격 비교 ───────────────────────────────
const CFW = [1300, 1900, 1900, 1900, 2026];
const cmpRows = [hdrRow(["카테고리", "용기", "파우치", "말통", "채택 형태"], CFW)];
const seenCat = new Set();
S.filter((d) => { if (seenCat.has(d.cat)) return false; seenCat.add(d.cat); return true; }).forEach((d) => {
  const byForm = {};
  (C[d.cat] || []).forEach((e) => { byForm[e.form] = e; });
  const fmt = (f) => {
    const e = byForm[f];
    if (!e || !e.n) return "판매 제품 없음";
    const thin = e.thin ? " ※" : "";
    return `${e.n}종 · ${num(e.floor)}원/${shortBasis(e.basis)}${thin}`;
  };
  cmpRows.push(new TableRow({
    children: [
      cell(d.cat, { w: CFW[0], size: 17, bold: true }),
      ...["용기", "파우치", "말통"].map((f, i) => cell(fmt(f), {
        w: CFW[i + 1], size: 17, align: AlignmentType.CENTER,
        fill: d.form === f ? HILITE : undefined, bold: d.form === f,
      })),
      cell(d.form + `  (${num((byForm[d.form] || {}).revenue || d.market)}억원)`, { w: CFW[4], size: 17, align: AlignmentType.CENTER, bold: true }),
    ],
  }));
});

const formSection = [
  h1("3. 형태별 가격 비교 — 왜 이 형태를 골랐는지"),
  p("각 카테고리에서 형태별로 가장 싼 단위당 가격을 나란히 놓은 표입니다. 음영 표시된 형태가 본 문서에서 생산을 요청드리는 형태입니다."),
  p("", { after: 100 }),
  table(CFW, cmpRows),
  p("", { after: 120 }),
  bullet("※ 표시", `는 판매 제품이 ${M.minSample}종 미만이어서 시장 가격대로 판단하기 어려운 경우입니다. 제안에서 제외했습니다.`),
  bullet("괄호 안 금액", "은 해당 형태의 쿠팡 내 추정 월 시장 규모입니다."),
  p("", { after: 140 }),
  p([t("표에서 확인되는 사실", { bold: true, color: NAVY })], { after: 50 }),
  p("세탁세제와 섬유유연제는 대용량 용기 묶음이 가장 싸고, 파우치는 브랜드가 소용량으로 비싸게 판매하는 자리입니다. 반대로 주방세제와 살균소독제는 말통이 가장 싸고, 캡슐세제는 파우치가 사실상 유일한 형태입니다.", { after: 60 }),
  p("따라서 '리필이니까 싸다'는 전제는 실제 시장에서 성립하지 않습니다. 어떤 형태가 싼 자리인지는 카테고리마다 다릅니다.", { after: 60 }),
  p("살균소독제 말통은 한 형태 안에서 가정용 4L군과 업소용 19~20L군으로 다시 갈립니다. 쓰임과 구매자가 다르므로 하나로 묶지 않고 각각 제안드립니다.", { after: 60 }),
  br(),
];

// ── 4. 품목별 상세 ────────────────────────────────────
const EW = [800, 1600, 1800, 1400, 1400, 2026];
const detail = [h1("4. 품목별 상세 및 시장 근거")];
S.forEach((d, i) => {
  detail.push(h2(`4-${i + 1}. ${specName(d)} — ${d.form}`));

  detail.push(table([1500, 2900, 1500, 3126], [
    new TableRow({
      children: [
        cell("형태", { w: 1500, fill: BAND, bold: true, size: 18 }), cell(d.form, { w: 2900, size: 18 }),
        cell("규격", { w: 1500, fill: BAND, bold: true, size: 18 }), cell(d.spec, { w: 3126, size: 18 }),
      ],
    }),
    new TableRow({
      children: [
        cell("목표 판매가", { w: 1500, fill: BAND, bold: true, size: 18 }),
        cell(d.priceEach ? `${won(d.price)}  (개당 ${won(d.priceEach)})` : won(d.price), { w: 2900, size: 18 }),
        cell("단위당 가격", { w: 1500, fill: BAND, bold: true, size: 18 }),
        cell(`${num(d.unit)}원 (${d.basis})`, { w: 3126, size: 18 }),
      ],
    }),
    new TableRow({
      children: [
        cell("목표 생산원가", { w: 1500, fill: HILITE, bold: true, size: 18 }),
        cell([p([t(won(d.cost), { bold: true, size: 22 })], { after: 0 })], { w: 2900, fill: HILITE }),
        cell(d.costEach ? "낱개 환산" : "비고", { w: 1500, fill: HILITE, bold: true, size: 18 }),
        cell(d.costEach ? `${won(d.costEach)} / 개 (${d.qty}개입)` : "단품 기준", { w: 3126, fill: HILITE, size: 18 }),
      ],
    }),
  ]));
  detail.push(p("", { after: 120 }));

  detail.push(p([t("선정 근거", { bold: true, size: 19, color: NAVY })], { after: 50 }));
  detail.push(p([
    t(`이 형태는 ${d.cat} 카테고리에서 단위당 가격이 가장 낮은 형태이며, 현재 쿠팡에서 `, { size: 18 }),
    t(`${d.sampleN}종`, { size: 18, bold: true }),
    t("이 판매되고 있습니다. 추정 월 시장 규모는 약 ", { size: 18 }),
    t(`${num(d.market)}억원`, { size: 18, bold: true }),
    t("입니다. 목표 단위당 가격은 현재 가격대 최저 제품(", { size: 18 }),
    t(`${d.benchBrand} ${d.benchRank}위, ${num(d.benchUnit)}원`, { size: 18, bold: true }),
    t(`) 대비 ${Math.abs(d.benchDiff).toFixed(1)}% 낮은 수준입니다.`, { size: 18 }),
  ], { indent: { left: 200 }, after: 60 }));
  detail.push(p([
    t("규격은 해당 가격대 제품들이 채택한 ", { size: 18 }),
    t(d.spec, { size: 18, bold: true }),
    t(`(총 ${num(d.total)}${d.unitOfMeasure})를 그대로 따랐습니다.`, { size: 18 }),
  ], { indent: { left: 200 }, after: 120 }));

  if (d.sizeNote) {
    detail.push(table([W], [new TableRow({
      children: [cell([p([t("규격군 구분  ", { bold: true, size: 18, color: NAVY }), t(d.sizeNote + ".", { size: 18 })], { after: 0 })], { w: W, fill: BAND })],
    })]));
    detail.push(p("", { after: 120 }));
  }

  detail.push(p([t("비교 대상 (현재 쿠팡 판매 중)", { bold: true, size: 19, color: NAVY })], { after: 50 }));
  const evRows = [hdrRow(["순위", "브랜드", "규격", "판매가", "단위당", "리뷰수"], EW)];
  d.evidence.forEach((e) => evRows.push(new TableRow({
    children: [
      cell(`${e.rank}위`, { w: EW[0], size: 17, align: AlignmentType.CENTER }),
      cell(e.brand, { w: EW[1], size: 17 }),
      cell(e.spec, { w: EW[2], size: 17 }),
      cell(won(e.price), { w: EW[3], size: 17, align: AlignmentType.RIGHT }),
      cell(`${num(e.unit)}원${d.mixedBasis ? ` (${shortBasis(e.basis)})` : ""}`, { w: EW[4], size: 16, align: AlignmentType.RIGHT }),
      cell(num(e.review), { w: EW[5], size: 17, align: AlignmentType.RIGHT }),
    ],
  })));
  evRows.push(new TableRow({
    children: [
      cell("제안", { w: EW[0], fill: HILITE, bold: true, size: 17, align: AlignmentType.CENTER }),
      cell("신제품", { w: EW[1], fill: HILITE, bold: true, size: 17 }),
      cell(d.spec, { w: EW[2], fill: HILITE, bold: true, size: 17 }),
      cell(won(d.price), { w: EW[3], fill: HILITE, bold: true, size: 17, align: AlignmentType.RIGHT }),
      cell(`${num(d.unit)}원`, { w: EW[4], fill: HILITE, bold: true, size: 17, align: AlignmentType.RIGHT }),
      cell("-", { w: EW[5], fill: HILITE, size: 17, align: AlignmentType.RIGHT }),
    ],
  }));
  detail.push(table(EW, evRows));
  detail.push(p("", { after: 100 }));

  const notes = [];
  if (d.mixedBasis) {
    notes.push(p([t("단위 기준  ", { bold: true, size: 18, color: NAVY }),
      t(`이 품목은 무게(g) 표기 제품과 부피(ml) 표기 제품이 함께 판매되고 있어, 100g과 100ml을 같은 선에서 비교했습니다. 위 표의 '단위당' 열에 각 제품의 표기 기준이 함께 적혀 있습니다.`, { size: 18 })], { after: 0 }));
  }
  if (d.gapRatio && d.gapRatio >= 1.5) {
    notes.push(p([t("가격대 안내  ", { bold: true, size: 18, color: NAVY }),
      t(`이 형태의 최저가(${d.benchBrand} ${num(d.benchUnit)}원)와 그 다음 제품 사이에 ${d.gapRatio}배 차이가 있습니다. 즉 목표 판매가는 이 형태 대다수 제품보다 상당히 낮은 수준이며, 가격 경쟁력은 크지만 원가 여유가 적습니다. 목표 원가 충족이 어려우시면 그 사실을 회신에 명확히 적어 주시기 바랍니다.`, { size: 18 })], { after: 0 }));
  }
  if (d.thin) {
    notes.push(p([t("표본 안내  ", { bold: true, size: 18, color: NAVY }),
      t(`이 규격군은 쿠팡 상위권 판매 제품이 ${d.sampleN}종뿐입니다. 다른 품목보다 시장 가격대의 근거가 얇으므로, 우선순위를 낮게 보셔도 됩니다.`, { size: 18 })], { after: 0 }));
  }
  notes.forEach((nt) => {
    detail.push(table([W], [new TableRow({ children: [cell([nt], { w: W, fill: WARN })] })]));
    detail.push(p("", { after: 80 }));
  });
  detail.push(p("", { after: 120 }));
  if (i < S.length - 1 && i % 2 === 1) detail.push(br());
});

// ── 5. 확장 후보 ──────────────────────────────────────
const LW = [1300, 900, 800, 1700, 1600, 2726];
const laterRows = [hdrRow(["카테고리", "형태", "제품수", "최저 단위당가격", "채택 형태 대비", "비고"], LW)];
L.forEach((x) => laterRows.push(new TableRow({
  children: [
    cell(x.cat, { w: LW[0], size: 17 }),
    cell(x.form, { w: LW[1], size: 17, align: AlignmentType.CENTER }),
    cell(`${x.n}종`, { w: LW[2], size: 17, align: AlignmentType.CENTER }),
    cell(`${num(x.floor)}원/${shortBasis(x.basis)}`, { w: LW[3], size: 17, align: AlignmentType.RIGHT }),
    cell(`${x.chosen}의 ${x.ratio}배`, { w: LW[4], size: 17, align: AlignmentType.CENTER }),
    cell(x.thin ? `판매 ${x.n}종뿐 — 표본 부족` : "가격 경쟁력 없음", { w: LW[5], size: 17, fill: x.thin ? BAND : undefined }),
  ],
})));

const laterSection = [
  br(),
  h1("5. 확장 후보 (금회 생산 요청 대상 아님)"),
  p("아래는 각 카테고리에서 생산하지 않기로 한 형태입니다. 참고용이며, 이번 견적 대상이 아닙니다."),
  p("", { after: 100 }),
  table(LW, laterRows),
  p("", { after: 140 }),
  p([t("제외 이유", { bold: true, color: NAVY })], { after: 50 }),
  bullet("가격 경쟁력 없음", " — 같은 카테고리에서 채택한 형태보다 단위당 가격이 2배 이상 비쌉니다. 이 형태로 가성비를 내세우기는 어렵고, 향후 기능·향·용도를 차별화한 프리미엄 라인으로 검토하는 것이 적합합니다."),
  bullet("표본 부족", ` — 쿠팡 상위권에 판매 제품이 ${M.minSample}종 미만입니다. 캡슐세제 용기형은 2종, 섬유탈취제 파우치는 3종이며 모두 특정 브랜드에 쏠려 있습니다. 시장 가격대를 판단할 근거가 부족해 제외했습니다.`),
  bullet("판매 제품 없음", " — 세탁세제·캡슐세제·섬유탈취제에는 말통 제품이, 살균소독제에는 파우치 제품이 쿠팡 상위권에 존재하지 않습니다. 수요가 확인되지 않은 형태이므로 제안에서 제외했습니다."),
  p("", { after: 140 }),
  p([t("섬유탈취제 파우치는 단위당 가격이 용기와 거의 같습니다(1.0배). 가격 차이가 없다는 점에서 굳이 형태를 늘릴 이유가 없다고 보았습니다.", { size: 18, color: GREY })], { indent: { left: 200 } }),
];

// ── 6. 회신 요청 사항 ─────────────────────────────────
const reply = [
  br(),
  h1("6. 회신 요청 사항"),
  p("아래 항목을 품목별로 회신해 주시면 감사하겠습니다."),
  p("", { after: 100 }),
  table([600, 2600, 5826], [
    ["", "항목", "내용"],
    ["1", "제시 단가", "완제품 1세트 기준 공급가 (부자재·포장·인쇄 포함 여부 명시)"],
    ["2", "목표 원가 충족 여부", "본 문서의 목표 생산원가 이내 가능 여부. 불가 시 최소 가능 단가"],
    ["3", "최소 주문 수량 (MOQ)", "품목별 최소 생산 수량"],
    ["4", "리드타임", "발주 후 납품까지 소요 기간"],
    ["5", "수량별 단가", "MOQ / 3배 / 5배 수량 구간별 단가"],
    ["6", "규격 조정 제안", "목표 원가를 맞추기 위해 조정 가능한 규격이 있다면 그 내용"],
  ].map(([n, k, v], i) => new TableRow({
    children: i === 0
      ? [cell("", { w: 600, fill: NAVY }), cell(k, { w: 2600, fill: NAVY, color: "FFFFFF", bold: true, size: 18 }),
        cell(v, { w: 5826, fill: NAVY, color: "FFFFFF", bold: true, size: 18 })]
      : [cell(n, { w: 600, fill: BAND, bold: true, size: 18, align: AlignmentType.CENTER }),
        cell(k, { w: 2600, bold: true, size: 18 }), cell(v, { w: 5826, size: 18 })],
  }))),
  p("", { after: 200 }),

  h2("규격 조정에 대하여"),
  p("목표 원가를 맞추기 어려운 경우, 무리한 단가 인하보다 규격 조정을 먼저 검토하고자 합니다. 다만 아래 두 가지는 시장 조사에서 확인된 제약이므로 조정 시 함께 고려 부탁드립니다."),
  bullet("용량·수량 규격", " — 본 문서의 규격은 해당 카테고리에서 실제로 상위권에 올라 있는 제품들이 채택한 규격입니다. 크게 벗어나면 소비자가 가격을 비교하기 어려워집니다."),
  bullet("단위당 가격", " — 쿠팡은 상품 페이지에 100ml당(또는 1개당) 가격을 자동으로 표시합니다. 소비자가 이 숫자로 직접 비교하므로, 총액보다 단위당 가격이 경쟁력을 좌우합니다."),
  p("", { after: 200 }),

  h2("참고 사항"),
  bullet("시장 규모는 추정 하한값입니다.", ` 쿠팡이 표시하는 월 구매자수를 근거로 계산했으며, "3만명 이상"과 같이 구간으로만 표시되므로 실제 규모는 이보다 클 수 있습니다. 품목 간 상대 비교 용도로만 참고 부탁드립니다.`),
  bullet("가격·순위 기준일", ` — ${M.surveyDate}입니다. 쿠팡 순위와 할인가는 수시로 변동합니다.`),
  bullet("단위당 가격의 기준이 카테고리마다 다릅니다.", " 액체 제품은 100ml당, 캡슐세제는 1개당입니다. 개수 기준(캡슐세제)과 용량 기준은 성질이 달라 서로 비교할 수 없으니 주의 부탁드립니다. 무게(100g당)와 부피(100ml당)는 시장 관행에 따라 같은 선에서 비교했습니다."),
];

const doc = new Document({
  styles: { default: { document: { run: { font: "맑은 고딕", size: 20 } } } },
  sections: [{
    properties: { page: { margin: { top: 1130, right: 1130, bottom: 1130, left: 1130 } } },
    children: [...cover, ...intro, ...summary, ...formSection, ...detail, ...laterSection, ...reply],
  }],
});

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(OUT_FILE, b);
  console.log("생성 완료:", OUT_FILE, b.length, "bytes");
});
