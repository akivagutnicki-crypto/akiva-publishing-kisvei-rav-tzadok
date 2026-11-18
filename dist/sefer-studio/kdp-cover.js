/* Full-spread cover editor. Manuscripts and artwork stay in this browser. */
(function () {
  'use strict';
  const VERSION = 1;
  const STORAGE_KEY = 'seferstudio.kdp-cover.v1';
  const FONTS = ['Crimson Pro', 'Frank Ruhl Libre', 'Times New Roman'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const block = (id, label, text, size, y, h, extra) => Object.assign({id,label,text,size,y,h,x:.07,w:.86,font:'Crimson Pro',bold:false,align:'center',direction:'auto'},extra || {});
  function defaultProject() {
    return {version:VERSION,name:'Tzidkas HaTzadik - Volume I',settings:{format:'hardcover',trimW:7,trimH:10,pages:362,paper:'cream',ink:'bw',direction:'ltr',language:'hebrew'},theme:{bg:'#32181e',accent:'#be9b61',text:'#f4e4c8'},frame:true,reserveBarcode:false,
      panels:{front:{image:null,showText:true,blocks:[
        block('series','Series','KISVEI RAV TZADOK',12,.10,.06),
        block('hebrew','Hebrew title','צדקת הצדיק',48,.20,.10,{font:'Frank Ruhl Libre',bold:true,direction:'rtl'}),
        block('title','English title','Tzidkas HaTzadik',28,.32,.07),
        block('subtitle','Subtitle','An Interlinear Translation\nwith Annotated Footnotes',17,.42,.10),
        block('author','Author','RABBI TZADOK HAKOHEN OF LUBLIN',12,.56,.07),
        block('volume','Volume','VOLUME I',23,.77,.06),
        block('sections','Sections','Sections 1–170',13,.85,.05)
      ]},back:{image:null,showText:true,blocks:[
        block('series','Series','KISVEI RAV TZADOK',11,.08,.05),
        block('hebrew','Hebrew title','צדקת הצדיק',28,.16,.07,{font:'Frank Ruhl Libre',bold:true,direction:'rtl'}),
        block('title','English title','Tzidkas HaTzadik · Volume I',18,.25,.05),
        block('blurb','Back cover description','Tzidkas HaTzadik brings the spiritual insight of Rabbi Tzadok HaKohen of Lublin to the searching reader. In concentrated teachings, Rav Tzadok explores faith, the inner meaning of mitzvos, and each person’s unique path in avodas Hashem.\n\nVolume I presents Sections 1–170: the beginnings of divine service, prayer and Torah, the struggle with temptation, and the transforming power of teshuvah.\n\nThe original Hebrew is paired passage by passage with English translation. Scholarly footnotes identify classic sources and relevant parallels from Rav Tzadok’s writings and the Ishbitz–Radzin tradition.',13,.35,.35,{align:'left',direction:'ltr'}),
        block('publisher','Publisher','AKIVA PUBLISHING\nKisvei Rav Tzadok',11,.72,.06,{align:'left',x:.07,w:.4})
      ]}},spine:{title:'צדקת הצדיק',subtitle:'TZIDKAS HATZADIK',volume:'VOLUME I',publisher:'AKIVA PUBLISHING',size:19,direction:'down',showText:true}};
  }
  let project = defaultProject(), panelName = 'front', selectedId = 'hebrew';
  let root, lastFocus, exporting = false, renderSequence = 0, lastReport = null, lastGeometry = null;
  let localSaveFailed = false, statusMessage = '', operationError = '', queued = false;
  let preflight = {errors:[],warnings:[]};
  const imageCache = new Map();
  const $ = id => document.getElementById(id);
  function allowedImage(value) { return value === null || (typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 48 * 1024 * 1024); }
  function validateProject(value) {
    if (!value || value.version !== VERSION || !value.settings || !value.panels || !value.spine || !value.theme) throw new Error('Choose a SeferStudio cover project (.json).');
    const p = defaultProject();
    p.name = String(value.name || 'Book cover').slice(0,150);
    for (const key of Object.keys(p.settings)) if (value.settings[key] !== undefined) p.settings[key] = value.settings[key];
    for (const key of ['pages','trimW','trimH']) {
      if (p.settings[key] === null) p.settings[key] = NaN;
      else if (typeof p.settings[key] !== 'number') throw new Error('The project contains invalid book settings.');
    }
    for (const key of ['bg','accent','text']) {
      if (!/^#[0-9a-f]{6}$/i.test(value.theme[key])) throw new Error('The project contains an invalid color.');
      p.theme[key] = value.theme[key];
    }
    p.frame = value.frame !== false; p.reserveBarcode = value.reserveBarcode === true;
    for (const side of ['front','back']) {
      const data = value.panels[side];
      if (!data || !Array.isArray(data.blocks) || data.blocks.length > 35 || !allowedImage(data.image)) throw new Error('The project contains invalid panel artwork or text.');
      p.panels[side] = {showText:data.showText !== false,image:data.image,blocks:data.blocks.map((b,i) => {
        if (!b || typeof b.text !== 'string' || b.text.length > 20000) throw new Error('A text block is invalid or too long.');
        for (const k of ['x','y','w','h','size']) if (!Number.isFinite(b[k]) || Math.abs(b[k]) > 10000) throw new Error('A text position is invalid.');
        // Preserve editable drafts; print-safe geometry is checked at render/export.
        return {id:side+'_'+i,label:String(b.label || 'Text '+(i+1)).slice(0,70),text:b.text,font:FONTS.includes(b.font)?b.font:'Crimson Pro',size:b.size,bold:!!b.bold,align:['left','center','right'].includes(b.align)?b.align:'center',direction:['ltr','rtl','auto'].includes(b.direction)?b.direction:'auto',x:b.x,y:b.y,w:b.w,h:b.h};
      })};
    }
    for (const key of ['title','subtitle','volume','publisher']) p.spine[key] = String(value.spine[key] || '').slice(0,500);
    p.spine.size = Number.isFinite(value.spine.size) ? Math.max(6,Math.min(72,value.spine.size)):19;
    p.spine.direction = value.spine.direction === 'up' ? 'up':'down';
    p.spine.showText = value.spine.showText !== false;
    return p;
  }
  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(project)); localSaveFailed=false; }
    catch (_) { localSaveFailed=true; }
    if ($('kdp-save-state')) $('kdp-save-state').textContent = localSaveFailed ? 'Save project to keep this cover. Browser storage is full.' : 'Draft saved on this device · Save project for a backup';
  }
  function buildUI() {
    root = document.createElement('section'); root.id='kdp-studio';root.hidden=true;
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','kdp-title');
    root.innerHTML = `<header class="kdp-header"><div class="kdp-brand"><small>SEFERSTUDIO PRO</small><h1 id="kdp-title">KDP Cover Studio</h1></div><div class="kdp-header-actions"><button type="button" id="kdp-save" class="kdp-secondary">Save project</button><button type="button" id="kdp-open" class="kdp-secondary">Open project</button><button type="button" id="kdp-export-png">300-DPI PNG</button><button type="button" id="kdp-export-pdf" class="kdp-primary">Export KDP PDF</button><button type="button" id="kdp-close" class="kdp-close" aria-label="Close KDP Cover Studio">✕ Close</button></div></header>
      <div class="kdp-workspace"><aside class="kdp-sidebar"><h2>1 · Book specifications</h2>
      <label>Project name<input id="kdp-name" maxlength="150"></label>
      <div class="kdp-row"><label>Binding<select id="kdp-format"><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option></select></label><label>Interior pages<input id="kdp-pages" type="number" min="24" max="828" step="1"></label></div>
      <button type="button" id="kdp-read-interior" class="kdp-wide">Read page count from interior PDF</button>
      <label>Trim size<select id="kdp-trim"></select></label><div id="kdp-custom-trim" class="kdp-row kdp-hidden"><label>Width (in)<input id="kdp-trim-w" type="number" step=".01"></label><label>Height (in)<input id="kdp-trim-h" type="number" step=".01"></label></div>
      <div class="kdp-row"><label>Interior ink<select id="kdp-ink"><option value="bw">Black &amp; white</option><option value="premium">Premium color</option><option value="standard">Standard color</option></select></label><label>Paper<select id="kdp-paper"><option value="cream">Cream</option><option value="white">White</option></select></label></div>
      <label>KDP book language<select id="kdp-language"><option value="hebrew">Hebrew / bilingual Hebrew</option><option value="yiddish">Yiddish</option><option value="other">English / other</option></select></label>
      <label>Book reading direction<select id="kdp-direction"><option value="ltr">Left to right · front on right</option><option value="rtl">Right to left · front on left</option></select></label>
      <p id="kdp-binding-help" class="kdp-help"></p><hr class="kdp-separator"><h2>2 · Cover appearance</h2>
      <label>Palette<select id="kdp-palette"><option value="navy">Navy &amp; gold</option><option value="burgundy">Burgundy &amp; gold</option><option value="forest">Forest &amp; gold</option><option value="custom">Custom colors</option></select></label>
      <div class="kdp-row"><label>Background<input type="color" id="kdp-bg"></label><label>Accent<input type="color" id="kdp-accent"></label></div><label>Text color<input type="color" id="kdp-text-color"></label>
      <label class="kdp-check"><input type="checkbox" id="kdp-frame"> Decorative frame</label><label class="kdp-check"><input type="checkbox" id="kdp-barcode"> White space for KDP barcode</label>
      <p class="kdp-help">No barcode is generated. Keep the marked area clear for the barcode KDP adds.</p>
      <button type="button" id="kdp-new" class="kdp-wide">New Tzidkas-style cover</button>
      <div id="kdp-preflight" class="kdp-status" role="status" aria-live="polite"></div>
      <p class="kdp-help">Review the exported cover in KDP Print Previewer before publication.</p></aside>
      <main class="kdp-preview"><div class="kdp-preview-head"><strong id="kdp-spread-label">Back · Spine · Front</strong><label><input type="checkbox" id="kdp-guides" checked> Print guides</label><button type="button" id="kdp-proof" title="Download a proof with guides; not for uploading to KDP">Proof PNG</button></div><div class="kdp-canvas-area"><canvas id="kdp-canvas" aria-label="Full cover preview: back, spine, and front"></canvas></div><div class="kdp-legend"><span><i style="color:#f5ab54"></i>Trim / board</span><span><i style="color:#54d2d9;border-top-style:dashed"></i>Safe text area</span><span><i style="color:#d79be6"></i>Spine / hinge</span></div><div class="kdp-dimensions"><div>FULL PDF SIZE<strong id="kdp-full-size">—</strong></div><div>SPINE WIDTH<strong id="kdp-spine-size">—</strong></div><div>300-DPI EXPORT<strong id="kdp-pixel-size">—</strong></div></div></main>
      <aside class="kdp-sidebar kdp-editor"><h2>3 · Edit your cover</h2><div class="kdp-tabs" role="tablist" aria-label="Cover panel"><button type="button" data-kdp-panel="front" role="tab" aria-selected="true">Front</button><button type="button" data-kdp-panel="back" role="tab" aria-selected="false">Back</button><button type="button" data-kdp-panel="spine" role="tab" aria-selected="false">Spine</button></div><div id="kdp-panel-editor"></div></aside></div>
      <footer class="kdp-footer"><span id="kdp-save-state" class="kdp-session"></span><span>Single-page cover · 300 DPI · Guides removed from print exports</span><a href="https://kdp.amazon.com/en_US/cover-templates?language=en_US" target="_blank" rel="noopener">Amazon cover calculator ↗</a></footer>
      <input type="file" id="kdp-project-file" accept=".json,application/json" hidden><input type="file" id="kdp-interior-file" accept=".pdf,application/pdf" hidden><input type="file" id="kdp-art-file" accept="image/png,image/jpeg,image/webp" hidden>`;
    document.body.appendChild(root);
    root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('click',onClick);
    root.addEventListener('keydown', e => {
      if (e.key==='Escape' && !exporting) {e.preventDefault();close();}
      if (e.key==='Tab') {const list=[...root.querySelectorAll('button,input,select,textarea,a')].filter(n=>!n.disabled && n.getClientRects().length);if(!list.length)return;const first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
  }
  function refreshUI() {
    const s=project.settings;
    const values={'kdp-name':project.name,'kdp-format':s.format,'kdp-pages':s.pages,'kdp-ink':s.ink,'kdp-paper':s.paper,'kdp-language':s.language,'kdp-direction':s.direction,'kdp-bg':project.theme.bg,'kdp-accent':project.theme.accent,'kdp-text-color':project.theme.text,'kdp-trim-w':s.trimW,'kdp-trim-h':s.trimH};
    for(const [id,val] of Object.entries(values)) $(id).value=val;
    $('kdp-palette').value=({'#16283b':'navy','#32181e':'burgundy','#18352e':'forest'})[project.theme.bg]||'custom';
    $('kdp-frame').checked=project.frame;$('kdp-barcode').checked=project.reserveBarcode;
    const trims=(s.format==='hardcover'?window.KdpGeometry.SUPPORTED_HARDCOVER_TRIMS:window.KdpGeometry.SUPPORTED_PAPERBACK_TRIMS).map(t=>[t.trimW,t.trimH]);
    $('kdp-trim').innerHTML=trims.map(t=>`<option value="${t.join('x')}">${t[0]} × ${t[1]} inches</option>`).join('')+(s.format==='paperback'?'<option value="custom">Custom paperback size</option>':'');
    const match=trims.some(t=>t[0]===s.trimW&&t[1]===s.trimH);$('kdp-trim').value=match?s.trimW+'x'+s.trimH:'custom';$('kdp-custom-trim').classList.toggle('kdp-hidden',match||s.format==='hardcover');
    $('kdp-direction').querySelector('[value=rtl]').disabled=s.format==='hardcover';
    $('kdp-ink').querySelector('[value=standard]').disabled=s.format==='hardcover'||s.language!=='other'||s.direction==='rtl';
    $('kdp-paper').querySelector('[value=cream]').disabled=s.ink!=='bw';
    $('kdp-binding-help').textContent=s.format==='hardcover'?'KDP currently supports left-to-right hardcover binding only. Hebrew text can still read right to left.':'Match the reading direction selected for your KDP interior. RTL places the front on the left.';
    $('kdp-spread-label').textContent=s.direction==='rtl'?'Front · Spine · Back':'Back · Spine · Front';
    renderEditor();saveLocal();queueRender();
  }
  function renderEditor() {
    root.querySelectorAll('[data-kdp-panel]').forEach(n=>n.setAttribute('aria-selected',String(n.dataset.kdpPanel===panelName)));
    const mount=$('kdp-panel-editor');
    if(panelName==='spine') {
      mount.innerHTML=`<label class="kdp-check"><input id="kdp-spine-show" type="checkbox" ${project.spine.showText!==false?'checked':''}> Show spine text</label><p class="kdp-help">The spine width follows the final interior page count. Text is fitted inside its safe area.</p>${[['title','Hebrew title'],['subtitle','English title'],['volume','Volume'],['publisher','Publisher']].map(([key,label])=>`<label>${label}<textarea data-spine-key="${key}" rows="2" dir="auto" maxlength="500">${esc(project.spine[key])}</textarea></label>`).join('')}<label>Maximum type size (pt)<input id="kdp-spine-type" type="number" min="6" max="72" value="${project.spine.size}"></label><label>Text orientation<select id="kdp-spine-orientation"><option value="down">Top to bottom</option><option value="up">Bottom to top</option></select></label><p class="kdp-help">For paperbacks under 80 printed pages, spine text is omitted automatically.</p>`;
      $('kdp-spine-orientation').value=project.spine.direction;return;
    }
    const panel=project.panels[panelName];if(!panel.blocks.some(b=>b.id===selectedId))selectedId=panel.blocks[0]?.id||'';
    const b=panel.blocks.find(x=>x.id===selectedId);
    mount.innerHTML=`<button type="button" id="kdp-upload-art" class="kdp-wide">Upload ${panelName} artwork</button>${panel.image?'<button type="button" id="kdp-remove-art" class="kdp-wide">Remove panel artwork</button>':''}${panelName==='front'?'<button type="button" id="kdp-use-design" class="kdp-wide">Use current Visual Studio design</button>':''}<p class="kdp-help">PNG, JPG or WebP. Artwork fills the panel; check cropping in the preview. Print quality is checked at its placed size.</p><label class="kdp-check"><input type="checkbox" id="kdp-show-text" ${panel.showText?'checked':''}> Show editable ${panelName} text</label><label>Text block<select id="kdp-block-select">${panel.blocks.map(x=>`<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('')}</select></label><div class="kdp-row"><button type="button" id="kdp-add-text">+ Text block</button><button type="button" id="kdp-delete-text" class="kdp-delete" ${b?'':'disabled'}>Remove block</button></div>${b?`<div class="kdp-block-controls"><label>Text<textarea id="kdp-block-text" rows="${b.id==='blurb'?9:4}" dir="auto" maxlength="20000">${esc(b.text)}</textarea></label><div class="kdp-row"><label>Type size (pt)<input id="kdp-block-size" type="number" min="6" max="144" value="${b.size}"></label><label>Alignment<select id="kdp-block-align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></div><label>Typeface<select id="kdp-block-font">${FONTS.map(f=>`<option value="${f}">${f}</option>`).join('')}</select></label><div class="kdp-row"><label>Text direction<select id="kdp-block-direction"><option value="auto">Auto</option><option value="rtl">Hebrew RTL</option><option value="ltr">English LTR</option></select></label><label class="kdp-check"><input type="checkbox" id="kdp-block-bold" ${b.bold?'checked':''}> Bold</label></div><details><summary>Position &amp; text area</summary><p class="kdp-help">Positions are percentages of this panel’s safe area. Type fits within the selected box.</p><div class="kdp-row">${[['x','Left'],['y','Top'],['w','Width'],['h','Height']].map(([key,label])=>`<label>${label} (%)<input data-block-pos="${key}" type="number" min="0" max="100" step="1" value="${Math.round(b[key]*100)}"></label>`).join('')}</div></details></div>`:''}`;
    if(b){$('kdp-block-select').value=b.id;$('kdp-block-align').value=b.align;$('kdp-block-font').value=b.font;$('kdp-block-direction').value=b.direction;}
  }
  function selectedBlock(){return project.panels[panelName]?.blocks.find(b=>b.id===selectedId);}
  function onInput(e) {
    if(exporting)return;
    const el=e.target,id=el.id,s=project.settings,b=selectedBlock();
    if(id==='kdp-name')project.name=el.value;
    else if(id==='kdp-pages')s.pages=el.value===''?NaN:Number(el.value);
    else if(id==='kdp-trim-w')s.trimW=el.value===''?NaN:Number(el.value);
    else if(id==='kdp-trim-h')s.trimH=el.value===''?NaN:Number(el.value);
    else if(['kdp-bg','kdp-accent','kdp-text-color'].includes(id)){project.theme[{'kdp-bg':'bg','kdp-accent':'accent','kdp-text-color':'text'}[id]]=el.value;$('kdp-palette').value='custom';}
    else if(id==='kdp-block-text'&&b)b.text=el.value;
    else if(id==='kdp-block-size'&&b)b.size=Number(el.value);
    else if(el.dataset.blockPos&&b)b[el.dataset.blockPos]=Number(el.value)/100;
    else if(el.dataset.spineKey)project.spine[el.dataset.spineKey]=el.value;
    else if(id==='kdp-spine-type')project.spine.size=Number(el.value);
    else return;
    setStatus();saveLocal();queueRender();
  }
  async function onChange(e) {
    if(exporting)return;
    const el=e.target,id=el.id,s=project.settings,b=selectedBlock();
    if(id==='kdp-format'){setStatus();s.format=el.value;if(s.format==='hardcover'){s.direction='ltr';if(s.ink==='standard')s.ink='bw';if(![[5.5,8.5],[6,9],[6.14,9.21],[7,10],[8.25,11]].some(t=>t[0]===s.trimW&&t[1]===s.trimH)){s.trimW=7;s.trimH=10;setStatus('Trim changed to 7 × 10, a supported hardcover size.');}}refreshUI();return;}
    if(id==='kdp-trim'){setStatus();if(el.value==='custom'){$('kdp-custom-trim').classList.remove('kdp-hidden');queueRender();return;}[s.trimW,s.trimH]=el.value.split('x').map(Number);refreshUI();return;}
    if(id==='kdp-ink'){s.ink=el.value;if(s.ink!=='bw')s.paper='white';setStatus();refreshUI();return;}
    if(id==='kdp-paper'){s.paper=el.value;setStatus();refreshUI();return;}
    if(id==='kdp-language'||id==='kdp-direction'){s[id==='kdp-language'?'language':'direction']=el.value;if(s.ink==='standard'&&(s.language!=='other'||s.direction==='rtl'))s.ink='bw';setStatus();refreshUI();return;}
    if(id==='kdp-palette'){const palettes={navy:{bg:'#16283b',accent:'#c6a568',text:'#f4ead3'},burgundy:{bg:'#32181e',accent:'#be9b61',text:'#f4e4c8'},forest:{bg:'#18352e',accent:'#c8ac6f',text:'#f1eddb'}};if(palettes[el.value])project.theme=clone(palettes[el.value]);setStatus();refreshUI();return;}
    if(id==='kdp-frame')project.frame=el.checked;
    else if(id==='kdp-barcode')project.reserveBarcode=el.checked;
    else if(id==='kdp-guides'){queueRender();return;}
    else if(id==='kdp-show-text')project.panels[panelName].showText=el.checked;
    else if(id==='kdp-block-select'){selectedId=el.value;renderEditor();return;}
    else if(id==='kdp-block-align'&&b)b.align=el.value;
    else if(id==='kdp-block-font'&&b)b.font=el.value;
    else if(id==='kdp-block-direction'&&b)b.direction=el.value;
    else if(id==='kdp-block-bold'&&b)b.bold=el.checked;
    else if(id==='kdp-spine-orientation')project.spine.direction=el.value;
    else if(id==='kdp-spine-show')project.spine.showText=el.checked;
    else if(id==='kdp-project-file'){const file=el.files[0];el.value='';if(file){setBusy(true,'Opening project…');try{await openProject(file);}finally{setBusy(false);}}return;}
    else if(id==='kdp-interior-file'){const file=el.files[0];el.value='';if(file){setBusy(true,'Reading interior…');try{await readInterior(file);}finally{setBusy(false);}}return;}
    else if(id==='kdp-art-file'){const file=el.files[0];el.value='';if(file){setBusy(true,'Loading artwork…');try{await readArtwork(file);}finally{setBusy(false);}}return;}
    else return;
    setStatus();saveLocal();queueRender();
  }
  async function onClick(e) {
    const btn=e.target.closest('button');if(!btn||exporting)return;
    try {
      if(btn.dataset.kdpPanel){panelName=btn.dataset.kdpPanel;renderEditor();return;}
      switch(btn.id){
        case 'kdp-close':close();break;
        case 'kdp-save':download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),filename()+'.cover.json');setStatus('Cover project downloaded, including artwork and editable text.');queueRender();break;
        case 'kdp-open':$('kdp-project-file').click();break;
        case 'kdp-read-interior':$('kdp-interior-file').click();break;
        case 'kdp-upload-art':$('kdp-art-file').dataset.panel=panelName;$('kdp-art-file').click();break;
        case 'kdp-remove-art':project.panels[panelName].image=null;setStatus();refreshUI();break;
        case 'kdp-use-design':setBusy(true,'Importing design…');try{await useDesign();}finally{setBusy(false);}break;
        case 'kdp-export-pdf':await exportCover('pdf');break;
        case 'kdp-export-png':await exportCover('png');break;
        case 'kdp-proof':await exportCover('proof');break;
        case 'kdp-new':if(window.confirm('Start a new cover? Save project first to keep a separate copy of this draft.')){project=defaultProject();selectedId='hebrew';panelName='front';$('kdp-palette').value='burgundy';setStatus();refreshUI();}break;
        case 'kdp-add-text':{const p=project.panels[panelName];if(p.blocks.length>=35)throw new Error('This panel already has 35 text blocks.');const b=block('text_'+Date.now(),'New text','New text',18,.50,.12);p.blocks.push(b);selectedId=b.id;setStatus();refreshUI();break;}
        case 'kdp-delete-text':project.panels[panelName].blocks=project.panels[panelName].blocks.filter(b=>b.id!==selectedId);setStatus();refreshUI();break;
      }
    }catch(error){showError(error.message);}
  }
  function filename(){return(project.name||'Book_Cover').replace(/[^\p{L}\p{N}_-]+/gu,'_').replace(/^_|_$/g,'').slice(0,90)||'Book_Cover';}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function loadImage(src){if(!src)return Promise.resolve(null);if(imageCache.has(src))return imageCache.get(src);const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Panel artwork could not be loaded. Remove it and upload it again.'));img.src=src;});imageCache.set(src,promise);return promise;}
  async function loadImages(p){const [front,back]=await Promise.all([loadImage(p.panels.front.image),loadImage(p.panels.back.image)]);return{front,back};}
  async function waitFonts(p){if(!document.fonts)return;const families=new Set(['Frank Ruhl Libre','Crimson Pro']);for(const side of ['front','back'])for(const b of p.panels[side].blocks)families.add(b.font);await Promise.all([...families].flatMap(f=>[document.fonts.load(`400 24px "${f}"`,'אבג ABC'),document.fonts.load(`700 24px "${f}"`,'אבג ABC')]));await document.fonts.ready;}
  function extraChecks(p,g,images){const errors=[],warnings=[];for(const side of ['front','back']){const panel=p.panels[side];if(panel.showText)for(const b of panel.blocks){if(!Number.isFinite(b.size)||b.size<6||b.size>144)errors.push(`${side}: type size must be 6–144 pt.`);if(![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.x<0||b.y<0||b.w<=0||b.h<=0||b.x+b.w>1.000001||b.y+b.h>1.000001)errors.push(`${side} “${b.label}”: keep its text box inside the safe area.`);}}if(!Number.isFinite(p.spine.size)||p.spine.size<6||p.spine.size>72)errors.push('Spine type size must be 6–72 pt.');return{errors,warnings};}
  function queueRender(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;renderPreview().catch(e=>showError(e.message));});}
  async function renderPreview(){
    if(!root||root.hidden)return;const sequence=++renderSequence,p=clone(project),check=window.KdpGeometry.validate(p.settings);lastReport=null;lastGeometry=null;
    if(check.errors.length){showReport(check.errors,check.warnings);$('kdp-full-size').textContent='Check specifications';$('kdp-spine-size').textContent='—';$('kdp-pixel-size').textContent='—';$('kdp-canvas').getContext('2d').clearRect(0,0,$('kdp-canvas').width,$('kdp-canvas').height);return;}
    const g=window.KdpGeometry.calculate(p.settings);const [images]=await Promise.all([loadImages(p),waitFonts(p)]);if(sequence!==renderSequence)return;
    const pre=extraChecks(p,g,images),canvas=$('kdp-canvas'),dpi=100;canvas.width=Math.ceil(g.totalW*dpi);canvas.height=Math.ceil(g.totalH*dpi);
    let report={errors:[],warnings:[]};if(!pre.errors.length)report=window.KdpRender.render(canvas.getContext('2d'),g,p,{dpi,guides:$('kdp-guides').checked,images});
    lastGeometry=g;lastReport=report;
    $('kdp-full-size').textContent=`${g.totalW.toFixed(3)} × ${g.totalH.toFixed(3)} in`;$('kdp-spine-size').textContent=`${g.spine.toFixed(3)} in · ${g.effectivePages} pages`;$('kdp-pixel-size').textContent=`${Math.ceil(g.totalW*300)} × ${Math.ceil(g.totalH*300)} px`;
    showReport([...pre.errors,...report.errors],[...check.warnings,...pre.warnings,...report.warnings]);
  }
  function setStatus(message=''){statusMessage=message;operationError='';}
  function showReport(errors,warnings){
    preflight={errors,warnings};
    const list=[...new Set(warnings)],box=$('kdp-preflight');
    box.className='kdp-status'+(errors.length||operationError?' kdp-error':list.length?' kdp-warn':'');
    box.innerHTML=errors.length?`<strong>Resolve before exporting</strong><ul>${[...new Set(errors)].map(t=>'<li>'+esc(t)+'</li>').join('')}</ul>`:operationError?'<strong>Action could not be completed</strong>':`<strong>${list.length?'Cover checks':'Ready to export'}</strong>${list.length?'<ul>'+list.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':'<p>Full spread, safe text placement, and print dimensions checked.</p>'}`;
    if(operationError)box.innerHTML+='<p>'+esc(operationError)+'</p>';
    else if(statusMessage)box.innerHTML+='<p>'+esc(statusMessage)+'</p>';
    // An import failure does not invalidate the current cover. Keep its actual
    // preflight result separate so the preserved draft can still be exported.
    for(const id of ['kdp-export-pdf','kdp-export-png'])$(id).disabled=exporting||errors.length>0;
    $('kdp-proof').disabled=exporting;
  }
  function showError(message){operationError=String(message);statusMessage='';showReport(preflight.errors,preflight.warnings);}
  async function openProject(file){try{if(file.size>100*1024*1024)throw new Error('Choose a cover project smaller than 100 MB.');const next=validateProject(JSON.parse(await file.text()));await loadImages(next);project=next;panelName='front';selectedId=project.panels.front.blocks[0]?.id||'';setStatus('Cover project opened.');refreshUI();}catch(e){showError(e.message);}}
  async function readInterior(file){try{if(!window.PDFLib)throw new Error('The PDF library is unavailable. Check your connection and reload.');const pdf=await window.PDFLib.PDFDocument.load(await file.arrayBuffer(),{updateMetadata:false});project.settings.pages=pdf.getPageCount();setStatus(`Read ${project.settings.pages} interior pages from ${file.name}. Confirm the trim, paper and ink match KDP.`);refreshUI();}catch(e){showError('Could not read the interior PDF: '+e.message);}}
  async function readArtwork(file){try{const side=$('kdp-art-file').dataset.panel||panelName;if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use a PNG, JPG or WebP image.');if(file.size>30*1024*1024)throw new Error('Use artwork smaller than 30 MB.');const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});await loadImage(src);project.panels[side].image=src;setStatus('Panel artwork added. Turn off editable text if your image already includes titles.');refreshUI();}catch(e){showError(e.message);}}
  async function useDesign(){if(!window.DesignStudioAPI?.exportFront)throw new Error('Open Visual Studio and create a front design first.');const src=await window.DesignStudioAPI.exportFront();await loadImage(src);project.panels.front.image=src;project.panels.front.showText=false;setStatus('Visual Studio design placed on the front. Check the artwork resolution message.');refreshUI();}
  function setBusy(value,label){exporting=value;root.setAttribute('aria-busy',String(value));root.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=value);if(!value){refreshUI();}else $('kdp-export-pdf').textContent=label||'Preparing export…';if(!value)$('kdp-export-pdf').textContent='Export KDP PDF';}
  async function exportCover(kind){
    const p=clone(project),v=window.KdpGeometry.validate(p.settings);if(v.errors.length)throw new Error(v.errors.join(' '));
    setBusy(true);
    try{
      const g=window.KdpGeometry.calculate(p.settings);await waitFonts(p);const images=await loadImages(p),extra=extraChecks(p,g,images);if(extra.errors.length)throw new Error(extra.errors.join(' '));
      const dpi=kind==='proof'?110:300,canvas=document.createElement('canvas');canvas.width=Math.ceil(g.totalW*dpi);canvas.height=Math.ceil(g.totalH*dpi);
      const report=window.KdpRender.render(canvas.getContext('2d',{alpha:false}),g,p,{dpi,guides:kind==='proof',images});if(kind!=='proof'&&report.errors.length)throw new Error(report.errors.join(' '));
      let blob;const stem=filename()+'_'+p.settings.format+'_'+g.effectivePages+'pp';
      if(kind==='pdf'){
        if(!window.PDFLib)throw new Error('The PDF library is unavailable. Check your connection and reload.');
        const png=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not create cover image.')),'image/png'));
        const pdf=await window.PDFLib.PDFDocument.create();const page=pdf.addPage([g.totalW*72,g.totalH*72]);const img=await pdf.embedPng(await png.arrayBuffer());page.drawImage(img,{x:0,y:0,width:g.totalW*72,height:g.totalH*72});
        pdf.setTitle(p.name+' — '+p.settings.format+' cover');pdf.setSubject('Single-page full cover; 300 DPI; guides omitted');pdf.setCreator('SeferStudio Pro KDP Cover Studio');
        const bytes=await pdf.save();if(bytes.length>650*1024*1024)throw new Error('This cover exceeds KDP’s PDF size limit. Use smaller artwork.');blob=new Blob([bytes],{type:'application/pdf'});download(blob,stem+'_KDP_Cover.pdf');
      }else{blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not create cover image.')),'image/png'));blob=new Blob([window.KdpPng.withDpi(await blob.arrayBuffer(),dpi)],{type:'image/png'});download(blob,stem+(kind==='proof'?'_PROOF_WITH_GUIDES':'_300dpi')+'.png');}
      setStatus(`${kind==='proof'?'Proof with guides':'Print cover'} downloaded · ${g.totalW.toFixed(3)} × ${g.totalH.toFixed(3)} in · ${(blob.size/1048576).toFixed(1)} MB.${blob.size>40*1048576?' KDP recommends keeping the file below 40 MB.':''}`);
    }finally{setBusy(false);}
  }
  function open(){if(!root)buildUI();lastFocus=document.activeElement;root.hidden=false;refreshUI();$('kdp-close').focus();}
  function close(){root.hidden=true;renderSequence++;if(location.hash==='#/studio/cover')location.hash='#/studio/design';if(lastFocus?.isConnected)lastFocus.focus();}
  function init(){try{const stored=localStorage.getItem(STORAGE_KEY);if(stored)project=validateProject(JSON.parse(stored));}catch(_){/* Keep invalid older drafts out of this editor. */}
    document.addEventListener('click',e=>{if(e.target.closest('[data-kdp-open]')){e.preventDefault();location.hash='#/studio/cover';open();}});
    window.addEventListener('hashchange',()=>{if(location.hash==='#/studio/cover')open();else if(root&&!root.hidden){root.hidden=true;renderSequence++;}});
    if(location.hash==='#/studio/cover')open();
  }
  window.KdpCoverStudio={open,defaultProject,validateProject};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
