const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const item=(name)=>({path:'C:\\SaveDestinationFixture\\'+name,name,isDir:false,kind:'Documents',size:1,modified:0});
  const source=item('source.txt'),original=item('original.txt');
  let settings={browserStore:{'scratchpad-folder-favorites-v1':'true','scratchpad-collections-v1':JSON.stringify({activeId:'home',lists:[{id:'home',name:'Home',items:[original]},{id:'programs',name:'Programs',items:[]}]})}};
  const browser=await chromium.launch({executablePath:process.env.EVERYWHERE_TEST_BROWSER||undefined,headless:true});
  try{
    const context=await browser.newContext();
    await context.route('**/rpc',async route=>{
      const request=route.request().postDataJSON(),headers={'Access-Control-Allow-Origin':'http://127.0.0.1:3017'};
      let result;
      if(request.command==='load_settings')result=settings;
      else if(request.command==='save_settings'){settings=request.args.value;result=null;}
      else if(request.command==='search_files')result={entries:[source],total:1,hasMore:false};
      else if(request.command==='list_folder')result={entries:[source],total:1,hasMore:false};
      else if(request.command==='thumbnail')result=null;
      else if(request.command==='text_preview')result='';
      else return route.continue();
      return route.fulfill({json:{result},headers});
    });
    const page=await context.newPage();
    const choose=async name=>{await page.locator('#collection-name').click();await page.getByRole('menuitemradio',{name,exact:true}).click();};
    const lists=()=>JSON.parse(settings.browserStore['scratchpad-collections-v1']).lists;
    const stored=()=>page.evaluate(()=>JSON.parse(window.scratchStorage.getItem('scratchpad-collections-v1')));
    await page.goto('http://127.0.0.1:3017/?q=fixture');await page.locator('.file-card').waitFor();
    const searchUrl=page.url();await choose('Programs');assert.equal(page.url(),searchUrl);assert.equal(await page.locator('.file-card').count(),1);
    await page.locator('.file-card').hover();await page.keyboard.press('a');
    assert.deepEqual((await stored()).lists.find(l=>l.id==='programs').items,[source]);
    await page.locator('#saved-link').click();await page.waitForURL('**pt_page=lists&list=programs');await page.locator('.file-card').waitFor();
    assert.equal(lists().find(l=>l.id==='programs').items.length,1);
    const listUrl=page.url();await choose('Home');assert.equal(page.url(),listUrl);assert.equal(await page.locator('.file-card').evaluate(c=>c.entry.name),'source.txt');
    await page.locator('.file-card').hover();await page.keyboard.press('a');
    assert.equal((await stored()).lists.find(l=>l.id==='home').items.length,2);
    assert.equal(await page.locator('.file-card').count(),1);
    // Removing and shuffling must affect the displayed list, not the save target.
    await page.keyboard.press('s');assert.equal((await stored()).lists.find(l=>l.id==='home').items.length,2);
    await page.locator('.file-card').hover();await page.keyboard.press('x');await page.keyboard.press('x');
    await page.waitForFunction(()=>document.querySelectorAll('.file-card').length===0);
    assert.equal((await stored()).lists.find(l=>l.id==='home').items.length,2);
    assert.equal((await stored()).lists.find(l=>l.id==='programs').items.length,0);
    await page.locator('#saved-link').click();await page.waitForURL('**list=home');await page.waitForFunction(()=>document.querySelectorAll('.file-card').length===2);
    await page.goto('http://127.0.0.1:3017/?pt_page=folder&path=C%3A%5CSaveDestinationFixture');await page.locator('.current-folder').waitFor();
    const folderUrl=page.url();await choose('Programs');assert.equal(page.url(),folderUrl);assert.equal(await page.locator('.file-card').count(),2);
    await page.locator('.file-card:not(.current-folder)').hover();await page.keyboard.press('a');
    assert.equal((await stored()).lists.find(l=>l.id==='programs').items.length,1);
    console.log('Passed: picker preserves search, folder and displayed collection; A saves to chosen list; star opens it; X and shuffle affect the displayed list.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
