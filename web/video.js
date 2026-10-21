/* Everywhere videos (October 14, 2026): local videos play inside the wall, like the YouTube and Pinless apps.
   Rest the mouse on the gray part of a video tile for a third of a second and it plays silently inside the
   tile from about 15% in; moving away stops it. Click the gray part to play it with sound from the start;
   click again to pause. Formats Brave can't play (AVI, WMV, FLV, MPG...) get a short silent preview made by
   FFmpeg, and clicking them opens the file itself in PotPlayer. Menu > Hover previews turns previews off. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  // Media uses localhost while the RPC calls use 127.0.0.1: the browser keeps separate connections for each,
  // so a playing video never makes thumbnails or searches wait.
  const HOST = '';
  const DELAY = 333;
  const PREF = 'scratchpad-hover-previews';
  const VOLUME = 'scratchpad-video-volume';
  const LOOP = 'scratchpad-loop-video';
  function loopWanted() {
    try { return window.scratchStorage?.getItem(LOOP) === 'on'; } catch { return false; }
  }
  function applyLoop() {
    if (manual?.video) manual.video.loop = loopWanted();
    if (dialogVideo && !dialogVideo.defaultMuted) dialogVideo.loop = loopWanted();
  }
  // Containers Brave never plays: these go straight to the FFmpeg preview, and a click opens PotPlayer.
  const FOREIGN = /\.(avi|wmv|asf|flv|mpe?g|mpe|mpv|vob|mts|m2ts|3gp|3g2)$/i;
  let ctx = null, hover = null, manual = null, pending = null, timer = 0, dialogVideo = null, warned = false, noteTimer = 0;
  const convert = new Set();   // files Brave turned out not to play, this session
  const noPreview = new Set(); // files FFmpeg could not convert, this session

  const isVideo = e => !!e && !e.isDir && e.kind === 'Videos';
  const foreign = e => FOREIGN.test(e.path) || convert.has(e.path);
  const url = (kind, e) => HOST + '/' + kind + '?' + new URLSearchParams({ t: ctx.session(), path: e.path });
  const previewStart = length => (length >= 8 ? Math.min(length * 0.15, 60) : 0);
  const tileOf = card => $('.file-tile', card);
  const live = state => !!state && (state.manual ? manual : hover) === state;

  function wanted() {
    try { return window.scratchStorage?.getItem(PREF) !== 'off'; } catch { return true; }
  }
  function savedVolume() {
    try {
      const raw = window.scratchStorage?.getItem(VOLUME), level = Number(raw);
      return raw != null && level >= 0 && level <= 1 ? level : 1;
    } catch { return 1; }
  }

  // Pause symbol while waiting (and while paused); spinning ring while loading.
  function showLoader(tile, waiting) {
    if (!tile) return;
    let loader = $('.sp-video-loader', tile);
    if (!loader) {
      loader = document.createElement('span');
      loader.className = 'sp-video-loader';
      loader.setAttribute('role', 'status');
      tile.append(loader);
      tile.setAttribute('aria-busy', 'true');
    }
    loader.classList.toggle('sp-video-wait', !!waiting);
    loader.setAttribute('aria-label', waiting ? 'Paused' : 'Loading video');
  }
  function hideLoader(tile) {
    if (!tile) return;
    $('.sp-video-loader', tile)?.remove();
    tile.removeAttribute('aria-busy');
  }

  function makeVideo(manualPlay) {
    const video = document.createElement('video');
    video.className = 'sp-video' + (manualPlay ? ' sp-video-manual' : '');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.preload = 'auto';
    video.loop = !manualPlay || loopWanted();
    video.controls = manualPlay;
    video.disablePictureInPicture = !manualPlay;
    video.muted = video.defaultMuted = !manualPlay;
    if (manualPlay) {
      const level = savedVolume();
      video.volume = level;
      video.muted = level === 0;
    } else {
      video.tabIndex = -1;
      video.setAttribute('aria-hidden', 'true');
    }
    return video;
  }

  function release(video) {
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load(); // ends the download
    video.remove();
  }

  function stopHover() {
    clearTimeout(timer);
    timer = 0;
    if (pending) {
      if (manual?.card !== pending) hideLoader(tileOf(pending));
      pending = null;
    }
    const state = hover;
    hover = null;
    if (!state) return;
    release(state.video);
    if (manual?.card !== state.card) {
      hideLoader(state.tile);
      state.tile.classList.remove('sp-video-on');
    }
  }

  function stopManual(keepWide = false) {
    const state = manual;
    manual = null;
    if (!state) return;
    if (document.fullscreenElement === state.video) document.exitFullscreen().catch(() => {});
    release(state.video);
    hideLoader(state.tile);
    state.tile.classList.remove('sp-video-on');
    state.card.classList.remove('sp-inline-playing', 'sp-media-playing');
    if (!keepWide && state.card.classList.contains('sp-wide')) {
      state.card.classList.remove('sp-wide');
      ctx.layout();
    }
  }

  function stop() {
    stopHover();
    stopManual();
    releaseDialog();
  }

  // Full playback of a landscape video spans two columns, as in the YouTube app. Pausing keeps the size;
  // the next full playback (on another tile) returns earlier tiles to normal.
  function widen(state) {
    const { card, video } = state;
    let changed = false;
    for (const other of document.querySelectorAll('.file-card.sp-wide')) {
      if (other !== card) { other.classList.remove('sp-wide'); changed = true; }
    }
    const ratio = video.videoWidth / video.videoHeight;
    if (ratio > 1.2 && !card.classList.contains('sp-wide')) { card.classList.add('sp-wide'); changed = true; }
    const tile = state.tile, shown = Math.max(0.58, Math.min(2.05, ratio || 1.6));
    if (Math.abs((parseFloat(tile.style.getPropertyValue('--ratio')) || 0) - shown) > 0.02) {
      tile.style.setProperty('--ratio', shown);
      changed = true;
    }
    if (changed) ctx.layout();
  }

  function load(state) {
    const { video, tile, card, e } = state;
    video.addEventListener('loadedmetadata', () => {
      if (!live(state)) return;
      // Sound but no picture: Brave can't decode this video stream (HEVC without the Windows extension, for example).
      if (!video.videoWidth) { failed(state); return; }
      if (!state.manual && state.mode === 'media') {
        const start = previewStart(video.duration);
        if (start) video.currentTime = start;
      }
    }, { once: true });
    video.addEventListener('playing', () => {
      if (!live(state)) return;
      hideLoader(tile);
      tile.classList.add('sp-video-on');
      if (state.manual) {
        card.classList.add('sp-media-playing');
        widen(state);
      }
    });
    for (const name of ['pause', 'ended']) video.addEventListener(name, () => {
      if (!live(state) || !state.manual) return;
      showLoader(tile, true);
      card.classList.remove('sp-media-playing');
    });
    for (const name of ['waiting', 'stalled']) video.addEventListener(name, () => {
      if (live(state) && !video.paused) showLoader(tile, false);
    });
    video.addEventListener('error', () => { if (live(state)) failed(state); });
    if (state.manual) video.addEventListener('volumechange', () => { if (live(state)) remember(video.muted ? 0 : video.volume); });
    video.src = url(state.mode, e);
    tile.append(video);
    const playing = video.play();
    playing?.catch?.(error => {
      if (!live(state)) return;
      if (error.name === 'NotAllowedError') showLoader(tile, true); // the browser wants another click
    });
  }

  async function status(e) {
    try {
      const response = await fetch(url('media', e), { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
      response.body?.cancel().catch(() => {});
      return response.status;
    } catch { return 0; }
  }

  function restart(state, mode) {
    release(state.video);
    const next = { ...state, mode, video: makeVideo(state.manual), failing: false };
    if (state.manual) manual = next; else hover = next;
    showLoader(state.tile, false);
    load(next);
  }

  function noConverter() {
    if (warned) return;
    warned = true;
    ctx.report('Previews of AVI, WMV, MPG and other formats Brave can\'t play need FFmpeg. Install it (for example: winget install Gyan.FFmpeg) and restart Everywhere.');
  }

  // Work out why a video did not play: a restarted helper, a missing or cloud-only file, or a format Brave can't play.
  async function failed(state) {
    if (state.failing) return;
    state.failing = true;
    const { e } = state;
    const give = message => {
      if (state.manual) stopManual(); else stopHover();
      if (message) ctx.report(message);
    };
    if (state.mode === 'preview') {
      noPreview.add(e.path);
      give('');
      if (!ctx.converter()) noConverter();
      return;
    }
    let code = await status(e);
    if (code === 403) {
      const before = ctx.session();
      try { await ctx.reconnect(); } catch {}
      if (!live(state)) return;
      if (ctx.session() !== before && !state.retried) { state.retried = true; restart({ ...state, retried: true }, 'media'); return; }
      code = await status(e);
    }
    if (!live(state)) return;
    if (code === 200 || code === 206) {
      // The file is fine: this format is one Brave can't play.
      convert.add(e.path);
      if (state.manual) {
        give('Brave can\'t play this video. Opening it in your video player…');
        ctx.openExternal(e);
      } else if (ctx.converter() && !noPreview.has(e.path)) restart(state, 'preview');
      else { give(''); if (!ctx.converter()) noConverter(); }
      return;
    }
    if (code === 404) give('This video is no longer available.');
    else if (code === 409) {
      give(state.manual ? 'This cloud file is not on this PC. Opening it in your video player…' : '');
      if (state.manual) ctx.openExternal(e);
    } else if (code === 403) give('Everywhere restarted. Reload the page.');
    else give(state.manual ? 'This video could not play. Try again, or press Space and choose Open.' : '');
  }

  function startHover(card) {
    stopHover();
    const e = card.entry, tile = tileOf(card);
    if (!tile || !card.isConnected || manual?.card === card) return;
    const mode = foreign(e) ? 'preview' : 'media';
    const state = { card, tile, e, mode, manual: false, video: makeVideo(false) };
    hover = state;
    showLoader(tile, false);
    load(state);
  }

  function startManual(card) {
    stopManual(true);
    if (hover?.card === card || pending === card) stopHover();
    const tile = tileOf(card);
    if (!tile) return;
    const state = { card, tile, e: card.entry, mode: 'media', manual: true, video: makeVideo(true) };
    manual = state;
    card.classList.add('sp-inline-playing');
    showLoader(tile, false);
    load(state);
  }

  // The gray part of a video tile. Returns false when the file should open in the video player instead.
  function click(card) {
    const e = card?.entry;
    if (!ctx || !isVideo(e) || card.classList.contains('current-folder')) return false;
    if (foreign(e)) return false;
    if (manual?.card === card && manual.video.isConnected) {
      const video = manual.video;
      if (video.paused || video.ended) video.play().catch(() => {});
      else video.pause();
      return true;
    }
    startManual(card);
    ctx.record(e);
    return true;
  }

  // Space preview: a large player for videos Brave can play, the silent FFmpeg preview for the rest.
  function dialog(e) {
    if (!ctx || !isVideo(e)) return null;
    releaseDialog();
    stopHover();
    if (manual && !manual.video.paused) manual.video.pause();
    const box = document.createElement('div');
    box.className = 'sp-dialog-player';
    const video = document.createElement('video');
    video.className = 'sp-dialog-video';
    video.crossOrigin = 'anonymous';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'auto';
    const note = document.createElement('p');
    note.className = 'sp-dialog-note';
    if (foreign(e)) {
      note.textContent = 'Silent preview. Open plays the file in your video player.';
      if (!ctx.converter() || noPreview.has(e.path)) {
        note.textContent = ctx.converter() ? 'No preview for this video. Open plays it in your video player.' : 'Brave can\'t play this format, and previews of it need FFmpeg. Open plays it in your video player.';
        box.append(note);
        return box;
      }
      video.muted = video.defaultMuted = true;
      video.loop = true;
      video.src = url('preview', e);
    } else {
      video.loop = loopWanted();
      const level = savedVolume();
      video.volume = level;
      video.muted = level === 0;
      video.src = url('media', e);
      note.hidden = true;
      video.addEventListener('loadedmetadata', () => { if (!video.videoWidth) video.dispatchEvent(new Event('error')); }, { once: true });
      video.addEventListener('error', async () => {
        if (dialogVideo !== video) return;
        const code = await status(e);
        if (dialogVideo !== video) return;
        if (code === 200 || code === 206) {
          convert.add(e.path);
          note.textContent = 'Brave can\'t play this format. Open plays it in your video player.';
        } else note.textContent = code === 409 ? 'This cloud file is not on this PC.' : 'This video could not play here. Open plays it in your video player.';
        note.hidden = false;
        video.hidden = true;
      }, { once: true });
    }
    video.addEventListener('volumechange', () => {
      if (dialogVideo === video && !video.defaultMuted) remember(video.muted ? 0 : video.volume);
    });
    box.append(video, note);
    dialogVideo = video;
    video.play().catch(() => {});
    return box;
  }
  function releaseDialog() {
    const video = dialogVideo;
    dialogVideo = null;
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  }

  function remember(level) {
    try { window.scratchStorage?.setItem(VOLUME, String(Math.round(level * 100) / 100)); } catch {}
  }
  function showVolume(host, level) {
    if (!host) return;
    let note = $('.sp-volume-note', host);
    if (!note) {
      note = document.createElement('div');
      note.className = 'sp-volume-note';
      note.setAttribute('role', 'status');
      host.append(note);
    }
    note.textContent = level === 0 ? 'Muted' : 'Volume ' + Math.round(level * 100) + '%';
    note.classList.add('sp-volume-show');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => note.classList.remove('sp-volume-show'), 900);
  }

  // Hover: the gray zone only (red and blue never preview), mouse only, one preview at a time.
  document.addEventListener('pointerover', event => {
    if (!ctx || event.pointerType !== 'mouse') return;
    const zone = event.target instanceof Element ? event.target.closest('.zone-open') : null;
    const card = zone?.closest('.file-card');
    if (!card || !isVideo(card.entry) || card.classList.contains('current-folder')) return;
    if (manual?.card === card || hover?.card === card || pending === card) return;
    stopHover();
    if (!wanted() || noPreview.has(card.entry.path)) return;
    if (foreign(card.entry) && !ctx.converter()) { noConverter(); return; }
    pending = card;
    showLoader(tileOf(card), true);
    timer = setTimeout(() => {
      if (pending !== card) return;
      pending = null;
      startHover(card);
    }, DELAY);
  });
  document.addEventListener('pointerout', event => {
    const zone = event.target instanceof Element ? event.target.closest('.zone-open') : null;
    if (!zone || (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget))) return;
    const card = zone.closest('.file-card');
    if (card && (hover?.card === card || pending === card)) stopHover();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    stopHover();
    if (manual && !manual.video.paused) manual.video.pause();
  });

  // Z: fullscreen for the clicked video. + and -: its volume in 10% steps (remembered for the next video).
  document.addEventListener('keydown', event => {
    if (!ctx || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const inDialog = !!$('dialog[open]');
    const video = inDialog ? (dialogVideo?.isConnected && !dialogVideo.hidden ? dialogVideo : null) : (manual?.video?.isConnected ? manual.video : null);
    const key = event.key;
    if (key.toLowerCase() === 'z' && !event.shiftKey) {
      if (!video || event.repeat) return;
      event.preventDefault();
      const action = document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen();
      action?.catch?.(() => ctx.report('Fullscreen is unavailable. Use the button on the video.'));
      return;
    }
    const up = key === '+' || key === '=' || event.code === 'NumpadAdd';
    const down = key === '-' || key === '_' || event.code === 'NumpadSubtract';
    if ((!up && !down) || !video || video.defaultMuted) return;
    event.preventDefault();
    const start = video.muted ? 0 : video.volume;
    const level = Math.round(Math.min(1, Math.max(0, start + (up ? 0.1 : -0.1))) * 10) / 10;
    video.volume = level;
    video.muted = level === 0;
    remember(level);
    showVolume(inDialog ? video.parentElement : manual?.tile, level);
  });

  function setup(options) {
    ctx = options;
    const loopToggle = $('#loop-toggle');
    if (loopToggle) {
      const showLoop = () => {
        loopToggle.textContent = 'Loop video: ' + (loopWanted() ? 'on' : 'off');
        loopToggle.setAttribute('aria-pressed', String(loopWanted()));
      };
      showLoop();
      loopToggle.addEventListener('click', () => {
        try { window.scratchStorage?.setItem(LOOP, loopWanted() ? 'off' : 'on'); } catch {}
        applyLoop();
        showLoop();
      });
    }
    const toggle = $('#previews-toggle');
    if (toggle) {
      const show = () => { toggle.textContent = 'Hover previews: ' + (wanted() ? 'on' : 'off'); };
      show();
      toggle.addEventListener('click', () => {
        try { window.scratchStorage?.setItem(PREF, wanted() ? 'off' : 'on'); } catch {}
        if (!wanted()) stopHover();
        show();
      });
    }
  }

  // A tile that was removed from the wall (recycled, re-rendered) stops playing.
  function drop(card) {
    if (hover?.card === card || pending === card) stopHover();
    if (manual?.card === card) stopManual();
  }

  window.scratchVideo = { setup, click, dialog, release: releaseDialog, stop, drop, isVideo };
})();
