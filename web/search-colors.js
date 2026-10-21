/* Everywhere: colors search tags while you type (October 21, 2026).
   A valid #tag turns blue. A ##folder tag turns green when it names exactly one folder and
   yellow-green when it names several; Everywhere asks Everything as you type. A copy of the
   text is laid exactly over the search box, which keeps the caret, selection and typing. */
(() => {
  'use strict';
  const input = document.getElementById('search');
  const box = input?.closest('.pt-search');
  if (!input || !box) return;
  const layer = document.createElement('div');
  layer.className = 'ew-search-colors'; layer.setAttribute('aria-hidden', 'true');
  box.append(layer);
  let tags = null;                 // valid single-# tag names, lower case
  const folders = new Map();       // text after ## -> 0, 1, 2 (two or more), or 'pending'
  let timer = 0;
  const openFolder = () => { try { return sessionStorage.getItem('scratchpad-current-folder') || ''; } catch { return ''; } };
  // ##current and ##. depend on the open folder, so their answers are remembered per folder.
  const key = raw => /^(\.|current)([\/\\]|$)/i.test(raw) ? openFolder() + '\u0000' + raw : raw;
  const BOUNDARY_BEFORE = /[\s<(|]/, STOP = /[\s>)|"]/;

  // Same rules as the search itself (src/everything.rs): tags start a word, quotes keep text literal.
  function tokens(value) {
    const out = []; let plain = '', quoted = false, i = 0;
    const flush = () => { if (plain) out.push({text: plain}); plain = ''; };
    const atEnd = end => end >= value.length || /[\s>)|]/.test(value[end]);
    while (i < value.length) {
      const c = value[i];
      const start = i === 0 || BOUNDARY_BEFORE.test(value[i - 1]);
      if (c === '#' && !quoted && start) {
        if (value[i + 1] === '#') {
          let end;
          if (value[i + 2] === '"') { const close = value.indexOf('"', i + 3); end = close < 0 ? value.length : close + 1; }
          else { end = i + 2; while (end < value.length && !STOP.test(value[end])) end++; }
          if (atEnd(end) && end > i + 2) {
            const raw = value.slice(i + 2, end); flush();
            out.push({text: value.slice(i, end), folder: raw}); i = end; continue;
          }
        } else {
          let end = i + 1; while (end < value.length && /[A-Za-z0-9]/.test(value[end])) end++;
          if (end > i + 1 && atEnd(end)) {
            const name = value.slice(i + 1, end).toLowerCase(); flush();
            out.push({text: value.slice(i, end), tag: name}); i = end; continue;
          }
        }
      }
      if (c === '"') quoted = !quoted;
      plain += c; i++;
    }
    flush(); return out;
  }
  function classFor(token) {
    if (token.tag) return tags?.has(token.tag) ? 'ew-tag' : '';
    if (token.folder) { const n = folders.get(key(token.folder)); return n === 1 ? 'ew-folder-one' : n >= 2 ? 'ew-folder-many' : n === -1 ? 'ew-folder-unindexed' : ''; }
    return '';
  }
  // Copy every measurement that affects where glyphs land.
  function align() {
    const s = getComputedStyle(input);
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textIndent', 'textTransform',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'])
      layer.style[k] = s[k];
    layer.style.left = input.offsetLeft + 'px'; layer.style.top = input.offsetTop + 'px';
    layer.style.width = input.offsetWidth + 'px'; layer.style.height = input.offsetHeight + 'px';
    layer.scrollLeft = input.scrollLeft;
  }
  let shown = null;
  function render() {
    shown = input.value;
    const list = tokens(input.value);
    const colored = list.some(t => classFor(t));
    input.classList.toggle('ew-colored', colored);
    // A red tag names a real folder or drive that Everything does not index: say how to fix it.
    const red = list.find(t => t.folder && folders.get(key(t.folder)) === -1);
    if (red) input.title = red.text + ' exists, but Everything isn’t indexing it. In Everything, open Tools → Options → Folders, click Add… and choose it.';
    else if (input.title.includes('isn’t indexing')) input.removeAttribute('title');
    layer.hidden = !colored;
    if (colored) {
      layer.replaceChildren(...list.map(t => {
        const cls = classFor(t); if (!cls) return document.createTextNode(t.text);
        const span = document.createElement('span'); span.className = cls; span.textContent = t.text; return span;
      }));
      align();
    }
    clearTimeout(timer);
    if (list.some(t => t.folder && !folders.has(key(t.folder)))) timer = setTimeout(lookUp, 250);
  }
  async function lookUp() {
    const wanted = [...new Set(tokens(input.value).filter(t => t.folder && !folders.has(key(t.folder))).map(t => t.folder))];
    for (const raw of wanted) folders.set(key(raw), 'pending');
    await Promise.all(wanted.map(async raw => {
      try { folders.set(key(raw), Number(await window.scratchApi('folder_tag_count', {tag: raw, currentFolder: openFolder() || null})) || 0); }
      catch { folders.delete(key(raw)); }   // Everything unavailable or an incomplete tag: try again later.
    }));
    render();
  }
  async function loadTags() {
    try {
      const data = await window.scratchApi('search_tags');
      tags = new Set([...(data.extensions || []), ...(data.groups || []).flatMap(g => g.tags || [])].map(t => String(t).toLowerCase()));
      render();
    } catch { setTimeout(loadTags, 3000); }
  }
  const sync = () => requestAnimationFrame(() => { if (!layer.hidden) layer.scrollLeft = input.scrollLeft; });
  input.addEventListener('input', render);
  for (const type of ['keydown', 'keyup', 'click', 'select', 'scroll', 'focus', 'blur']) input.addEventListener(type, sync);
  addEventListener('resize', () => { if (!layer.hidden) align(); });
  new MutationObserver(() => { if (!layer.hidden) align(); }).observe(box, {attributes: true, attributeFilter: ['class']});
  window.everywhereSearchColors = {tokens};
  // The page also fills the box itself (for example when opening a search), without an input event.
  setInterval(() => { if (input.value !== shown) render(); }, 300);
  loadTags(); render();
})();
