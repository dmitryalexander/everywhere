const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE||'playwright');

(async () => {
  const folder = path.resolve(__dirname, '../test-results/filter-fixture');
  fs.mkdirSync(path.join(folder, 'nested'), { recursive: true });
  for (const name of ['root.jpg', 'ignore.txt', 'nested/clip.mp4', 'nested/photo.png', 'sample.exe', 'note.doc', 'note.docx', 'note.md']) {
    fs.writeFileSync(path.join(folder, name), 'filter fixture');
  }
  const browser = await chromium.launch({ executablePath: process.env.EVERYWHERE_TEST_BROWSER || undefined, headless: true });
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(15000);
    const opened = [];
    let folderFixture = null;
    // Exercise the real search bridge without changing saved user preferences.
    await context.route('**/rpc', async route => {
      const input = route.request().postDataJSON();
      if (folderFixture && input?.command === 'list_folder' && input.args.path === folder) {
        const offset = input.args.offset || 0;
        return route.fulfill({ json: { result: { entries: folderFixture.slice(offset, offset + 100), total: folderFixture.length, hasMore: offset + 100 < folderFixture.length } }, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3017' } });
      }
      if (['open_file', 'open_in_explorer'].includes(input?.command)) {
        opened.push(input);
        return route.fulfill({ json: { result: null }, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3017' } });
      }
      if (route.request().postDataJSON()?.command === 'save_settings') {
        return route.fulfill({ json: { result: null }, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3017' } });
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Page error:', error.message));
    await page.goto('http://127.0.0.1:3017/?q=%23current');
    console.log('Checking missing folder context');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Open a folder first'));
    await page.goto('http://127.0.0.1:3017/?pt_page=folder&path=' + encodeURIComponent(folder));
    console.log('Checking folder navigation');
    await page.waitForSelector('.file-card');
    await page.locator('#search').fill('#img #video #current');
    await Promise.all([page.waitForURL(url => url.searchParams.get('q') === '#img #video #current'), page.locator('#search').press('Enter')]);
    assert.equal(new URL(page.url()).searchParams.get('currentFolder'), folder);
    async function checkResults(target) {
      await target.waitForFunction(() => document.querySelectorAll('.file-card').length === 3);
      const names = await target.locator('.file-card').evaluateAll(cards => cards.map(card => card.entry.name).sort());
      assert.deepEqual(names, ['clip.mp4', 'photo.png', 'root.jpg']);
      const paths = await target.locator('.file-card').evaluateAll(cards => cards.map(card => card.entry.path));
      assert(paths.every(path => path.startsWith(folder + '\\')));
    }
    await checkResults(page);
    assert.equal(await page.locator('#path-name').textContent(), folder);
    await page.reload();
    await checkResults(page);
    const linked = await context.newPage();
    await linked.goto(page.url());
    await checkResults(linked);
    async function checkQuery(query, expected) {
      await page.locator('#search').fill(query);
      await Promise.all([page.waitForURL(url => url.searchParams.get('q') === query), page.locator('#search').press('Enter')]);
      await page.waitForFunction(count => document.querySelectorAll('.file-card').length === count, expected.length);
      assert.deepEqual(await page.locator('.file-card').evaluateAll(cards => cards.map(card => card.entry.name).sort()), expected.sort());
    }
    await checkQuery('#pictures #imgs #IMAGES #current', ['root.jpg', 'photo.png']);
    await checkQuery('#PNG #MP4 #current', ['photo.png', 'clip.mp4']);
    await checkQuery('#doc #current', ['note.doc']);
    await checkQuery('#exe #TXT #docx #MD #current', ['sample.exe', 'ignore.txt', 'note.docx', 'note.md']);
    await page.locator('.pt-menu summary').click();
    await page.locator('#search-tags').click();
    await page.locator('#tag-options .tag-options-row button').first().waitFor();
    const advertised = await page.locator('#tag-options .tag-options-row button').allTextContents();
    for (const tag of ['#pictures', '#imgs', '#png', '#jpg', '#exe', '#doc', '#txt', '#docx', '#md', '#mkv', '#mp4', '#mov', '#7z', '#3gp']) assert(advertised.includes(tag), tag);
    await page.screenshot({ path: path.resolve(__dirname, '../test-results/search-tags-guide.png') });
    await page.locator('#tag-options-filter').fill('png');
    assert.deepEqual(await page.locator('#tag-options .tag-options-row button').allTextContents(), ['#png']);
    await page.getByRole('button', { name: '#png', exact: true }).click();
    assert((await page.locator('#search').inputValue()).endsWith(' #png'));
    assert.equal(await page.locator('#tag-guide').evaluate(el => el.open), false);
    await page.locator('.pt-menu summary').click();
    await page.locator('#search-tags').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.locator('#tag-guide').evaluate(el => el.getBoundingClientRect().width <= 390 && el.scrollWidth <= el.clientWidth));
    await page.locator('#tag-guide header button').click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await checkQuery('#PNG #MP4 #current', ['photo.png', 'clip.mp4']);
    const redStrip = page.locator('.file-card').filter({ hasText: 'clip.mp4' }).locator('.zone-launch');
    await redStrip.focus();
    assert.equal(await redStrip.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    assert.equal(await redStrip.evaluate(el => getComputedStyle(el.parentElement, '::after').borderTopColor), 'rgb(185, 97, 112)');
    await redStrip.hover();
    await page.screenshot({ path: path.resolve(__dirname, '../test-results/card-containing-folder.png') });
    await redStrip.click();
    await page.waitForFunction(folder => document.querySelector('#path-name').textContent === folder, path.join(folder, 'nested'));
    await page.waitForFunction(folder => document.querySelector('.current-folder')?.entry.path === folder, path.join(folder, 'nested'));
    await page.waitForFunction(() => document.querySelectorAll('.file-card:not(.current-folder)').length === 2);
    assert.equal(await page.locator('.file-card').first().getAttribute('class'), 'file-card current-folder');
    assert.equal(await page.locator('.current-folder').evaluate(card => card.entry.path), path.join(folder, 'nested'));
    assert.equal(opened.length, 0, 'Red strip must browse inside Everywhere without launching the file');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/rpc') && response.request().postDataJSON()?.command === 'open_file'),
      page.locator('.file-card').filter({ hasText: 'clip.mp4' }).locator('.zone-open').click()
    ]);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].command, 'open_file');
    assert.equal(opened[0].args.path, path.join(folder, 'nested', 'clip.mp4'));
    await page.goto('http://127.0.0.1:3017/?pt_page=folder&path=' + encodeURIComponent(folder));
    const directory = page.locator('.file-card').filter({ hasText: 'nested' });
    await directory.locator('.zone-launch').click();
    await page.waitForFunction(current => document.querySelector('#path-name').textContent === current, folder);
    await page.waitForFunction(current => document.querySelector('.current-folder')?.entry.path === current, folder);
    await page.locator('.current-folder .zone-launch').click();
    await page.waitForFunction(current => document.querySelector('#path-name').textContent === current, path.dirname(folder));
    await page.waitForFunction(current => document.querySelector('.current-folder')?.entry.path === current, path.dirname(folder));
    await page.screenshot({ path: path.resolve(__dirname, '../test-results/current-folder-first.png') });
    folderFixture = Array.from({ length: 102 }, (_, index) => ({ path: path.join(folder, `page${index}.txt`), name: `page${index}.txt`, kind: 'Other', isDir: false, size: 0, modified: 0 }));
    await page.goto('http://127.0.0.1:3017/?pt_page=folder&path=' + encodeURIComponent(folder));
    await page.waitForFunction(() => document.querySelectorAll('.file-card:not(.current-folder)').length === 100);
    await page.locator('#more').click();
    await page.waitForFunction(() => document.querySelectorAll('.file-card:not(.current-folder)').length === 102);
    assert.equal(await page.locator('.current-folder').count(), 1);
    assert.equal(await page.locator('.file-card').first().evaluate(card => card.entry.path), folder);
    const pagedPaths = await page.locator('.file-card:not(.current-folder)').evaluateAll(cards => cards.map(card => card.entry.path));
    assert.equal(new Set(pagedPaths).size, 102);
    assert(pagedPaths.includes(path.join(folder, 'page100.txt')));
    folderFixture = [];
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'This folder is empty.');
    assert.equal(await page.locator('.file-card').count(), 1);
    await page.locator('.current-folder .zone-open').hover();
    await page.keyboard.press('x'); await page.keyboard.press('x');
    assert.equal(await page.locator('.current-folder.remove-armed').count(), 0);
    console.log(`Passed: recursive scope, combined aliases, exact extensions, capitalization, reload, searchable menu guide, tag insertion, mobile layout (${advertised.length} options).`);
    console.log('Passed: red strip browses containing folder for files and folders; gray area opens file; keyboard focus keeps the red border without an amber line.');
    console.log('Passed: current folder first, red-strip upward navigation, empty folders, pagination without skipped files, and navigation tile protected from removal.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
