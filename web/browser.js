(() => {
'use strict';
window.scratchBrowser={setup(info,browse){
  const home=document.createElement('section');home.id='pc-home';home.hidden=true;home.setAttribute('aria-label','This PC');
  const heading=document.createElement('h1');heading.textContent='This PC';home.append(heading);
  for(const [title,entries] of [['Devices and drives',info.drives||[]]]){
    if(!entries.length)continue;
    const section=document.createElement('section'),label=document.createElement('h2'),grid=document.createElement('div');label.textContent=title;grid.className='pc-grid';
    for(const entry of entries){
      const button=document.createElement('button'),icon=document.createElement('span'),text=document.createElement('span'),name=document.createElement('strong'),path=document.createElement('small');
      button.className='pc-location';button.setAttribute('aria-label','Browse '+entry.name);icon.className='pc-icon';
      icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'+(entry.kind==='Drives'?'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 13h18m-5 3h2"/>':'<path d="M3 7V5h6l2 2h10v13H3Z"/>')+'</svg>';
      name.textContent=entry.name;path.textContent=entry.path;text.append(name,path);
      if(entry.totalBytes>0&&Number.isFinite(entry.freeBytes)){
        const capacity=document.createElement('meter'),space=document.createElement('small');
        capacity.min=0;capacity.max=entry.totalBytes;capacity.value=entry.totalBytes-entry.freeBytes;capacity.setAttribute('aria-label','Used space on '+entry.name);
        const gb=n=>(n/1073741824).toLocaleString(undefined,{maximumFractionDigits:1})+' GB';
        space.textContent=gb(entry.freeBytes)+' free of '+gb(entry.totalBytes);text.append(capacity,space);
      }
      button.append(icon,text);button.onclick=ev=>{if(ev.ctrlKey){ev.preventDefault();window.scratchApi('open_in_explorer',{path:entry.path}).catch(error=>{document.querySelector('#status').textContent=error.message;});}else browse(entry.path);};grid.append(button);
    }
    section.append(label,grid);home.append(section);
  }
  document.querySelector('main').prepend(home);
},show(visible){document.querySelector('#pc-home').hidden=!visible;document.querySelector('#file-wall').hidden=visible;document.querySelector('.continuous-status').hidden=visible;}};
})();
