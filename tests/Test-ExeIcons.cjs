const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EVERYWHERE_TEST_BROWSER || undefined, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 850 } });
    context.setDefaultTimeout(20000);
    await context.route('**/rpc', async route => {
      if (route.request().postDataJSON()?.command === 'save_settings') {
        return route.fulfill({ json: { result: null }, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3017' } });
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => console.error(error.message));
    await page.goto('http://127.0.0.1:3017/?pt_page=lists');
    await page.waitForSelector('.file-card');
    const programs = await page.evaluate(async () => {
      const settings = await window.scratchApi('load_settings');
      const collections = JSON.parse(settings.browserStore['scratchpad-collections-v1']);
      return collections.lists.find(list => list.name === 'Programs')?.items.filter(entry => /\.exe$/i.test(entry.path)) || [];
    });
    assert(programs.length >= 5, 'Expected saved Programs collection with EXEs');
    // Display just the saved programs in this temporary tab, without saving changes.
    await page.route('**/rpc', async route => {
      if (route.request().postDataJSON()?.command === 'search_files' && route.request().postDataJSON().args.query === 'icon-fixture') {
        return route.fulfill({ json: { result: { entries: programs, total: programs.length, hasMore: false } }, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3017' } });
      }
      if (route.request().postDataJSON()?.command === 'load_settings') {
        const response = await route.fetch();
        const data = await response.json();
        data.result.browserStore['scratchpad-collections-v1'] = JSON.stringify({ activeId: 'icon-test', lists: [{ id: 'icon-test', name: 'Programs', items: programs }] });
        return route.fulfill({ response, json: data });
      }
      await route.fallback();
    });
    await page.reload();
    await page.waitForFunction(count => document.querySelectorAll('.exe-icon').length === count && [...document.querySelectorAll('.exe-icon')].every(img => img.complete && img.naturalWidth > 0), programs.length);
    const icons = await page.locator('.exe-icon').evaluateAll(images => images.map(img => ({ data: img.src, width: img.naturalWidth, name: img.parentElement.querySelector('strong').textContent })));
    assert(new Set(icons.map(icon => icon.data)).size > 1, 'Programs must have distinct application icons');
    for (const icon of icons) assert(programs.some(entry => entry.name === icon.name));
    assert.equal(await page.locator('.file-tile > img').count(), 0, 'Icons retain filenames and cover layout');
    const first = page.locator('.file-card').first();
    assert.equal(await first.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 37, 34)');
    assert.equal(await first.evaluate(el => getComputedStyle(el).boxShadow), 'none');
    await page.waitForFunction(()=>document.querySelector('#file-wall').classList.contains('compact-programs'));
    const widths=await page.locator('.file-card').evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().width));
    assert(new Set(widths.map(Math.round)).size>1, 'Program card widths should fit different filenames');
    assert(Math.max(...widths)<340, 'Program cards should not fill stretched columns');
    const red = first.locator('.zone-launch');
    await red.hover();
    assert.equal(await first.locator('.hover-title').textContent(), path.dirname(programs[0].path));
    assert.equal(await first.locator('.hover-title').evaluate(el => getComputedStyle(el).webkitLineClamp), '4');
    assert.equal(await first.evaluate(el => getComputedStyle(el).borderRadius), '6px');
    assert.equal(await first.locator('.file-tile').evaluate(el => getComputedStyle(el).borderRadius), '4px');
    assert.equal(await page.locator('#search').evaluate(el => getComputedStyle(el).borderRadius), '4px');
    assert.equal(await page.locator('#files-link').evaluate(el => getComputedStyle(el).borderRadius), '5px');
    await page.screenshot({ path: path.resolve(__dirname, '../test-results/exe-icons.png') });
    await first.locator('.zone-open').hover();
    assert.equal(await first.locator('.hover-title').textContent(), programs[0].name);
    await red.focus();
    assert.equal(await first.locator('.hover-title').textContent(), path.dirname(programs[0].path));
    await first.locator('.zone-open').focus();
    assert.equal(await first.locator('.hover-title').textContent(), programs[0].name);
    await page.setViewportSize({ width: 390, height: 844 });
    await red.hover();
    assert(await first.locator('.hover-title').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.goto('http://127.0.0.1:3017/?q=icon-fixture');
    await first.waitFor();
    await first.hover();
    await page.keyboard.press('a');
    assert.equal(await first.evaluate(el => el.classList.contains('saved')), false);
    assert.equal(await first.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 37, 34)');
    await page.keyboard.press('a');
    assert.equal(await first.evaluate(el => el.classList.contains('saved')), true);
    assert.equal(await first.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 37, 34)');
    await page.goto('http://127.0.0.1:3017/?pt_page=folder&path='+encodeURIComponent(path.dirname(programs[0].path)));
    const savedInFolder=page.locator('.file-card').filter({hasText:programs[0].name});
    await savedInFolder.waitFor();
    assert.equal(await savedInFolder.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(85, 86, 80)');
    assert((await savedInFolder.evaluate(el=>getComputedStyle(el).boxShadow)).includes('rgb(160, 161, 154)'));
    console.log('Verified program icons with visible filenames:', icons.map(icon => icon.name).join(', '));
    console.log('Verified folder paths on red-strip hover and keyboard focus, normal filename captions, squarer shapes, and narrow-screen path wrapping.');
    console.log('Verified content-fit card widths, wrapped app layout, saved frames only in folder browsing, and no frame in collections/search.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
