// Adapted from your installed Pinless playlist picker.
const $=(s,r=document)=>r.querySelector(s);
function playlistPicker(label, opts) {
    // Search groups pass noun, nouns, menuLabel and blank(); the playlists use the defaults.
    const NOUN = opts.noun || 'playlist', NOUNS = opts.nouns || 'playlists', MENU = opts.menuLabel || 'Save to playlist';
    const blank = opts.blank || (() => ({items: []}));
    if (!label || label.dataset.picker) return;
    if (opts.here) label.classList.add('pt-playlist-here');
    label.dataset.picker = '1';
    label.setAttribute('role', 'button'); label.tabIndex = 0;
    label.setAttribute('aria-haspopup', 'menu'); label.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'pt-playlist-picker'; if (opts.menuClass) menu.classList.add(opts.menuClass); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', MENU); menu.hidden = true;
    const hint = document.createElement('p'); hint.className = 'pt-picker-hint'; hint.setAttribute('role', 'status');
    document.body.append(menu);
    const HINT = '', EDIT_HINT = '', MOVE_HINT = 'Pick a playlist to move the pin to';
    let hovered = null, inMenu = false, overLabel = false, movedSinceOpen = false, armed = null, armTimer = 0, noteTimer = 0, editing = null;
    const moving = () => opts.move ? opts.move() : null;
    const items = () => [...menu.querySelectorAll('button[data-list-id]')];
    const baseHint = () => editing ? EDIT_HINT : moving() ? MOVE_HINT : HINT;
    function showHint(text, warn) {
      clearTimeout(noteTimer); hint.textContent = text || baseHint(); hint.classList.toggle('pt-picker-warn', !!warn);
      if (warn) noteTimer = setTimeout(() => showHint(), 2600);
    }
    function disarm() {
      clearTimeout(armTimer);
      if (!armed) return;
      armed.classList.remove('pt-list-delete-armed'); armed = null; showHint();
    }
    function close(focusLabel, quiet) {
      if (menu.hidden) return;
      menu.hidden = true; label.setAttribute('aria-expanded', 'false');
      clearTimeout(armTimer); armed = null; editing = null; hovered = null; inMenu = false;
      removeEventListener('keydown', keys, true);
      if (!quiet) label.dispatchEvent(new CustomEvent('pt-picker-close'));
      if (focusLabel) label.focus({preventScroll: true});
    }
    function render(focusId) {
      let data; try { data = opts.read(); } catch (_) { return false; }
      clearTimeout(armTimer); armed = null; editing = null; hovered = null;
      menu.classList.toggle('pt-move-targets', !!moving());
      menu.setAttribute('aria-label', moving() ? 'Move pin to playlist' : MENU);
      menu.replaceChildren(...data.lists.map(list => {
        const item = document.createElement('button'); item.type = 'button'; item.dataset.listId = list.id;
        item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(list.id === data.activeId));
        const name = document.createElement('span'); name.className = 'pt-picker-name'; name.textContent = list.name;
        item.append(name); item.title = list.name;
        item.addEventListener('click', event => {
          event.stopPropagation();
          const move = moving();
          if (move) { move(list.id); close(true); return; }
          close(true);
          if (list.id !== data.activeId || opts.selectCurrent) opts.select(list.id);
        });
        return item;
      }), hint);
      showHint();
      const focus = (focusId && items().find(item => item.dataset.listId === focusId)) || menu.querySelector('[aria-checked="true"]') || items()[0];
      focus?.focus({preventScroll: true}); focus?.scrollIntoView({block: 'nearest'});
      return true;
    }
    function position() {
      const box = label.getBoundingClientRect();
      menu.style.top = Math.round(box.bottom + 6) + 'px';
      menu.style.left = Math.round(Math.max(8, Math.min(box.left, innerWidth - menu.offsetWidth - 8))) + 'px';
    }
    function open() {
      if (!menu.hidden) { render(); return; }
      menu.hidden = false;
      if (!render()) { menu.hidden = true; return; }
      label.setAttribute('aria-expanded', 'true'); movedSinceOpen = false;
      position();
      addEventListener('keydown', keys, true);
    }
    function startEdit(list) {
      if (menu.hidden) open();
      if (editing) render();
      disarm();
      const row = document.createElement('div'); row.className = 'pt-picker-edit';
      const input = document.createElement('input'); input.maxLength = 80; input.autocomplete = 'off'; input.spellcheck = false;
      input.placeholder = list ? 'Rename ' + NOUN : 'New ' + NOUN + ' name'; input.setAttribute('aria-label', input.placeholder);
      input.value = list ? list.name : '';
      row.append(input);
      const at = list && items().find(item => item.dataset.listId === list.id);
      if (at) at.replaceWith(row); else menu.insertBefore(row, hint);
      editing = {id: list ? list.id : null, input};
      showHint();
      input.focus({preventScroll: true}); input.select(); row.scrollIntoView({block: 'nearest'});
      // Clicking elsewhere in the menu abandons the edit.
      input.addEventListener('blur', () => setTimeout(() => { if (editing && editing.input === input && !menu.hidden && document.activeElement !== input) render(editing.id); }, 0));
    }
    function commitEdit() {
      const {id, input} = editing, name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { input.focus(); return; }
      try {
        const data = opts.read();
        if (data.lists.some(list => list.id !== id && list.name.toLowerCase() === name.toLowerCase())) { showHint('A ' + NOUN + ' with that name already exists.', true); return; }
        let focusId = id;
        if (id) { const list = data.lists.find(list => list.id === id); if (!list) throw new Error('Playlist unavailable'); list.name = name; }
        else { focusId = crypto.randomUUID(); data.lists.push({id: focusId, name, ...blank()}); data.activeId = focusId; }
        if (!opts.save(data)) { showHint('Could not save. Check browser storage and try again.', true); return; }
        render(focusId); opts.refresh();
      } catch (_) { showHint('Could not save. Check browser storage and try again.', true); }
    }
    function remove(item) {
      const id = item.dataset.listId;
      let data; try { data = opts.read(); } catch (_) { showHint('Could not read ' + NOUNS + '. Check browser storage.', true); return; }
      const index = data.lists.findIndex(list => list.id === id);
      if (index < 0) { render(); return; }
      if (data.lists.length < 2) { disarm(); showHint('The last ' + NOUN + ' can’t be deleted.', true); return; }
      if (armed !== item) {
        disarm(); armed = item; item.classList.add('pt-list-delete-armed');
        showHint('Press X again to delete “' + data.lists[index].name + '”', true);
        clearTimeout(noteTimer); armTimer = setTimeout(disarm, 4000); return;
      }
      data.lists.splice(index, 1);
      const next = data.lists[Math.min(index, data.lists.length - 1)].id;
      if (data.activeId === id) data.activeId = next;
      if (!opts.save(data)) { disarm(); showHint('Could not delete. Check browser storage and try again.', true); return; }
      render(next); opts.refresh();
    }
    // While open, the menu owns the keyboard so page shortcuts (A, S, X...) never fire behind it,
    // unless the pointer has moved off to the page: then the key goes to whatever it points at.
    function keys(event) {
      if (editing && document.activeElement === editing.input) {
        if (event.key === 'Enter') { event.preventDefault(); commitEdit(); }
        else if (event.key === 'Escape') { event.preventDefault(); render(editing.id); }
        event.stopPropagation(); event.stopImmediatePropagation(); return;
      }
      const key = event.key.toLowerCase(), list = items(), at = list.indexOf(document.activeElement);
      const letter = /^[a-z]$/.test(key);
      if (letter && movedSinceOpen && !inMenu && !overLabel) { close(false, true); return; }
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing && !event.repeat;
      const target = (inMenu && hovered && hovered.isConnected) ? hovered : (at >= 0 ? list[at] : null);
      const free = !moving();
      if (event.key === 'Escape') { event.preventDefault(); if (armed) disarm(); else close(true); }
      else if (event.key === 'Tab') close(false);
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); disarm();
        list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); disarm(); list[event.key === 'Home' ? 0 : list.length - 1]?.focus(); }
      else if (plain && key === 'a' && free) { event.preventDefault(); startEdit(null); }
      else if (plain && key === 'r' && target && free) {
        event.preventDefault();
        try { startEdit(opts.read().lists.find(item => item.id === target.dataset.listId)); } catch (_) {}
      }
      else if (plain && key === 'x' && target && free) { event.preventDefault(); remove(target); }
      else if (key !== 'x') disarm();
      event.stopPropagation(); event.stopImmediatePropagation();
    }
    menu.addEventListener('pointermove', event => {
      inMenu = true;
      const item = event.target.closest('button[data-list-id]');
      if (item !== hovered) { if (armed && item !== armed) disarm(); hovered = item; }
    }, {passive: true});
    menu.addEventListener('pointerleave', () => { inMenu = false; hovered = null; disarm(); });
    label.addEventListener('pointerenter', () => { overLabel = true; });
    label.addEventListener('pointerleave', () => { overLabel = false; });
    document.addEventListener('pointermove', () => { if (!menu.hidden) movedSinceOpen = true; }, {passive: true});
    label.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); menu.hidden ? open() : close(true); });
    label.addEventListener('keydown', event => {
      if (!['Enter', ' ', 'ArrowDown'].includes(event.key) || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault(); event.stopPropagation(); open();
    });
    // A while pointing at the closed playlist name: new playlist.
    addEventListener('keydown', event => {
      if (!menu.hidden || !overLabel || event.key.toLowerCase() !== 'a' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
      if (event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || document.querySelector('dialog[open]:not(.pn-inline-following)')) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      startEdit(null);
    }, true);
    label.addEventListener('pt-picker-open', () => open());
    label.addEventListener('pt-picker-hide', () => close(false, true));
    document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target) && !label.contains(event.target)) close(false); }, true);
    addEventListener('resize', () => close(false));
    addEventListener('scroll', () => { if (menu.hidden) return; if (label.getBoundingClientRect().bottom < 0) close(false); else position(); }, {passive: true});
    addEventListener('blur', () => close(false));
  }
window.ptMenuPicker=playlistPicker;
