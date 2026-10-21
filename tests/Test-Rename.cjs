const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const root=path.resolve(__dirname,'../test-results/rename-fixture-'+Date.now()),sub=path.join(root,'sub');
  fs.mkdirSync(sub,{recursive:true});fs.writeFileSync(path.join(root,'before.txt'),'original');fs.writeFileSync(path.join(root,'taken.txt'),'keep');fs.writeFileSync(path.join(sub,'child.txt'),'child');
  const item=(p,dir=false)=>({path:p,name:path.basename(p),isDir:dir,kind:dir?'Folders':'Documents',size:8,modified:0});
  const source=item(path.join(root,'before.txt')),child=item(path.join(sub,'child.txt')),directory=item(sub,true);
  let settings={browserStore:{'scratchpad-folder-favorites-v1':'true','scratchpad-collections-v1':JSON.stringify({activeId:'test',lists:[{id:'test',name:'Rename test',items:[source,directory,child]},{id:'other',name:'Other',items:[source,child]}]}),'scratchpad-search-term-lists-v1':JSON.stringify({activeId:'test',lists:[{id:'test',name:'Test terms',terms:['#images','#videos']}]})}};
  const browser=await chromium.launch({executablePath:process.env.EVERYWHERE_TEST_BROWSER||undefined,headless:true});
  try{
    const context=await browser.newContext();context.setDefaultTimeout(15000);
    await context.route('**/rpc',async route=>{const body=route.request().postDataJSON();if(body.command==='load_settings')return route.fulfill({json:{result:settings},headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:3017'}});if(body.command==='save_settings'){settings=body.args.value;return route.fulfill({json:{result:null},headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:3017'}});}await route.continue();});
    const page=await context.newPage();page.on('pageerror',error=>console.error(error.message));await page.goto('http://127.0.0.1:3017/?pt_page=lists');await page.waitForSelector('.pt-interest-chip');
    assert.equal(await page.locator('.file-card.saved .file-tile').first().evaluate(el=>getComputedStyle(el,'::before').content),'none');
    const term=page.locator('.pt-interest-chip').filter({hasText:'#images'});await term.hover();await page.keyboard.press('r');await page.locator('#term-rename').waitFor({state:'visible'});
    await page.locator('#term-rename input').fill('#pictures');await page.locator('#term-rename [type=submit]').click();await page.locator('.pt-interest-chip').filter({hasText:'#pictures'}).waitFor();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(window.scratchStorage.getItem('scratchpad-search-term-lists-v1')).lists[0].terms),['#pictures','#videos']);
    const before=page.locator('.file-card').filter({hasText:'before.txt'});await before.hover();await page.keyboard.press('r');await page.locator('#item-rename').waitFor({state:'visible'});await page.locator('#item-rename [type=button]').click();assert(fs.existsSync(source.path));
    await before.hover();await page.keyboard.press('r');await page.locator('#item-rename input').fill('taken.txt');await page.locator('#item-rename [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#item-rename [role=status]').textContent.includes('Could not rename'));assert.equal(fs.readFileSync(path.join(root,'taken.txt'),'utf8'),'keep');
    await page.locator('#item-rename input').fill('after.txt');await page.locator('#item-rename [type=submit]').click();await page.locator('#item-rename').waitFor({state:'hidden'});assert.equal(fs.readFileSync(path.join(root,'after.txt'),'utf8'),'original');assert(!fs.existsSync(source.path));
    const stored=JSON.parse(settings.browserStore['scratchpad-collections-v1']);assert(stored.lists.every(list=>list.items.some(entry=>entry.path===path.join(root,'after.txt'))));
    await page.goto('http://127.0.0.1:3017/?pt_page=folder&path='+encodeURIComponent(sub));await page.locator('.current-folder').waitFor();await page.locator('.current-folder').hover();await page.keyboard.press('r');await page.locator('#item-rename input').fill('renamed-sub');await page.locator('#item-rename [type=submit]').click();await page.locator('#item-rename').waitFor({state:'hidden'});
    const newSub=path.join(root,'renamed-sub');assert.equal(new URL(page.url()).searchParams.get('path'),newSub);assert.equal(await page.locator('.current-folder').evaluate(el=>el.entry.path),newSub);assert(fs.existsSync(path.join(newSub,'child.txt')));
    const updated=JSON.parse(settings.browserStore['scratchpad-collections-v1']);assert(updated.lists.every(list=>list.items.some(entry=>entry.path===path.join(newSub,'child.txt'))));
    await page.reload();await page.locator('.current-folder').waitFor();assert.equal(await page.locator('.current-folder').evaluate(el=>el.entry.path),newSub);
    console.log('Passed: hidden stars, R on search terms and items, cancel, collision protection, real file/folder rename, saved references across lists and descendants, current-folder URL, reload.');
  }finally{await browser.close();for(const name of ['before.txt','after.txt','taken.txt','sub/child.txt','renamed-sub/child.txt']){const p=path.join(root,name);if(fs.existsSync(p))fs.unlinkSync(p);}for(const name of ['sub','renamed-sub']){const p=path.join(root,name);if(fs.existsSync(p))fs.rmdirSync(p);}fs.rmdirSync(root);}
})().catch(error=>{console.error(error);process.exitCode=1;});
