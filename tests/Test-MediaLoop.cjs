const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.EVERYWHERE_TEST_BROWSER||undefined,args:['--autoplay-policy=no-user-gesture-required']});
 try {
  const context=await browser.newContext();context.setDefaultTimeout(10000);
  const entries=[{name:'portrait.png',path:'C:\\fixture\\portrait.png',kind:'Images',isDir:false,size:1,modified:1},{name:'clip.mp4',path:'C:\\fixture\\clip.mp4',kind:'Videos',isDir:false,size:1,modified:1}];
  let settings={browserStore:{'scratchpad-folder-favorites-v1':'true','scratchpad-collections-v1':JSON.stringify({activeId:'test',lists:[{id:'test',name:'Media fixture',items:entries}]}),'scratchpad-loop-video':'off'}};
  const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:3017','Access-Control-Allow-Headers':'Content-Type,X-Everywhere-Token'};
  await context.route(url=>['/session','/rpc'].includes(url.pathname),async route=>{
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(new URL(route.request().url()).pathname==='/session')return route.fulfill({json:{token:'fixture'},headers});
   const {command,args}=route.request().postDataJSON();let result=null;
   if(command==='startup')result={locations:[],drives:[],everythingRunning:true,previewConverter:true};
   else if(command==='load_settings')result=settings;
   else if(command==='save_settings'){settings=JSON.parse(JSON.stringify(args.value));}
   else if(command==='thumbnail')result={data:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="160"><rect width="100" height="160" fill="#c90"/></svg>'),width:100,height:160};
   return route.fulfill({json:{result},headers});
  });
  await context.route(url=>['/media','/preview'].includes(url.pathname),route=>route.fulfill({contentType:'video/mp4',path:path.resolve(__dirname,'fixtures/loop.mp4'),headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:3017'}}));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3017/?pt_page=lists');await page.waitForSelector('.image-card .file-tile>img');
  const styles=await page.locator('.file-card').evaluateAll(cards=>cards.map(c=>({image:c.classList.contains('image-card'),padding:getComputedStyle(c).paddingTop,radius:getComputedStyle(c).borderRadius,tile:getComputedStyle(c.querySelector('.file-tile')).borderRadius,ratio:c.querySelector('.file-tile').offsetHeight/c.querySelector('.file-tile').offsetWidth})));
  assert.equal(styles[0].padding,'0px');assert.equal(styles[0].radius,'0px');assert.equal(styles[0].tile,'0px');assert(styles[0].ratio>1.4,'portrait proportions preserved');
  assert.equal(styles[1].padding,'8px');assert.equal(styles[1].radius,'18px');await page.screenshot({path:path.resolve(__dirname,'../test-results/media-layout.png')});
  await page.locator('.video-card .zone-open').click();await page.mouse.move(0,0);
  await page.waitForFunction(()=>document.querySelector('video.sp-video-manual')?.readyState>=2);
  assert.equal(await page.locator('video.sp-video-manual').evaluate(v=>v.loop),false);
  await page.locator('.pt-menu summary').click();await page.locator('#loop-toggle').click();
  await page.waitForFunction(()=>document.querySelector('video.sp-video-manual').loop);
  await page.evaluate(async()=>{const v=document.querySelector('video.sp-video-manual');let previous=0;window.repeats=0;v.addEventListener('timeupdate',()=>{if(previous>.6&&v.currentTime<.4)window.repeats++;previous=v.currentTime;});v.currentTime=.8;await v.play();});
  await page.waitForFunction(()=>window.repeats>0);
  await page.waitForFunction(()=>scratchStorage.getItem('scratchpad-loop-video')==='on');
  await page.reload();await page.waitForSelector('.video-card');
  await page.locator('.pt-menu summary').click();assert.equal(await page.locator('#loop-toggle').getAttribute('aria-pressed'),'true');
  await page.locator('#loop-toggle').click();await page.locator('.pt-menu summary').click();
  await page.locator('.video-card .zone-open').click();await page.mouse.move(0,0);
  await page.waitForFunction(()=>document.querySelector('video.sp-video-manual')?.ended);
  assert.equal(await page.locator('video.sp-video-manual').evaluate(v=>v.loop),false);
  await page.locator('.video-card').hover();await page.keyboard.press('Space');await page.waitForSelector('.sp-dialog-video');
  assert.equal(await page.locator('.sp-dialog-video').evaluate(v=>v.loop),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: square image edges/natural proportions, inset video frame, real repetition on, stop off, loop persistence after reload and dialog setting. Helper/settings isolated.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
