/* Presentational enhancement only: move existing book cards, never duplicate or rewrite text data. */
(() => {
  'use strict';
  const header = document.querySelector('header.top');
  const app = document.getElementById('app');
  if (!header || !app) return;
  const compact = matchMedia('(max-width:1100px)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  let shelfState = null;
  let frame = 0;
  const syncHeader = () => {
    const height = getComputedStyle(header).position === 'sticky' ? Math.ceil(header.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--head-h', height + 'px');
  };
  const syncNav = () => {
    const support = location.hash.startsWith('#/support');
    header.querySelectorAll('.topnav a').forEach(link => {
      const active = support ? link.getAttribute('href') === '#/support' : link.getAttribute('href') === '#/';
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
  };
  function enhance() {
    syncHeader(); syncNav();
    const shop = app.querySelector('#libraryBookshop');
    if (!shop) { shelfState = null; return; }
    const intro = app.querySelector('.home-grid .intro');
    if (!intro) return;
    if (!shelfState || shelfState.shop !== shop) {
      const home = document.createComment('Original bookshop location');
      shop.before(home);
      const groups = [...shop.children].filter(node => node.classList.contains('shop-group'));
      const track = document.createElement('div');
      track.className = 'shop-shelf'; track.id = 'akivaBookShelf';
      track.setAttribute('role','region'); track.setAttribute('aria-label','Published books');
      const controls = document.createElement('div'); controls.className = 'shop-controls';
      const hint = document.createElement('span'); hint.textContent = 'Swipe to explore the collection';
      controls.append(hint);
      const prev = document.createElement('button'), next = document.createElement('button');
      for (const [button,label,text] of [[prev,'Previous books','←'],[next,'Next books','→']]) {
        button.type='button'; button.setAttribute('aria-label',label); button.setAttribute('aria-controls',track.id); button.textContent=text; controls.append(button);
      }
      groups[0]?.before(controls,track);
      groups.forEach(group=>track.append(group));
      const update = () => {
        prev.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
      };
      const scroll = direction => {
        const step = (track.firstElementChild?.getBoundingClientRect().width || track.clientWidth) + parseFloat(getComputedStyle(track).columnGap || 0);
        track.scrollBy({left: direction*step, behavior: reduced.matches ? 'auto' : 'smooth'});
      };
      prev.addEventListener('click',()=>scroll(-1)); next.addEventListener('click',()=>scroll(1));
      track.addEventListener('scroll',update,{passive:true});
      track.addEventListener('keydown',event=>{
        if (event.target!==track || !compact.matches) return;
        if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();scroll(event.key==='ArrowRight'?1:-1);}
      });
      shelfState = {shop,home,track,update};
      shop.querySelectorAll('img').forEach(img=>{img.decoding='async';});
      shop.querySelectorAll('.shop-group:first-child img').forEach(img=>{img.loading='eager';});
    }
    const {home,track,update} = shelfState;
    shop.classList.toggle('compact-bookshop',compact.matches);
    if(compact.matches){
      if(intro.nextElementSibling!==shop) intro.after(shop);
      track.tabIndex=0;
    } else {
      if(home.nextSibling!==shop) home.after(shop);
      track.removeAttribute('tabindex'); track.scrollLeft=0;
    }
    requestAnimationFrame(update);
  }
  const schedule = () => {cancelAnimationFrame(frame);frame=requestAnimationFrame(enhance);};
  new MutationObserver(schedule).observe(app,{childList:true});
  if ('ResizeObserver' in window) new ResizeObserver(syncHeader).observe(header);
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('hashchange',schedule);
  if(compact.addEventListener) compact.addEventListener('change',schedule); else compact.addListener(schedule);
  document.fonts?.ready.then(schedule);
  enhance();
})();
