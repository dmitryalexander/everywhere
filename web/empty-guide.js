/* Everywhere: friendly first steps on empty pages, with the same avatars and layout as
   Pinful and Individuous (October 21, 2026). Shown only while a wall has nothing in it;
   it never changes saved data or files. */
(() => {
  'use strict';
  const ID = 'pt-empty-tutorial';
  const $ = selector => document.querySelector(selector);
  const node = (tag, cls, text) => {
    const n = document.createElement(tag); if (cls) n.className = cls;
    if (text != null) n.textContent = text; return n;
  };
  // "Press {A} to save" becomes text with an amber keyboard cap.
  function words(parent, text) {
    for (const part of text.split(/(\{[^}]+\})/)) {
      if (!part) continue;
      const key = part.match(/^\{(.+)\}$/);
      parent.append(key ? node('kbd', '', key[1]) : document.createTextNode(part));
    }
    return parent;
  }
  const browsePC = ['Browse This PC', {href: '/?pt_page=files'}];
  const findFiles = ['Search your files', {search: true}];
  const keepStep = [['A'], 'Keep a find', 'When files appear, hover one and press {A} to save it in your active collection. The file itself stays where it is.'];
  const copy = {
    lists: {
      art: 'welcome', label: 'Collections',
      title: 'Hello! You’re on the star page.',
      intro: 'This is your own collection: files to come back to, favorite photos, folders you open every day. Saving keeps a reference here — the file itself stays exactly where it is.',
      nudge: 'Start with the rectangle next to the star, in the top left. It shows the collection you’re saving to.',
      steps: [
        [['R'], 'Make it yours', 'Click the collection rectangle, point at a name in the list, then press {R} to rename it.'],
        [['A'], 'Make room for something new', 'With that list open, press {A} to add a collection — one for a project, a trip, or the folders you use every day.'],
        [['X', 'X'], 'Let a collection go', 'Point at its name in the list and press {X} twice to delete the collection. Your files are untouched, and the last collection is always kept.']
      ],
      footer: 'Ready to collect? Search or open a folder, then hover a file and press {A} to save it to your active collection.',
      action: ['Open collection controls', {click: '#collection-name'}], secondary: browsePC
    },
    history: {
      art: 'history', label: 'History',
      title: 'Hello! Your travels leave a trail.',
      intro: 'Files and folders you open in this window appear here, so you can find your way back to something good. There is nothing here yet.',
      nudge: 'This trail lasts while this window is open. It only remembers what you opened; it never changes your files.',
      steps: [
        [['A'], 'Keep more than a memory', 'When you find something worth keeping, hover it and press {A} to save it in your active collection.'],
        [['Space'], 'Take a closer look', 'Hover a file and press {Space} for a quick preview without opening it.']
      ],
      footer: 'Hold {Ctrl} and click a file to show it in Explorer.',
      action: findFiles, secondary: browsePC
    },
    discover: {
      art: 'thinking', label: 'Search groups',
      title: 'Let’s give this feed a few interests.',
      intro: 'This feed mixes files that match the terms in your search group, found by Everything across all of your drives. There is nothing to show yet: the group may have no terms, or nothing matched them.',
      nudge: 'The rectangle beside the magnifying glass is your search group. Terms can use search tags too, like “#img holiday”.',
      steps: [
        [['R'], 'Name your group', 'Click the group rectangle, point at a name, then press {R} to rename it. Press {A} in that same list to make another group.'],
        [['A'], 'Give it an interest', 'Point at the dotted interests bar beside Search and press {A} to add a term — a project, a file type, a place.'],
        [['I'], 'Add a whole handful', 'Point at the interests bar and press {I} to paste or edit several terms at once.']
      ],
      footer: 'Click a term to put it in the search box, or hold {Ctrl} and click it to search right away.',
      action: ['Open search-group controls', {click: '.pt-active-group'}], secondary: browsePC
    },
    search: {
      art: 'search', label: 'Search',
      title: 'Try another trail.',
      intro: 'Everything found no files or folders for this search.',
      nudge: 'Try fewer words, check the spelling, or drop a tag. ##current searches only the folder you have open; ##name searches inside every folder with that exact name.',
      steps: [
        [['Enter'], 'Search again', 'Change the words in Search and press {Enter}.'],
        [['Ctrl', 'F'], 'Jump to Search', 'Press {Ctrl} + {F} from anywhere on the wall to put the cursor in the search box.']
      ],
      footer: 'Menu → Searching and tags lists every filter, such as #img, #video, #docs and #code.',
      action: ['Try another search', {search: true}], secondary: browsePC
    },
    restore: {
      art: 'restore', label: 'Restore',
      title: 'Pick up where you left off.',
      intro: 'The diamond takes you back to the last folder, search or search-group feed you were browsing, scrolled to where you were. Nothing is saved here yet.',
      nudge: 'It keeps just one place, the most recent, and still remembers it after you quit Everywhere. It’s a quick bookmark, separate from your collections and History.',
      steps: [
        [['Enter'], 'Browse or search', 'Open a folder from This PC, or search your files and press {Enter}. Everywhere remembers the spot as you scroll.'],
        [['A'], 'Keep what matters', 'Restore holds only your latest place. To keep a file for good, hover it and press {A} to save it in your active collection.']
      ],
      footer: 'Then click the diamond, just right of the folder button, to jump straight back.',
      action: findFiles, secondary: browsePC
    },
    everything: {
      art: 'ideas', label: 'Connecting to Everything',
      title: 'Everything isn’t running yet.',
      intro: 'Everywhere searches your drives through voidtools Everything. Start the standard Everything app and your files will appear here.',
      nudge: 'Everything Lite can’t connect. Browsing This PC, folders and your collections works without Everything.',
      steps: [],
      footer: 'If Everything isn’t installed, get the standard edition from voidtools.com, start it once, then come back.',
      action: ['Start Everything', {click: '#connect'}], secondary: browsePC
    }
  };
  // The page's own messages for an empty wall, by view.
  const EMPTY = {
    'Hover a file and press A to save it here.': 'lists',
    'Files and folders you open this session appear here.': 'history',
    'No matches. Try another search or choose a folder.': 'search',
    'Nothing to restore yet.': 'restore'
  };
  function button([text, how], secondary) {
    const b = node(how.href ? 'a' : 'button', 'pt-welcome-action' + (secondary ? ' pt-welcome-secondary' : ''), text);
    if (how.href) b.href = how.href;
    else {
      b.type = 'button';
      b.onclick = () => {
        if (how.click) { $(how.click)?.click(); return; }
        const input = $('#search'); input?.focus(); input?.select();
      };
    }
    return b;
  }
  function create(kind) {
    const cfg = copy[kind];
    const section = node('section', 'pt-empty-tutorial'); section.id = ID;
    section.dataset.kind = kind; section.setAttribute('aria-labelledby', 'pt-welcome-title');
    const art = node('a', 'pt-welcome-art'), img = node('img');
    art.href = 'https://ynforma.art'; art.target = '_blank'; art.rel = 'noopener noreferrer'; art.title = 'ynforma.art';
    img.src = '/tutorial/' + cfg.art + '.png'; img.alt = ''; img.width = 240; img.height = 420; img.decoding = 'async';
    art.append(img);
    const content = node('div', 'pt-welcome-copy');
    const heading = node('h1', '', cfg.title); heading.id = 'pt-welcome-title';
    content.append(node('p', 'pt-welcome-eyebrow', 'A little help getting started · ' + cfg.label), heading,
      node('p', 'pt-welcome-intro', cfg.intro), node('p', 'pt-welcome-nudge', cfg.nudge));
    if (cfg.steps.length) {
      const list = node('ol', 'pt-welcome-steps');
      for (const [keys, title, text] of cfg.steps) {
        const item = node('li', 'pt-welcome-step'), caps = node('div', 'pt-welcome-caps');
        caps.setAttribute('aria-hidden', 'true');
        for (const key of keys) caps.append(node('kbd', '', key));
        const body = node('div'); body.append(node('h2', '', title), words(node('p'), text));
        item.append(caps, body); list.append(item);
      }
      content.append(list);
    }
    content.append(words(node('p', 'pt-welcome-footer'), cfg.footer));
    const actions = node('div', 'pt-welcome-actions');
    actions.append(button(cfg.action), button(cfg.secondary, true));
    content.append(actions); section.append(art, content);
    return section;
  }
  function chooseKind(view, statusText, hasCards, everythingOff) {
    if (hasCards) return null;
    if (everythingOff && (view === 'search' || view === 'discover')) return 'everything';
    if (view === 'discover' && statusText === 'No matches. Try another search or choose a folder.') return 'discover';
    const kind = EMPTY[statusText] || null;
    // Each message belongs to one view; anything else (loading, errors) stays as it is.
    const views = {lists: 'lists', history: 'history', search: 'search', restore: 'restore'};
    return kind && views[kind] === view ? kind : null;
  }
  function sync() {
    const wall = $('#file-wall'), status = $('#status');
    if (!wall || !status) return;
    const text = status.textContent.trim();
    // The wall names its view once it renders; before that (or after an error) the address does.
    const params = new URLSearchParams(location.search);
    const view = wall.dataset.view || (params.get('q')?.trim() ? 'search' : params.get('pt_page') || 'lists');
    const kind = /^(Loading|Connecting)/.test(text) ? null : chooseKind(view, text, !!wall.querySelector('.file-card'), document.body.dataset.everything === 'off');
    let section = document.getElementById(ID);
    if (section && section.dataset.kind !== kind) { section.remove(); section = null; }
    if (kind && !section) wall.before(create(kind));
    // The guide replaces the one-line hint, but never hides an error or a loading message.
    status.closest('.continuous-status')?.classList.toggle('pt-welcome-suppressed', !!kind && kind !== 'everything');
  }
  window.everywhereEmptyGuide = {sync, chooseKind, copy};
  function start() {
    sync();
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return; scheduled = true;
      requestAnimationFrame(() => { scheduled = false; sync(); });
    }).observe(document.querySelector('main') || document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-view']});
    new MutationObserver(sync).observe(document.body, {attributes: true, attributeFilter: ['data-everything']});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
