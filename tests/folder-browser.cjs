/* UI integration test: analysis API is mocked so this test never incurs AI charges. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run() {
  const folder = fs.mkdtempSync(path.join(__dirname, 'folder-fixture-'));
  fs.mkdirSync(path.join(folder,'sub'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(folder,'01.png'),png);
  fs.writeFileSync(path.join(folder,'sub/02.png'),png);
  fs.writeFileSync(path.join(folder,'notes.txt'),'Not an image');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.accept());
    const base=process.env.DASHBOARD_URL || 'http://127.0.0.1:3000';
    const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/extracted/세탁세제.json'),'utf8'))[0];
    const testEntries=[{...raw,file:'01.png'},{...raw,file:'sub/02.png'}];
    const preview=await (await page.request.post(base+'/api/import',{data:{overrides:{'핸드워시':testEntries}}})).json();
    preview.saved_categories=['핸드워시'];
    let job, starts=0, uploaded=0, applied=false;
    let configured=true;
    const response=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    await page.route('**/api/dashboard',route=>applied ? response(route,preview) : route.continue());
    await page.route('**/api/analysis**',async route=>{
      const req=route.request();const url=new URL(req.url()).pathname;
      if(url==='/api/analysis/config') return response(route,{configured,model:'test-provider',heic:true,message:configured?'AI 연결 설정됨':'서버에 OPENAI_API_KEY를 설정하세요.'});
      if(url==='/api/analysis') {
        const payload=req.postDataJSON();assert.equal(payload.category,'핸드워시');assert.equal(payload.files.length,2);assert.equal(payload.mode,'append');
        job={...payload,id:'a'.repeat(32),status:'uploading',files:payload.files.map(f=>({...f,status:'pending',entries:[],error:null}))};
        return response(route,job,201);
      }
      const match=url.match(/\/files\/(\d+)$/);
      if(match) {const i=Number(match[1]);assert.equal(req.postDataBuffer().length,job.files[i].size);uploaded++;job.files[i].status='uploaded';job.status=uploaded===2?'ready':'uploading';return response(route,job);}
      if(url.endsWith('/start')) {
        assert.equal(req.postDataJSON().consent,true);starts++;job.status='running';return response(route,job,202);
      }
      if(url.endsWith('/apply')) {assert.equal(job.status,'review');applied=true;job.status='applied';return response(route,preview);}
      if(req.method()==='GET') {
        if(starts===1) {job.status='partial';job.files[0]={...job.files[0],status:'done',entries:[testEntries[0]],validation:['일치']};job.files[1]={...job.files[1],status:'error',error:'Test provider timeout'};}
        else if(starts===2 && !applied) {job.status='review';job.files[1]={...job.files[1],status:'done',entries:[testEntries[1]],validation:['일치'],error:null};}
        return response(route,job);
      }
      throw new Error('Unexpected analysis request '+url);
    });
    await page.goto(base);await page.waitForSelector('.stats-grid');
    await page.locator('[data-action="upload"]').first().click();
    await page.waitForFunction(()=>document.querySelector('#vision-status')?.textContent.includes('test-provider'));
    assert.equal(await page.locator('#folder-category').inputValue(),'__new');
    await page.locator('#folder-new-category').fill('핸드워시');
    await page.locator('#folder-input').setInputFiles(folder);
    assert.match(await page.locator('#folder-selection').innerText(),/2장/);
    assert.match(await page.locator('#folder-selection').innerText(),/제외된 비이미지 파일 1개/);
    assert.match(await page.locator('#folder-selection').innerText(),/sub\/02.png/);
    assert.equal(await page.locator('#start-folder').isDisabled(),true);
    await page.locator('#analysis-consent').check();
    await page.locator('#start-folder').click();
    await page.waitForSelector('[data-action="retry-analysis"]');
    assert.match(await page.locator('#analysis-progress').innerText(),/일부 이미지 분석 실패/);
    assert.equal(await page.locator('[data-action="apply-analysis"]').count(),0);
    assert.equal(uploaded,2);
    // Resume after reload with durable job ID (API persistence is covered by Python tests).
    await page.reload();await page.waitForSelector('.stats-grid');
    await page.locator('[data-page="data"]').click();
    await page.locator('[data-action="resume-analysis"]').click();
    await page.waitForSelector('[data-action="retry-analysis"]');
    await page.locator('[data-action="retry-analysis"]').click();
    await page.waitForSelector('[data-action="apply-analysis"]');
    assert.equal(starts,2);
    assert.match(await page.locator('#job-review').innerText(),/추출된 제품 2개/);
    assert.match(await page.locator('#job-review').innerText(),/단가 검증/);
    await page.locator('[data-action="apply-analysis"]').click();
    await page.waitForSelector('[data-action="view-analysis"]');
    await page.locator('[data-action="view-analysis"]').click();
    await page.waitForSelector('[data-category="핸드워시"]');
    assert.equal(await page.locator('tr[data-product]').count(),2);
    await page.reload();await page.waitForSelector('[data-category="핸드워시"]');
    await page.locator('[data-category="핸드워시"]').click();
    assert.equal(await page.locator('tr[data-product]').count(),2);
    await page.locator('[data-page="specs"]').click();
    await page.locator('[data-spec-category="핸드워시"]').click();
    assert.match(await page.locator('.spec-grid').innerText(),/목표 규격은 아직 없습니다/);

    // A missing provider must never look like a successful or available analysis.
    configured=false;
    await page.locator('[data-page="data"]').click();
    await page.locator('[data-action="upload"]').first().click();
    await page.waitForFunction(()=>document.querySelector('#vision-status')?.textContent.includes('OPENAI_API_KEY'));
    await page.locator('#images-input').setInputFiles([path.join(folder,'01.png'),path.join(folder,'sub/02.png')]);
    await page.locator('#analysis-consent').check();
    assert.equal(await page.locator('#start-folder').isDisabled(),true);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
    assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
    await page.keyboard.press('Escape');

    // New category JSON preview follows the same dynamic category path without writing to disk.
    await page.locator('[data-action="upload"]').first().click();
    await page.locator('dialog [data-action="json-upload"]').click();
    await page.selectOption('#upload-category','__new');
    await page.locator('#upload-new-category').fill('욕실세정제');
    await page.locator('#upload-file').setInputFiles({name:'sample.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([raw]))});
    await page.waitForSelector('.form-success');
    await page.locator('#apply-import').click();
    await page.waitForSelector('.session-banner');
    assert.ok(await page.evaluate(()=>cats.includes('욕실세정제')));
    assert.deepEqual(errors,[]);
    console.log('PASS: recursive folder selection, file inventory, exclusion notices, consent, sequential uploads, partial failure/retry, reload recovery, save/reload, dynamic categories, empty specs, missing provider and mobile dialog. No live AI calls made.');
  } finally {await browser.close();fs.rmSync(folder,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
