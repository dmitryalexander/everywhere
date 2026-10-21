/* Interest discovery buttons for the local YouTube app. No background video requests. */
;(() => {
  'use strict';
  window.pinlessControlsVersion = 3;
  const POOL_KEY = 'scratchpad-recommended-searches-v1';
  const normalizeTerms = terms => [...new Set(terms.map(term => term.trim()).filter(Boolean))];
  function shuffled(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  async function start() {
    const header = document.querySelector('.pt-header');
    const form = header && header.querySelector('form.pt-search');
    if (!header || !form || header.querySelector('.pt-interest-bar')) return;
    const input = form.querySelector('input[name="q"]');
    if (!input) return;
    try {
      // No built-in starter terms (removed October 15, 2026): a new install starts with an empty list.
      const defaults = [];
      function loadTerms() {
        try {
          const saved = JSON.parse(window.scratchStorage.getItem(POOL_KEY));
          if (Array.isArray(saved) && saved.every(term => typeof term === 'string')) return normalizeTerms(saved);
        } catch (_) {}
        return [...defaults];
      }
      const LISTS_KEY = 'scratchpad-search-term-lists-v1';
      function readLists() {
        const saved = window.scratchStorage.getItem(LISTS_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (!data.lists?.length || !data.lists.some(l => l.id === data.activeId) || !data.lists.every(l => typeof l.name === 'string' && Array.isArray(l.terms) && l.terms.every(t => typeof t === 'string'))) throw new Error('Invalid term lists');
          return data;
        }
        const data = {activeId:'recommended',lists:[{id:'recommended',name:'Recommended',terms:loadTerms()}]};
        window.scratchStorage.setItem(LISTS_KEY,JSON.stringify(data)); return data;
      }
      let lists = readLists();
      const active = () => lists.lists.find(l => l.id === lists.activeId);
      function saveLists() { window.scratchStorage.setItem(LISTS_KEY,JSON.stringify(lists)); window.scratchStorage.setItem(POOL_KEY,JSON.stringify(active().terms)); }
      function saveTerms(terms) { lists = readLists(); active().terms = terms; saveLists(); }
      let renderLists = () => {};
      let items = active().terms.map(label => ({label}));
      const manager = document.querySelector('#pt-term-manager');
      const WALL_ORDER_KEY = POOL_KEY + '.wall-order-v1';
      let openListEditor = () => {}, allMarked = false;
      const wall = manager && document.createElement('div');
      if (wall) { wall.className = 'pt-term-wall'; manager.append(wall); }
      if (wall) {
        const connectors = document.createElement('div');
        connectors.className = 'pt-term-connectors'; connectors.setAttribute('aria-hidden','true');
        manager.append(connectors);
        let pending;
        function drawRows() {
          cancelAnimationFrame(pending);
          pending = requestAnimationFrame(() => {
            const bounds = manager.getBoundingClientRect(), rows = [];
            for (const tile of wall.querySelectorAll('.pt-term-tile')) {
              const rect = tile.getBoundingClientRect();
              let row = rows.find(row => Math.abs(row.top - rect.top) < 3);
              if (!row) { row = {top:rect.top,left:rect.left,right:rect.right,height:rect.height}; rows.push(row); }
              row.left = Math.min(row.left,rect.left); row.right = Math.max(row.right,rect.right);
            }
            const row = (left,right,center) => { const line = document.createElement('span'); line.className='pt-term-connector';
              Object.assign(line.style,{left:left+'px',width:Math.max(0,right-left)+'px',top:(center-1)+'px'}); return line; };
            const lines = rows.flatMap(r => { const c = r.top-bounds.top+r.height/2; return [row(0,r.left-bounds.left-10,c),row(r.right-bounds.left+10,bounds.width,c)]; });
            // Empty dotted lines continue the rows' rhythm above and below the terms, so the page has no blank bands.
            if (rows.length) {
              rows.sort((a,b) => a.top-b.top);
              const first = rows[0], last = rows[rows.length-1];
              const pitch = Math.max(16, rows.length > 1 ? (last.top-first.top)/(rows.length-1) : first.height+6);
              for (let c = first.top-bounds.top+first.height/2-pitch; c > pitch/2; c -= pitch) lines.push(row(0,bounds.width,c));
              for (let c = last.top-bounds.top+last.height/2+pitch; c < bounds.height-pitch/2; c += pitch) lines.push(row(0,bounds.width,c));
            }
            connectors.replaceChildren(...lines);
          });
        }
        new ResizeObserver(drawRows).observe(wall);
        new MutationObserver(drawRows).observe(wall,{childList:true});
        document.fonts.ready.then(drawRows);
      }
      function renderWall(reshuffle = false) {
        if (!wall) return;
        let saved = [];
        try { saved = JSON.parse(window.scratchStorage.getItem(WALL_ORDER_KEY)) || []; } catch (_) {}
        if (!Array.isArray(saved)) saved = [];
        const labels = items.map(item => item.label);
        const order = reshuffle ? shuffled(labels) : [...new Set([...saved.filter(label => labels.includes(label)), ...labels])];
        try { window.scratchStorage.setItem(WALL_ORDER_KEY, JSON.stringify(order)); } catch (_) {}
        wall.replaceChildren(...order.map(label => {
          const tile = document.createElement('a');
          tile.className = 'pt-term-tile';
          tile.textContent = label;
          tile.href = '/search?q=' + encodeURIComponent(label);
          tile.dataset.term = label;
          if (marked.has(label)) tile.classList.add('recommended-marked');
          return tile;
        }));
        if (!order.length) {
          const empty = document.createElement('p');
          empty.className = 'pt-terms-empty';
          empty.textContent = 'No search terms yet. Press A to add one or I to paste a list.';
          wall.append(empty);
        }
      }
      const bar = document.createElement('nav');
      bar.className = 'pt-interest-bar';
      bar.setAttribute('aria-label', 'Your interests');
      const scroll = document.createElement('div');
      scroll.className = 'pt-interest-scroll';
      scroll.id = 'interest-suggestions';
      scroll.title = 'Click to fill · Ctrl+click to search · X twice to delete · A to add · R to rename · I to paste a list · S to shuffle';
      const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
      let frame = 0;
      let drag = null;
      let suppressClick = false;
      const stopMomentum = () => { cancelAnimationFrame(frame); frame = 0; };
      function momentum(velocity) {
        if (reducedMotion()) return;
        let previous = performance.now();
        function tick(now) {
          const elapsed = Math.min(32, now - previous);
          previous = now;
          const before = scroll.scrollLeft;
          scroll.scrollLeft += velocity * elapsed;
          velocity *= Math.pow(.94, elapsed / 16.67);
          if (Math.abs(velocity) > .02 && Math.abs(scroll.scrollLeft - before) > .1) frame = requestAnimationFrame(tick);
          else frame = 0;
        }
        frame = requestAnimationFrame(tick);
      }

      // Hover shortcuts share the full-list editor's storage, including cross-tab updates.
      const marked = new Set();
      let hovered = null, overBar = false, pointer = null;
      // Hit-test at keydown: deleting, scrolling or shuffling can move a new chip
      // beneath a stationary mouse without a new pointerover event.
      document.addEventListener('pointermove', event => {if (event.pointerType === 'mouse') pointer = {x:event.clientX,y:event.clientY};}, {passive:true});
      document.documentElement.addEventListener('pointerleave', () => {pointer = null;});
      window.addEventListener('blur', () => {pointer = null; hovered = null; overBar = false;});
      const quick = document.createElement('dialog');
      quick.className = 'recommended-quick-add';
      quick.innerHTML = '<form><label>Add a recommended search<input name="term" required maxlength="300" autocomplete="off"></label><p role="status"></p><button type="submit">Save</button><button type="button">Cancel</button></form>';
      document.body.append(quick);
      const quickInput = quick.querySelector('input');
      const quickStatus = quick.querySelector('[role="status"]');
      const renameTerm = document.createElement('dialog');renameTerm.className='recommended-quick-add';renameTerm.id='term-rename';
      renameTerm.innerHTML='<form><label>Rename search term<input name="term" required maxlength="300" autocomplete="off"></label><p role="status"></p><button type="submit">Rename</button><button type="button">Cancel</button></form>';
      document.body.append(renameTerm);const renameInput=renameTerm.querySelector('input'),renameStatus=renameTerm.querySelector('[role="status"]');let originalTerm='';
      renameTerm.querySelector('[type="button"]').onclick=()=>renameTerm.close();
      renameTerm.querySelector('form').onsubmit=event=>{event.preventDefault();const next=renameInput.value.trim();if(!next)return;if(items.some(item=>item.label!==originalTerm&&item.label.toLowerCase()===next.toLowerCase())){renameStatus.textContent='That search term already exists.';return;}if(!saveQuick(items.map(item=>item.label===originalTerm?next:item.label))){renameStatus.textContent='Could not save this term.';return;}try{const order=JSON.parse(window.scratchStorage.getItem(ORDER_KEY)||'[]');window.scratchStorage.setItem(ORDER_KEY,JSON.stringify(order.map(label=>label===originalTerm?next:label)));}catch{}if(input.value===originalTerm)input.value=next;cancelMarks();render();renameTerm.close();};
      quick.querySelector('[type="button"]').onclick = () => quick.close();
      function saveQuick(labels) {
        try {saveTerms(labels);}
        catch (_) {quickStatus.textContent = 'Could not save. Check browser storage and try again.'; if (!quick.open) quick.showModal(); return false;}
        items = labels.map(label => typeof toItem === 'function' ? toItem(label) : ({label}));
        orderedItems();
        return true;
      }
      quick.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const label = quickInput.value.trim();
        if (!label) return;
        const existing = items.find(item => item.label.toLowerCase() === label.toLowerCase());
        if (!saveQuick(existing ? items.map(item => item.label) : [...items.map(item => item.label), label])) return;
        render();
        const added = [...scroll.children].find(el => el.textContent === (existing?.label || label));
        added?.scrollIntoView({block:'nearest', inline:'nearest'});
        quick.close(); added?.focus({preventScroll:true});
      });
      bar.addEventListener('pointerenter', () => {overBar = true;});
      bar.addEventListener('pointerleave', () => {overBar = false; hovered = null;});
      scroll.addEventListener('pointerover', event => {hovered = event.target.closest('.interest-chip, .pt-interest-chip');});
      scroll.addEventListener('pointerout', event => {if (!event.relatedTarget || !hovered?.contains(event.relatedTarget)) hovered = null;});
      function cancelMarks() {
        marked.clear(); allMarked = false;
        document.body.classList.remove('pt-terms-clear-armed');
        document.querySelectorAll('.recommended-marked').forEach(el => el.classList.remove('recommended-marked'));
        if (manager) manager.querySelector('[role="status"]').textContent = '';
      }
      window.addEventListener('blur', cancelMarks);
      document.addEventListener('keydown', event => {
        const key = event.key.toLowerCase();
        if (key === 'escape') { cancelMarks(); return; }
        if (event.defaultPrevented || event.repeat || event.altKey || event.metaKey || event.isComposing) return;
        if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') || document.querySelector('dialog[open]')) return;
        const underPointer = pointer && document.elementFromPoint(pointer.x, pointer.y);
        overBar = !!underPointer && bar.contains(underPointer);
        const overWall = !!manager && (!underPointer || !header.contains(underPointer));
        if (!(overBar || overWall)) return;
        hovered = underPointer?.closest('.pt-interest-chip,.pt-term-tile');
        if (event.ctrlKey) {
          if (key !== 'x' || !event.shiftKey) return;
          event.preventDefault();
          if (!allMarked) {
            allMarked = true;
            document.body.classList.add('pt-terms-clear-armed');
            if (manager) manager.querySelector('[role="status"]').textContent = 'Press Ctrl+Shift+X again to delete all terms · Esc to cancel';
          } else if (saveQuick([])) { cancelMarks(); render(); }
          return;
        }
        if (key === 'a') {
          event.preventDefault(); cancelMarks(); quickInput.value = ''; quickStatus.textContent = ''; quick.showModal(); quickInput.focus();
        } else if (key === 'i') {
          event.preventDefault(); cancelMarks(); openListEditor();
        } else if (key === 'r' && hovered?.isConnected) {
          event.preventDefault();stopMomentum();originalTerm=hovered.dataset.term||hovered.textContent;renameInput.value=originalTerm;renameStatus.textContent='';renameTerm.showModal();renameInput.focus();renameInput.select();
        } else if (key === 'x' && hovered?.isConnected) {
          event.preventDefault(); stopMomentum();
          const label = hovered.dataset.term || hovered.textContent;
          if (!marked.has(label)) {marked.add(label); hovered.classList.add('recommended-marked'); hovered.setAttribute('aria-label', label + ' — press X again to delete');}
          else if (saveQuick(items.filter(item => item.label !== label).map(item => item.label))) {marked.delete(label); render();}
        }
      });
      const shortcutStyle = document.createElement('style');
      shortcutStyle.textContent = '.interest-bar,.pt-interest-bar,.interest-scroll,.pt-interest-scroll{min-height:28px}.interest-chip>span,.pt-interest-chip>span{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;pointer-events:none}.recommended-marked{background:#762e38!important;color:#fff!important;border-color:#e87080!important}.recommended-marked>span{animation:recommended-shake .22s ease-in-out 2}@keyframes recommended-shake{25%{transform:translateX(-2px) rotate(-1deg)}75%{transform:translateX(2px) rotate(1deg)}}.recommended-quick-add{background:#202020;color:#eee;border:1px solid #666;border-radius:12px;padding:24px;max-width:90vw}.recommended-quick-add::backdrop{background:#0009}.recommended-quick-add input{display:block;width:300px;max-width:70vw;margin:12px 0;padding:10px;background:#121212;color:#fff;border:1px solid #777}.recommended-quick-add button{padding:8px 16px;margin-right:8px}@media(prefers-reduced-motion:reduce){.recommended-marked>span{animation:none}}';
      document.head.append(shortcutStyle);


      // Persist the displayed order separately from the editable list. Navigation,
      // additions and deletions must never randomly rearrange surviving terms.
      const ORDER_KEY = POOL_KEY + '.order-v1';
      const POSITION_KEY = POOL_KEY + '.position-v1';
      let rendered = false;
      function orderedItems(reshuffle = false) {
        let saved = null;
        try {saved = JSON.parse(window.scratchStorage.getItem(ORDER_KEY));} catch (_) {}
        const available = new Map(items.map(item => [item.label, item]));
        const order = [];
        if (!reshuffle && Array.isArray(saved)) {
          for (const label of saved) {if (available.has(label)) {order.push(available.get(label)); available.delete(label);}}
          order.push(...available.values());
        } else order.push(...shuffled([...available.values()]));
        const serialized = JSON.stringify(order.map(item => item.label));
        try {if (window.scratchStorage.getItem(ORDER_KEY) !== serialized) window.scratchStorage.setItem(ORDER_KEY, serialized);} catch (_) {}
        return order;
      }
      function savedPosition() {
        try {const value = Number(sessionStorage.getItem(POSITION_KEY)); return Number.isFinite(value) ? Math.max(0, value) : 0;} catch (_) {return 0;}
      }
      function rememberPosition() {
        try {sessionStorage.setItem(POSITION_KEY, String(scroll.scrollLeft));} catch (_) {}
      }
      scroll.addEventListener('scroll', rememberPosition, {passive:true});
      window.addEventListener('pagehide', rememberPosition);

      function render(reshuffle = false) {
        const position = reshuffle ? 0 : rendered ? scroll.scrollLeft : savedPosition();
        hovered = null;
        stopMomentum();
        const hadFocus = scroll.contains(document.activeElement);
        const order = orderedItems(reshuffle);
        const fragment = document.createDocumentFragment();
        for (const item of order) {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'pt-interest-chip';
          const chipLabel = document.createElement('span'); chipLabel.textContent = item.label; link.append(chipLabel);
          if (marked.has(item.label)) link.classList.add('recommended-marked');
          link.title = item.label;
          link.addEventListener('click', event => {
            input.value = item.label;
            input.dispatchEvent(new Event('input', {bubbles:true}));
            input.focus();
            if (event.ctrlKey) {event.preventDefault(); form.requestSubmit();}
          });
          fragment.append(link);
        }
        scroll.replaceChildren(fragment);
        renderWall();
        renderLists();
        scroll.scrollLeft = position;
        rendered = true;
        rememberPosition();
        if (hadFocus) (scroll.firstElementChild || input).focus({preventScroll:true});
      }
      document.addEventListener('keydown', event => {
        if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
        if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
        if (document.querySelector('dialog[open]')) return;
        const target = pointer && document.elementFromPoint(pointer.x, pointer.y);
        if (event.key.toLowerCase() !== 's' || !target) return;
        if (bar.contains(target)) {event.preventDefault(); cancelMarks(); render(true);}
        else if (manager && !header.contains(target)) {event.preventDefault(); cancelMarks(); renderWall(true);} 
      });
      scroll.addEventListener('pointerdown', event => {
        stopMomentum();
        // Touch uses the browser's native scrolling and momentum.
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        suppressClick = false;
        drag = {id:event.pointerId, start:event.clientX, x:event.clientX, left:scroll.scrollLeft, time:performance.now(), velocity:0, moved:false};
      });
      scroll.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return;
        if (!drag.moved && Math.abs(event.clientX - drag.start) < 5) return;
        if (!drag.moved) {
          drag.moved = true;
          scroll.setPointerCapture(event.pointerId);
          scroll.classList.add('is-dragging');
        }
        event.preventDefault();
        const now = performance.now();
        drag.velocity = Math.max(-3, Math.min(3, (drag.x - event.clientX) / Math.max(1, now - drag.time)));
        drag.x = event.clientX;
        drag.time = now;
        scroll.scrollLeft = drag.left + drag.start - event.clientX;
      });
      function finishDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        const finished = drag;
        drag = null;
        scroll.classList.remove('is-dragging');
        if (scroll.hasPointerCapture(event.pointerId)) scroll.releasePointerCapture(event.pointerId);
        if (finished.moved) {
          suppressClick = true;
          setTimeout(() => {suppressClick = false;}, 0);
          if (event.type === 'pointerup' && performance.now() - finished.time < 80) momentum(finished.velocity);
        }
      }
      window.addEventListener('pointerup', finishDrag);
      window.addEventListener('pointercancel', finishDrag);
      scroll.addEventListener('lostpointercapture', finishDrag);
      scroll.addEventListener('click', event => {
        if (suppressClick) {event.preventDefault(); event.stopImmediatePropagation();}
      }, true);
      scroll.addEventListener('wheel', event => {
        stopMomentum();
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.ctrlKey) return;
        const atStart = scroll.scrollLeft <= 0;
        const atEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 2;
        if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return;
        event.preventDefault();
        scroll.scrollLeft += event.deltaY;
      }, {passive:false});
      scroll.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          stopMomentum();
          const links = [...scroll.children];
          const index = links.indexOf(document.activeElement);
          const target = links[index + direction];
          if (target) {event.preventDefault(); target.focus();}
        }
      });
      bar.append(scroll);
      form.after(bar);
      // Search groups (2026-10-10): the magnifying glass opens the current group's feed, and the
      // name beside it is a dropdown like the playlist picker (A new, R rename, X twice delete).
      const GROUP_FEED = '/?pt_page=discover';
      const onGroupFeed = new URLSearchParams(location.search).get('pt_page') === 'discover';
      const groups = document.createElement('div'); groups.className = 'pt-groups';
      const groupFeed = document.createElement('a'); groupFeed.className = 'pt-circle pt-discover-link pt-group-feed'; groupFeed.href = GROUP_FEED;
      groupFeed.title = 'Discover'; groupFeed.setAttribute('aria-label', 'Discover');
      groupFeed.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></svg>';
      if (onGroupFeed) groupFeed.setAttribute('aria-current', 'page');
      const groupLabel = document.createElement('span'); groupLabel.className = 'pt-active-group';
      groups.append(groupFeed, groupLabel); form.before(groups); // Order (2026-10-11): magnifier, group name, search bar, then the search terms.
      let shownGroup = lists.activeId;
      function updateGroupLabel() {
        const group = active(); if (!group) return;
        groupLabel.textContent = group.name;
        groupLabel.title = 'Search group: ' + group.name + ' · click to change · A for a new group';
      }
      function refreshGroup() {
        try { lists = readLists(); } catch (_) { return; }
        // The feed is built from one group, so switching groups on the feed reloads it.
        if (onGroupFeed && lists.activeId !== shownGroup) { window.scratchNavigate(GROUP_FEED); return; }
        shownGroup = lists.activeId;
        cancelMarks(); items = active().terms.map(label => ({label})); render(); updateGroupLabel();
      }
      updateGroupLabel();
      if (typeof window.ptMenuPicker === 'function') window.ptMenuPicker(groupLabel, {
        here: onGroupFeed, menuClass: 'pt-group-picker', noun: 'search group', nouns: 'search groups', menuLabel: 'Choose a search group',
        blank: () => ({terms: []}),
        read: () => readLists(),
        save: data => {
          try {
            const group = data.lists.find(l => l.id === data.activeId);
            window.scratchStorage.setItem(LISTS_KEY, JSON.stringify(data));
            window.scratchStorage.setItem(POOL_KEY, JSON.stringify(group ? group.terms : []));
            return true;
          } catch (_) { return false; }
        },
        refresh: refreshGroup,
        select: id => {
          try { const data = readLists(); if (!data.lists.some(l => l.id === id)) return; data.activeId = id; lists = data; saveLists(); }
          catch (_) { return; }
          refreshGroup();
        }
      });
      header.classList.add('pt-interest-header');
      input.placeholder = input.dataset.channelName || 'Search';
      render();
      const menu = header.querySelector('.pt-menu');
      const panel = document.querySelector('.quiet-menu-panel');
      if (panel) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'pt-menu-item';
        edit.textContent = 'Edit search terms';
        const dialog = document.createElement('dialog');
        dialog.className = 'pt-interest-editor';
        dialog.setAttribute('aria-labelledby', 'pt-interest-editor-title');
        dialog.innerHTML = '<form><h2 id="pt-interest-editor-title">Search terms</h2><p>Add, edit or remove terms below. Paste a list with one search term per line. Saved locally on this computer.</p><label>Import mode <select class="pt-import-mode"><option value="add">Add to current list</option><option value="replace">Replace current list</option></select></label><label for="pt-interest-terms">Search terms</label><textarea id="pt-interest-terms" spellcheck="false"></textarea><p class="pt-interest-count" aria-live="polite"></p><p class="pt-interest-error" role="alert" hidden></p><div class="pt-interest-editor-actions"><span></span><button type="button" class="pt-interest-cancel">Cancel</button><button type="submit" class="pt-interest-save">Save</button></div></form>';
        document.body.append(dialog);
        const editor = dialog.querySelector('textarea');
        dialog.querySelector('.pt-import-mode').closest('label').hidden = true; // The box holds the whole list, so there is nothing to choose.
        const error = dialog.querySelector('.pt-interest-error');
        const count = dialog.querySelector('.pt-interest-count');
        const readEditor = () => normalizeTerms(editor.value.split(/\r?\n/));
        function updateCount() {
          const total = readEditor().length;
          count.textContent = total + ' search terms · Blank lines and duplicates are removed on save.';
        }
        editor.addEventListener('input', updateCount);
        // M > Edit ... and the S circle open the same editor; focus returns to whichever opened it.
        let opener = null;
        function openEditor(trigger) {
          opener = trigger;
          menu.open = false;
          // The box opens with the group's current terms (2026-10-10), so editing it replaces the list:
          // delete a line to remove a term, paste or type new lines at the end to add more.
          const current = items.map(item => item.label);
          editor.value = current.length ? current.join('\n') + '\n' : '';
          dialog.querySelector('.pt-import-mode').value = 'replace';
          error.hidden = true;
          updateCount();
          dialog.showModal();
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
          editor.scrollTop = editor.scrollHeight;
        }
        openListEditor = () => openEditor(document.activeElement);
        window.scratchEditTerms = openEditor;
        if (new URLSearchParams(location.search).get('pt_page') === 'terms') openEditor(header.querySelector('.pt-menu > summary'));
        edit.addEventListener('click', () => openEditor(edit));
        dialog.querySelector('.pt-interest-cancel').addEventListener('click', () => dialog.close());
        dialog.querySelector('form').addEventListener('submit', event => {
          event.preventDefault();
          const terms = normalizeTerms([...(dialog.querySelector('.pt-import-mode').value === 'add' ? items.map(item => item.label) : []), ...readEditor()]);
          try { saveTerms(terms); }
          catch (_) {
            error.textContent = 'Could not save the list. Check that browser storage is available, then try again.';
            error.hidden = false;
            return;
          }
          items = terms.map(label => ({label}));
          render();
          dialog.close();
        });
        dialog.addEventListener('close', () => (opener && opener.isConnected ? opener : header.querySelector('.pt-menu > summary')).focus());
        addEventListener('storage', event => {
          if (event.key === LISTS_KEY || event.key === POOL_KEY || event.key === ORDER_KEY || event.key === WALL_ORDER_KEY || event.key === null) {
            lists = readLists();
            items = active().terms.map(label => ({label}));
            cancelMarks(); render(); updateGroupLabel(); shownGroup = lists.activeId;
          }
        });
      }
    } catch (error) {console.error('[interest-bar]', error);}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
