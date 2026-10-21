/* Everywhere Menu page (October 21, 2026): preferences and a full tutorial, like the Menu
   pages of Pinful and Individuous. The ☰ button opens /?pt_page=menu instead of a drop-down. */
(() => {
  'use strict';
  const details = document.querySelector('.pt-menu');
  if (!details) return;
  const summary = details.querySelector('summary');
  const onMenu = new URLSearchParams(location.search).get('pt_page') === 'menu';
  summary.title = 'Menu and guide';
  summary.addEventListener('click', event => { event.preventDefault(); if (!onMenu) location.href = '/?pt_page=menu'; });
  if (!onMenu) return;

  const node = (tag, cls, text) => {
    const n = document.createElement(tag); if (cls) n.className = cls;
    if (text != null) n.textContent = text; return n;
  };
  // {A} becomes a keyboard cap and `#img` becomes code.
  function rich(parent, text) {
    for (const part of text.split(/(\{[^}]+\}|`[^`]+`)/)) {
      if (!part) continue;
      if (part.startsWith('{')) parent.append(node('kbd', '', part.slice(1, -1)));
      else if (part.startsWith('`')) parent.append(node('code', '', part.slice(1, -1)));
      else parent.append(document.createTextNode(part));
    }
    return parent;
  }
  const icon = path => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  const ICONS = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    tiles: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3Z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
  };
  function guide(id, iconName, title, build) {
    const section = node('section', 'pt-guide'); section.id = id;
    const h2 = node('h2'); h2.innerHTML = icon(ICONS[iconName]); h2.append(title);
    section.append(h2); build(section); return section;
  }
  const p = (parent, text, cls) => parent.append(rich(node('p', cls), text));
  const h3 = (parent, text) => parent.append(node('h3', '', text));
  // cards: [keys, title, text, zone]; 'then' between keys draws a plus sign.
  function cards(parent, list, wide) {
    const row = node('div', 'pt-hotkeys-row' + (wide ? ' ew-wide' : ''));
    for (const [keys, title, text, zone] of list) {
      const card = node('div', 'pt-hotkeys-card'); if (zone) card.dataset.zone = zone;
      if (keys.length) { const caps = node('div', 'ew-caps'); keys.forEach(k => caps.append(k === 'then' ? document.createTextNode('+') : node('kbd', '', k))); card.append(caps); }
      card.append(node('strong', '', title), rich(node('span'), text)); row.append(card);
    }
    parent.append(row);
  }
  function tryButton(parent, text, action) {
    const b = node(typeof action === 'string' ? 'a' : 'button', 'pt-hotkeys-try', text);
    if (typeof action === 'string') b.href = action; else { b.type = 'button'; b.onclick = action; }
    parent.append(b);
  }

  function build() {
    document.body.classList.add('ew-menu');
    document.title = 'Menu · Everywhere';
    details.open = false; details.classList.add('pt-current'); summary.setAttribute('aria-current', 'page');
    const main = document.querySelector('main');
    const page = node('div', 'ew-menu-page');

    // Round switches like Pinful's Menu. Each one presses the matching (hidden) menu button,
    // so saving and behavior stay in app.js, video.js and quit.js; labels mirror that button.
    const row = node('div', 'ew-switches');
    const SWITCHES = [
      ['loop-toggle', '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', 'Loop video: a video you play starts over when it ends.'],
      ['previews-toggle', '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 'Hover previews: rest the mouse on a video for a silent preview.'],
      ['labels-toggle', '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>', 'Show each file’s name under its tile.'],
      ['sort-toggle', '<path d="M7 4v16M3 16l4 4 4-4M14 6h7M14 12h5M14 18h3"/>', 'Order of files in folders and searches: newest, name, or largest first.'],
      ['quit-app', '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>', 'Stop the Everywhere program. Click twice.']
    ];
    for (const [id, path, title] of SWITCHES) {
      const source = document.getElementById(id);
      if (!source) continue;
      const b = node('button', 'ew-switch'); b.type = 'button'; b.title = title; b.dataset.for = id;
      const ic = node('span', 'ew-switch-icon'); ic.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
      const label = node('span', 'ew-switch-label');
      const paint = () => {
        const text = source.textContent.trim(); label.textContent = text;
        const pressed = source.getAttribute('aria-pressed') ?? (/: on$/.test(text) ? 'true' : /: off$/.test(text) ? 'false' : null);
        if (pressed === null) b.removeAttribute('aria-pressed'); else b.setAttribute('aria-pressed', pressed);
      };
      b.onclick = () => source.click();
      new MutationObserver(paint).observe(source, {childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed']});
      paint(); b.append(ic, label); row.append(b);
    }
    page.append(row);

    page.append(guide('ew-guide-welcome', 'star', 'Welcome to Everywhere', s => {
      p(s, 'Everywhere is a visual wall for voidtools Everything. Search every drive in an instant, browse folders as pictures, and keep collections of the files you come back to. It all runs on this computer: nothing is uploaded, and saving a file to a collection only stores a reference to it.');
      p(s, 'Searching needs the standard Everything app running in the background. Browsing This PC, folders and your collections works without it.');
      p(s, 'Everywhere opens maximized, in a window of Brave, Chrome or Edge. For its own folder icon on the taskbar, install it once as an app: open `http://127.0.0.1:3017` in a normal tab of one of those browsers and click the install button at the right end of the address bar. From then on, Everywhere.exe opens the installed app.');
      h3(s, 'The top bar');
      cards(s, [
        [[], 'Star', 'The star page: your collections. The rectangle beside it shows where {A} saves; click it to switch, add, rename or delete collections.'],
        [[], 'Folder', 'This PC: your drives and their free space. Your usual folders are in the Favorites collection.'],
        [[], 'Diamond', 'Restore: back to the last folder, search or feed you were browsing, at the same scroll position. It keeps one place and remembers it after you quit.'],
        [[], 'Magnifying glass', 'Your search-group feed: files matching any of the terms in the group named beside it.'],
        [[], 'Search', 'Type words and tags, then press {Enter} to search every indexed drive. The dotted bar beside it holds your search terms.'],
        [[], 'Book', 'History: files and folders you opened in this window.'],
        [[], 'Menu', 'This page: preferences and the guide.']
      ]);
    }));

    page.append(guide('ew-guide-tags', 'tag', 'Searching and tags', s => {
      p(s, 'Words find files and folders whose names contain them, on every drive Everything indexes. One hash says what kind of file; two hashes say where to look.');
      h3(s, 'What kind: #');
      p(s, '`#img`, `#video`, `#audio`, `#docs`, `#code`, `#archive` and `#folder`, or exact extensions such as `#png`, `#mp4` or `#7z`. Capitals don’t matter. Tags combine as alternatives, and words narrow them: `holiday #png #mp4` finds PNG pictures or MP4 videos named “holiday”. Put a tag in quotes, such as `"#png"`, to search for the text itself.');
      h3(s, 'Where: ##');
      cards(s, [
        [[], '##photos', 'Inside every folder named “photos”, subfolders included. Several names are alternatives: `##photos ##pictures`.'],
        [[], '##projects/myapps', 'One folder among same-named ones: “myapps” directly inside “projects”. `/` and `\\` both work.'],
        [[], '##c:/users/me', 'An exact place, starting from a drive. `##d:` is the whole drive D:, such as a thumb drive.'],
        [[], '##current', 'The folder you have open (also `##.`). `##current/raw` is a folder inside it.']
      ]);
      p(s, 'Dots are part of names, as in `##.git`. Quote names with spaces: `##"My Photos"`; `##"current"` means a folder really named current. Mix freely: `##photos #img holiday`.');
      h3(s, 'Colors while you type');
      cards(s, [
        [[], 'Blue', 'A tag Everywhere knows, such as `#img` or `#png`.'],
        [[], 'Green', 'A `##` tag that names exactly one folder.'],
        [[], 'Yellow-green', 'A `##` tag that matches several folders. Add the folder above it with a slash to pick one.'],
        [[], 'Red', 'The folder or drive exists, but Everything isn’t indexing it. Point at the search box for how to fix it.'],
        [[], 'White', 'Not recognized yet, or no folder has that name.']
      ]);
      // Show each color name in its own color (the same values as the search box).
      const shades = ['#7fb2ff', '#74d17a', '#c9dc52', '#ff7a7a', '#ddd'];
      s.lastElementChild.querySelectorAll('.pt-hotkeys-card > strong').forEach((title, i) => { title.style.color = shades[i]; });
      p(s, 'Everything indexes NTFS drives by itself. For a thumb drive or another FAT/exFAT drive, add it in Everything: Tools → Options → Folders → Add…');
      tryButton(s, 'Open the full list of tags', () => document.getElementById('search-tags')?.click());
    }));

    page.append(guide('ew-guide-tiles', 'tiles', 'Files on the wall', s => {
      p(s, 'Point the mouse at a tile: different parts of it do different things. Keys are ignored while you type in a box or a pop-up is open.');
      cards(s, [
        [[], 'Top strip', 'Click to browse the folder that contains this item, right here in Everywhere. {Ctrl}-click also opens that folder in Explorer.', 'red'],
        [[], 'The rest', 'Click to open: a folder opens inside Everywhere, a file opens in its program (pictures in IrfanView and videos in PotPlayer, when installed). {Ctrl}-click shows the item in Explorer.', 'gray'],
        [[], 'Current folder', 'While you browse a folder, its own tile comes first. Its top strip goes up one level; at a drive root it returns to This PC.']
      ]);
      h3(s, 'Keys over a tile');
      cards(s, [
        [['A'], 'Save or unsave', 'Adds the item to your active collection; the tile flashes green. Press {A} again to take it out.'],
        [['Space'], 'Preview', 'A quick look at pictures, text and videos, with Save, Explorer and Open buttons.'],
        [['R'], 'Rename', 'Renames the real file or folder. The name is selected without its extension, and an existing item is never overwritten.'],
        [['S'], 'Shuffle', 'Shuffles the tiles on the wall.']
      ]);
      cards(s, [
        [['X', 'X'], 'Remove or recycle', 'In a collection, {X} twice removes only the saved reference. In folders, searches, the search-group feed and History, {X} twice moves the real file or folder to the Windows Recycle Bin. The first {X} marks the tile; {Esc} cancels. Nothing is ever deleted permanently: restore items from the Recycle Bin. Drives and network or removable-drive items are never recycled here.']
      ], true);
      cards(s, [
        [['Ctrl', 'then', 'F'], 'Jump to Search', 'Puts the cursor in the search box from anywhere.'],
        [['Ctrl', 'then', 'Wheel'], 'Zoom', 'Scales the toolbar and the wall together.'],
        [['F11'], 'Fullscreen', 'Gives the whole screen to the wall.']
      ]);
    }));

    page.append(guide('ew-guide-videos', 'video', 'Videos', s => {
      p(s, 'Rest the mouse on a video tile for a moment and it plays silently inside the tile. Click it to play with sound from the start; click again to pause.');
      cards(s, [
        [['Z'], 'Fullscreen', 'For a video playing in its tile. Press {Z} again to leave.'],
        [['+', '−'], 'Volume', 'Up or down in steps of 10%. Everywhere remembers the level.'],
        [['Space'], 'Big player', 'Opens the preview with a large player. Its Open button plays the file in PotPlayer, or your usual video player.']
      ]);
      p(s, 'Formats the browser can’t play (AVI, WMV, FLV, MPG…) get a short silent preview made with FFmpeg, if it’s installed: `winget install Gyan.FFmpeg`, then restart Everywhere. Cloud files that aren’t on this PC are never downloaded for a preview. Loop video and Hover previews are switches at the top of this page.');
    }));

    page.append(guide('ew-guide-lists', 'list', 'Collections and search groups', s => {
      h3(s, 'Collections');
      p(s, 'Click the rectangle beside the star to choose where {A} saves. Inside that list, point at a name: {A} adds a collection, {R} renames it, {X} twice deletes it. The last collection is always kept, and deleting one never touches your files.');
      p(s, 'On the star page, choosing a collection also shows it. While you search or browse, choosing one only changes where {A} saves; your results stay put.');
      h3(s, 'Search groups and terms');
      p(s, 'The dotted interests bar beside Search holds the terms of your active search group, and the magnifying glass shows files matching any of them. Terms can use tags, like `##photos #img`. Click a term to put it in the search box; {Enter} or {Ctrl}-click searches right away. Point at a term or the bar:');
      cards(s, [
        [['A'], 'Add', 'A new term.'],
        [['R'], 'Rename', 'Edit the term under the mouse.'],
        [['I'], 'Edit the list', 'Paste or edit all the terms at once.'],
        [['S'], 'Shuffle', 'Mix the order of the terms.'],
        [['X', 'X'], 'Remove', 'Delete the term under the mouse.']
      ]);
      p(s, 'The rectangle beside the magnifying glass picks the search group, and the same {A}, {R} and {X} {X} keys work in its list.');
    }));

    page.append(guide('ew-guide-places', 'folder', 'This PC and History', s => {
      p(s, 'This PC lists your drives with their free space. Click one to browse it; the up arrow goes to the parent folder. Your common folders are in the Favorites collection.');
      p(s, 'History lists what you opened in this window, so you can find your way back. It lasts while the window is open.');
      tryButton(s, 'Browse This PC', '/?pt_page=files');
      tryButton(s, 'Open History', '/?pt_page=history');
    }));

    page.append(guide('ew-guide-data', 'lock', 'Your data and privacy', s => {
      p(s, 'Everywhere runs only on this computer, at `127.0.0.1:3017`. Your files and previews never leave it.');
      p(s, 'Collections, search groups and preferences are saved in the `data` folder beside Everywhere.exe (`settings.json`, with `settings.bak` kept on every save). Back up that folder to keep them; clearing browser data does not erase them.');
      p(s, 'Everywhere keeps running after you close its window, like Everything itself. Opening it again just opens another window. Quit Everywhere, at the top of this page, stops it.');
    }));

    main.prepend(page);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, {once: true}); else build();
})();
