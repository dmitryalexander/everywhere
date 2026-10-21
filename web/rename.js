(() => {
  const dialog=document.createElement('dialog');dialog.className='pn-dialog item-rename';dialog.id='item-rename';
  dialog.innerHTML='<form><h2>Rename item</h2><p class="rename-path"></p><label>New name<input name="name" required maxlength="255" autocomplete="off" spellcheck="false"></label><p class="rename-hint">Renames the file or folder on this computer.</p><p role="status"></p><button type="submit">Rename</button><button type="button">Cancel</button></form>';
  document.body.append(dialog);const input=dialog.querySelector('input'),status=dialog.querySelector('[role=status]'),submit=dialog.querySelector('[type=submit]');let entry=null,busy=false;
  dialog.querySelector('[type=button]').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  window.scratchRename=e=>{entry={...e};input.value=e.name;status.textContent='';dialog.querySelector('h2').textContent=e.isDir?'Rename folder':'Rename file';dialog.querySelector('.rename-path').textContent=e.path;dialog.showModal();input.focus();const dot=e.name.lastIndexOf('.');input.setSelectionRange(0,!e.isDir&&dot>0?dot:e.name.length);};
  dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;submit.disabled=true;status.textContent='Renaming…';try{await window.scratchRenameItem(entry,input.value);dialog.close();}catch(error){status.textContent=error.message;input.focus();}finally{busy=false;submit.disabled=false;}};
})();
