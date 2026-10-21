(() => {
  'use strict';
  const menu = document.querySelector('.pt-menu');
  const button = document.createElement('button');
  button.id = 'search-tags'; button.textContent = 'Search tags';
  document.querySelector('#term-editor').before(button);
  const guide = document.createElement('dialog');
  guide.id = 'tag-guide'; guide.setAttribute('aria-labelledby', 'tag-guide-title');
  guide.innerHTML = `<header><h2 id="tag-guide-title">Search tags</h2><button type="button" aria-label="Close search tags">×</button></header>
    <div class="tag-guide-body"><p>Use hashtags in the search box to choose file types or extensions. Tags ignore capitalization: <code>#pictures</code>, <code>#img</code>, <code>#imgs</code>, <code>#Images</code> and <code>#IMAGES</code> all find images.</p>
    <p>Combine type and extension tags to include <strong>any</strong> of them. Add words to narrow every selected type. <code>holiday #png #mp4</code> finds PNG images or MP4 videos whose names match “holiday”.</p>
    <p><strong>Two hashes say where to look.</strong> <code>##photos</code> searches inside every folder named “photos” on all indexed drives, subfolders included. Combine it with tags: <code>##photos #img</code> finds pictures in all your photos folders. Several folder names are alternatives: <code>##photos ##pictures</code>. Quote names with spaces: <code>##"My Photos"</code>.</p>
    <p><strong>Slashes pick one folder.</strong> When several folders share a name, add the folders above it: <code>##projects/myapps</code> is a “myapps” folder directly inside a “projects” folder (<code>/</code> and <code>\\</code> both work). Start with a drive to give the exact place: <code>##c:/users/me</code>. <code>##current</code> (or <code>##.</code>) is the folder you have open, and <code>##current/raw</code> a folder inside it. Dots are part of names: <code>##.git</code>, <code>##v1.2</code>. For a folder really named current, use quotes: <code>##"current"</code>.</p>
    <p>Extension tags are exact: <code>#doc</code> finds .doc files; <code>#docs</code> finds all document types. Use spaces between tags. Unknown tags remain search text; put a tag in quotes, such as <code>"#png"</code>, to search for that literal text.</p>
    <label for="tag-options-filter">Find a tag or type</label><input id="tag-options-filter" type="search" placeholder="Try pictures, mp4, documents…" autocomplete="off">
    <p class="tag-hint">Click a tag to add it to your search, then press Enter in the search box.</p>
    <p id="tag-options-status" role="status">Loading tags…</p><div id="tag-options"></div></div>`;
  document.body.append(guide);
  guide.querySelector('header button').onclick = () => guide.close();
  const filter = guide.querySelector('input');
  const status = guide.querySelector('#tag-options-status');
  const options = guide.querySelector('#tag-options');
  let groups = null;
  function render() {
    options.replaceChildren();
    const needle = filter.value.trim().replace(/^#/, '').toLowerCase();
    let count = 0;
    for (const group of groups || []) {
      const tags = group.name.toLowerCase().includes(needle) ? group.tags : group.tags.filter(tag => tag.includes(needle));
      if (!tags.length) continue;
      const section = document.createElement('section');
      const heading = document.createElement('h3'); heading.textContent = group.name;
      const row = document.createElement('div'); row.className = 'tag-options-row';
      for (const tag of tags) {
        const chip = document.createElement('button'); chip.type = 'button'; chip.textContent = '#' + tag;
        chip.title = 'Add #' + tag + ' to search';
        chip.onclick = () => {
          const search = document.querySelector('#search');
          if (!search.value.split(/\s+/).some(token => token.toLowerCase() === '#' + tag)) {
            search.value = [search.value.trim(), '#' + tag].filter(Boolean).join(' ');
            search.dispatchEvent(new Event('input', { bubbles: true }));
          }
          guide.close(); search.focus(); search.setSelectionRange(search.value.length, search.value.length);
        };
        row.append(chip); count++;
      }
      section.append(heading, row); options.append(section);
    }
    status.textContent = count ? `${count} options · any capitalization works` : 'No matching tags. Try a file type or extension.';
  }
  filter.addEventListener('input', render);
  button.onclick = async () => {
    menu.open = false; filter.value = ''; guide.showModal(); filter.focus();
    if (groups) { render(); return; }
    try {
      const data = await window.scratchApi('search_tags');
      groups = [...data.groups, { name: 'File extensions (exact)', tags: data.extensions }];
      render();
    } catch (error) { status.textContent = 'Could not load tags: ' + error.message; }
  };
})();
