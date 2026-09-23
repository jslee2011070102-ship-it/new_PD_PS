'use strict';

const paths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  chart: '<path d="M4 3v17h17M8 15v-4m5 4V6m5 9V9"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7 5.8l9 5V16"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  sparkles: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3ZM20 2v4m-2-2h4M3 19v3m-1.5-1.5h3"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v15"/>',
  'arrow-right': '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  'arrow-down': '<path d="M12 4v15m-6-6 6 6 6-6"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  github: '<path d="M9 19c-5 1-5-3-7-3m14 6v-4c0-1-.4-2-1-2 4 0 6-2 6-5 0-2-1-3-1-3s0-3-1-4c-2 0-3 1-3 1-3-1-5-1-8 0 0 0-1-1-3-1-1 1-1 4-1 4s-1 1-1 3c0 3 2 5 6 5-.6 0-1 1-1 2v4"/>',
  home: '<path d="m3 10 9-7 9 7v10H3V10ZM9 20v-8h6v8"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9 21h6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 11l3 3 5-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  bulb: '<path d="M8 17c0-3-3-4-3-8a7 7 0 0 1 14 0c0 4-3 5-3 8H8ZM9 21h6M10 17v-6m4 6v-6"/>',
  bottle: '<path d="M9 3h6v4l3 3v11H6V10l3-3V3ZM9 3V1h6v2M6 13h12M10 17h4"/>',
  capsule: '<rect x="4" y="6" width="16" height="12" rx="6" transform="rotate(-40 12 12)"/><path d="m8 7 8 10"/>',
  spray: '<path d="M10 7V4h7l3 2M10 4H6V2h10v2M10 7l-4 5v9h12v-9l-4-5h-4ZM6 15h12"/>',
  leaf: '<path d="M20 3C6 1 1 9 7 16c7 6 15 1 13-13ZM5 21 16 9"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const number = value => value == null ? '—' : Number(value).toLocaleString('ko-KR', {maximumFractionDigits: 1});
const won = value => value == null ? '—' : `${number(value)}원`;
const revenue = value => value == null ? '—' : value >= 100000000 ? `${(value / 100000000).toFixed(1)}억` : `${number(Math.round(value / 10000))}만`;
const cats = ['세탁세제', '캡슐세제', '섬유유연제', '섬유탈취제', '주방세제', '살균소독제'];
const catStyles = ['blue', 'purple', 'pink', 'mint', 'yellow', ''];
const catIcons = ['bottle', 'capsule', 'leaf', 'spray', 'bottle', 'shield'];
const pages = {overview: '대시보드', market: '시장 분석', specs: '신제품 기획', usp: 'USP 분석', documents: '산출물 관리', data: '데이터 관리'};
const state = {data: null, original: null, page: 'overview', category: '전체', query: '', role: '', basis: '', validation: '', sort: 'rank', pageNumber: 1, specCategory: '전체', overrides: {}, pendingImport: null};
const $ = selector => document.querySelector(selector);
const main = $('#main');
const dialog = $('#dialog');
let toastTimer;

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
function catIcon(cat) {
  const index = cats.indexOf(cat);
  return `<span class="category-icon ${catStyles[index] || ''}">${icon(catIcons[index])}</span>`;
}
function badge(validation) {
  return `<span class="pill ${validation === '일치' ? 'green' : validation === '표기없음' ? 'amber' : 'red'}">${esc(validation)}</span>`;
}
function roleBadge(role) { return `<span class="pill ${role === '본품' ? 'green' : role === '리필' ? 'blue' : ''}">${esc(role)}</span>`; }
function toast(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3400);
}
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `요청에 실패했습니다 (${response.status}).`);
  }
  return response;
}
function pageHeading(title, subtitle, actions = true) {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="heading-actions"><button class="button" data-action="export" title="엑셀 내보내기" aria-label="엑셀 내보내기">${icon('download')}엑셀 내보내기</button><button class="button primary" data-action="upload" title="데이터 불러오기" aria-label="데이터 불러오기">${icon('upload')}데이터 불러오기</button></div>` : '<span class="source-badge">쿠팡 · 1차 리서치</span>'}</div>`;
}
function sessionBanner() {
  return Object.keys(state.overrides).length ? `<div class="session-banner">${icon('info')}업로드 데이터 적용 중 · 새로고침 시 초기화됩니다. 기획 규격과 견적서는 원본 기준입니다.<button class="text-button" data-action="reset-data">원본으로 복원 ${icon('refresh')}</button></div>` : '';
}
function heroArt() {
  return `<svg class="hero-art" viewBox="0 0 300 225" fill="none" aria-hidden="true"><defs><linearGradient id="bottle-fill" x1="115" y1="62" x2="196" y2="193" gradientUnits="userSpaceOnUse"><stop stop-color="#a7c7a0"/><stop offset="1" stop-color="#729682"/></linearGradient><linearGradient id="pouch-fill" x1="192" y1="95" x2="246" y2="196" gradientUnits="userSpaceOnUse"><stop stop-color="#d7dfbf"/><stop offset="1" stop-color="#a8bc9b"/></linearGradient></defs><ellipse cx="181" cy="211" rx="99" ry="12" fill="#113d33" opacity=".6"/><ellipse cx="182" cy="197" rx="108" ry="10" fill="#386956"/><path d="M74 194h216v11c-62 15-154 13-216 0v-11Z" fill="#2b614e"/><path d="M134 50h30v15c0 9 17 13 17 28v100c-20 7-45 7-65 0V93c0-16 18-19 18-28V50Z" fill="url(#bottle-fill)"/><path d="M119 98v90c9 4 13 5 20 5" stroke="#bfd2b1" stroke-opacity=".45" stroke-width="2"/><rect x="132" y="36" width="34" height="19" rx="3" fill="#d1d9b4"/><path d="M137 38v14m6-14v14m6-14v14m6-14v14m6-14v14" stroke="#a8b69a"/><rect x="124" y="107" width="49" height="60" rx="3" fill="#e4e7cd"/><path d="m148 119 9 5v10l-9 5-9-5v-10l9-5Z" stroke="#74937a"/><path d="M137 150h23m-18 6h13" stroke="#9fac94" stroke-width="2"/><path d="m197 101 38 1 12 93c-18 6-39 5-56-1l6-93Z" fill="url(#pouch-fill)"/><path d="m197 102 6 10h25l7-10" stroke="#e4e9d0" stroke-width="2"/><path d="M203 94h11v10h-11z" fill="#c5d1ae"/><rect x="200" y="88" width="17" height="8" rx="2" fill="#e0e4c5"/><path d="m206 132 11-5 11 5v13l-11 6-11-6v-13Z" stroke="#7c977b"/><path d="M206 164h23m-19 6h16" stroke="#809981" stroke-width="2"/><path d="M75 138h37l7 58c-14 4-31 4-46 0l2-58Z" fill="#668e79"/><ellipse cx="94" cy="137" rx="19" ry="5" fill="#a3b79b"/><rect x="82" y="153" width="27" height="28" rx="2" fill="#becbaa"/><path d="m89 166 5-6 6 6-6 6-5-6Z" stroke="#65876c"/><path d="M217 44v12m-6-6h12M91 83v8m-4-4h8" stroke="#a9be86" stroke-opacity=".7"/><circle cx="250" cy="74" r="3" stroke="#87a679"/><circle cx="102" cy="55" r="2" fill="#6d9476"/><path d="M252 160c18-33 9-42 4-43-13 0-7 27-4 43Z" fill="#7d9c72"/><path d="M251 158c-21-13-25-7-23-1 2 7 17 9 23 1Z" fill="#abc18c"/><path d="M252 183v-30" stroke="#a9bc8c"/></svg>`;
}
function overview() {
  const {summary: s, specs} = state.data;
  const categoryCount = s.categories.filter(c => c.count > 0).length;
  const cards = [
    ['조사 카테고리', categoryCount, '개', 'layers', '<span class="green-dot"></span><b>생활용품</b> 핵심 카테고리'],
    ['분석 제품', s.count, '개', 'box', `<span class="green-dot"></span><b>${s.brands}개 브랜드</b> 경쟁 제품 수집`],
    ['신제품 목표 규격', specs.length, '종', 'file', `${icon('check')}<b>본품 + 리필</b> 카테고리별 2종`],
    ['단가 검증 일치율', s.verified_percent, '%', 'shield', `${icon('check')}<b>${s.validation['일치'] || 0}건 일치</b> · ${s.validation['표기없음'] || 0}건 표기없음`],
  ];
  const ordered = cats.flatMap(cat => specs.filter(p => p.cat === cat && p.role === '본품')).slice(0, 4);
  return `${pageHeading('리서치 대시보드', '시장의 흐름을 읽고, 다음 제품의 가능성을 발견하세요.')}${sessionBanner()}
    <div class="hero-grid"><section class="hero"><div class="hero-label"><span></span>FROM DATA TO YOUR NEXT PRODUCT</div><h2>데이터에서 발견하는,<br><em>다음 제품의 가능성.</em></h2><p>${categoryCount}개 카테고리, ${s.count}개 제품에서 찾은 새로운 기회의 시작</p><a href="#market" class="button">시장 데이터 살펴보기 ${icon('arrow-right')}</a>${heroArt()}</section>
    <section class="workflow"><div class="panel-heading"><h2>리서치 진행 현황</h2><span class="pill green">1차 조사</span></div><div class="workflow-list">${[['썸네일 수집','완료'],['가격 · 시장 데이터 분석','완료'],['신제품 목표 규격 도출','완료'],['상세페이지 USP 분석','수집 대기'],['생산 견적요청서','작성 완료']].map(([name,status],i) => `<a href="#${['data','market','specs','usp','documents'][i]}" class="workflow-step ${i === 3 ? 'waiting' : ''}"><span class="step-dot">${i === 3 ? '4' : icon('check')}</span><span>${name}</span><span>${status}</span></a>`).join('')}</div></section></div>
    <div class="stats-grid">${cards.map(([label,value,unit,i,foot]) => `<article class="stat-card"><div class="stat-label">${label}<span class="stat-icon">${icon(i)}</span></div><div class="stat-number">${number(value)}<small>${unit}</small></div><div class="stat-foot">${foot}</div></article>`).join('')}</div>
    <div class="charts-grid"><section class="panel chart-panel"><div class="panel-heading"><div><h2>카테고리별 추정 월매출</h2><p>조사 제품의 매출 규모를 한눈에 비교해 보세요.</p></div><span class="chart-legend"><i></i>추정 월매출</span></div>${barChart(s.categories)}<div class="chart-note">${icon('info')}월구매자수 × 판매가 × 2 · 표본 내 규모 비교용이며 실제 전체 시장 매출이 아닙니다.</div></section>
    <section class="panel role-panel"><div class="panel-heading"><h2>본품 · 리필 구성</h2><select id="role-category" class="select-small" aria-label="제품 구성 카테고리"><option>전체 카테고리</option>${cats.map(c => `<option>${c}</option>`).join('')}</select></div><div id="role-chart">${roleChart(s.roles)}</div><div class="role-insight">${icon('bulb')}제품의 <b>형태와 역할</b>은 구분해서 확인하세요.</div></section></div>
    <section><div class="section-heading"><div><h2>신제품 기획 한눈에 보기 <small>12종</small></h2><p>시장 가격대를 바탕으로 도출한 목표 규격과 생산원가입니다.</p></div><a class="text-button" href="#specs">전체 보기 ${icon('arrow-right')}</a></div><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>카테고리</th><th>제품 역할</th><th>목표 규격</th><th>목표 판매가</th><th>목표 생산원가</th><th>경쟁 기준 대비</th><th></th></tr></thead><tbody>${ordered.map(p => `<tr class="clickable" data-spec="${specs.indexOf(p)}" tabindex="0" aria-label="${esc(p.cat)} ${esc(p.role)} 상세"><td><div class="category-cell">${catIcon(p.cat)}${esc(p.cat)}</div></td><td>${roleBadge(p.role)}</td><td>${esc(p.spec)}</td><td class="amount">${won(p.price)}</td><td class="amount green">${won(p.cost)}</td><td><span class="pill green">${icon('arrow-down')}${number(Math.abs(p.benchDiff))}%</span></td><td>${icon('chevron-right')}</td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>생산원가 = 목표 판매가 ÷ 3.5 · 묶음 전체 기준</span><a class="text-button" href="/api/document" download>${icon('download')}견적요청서 다운로드</a></div></div></section>
    <div class="insight-strip">${icon('bulb')}<div><strong>다음 리서치 단계</strong>목표 제품의 상세페이지를 수집하고, 경쟁 제품의 핵심 USP를 비교해 보세요.</div><a class="text-button" href="#usp">USP 분석 준비 ${icon('arrow-right')}</a></div>`;
}
function barChart(categories) {
  const ordered = [...categories].sort((a,b) => b.revenue - a.revenue);
  const max = Math.max(...ordered.map(c => c.revenue / 1e8), 1);
  const ceiling = Math.ceil(max / 20) * 20;
  return `<div class="chart" aria-label="카테고리별 추정 월매출 막대 차트"><div class="chart-gridlines">${[4,3,2,1,0].map(i => `<div class="gridline"><span>${number(ceiling * i / 4)}억</span></div>`).join('')}</div><div class="chart-bars">${ordered.map(c => `<button class="bar-group" data-category-go="${esc(c.name)}" aria-label="${esc(c.name)} 추정월매출 ${revenue(c.revenue)}원, 제품 보기" title="${esc(c.name)} · 추정월매출 ${won(c.revenue)} · 매출 산출 ${c.known_revenue}/${c.count}건"><span class="bar-value">${revenue(c.revenue)}</span><span class="bar" style="height:${(c.revenue / 1e8 / ceiling * 145).toFixed(1)}px"></span><span class="bar-label">${esc(c.name)}</span></button>`).join('')}</div></div>`;
}
function roleChart(roles) {
  const total = Object.values(roles).reduce((a,b) => a + b, 0);
  const a = (roles['본품'] || 0) / (total || 1) * 100;
  const b = a + (roles['리필'] || 0) / (total || 1) * 100;
  const colors = ['#418167','#a4be9c','#e5ebe4'];
  return `<div class="donut-area"><div class="donut" role="img" aria-label="본품 ${roles['본품'] || 0}개, 리필 ${roles['리필'] || 0}개, 불명 ${roles['불명'] || 0}개" style="background:conic-gradient(${colors[0]} 0 ${a}%,${colors[1]} ${a}% ${b}%,${colors[2]} ${b}% 100%)"><div class="donut-center"><small>전체 제품</small><strong>${number(total)}<span>개</span></strong></div></div><div class="donut-legend">${['본품','리필','불명'].map((role,i) => `<div><i class="legend-dot" style="background:${colors[i]}"></i><span>${role}</span><strong>${roles[role] || 0}</strong></div>`).join('')}</div></div>`;
}
function categoryTabs(selected, attr = 'category') {
  return `<div class="category-tabs" role="group" aria-label="카테고리 선택">${['전체',...cats].map(c => `<button class="tab ${selected === c ? 'active' : ''}" data-${attr}="${esc(c)}" aria-pressed="${selected === c}">${c}${attr === 'category' ? `<small>${c === '전체' ? state.data.products.length : state.data.summary.categories.find(x => x.name === c).count}</small>` : ''}</button>`).join('')}</div>`;
}
function market() {
  return `${pageHeading('시장 분석', '경쟁 제품의 가격, 규격, 시장 지표를 탐색하고 기회의 근거를 확인하세요.')}${sessionBanner()}<section class="filter-panel">${categoryTabs(state.category)}<div class="filter-row"><label class="search-field">${icon('search')}<input id="product-search" type="search" aria-label="제품 또는 브랜드 검색" placeholder="제품명 또는 브랜드를 검색하세요" value="${esc(state.query)}"></label><select id="role-filter" class="filter-select" aria-label="제품 역할"><option value="">역할 전체</option>${['본품','리필','불명'].map(v => `<option ${v === state.role ? 'selected' : ''}>${v}</option>`).join('')}</select><select id="basis-filter" class="filter-select" aria-label="단가 기준"><option value="">단가 기준 전체</option>${['100ml당','100g당','1개당'].map(v => `<option ${v === state.basis ? 'selected' : ''}>${v}</option>`).join('')}</select><select id="validation-filter" class="filter-select" aria-label="단가 검증 상태"><option value="">검증 전체</option>${['일치','표기없음','확인 필요'].map(v => `<option ${v === state.validation ? 'selected' : ''}>${v}</option>`).join('')}</select><select id="sort-filter" class="filter-select" aria-label="정렬"><option value="rank">카테고리 · 순위순</option><option value="price">판매가 낮은 순</option><option value="revenue">추정매출 높은 순</option><option value="reviews">리뷰 많은 순</option></select><span class="result-count" id="result-count"></span></div></section><div id="market-results"></div><div class="chart-note">${icon('info')}단가 기준이 다른 제품은 직접 비교하지 마세요. 매출은 비교용 추정치이며 ‘만족했어요’ 문구는 구매자수에서 제외됩니다.</div>`;
}
function filteredProducts() {
  const query = state.query.toLowerCase().trim();
  const products = state.data.products.filter(p => (state.category === '전체' || p.category === state.category) && (!state.role || p.product_role === state.role) && (!state.basis || p.basis === state.basis) && (!state.validation || (state.validation === '확인 필요' ? !['일치','표기없음'].includes(p.validation) : p.validation === state.validation)) && `${p.brand || ''} ${p.product_name || ''}`.toLowerCase().includes(query));
  return products.sort((a,b) => state.sort === 'price' ? (a.price_krw ?? Infinity) - (b.price_krw ?? Infinity) : state.sort === 'revenue' ? (b.revenue ?? -1) - (a.revenue ?? -1) : state.sort === 'reviews' ? (b.review_count ?? -1) - (a.review_count ?? -1) : cats.indexOf(a.category) - cats.indexOf(b.category) || (a.rank ?? 999) - (b.rank ?? 999));
}
function renderProducts() {
  const products = filteredProducts();
  const pageCount = Math.max(1, Math.ceil(products.length / 12));
  state.pageNumber = Math.min(state.pageNumber, pageCount);
  const page = products.slice((state.pageNumber - 1) * 12, state.pageNumber * 12);
  $('#result-count').innerHTML = `총 <strong>${number(products.length)}</strong>개 제품`;
  $('#sort-filter').value = state.sort;
  $('#market-results').innerHTML = `<div class="table-panel"><div class="table-scroll"><table><thead><tr><th>순위</th><th>제품명 / 카테고리</th><th>판매가</th><th>단위당 가격</th><th>역할</th><th>리뷰수</th><th>추정 월매출</th><th>단가 검증</th><th></th></tr></thead><tbody>${page.length ? page.map(p => `<tr class="clickable" data-product="${esc(p.id)}" tabindex="0" aria-label="${esc(p.product_name)} 상세"><td><span class="rank">${number(p.rank)}</span></td><td class="product-name">${esc(p.product_name || p.brand || '이름 미확인')}<small>${esc(p.category)} · ${esc(p.capacity_text)} × ${esc(p.composition_text)}</small></td><td class="amount">${won(p.price_krw)}</td><td class="unit-cell amount">${won(p.unit_price)}<small>${esc(p.basis || '기준 미확인')}</small></td><td>${roleBadge(p.product_role)}</td><td>${number(p.review_count)}</td><td class="amount">${p.revenue == null ? '—' : revenue(p.revenue) + '원'}</td><td>${badge(p.validation)}</td><td>${icon('chevron-right')}</td></tr>`).join('') : '<tr><td colspan="9" class="empty-table">검색 조건에 맞는 제품이 없습니다. 검색어나 필터를 변경해 주세요.<br><br><button class="button small" data-action="reset-filters">필터 초기화</button></td></tr>'}</tbody></table></div><div class="table-foot"><span>${products.length ? (state.pageNumber - 1) * 12 + 1 : 0}–${Math.min(state.pageNumber * 12, products.length)} / ${products.length}개 제품</span><div class="pagination"><button class="page-button" data-pagination="${state.pageNumber - 1}" ${state.pageNumber === 1 ? 'disabled' : ''} aria-label="이전 페이지">${icon('chevron-left')}</button>${Array.from({length:pageCount},(_,i) => i+1).filter(p => p === 1 || p === pageCount || Math.abs(p - state.pageNumber) < 2).map((p,i,arr) => `${i && p - arr[i-1] > 1 ? '<span>…</span>' : ''}<button class="page-button ${p === state.pageNumber ? 'active' : ''}" data-pagination="${p}" aria-label="${p}페이지" ${p === state.pageNumber ? 'aria-current="page"' : ''}>${p}</button>`).join('')}<button class="page-button" data-pagination="${state.pageNumber + 1}" ${state.pageNumber === pageCount ? 'disabled' : ''} aria-label="다음 페이지">${icon('chevron-right')}</button></div></div></div>`;
}
function specsPage() {
  const specs = state.data.specs.filter(s => state.specCategory === '전체' || s.cat === state.specCategory);
  return `${pageHeading('신제품 기획', '실제 시장 가격대를 기준으로, 가성비 포지셔닝을 위한 목표 규격을 설계합니다.', false)}${sessionBanner()}<div class="category-filters-heading">${categoryTabs(state.specCategory, 'spec-category')}<a class="button small" href="/api/document" download>${icon('download')}견적요청서</a></div><div class="spec-grid">${specs.map(s => `<article class="spec-card"><div class="spec-card-top">${catIcon(s.cat)}<strong>${esc(s.cat)}</strong>${roleBadge(s.role)}</div><div class="spec-name">${esc(s.spec)}</div><div class="spec-form">${esc(s.form)} · ${esc(s.basis)} ${won(s.unit)}</div><div class="spec-prices"><div><small>목표 판매가</small><strong>${number(s.price)}<span>원</span></strong></div><div><small>목표 생산원가</small><strong>${number(s.cost)}<span>원</span></strong></div></div><div class="spec-benchmark"><span>${esc(s.benchBrand)} ${esc(s.basis)} 대비</span><span class="pill green">${number(s.benchDiff)}%</span></div><button class="button soft" data-spec="${state.data.specs.indexOf(s)}">선정 근거 · 원가 시뮬레이션 ${icon('arrow-right')}</button></article>`).join('')}</div><div class="insight-strip">${icon('info')}<div>단독 최저가 이상치를 제외한 실제 가격대에서 약 5% 낮게 설정한 기획안입니다. 자동 추천이 아닌 1차 조사 판단 결과입니다.</div></div>`;
}
function uspPage() {
  return `${pageHeading('USP 분석', '가격 너머의 이유, 경쟁 제품이 고객에게 전달하는 핵심 가치를 살펴보세요.', false)}<section class="panel"><div class="panel-heading"><h2>상세페이지 리서치</h2><span class="pill amber">데이터 수집 대기</span></div><div class="empty-state"><div class="empty-icon">${icon('sparkles')}</div><h2>좋은 제품에는, 선택받는 이유가 있습니다.</h2><p>상세페이지 USP 분석 도구는 준비되어 있습니다.<br>목표 제품의 캡처를 수집한 후, 핵심 소구점과 근거 문구를 분석해 보세요.<br>아직 수집된 데이터가 없어 분석 결과는 표시하지 않습니다.</p><button class="button primary" data-action="usp-guide">${icon('book')}상세페이지 수집 가이드</button> <a href="#market" class="button">분석할 제품 찾기 ${icon('arrow-right')}</a></div></section><div class="steps-grid">${[['01','목표 제품 선정','전체 150개가 아닌, 가격 분석에서 선정한 목표 제품을 우선 조사하세요.'],['02','상세페이지 캡처','상세페이지를 맨 아래까지 스크롤한 후 인쇄 → PDF로 저장하세요.'],['03','USP 추출 · 검증','성분, 인증, 기능 등 소구점과 원문 근거를 추출하고 기존 Python 도구로 검증하세요.']].map(([n,t,p]) => `<article class="step-card"><span class="step-number">STEP ${n}</span><h3>${t}</h3><p>${p}</p></article>`).join('')}</div>`;
}
function documentsPage() {
  return `${pageHeading('산출물 관리', '리서치 결과를 팀과 공유하고, 생산 협의를 위한 다음 단계로 연결하세요.', false)}${sessionBanner()}<div class="resource-grid">${[
    ['file','신제품 생산 견적요청서','6개 카테고리의 본품·리필 12종 목표 규격과 선정 근거를 담은 공장 전달용 문서입니다.','DOCX','12개 목표 규격','/api/document','견적요청서 다운로드'],
    ['grid','시장 조사 데이터','현재 워크스페이스의 제품, 가격, 단가 검증, 추정 매출을 엑셀로 내보냅니다.','XLSX',`${state.data.products.length}개 제품`,'export','엑셀 다운로드'],
    ['database','신제품 목표 규격 원본','목표 판매가, 생산원가, 벤치마크와 경쟁사 근거 데이터가 담긴 구조화된 원본입니다.','JSON','12개 목표 규격','/api/specs.json','원본 데이터 다운로드'],
  ].map(([i,t,p,type,meta,url,label]) => `<article class="resource-card"><div class="file-icon">${icon(i)}</div><h2>${t}</h2><p>${p}</p><div class="resource-meta"><span class="pill green">${type}</span><span class="pill">${meta}</span></div>${url === 'export' ? `<button class="button" data-action="export">${icon('download')}${label}</button>` : `<a class="button" href="${url}" download>${icon('download')}${label}</a>`}</article>`).join('')}</div><div class="notice-box">${icon('info')}견적요청서와 목표 규격 JSON은 저장소의 <strong>2026년 9월 1차 조사 원본</strong>입니다. 업로드 데이터나 시뮬레이션은 이 문서에 반영되지 않습니다. 목표 원가에는 3.5배수에 반영된 수수료·배송비를 중복 차감하지 않습니다.</div>`;
}
function dataPage() {
  return `${pageHeading('데이터 관리', '조사 원본을 확인하고, 새로운 추출 데이터를 검증해 워크스페이스에 불러오세요.')}${sessionBanner()}<div class="upload-callout">${icon('upload')}<div><h2>새로운 리서치 데이터를 준비하셨나요?</h2><p>ProductInfo 형식의 추출 JSON을 불러오면 단가 계산과 검증이 자동으로 진행됩니다.<br>이미지 자동 인식은 지원하지 않으며, 이 탭에서만 적용됩니다.</p></div><button class="button primary" data-action="upload">JSON 불러오기 ${icon('arrow-right')}</button></div><div class="section-heading"><h2>카테고리별 데이터 <small>${state.data.products.length}건</small></h2><a class="text-button" href="/api/template.json" download>JSON 예시 다운로드 ${icon('download')}</a></div><div class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>카테고리</th><th>제품 수</th><th>단가 일치</th><th>표기없음 / 확인 필요</th><th>데이터 출처</th><th></th></tr></thead><tbody>${state.data.summary.categories.map(c => {
    const products = state.data.products.filter(p => p.category === c.name);
    const matched = products.filter(p => p.validation === '일치').length;
    const missing = products.filter(p => p.validation === '표기없음').length;
    return `<tr><td><div class="category-cell">${catIcon(c.name)}${c.name}</div></td><td>${c.count}개</td><td>${icon('check')} ${matched}건</td><td>${missing}건 / ${c.count - matched - missing}건</td><td><span class="pill ${state.overrides[c.name] ? 'amber' : 'green'}">${state.overrides[c.name] ? '탭 임시 데이터' : '저장소 원본'}</span></td><td><button class="text-button" data-category-go="${c.name}">제품 보기 ${icon('arrow-right')}</button></td></tr>`;
  }).join('')}</tbody></table></div></div><div class="insight-strip">${icon('shield')}<div><strong>원본은 안전하게 보존됩니다.</strong>불러오기는 해당 카테고리의 탭 내 데이터를 교체하며, Git 저장소나 서버의 원본 파일을 수정하지 않습니다.</div></div>`;
}
function navigate(page, options = {}) {
  if (!(page in pages)) page = 'overview';
  if (options.category) { state.category = options.category; state.query = ''; state.role = ''; state.validation = ''; state.basis = ''; state.pageNumber = 1; }
  if (location.hash !== `#${page}`) location.hash = page;
  else render();
  $('#sidebar').classList.remove('open');
  $('#sidebar-backdrop').classList.remove('open');
}
function render() {
  if (!state.data) return;
  const nextPage = location.hash.slice(1);
  state.page = nextPage in pages ? nextPage : 'overview';
  document.title = `${pages[state.page]} — Product Lab`;
  $('#breadcrumb-page').textContent = pages[state.page];
  document.querySelectorAll('[data-page]').forEach(a => { a.classList.toggle('active', a.dataset.page === state.page); if (a.dataset.page === state.page) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
  $('[data-page="market"] .nav-count').textContent = state.data.products.length;
  main.innerHTML = {overview, market, specs: specsPage, usp: uspPage, documents: documentsPage, data: dataPage}[state.page]();
  if (state.page === 'market') renderProducts();
}
function showDialog(title, subtitle, body, footer = '') {
  $('#dialog-content').innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-action="close" aria-label="닫기">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function safeURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function productDetail(id) {
  const p = state.data.products.find(p => p.id === id);
  if (!p) return;
  const actualURL = safeURL(p.product_url);
  const searchURL = safeURL(p.search_url);
  showDialog('경쟁 제품 상세', `${esc(p.category)} · 카테고리 ${number(p.rank)}위 · ${esc(p.row['조사일자'])}`, `<div class="flex-actions">${roleBadge(p.product_role)}<span class="pill">${esc(p.product_form)}</span>${badge(p.validation)}</div><h3 class="detail-title">${esc(p.product_name || '제품명 미확인')}</h3><div class="detail-grid">${[['판매가',won(p.price_krw)],['단위당 가격',`${won(p.unit_price)} / ${esc(p.basis || '미확인')}`],['용량 · 구성',`${esc(p.capacity_text)} × ${esc(p.composition_text)}`],['리뷰 수',number(p.review_count)],['월 구매자수 (하한)',p.buyers == null ? '확인 불가' : `${number(p.buyers)}명 이상`],['추정 월매출',p.revenue == null ? '계산 제외' : `${revenue(p.revenue)}원`]].map(([k,v]) => `<div><small>${k}</small><strong>${v}</strong></div>`).join('')}</div><div class="detail-section"><h3>검증 근거</h3><p>쿠팡 표기: ${esc(p.unit_price_text || '표기 없음')}<br>구매자수 원문: ${esc(p.monthly_buyers_text || '확인 불가')}<br>형태 판단: ${esc(p.form_reason || '별도 근거 없음')}</p></div>${p.notes ? `<div class="detail-section"><h3>수집 메모</h3><p>${esc(p.notes)}</p></div>` : ''}<div class="form-hint">월매출은 월구매자수 × 판매가 × 2로 계산한 비교용 추정치입니다. 실제 상품 URL을 모르는 경우 제품명 검색 링크를 제공합니다.</div>`, `<button class="button" data-action="close">닫기</button>${actualURL || searchURL ? `<a class="button primary" href="${esc(actualURL || searchURL)}" target="_blank" rel="noopener noreferrer">${actualURL ? '상품 페이지' : '쿠팡에서 제품명 검색'} ${icon('external')}</a>` : ''}`);
}
function specDetail(index) {
  const s = state.data.specs[index];
  if (!s) return;
  showDialog(`${esc(s.cat)} · ${esc(s.role)} 기획안`, `${esc(s.spec)} · ${esc(s.form)} · 1차 조사 원본`, `<div class="detail-grid"><div><small>원본 목표 판매가</small><strong>${won(s.price)}</strong></div><div><small>원본 목표 생산원가 (묶음)</small><strong>${won(s.cost)}</strong></div><div><small>기준 제품</small><strong>${esc(s.benchBrand)} · ${esc(s.basis)} ${won(s.benchUnit)}</strong></div><div><small>기준 단가 대비</small><strong>${number(s.benchDiff)}%</strong></div></div><div class="detail-section"><h3>이 규격을 선택한 이유</h3><p>${esc(s.why)}</p></div><div class="detail-section"><h3>경쟁 제품 근거 · ${esc(s.basis)}</h3><div class="table-scroll"><table><thead><tr><th>브랜드</th><th>규격</th><th>판매가</th><th>단가</th></tr></thead><tbody>${s.evidence.map(e => `<tr><td>${esc(e['브랜드'])}</td><td>${esc(e['규격'])}</td><td>${won(e['판매가'])}</td><td>${won(e['단가'])}</td></tr>`).join('')}</tbody></table></div></div><div class="detail-section"><h3>원가 시뮬레이션</h3><form id="simulation-form" data-index="${index}" class="simulation-form"><label><span class="field-label">목표 판매가 (원)</span><input id="simulation-price" class="form-field" type="number" min="100" max="10000000" step="1" required value="${s.price}"></label><button class="button primary" type="submit">원가 계산</button></form><div id="simulation-output" aria-live="polite"></div><p class="form-hint">판매가 ÷ 3.5로 계산합니다. 기존 규격·수량은 유지되며, 결과는 저장소와 견적요청서에 반영되지 않습니다.</p></div>`, '<button class="button" data-action="close">닫기</button><a class="button primary" href="/api/document" download>원본 견적요청서 다운로드</a>');
}
function guide(usp = false) {
  const entries = usp ? [
    ['목표 제품만 선택하세요','시장 분석에서 같은 단가기준의 경쟁 제품을 확인하세요. 전수조사가 아니라 목표 제품 위주로 조사하는 것이 효율적입니다.'],
    ['상세페이지를 끝까지 스크롤하세요','지연 로딩 이미지가 모두 표시되면 Ctrl+P → PDF로 저장합니다. 1~2쪽짜리 PDF라면 이미지 누락을 확인하세요.'],
    ['USP JSON을 추출하고 기존 도구로 검증하세요','AI 또는 사람이 성분·기능·인증과 원문 근거를 DetailPageInfo 형식으로 추출합니다. 웹앱은 자동 OCR이나 USP 업로드를 아직 지원하지 않습니다.'],
  ] : [
    ['시장 분석에서 근거를 확인하세요','제품명·브랜드 검색, 카테고리·역할·단가 기준·검증 상태 필터를 사용할 수 있습니다. 행을 누르면 원문과 계산 근거를 확인할 수 있습니다.'],
    ['신제품 기획에서 원가를 검토하세요','12개 목표 규격의 선정 이유와 경쟁사 단가를 비교하고, 목표 판매가에 따른 생산원가를 시뮬레이션하세요.'],
    ['추출 JSON을 불러오세요','데이터 불러오기에서 카테고리를 선택하고 ProductInfo 배열 JSON을 검증하세요. 적용은 현재 탭에서만 유지됩니다. 엑셀로 결과를 보관하세요.'],
    ['산출물을 다운로드하세요','현재 제품 데이터는 XLSX로, 원본 기획안은 DOCX·JSON으로 받을 수 있습니다. 원본 기획안은 업로드와 별개입니다.'],
  ];
  showDialog(usp ? '상세페이지 수집 가이드' : 'Product Lab 이용 가이드', '이미지를 읽는 일과 숫자를 계산하는 일을 분리합니다.', `<div class="guide-list">${entries.map(([title,desc],i) => `<div><span>0${i+1}</span><section><h3>${title}</h3><p>${desc}</p></section></div>`).join('')}</div>${usp ? '<div class="detail-section"><h3>기존 도구 실행 예시</h3><code class="mono">python thumbnail_analyzer/analyze_details.py build<br>--input usp.json --category 세탁세제<br>--output 결과/세탁세제_USP.xlsx</code></div>' : ''}`, `<button class="button primary" data-action="close">확인했습니다 ${icon('check')}</button>`);
}
function openUpload() {
  state.pendingImport = null;
  showDialog('리서치 데이터 불러오기', '추출 JSON을 검증하고 선택한 카테고리의 데이터를 교체합니다.', `<label class="field-label" for="upload-category">카테고리</label><select id="upload-category" class="form-field">${cats.map(c => `<option>${c}</option>`).join('')}</select><label class="dropzone" id="dropzone">${icon('upload')}<strong>추출 JSON 파일을 선택하거나 여기에 놓으세요</strong><small>JSON 배열 · 최대 3MB · 카테고리당 1,000개 제품</small><input id="upload-file" type="file" accept=".json,application/json" aria-label="추출 JSON 파일 선택"></label><div id="upload-result" aria-live="polite"></div><p class="form-hint">이미지/PDF의 자동 인식은 지원하지 않습니다. 검증된 데이터는 현재 탭에서만 사용되며, 새로고침하면 저장소 원본으로 돌아갑니다.</p><a class="text-button" href="/api/template.json" download>${icon('download')}ProductInfo JSON 예시 다운로드</a>`, '<button class="button" data-action="close">취소</button><button class="button primary" id="apply-import" data-action="apply-import" disabled>검증 후 적용</button>');
  const zone = $('#dropzone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); validateUpload(e.dataTransfer.files[0]); });
}
let uploadSequence = 0;
async function validateUpload(file) {
  const sequence = ++uploadSequence;
  state.pendingImport = null;
  $('#apply-import').disabled = true;
  if (!file) return;
  $('#upload-result').innerHTML = '<p class="form-hint">파일의 스키마와 단가를 검증하고 있습니다…</p>';
  try {
    if (!file.name.toLowerCase().endsWith('.json')) throw new Error('JSON 파일만 불러올 수 있습니다. 이미지/PDF는 먼저 추출 JSON으로 변환해 주세요.');
    if (file.size > 3 * 1024 * 1024) throw new Error('3MB 이하의 JSON 파일을 선택하세요.');
    const text = await file.text();
    let entries;
    try { entries = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('JSON 문법이 올바르지 않습니다. 쉼표, 따옴표, 배열 형식을 확인하세요.'); }
    const category = $('#upload-category').value;
    const overrides = {...state.overrides, [category]: entries};
    const result = await (await api('/api/import', {overrides})).json();
    if (sequence !== uploadSequence || !dialog.open || !$('#upload-result')) return;
    state.pendingImport = {result, overrides};
    const products = result.products.filter(p => p.category === category);
    const match = products.filter(p => p.validation === '일치').length;
    $('#upload-result').innerHTML = `<div class="form-success">${icon('check')} ${esc(file.name)} · ${products.length}개 제품 검증 완료<br>단가 일치 ${match}건 · 표기없음 ${products.filter(p => p.validation === '표기없음').length}건 · 확인 필요 ${products.filter(p => !['일치','표기없음'].includes(p.validation)).length}건<br>${esc(category)}의 현재 데이터를 교체합니다. 원본 파일은 변경하지 않습니다.</div>`;
    $('#apply-import').disabled = false;
    $('#apply-import').textContent = '워크스페이스에 적용';
  } catch (error) {
    if (sequence === uploadSequence && $('#upload-result')) $('#upload-result').innerHTML = `<div class="form-error">${esc(error.message)}</div>`;
  }
}
async function exportExcel(button) {
  button.disabled = true;
  try {
    const response = await api('/api/export.xlsx', {overrides: state.overrides});
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = '쿠팡_생활용품_시장조사.xlsx'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`${state.data.products.length}개 제품의 엑셀 파일을 다운로드했습니다.`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
function notifications() {
  const s = state.data.summary;
  showDialog('리서치 알림', '현재 데이터에서 확인해야 할 항목입니다.', `<div class="guide-list"><div><span>${icon('clock')}</span><section><h3>USP 상세페이지 수집 대기</h3><p>분석 도구는 준비되어 있지만 상세페이지 원본과 추출 데이터는 아직 없습니다.</p></section></div><div><span>${icon('shield')}</span><section><h3>단가 표기 없음 · ${s.validation['표기없음'] || 0}건</h3><p>가격 표기가 없거나 캡처에 가려져 검산할 수 없는 항목입니다. 오류로 분류하지 않습니다.</p></section></div><div><span>${icon('file')}</span><section><h3>원본 견적요청서 준비 완료</h3><p>6개 카테고리 12개 목표 규격의 공장 전달용 DOCX를 다운로드할 수 있습니다.</p></section></div></div>`, '<button class="button" data-action="show-unverified">표기없는 제품 확인</button><button class="button primary" data-action="close">확인</button>');
}
function resetFilters() { state.category = '전체'; state.query = ''; state.role = ''; state.basis = ''; state.validation = ''; state.sort = 'rank'; state.pageNumber = 1; }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action], [data-product], [data-spec], [data-category], [data-category-go], [data-spec-category], [data-pagination]');
  if (!el || el.disabled) return;
  if (el.dataset.product) return productDetail(el.dataset.product);
  if (el.dataset.spec !== undefined) return specDetail(Number(el.dataset.spec));
  if (el.dataset.categoryGo) return navigate('market', {category: el.dataset.categoryGo});
  if (el.dataset.category) { state.category = el.dataset.category; state.pageNumber = 1; render(); return; }
  if (el.dataset.specCategory) { state.specCategory = el.dataset.specCategory; render(); return; }
  if (el.dataset.pagination) { state.pageNumber = Number(el.dataset.pagination); renderProducts(); return; }
  switch (el.dataset.action) {
    case 'close': dialog.close(); break;
    case 'upload': openUpload(); break;
    case 'export': exportExcel(el); break;
    case 'guide': guide(); break;
    case 'usp-guide': guide(true); break;
    case 'notifications': notifications(); break;
    case 'workspace': showDialog('생활용품 리서치 워크스페이스', 'Product Lab · 쿠팡 1차 시장 조사', '<div class="notice-box">이 대시보드는 저장소에 커밋된 실제 제품 데이터를 사용합니다.<br>조사일: 2026.09.21 · 6개 카테고리 · 최초 150개 제품<br>개인 계정, 로그인 및 공동 편집 기능은 연결되어 있지 않습니다.</div>', '<button class="button primary" data-action="close">확인</button>'); break;
    case 'search': navigate('market'); setTimeout(() => $('#product-search')?.focus(), 50); break;
    case 'menu': $('#sidebar').classList.toggle('open'); $('#sidebar-backdrop').classList.toggle('open'); break;
    case 'apply-import': if (state.pendingImport) { state.data = state.pendingImport.result; state.overrides = state.pendingImport.overrides; state.pendingImport = null; state.pageNumber = 1; dialog.close(); render(); toast('검증된 데이터를 현재 탭에 적용했습니다.'); } break;
    case 'reset-data': state.data = state.original; state.overrides = {}; resetFilters(); render(); toast('저장소 원본 데이터로 복원했습니다.'); break;
    case 'show-unverified': dialog.close(); resetFilters(); state.validation = '표기없음'; navigate('market'); break;
    case 'reset-filters': resetFilters(); render(); break;
    case 'retry': load(); break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'product-search') { state.query = e.target.value; state.pageNumber = 1; renderProducts(); }
});
document.addEventListener('change', e => {
  const filters = {'role-filter':'role', 'basis-filter':'basis', 'validation-filter':'validation', 'sort-filter':'sort'};
  if (filters[e.target.id]) { state[filters[e.target.id]] = e.target.value; state.pageNumber = 1; renderProducts(); }
  if (e.target.id === 'role-category') { const category = state.data.summary.categories.find(c => c.name === e.target.value); $('#role-chart').innerHTML = roleChart(category ? category.roles : state.data.summary.roles); }
  if (e.target.id === 'upload-file') validateUpload(e.target.files[0]);
  if (e.target.id === 'upload-category') { uploadSequence++; state.pendingImport = null; $('#apply-import').disabled = true; $('#upload-result').innerHTML = ''; if ($('#upload-file').files[0]) validateUpload($('#upload-file').files[0]); }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'simulation-form') return;
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const result = await (await api('/api/simulate', {index: Number(e.target.dataset.index), price: Number($('#simulation-price').value)})).json();
    if ($('#simulation-output')) $('#simulation-output').innerHTML = `<div class="simulation-result"><div><small>묶음 목표 생산원가</small><strong>${won(result.cost)}</strong></div><div><small>낱개 환산 원가</small><strong>${won(result.costEach)}</strong></div><div><small>기준 제품 단가 대비</small><strong>${result.benchDiff > 0 ? '+' : ''}${number(result.benchDiff)}%</strong></div></div>`;
  } catch (error) { if ($('#simulation-output')) $('#simulation-output').innerHTML = `<div class="form-error">${esc(error.message)}</div>`; }
  finally { button.disabled = false; }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dialog.open) dialog.close(); navigate('market'); setTimeout(() => $('#product-search')?.focus(), 50); }
  if (e.key === 'Enter' && e.target.matches('tr.clickable')) e.target.click();
  if (e.key === 'Escape') { $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').classList.remove('open'); }
});
dialog.addEventListener('close', () => { uploadSequence++; state.pendingImport = null; });
dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
$('#sidebar-backdrop').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').classList.remove('open'); });
window.addEventListener('hashchange', () => { render(); window.scrollTo(0,0); $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').classList.remove('open'); });
async function load() {
  try { state.data = await (await api('/api/dashboard')).json(); state.original = state.data; render(); }
  catch (error) { main.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('database')}</div><h2>데이터를 불러오지 못했습니다</h2><p>${esc(error.message)}</p><button class="button primary" data-action="retry">다시 시도</button></div>`; }
}
hydrateIcons();
load();
