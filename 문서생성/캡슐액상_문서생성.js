const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak,
} = require("docx");

const HERE = __dirname;
const D = JSON.parse(fs.readFileSync(path.join(HERE, "캡슐액상_데이터.json"), "utf8"));
const { items: I, tests: T, factoryQuestions: FQ, meta: M } = D;

const won = (n) => n.toLocaleString("ko-KR") + "원";
const num = (n) => n.toLocaleString("ko-KR");
const shortBasis = (b) => b.replace("당", "").replace("1개", "개");

const W = 9026;
const NAVY = "1F3864", GREY = "595959", LINE = "BFBFBF", BAND = "F2F2F2",
      HILITE = "FFF2CC", WARN = "FBE4D5", OK = "E2EFDA";

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
  columnSpan: o.span, verticalAlign: "center",
  children: (Array.isArray(children) ? children : [children]).map((c) =>
    typeof c === "string" ? p(c, { size: o.size || 18, bold: o.bold, color: o.color, align: o.align, after: 0 }) : c),
});
const table = (widths, rows) => new Table({
  columnWidths: widths,
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  borders: ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].reduce((o, k) => {
    o[k] = { style: BorderStyle.SINGLE, size: 4, color: LINE }; return o;
  }, {}),
  rows,
});
const hdrRow = (labels, widths) => new TableRow({
  tableHeader: true,
  children: labels.map((h, i) => cell(h, { w: widths[i], fill: NAVY, color: "FFFFFF", bold: true, size: 17, align: AlignmentType.CENTER })),
});
const h1 = (x) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 380, after: 150 }, children: [t(x, { size: 26, bold: true, color: NAVY })] });
const h2 = (x) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 110 }, children: [t(x, { size: 22, bold: true, color: NAVY })] });
const br = () => new Paragraph({ children: [new PageBreak()] });
const bullet = (b, r) => p([t("• " + b, { bold: true, size: 18 }), t(r, { size: 18 })], { indent: { left: 200 }, after: 50 });
const callout = (label, body, fill) => [
  table([W], [new TableRow({ children: [cell([p([t(label + "  ", { bold: true, size: 18, color: NAVY }), t(body, { size: 18 })], { after: 0 })], { w: W, fill: fill || BAND })] })]),
  p("", { after: 100 }),
];
const coverTable = (rows) => table([2400, 4200], rows.map(([k, v]) => new TableRow({
  children: [cell(k, { w: 2400, fill: BAND, bold: true, size: 19 }), cell(v, { w: 4200, size: 19 })],
})));

const priceText = (it) => `${won(it.price_low)} ~ ${won(it.price_high)}`;
const costText = (it) => `${won(it.cost_low)} ~ ${won(it.cost_high)}`;

// ══════════════════════════════════════════════════════════════════
// 문서 1 — 생산 견적 요청서 (캡슐 / 액상 2품목)
// ══════════════════════════════════════════════════════════════════
function quoteDoc() {
  const body = [
    p("", { after: 1400 }),
    p([t("신제품 생산 견적 요청", { size: 44, bold: true, color: NAVY })], { align: AlignmentType.CENTER, after: 160 }),
    p([t("캡슐 세탁세제(3챔버) · 액상 세탁세제", { size: 24, color: GREY })], { align: AlignmentType.CENTER, after: 900 }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: NAVY } }, children: [t("")] }),
    coverTable([["작성일", M.docDate], ["시장 조사 기준일", M.surveyDate],
      ["요청 품목", "2종 (캡슐 세탁세제 3챔버 / 액상 세탁세제)"],
      ["발신", ""], ["담당자", ""], ["연락처", ""]]),
    p("", { after: 600 }),
    p([t("본 문서의 목표 원가는 목표 판매가에서 역산한 값입니다.", { size: 19, color: GREY })], { align: AlignmentType.CENTER, after: 40 }),
    p([t("해당 원가를 초과할 경우 목표 판매가를 맞출 수 없습니다.", { size: 19, color: GREY })], { align: AlignmentType.CENTER }),
    br(),

    h1("1. 요청 취지"),
    p("쿠팡에서 판매할 세탁세제 신제품 2종의 생산 견적을 요청드립니다."),
    p("본 문서의 목표 원가는 임의로 정한 값이 아니라, 시장 조사와 손익 구조에서 역산한 값입니다. 해당 원가를 초과하면 목표 판매가를 맞출 수 없고, 목표 판매가를 벗어나면 현재 시장에서 경쟁이 어렵습니다."),

    h2("원가 산출 방식"),
    p(`목표 판매가는 생산원가의 ${M.markup}배로 설정했습니다. 이 배수에는 유통 수수료, 물류비, 마케팅비, 반품·재고 손실이 모두 포함되어 있습니다.`),
    p("", { after: 60 }),
    table([1600, 7426], [new TableRow({
      children: [cell("산식", { w: 1600, fill: NAVY, color: "FFFFFF", bold: true, size: 19 }),
        cell([p([t(`목표 판매가 = 생산원가 × ${M.markup}`, { bold: true, size: 21 })], { after: 40 }),
          p([t(`→ 목표 생산원가 = 목표 판매가 ÷ ${M.markup}`, { size: 19, color: GREY })], { after: 0 })], { w: 7426 })],
    })]),
    p("", { after: 120 }),
    p([t("기재된 목표 원가는 ", {}), t("넘어서는 안 되는 상한값", { bold: true }), t("입니다. 부자재·포장·인쇄를 포함한 완제품 기준 단가로 회신 부탁드립니다.", {})]),

    h2("목표 판매가를 정한 기준 — 최저가를 따라가지 않습니다"),
    p("목표 판매가는 시장 최저가에서 일정 비율을 뺀 값이 아니라, 광고비와 반품까지 반영했을 때 이익이 남는 하한선 안에서 정했습니다."),
    ...callout("추격하지 않는 구간",
      "캡슐 120입 6,500원(개당 약 54원)급 초저가는 대상이 아닙니다. 광고비와 반품을 포함하면 구조적으로 적자입니다. " +
      "액상도 69~77원대(퍼플리·봉쥬르끌레어·리퀴드)는 따라가지 않습니다.", WARN),
    p("대신 아래 두 가지를 동시에 만족하는 구간을 잡았습니다.", { after: 50 }),
    bullet("이익이 남는다", " — 제조원가·수수료·광고비·반품을 빼고도 공헌이익이 확보되는 선"),
    bullet("비교당했을 때 이긴다", " — 같은 규격에서 상위권 제품보다 확실히 싼 단위당 가격"),

    br(),
    h1("2. 요청 품목 총괄"),
  ];

  const SW = [1500, 1700, 1500, 1500, 1500, 1326];
  const sumRows = [hdrRow(["품목", "규격", "목표 판매가", "목표 생산원가", "단위당 가격", "낱개 원가"], SW)];
  I.forEach((it) => it.specs.forEach((sp, i) => sumRows.push(new TableRow({
    children: [
      cell(i === 0 ? it.name + (it.structure === "3챔버" ? "\n(3챔버)" : "") : "", { w: SW[0], size: 17, bold: i === 0 }),
      cell(`${sp.label} · ${sp.pack}`, { w: SW[1], size: 17 }),
      cell(priceText(it), { w: SW[2], size: 16, align: AlignmentType.RIGHT }),
      cell(costText(it), { w: SW[3], size: 16, bold: true, align: AlignmentType.RIGHT, fill: HILITE }),
      cell(`${sp.unit_low}~${sp.unit_high}원/${shortBasis(it.basis)}`, { w: SW[4], size: 16, align: AlignmentType.RIGHT }),
      cell(`${sp.each_cost_low}~${sp.each_cost_high}원`, { w: SW[5], size: 16, align: AlignmentType.RIGHT }),
    ],
  }))));
  body.push(table(SW, sumRows), p("", { after: 140 }));
  body.push(bullet("목표 생산원가", "는 부자재·포장·인쇄를 포함한 완제품 1세트 기준입니다. 판매가 하한(캡슐 8,500원 / 액상 8,900원)일 때가 가장 빠듯한 조건이므로, 그 값을 기준으로 회신 부탁드립니다."));
  body.push(bullet("낱개 원가", "는 캡슐 1개당 / 액상 병 1개당으로 환산한 값입니다."));
  body.push(bullet("캡슐은 3챔버 기준", "입니다. 3챔버 성형이 불가할 경우 2챔버 대안과 그때의 원가 차이를 함께 알려주시기 바랍니다."));
  body.push(br());

  // 품목별 상세
  body.push(h1("3. 품목별 상세"));
  I.forEach((it, idx) => {
    body.push(h2(`3-${idx + 1}. ${it.name}${it.structure === "3챔버" ? " (3챔버)" : ""}`));
    body.push(table([1500, 2900, 1500, 3126], [
      new TableRow({ children: [
        cell("형태", { w: 1500, fill: BAND, bold: true, size: 18 }), cell(`${it.form} / ${it.structure}`, { w: 2900, size: 18 }),
        cell("규격", { w: 1500, fill: BAND, bold: true, size: 18 }),
        cell(it.specs.map((s) => `${s.label} ${s.pack}`).join("  ·  "), { w: 3126, size: 18 })] }),
      new TableRow({ children: [
        cell("목표 판매가", { w: 1500, fill: BAND, bold: true, size: 18 }), cell(priceText(it), { w: 2900, size: 18 }),
        cell("단위당 가격", { w: 1500, fill: BAND, bold: true, size: 18 }),
        cell(it.specs.map((s) => `${s.pack.split(" ")[0]} ${s.unit_low}~${s.unit_high}원/${shortBasis(it.basis)}`).join("\n"), { w: 3126, size: 18 })] }),
      new TableRow({ children: [
        cell("목표 생산원가", { w: 1500, fill: HILITE, bold: true, size: 18 }),
        cell([p([t(costText(it), { bold: true, size: 22 })], { after: 0 })], { w: 2900, fill: HILITE }),
        cell("낱개 환산", { w: 1500, fill: HILITE, bold: true, size: 18 }),
        cell(it.specs.map((s) => `${s.pack.split(" ")[0]} ${s.each_cost_low}~${s.each_cost_high}원`).join("\n"), { w: 3126, fill: HILITE, size: 18 })] }),
    ]));
    body.push(p("", { after: 120 }));
    body.push(p([t("시장 내 위치", { bold: true, size: 19, color: NAVY })], { after: 50 }));
    body.push(p(it.position, { size: 18, indent: { left: 200 }, after: 60 }));
    body.push(p([t("※ ", { size: 18, color: GREY }), t(it.note, { size: 18, color: GREY })], { indent: { left: 200 }, after: 120 }));

    body.push(p([t("비교 대상 (2026년 9월 21일 쿠팡 판매 중)", { bold: true, size: 19, color: NAVY })], { after: 50 }));
    const EW = [900, 1700, 1900, 1500, 1500, 1526];
    const ev = [hdrRow(["순위", "브랜드", "규격", "판매가", "단위당", "리뷰수"], EW)];
    it.market.forEach((m) => {
      const inBand = m.unit >= it.specs[0].unit_low * 0.98 && m.unit <= it.specs[it.specs.length - 1].unit_high * 1.02;
      ev.push(new TableRow({ children: [
        cell(m.rank ? `${m.rank}위` : "-", { w: EW[0], size: 17, align: AlignmentType.CENTER, fill: inBand ? OK : undefined }),
        cell(m.brand, { w: EW[1], size: 17, fill: inBand ? OK : undefined }),
        cell(m.spec, { w: EW[2], size: 17, fill: inBand ? OK : undefined }),
        cell(won(m.price), { w: EW[3], size: 17, align: AlignmentType.RIGHT, fill: inBand ? OK : undefined }),
        cell(`${num(m.unit)}원`, { w: EW[4], size: 17, align: AlignmentType.RIGHT, fill: inBand ? OK : undefined }),
        cell(num(m.review), { w: EW[5], size: 17, align: AlignmentType.RIGHT, fill: inBand ? OK : undefined }),
      ] }));
    });
    ev.push(new TableRow({ children: [
      cell("제안", { w: EW[0], fill: HILITE, bold: true, size: 17, align: AlignmentType.CENTER }),
      cell("신제품", { w: EW[1], fill: HILITE, bold: true, size: 17 }),
      cell(it.specs[0].pack, { w: EW[2], fill: HILITE, bold: true, size: 17 }),
      cell(priceText(it), { w: EW[3], fill: HILITE, bold: true, size: 16, align: AlignmentType.RIGHT }),
      cell(`${it.specs[0].unit_low}~${it.specs[0].unit_high}원`, { w: EW[4], fill: HILITE, bold: true, size: 16, align: AlignmentType.RIGHT }),
      cell("-", { w: EW[5], fill: HILITE, size: 17, align: AlignmentType.RIGHT }),
    ] }));
    body.push(table(EW, ev));
    body.push(p([t("음영 표시가 목표 판매가 구간에 해당하는 경쟁 제품입니다.", { size: 17, color: GREY })], { after: 140 }));

    // 요청 사양
    body.push(p([t("요청 사양", { bold: true, size: 19, color: NAVY })], { after: 50 }));
    body.push(p("인증·시험 항목은 현재 시장에서 확인된 최고 수준을 기준으로 잡았습니다. 숫자가 붙는 항목은 시장 최댓값을 넘도록 설정했습니다.", { size: 18, after: 80 }));
    const RW = [800, 2600, 2400, 3226];
    const rows = [hdrRow(["구분", "사양", "시장 기준", "필요 시험"], RW)];
    it.usp_plan.forEach((u) => {
      const base = u.tier === "기본";
      rows.push(new TableRow({
        children: [
          cell(u.tier, { w: RW[0], size: 17, align: AlignmentType.CENTER, bold: true,
                         fill: base ? WARN : OK }),
          cell(u.claim, { w: RW[1], size: 17, bold: true }),
          cell(u.market, { w: RW[2], size: 16, color: GREY }),
          cell(u.test === "-" ? "-" : u.test, { w: RW[3], size: 16 }),
        ],
      }));
    });
    body.push(table(RW, rows));
    body.push(p([t("'기본'은 현재 시장 제품들이 갖춘 것을 최대치로 모은 사양입니다. 빼면 비교에서 밀립니다. '차별화'는 그 위에 더하는 항목입니다.", { size: 17, color: GREY })], { after: 120 }));
    if (idx < I.length - 1) body.push(br());
  });

  body.push(br());
  body.push(h1("4. 함께 확인 부탁드릴 사항"));
  const QW = [2600, 6426];
  const qrows = [hdrRow(["항목", "확인 내용"], QW)];
  FQ.forEach(([k, v]) => qrows.push(new TableRow({
    children: [cell(k, { w: QW[0], size: 17, bold: true, fill: BAND }), cell(v, { w: QW[1], size: 17 })],
  })));
  body.push(p("아래 항목은 원가 또는 일정에 직접 영향을 주는 사항입니다.", { after: 100 }));
  body.push(table(QW, qrows));
  body.push(p("", { after: 200 }));

  body.push(h1("5. 회신 요청 사항"));
  body.push(p("", { after: 100 }));
  body.push(table([600, 2600, 5826], [
    ["", "항목", "내용"],
    ["1", "제시 단가", "완제품 1세트 기준 공급가 (부자재·포장·인쇄 포함 여부 명시)"],
    ["2", "목표 원가 충족 여부", "본 문서의 목표 생산원가 이내 가능 여부. 불가 시 최소 가능 단가"],
    ["3", "최소 주문 수량 (MOQ)", "품목별·규격별 최소 생산 수량"],
    ["4", "리드타임", "발주 후 납품까지 소요 기간"],
    ["5", "수량별 단가", "MOQ / 3배 / 5배 수량 구간별 단가"],
    ["6", "사양별 원가 영향", "3챔버, 효소 종수, 고미제, 재밀봉 포장 등 항목별 원가 증감"],
    ["7", "규격 조정 제안", "목표 원가를 맞추기 위해 조정 가능한 규격이 있다면 그 내용"],
  ].map(([n, k, v], i) => new TableRow({
    children: i === 0
      ? [cell("", { w: 600, fill: NAVY }), cell(k, { w: 2600, fill: NAVY, color: "FFFFFF", bold: true, size: 18 }), cell(v, { w: 5826, fill: NAVY, color: "FFFFFF", bold: true, size: 18 })]
      : [cell(n, { w: 600, fill: BAND, bold: true, size: 18, align: AlignmentType.CENTER }), cell(k, { w: 2600, bold: true, size: 18 }), cell(v, { w: 5826, size: 18 })],
  }))));
  body.push(p("", { after: 200 }));
  body.push(h2("규격 조정에 대하여"));
  body.push(p("목표 원가를 맞추기 어려운 경우, 무리한 단가 인하보다 규격 조정을 먼저 검토하고자 합니다. 다만 아래는 시장 조사에서 확인된 제약입니다."));
  body.push(bullet("단위당 가격", " — 쿠팡은 상품 페이지에 1개당(캡슐) 또는 100ml당(액상) 가격을 자동 표시합니다. 소비자가 이 숫자로 직접 비교하므로 총액보다 단위당 가격이 경쟁력을 좌우합니다."));
  body.push(bullet("규격", " — 캡슐 100~120입, 액상 2.5L 4개입은 해당 가격대 상위 제품들이 공통으로 채택한 규격입니다. 크게 벗어나면 비교 자체가 어려워집니다."));
  body.push(bullet("'기본' 사양", " — 3장의 기본 항목은 현재 시장 제품들이 갖춘 것을 최대치로 모은 것입니다. 이걸 빼서 원가를 맞추면 비교표에서 밀리므로, 조정 대상이 아닙니다. 조정이 필요하면 '차별화' 항목부터 검토해 주시기 바랍니다."));
  return body;
}

// ══════════════════════════════════════════════════════════════════
// 문서 2 — USP 정리 및 임상·시험 제안서
// ══════════════════════════════════════════════════════════════════
function uspDoc() {
  const body = [
    p("", { after: 1400 }),
    p([t("USP 정리 및 임상·시험 제안", { size: 40, bold: true, color: NAVY })], { align: AlignmentType.CENTER, after: 160 }),
    p([t("캡슐 세탁세제(3챔버) · 액상 세탁세제", { size: 24, color: GREY })], { align: AlignmentType.CENTER, after: 900 }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: NAVY } }, children: [t("")] }),
    coverTable([["작성일", M.docDate], ["시장 조사 기준일", M.surveyDate],
      ["USP 조사 범위", "캡슐 4개 SKU / 액상 13개 SKU (상세페이지 직접 확인)"],
      ["대상 품목", "2종"], ["작성", ""]]),
    br(),

    h1("1. 이 문서의 목적"),
    p("경쟁 제품이 상세페이지에서 내세우는 소구점(USP)을 정리하고, 우리 제품이 무엇을 말할지, 그 말을 뒷받침하려면 어떤 시험이 필요한지를 정리한 문서입니다."),
    p("소구점은 말만으로는 성립하지 않습니다. '피부에 순하다'는 문장은 시험 성적서가 있을 때만 상세페이지에 쓸 수 있습니다. 그래서 USP와 시험을 한 문서에서 묶어 다룹니다."),
    ...callout("조사 방법과 범위",
      "상세페이지를 사람이 직접 열어 확인했습니다(캡슐 4 SKU / 액상 13 SKU). 같은 내용이 반복되는 것은 " +
      "옮겨 적지 않았으므로, 어느 제품이 무엇을 말하는지까지는 전수가 아닙니다. 다만 어떤 종류의 소구점이 " +
      "시장에 존재하는지는 이 목록이 덮는 것으로 봅니다. 캡슐 15개 · 액상 33개 소구점이 확인됐습니다."),

    h1("2. 시장이 내세우는 것 — 조사 결과"),
  ];

  I.forEach((it) => {
    body.push(h2(`2-${I.indexOf(it) + 1}. ${it.name}`));
    const OW = [700, 1300, 1200, 1100, 4726];
    const rows = [hdrRow(["순위", "브랜드", "판매가", "단위당", "내세우는 것"], OW)];
    it.observed.forEach((o) => rows.push(new TableRow({
      children: [
        cell(`${o.rank}위`, { w: OW[0], size: 17, align: AlignmentType.CENTER }),
        cell(o.brand, { w: OW[1], size: 17, bold: true }),
        cell(won(o.price), { w: OW[2], size: 17, align: AlignmentType.RIGHT }),
        cell(`${num(o.unit)}원`, { w: OW[3], size: 17, align: AlignmentType.RIGHT }),
        cell(o.usps.join(" / "), { w: OW[4], size: 17 }),
      ],
    })));
    body.push(table(OW, rows));
    body.push(p("", { after: 140 }));
  });

  body.push(h2("읽어낸 것"));
  body.push(bullet("효소 종수는 이미 표준이다.", " 캡슐은 9종(맘스럽·허니맘), 액상은 8~9종(피지·액츠·퍼플리)이 가격대를 가리지 않고 나옵니다. 차별점이 아니라 입장권입니다."));
  body.push(bullet("'더마'는 저가권도 갖고 있다.", " 허니맘(49.1원)도 더마를 표기합니다. 없으면 오히려 빠져 보입니다."));
  body.push(bullet("실내건조 쉰내가 고가의 근거다.", " 액상 1위 피지는 697.6원으로 최저가의 9배인데, 그 값을 받는 근거가 모락셀라·쉰내입니다. 그런데 우리 목표 구간(89~109원)에는 이 무기를 가진 제품이 없습니다."));
  body.push(bullet("캡슐에는 구조 이야기가 없다.", " 조사한 4개 SKU 중 챔버 구조를 내세운 곳이 없습니다. 3챔버를 쓰면서 그 이유를 설명하지 않으면 원가만 올라갑니다."));
  body.push(bullet("저가권도 인증으로 싸운다.", " 퍼플리(75.7원)는 협회 인증 2종과 무첨가 16종을 내세웁니다. 싸다고 해서 아무것도 없이 파는 것이 아닙니다."));
  body.push(br());

  body.push(h1("3. 우리가 말할 것 — USP 구성안"));
  body.push(p("두 등급으로 나눴습니다."));
  body.push(bullet("기본", " — 현재 시장 제품들이 갖춘 인증·시험·성분을 **최대치로** 모은 것입니다. " +
    "'남들만큼'이 아니라 '관찰된 것 중 가장 센 값 이상'이 기준입니다. 효소 종수, 불검출 종수, 농축 배수처럼 " +
    "숫자가 붙는 항목은 시장 최댓값을 넘도록 잡았습니다."));
  body.push(bullet("차별화", " — 그 위에 카테고리별로 더하는 항목입니다. 광고와 상세페이지 상단에 쓸 무기입니다."));
  body.push(p("", { after: 100 }));
  body.push(...callout("시장 최대치를 기준으로 삼은 이유",
    "인증과 시험은 하나씩 늘려봐야 '남들도 있는 것'이 됩니다. 처음부터 시장에 흩어져 있는 것을 " +
    "한 제품에 모으고, 숫자가 있는 항목은 최댓값을 넘겨야 비교표에서 밀리지 않습니다. " +
    "예를 들어 효소는 퍼플리 9종이 최대이고 저가권도 9종을 답니다. 9종으로는 동점이고, 10종부터 우위입니다."));
  I.forEach((it) => {
    body.push(h2(`3-${I.indexOf(it) + 1}. ${it.name}`));
    const UW = [800, 800, 2300, 2500, 2626];
    const rows = [hdrRow(["구분", "분류", "소구점", "시장에서 확인된 수준", "우리 기준 / 근거"], UW)];
    it.usp_plan.forEach((u) => {
      const base = u.tier === "기본";
      rows.push(new TableRow({ children: [
        cell(u.tier, { w: UW[0], size: 16, align: AlignmentType.CENTER, bold: true,
                       fill: base ? WARN : OK }),
        cell(u.group, { w: UW[1], size: 16, align: AlignmentType.CENTER }),
        cell(u.claim, { w: UW[2], size: 17, bold: true }),
        cell(u.market, { w: UW[3], size: 16, color: GREY }),
        cell([p(u.target === "-" ? "" : u.target, { size: 16, after: 30 }),
          ...(u.test !== "-" ? [p([t("시험: " + u.test, { size: 16, bold: true, color: NAVY })], { after: 0 })] : [])], { w: UW[4] }),
      ] }));
    });
    body.push(table(UW, rows));
    body.push(p("", { after: 140 }));
    if (I.indexOf(it) < I.length - 1) body.push(br());
  });

  body.push(br());
  body.push(h1("4. 임상·시험 제안"));
  body.push(p("위 소구점을 상세페이지에 쓰려면 근거가 필요합니다. 필요한 시험을 세 등급으로 정리했습니다."));
  body.push(...callout("먼저 착수해야 할 것",
    "3챔버 성분 분리 효과 실증은 보관 기간이 필요해 가장 오래 걸립니다(6개월). 다른 시험보다 먼저 시작해야 출시 일정에 맞출 수 있습니다. " +
    "3챔버는 원가가 올라가는 선택이므로, 그 값어치를 증명하지 못하면 단순한 원가 상승으로 끝납니다.", WARN));

  const TW = [1100, 2000, 2800, 900, 2226];
  const trows = [hdrRow(["등급", "시험 항목", "목적", "기간", "표기 문구 / 비고"], TW)];
  T.forEach((x) => {
    const fill = x.tier.startsWith("A") ? WARN : (x.tier.startsWith("B") ? OK : undefined);
    trows.push(new TableRow({ children: [
      cell(x.tier, { w: TW[0], size: 16, align: AlignmentType.CENTER, bold: true, fill }),
      cell([p(x.name, { size: 17, bold: true, after: 30 }),
        p([t(x.applies, { size: 15, color: GREY })], { after: 0 })], { w: TW[1] }),
      cell(x.purpose, { w: TW[2], size: 16 }),
      cell(x.period, { w: TW[3], size: 16, align: AlignmentType.CENTER }),
      cell([p([t(x.output, { size: 16, bold: true })], { after: 30 }),
        ...(x.note !== "-" ? [p([t(x.note, { size: 15, color: GREY })], { after: 0 })] : [])], { w: TW[4] }),
    ] }));
  });
  body.push(table(TW, trows));
  body.push(p("", { after: 140 }));
  body.push(...callout("확인 필요",
    "위 기간은 개략치이며 시험 규격·기관·비용은 확정 전 반드시 시험기관에 확인해야 합니다. " +
    "또한 제조사가 이미 보유한 성적서가 있으면 중복 시험을 피할 수 있으므로, 견적 요청과 함께 보유 현황을 먼저 받아보는 것이 좋습니다."));

  body.push(br());
  body.push(h1("5. 상세페이지 배치 제안"));
  body.push(p("소구점은 무엇을 말하느냐만큼 어디에 두느냐가 중요합니다. 판매자가 위에 크게 둔 것이 그 제품의 핵심입니다."));
  body.push(p("", { after: 100 }));
  const PW = [1200, 3000, 4826];
  const prows = [hdrRow(["위치", "무엇을 둘 것인가", "이유"], PW)];
  [["상단", "가격 번역 + 차별화 1개\n(예: 1회 세탁 OO원 / 실내건조 쉰내 억제)",
    "가성비 제품은 가격으로 들어옵니다. 다만 '싸다'만 말하면 더 싼 제품에 집니다. 싼 이유가 아니라 싼데 무엇이 되는지를 먼저 보여줘야 합니다."],
   ["중단", "기본 사양 묶음\n(효소 10종, 불검출 16종, 국내+독일 더마, 협회 인증, 겸용)",
    "여기서 '빠진 것이 없다'를 확인시킵니다. 경쟁 제품과 나란히 놓았을 때 비어 보이지 않게 하는 구간입니다."],
   ["하단", "시험 성적서 · 인증 · 성분표",
    "구매 직전 마지막 의심을 지우는 자리입니다. 근거 문서는 요약하지 말고 그대로 보여주는 편이 신뢰가 높습니다."]]
    .forEach(([a, b, c]) => prows.push(new TableRow({
      children: [cell(a, { w: PW[0], size: 17, bold: true, align: AlignmentType.CENTER, fill: BAND }),
        cell(b, { w: PW[1], size: 17 }), cell(c, { w: PW[2], size: 17 })],
    })));
  body.push(table(PW, prows));
  body.push(p("", { after: 200 }));

  body.push(h2("표현에 대한 주의"));
  body.push(p("세제는 표시·광고 규제 대상입니다. 아래는 실무에서 자주 문제가 되는 부분입니다."));
  body.push(bullet("수치 표기는 시험 성적서 범위 안에서", " — '99.9% 제거' 같은 표기는 그 조건(균종·시간·농도)을 함께 적어야 합니다. 성적서보다 넓게 말하면 허위·과장이 됩니다."));
  body.push(bullet("'무독성', '인체 무해' 같은 단정 표현은 피할 것", " — 시험으로 증명할 수 없는 범위입니다."));
  body.push(bullet("인증은 유효기간과 범위를 확인할 것", " — 특정 제품에만 유효한 인증을 라인 전체에 쓰면 문제가 됩니다."));
  body.push(bullet("경쟁사 비교는 근거가 있을 때만", " — 시장에서 비교표를 쓰는 제품이 있으나, 근거 없는 비교는 분쟁 소지가 큽니다."));
  return body;
}

function build(children, out) {
  const doc = new Document({
    styles: { default: { document: { run: { font: "맑은 고딕", size: 20 } } } },
    sections: [{ properties: { page: { margin: { top: 1130, right: 1130, bottom: 1130, left: 1130 } } }, children }],
  });
  return Packer.toBuffer(doc).then((b) => {
    fs.writeFileSync(out, b);
    console.log("생성 완료:", out, b.length, "bytes");
  });
}

const ROOT = path.join(HERE, "..");
build(quoteDoc(), path.join(ROOT, "quote_capsule_liquid.docx"))
  .then(() => build(uspDoc(), path.join(ROOT, "usp_clinical_proposal.docx")));
