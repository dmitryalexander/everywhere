/* Menu > Quit Everywhere: stops the local Everywhere program (October 21, 2026).
   Everywhere keeps running after its window closes, like Everything itself. */
(() => {
  'use strict';
  const button = document.getElementById('quit-app');
  if (!button) return;
  let armed = false, timer = 0;
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true; button.textContent = 'Click again to quit';
      clearTimeout(timer); timer = setTimeout(() => { armed = false; button.textContent = 'Quit Everywhere'; }, 4000);
      return;
    }
    clearTimeout(timer); button.disabled = true;
    try {
      const { token } = await (await fetch('/session', { cache: 'no-store' })).json();
      await fetch('/rpc', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Everywhere-Token': token }, body: JSON.stringify({ command: 'stop', args: {} }) });
    } catch {}
    document.body.innerHTML = '<p style="margin:20vh auto;max-width:28em;text-align:center;color:#ddd;font:16px system-ui,sans-serif">Everywhere has stopped. You can close this window.<br>Open Everywhere again from its shortcut.</p>';
    window.close();
  });
})();
