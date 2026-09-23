/* Folder selection, sequential uploads, durable analysis progress and result review. */
let folderFiles = [];
let folderConfig = null;
let currentJob = null;
let jobTimer = null;
let uploadingFolder = false;
let folderGeneration = 0;

function latestJobId(value) {
  try {
    if (value !== undefined) localStorage.setItem('product-lab-last-job', value);
    return localStorage.getItem('product-lab-last-job');
  } catch { return currentJob?.id; }
}
function categoryFields(prefix) {
  return `<label class="field-label" for="${prefix}-category">카테고리</label><select id="${prefix}-category" class="form-field"><option value="__new">+ 새 카테고리 만들기</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select><div id="${prefix}-new-wrap"><label class="field-label" for="${prefix}-new-category">새 카테고리 이름</label><input id="${prefix}-new-category" class="form-field" maxlength="40" placeholder="예: 욕실세정제, 샴푸, 핸드워시" autocomplete="off"></div>`;
}
function selectedCategory(prefix) {
  const choice = $(`#${prefix}-category`).value;
  const value = choice === '__new' ? $(`#${prefix}-new-category`).value.trim().normalize('NFC') : choice;
  if (!value || value.length > 40 || /[<>/\\.\x00-\x1f]/.test(value) || ['전체','__proto__','constructor','prototype'].includes(value)) throw new Error('새 카테고리 이름을 1~40자의 한글·영문·숫자·공백으로 입력하세요.');
  return value;
}
function openFolderUpload() {
  clearTimeout(jobTimer);
  const generation = ++folderGeneration;
  folderFiles = [];
  currentJob = null;
  folderConfig = null;
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  showDialog('이미지 폴더로 새 리서치 시작', '카테고리만 정하고 캡처 폴더를 선택하세요. AI 추출 후 가격·단가를 검증합니다.', `
    <div class="import-tabs"><span class="pill green">이미지 폴더 분석</span><button class="text-button" data-action="json-upload">이미 추출한 JSON 불러오기 ${icon('arrow-right')}</button></div>
    <div class="upload-form-grid"><div>${categoryFields('folder')}</div><div><label class="field-label" for="folder-date">조사일</label><input type="date" id="folder-date" class="form-field" value="${localDate}" required><label class="field-label" for="folder-mode">결과 저장 방식</label><select id="folder-mode" class="form-field"><option value="append">기존 데이터에 추가</option><option value="replace">해당 카테고리 전체 교체</option></select></div></div>
    <div class="folder-picker">${icon('upload')}<strong>이미지를 담은 폴더를 통째로 선택하세요</strong><p>하위 폴더 포함 · JPG, PNG, WEBP, HEIC/HEIF<br>최대 100장 · 파일당 15MB · 전체 250MB</p><div class="flex-actions"><label class="button primary file-picker">${icon('layers')}폴더 선택<input id="folder-input" type="file" webkitdirectory multiple aria-label="이미지 폴더 선택"></label><label class="button file-picker">이미지 여러 장 선택<input id="images-input" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.heic,.heif" aria-label="이미지 여러 장 선택"></label></div></div>
    <div id="folder-selection" aria-live="polite"></div>
    <div class="notice-box">가격·용량·구매자수가 보이는 <strong>상품 카드/썸네일 캡처</strong> 기준입니다. 상세페이지를 여러 장으로 나눈 자료의 USP 병합 분석은 별도입니다. 같은 제품의 중복 캡처는 제거해 주세요.</div>
    <p id="vision-status" class="form-hint">AI 연결 설정 확인 중…</p><label class="analysis-consent"><input id="analysis-consent" type="checkbox">선택한 이미지를 AI 서비스에 전송하며 사용료가 발생할 수 있음에 동의합니다.</label><p class="form-hint">분석 완료 후 검토·저장해야 대시보드에 반영됩니다. 원본 폴더와 Git 데이터는 변경하지 않습니다. 저장 결과는 이 서버의 디스크에 보관됩니다.</p>
    ${latestJobId() ? '<button class="text-button" data-action="resume-analysis">최근 분석 작업 이어보기</button>' : ''}<div id="folder-error" role="alert"></div>`,
    '<button class="button" data-action="close">닫기</button><button class="button primary" id="start-folder" data-action="analyze-folder" disabled>선택한 이미지 분석 시작</button>');
  api('/api/analysis/config').then(r => r.json()).then(config => {
    if (generation !== folderGeneration || !$('#vision-status')) return;
    folderConfig = config;
    $('#vision-status').textContent = `${config.message} · ${config.model}${!config.heic ? ' · 이 서버는 HEIC 미지원' : ''}`;
    if (!config.configured) $('#vision-status').className = 'form-error';
    updateFolderButton();
  }).catch(error => { if ($('#vision-status')) $('#vision-status').textContent = error.message; });
}
function updateFolderButton() {
  const button = $('#start-folder');
  if (button) button.disabled = !folderFiles.length || !folderConfig?.configured || !$('#analysis-consent')?.checked || uploadingFolder;
}
function selectFolderFiles(files) {
  const all = Array.from(files).sort((a,b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'ko', {numeric:true}));
  const supported = all.filter(f => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  const skipped = all.filter(f => !supported.includes(f));
  const total = supported.reduce((sum,f) => sum + f.size, 0);
  folderFiles = supported;
  let error = '';
  if (!supported.length) error = '지원하는 이미지가 없습니다. JPG, PNG, WEBP, HEIC/HEIF 파일을 확인하세요.';
  else if (supported.length > 100) error = '한 번에 100장까지 분석할 수 있습니다. 폴더를 나눠 선택하세요.';
  else if (supported.some(f => f.size === 0 || f.size > 15 * 1024 * 1024)) error = '빈 파일 또는 15MB를 초과하는 이미지가 있습니다. 해당 파일을 확인하세요.';
  else if (total > 250 * 1024 * 1024) error = '폴더 전체 크기가 250MB를 초과합니다.';
  else if (folderConfig && !folderConfig.heic && supported.some(f => /\.hei[cf]$/i.test(f.name))) error = '서버에 HEIC 지원이 없습니다. JPG로 변환하거나 pillow-heif를 설치하세요.';
  const folderName = all[0]?.webkitRelativePath?.split('/')[0];
  if (folderName && $('#folder-category').value === '__new' && !$('#folder-new-category').value) $('#folder-new-category').value = folderName.slice(0,40);
  $('#folder-selection').innerHTML = `<div class="selection-summary"><strong>${esc(folderName || '선택한 이미지')} · ${supported.length}장</strong><span>${(total/1024/1024).toFixed(1)} MB</span></div>${skipped.length ? `<div class="form-hint">제외된 비이미지 파일 ${skipped.length}개: ${skipped.slice(0,8).map(f=>esc(f.name)).join(', ')}${skipped.length>8?' 외':''}</div>` : ''}<ul class="selected-files">${supported.map(f => `<li>${icon('file')}<span>${esc(f.webkitRelativePath || f.name)}</span><small>${(f.size/1024).toFixed(0)} KB</small></li>`).join('')}</ul>`;
  $('#folder-error').innerHTML = error ? `<p class="form-error">${esc(error)}</p>` : '';
  if (error) folderFiles = [];
  updateFolderButton();
}
async function analyzeFolder() {
  if (uploadingFolder || !folderFiles.length) return;
  let category;
  try {
    category = selectedCategory('folder');
    if (!$('#folder-date').value) throw new Error('조사일을 입력하세요.');
    if (!$('#analysis-consent').checked) throw new Error('AI 전송 및 사용료 발생에 동의해 주세요.');
    const mode = $('#folder-mode').value;
    if (mode === 'replace' && cats.includes(category) && !confirm(`${category}의 기존 전체 제품 목록을 교체합니다. 계속할까요?`)) return;
    const payload = {category, survey_date:$('#folder-date').value, mode, files:folderFiles.map(f=>({name:f.webkitRelativePath || f.name,size:f.size}))};
    uploadingFolder = true;
    updateFolderButton();
    currentJob = await (await api('/api/analysis', payload)).json();
    latestJobId(currentJob.id);
    const files = [...folderFiles];
    showJob(currentJob);
    for (let i=0;i<files.length;i++) {
      const response = await fetch(`/api/analysis/${currentJob.id}/files/${i}`, {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:files[i]});
      const result = await response.json();
      if (!response.ok) throw new Error(`${files[i].name}: ${result.error || '업로드 실패'}`);
      currentJob = result;
      if ($('#analysis-progress')) drawJob(currentJob);
    }
    currentJob = await (await api(`/api/analysis/${currentJob.id}/start`, {consent:true})).json();
    if ($('#analysis-progress')) { drawJob(currentJob); pollJob(currentJob.id); }
    toast('서버에서 이미지 분석을 시작했습니다. 창을 닫아도 작업은 계속됩니다.');
  } catch(error) {
    const target = $('#folder-error') || $('#job-error');
    if(target) target.innerHTML = `<div class="form-error">${esc(error.message)}${currentJob ? '<br>업로드 오류는 이미지를 확인한 뒤 새 작업으로 다시 선택하세요. 업로드 완료 후 시작 오류는 아래 재시도 버튼을 사용하세요.' : ''}</div>`;
    else toast(error.message);
    if(currentJob && $('#analysis-progress')) { currentJob = await (await api(`/api/analysis/${currentJob.id}`)).json().catch(()=>currentJob); drawJob(currentJob); }
  } finally { uploadingFolder = false; updateFolderButton(); }
}
const jobLabels = {uploading:'이미지 업로드 중',upload_error:'이미지 확인 필요',ready:'업로드 완료 · 분석 대기',running:'AI 분석 중',partial:'일부 이미지 분석 실패',interrupted:'서버 재시작으로 중단됨',review:'분석 완료 · 결과 검토',applied:'결과 저장 완료'};
const fileLabels = {pending:'업로드 대기',uploaded:'분석 대기',upload_error:'업로드 실패',analyzing:'분석 중',done:'완료',error:'분석 실패'};
function showJob(job) {
  clearTimeout(jobTimer);
  currentJob = job;
  showDialog(`${esc(job.category)} · 이미지 분석`, `${job.files.length}장 · 조사일 ${esc(job.survey_date)} · ${job.mode === 'append' ? '기존 데이터에 추가' : '카테고리 전체 교체'}`, '<div id="analysis-progress" aria-live="polite"></div><div id="job-files"></div><div id="job-review"></div><div id="job-error" role="alert"></div>', '<button class="button" data-action="close">닫고 나중에 확인</button><div id="job-actions" class="flex-actions"></div>');
  drawJob(job);
  if(job.status === 'running') pollJob(job.id);
}
function drawJob(job) {
  if(!$('#analysis-progress')) return;
  const done = job.files.filter(f=>f.status==='done').length;
  const failed = job.files.filter(f=>['error','upload_error'].includes(f.status)).length;
  const uploaded = job.files.filter(f=>f.status!=='pending' && f.status!=='upload_error').length;
  const uploading = ['uploading','upload_error','ready'].includes(job.status);
  const progress = (uploading ? uploaded : done + failed) / job.files.length * 100;
  $('#analysis-progress').innerHTML = `<div class="selection-summary"><strong>${jobLabels[job.status] || esc(job.status)}</strong><span>${uploading ? `업로드 ${uploaded}` : `완료 ${done} · 실패 ${failed}`} / ${job.files.length}장</span></div><progress class="analysis-meter" max="100" value="${progress}" aria-label="분석 진행률"></progress><p class="form-hint">${job.status === 'running' ? '이미지별로 순차 분석합니다. 새로고침 후에도 ‘최근 분석 이어보기’에서 확인할 수 있습니다.' : job.status === 'partial' ? '성공한 파일은 보존됩니다. 실패 파일만 재분석하며, 실패를 해결하기 전에는 대시보드에 반영하지 않습니다.' : job.status === 'applied' ? '이 서버에 저장했습니다. 새로고침해도 유지됩니다. 원본 이미지는 서버에서 삭제되었습니다.' : 'AI 결과는 오류가 있을 수 있습니다. 상품명·가격·규격을 검토한 뒤 저장하세요.'}</p>`;
  $('#job-files').innerHTML = `<ul class="selected-files job-file-list">${job.files.map(f=>`<li>${icon(f.status==='done'?'check':f.status==='analyzing'?'clock':'file')}<div><span>${esc(f.name)}</span>${f.error ? `<small class="file-error">${esc(f.error)}</small>` : ''}</div><span class="pill ${f.status==='done'?'green':['error','upload_error'].includes(f.status)?'red':''}">${fileLabels[f.status]}</span></li>`).join('')}</ul>`;
  const rows = job.files.flatMap(f=>f.entries.map(e=>({...e,filename:f.name})));
  $('#job-review').innerHTML = rows.length ? `<div class="detail-section"><h3>추출된 제품 ${rows.length}개 · 저장 전 검토</h3><div class="analysis-review table-scroll"><table><thead><tr><th>원본 / 상품명</th><th>판매가</th><th>용량 · 구성</th><th>화면 표기 단가</th></tr></thead><tbody>${rows.map(p=>`<tr><td class="product-name">${esc(p.product_name || p.brand)}<small>${esc(p.filename)}</small></td><td>${won(p.price_krw)}</td><td>${esc(p.capacity_text || '미확인')} × ${esc(p.composition_text || '미확인')}</td><td>${esc(p.unit_price_text || '표기없음')}</td></tr>`).join('')}</tbody></table></div><p class="form-hint">수정이 필요하면 추출 JSON을 내려받아 수정한 뒤 JSON 불러오기를 사용하세요. 가격·구매자수가 보이지 않으면 추정하지 않고 비워 둡니다. 신규 목표 규격/견적서는 자동 생성하지 않습니다.</p></div>` : '';
  $('#job-actions').innerHTML = `${rows.length ? `<a class="button small" href="/api/analysis/${job.id}/results.json" download>추출 JSON</a>` : ''}${['ready','partial','interrupted'].includes(job.status) ? '<button class="button primary" data-action="retry-analysis">'+(job.status==='ready'?'분석 시작':'실패 파일 재분석')+'</button>' : ''}${job.status==='review' ? '<button class="button primary" data-action="apply-analysis">검토 완료 · 결과 저장</button>' : ''}${job.status==='applied' ? '<button class="button primary" data-action="view-analysis">시장 분석에서 보기</button>' : ''}${job.status==='upload_error' || job.status==='uploading' && !uploadingFolder ? '<button class="button" data-action="new-folder">폴더 다시 선택</button>' : ''}`;
}
async function pollJob(id) {
  clearTimeout(jobTimer);
  try {
    const job = await (await api(`/api/analysis/${id}`)).json();
    if(!dialog.open || !$('#analysis-progress') || currentJob?.id!==id) return;
    currentJob = job;
    drawJob(job);
    if(job.status==='running') jobTimer=setTimeout(()=>pollJob(id),2000);
  } catch(error) { if($('#job-error')) $('#job-error').innerHTML=`<div class="form-error">${esc(error.message)}<button class="text-button" data-action="resume-analysis">상태 다시 확인</button></div>`; }
}
async function resumeAnalysis() {
  try {
    const id=latestJobId();
    if(!id) throw new Error('최근 분석 작업이 없습니다. 이미지 폴더를 선택해 주세요.');
    showJob(await (await api(`/api/analysis/${id}`)).json());
  } catch(error) { toast(error.message); }
}
async function retryAnalysis(button) {
  if(!currentJob || !confirm('미완료 파일만 AI에 전송해 분석합니다. 사용료가 발생할 수 있습니다. 계속할까요?')) return;
  button.disabled=true;
  try { currentJob=await (await api(`/api/analysis/${currentJob.id}/start`,{consent:true})).json(); drawJob(currentJob); pollJob(currentJob.id); }
  catch(error) { $('#job-error').innerHTML=`<div class="form-error">${esc(error.message)}</div>`; button.disabled=false; }
}
async function applyAnalysis(button) {
  button.disabled=true;
  try {
    state.data=await (await api(`/api/analysis/${currentJob.id}/apply`,{})).json();
    state.original=state.data; state.overrides={}; resetFilters();
    currentJob.status='applied'; drawJob(currentJob); render(); toast('분석 결과를 저장했습니다. 새로고침해도 유지됩니다.');
  } catch(error) { $('#job-error').innerHTML=`<div class="form-error">${esc(error.message)}</div>`;button.disabled=false; }
}
async function saveJsonImport(button) {
  if(!state.pendingImport) return;
  button.disabled=true;
  try {
    const pending=state.pendingImport;
    const mode=$('#json-save-mode').value;
    if(mode==='replace' && cats.includes(pending.category) && !confirm(`${pending.category} 전체 데이터를 교체합니다. 계속할까요?`)) return;
    state.data=await (await api('/api/import/save',{category:pending.category,entries:pending.entries,mode})).json();
    state.original=state.data; state.overrides={}; state.pendingImport=null;resetFilters();dialog.close();render();toast('JSON 데이터를 서버에 저장했습니다.');
  } catch(error) { $('#upload-result').innerHTML=`<div class="form-error">${esc(error.message)}</div>`; }
  finally { button.disabled=false; }
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');
  if(!button || button.disabled) return;
  const actions={'json-upload':openJsonUpload,'analyze-folder':analyzeFolder,'resume-analysis':resumeAnalysis,'new-folder':openFolderUpload,'retry-analysis':()=>retryAnalysis(button),'apply-analysis':()=>applyAnalysis(button),'save-json-import':()=>saveJsonImport(button),'view-analysis':()=>{dialog.close();navigate('market',{category:currentJob.category});}};
  actions[button.dataset.action]?.();
});
document.addEventListener('change',event=>{
  if(['folder-input','images-input'].includes(event.target.id)) selectFolderFiles(event.target.files);
  if(event.target.id==='analysis-consent') updateFolderButton();
  for(const prefix of ['folder','upload']) if(event.target.id===`${prefix}-category`) $(`#${prefix}-new-wrap`).hidden=event.target.value!=='__new';
});
dialog.addEventListener('close',()=>{clearTimeout(jobTimer);folderGeneration++;});
