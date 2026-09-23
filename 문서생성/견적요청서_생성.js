const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  PageBreak, LevelFormat, convertInchesToTwip,
} = require("docx");

// 데이터와 결과물은 이 스크립트와 같은 폴더를 기준으로 삼는다
// (어느 위치에서 node로 실행하든 같게 동작하도록).
const HERE = __dirname;
const DATA_FILE = path.join(HERE, "견적요청서_데이터.json");
const OUT_FILE  = path.join(HERE, "..", "신제품_생산견적요청서.docx");
const D = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const won = (n) => n.toLocaleString("ko-KR") + "원";

// A4 본문 폭 ≈ 9026 DXA (21cm - 좌우 여백 2cm씩)
const W = 9026;
const NAVY = "1F3864", GREY = "595959", LINE = "BFBFBF", BAND = "F2F2F2", HILITE = "FFF2CC";

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

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 380, after: 150 },
  children: [t(text, { size: 26, bold: true, color: NAVY })],
});
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 110 },
  children: [t(text, { size: 22, bold: true, color: NAVY })],
});

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
    ["작성일", "2026년 9월 23일"],
    ["시장 조사 기준일", "2026년 9월 21일"],
    ["조사 대상", "쿠팡 6개 카테고리 상위 25개 제품 (총 150개)"],
    ["요청 품목", "12종 (6개 카테고리 × 본품·리필)"],
    ["발신", ""],
    ["담당자", ""],
    ["연락처", ""],
  ].map(([k, v]) => new TableRow({
    children: [cell(k, { w: 2400, fill: BAND, bold: true, size: 19 }), cell(v, { w: 4200, size: 19 })],
  }))),
  p("", { after: 600 }),
  p([t("본 문서의 목표 원가는 시장 조사로 도출한 판매가에서 역산한 값입니다.", { size: 19, color: GREY })], { align: AlignmentType.CENTER, after: 40 }),
  p([t("해당 원가를 초과할 경우 목표 판매가를 맞출 수 없습니다.", { size: 19, color: GREY })], { align: AlignmentType.CENTER }),
  new Paragraph({ children: [new PageBreak()] }),
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
  p("목표 판매가는 생산원가의 3.5배로 설정했습니다. 이 배수에는 유통 수수료, 물류비, 마케팅비, 반품·재고 손실이 모두 포함되어 있으며, 사업이 유지되기 위한 최소 배수입니다."),
  p("", { after: 60 }),
  table([1600, 7426], [
    new TableRow({ children: [cell("산식", { w: 1600, fill: NAVY, color: "FFFFFF", bold: true, size: 19 }),
      cell([p([t("목표 판매가 = 생산원가 × 3.5", { bold: true, size: 21 })], { after: 40 }),
            p([t("→ 목표 생산원가 = 목표 판매가 ÷ 3.5", { size: 19, color: GREY })], { after: 0 })], { w: 7426 })] }),
  ]),
  p("", { after: 120 }),
  p([t("기재된 목표 원가는 ", {}), t("넘어서는 안 되는 상한값", { bold: true }), t("입니다. 부자재·포장·인쇄를 포함한 완제품 기준 단가로 회신 부탁드립니다.", {})]),

  h2("목표 판매가 산정 방식"),
  p("목표 판매가는 다음 두 단계로 정했습니다."),
  p([t("① ", { bold: true }), t("카테고리별·형태별로 현재 쿠팡에서 판매 중인 제품의 단위당 가격(100ml당 또는 1개당)을 모두 나열하고, 가장 싼 가격대를 찾습니다. 이때 다른 제품과 크게 동떨어진 단독 최저가는 제외합니다. 한 개만 유별나게 싼 값은 시장 가격대라고 볼 수 없기 때문입니다.", {})], { indent: { left: 340 }, after: 60 }),
  p([t("② ", { bold: true }), t("그 가격대의 최저 제품보다 약 5% 낮게 설정합니다. 소비자가 가격 비교 시 확실히 싸다고 인식하면서도, 생산이 불가능한 수준으로 내려가지 않는 선입니다.", {})], { indent: { left: 340 }, after: 60 }),
  p("규격 또한 임의로 정한 것이 아니라, 해당 가격대의 제품들이 공통으로 채택하고 있는 용량·수량을 그대로 따랐습니다."),

  h2("시장 조사 개요"),
  p("2026년 9월 21일, 쿠팡 6개 카테고리에서 카테고리별 판매 순위 상위 25개 제품(총 150개)의 판매가·용량·구성·순위·리뷰수를 수집했습니다."),
  p("수집한 값은 쿠팡이 상품 페이지에 표시하는 단위당 가격과 대조하여 검증했으며, 150개 중 145개가 일치했습니다(나머지 5개는 화면상 단가 표기가 없어 대조 불가). 계산 오류로 인한 불일치는 0건입니다."),
  new Paragraph({ children: [new PageBreak()] }),
];

// ── 2. 요청 품목 총괄 ─────────────────────────────────
const HDR = ["카테고리", "구분", "형태", "규격", "목표 판매가", "목표 생산원가", "낱개 환산", "시장 최저가 대비"];
const CW = [1140, 620, 700, 1620, 1180, 1280, 1140, 1346];
const sumRows = [new TableRow({
  tableHeader: true,
  children: HDR.map((h, i) => cell(h, { w: CW[i], fill: NAVY, color: "FFFFFF", bold: true, size: 17, align: AlignmentType.CENTER })),
})];
D.forEach((d, i) => {
  const first = i === 0 || D[i - 1].cat !== d.cat;   // 카테고리 첫 줄에만 이름 표시
  const band = first ? undefined : BAND;
  sumRows.push(new TableRow({
    children: [
      cell(first ? d.cat : "", { w: CW[0], size: 17, bold: first, fill: band }),
      cell(d.role, { w: CW[1], size: 17, align: AlignmentType.CENTER, fill: band }),
      cell(d.form, { w: CW[2], size: 17, align: AlignmentType.CENTER, fill: band }),
      cell(d.spec, { w: CW[3], size: 17, fill: band }),
      cell(won(d.price), { w: CW[4], size: 17, align: AlignmentType.RIGHT, fill: band }),
      cell(won(d.cost), { w: CW[5], size: 17, bold: true, align: AlignmentType.RIGHT, fill: HILITE }),
      cell(d.qty > 1 ? won(d.costEach) + " / 개" : "-", { w: CW[6], size: 17, align: AlignmentType.RIGHT, fill: band }),
      cell(d.benchDiff.toFixed(1) + "%", { w: CW[7], size: 17, align: AlignmentType.CENTER, fill: band }),
    ],
  }));
});

const summary = [
  h1("2. 요청 품목 총괄"),
  p("카테고리별로 본품(용기)과 리필로 나누어 각 1종씩, 총 12종입니다. 음영 표시된 열이 요청드리는 목표 생산원가입니다."),
  p("", { after: 100 }),
  table(CW, sumRows),
  p("", { after: 140 }),
  p([t("• 목표 생산원가", { bold: true, size: 18 }), t("는 부자재·포장·인쇄를 포함한 완제품 1세트 기준입니다.", { size: 18 })], { after: 40 }),
  p([t("• 낱개 환산", { bold: true, size: 18 }), t("은 묶음 상품의 개당 원가입니다. 4개입 세트라면 병 1개당 원가입니다.", { size: 18 })], { after: 40 }),
  p([t("• 시장 최저가 대비", { bold: true, size: 18 }), t("는 현재 쿠팡에서 같은 형태로 가장 싸게 팔리는 제품과 비교한 단위당 가격 차이입니다. 전 품목을 약 5% 낮게 설정했습니다.", { size: 18 })], { after: 40 }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ── 3. 품목별 상세 ────────────────────────────────────
const detail = [h1("3. 품목별 상세 및 시장 근거")];
D.forEach((d, i) => {
  detail.push(h2(`3-${i + 1}. ${d.cat} ${d.role}`));

  detail.push(table([1500, 2900, 1500, 3126], [
    new TableRow({ children: [
      cell("형태", { w: 1500, fill: BAND, bold: true, size: 18 }), cell(d.form, { w: 2900, size: 18 }),
      cell("규격", { w: 1500, fill: BAND, bold: true, size: 18 }), cell(d.spec, { w: 3126, size: 18 }),
    ] }),
    new TableRow({ children: [
      cell("목표 판매가", { w: 1500, fill: BAND, bold: true, size: 18 }), cell(won(d.price), { w: 2900, size: 18 }),
      cell("단위당 가격", { w: 1500, fill: BAND, bold: true, size: 18 }),
      cell(`${d.unit.toLocaleString("ko-KR")}원 (${d.basis})`, { w: 3126, size: 18 }),
    ] }),
    new TableRow({ children: [
      cell("목표 생산원가", { w: 1500, fill: HILITE, bold: true, size: 18 }),
      cell([p([t(won(d.cost), { bold: true, size: 22 })], { after: 0 })], { w: 2900, fill: HILITE }),
      cell(d.qty > 1 ? "낱개 환산" : "비고", { w: 1500, fill: HILITE, bold: true, size: 18 }),
      cell(d.qty > 1 ? `${won(d.costEach)} / 개 (${d.qty}개입)` : "단품 기준", { w: 3126, fill: HILITE, size: 18 }),
    ] }),
  ]));
  detail.push(p("", { after: 120 }));

  detail.push(p([t("선정 근거", { bold: true, size: 19, color: NAVY })], { after: 50 }));
  detail.push(p(d.why, { size: 18, indent: { left: 200 } }));
  detail.push(p([
    t("이 형태의 쿠팡 내 추정 월 시장 규모는 약 ", { size: 18 }),
    t(`${d.market}억원`, { size: 18, bold: true }),
    t("입니다. 목표 단위당 가격은 현재 최저가 제품(", { size: 18 }),
    t(`${d.benchBrand} ${d.benchRank}위, ${d.benchUnit.toLocaleString("ko-KR")}원`, { size: 18, bold: true }),
    t(`) 대비 ${Math.abs(d.benchDiff).toFixed(1)}% 낮은 수준입니다.`, { size: 18 }),
  ], { indent: { left: 200 }, after: 120 }));

  detail.push(p([t("비교 대상 (현재 쿠팡 판매 중)", { bold: true, size: 19, color: NAVY })], { after: 50 }));
  const evRows = [new TableRow({
    tableHeader: true,
    children: [
      cell("순위", { w: 900, fill: BAND, bold: true, size: 17, align: AlignmentType.CENTER }),
      cell("브랜드", { w: 1700, fill: BAND, bold: true, size: 17 }),
      cell("규격", { w: 1900, fill: BAND, bold: true, size: 17 }),
      cell("판매가", { w: 1500, fill: BAND, bold: true, size: 17, align: AlignmentType.RIGHT }),
      cell("단위당", { w: 1500, fill: BAND, bold: true, size: 17, align: AlignmentType.RIGHT }),
      cell("리뷰수", { w: 1526, fill: BAND, bold: true, size: 17, align: AlignmentType.RIGHT }),
    ],
  })];
  d.evidence.forEach((e) => evRows.push(new TableRow({ children: [
    cell(`${e.순위}위`, { w: 900, size: 17, align: AlignmentType.CENTER }),
    cell(e.브랜드, { w: 1700, size: 17 }),
    cell(e.규격, { w: 1900, size: 17 }),
    cell(won(e.판매가), { w: 1500, size: 17, align: AlignmentType.RIGHT }),
    cell(`${e.단가.toLocaleString("ko-KR")}원`, { w: 1500, size: 17, align: AlignmentType.RIGHT }),
    cell(e.리뷰.toLocaleString("ko-KR"), { w: 1526, size: 17, align: AlignmentType.RIGHT }),
  ] })));
  evRows.push(new TableRow({ children: [
    cell("제안", { w: 900, fill: HILITE, bold: true, size: 17, align: AlignmentType.CENTER }),
    cell("신제품", { w: 1700, fill: HILITE, bold: true, size: 17 }),
    cell(d.spec, { w: 1900, fill: HILITE, bold: true, size: 17 }),
    cell(won(d.price), { w: 1500, fill: HILITE, bold: true, size: 17, align: AlignmentType.RIGHT }),
    cell(`${d.unit.toLocaleString("ko-KR")}원`, { w: 1500, fill: HILITE, bold: true, size: 17, align: AlignmentType.RIGHT }),
    cell("-", { w: 1526, fill: HILITE, size: 17, align: AlignmentType.RIGHT }),
  ] }));
  detail.push(table([900, 1700, 1900, 1500, 1500, 1526], evRows));
  detail.push(p("", { after: 200 }));
  if (i < D.length - 1 && i % 2 === 1) detail.push(new Paragraph({ children: [new PageBreak()] }));
});

// ── 4. 회신 요청 사항 ─────────────────────────────────
const reply = [
  new Paragraph({ children: [new PageBreak()] }),
  h1("4. 회신 요청 사항"),
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
  p([t("• 용량·수량 규격", { bold: true, size: 18 }), t(" — 본 문서의 규격은 해당 카테고리에서 실제로 상위권에 올라 있는 제품들이 공통으로 채택한 규격입니다. 크게 벗어나면 소비자가 가격을 비교하기 어려워집니다.", { size: 18 })], { indent: { left: 200 }, after: 50 }),
  p([t("• 단위당 가격", { bold: true, size: 18 }), t(" — 쿠팡은 상품 페이지에 100ml당(또는 1개당) 가격을 자동으로 표시합니다. 소비자가 이 숫자로 직접 비교하므로, 총액보다 단위당 가격이 경쟁력을 좌우합니다.", { size: 18 })], { indent: { left: 200 }, after: 200 }),

  h2("참고 사항"),
  p([t("• 본 문서의 시장 규모는 쿠팡이 표시하는 월 구매자수를 근거로 한 ", { size: 18 }), t("추정 하한값", { bold: true, size: 18 }), t("입니다. 쿠팡이 \"3만명 이상\"과 같이 구간으로만 표시하므로 실제 규모는 이보다 클 수 있습니다. 품목 간 상대 비교 용도로만 참고 부탁드립니다.", { size: 18 })], { indent: { left: 200 }, after: 50 }),
  p([t("• 가격·순위는 2026년 9월 21일 기준이며, 쿠팡 순위와 할인가는 수시로 변동합니다.", { size: 18 })], { indent: { left: 200 }, after: 50 }),
  p([t("• 섬유탈취제 리필은 시장 규모가 약 0.7억원으로 가장 작고 현재 판매 중인 제품이 3종뿐입니다. 다른 품목보다 우선순위를 낮게 보셔도 됩니다.", { size: 18 })], { indent: { left: 200 } }),
];

const doc = new Document({
  styles: { default: { document: { run: { font: "맑은 고딕", size: 20 } } } },
  sections: [{
    properties: { page: { margin: { top: 1130, right: 1130, bottom: 1130, left: 1130 } } },
    children: [...cover, ...intro, ...summary, ...detail, ...reply],
  }],
});

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(OUT_FILE, b);
  console.log("생성 완료:", OUT_FILE, b.length, "bytes");
});
