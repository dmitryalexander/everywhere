const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.EVERYWHERE_TEST_BROWSER||undefined,headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1600,height:850}});context.setDefaultTimeout(15000);
    const explorer=[];
    await context.route('**/rpc',async route=>{
      const request=route.request().postDataJSON();const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:3017'};
      if(request.command==='open_in_explorer'){explorer.push(request.args.path);return route.fulfill({json:{result:null},headers});}
      if(request.command==='save_settings')return route.fulfill({json:{result:null},headers});
      if(request.command==='list_folder')return route.fulfill({json:{result:{entries:[],total:0,hasMore:false}},headers});
      if(request.command==='load_settings'){
        const response=await route.fetch(),data=await response.json(),lists=JSON.parse(data.result.browserStore['scratchpad-collections-v1']);
        const favorites=lists.lists.find(list=>list.name==='Favorites');assert(favorites);lists.activeId=favorites.id;
        data.result.browserStore['scratchpad-collections-v1']=JSON.stringify(lists);return route.fulfill({response,json:data});
      }await route.continue();
    });
    const page=await context.newPage();await page.goto('http://127.0.0.1:3017/?pt_page=lists');
    await page.waitForFunction(()=>document.querySelector('.folder-card')?.offsetWidth>0&&!document.querySelector('#file-wall').classList.contains('compact-programs'));
    const dimensions=await page.locator('.folder-card').evaluateAll(cards=>cards.map(card=>({width:card.offsetWidth,height:card.offsetHeight,shadow:getComputedStyle(card).boxShadow})));
    assert(dimensions.length>=7);assert.equal(new Set(dimensions.map(card=>card.width)).size,1);assert.equal(new Set(dimensions.map(card=>card.height)).size,1);
    assert(dimensions.every(card=>card.width<320&&card.height>150&&card.shadow==='none'));
    await page.screenshot({path:path.resolve(__dirname,'../test-results/brick-folders.png')});
    const first=page.locator('.folder-card').first(),folder=await first.evaluate(card=>card.entry.path);
    const originalUrl=page.url();
    await Promise.all([page.waitForResponse(response=>response.url().endsWith('/rpc')&&response.request().postDataJSON()?.command==='open_in_explorer'),first.locator('.zone-launch').click({modifiers:['Control']})]);
    assert.equal(page.url(),originalUrl);assert.equal(explorer[0],path.dirname(folder));assert.equal(await page.locator('.current-folder').count(),0);
    await first.locator('.zone-open').click();await page.waitForFunction(folder=>document.querySelector('.current-folder')?.entry.path===folder,folder);
    assert.equal(await page.locator('.file-card').count(),1);
    const folderUrl=page.url();
    await Promise.all([page.waitForResponse(response=>response.url().endsWith('/rpc')&&response.request().postDataJSON()?.command==='open_in_explorer'),page.locator('.current-folder .zone-launch').click({modifiers:['Control']})]);
    assert.equal(page.url(),folderUrl);assert.equal(await page.locator('.current-folder').evaluate(card=>card.entry.path),folder);assert.equal(explorer[1],path.dirname(folder));
    const up=path.dirname(folder);await page.locator('.current-folder .zone-launch').click();
    await page.waitForFunction(up=>document.querySelector('.current-folder')?.entry.path===up,up);
    await page.goto('http://127.0.0.1:3017/?pt_page=lists');await page.waitForSelector('.folder-card');
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>[...document.querySelectorAll('.folder-card')].every(card=>card.getBoundingClientRect().right<=innerWidth));
    const rows=await page.locator('.folder-card').evaluateAll(cards=>new Set(cards.map(card=>Math.round(card.getBoundingClientRect().top))).size);assert(rows>1);
    console.log('Passed: equal-width brick folder tiles, wrapping on narrow screens, no saved border in collections, current folder first, and red-strip parent navigation.');
    console.log('Passed: Ctrl+red opens only Explorer and leaves Everywhere unchanged in collections and folder browsing.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
