/* ============ utils ============ */
function $(id){return document.getElementById(id)}
let _uid=1; function uid(){return 'id'+(Date.now().toString(36))+(_uid++)}
/* Marks saved before r21 carry no id, so undo could never match their
   spans. Give each id-less annotation a fresh id when a book is loaded
   or restored; the id only targets the mark's spans. Returns true when
   at least one id was assigned. */
function backfillAnnoIds(list){
  let changed=false;
  (list||[]).forEach(a=>{ if(a&&!a.id){ a.id=uid(); changed=true; } });
  return changed;
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
let toastT=null;
function toast(msg,ms){let t=$('toast');t.textContent=msg;t.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>t.style.display='none',ms||2600)}
function download(name, blob){let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},400)}
function closeModal(id){ var d=$(id); if(d && d.open) d.close(); }
/* Open a native <dialog> if it is not already open (showModal throws when the dialog is already open). */
function openDialog(id){ var d=$(id); if(d && !d.open) d.showModal(); }
/* Light dismiss for dialogs with closedby="any" where the browser does not support the closedby attribute yet (Safari). Esc and the back gesture already close modals everywhere; this only adds tap-outside-to-close. */
if(typeof HTMLDialogElement!=='undefined' && !('closedBy' in HTMLDialogElement.prototype)){
  const outside=(e,d)=>{ const r=d.getBoundingClientRect(); return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom; };
  for(const d of document.querySelectorAll('dialog[closedby="any"]')){
    let pressedOutside=false;
    d.addEventListener('pointerdown',e=>{ pressedOutside=outside(e,d); });
    d.addEventListener('pointerup',e=>{ if(pressedOutside && outside(e,d)) d.close(); });
  }
}
let pendingConfirm=null;
function askConfirm(title,text,fn){$('confirmTitle').textContent=title;$('confirmText').textContent=text;pendingConfirm=fn;openDialog('confirmModal')}
function doConfirm(){closeModal('confirmModal');if(pendingConfirm){let f=pendingConfirm;pendingConfirm=null;f()}}
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  closeAllPopovers();
  let lh=$('libHint'); if(lh) lh.style.visibility='';
});
function icon(name,cls){ return '<svg class="ic '+(cls||'')+'" aria-hidden="true"><use href="#ticon-'+name+'"></use></svg>'; }
function setBtnContent(id,iconName,label){ let b=$(id); if(b) b.innerHTML=icon(iconName,'ic-sm')+' '+label; }

/* ============ theme ============ */
const THEME_KEY='inkwell-theme';
function effectiveTheme(){ return document.documentElement.dataset.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function syncThemeToggle(){
  let b=$('themeToggle'); if(!b) return;
  let dark=effectiveTheme()==='dark';
  b.innerHTML=icon(dark?'sun':'moon');
  let label=dark?'Switch to light theme':'Switch to dark theme';
  b.setAttribute('aria-label',label); b.title=label;
  let meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute('content',dark?'#11151B':'#EDE7DA');
}
function applyTheme(t){ document.documentElement.dataset.theme=t; try{ localStorage.setItem(THEME_KEY,t); }catch(e){} syncThemeToggle(); }
function toggleTheme(){ applyTheme(effectiveTheme()==='dark'?'light':'dark'); }
if(window.matchMedia){
  let mq=window.matchMedia('(prefers-color-scheme: dark)');
  let onSystemTheme=()=>{ if(!document.documentElement.dataset.theme) syncThemeToggle(); };
  if(mq.addEventListener) mq.addEventListener('change',onSystemTheme);
  else if(mq.addListener) mq.addListener(onSystemTheme);
}
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented) return;
  let el=document.activeElement, tag=el?el.tagName:'';
  let typing=/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (el&&el.isContentEditable);
  if((e.key==='/' && !typing) || ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k')){
    /* The palette IS the search now: / and Cmd/Ctrl+K open it from
       anywhere (library, reader, editor) — except while typing, where
       / and Ctrl+K must type. The dialog lives outside the views so
       it renders from any of them. */
    e.preventDefault(); openPalette();
  }
});

/* Shared motion helpers used by the reader and Parallel Read. */
function prefersReducedMotion(){ return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function smoothOrInstant(){ return prefersReducedMotion()? 'auto' : 'smooth'; }

/* ============ architecture note (P12) ============
   This app stays one classic script on purpose: the markup calls these
   functions from inline onclick/onchange/oninput handlers, so they
   must remain globals, an ES-module conversion would break every
   handler, and no automated test suite is added in this pass. The
   hygiene that IS in place: a section banner per feature area, single
   entry points where several callers used to diverge (closeAllPopovers
   for popover dismissal, setTimerLabel for the focus countdown,
   setSearchChrome for search-state chrome), and render-time helpers
   (isDarkPage / pageInkColor) instead of scattered conditionals.
   Global state remains the single store S plus small per-feature
   module-level variables. Splitting the file, removing the global
   store, modules and tests are all intentionally left undone. */

/* ============ state ============ */
const CW=1200, CH=1697; /* A4 portrait (1200 x 1697): blank pages are portrait
  like real notebook paper, so the page fills the phone screen instead of
  sitting as a short landscape strip with empty space around it. */
let PH=CH; /* live height of the page being edited; PDF-backed pages set it
  from the PDF page ratio instead */
function pageH(p){ if(p&&p.bgPdf&&p.bgPdf.img&&p.bgPdf.img.width&&p.bgPdf.img.height){ return Math.max(400,Math.min(2200,Math.round(CW*p.bgPdf.img.height/p.bgPdf.img.width))); } return CH; }
/* Zoom sharpness: the editor canvases used to keep a fixed 1200px backing
   store while zoom widened the shell in CSS, so at 150-250% the browser
   upscaled the bitmap and ink went soft (at 200% on a DPR-2 phone the
   1200px store is shown at ~1460 device px). The backing store now tracks
   the displayed size (x devicePixelRatio, capped), and strokes - stored as
   vectors - are redrawn at that resolution when the zoom settles, so
   writing stays crisp at any zoom. canvasScale = backing px per canvas unit
   (1 = the old 1200px store, never worse). */
let canvasScale=1, zoomRescaleT=null;
function canvasScaleTarget(){ let shell=$('canvasShell'); if(!shell||!curPageObj()) return 1; let w=shell.getBoundingClientRect().width; if(!w) return 1; let dpr=Math.min(window.devicePixelRatio||1,2); let k=(w*dpr)/CW; k=Math.min(k,2200/CW,Math.sqrt(8e6/(CW*PH))); return Math.max(1,k); }
function applyCanvasTransform(){ [bgX,hiX,inkX,liveX].forEach(c=>{ c.setTransform(canvasScale,0,0,canvasScale,0,0); }); }
function rescaleCanvases(){ if(!curPageObj()||S.view!=='editor') return; let k=canvasScaleTarget(); if(Math.abs(k-canvasScale)<0.02){ syncSplitPaneHeight(); return; } canvasScale=k; redrawAll(); syncSplitPaneHeight(); }
function syncPageHeight(){ let h=pageH(curPageObj()); let W=Math.round(CW*canvasScale), H=Math.round(h*canvasScale); if(h!==PH||bgC.width!==W||bgC.height!==H){ PH=h; [bgC,hiC,inkC,liveC].forEach(c=>{c.width=W;c.height=H;}); [bgX,hiX,inkX,liveX].forEach(c=>{c.lineCap='round';c.lineJoin='round'}); } applyCanvasTransform(); }
const SAMPLE_ID='sample-book';
function blankPage(){return {ink:[],hi:[],text:'',stickies:[],table:null,board:null,audio:null,bgPdf:null,texts:[],images:[],texs:[],bgColor:'#fffdf6'}}
function blankBoard(){return {color:0,strokes:[],view:{x:0,y:0,k:1},geom:null}}
const BOARD_COLORS=['#fffdf6','#f6e8c8','#d9e9f7','#dcf0dd','#f8e0e0','#e6def6','#39404e'];
let S={
  items:[], filter:'all', recent:false,
  curNbId:null, curBookId:null,
  tool:'pen', color:'#18202B',
  undoStack:[], redoStack:[],
  view:'library',
  stats:{writeSec:0, readSec:0, strokes:0, pagesRead:{}, focusDone:0},
  split:false, focusMode:false, recording:false, recStart:0,
  searchResults:[], zoom:1, selection:[], selRect:null, paletteItems:[], paletteSel:-1,
  strokeStyle:'solid', eraserMode:'stroke', stabilize:28, snapGrid:false, clipboard:[]
};
function curNb(){return S.items.find(i=>i.id===S.curNbId)||null}
function curBook(){return S.items.find(i=>i.id===S.curBookId)||null}
function curPageObj(){let nb=curNb();if(!nb)return null;return nb.pages[nb.cur]||null}

/* ============ persistence: the shelf lives in this browser (IndexedDB) ============
   Everything used to live only in this tab's memory, so closing or
   reloading the tab wiped the whole shelf. Now the library is written to
   IndexedDB on this device: notebooks in full (ink, text, stickies,
   boards, page images, audio blobs, PDF-page backgrounds), EPUB chapters,
   PDF metadata + reading positions, bookmarks, annotations and stats.
   Imported PDF files are stored as their own records ('pdf:<id>') so the
   reader can reopen them after a reload without re-importing.
   Startup never waits for any of this: the shelf paints first and the
   saved shelf swaps in when the restore lands; a PDF is parsed only when
   its book is opened (ensurePdfDoc), and annotated-page backgrounds are
   decoded one page at a time as they are viewed (decodeBgPdfImg).
   Saves are debounced, flushed when the tab is hidden/closed, and a
   periodic signature check catches any edit path that forgot to ask. */
const IDB_NAME='inkwell-db', IDB_STATE_KEY='library-v1';
let persistReady=false, persistDirty=false, persistSaving=false, persistSaveAgain=false, inSave=false, lastSaveAt=0, saveTimer=null, restoreToken=0, startHash='';
function idbOpen(){ return new Promise((res,rej)=>{ if(!('indexedDB' in window)){ rej(new Error('IndexedDB unavailable')); return; } let rq=indexedDB.open(IDB_NAME,1); rq.onupgradeneeded=()=>{ if(!rq.result.objectStoreNames.contains('kv')) rq.result.createObjectStore('kv'); }; rq.onsuccess=()=>{ const db = rq.result; db.onversionchange = () => { db.close(); _idbP = null; }; res(db); }; rq.onerror=()=>rej(rq.error); rq.onblocked=()=>rej(new Error('IndexedDB blocked')); }); }
let _idbP=null; function idb(){ if(!_idbP) _idbP = idbOpen().catch(err => { _idbP = null; throw err; }); return _idbP; }
async function idbGet(key){ let db=await idb(); return new Promise((res,rej)=>{ let rq=db.transaction('kv','readonly').objectStore('kv').get(key); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }
async function idbPut(key,val){ let db=await idb(); return new Promise((res,rej)=>{ let tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(val,key); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error); }); }
async function idbDel(key){ try{ let db=await idb(); await new Promise(res=>{ let tx=db.transaction('kv','readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete=()=>res(); tx.onerror=()=>res(); tx.onabort=()=>res(); }); }catch(e){} }
function persistPdfFile(book){ if(book && book.fileData) return idbPut('pdf:'+book.id, book.fileData); return Promise.resolve(); }
function deletePdfFile(id){ idbDel('pdf:'+id); }
function updateSaveStatus(failed){
  let el=$('saveStatus'); if(!el) return;
  if(failed){ el.textContent='Could not save in this browser. Use Backup to keep your notes safe.'; return; }
  el.textContent= lastSaveAt? 'Saved '+new Date(lastSaveAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'Saved';
}
function scheduleSave(){ if (!persistReady) return; persistDirty = true; if (inSave) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }
function bgPdfImgData(bg){
  if(!bg) return null;
  if(bg._imgData && bg._imgDataFor===bg.img) return bg._imgData;
  if(!bg.img) return bg.imgData||null; /* restored page whose background has not been decoded yet, its saved data URL is still the lossless form */
  try{
    let src=bg.img, c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
    let x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(src,0,0);
    bg._imgData=c.toDataURL('image/jpeg',0.85); bg._imgDataFor=src; return bg._imgData;
  }catch(e){ return null; }
}
function serializeLibrary(){
  return { v:1, savedAt:Date.now(), stats:S.stats,
    items:S.items.map(it=>{
      if(it.kind==='notebook') return {id:it.id,kind:'notebook',title:it.title,color:it.color,template:it.template,cur:it.cur,updated:it.updated,openedAt:it.openedAt||0,annotations:it.annotations||[],pdfBookId:it.pdfBookId||null,splitBookId:it.splitBookId||null,
        pages:(it.pages||[]).map(p=>({ink:p.ink||[],hi:p.hi||[],text:p.text||'',stickies:p.stickies||[],table:p.table||null,texts:p.texts||[],texs:p.texs||[],bgColor:p.bgColor||'#fffdf6',
          images:(p.images||[]).map(im=>({id:im.id,x:im.x,y:im.y,w:im.w,h:im.h,src:im.src})),
          board:p.board?{color:p.board.color,strokes:p.board.strokes,view:p.board.view,geom:p.board.geom||null}:null,
          audio:(p.audio&&p.audio.blob)?{blob:p.audio.blob,dur:p.audio.dur}:null,
          bgPdf:p.bgPdf?{page:p.bgPdf.page,bookTitle:p.bgPdf.bookTitle,imgData:bgPdfImgData(p.bgPdf),w:(bgPdfSize(p.bgPdf)||[])[0]||null,h:(bgPdfSize(p.bgPdf)||[])[1]||null}:null }))};
      if(it.kind==='pdf') return {id:it.id,kind:'pdf',title:it.title,color:it.color,updated:it.updated,openedAt:it.openedAt||0,sample:!!it.sample,fileName:it.fileName,numPages:it.numPages,page:it.page,mode:it.mode,bookmarks:it.bookmarks||[],annotations:it.annotations||[],textCache:it.textCache||{},parallelNotes:it.parallelNotes||{},parallelWith:it.parallelWith||null,parallelSync:it.parallelSync||'unit',parallelOffset:it.parallelOffset||0,parallelZoom:it.parallelZoom||1,ocrPages:it.ocrPages||{},markColor:it.markColor||null,markOpacity:(typeof it.markOpacity==='number'? it.markOpacity : 0.6),markSettings:it.markSettings||null};
      return {id:it.id,kind:'epub',title:it.title,color:it.color,updated:it.updated,openedAt:it.openedAt||0,sample:!!it.sample,ch:it.ch||0,mode:it.mode||'scroll',bookmarks:it.bookmarks||[],annotations:it.annotations||[],parallelNotes:it.parallelNotes||{},parallelWith:it.parallelWith||null,parallelSync:it.parallelSync||'unit',parallelOffset:it.parallelOffset||0,parallelZoom:it.parallelZoom||1,parallelInk:it.parallelInk||{},chapters:it.chapters||[],markColor:it.markColor||null,markOpacity:(typeof it.markOpacity==='number'? it.markOpacity : 0.6),markSettings:it.markSettings||null};
    })};
}
async function saveNow(){
  if(!persistReady) return;
  if(persistSaving){ persistSaveAgain=true; return; }
  persistSaving=true; persistDirty=false; inSave=true;
  try{
    let nb=curNb(); if(nb){ let p=nb.pages[nb.cur]; if(p) p.text=$('noteText').value; }
    await idbPut(IDB_STATE_KEY, serializeLibrary());
    lastSaveAt=Date.now(); updateSaveStatus(false);
  }catch(e){ persistDirty=true; updateSaveStatus(true); }
  inSave=false; persistSaving=false;
  if(persistSaveAgain || persistDirty){ persistSaveAgain=false; scheduleSave(); }
}
function dataUrlToCanvas(url){ return new Promise((res,rej)=>{ let img=new Image(); img.onload=()=>{ let c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight; c.getContext('2d').drawImage(img,0,0); res(c); }; img.onerror=()=>rej(new Error('image failed')); img.src=url; }); }
/* The size of a PDF page behind a notebook page, in PDF points: stored
   w/h first, else the decoded background picture, else null (callers fall
   back to the book's page sizes or Letter). This helper was called in
   three places but never defined, so every save threw and the reading-mode
   ink overlay could never draw. */
function bgPdfSize(bg){
  if(!bg) return null;
  if(bg.w && bg.h) return [bg.w, bg.h];
  if(bg.img && bg.img.width && bg.img.height) return [bg.img.width, bg.img.height];
  return null;
}
/* A restored notebook page keeps its PDF background as a data URL and
   decodes it only when the page is actually viewed, decoding every
   page of every notebook during startup was a major cause of the slow
   first paint. Repaints if the decoded page is the one on screen. */
function decodeBgPdfImg(p){
  if(!p || !p.bgPdf || p.bgPdf.img) return Promise.resolve();
  if(p.bgPdf._decodeP) return p.bgPdf._decodeP;
  let work;
  if(p.bgPdf.imgData) work=dataUrlToCanvas(p.bgPdf.imgData).then(c=>{ p.bgPdf.img=c; bumpV(p); /* refresh its thumbnail and save the picture, same as the PDF-draw path below */ });
  else {
    /* no stored picture yet, a page of an annotation notebook started from Parallel Read: draw it
       from the PDF itself, once, at the editor's page width (then it is saved like any other) */
    let nb=S.items.find(n=>n.kind==='notebook' && n.pdfBookId && n.pages.indexOf(p)>=0);
    let book=nb && S.items.find(i=>i.id===nb.pdfBookId && i.kind==='pdf');
    if(!book) return Promise.resolve();
    work=(async()=>{
      if(!(await ensurePdfDoc(book))) return;
      let page=await book.doc.getPage(p.bgPdf.page), v0=page.getViewport({scale:1}), vp=page.getViewport({scale:CW/v0.width});
      let cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
      await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
      p.bgPdf.img=cv; p.bgPdf.w=p.bgPdf.w||v0.width; p.bgPdf.h=p.bgPdf.h||v0.height;
      bumpV(p); /* refresh its thumbnail and save the picture */
    })();
  }
  p.bgPdf._decodeP=work.catch(()=>{}).then(()=>{ p.bgPdf._decodeP=null; let nb=curNb(); if(nb && nb.pages[nb.cur]===p && S.view==='editor'){ redrawAll(); renderPages(); } /* the page's background just landed — refresh its thumbnail too, so the Pages panel shows the PDF preview instead of the blank template it was drawn with before the decode. This also covers warmed pages and the stored-picture path, whose decodes never reach renderPages. */ if(p.bgPdf && p.bgPdf.img && nb && nb.pages.indexOf(p)>=0) drawPageThumb(nb.pages.indexOf(p)); syncSplitPaneHeight(); splitRefitCurrentPage(); });
  return p.bgPdf._decodeP;
}
async function restoreLibrary(token){
  let data=await idbGet(IDB_STATE_KEY);
  if(token!==restoreToken) return false;
  if(!data || !Array.isArray(data.items) || !data.items.length) return false;
  if(data.stats) S.stats=data.stats;
  let items=[];
  for(let raw of data.items){
   try{
    if(raw.kind==='notebook'){
      let nb={id:raw.id,kind:'notebook',title:raw.title||'Untitled notebook',color:raw.color||'#b4552d',template:raw.template||'lined',cur:raw.cur||0,updated:raw.updated||'',openedAt:raw.openedAt||0,annotations:raw.annotations||[],pdfBookId:raw.pdfBookId||null,splitBookId:raw.splitBookId||null,pages:[]};
      for(let rp of (raw.pages||[])){
        let p=blankPage();
        p.ink=rp.ink||[]; p.hi=rp.hi||[]; p.text=rp.text||''; p.stickies=rp.stickies||[]; p.table=rp.table||null;
        p.texts=rp.texts||[]; p.texs=rp.texs||[]; p.bgColor=rp.bgColor||'#fffdf6';
        p.images=(rp.images||[]).map(im=>({id:im.id||uid(),x:im.x,y:im.y,w:im.w,h:im.h,src:im.src}));
        p.board=rp.board?{color:rp.board.color||0,strokes:rp.board.strokes||[],view:rp.board.view||{x:0,y:0,k:1},geom:rp.board.geom||null}:null;
        if(rp.audio && rp.audio.blob){ try{ p.audio={blob:rp.audio.blob,dur:rp.audio.dur||0,url:URL.createObjectURL(rp.audio.blob)}; }catch(e){} }
        if(rp.bgPdf){ /* keep the data URL and decode it lazily when the page is viewed, decoding every page here was a big part of the slow startup */
          p.bgPdf={page:rp.bgPdf.page,bookTitle:rp.bgPdf.bookTitle,img:null,imgData:rp.bgPdf.imgData||null,w:rp.bgPdf.w||null,h:rp.bgPdf.h||null}; }
        nb.pages.push(p);
      }
      if(!nb.pages.length) nb.pages.push(blankPage());
      if(nb.cur>=nb.pages.length) nb.cur=nb.pages.length-1; if(nb.cur<0) nb.cur=0;
      items.push(nb);
    } else if(raw.kind==='pdf'){
      let b={id:raw.id,kind:'pdf',title:raw.title||'PDF',color:raw.color||'#4a5a74',updated:raw.updated||'',openedAt:raw.openedAt||0,sample:!!raw.sample,fileName:raw.fileName||raw.title,numPages:raw.numPages||0,page:raw.page||1,mode:raw.mode||'scroll',bookmarks:raw.bookmarks||[],annotations:raw.annotations||[],textCache:raw.textCache||{},parallelNotes:raw.parallelNotes||{},parallelWith:raw.parallelWith||null,parallelSync:raw.parallelSync||'unit',parallelOffset:+raw.parallelOffset||0,parallelZoom:+raw.parallelZoom||1,ocrPages:raw.ocrPages||{},markColor:raw.markColor||null,markOpacity:(typeof raw.markOpacity==='number'? raw.markOpacity : 0.6),markSettings:(raw.markSettings&&typeof raw.markSettings==='object')? raw.markSettings : null,doc:null,fileData:null};
      try{
        let fd=await idbGet('pdf:'+raw.id);
        if(fd) b.fileData=fd;
        /* No pdf.js parse here. Parsing every book on the shelf during
           startup was slow, and a failed background parse (its errors
           were swallowed) left the book unopenable even though its bytes
           were safe in this browser. ensurePdfDoc() parses from these
           bytes when the book is actually opened, and re-reads this
           record first if the bytes are missing. */
      }catch(e){}
      items.push(b);
    } else if(raw.kind==='epub'){
      items.push({id:raw.id,kind:'epub',title:raw.title||'Book',color:raw.color||'#2e6f6a',updated:raw.updated||'',openedAt:raw.openedAt||0,sample:!!raw.sample,ch:raw.ch||0,mode:raw.mode||'scroll',bookmarks:raw.bookmarks||[],annotations:raw.annotations||[],parallelNotes:raw.parallelNotes||{},parallelWith:raw.parallelWith||null,parallelSync:raw.parallelSync||'unit',parallelOffset:+raw.parallelOffset||0,parallelZoom:+raw.parallelZoom||1,parallelInk:(raw.parallelInk&&typeof raw.parallelInk==='object')? raw.parallelInk : {},chapters:raw.chapters||[],markColor:raw.markColor||null,markOpacity:(typeof raw.markOpacity==='number'? raw.markOpacity : 0.6),markSettings:(raw.markSettings&&typeof raw.markSettings==='object')? raw.markSettings : null});
    }
   }catch(e){ /* one damaged item must not cost the whole shelf */ }
  }
  if(token!==restoreToken || !items.length) return false;
  /* merge, not replace: anything created while a slow restore was still
     running (e.g. on the starter shelf) survives the swap */
  let preExisting=S.items.filter(i=> items.every(r=>r.id!==i.id));
  S.items=items.concat(preExisting);
  /* Backfill ids for legacy marks (see backfillAnnoIds): without an id
     undo cannot match a mark's spans, so every id-less annotation gets
     one now, and the list is re-saved so the ids stick. */
  let backfilled=false;
  S.items.forEach(it=>{ if(it.annotations&&backfillAnnoIds(it.annotations)) backfilled=true; });
  if(backfilled) scheduleSave();
  return true;
}
/* Turn a PDF book's stored bytes into a readable pdf.js doc, on demand.
   Tries, in order: the bytes already in memory, a fresh read of the
   book's own 'pdf:<id>' record (the startup restore may have raced or
   skipped it), and, for the built-in demo, freshly generated bytes.
   Only when all of those come up empty is the file really gone. This
   replaces the old restore-time background parse, whose failures were
   swallowed and left restored books unopenable after a reload. */
function ensurePdfDoc(b){
  if(!b || b.kind!=='pdf') return Promise.resolve(false);
  if(b.doc) return Promise.resolve(true);
  if(b._docP) return b._docP;
  b._docP=(async()=>{
    try{
      if(!b.fileData){ try{ let fd=await idbGet('pdf:'+b.id); if(fd) b.fileData=fd; }catch(e){} }
      if(!b.fileData && b.id===SAMPLE_PDF_ID){ let bytes=buildSamplePdfBytes(); b.fileData=bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength); persistPdfFile(b).catch(()=>{}); }
      if(!b.fileData) return false;
      if(!window.pdfjsLib) return false;
      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      let doc;
      if(b.fileData instanceof Blob){
        /* Imported files are stored as the File itself: open by blob URL
           so no copy of the bytes is made. The URL is kept while the
           book lives (pdf.js fetched the whole file at load — blob URLs
           have no range support — so nothing re-fetches it later). */
        if(!b._pdfUrl) b._pdfUrl=URL.createObjectURL(b.fileData);
        doc=await pdfjsLib.getDocument({url:b._pdfUrl,isEvalSupported:false}).promise;
      } else {
        /* Older saved records and the built-in sample keep their bytes as
           an ArrayBuffer; pdf.js may detach the buffer it is given, so
           hand it a copy and keep the stored one intact. */
        doc=await pdfjsLib.getDocument({data:b.fileData.slice(0),isEvalSupported:false}).promise;
      }
      b.doc=doc; b.numPages=doc.numPages;
      return true;
    }catch(e){ return false; }
    finally{ b._docP=null; }
  })();
  return b._docP;
}
function librarySignature(){
  /* Cheap numeric digest, checked every 4s as a safety net for changes
     that bypass scheduleSave(). The old version built strings out of
     every sticky's text, every table row and every board geometry on
     every page — on a 3,000-page notebook that was a long string build
     every 4 seconds. Counts and versions detect the same changes; the
     4s net only ever triggers a debounced save, so a rare collision
     costs nothing (the direct scheduleSave paths still fire). */
  try{
    return S.items.map(it=> it.kind==='notebook'
      ? 'n:'+it.title+':'+it.cur+':'+it.pages.length+':'+it.pages.reduce((a,p)=>a+(p._v||0)+(p.ink?p.ink.length:0)+(p.hi?p.hi.length:0)+((p.text||'').length)+((p.stickies||[]).length)+(p.texts?p.texts.length:0)+(p.texs?p.texs.length:0)+(p.images?p.images.length:0)+(p.audio?1:0)+(p.board&&p.board.strokes?p.board.strokes.length:0)+(p.board&&p.board.geom?((p.board.geom.x|0)+(p.board.geom.y|0)+(p.board.geom.w|0)+(p.board.geom.h|0)):0),0)
      : it.kind+':'+(it.title||'')+':'+(it.annotations||[]).length+':'+(it.bookmarks||[]).length+':'+(it.page||it.ch||0)+':'+Object.keys(it.parallelNotes||{}).length
    ).join('|')+'#'+S.stats.strokes+'#'+S.stats.focusDone;
  }catch(e){ return ''; }
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') saveNow(); });
window.addEventListener('pagehide',()=>{ saveNow(); });

/* ============ sample book (built-in, so reader tools work offline) ============ */
function sampleBook(){
  const ch=(t,paras)=>({title:t, html:paras.map(p=>'<p>'+p+'</p>').join(''), text:paras.join('\n\n')});
  return { id:SAMPLE_ID, kind:'epub', title:'The Art of Slow Reading', sample:true, updated:'Sample',
    ch:0, mode:'scroll', bookmarks:[], annotations:[], parallelNotes:{},
    chapters:[
      ch('Why speed lies',[
        'Reading slowly is not reading less. It is noticing what speed hides: the turn of an argument, the weight of a word, the place where you stopped agreeing and started merely nodding. A page read once, carefully, stays with you longer than three pages skimmed in a hurry.',
        'Speed feels like progress because it produces a number: pages turned, chapters finished. But a number is not understanding. The reader who races to the end of a chapter often arrives there having met none of its ideas, the way a traveller who flies over a country has visited it without ever standing in it.',
        'Slow reading begins with permission: permission to stop, to re-read a sentence, to argue in the margin. The margin is where reading becomes thinking. A mark in the margin is a small act of honesty: here I was confused, here I disagreed, here something mattered.',
        'Try it with this book. Select any sentence and highlight it. Add a bookmark where you want to return. Switch the theme to Sepia or Night. Press Listen and hear the page read aloud. Nothing here is locked, and everything you mark is saved in this browser, so it is still here when you come back.']),
      ch('Margins and marks',[
        'Every serious reader develops a private shorthand: a star for what matters, a question mark for what doubts, a line beside what sings. These marks are not vandalism. They are the visible half of a conversation between the reader and the page.',
        'Annotations age well. Return to a book after a year and your old marks show you who you were: what you feared, what you hoped, what you had not yet understood. The unmarked page tells you nothing about the person who read it.',
        'That is why this reader keeps your highlights in a list beside the text, and why you can export them. A highlight you cannot find again is only a coloured sentence; a highlight you can revisit is a thought you can build on.']),
      ch('Reading aloud',[
        'Reading aloud is the oldest form of slow reading. The voice cannot skim: it must give every word its moment, and in doing so it catches what the eye forgives: the clumsy sentence, the hidden rhythm, the argument that only sounds convincing.',
        'Poets have always known this, and so have teachers. A paragraph read aloud either holds together or falls apart in the mouth. When you study, read your notes aloud once; the parts you stumble on are the parts you do not yet know.',
        'Use the Listen bar below to hear this chapter. Change the accent, slow the voice down, and notice how the same words become a different text when they are given time.']),
      ch('The quiet habit',[
        'Slow reading is not a technique to master but a habit to keep: one page with full attention is worth more than a chapter at a glance. Keep the book open a moment after you finish. Let the last sentence settle.',
        'Then close it, and write one line of your own. Reading that ends in writing is reading that stays.'])
    ]};
}

/* ============ sample PDF (built-in demo, generated in-app) ============
   A real four-page PDF with real selectable text, assembled byte by
   byte right here, nothing to fetch, then handed to the reader
   exactly like an imported PDF: its bytes are stored in this browser
   under the same 'pdf:<id>' record, and its bookmarks, highlights and
   reading place persist with the rest of the shelf. */
const SAMPLE_PDF_ID='sample-pdf';
function samplePdfBook(){
  return { id:SAMPLE_PDF_ID, kind:'pdf', title:'Welcome to Inkwell: Demo PDF', sample:true, color:'#4a5a74', updated:'Sample',
    fileName:'inkwell-welcome-demo.pdf', numPages:4, page:1, mode:'scroll', bookmarks:[], annotations:[], textCache:{}, parallelNotes:{}, doc:null, fileData:null };
}
function buildSamplePdfBytes(){
  const escPdf=s=>String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  /* lines: [font (h=Helvetica, b=Helvetica-Bold), size, leading, text] */
  const pages=[
    [ ['b',27,36,'Welcome to Inkwell'],
      ['h',13,24,'A short demo PDF, built right into the app'],
      ['h',11.5,20,''],
      ['h',11.5,17,'This is a real PDF with real, selectable text. Everything you can'],
      ['h',11.5,17,'do with a PDF you import yourself, you can try here first: read'],
      ['h',11.5,17,'it, highlight a sentence, drop a bookmark, and open it as notebook'],
      ['h',11.5,17,'pages to write on with pen, highlighter and the floating board.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'Nothing here needs an account. Your books, notes and marks are'],
      ['h',11.5,17,'saved in this browser, on this device, so the shelf you build'],
      ['h',11.5,17,'today is still here when you come back tomorrow.'],
      ['h',11.5,24,''],
      ['b',14,22,'Try this first'],
      ['h',11.5,17,'1. Drag across this sentence to select it, then tap Highlight.'],
      ['h',11.5,17,'2. Tap Bookmark in the bar above to keep this page.'],
      ['h',11.5,17,'3. Tap Annotate this PDF to write on a copy of the page.'] ],
    [ ['b',22,32,'Reading, your way'],
      ['h',11.5,17,'Books open in reading mode first. Scroll mode flows page after'],
      ['h',11.5,17,'page like a long sheet; Page mode shows one page at a time, with'],
      ['h',11.5,17,'Prev and Next to move between them. Your place is remembered'],
      ['h',11.5,17,'either way, so you can stop mid-chapter and pick up later.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'The side panel keeps the table of contents, your bookmarks and'],
      ['h',11.5,17,'page thumbnails together, plus a list of every annotation you'],
      ['h',11.5,17,'make - a highlight you add today is one tap away next week.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'Themes restyle the page: Paper for daylight, Sepia for a warmer'],
      ['h',11.5,17,'sheet, Night for reading in the dark. The text size steps up and'],
      ['h',11.5,17,'down from the same bar, and Listen reads the page aloud.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'Select any word to highlight it, underline it or mark it in colour,'],
      ['h',11.5,17,'or run OCR over a scanned page to pull its print into text you'],
      ['h',11.5,17,'can copy straight into a notebook.'] ],
    [ ['b',22,32,'Marking up a PDF'],
      ['h',11.5,17,'Highlight, underline and strikethrough work on selected text in'],
      ['h',11.5,17,'the reader. Marks are stored as annotations on the book itself,'],
      ['h',11.5,17,'so they survive closing the tab and coming back later.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'For handwriting, tap Annotate this PDF. Each page becomes a'],
      ['h',11.5,17,'notebook page with the PDF as its background: write over it with'],
      ['h',11.5,17,'the pen, circle the important parts, add sticky notes, or open'],
      ['h',11.5,17,'the floating board beside the page when you need an endless'],
      ['h',11.5,17,'sheet to think on.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'The board is infinite inside and resizable outside - drag any of'],
      ['h',11.5,17,'its edges or corners to stretch the window bigger or smaller,'],
      ['h',11.5,17,'and it remembers the size you gave it, page by page.'] ],
    [ ['b',22,32,'Make it yours'],
      ['h',11.5,17,'Import your own PDFs and EPUBs from the shelf and they join this'],
      ['h',11.5,17,'demo and the sample book. Notebooks are unlimited: one per'],
      ['h',11.5,17,'subject, per project, per idea that refuses to sit still.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'Everything is saved automatically in this browser. When you want'],
      ['h',11.5,17,'a copy somewhere else, Backup downloads the whole shelf as one'],
      ['h',11.5,17,'file, and Restore brings it back on any device.'],
      ['h',11.5,20,''],
      ['h',11.5,17,'That is the tour. Close this demo, open the sample book, or start'],
      ['h',11.5,17,'a notebook of your own - the shelf is yours now.'] ]
  ];
  const streams=pages.map(lines=>{
    let y=726, out=[];
    lines.forEach(L=>{
      if(L[3]) out.push('BT /'+(L[0]==='b'?'F2':'F1')+' '+L[1]+' Tf 56 '+y.toFixed(1)+' Td ('+escPdf(L[3])+') Tj ET');
      y-=L[2];
    });
    return out.join('\n');
  });
  const f1=3+2*pages.length, f2=f1+1, info=f2+1;
  let objs=[];
  objs[1]='<< /Type /Catalog /Pages 2 0 R >>';
  objs[2]='<< /Type /Pages /Kids ['+pages.map((_,i)=>(3+2*i)+' 0 R').join(' ')+'] /Count '+pages.length+' >>';
  pages.forEach((_,i)=>{
    objs[3+2*i]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 '+f1+' 0 R /F2 '+f2+' 0 R >> >> /Contents '+(4+2*i)+' 0 R >>';
    objs[4+2*i]='<< /Length '+streams[i].length+' >>\nstream\n'+streams[i]+'\nendstream';
  });
  objs[f1]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[f2]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[info]='<< /Title (Welcome to Inkwell - Demo PDF) /Author (Inkwell) /Creator (Inkwell) >>';
  let pdf='%PDF-1.4\n', offsets=[0];
  for(let n=1;n<objs.length;n++){ offsets[n]=pdf.length; pdf+=n+' 0 obj\n'+objs[n]+'\nendobj\n'; }
  let xrefPos=pdf.length;
  pdf+='xref\n0 '+objs.length+'\n0000000000 65535 f \n';
  for(let n=1;n<objs.length;n++) pdf+=String(offsets[n]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+objs.length+' /Root 1 0 R /Info '+info+' 0 R >>\nstartxref\n'+xrefPos+'\n%%EOF';
  let bytes=new Uint8Array(pdf.length);
  for(let i=0;i<pdf.length;i++) bytes[i]=pdf.charCodeAt(i)&0xff;
  return bytes;
}
let samplePdfBuilding=false;
async function ensureSamplePdf(){
  let b=S.items.find(i=>i.id===SAMPLE_PDF_ID);
  if(!b || b.doc || samplePdfBuilding) return;
  samplePdfBuilding=true;
  try{
    await ensurePdfDoc(b); /* generates + saves the demo bytes on first use, then parses them */
    if(S.view==='library') renderLibrary();
    scheduleSave();
  }catch(e){}
  samplePdfBuilding=false;
}

/* ============ views ============ */
function showView(v){
  if(v!=='reader') closeParallelRead(true); /* measure + save both places while the panes are still on screen */
  S.view=v;
  ['library','editor','reader'].forEach(x=>$('view-'+x).classList.toggle('hidden',x!==v));
  $('mainLayout').classList.toggle('shelf',v==='library');
  document.body.classList.toggle('inEditor',v==='editor'); document.body.classList.toggle('inReader',v==='reader');
  if(v!=='reader'){ var af=$('annotateFab'); if(af) af.classList.add('hidden'); }
  let lh=$('libHint'); if(lh) lh.style.visibility='';
  syncHashForView(v);
  if(v==='library') renderLibrary();
  if(v==='editor' && !curNb()){ // guarantee an editable notebook exists
    let nb=S.items.find(i=>i.kind==='notebook' && !i.pdfBookId);
    if(nb) openNotebook(nb.id); else { createNotebookSilent('Untitled notebook','#b4552d','lined'); }
  }
  window.scrollTo({top:0});
}
function filterLib(f,btn){ S.filter=f; document.querySelectorAll('.chip[data-filter]').forEach(c=>c.classList.toggle('active',c.getAttribute('data-filter')===f)); renderLibrary(); }
function toggleTtsBar(){ let b=$('ttsBar'); b.classList.toggle('hidden'); if(!b.classList.contains('hidden')) b.scrollIntoView({block:'nearest'}); }

/* ============ library ============ */
/* Linked annotation notebooks: the ink store for a PDF. They live in
   S.items (persisted and restored like any notebook, so the marks
   survive a reload) but they are NOT shelf items — annotating a PDF must
   not create a separate file on the home screen. Every user-facing list
   filters them out; the editor, the reading-mode ink overlay and
   Parallel Read reach them by pdfBookId instead. Verified against the
   modern-web-guidance dynamic-sort rule that visual order and DOM order
   must match: the filter happens on the data, before render, so a linked
   notebook never enters the DOM at all — it is not CSS-hidden. */
function isLinkedNb(it){ return !!it && it.kind==='notebook' && !!it.pdfBookId; }
function linkedNbFor(bookId){ return S.items.find(i=>i.kind==='notebook' && i.pdfBookId===bookId); }
function itemPages(it){ if(it.kind==='notebook') return it.pages.length; if(it.kind==='pdf') return it.numPages||0; if(it.kind==='epub') return it.chapters?it.chapters.length:0; return 1 }
function plural(n,one,many){ return n===1? one : (many||one+'s'); }
/* Reading progress for a shelf card, as a percent. Notebooks count the
   page they are open on; PDFs the page, EPUBs the chapter. Never opened
   (openedAt 0) reads 0, not a guess. */
function itemProgress(it){
  if(it.kind==='notebook'){ let t=itemPages(it)||1; return (it.openedAt? Math.min(100,Math.round((it.cur+1)/t*100)) : 0); }
  if(it.kind==='pdf'){ let t=it.numPages||0; return t? Math.min(100,Math.round((it.page||1)/t*100)) : 0; }
  let t=it.chapters?it.chapters.length:0; return t? Math.min(100,Math.round(((it.ch||0)+1)/t*100)) : 0;
}
function renderLibrary(){
  let q=($('globalSearch').value||'').toLowerCase().trim();
  /* P5: with no query in the box the shelf chrome is always restored,
     whatever hid it while a search was in progress. */
  if(!q){ let lg=$('libraryGrid'); if(lg) lg.classList.remove('hidden'); let cr0=$('chipRow'); if(cr0) cr0.classList.remove('hidden'); }
  let items=S.items.filter(n=>{
    if(isLinkedNb(n)) return false; /* annotation stores never appear on the shelf */
    if(S.filter!=='all' && n.kind!==S.filter) return false;
    if(!q) return true;
    return n.title.toLowerCase().includes(q);
  });
  /* Recent tab: most recently opened first. openedAt is a timestamp set
     by openNotebook/openBook and persisted; 0 means never opened, and
     those keep their shelf order at the end (Array.sort is stable). */
  if(S.recent) items.sort((a,b)=>(b.openedAt||0)-(a.openedAt||0));
  let nbCount=S.items.filter(i=>i.kind==='notebook' && !i.pdfBookId).length;
  let bkCount=S.items.filter(i=>i.kind!=='notebook').length;
  let pgCount=S.items.filter(i=>!isLinkedNb(i)).reduce((a,n)=>a+itemPages(n),0);
  let anCount=S.items.reduce((a,n)=>a+((n.annotations||[]).length),0);
  $('statNotebooks').textContent=nbCount;
  $('statBooks').textContent=bkCount;
  $('statPages').textContent=pgCount;
  $('statAnnos').textContent=anCount;
  /* The "1 annotations" bug was real: these labels were static HTML, so
     a single annotation read "1 annotations". They are set here now. */
  let setLab=(id,v)=>{ let el=$(id); if(el) el.textContent=v; };
  setLab('statNotebooksLabel',plural(nbCount,'notebook'));
  setLab('statBooksLabel',plural(bkCount,'book'));
  setLab('statPagesLabel',plural(pgCount,'page'));
  setLab('statAnnosLabel',plural(anCount,'annotation'));
  /* Keep the mobile tab bar in step with the sort state. */
  let tS=$('tabShelf'), tR=$('tabRecent');
  if(tS) tS.classList.toggle('active',!S.recent);
  if(tR) tR.classList.toggle('active',!!S.recent);
  if(tS) tS.setAttribute('aria-current',!S.recent?'page':'false');
  if(tR) tR.setAttribute('aria-current',S.recent?'page':'false');
  /* P11: the shelf is only "empty" when nothing is on it at all, the
     built-in sample book counts, so the banner no longer claims a fresh,
     empty shelf while the sample book sits right below it. */
  $('emptyState').classList.toggle('hidden', S.items.length>0);
  $('libHint').textContent=q? items.length+(items.length===1?' match':' matches')+'. Search also looks inside notes, books and annotations.' : (S.recent?'Recently opened first.':'');
  const _libGrid = $('libraryGrid'); if (_libGrid && !_libGrid._deleteDelegated) { _libGrid._deleteDelegated = true; _libGrid.addEventListener('click', e => { const btn = e.target.closest('[data-delete-id]'); if (!btn) return; e.stopPropagation(); askDeleteItem(btn.dataset.deleteId); }); } _libGrid.innerHTML=items.map(n=>{
    let cov=coverFor(n);
    let kindLabel = n.kind==='notebook'? 'Notebook' : n.kind==='pdf'? 'PDF' : 'EPUB';
    let openAct= n.kind==='notebook'? 'openNotebook(\''+n.id+'\')' : 'openBook(\''+n.id+'\')';
    let prog=itemProgress(n);
    let menu='<button type="button" onclick="event.stopPropagation();'+openAct+'">'+icon(n.kind==='notebook'?'notebook':'book-2')+(n.kind==='notebook'?'Open notebook':'Read book')+'</button>'
      + (n.kind==='pdf'? '<button type="button" onclick="event.stopPropagation();annotatePdf(\''+n.id+'\')">'+icon('pencil')+'Annotate</button>':'')
      + '<button type="button" class="danger" data-delete-id="'+esc(n.id)+'">'+icon('trash')+'Delete</button>';
    /* Pass 1 audit (mockups 11/15): the card is a white frame — the
       coloured cover inside it, progress + meta BELOW the cover.
       Desktop shows the title on the cover; at ≤1024px the title
       moves below the cover in serif with the type label above the
       bar. The button's accessible name comes from the srOnly span
       so it survives the cover title being display:none on small
       screens; the visible titles are aria-hidden duplicates. */
    let titleHtml=esc(n.title).split('_').join('_&#8203;');
    let edited=n.sample?'Sample':'Edited '+esc(n.updated||'just now');
    return '<article class="bookCard"><button type="button" class="book" style="background:'+cov.bg+';color:'+cov.ink+'" onclick="'+openAct+'"><span class="srOnly">Open '+titleHtml+'</span><span class="bookSpine" style="background:'+cov.spine+'"></span><span class="bookFace"><span class="bookTitle bookTitleCover" aria-hidden="true">'+titleHtml+'</span></span></button>'
      +'<div class="bookBelow"><span class="bookTitle bookTitleBelow">'+titleHtml+'</span><span class="bookKindBelow">'+kindLabel+'</span><span class="bookProgress" aria-hidden="true"><span style="width:'+prog+'%"></span></span><span class="srOnly">'+prog+'% read</span><span class="bookMeta"><span>'+prog+'% read</span><span>'+edited+'</span></span></div>'
      +'<button type="button" class="bookMenu" aria-label="Options for '+esc(n.title)+'" aria-haspopup="true" onclick="toggleCardMenu(this)">'+icon('dots','ic-sm')+'</button>'
      +'<div class="bookActions">'+menu+'</div></article>';
  }).join('') || '<p class="kbd">Nothing matches this filter.</p>';
  updateStatsPanel();
  scheduleSave();
}
/* Notebook covers, the same eight as the app, plus the old website colours mapped onto them. */
const COVERS={
  '#b4552d':{bg:'#7A2E2A',spine:'#5E211E',ink:'#FBF6EA'},
  '#7d8c6f':{bg:'#3E4F3A',spine:'#2C3A29',ink:'#FBF6EA'},
  '#4a5a74':{bg:'#2C3A50',spine:'#1D2838',ink:'#FBF6EA'},
  '#6d4a63':{bg:'#4A3244',spine:'#352333',ink:'#FBF6EA'},
  '#c1922e':{bg:'#8A5A1C',spine:'#684210',ink:'#FBF6EA'},
  '#2e6f6a':{bg:'#1F4F4A',spine:'#143B37',ink:'#FBF6EA'},
  '#232c42':{bg:'#1B2028',spine:'#0F1318',ink:'#FBF6EA'},
  '#c08552':{bg:'#6B3F2A',spine:'#4C2A1B',ink:'#FBF6EA'},
  '#234f35':{bg:'#2F4A3E',spine:'#20352C',ink:'#FBF6EA'},
  '#191c19':{bg:'#1B2028',spine:'#0F1318',ink:'#FBF6EA'},
  '#7c2d12':{bg:'#7A2E2A',spine:'#5E211E',ink:'#FBF6EA'},
  '#1e3a5f':{bg:'#2C3A50',spine:'#1D2838',ink:'#FBF6EA'},
  '#f3e8c8':{bg:'#D9C08B',spine:'#B79A63',ink:'#2B2118'}
};
function coverFor(n){
  if(n.color && COVERS[n.color]) return COVERS[n.color];
  if(n.kind==='pdf') return COVERS['#4a5a74'];
  if(n.kind==='epub') return COVERS['#2e6f6a'];
  return COVERS['#b4552d'];
}
function toggleCardMenu(btn){
  let card=btn.closest('.bookCard'); let was=card.classList.contains('menuOpen');
  document.querySelectorAll('.bookCard.menuOpen').forEach(c=>c.classList.remove('menuOpen'));
  if(!was) card.classList.add('menuOpen');
}
document.addEventListener('click',e=>{ if(!e.target.closest('.bookCard')) document.querySelectorAll('.bookCard.menuOpen').forEach(c=>c.classList.remove('menuOpen')); });
function askDeleteItem(id){
  let it=S.items.find(i=>i.id===id); if(!it) return;
  askConfirm('Delete “'+it.title+'”?','This deletes it from this browser. Export a backup first if you want to keep it.',()=>{
    if (it._pdfUrl) { URL.revokeObjectURL(it._pdfUrl); it._pdfUrl = null; } if (Array.isArray(it.pages)) it.pages.forEach(p => { if (p.audio && p.audio.url && p.audio.url.startsWith('blob:')) URL.revokeObjectURL(p.audio.url); }); if(it.kind==='pdf'){ deletePdfFile(id); /* the PDF's annotation store goes with it, or it would linger in storage with no book */ let lnk=linkedNbFor(id); if (lnk && Array.isArray(lnk.pages)) lnk.pages.forEach(p => { if (p.audio && p.audio.url && p.audio.url.startsWith('blob:')) URL.revokeObjectURL(p.audio.url); }); if(lnk && S.curNbId===lnk.id) S.curNbId=null; S.items=S.items.filter(i=>!(i.kind==='notebook' && i.pdfBookId===id)); }
    S.items=S.items.filter(i=>i.id!==id);
    if(S.curNbId===id) S.curNbId=null;
    if(S.curBookId===id) S.curBookId=null;
    renderLibrary(); toast('Deleted');
  });
}
/* Pass 2 audit (mockup 17): the rail stats read "1 Page" not "1 Pages",
   and the third stat is Words in this notebook, not Writing time. */
function setStat(numId,labelId,n,one,many){ let num=$(numId); if(num) num.textContent=n; let lab=$(labelId); if(lab) lab.textContent=n===1?one:many; }
function notebookWords(nb){ return nb.pages.reduce((a,p)=>a+(p.text.trim()?p.text.trim().split(/\s+/).length:0),0); }
function updateStatsPanel(){
  let words=S.items.filter(i=>i.kind==='notebook').reduce((a,nb)=>a+nb.pages.reduce((b,p)=>b+(p.text.trim()?p.text.trim().split(/\s+/).length:0),0),0);
  /* The About panel that held statWrite/statRead/statStrokes/
     statPagesRead/statFocus/statWords was removed in the Pass 1 audit
     (mockup 5 has no About section) — guard every one. */
  let setTxt=(id,v)=>{ let el=$(id); if(el) el.textContent=v; };
  setTxt('statWrite',Math.floor(S.stats.writeSec/60)+'m');
  setTxt('statRead',Math.floor(S.stats.readSec/60)+'m');
  setTxt('statStrokes',S.stats.strokes);
  setTxt('statPagesRead',Object.keys(S.stats.pagesRead).length);
  setTxt('statFocus',S.stats.focusDone);
  setTxt('statWords',words);
  let nb=curNb(); if(nb) setStat('statWrite2','statWrite2Label',notebookWords(nb),'Word','Words');
}

/* ============ library-wide search ============ */
/* P5: while a search query is present, the shelf grid and the filter
   chip row step aside entirely. renderLibrary() filters by title only,
   so leaving the grid up let it flash "Nothing matches this filter"
   behind the (full-text) results dropdown, which also covered the
   chips. Both come back when the query is cleared or results close. */
/* ============ command palette (Pass 1) ============
   The header search is now a trigger; the search itself lives in a
   centred <dialog> grouped by Books & PDFs, Notebooks & Backlinks,
   Annotations and Quick Actions. Every entry is real: the same
   full-text matching the old dropdown used (titles, notebook pages /
   stickies / on-page text / equations, EPUB chapters, PDF text cache,
   annotations), and actions that call the existing flows. No fake
   entries. The old dropdown (#searchResults) and its show/hide
   helpers are gone with it. */
function paletteActions(){
  return [
    {label:'New notebook', sub:'Create a blank notebook', act:()=>openNewNotebook()},
    {label:'Import a PDF', sub:'Open a PDF from your files', act:()=>$('pdfImport').click()},
    {label:'Import an EPUB', sub:'Open an EPUB from your files', act:()=>$('epubImport').click()},
    {label:'Parallel Read', sub:'Read two books side by side', act:()=>prOpenPicker('first')},
    {label:'Start Focus 25:00', sub:'Start a 25 minute focus session', act:()=>openTimer()},
    {label:'Export backup', sub:'Download all notebooks and books as JSON', act:()=>exportBackup()},
    {label:'Toggle theme', sub:'Switch between light and dark', act:()=>toggleTheme()},
    {label:'Open sample book', sub:'The Art of Slow Reading', act:()=>openBook(SAMPLE_ID)}
  ];
}
/* Backlinks for a notebook: other notebooks whose pages link to it
   with [[Title]]. Counted only for the few notebook results shown. */
function backlinkCount(nb){
  let n=0;
  S.items.forEach(i=>{ if(i.kind==='notebook' && !i.pdfBookId && i.id!==nb.id && i.pages.some(p=>p.text.includes('[['+nb.title+']]'))) n++; });
  return n;
}
/* The old onSearchInput matching, refactored to return flat results
   tagged with their palette group instead of rendering a dropdown. */
function searchItemsFlat(q){
  let res=[];
  S.items.forEach(it=>{
    if(isLinkedNb(it)) return; /* annotation stores never surface in search */
    if(it.title.toLowerCase().includes(q)) res.push({label:it.title, sub:(it.kind==='notebook'?'Notebook':it.kind==='pdf'?'PDF':'EPUB')+' · title match', act:()=> it.kind==='notebook'? openNotebook(it.id): openBook(it.id), group:it.kind==='notebook'?'notebooks':'books', kind:it.kind, prog:itemProgress(it)});
    if(it.kind==='notebook') it.pages.forEach((p,pi)=>{
      let idx=p.text.toLowerCase().indexOf(q);
      if(idx>=0) res.push({label:it.title+', page '+(pi+1), sub:'“…'+esc(p.text.slice(Math.max(0,idx-30),idx+60))+'…”', act:()=>{openNotebook(it.id); switchPage(pi);}, group:'notebooks'});
      (p.stickies||[]).forEach(st=>{ if(st.text.toLowerCase().includes(q)) res.push({label:it.title+', sticky, page '+(pi+1), sub:esc(st.text.slice(0,80)), act:()=>{openNotebook(it.id); switchPage(pi);}, group:'notebooks'}); });
      (p.texts||[]).forEach(t=>{ if(String(t.text).toLowerCase().includes(q)) res.push({label:it.title+', on-page text, page '+(pi+1), sub:esc(String(t.text).slice(0,80)), act:()=>{openNotebook(it.id); switchPage(pi);}, group:'notebooks'}); });
      (p.texs||[]).forEach(t=>{ if(String(t.tex).toLowerCase().includes(q)) res.push({label:it.title+', equation, page '+(pi+1), sub:esc(String(t.tex).slice(0,80)), act:()=>{openNotebook(it.id); switchPage(pi);}, group:'notebooks'}); });
      if(p.board && p.board.strokes.length && 'board'.includes(q)) res.push({label:it.title+', floating board, page '+(pi+1), sub:'This page has board work', act:()=>{openNotebook(it.id); switchPage(pi); toggleBoard(true);}, group:'notebooks'});
    });
    if(it.kind==='epub' && it.chapters) it.chapters.forEach((c,ci)=>{
      let idx=c.text.toLowerCase().indexOf(q);
      if(idx>=0) res.push({label:it.title+' · '+c.title, sub:'“…'+esc(c.text.slice(Math.max(0,idx-30),idx+60))+'…”', act:()=>{openBook(it.id); jumpToChapter(ci);}, group:'books'});
    });
    if(it.kind==='pdf' && it.textCache) Object.keys(it.textCache).forEach(pg=>{
      let idx=it.textCache[pg].toLowerCase().indexOf(q);
      if(idx>=0) res.push({label:it.title+', PDF page '+pg, sub:'“…'+esc(it.textCache[pg].slice(Math.max(0,idx-30),idx+60))+'…”', act:()=>{openBook(it.id); jumpToPdfPage(+pg);}, group:'books'});
    });
    (it.annotations||[]).forEach(a=>{ if(a.text.toLowerCase().includes(q)) res.push({label:it.title+', annotation', sub:'“'+esc(a.text.slice(0,80))+'”'+(a.where?' · '+esc(a.where):''), act:()=> it.kind==='notebook'? openNotebook(it.id): openBook(it.id), group:'annotations'}); });
  });
  return res;
}
function collectPalette(q){
  let groups={books:[], notebooks:[], annotations:[], actions:[]};
  if(!q){
    /* No query: the shelf itself, recent first, plus every action. */
    S.items.filter(i=>!isLinkedNb(i) && i.kind!=='notebook').slice(0,5).forEach(it=>groups.books.push({label:it.title, sub:(it.kind==='pdf'?'PDF':'EPUB')+' · '+(it.kind==='pdf'?(it.numPages||'?')+' pages':(it.chapters?it.chapters.length:0)+' chapters'), act:()=>openBook(it.id), kind:it.kind, prog:itemProgress(it)}));
    S.items.filter(i=>i.kind==='notebook' && !i.pdfBookId).slice().sort((a,b)=>(b.openedAt||0)-(a.openedAt||0)).slice(0,5).forEach(it=>{ let bl=backlinkCount(it); groups.notebooks.push({label:it.title, sub:'Notebook · '+itemPages(it)+' pages'+(bl?' · '+bl+(bl===1?' backlink':' backlinks'):''), act:()=>openNotebook(it.id), kind:'notebook', prog:itemProgress(it)}); });
    S.items.forEach(it=>{ if(isLinkedNb(it)) return; (it.annotations||[]).forEach(a=>{ if(groups.annotations.length<5) groups.annotations.push({label:it.title+', annotation', sub:'“'+esc(a.text.slice(0,80))+'”'+(a.where?' · '+esc(a.where):''), act:()=> it.kind==='notebook'? openNotebook(it.id): openBook(it.id)}); }); });
    groups.actions=paletteActions();
    return groups;
  }
  searchItemsFlat(q).forEach(r=>{ if(groups[r.group].length<5) groups[r.group].push(r); });
  /* Mockup 1 (Pass 1 audit): Quick Actions always show, even with a
     query typed — they are the fast path, not a search result. */
  groups.actions=paletteActions();
  return groups;
}
function renderPalette(q){
  let box=$('paletteResults'); if(!box) return;
  let groups=collectPalette(q);
  let flat=[]; let html='';
  [['books','Books & PDFs'],['notebooks','Notebooks & Backlinks'],['annotations','Annotations'],['actions','Quick Actions']].forEach(([key,title])=>{
    let list=groups[key]; if(!list.length) return;
    html+='<div class="palGroup" role="presentation">'+title+'</div>';
    list.forEach(r=>{ let i=flat.length; flat.push(r);
      /* Mockup 1 (Pass 1 audit): book rows carry a format pill +
         progress pill on the right, and every row a ⌘1..⌘9 chip. */
      let chips='';
      if(r.kind) chips+='<span class="palPill">'+(r.kind==='notebook'?'Notebook':r.kind==='pdf'?'PDF':'EPUB')+'</span><span class="palPill">'+r.prog+'%</span>';
      if(i<9) chips+='<kbd class="palKbd">⌘'+(i+1)+'</kbd>';
      html+='<div class="palItem" role="option" aria-selected="false" data-pi="'+i+'" onclick="runPaletteResult('+i+')"><span class="palItemMain"><b>'+esc(r.label)+'</b><span>'+r.sub+'</span></span>'+(chips?'<span class="palChips">'+chips+'</span>':'')+'</div>'; });
  });
  S.paletteItems=flat;
  if(!flat.length) html='<div class="palEmpty">No matches for “'+esc(q)+'”.</div>';
  box.innerHTML=html;
  if(S.paletteSel>=flat.length) S.paletteSel=flat.length?0:-1;
  syncPaletteSel();
}
function syncPaletteSel(){
  document.querySelectorAll('#paletteResults .palItem').forEach(el=>{
    let on=+el.getAttribute('data-pi')===S.paletteSel;
    el.classList.toggle('sel',on);
    el.setAttribute('aria-selected',on?'true':'false');
  });
  let sel=document.querySelector('#paletteResults .palItem.sel'); if(sel) sel.scrollIntoView({block:'nearest'});
}
function openPalette(){
  let d=$('paletteDialog'); if(!d) return;
  if(!d.open) d.showModal();
  S.paletteSel=-1; renderPalette('');
  let s=$('globalSearch'); if(s){ s.focus(); s.select(); }
}
function closePalette(){ let d=$('paletteDialog'); if(d&&d.open) d.close(); }
function runPaletteResult(i){
  let r=S.paletteItems[i]; if(!r) return;
  closePalette(); if(r.act) r.act();
}
function onSearchInput(){
  S.paletteSel=-1;
  renderPalette(($('globalSearch').value||'').trim().toLowerCase());
}
$('paletteDialog').addEventListener('close',()=>{
  /* Closing clears the query so the shelf behind is unfiltered again. */
  let s=$('globalSearch'); if(s) s.value='';
  S.paletteSel=-1; S.paletteItems=[];
  renderLibrary();
});
$('globalSearch').addEventListener('keydown',e=>{
  /* Mockup 1 (Pass 1 audit): ⌘1..⌘9 / Ctrl+1..9 jumps straight to a
     result, matching the shortcut chips on the rows. */
  if((e.metaKey||e.ctrlKey) && /^[1-9]$/.test(e.key)){
    if(!S.paletteItems.length) return;
    e.preventDefault();
    runPaletteResult(+e.key-1);
  }else if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    if(!S.paletteItems.length) return;
    e.preventDefault();
    S.paletteSel=e.key==='ArrowDown'? Math.min(S.paletteItems.length-1,S.paletteSel+1) : Math.max(0,S.paletteSel-1);
    syncPaletteSel();
  }else if(e.key==='Enter'){
    e.preventDefault();
    runPaletteResult(S.paletteSel>=0?S.paletteSel:0);
  }
});

/* ============ Pass 1: + New menu, shelf options drawer, tab bar ============ */
function openShelfOptions(){
  updateStorageBar();
  let d=$('drawerInstallBtn'); if(d) d.style.display=($('installBtn').style.display==='none')?'none':'';
  openDialog('librarySheet');
}
function fmtBytes(n){ if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(1)+' KB'; if(n<1073741824) return (n/1048576).toFixed(1)+' MB'; return (n/1073741824).toFixed(2)+' GB'; }
async function updateStorageBar(){
  let fill=$('storageFill'), txt=$('storageText'); if(!fill||!txt) return;
  try{
    if(!navigator.storage||!navigator.storage.estimate) throw new Error('no estimate');
    let e=await navigator.storage.estimate();
    let used=e.usage||0, quota=e.quota||0;
    let pct=quota? Math.min(100,Math.round(used/quota*100)) : 0;
    fill.style.width=pct+'%';
    /* Mockup 5 (Pass 1 audit): the storage line reads "X used ·
       N annotations" — real data, not the quota percentage. */
    let anCount=S.items.reduce((a,n)=>a+((n.annotations||[]).length),0);
    txt.textContent=fmtBytes(used)+' used · '+anCount+(anCount===1?' annotation':' annotations');
  }catch(err){ fill.style.width='0%'; txt.textContent='Storage use is not available in this browser.'; }
}
function newMenuAct(kind){
  let m=$('newMenu'); if(m&&m.matches(':popover-open')) m.hidePopover();
  if(kind==='notebook') openNewNotebook();
  else if(kind==='pdf') $('pdfImport').click();
  else if(kind==='epub') $('epubImport').click();
  else if(kind==='parallel') prOpenPicker('first');
}
function setLibTab(tab){
  if(tab==='shelf'){ S.recent=false; if(S.filter!=='all') filterLib('all'); else renderLibrary(); window.scrollTo({top:0}); }
  else if(tab==='recent'){ S.recent=true; renderLibrary(); window.scrollTo({top:0}); }
  else if(tab==='focus'){ openTimer(); }
  else if(tab==='options'){ openShelfOptions(); }
}
/* + New menu: modern-web-guidance menu pattern — popover + focusgroup,
   command invokers on both triggers (filter-bar button, mobile FAB).
   Positioning is scripted on open (CSS anchor positioning broke for
   the corner-anchored FAB — see styles.css). Fallbacks: arrow-key nav
   when focusgroup is missing, manual toggle when invoker commands are
   missing. */
(function(){
  let menu=$('newMenu'); if(!menu) return;
  let triggers=[...document.querySelectorAll('[commandfor="newMenu"]')];
  let lastKey=false;
  triggers.forEach(t=>{
    t.addEventListener('keydown',()=>{ lastKey=true; });
    t.addEventListener('pointerdown',()=>{ lastKey=false; });
    t.addEventListener('click',()=>{ menu._src=t; });
  });
  /* Invoker fallback: without commandForElement the command attribute
     does nothing, so toggle the popover from script instead. */
  if(!('commandForElement' in HTMLButtonElement.prototype)){
    document.addEventListener('click', e => { const btn = e.target.closest('button[commandfor][command]'); if (!btn) return; const target = document.getElementById(btn.getAttribute('commandfor')); if (!target) return; const cmd = btn.getAttribute('command'); if (cmd === 'show-modal' && typeof target.showModal === 'function') { e.preventDefault(); if (!target.open) target.showModal(); } else if (cmd === 'close' && typeof target.close === 'function') { e.preventDefault(); if (target.open) target.close(); } else if (cmd === 'toggle-popover' && typeof target.togglePopover === 'function') { e.preventDefault(); target.togglePopover({ source: btn }); } else if (cmd === 'show-popover' && typeof target.showPopover === 'function') { e.preventDefault(); target.showPopover({ source: btn }); } else if (cmd === 'hide-popover' && typeof target.hidePopover === 'function') { e.preventDefault(); target.hidePopover(); } });
  }
  menu.addEventListener('toggle',e=>{
    let open=e.newState==='open';
    triggers.forEach(t=>t.setAttribute('aria-expanded',open?'true':'false'));
    if(open){
      /* Script positioning (not CSS anchor positioning — see styles.css):
         below the trigger that opened it, flipping above when there is
         no room, clamped to the viewport. Runs on every open so the
         placement follows whichever trigger opened the menu. */
      let src=menu._src||triggers[0];
      let r=src.getBoundingClientRect();
      menu.style.position='fixed'; menu.style.margin='0';
      let top=r.bottom+6, left=Math.max(8,Math.min(r.right-menu.offsetWidth,window.innerWidth-menu.offsetWidth-8));
      if(top+menu.offsetHeight>window.innerHeight-8) top=Math.max(8,r.top-menu.offsetHeight-6);
      menu.style.top=top+'px'; menu.style.left=left+'px';
      if(lastKey){ let first=menu.querySelector('[focusgroup] button'); if(first) first.focus(); }
    }
  });
  /* focusgroup fallback: arrow keys + Home/End when the browser has
     no native focusgroup (Chrome 150+ only). */
  if(!('focusGroup' in HTMLElement.prototype)){
    menu.querySelectorAll('[focusgroup~="menu"]').forEach(group=>{
      group.setAttribute('role','menu');
      group.querySelectorAll('button:not([role])').forEach(item=>item.setAttribute('role','menuitem'));
      group.addEventListener('keydown',event=>{
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
        let items=[...group.querySelectorAll('button')].filter(item=>!item.disabled);
        let current=items.indexOf(document.activeElement);
        if(current<0) return;
        let next=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;
        event.preventDefault(); event.stopImmediatePropagation();
        items[next].focus({preventScroll:true});
      },true);
    });
  }
})();

/* ============ notebooks: create / open ============ */
function openNewNotebook(){openDialog('newModal'); setTimeout(()=>$('newTitle').focus(),50)}
function createNotebook(){
  let title=$('newTitle').value.trim()||'Untitled notebook';
  createNotebookSilent(title,$('newColor').value,$('newTemplate').value);
  closeModal('newModal'); $('newTitle').value='';
  toast('Notebook created');
}
function createNotebookSilent(title,color,template){
  let nb={id:uid(), kind:'notebook', title:title, color:color, template:template, pages:[blankPage()], cur:0, updated:'Just now', openedAt:0, annotations:[]};
  S.items.unshift(nb); openNotebook(nb.id); return nb;
}
function openNotebook(id){
  let nb=S.items.find(i=>i.id===id); if(!nb||nb.kind!=='notebook') return;
  nb.openedAt=Date.now(); /* Recent tab sorts on this; persisted by serializeLibrary */
  saveEditorToModel();
  S.curNbId=id;
  /* PDF-linked notebooks land on the page being read (b.page, kept in sync
     by backToReading), matched by bgPdf.page, clamped — the same landing
     r15 added to annotatePdf. A reload / duplicate / restored editor tab
     replays the #/note/... hash and calls openNotebook directly, bypassing
     annotatePdf entirely, so a notebook saved on a blank trailing page
     used to reopen on that blank page and look as if no PDF had loaded.
     Plain notebooks (no PDF) keep resuming their persisted cur.
     Trade-off: navigating inside the editor then reloading bounces back
     to b.page; one tap in Pages returns. */
  if(nb.pdfBookId){ let b=S.items.find(i=>i.id===nb.pdfBookId); if(b){ let pg=Math.max(1,Math.min(b.numPages||nb.pages.length,b.page||1)); let idx=nb.pages.findIndex(p=>p.bgPdf && p.bgPdf.page===pg); nb.cur= idx>=0 ? idx : Math.max(0,Math.min(nb.pages.length-1,pg-1)); } }
  $('noteTitle').value=nb.title;
  $('templateSel').value=nb.template;
  loadPageIntoEditor();
  showView('editor');
  layoutEditorSheet();
  /* phone: always open at fit-to-width so the page uses the freed space —
     a zoom left over from an earlier pinch (e.g. 70%) used to leave the
     page small with empty margins around it */
  if(window.matchMedia('(max-width:860px)').matches) editorZoomBy(0);
  requestAnimationFrame(()=>{ renderCanvasTexts(); });
  renderLibrary();
  /* warm the next few page backgrounds in the background, one at a time,
     so turning a page finds them ready. Warming the whole notebook used
     to render every page of a long PDF up front — the same memory blow-up
     as the old annotatePdf — so only the three pages after the current
     one are warmed, and the loop stops if the user opens another book.
     The three pages BEFORE the current one are warmed too, so their
     thumbnails in the Pages panel show the PDF preview instead of staying
     blank — pages behind the current one were never decoded otherwise. */
  (async()=>{ for(let k=1;k<=3;k++){ if(S.curNbId!==id) return; if(nb.cur+k<nb.pages.length) await decodeBgPdfImg(nb.pages[nb.cur+k]); if(S.curNbId!==id) return; if(nb.cur-k>=0) await decodeBgPdfImg(nb.pages[nb.cur-k]); } })();
}
function syncTitle(){ let nb=curNb(); if(nb){ nb.title=$('noteTitle').value; nb.updated='Just now'; } refreshLinks(); scheduleSave(); }
function saveEditorToModel(){
  let nb=curNb(); if(!nb) return;
  let p=nb.pages[nb.cur]; if(!p) return;
  p.text=$('noteText').value;
  scheduleSave();
}
function setTemplate(v){ let nb=curNb(); if(nb) nb.template=v; drawBackground(); scheduleSave(); }

/* ============ editor: canvas engine ============ */
const bgC=$('bgCanvas'), hiC=$('hiCanvas'), inkC=$('inkCanvas'), liveC=$('liveCanvas');
const bgX=bgC.getContext('2d'), hiX=hiC.getContext('2d'), inkX=inkC.getContext('2d'), liveX=liveC.getContext('2d');
[bgX,hiX,inkX,liveX].forEach(c=>{c.lineCap='round';c.lineJoin='round'});

/* Page backgrounds, the template set: blank, lined, grid, dotted, plus
   music staff, Cornell notes and checklist layouts. One painter is shared
   by the live editor background and by page export/thumbnails so a page
   looks identical everywhere. */
/* P1: Dark Slate pages (#2b2f36) need light ruling and light ink. The
   mapping happens at render time only, stored stroke/text colours stay
   as picked, so switching the page back to a light colour restores the
   original navy exactly. Same idea as boardInkColor() for the board.
   Step 1: #17171A (the dark-ink paper canvas token --paper-dark) is
   also a dark page, so its ruling stays faint and light. */
function isDarkPage(p){ let c=String(p && p.bgColor||'').toLowerCase(); return c==='#2b2f36' || c==='#17171a'; }
function pageInkColor(c,p){ if(isDarkPage(p) && String(c||'').toLowerCase()==='#1b2a4a') return '#f8fafc'; return c; }
function paintTemplate(x,tpl,p){
  let dark=isDarkPage(p);
  let line= dark? 'rgba(248,250,252,.30)' : 'rgba(27,42,74,.16)';
  let margin= dark? 'rgba(248,150,140,.55)' : 'rgba(178,64,54,.4)';
  x.save(); x.strokeStyle=line; x.fillStyle=line; x.lineWidth=1;
  if(tpl==='lined'){ x.beginPath(); for(let y=64;y<CH;y+=42){ x.moveTo(28,y); x.lineTo(CW-28,y);} x.stroke(); x.strokeStyle=margin; x.beginPath(); x.moveTo(84,0); x.lineTo(84,CH); x.stroke(); }
  if(tpl==='grid'){ x.beginPath(); for(let xx=28;xx<CW;xx+=36){ x.moveTo(xx,0); x.lineTo(xx,CH);} for(let y=28;y<CH;y+=36){ x.moveTo(0,y); x.lineTo(CW,y);} x.stroke(); }
  if(tpl==='dotted'){ for(let xx=34;xx<CW;xx+=36) for(let y=34;y<CH;y+=36){ x.beginPath(); x.arc(xx,y,1.6,0,7); x.fill(); } }
  if(tpl==='music'){ for(let g=0;g<4;g++){ let top=70+g*185; x.beginPath(); for(let l=0;l<5;l++){ x.moveTo(36,top+l*13); x.lineTo(CW-36,top+l*13);} x.stroke(); } }
  if(tpl==='cornell'){ x.beginPath(); x.moveTo(330,28); x.lineTo(330,CH-190); x.stroke(); x.beginPath(); x.moveTo(28,CH-190); x.lineTo(CW-28,CH-190); x.stroke(); x.strokeStyle=margin; x.beginPath(); x.moveTo(28,64); x.lineTo(CW-28,64); x.stroke(); x.strokeStyle=line; x.beginPath(); for(let y=106;y<CH-190;y+=42){ x.moveTo(346,y); x.lineTo(CW-28,y);} x.stroke(); }
  if(tpl==='checklist'){ for(let y=70;y<CH-20;y+=52){ x.strokeRect(36,y-17,20,20); x.beginPath(); x.moveTo(72,y+4); x.lineTo(CW-36,y+4); x.stroke(); } }
  x.restore();
}
function drawBackground(){
  let nb=curNb(); if(!nb) return;
  let p=curPageObj();
  bgX.clearRect(0,0,CW,PH);
  bgX.fillStyle=(p&&p.bgColor)||'#fffdf6'; bgX.fillRect(0,0,CW,PH);
  if(p && p.bgPdf && p.bgPdf.img){
    let img=p.bgPdf.img, s=Math.min(CW/img.width, PH/img.height), w=img.width*s, h=img.height*s;
    bgX.fillStyle='#ffffff'; bgX.fillRect((CW-w)/2,(PH-h)/2,w,h);
    bgX.drawImage(img,(CW-w)/2,(PH-h)/2,w,h);
    return;
  }
  paintTemplate(bgX, nb.template, p);
}
function strokeRadius(p,size,tool,dirAng){
  if(tool==='calligraphy'){ let f=0.22+0.78*Math.abs(Math.sin((dirAng||0)-0.785)); return Math.max(0.7, size*1.7*f*(0.45+0.55*(p.p==null?0.5:p.p))); }
  return Math.max(0.6, size*(0.32+0.95*(p.p==null?0.5:p.p)));
}
const DASH_PATTERNS={dashed:[14,10],dotted:[1.5,9],dashdot:[16,8,2.5,8]};
function dashFor(st){ return (st.style && st.style!=='solid' && DASH_PATTERNS[st.style])? DASH_PATTERNS[st.style].map(v=>v*(0.7+st.size*0.22)) : []; }
function drawStroke(ctx,st,p){
  let pts=st.points; if(!pts.length) return;
  let col=pageInkColor(st.color,p); /* P1: navy ink renders light on Dark Slate pages */
  if(st.tool==='shape'){
    let a=pts[0], b=pts[pts.length-1]; if(!a||!b) return;
    ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=Math.max(1.5,st.size*1.4); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.setLineDash(dashFor(st));
    if(st.fill){ ctx.fillStyle=col; ctx.globalAlpha=0.28; }
    if(st.shape==='line'){ ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
    else if(st.shape==='rect'){ ctx.beginPath(); ctx.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y)); if(st.fill) ctx.fill(); ctx.stroke(); }
    else if(st.shape==='ellipse'){ ctx.beginPath(); ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2); if(st.fill) ctx.fill(); ctx.stroke(); }
    else if(st.shape==='arrow'){ ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); let ang=Math.atan2(b.y-a.y,b.x-a.x), hl=18+st.size*2; ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.lineTo(b.x-hl*Math.cos(ang-0.42), b.y-hl*Math.sin(ang-0.42)); ctx.moveTo(b.x,b.y); ctx.lineTo(b.x-hl*Math.cos(ang+0.42), b.y-hl*Math.sin(ang+0.42)); ctx.stroke(); }
    ctx.restore(); return;
  }
  if(st.tool==='poly'){
    ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=Math.max(1.5,st.size*1.4); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.setLineDash(dashFor(st));
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
    if(st.fill){ ctx.closePath(); ctx.fillStyle=col; ctx.globalAlpha=0.28; ctx.fill(); ctx.globalAlpha=1; }
    ctx.stroke(); ctx.restore(); return;
  }
  if(st.tool==='highlighter'){
    /* P1: 'multiply' darkens against the page, so on Dark Slate the
       highlight vanishes into it, 'screen' lightens instead. */
    ctx.save(); ctx.globalCompositeOperation= isDarkPage(p)? 'screen':'multiply'; ctx.globalAlpha=0.42; ctx.strokeStyle=col; ctx.lineWidth=st.size*4.5;
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y); ctx.stroke(); ctx.restore(); return;
  }
  if(st.style && st.style!=='solid' && (st.tool==='pen'||st.tool==='calligraphy')){
    /* Dashed/dotted pen strokes are drawn as a dashed centreline, a filled
       outline cannot dash. Pressure still drives the line width. */
    ctx.save(); ctx.strokeStyle=col; ctx.setLineDash(dashFor(st)); ctx.lineCap='round'; ctx.lineJoin='round';
    for(let i=1;i<pts.length;i++){ ctx.lineWidth=Math.max(0.8, st.size*(0.5+1.5*((pts[i-1].p==null?0.5:pts[i-1].p)+(pts[i].p==null?0.5:pts[i].p))/2)); ctx.beginPath(); ctx.moveTo(pts[i-1].x,pts[i-1].y); ctx.lineTo(pts[i].x,pts[i].y); ctx.stroke(); }
    ctx.restore(); return;
  }
  if(pts.length===1){ ctx.fillStyle=col; ctx.beginPath(); ctx.arc(pts[0].x,pts[0].y,Math.max(1.1,st.size*0.6),0,7); ctx.fill(); return; }
  let left=[],right=[];
  for(let i=0;i<pts.length;i++){
    let p=pts[i], pa=pts[Math.max(0,i-1)], pb=pts[Math.min(pts.length-1,i+1)];
    let dx=pb.x-pa.x, dy=pb.y-pa.y, len=Math.hypot(dx,dy)||1; dx/=len; dy/=len;
    let r=strokeRadius(p,st.size,st.tool,Math.atan2(dy,dx));
    let taper=Math.min(1,(Math.min(i,pts.length-1-i)/4)+0.18); if(pts.length>4) r*=taper;
    left.push({x:p.x-dy*r,y:p.y+dx*r}); right.push({x:p.x+dy*r,y:p.y-dx*r});
  }
  ctx.fillStyle=col; ctx.beginPath();
  ctx.moveTo(left[0].x,left[0].y);
  for(let i=1;i<left.length-1;i++){ ctx.quadraticCurveTo(left[i].x,left[i].y,(left[i].x+left[i+1].x)/2,(left[i].y+left[i+1].y)/2); }
  ctx.lineTo(left[left.length-1].x,left[left.length-1].y);
  for(let i=right.length-1;i>0;i--){ ctx.quadraticCurveTo(right[i].x,right[i].y,(right[i].x+right[i-1].x)/2,(right[i].y+right[i-1].y)/2); }
  ctx.lineTo(right[0].x,right[0].y); ctx.closePath(); ctx.fill();
}
function redrawLayer(which){
  let p=curPageObj(); if(!p) return;
  let ctx= which==='ink'? inkX:hiX, arr= which==='ink'? p.ink:p.hi;
  ctx.clearRect(0,0,CW,PH);
  let cutoff=(typeof redrawLayer.cutoff==='number')? redrawLayer.cutoff : null;
  arr.forEach(st=>{ if(cutoff!==null && typeof st.t==='number' && st.t>cutoff) return; drawStroke(ctx,st,p); });
  setStat('statPageStrokes','statPageStrokesLabel',p.ink.length+p.hi.length,'Stroke','Strokes');
}
function redrawAll(){ syncPageHeight(); drawBackground(); redrawLayer('ink'); redrawLayer('hi'); }
function composePage(p, template, out){
  let cH=pageH(p); let c=out||document.createElement('canvas'); c.width=CW; c.height=cH; let x=c.getContext('2d');
  x.fillStyle=p.bgColor||'#fffdf6'; x.fillRect(0,0,CW,cH);
  if(p.bgPdf && p.bgPdf.img){ let img=p.bgPdf.img, s=Math.min(CW/img.width,cH/img.height), w=img.width*s,h=img.height*s; x.fillStyle='#fff'; x.fillRect((CW-w)/2,(cH-h)/2,w,h); x.drawImage(img,(CW-w)/2,(cH-h)/2,w,h); }
  else paintTemplate(x, template, p);
  (p.images||[]).forEach(im=>{ if(im._img && im._img.complete && im._img.naturalWidth) x.drawImage(im._img, im.x, im.y, im.w, im.h); });
  p.hi.forEach(st=>drawStroke(x,st,p));
  p.ink.forEach(st=>drawStroke(x,st,p));
  (p.texts||[]).forEach(t=>{ x.fillStyle=pageInkColor(t.color,p); x.font='600 '+(t.size||26)+'px '+(t.font||'Newsreader, serif'); let lines=String(t.text||'').split('\n'); lines.forEach((ln,i)=>x.fillText(ln, t.x, t.y+ (t.size||26) + i*((t.size||26)*1.35))); });
  (p.texs||[]).forEach(t=>{ x.fillStyle=pageInkColor(t.color||'#1b2a4a',p); x.font='italic 600 '+(t.size||26)+'px Newsreader, serif'; x.fillText(t.tex, t.x, t.y+(t.size||26)); });
  return c;
}

/* ============ Shapes, selection, on-page text & images, zoom ============ */
let selDrag=null, moveDrag=null;
function strokeBBox(st){ let xs=st.points.map(p=>p.x), ys=st.points.map(p=>p.y); return {x1:Math.min.apply(null,xs),y1:Math.min.apply(null,ys),x2:Math.max.apply(null,xs),y2:Math.max.apply(null,ys)}; }
function selectionBBox(){ if(!S.selection.length) return null; let bs=S.selection.map(strokeBBox); return {x1:Math.min.apply(null,bs.map(b=>b.x1)),y1:Math.min.apply(null,bs.map(b=>b.y1)),x2:Math.max.apply(null,bs.map(b=>b.x2)),y2:Math.max.apply(null,bs.map(b=>b.y2))}; }
function drawSelectionOverlay(){
  redrawLayer('ink'); redrawLayer('hi');
  let p=curPageObj(); if(!p) return;
  if(S.selRect){ let r=S.selRect; inkX.save(); inkX.strokeStyle='#2456c8'; inkX.lineWidth=2; inkX.setLineDash([8,6]); inkX.strokeRect(Math.min(r.x1,r.x2),Math.min(r.y1,r.y2),Math.abs(r.x2-r.x1),Math.abs(r.y2-r.y1)); inkX.restore(); }
  let bb=selectionBBox(); if(bb){ inkX.save(); inkX.strokeStyle='#2456c8'; inkX.lineWidth=2; inkX.setLineDash([8,6]); inkX.strokeRect(bb.x1-8,bb.y1-8,bb.x2-bb.x1+16,bb.y2-bb.y1+16); inkX.restore(); }
  let bar=$('selBar'); if(bar){ bar.classList.toggle('open', S.selection.length>0); if(S.selection.length) $('selInfo').textContent=S.selection.length+' stroke(s) selected'; }
}
function clearSelection(){ S.selection=[]; S.selRect=null; drawSelectionOverlay(); }
function deleteSelection(){ let p=curPageObj(); if(!p||!S.selection.length) return; snapshotUndo(); p.ink=p.ink.filter(st=>S.selection.indexOf(st)<0); p.hi=p.hi.filter(st=>S.selection.indexOf(st)<0); S.selection=[]; bumpV(p); drawSelectionOverlay(); renderPages(); toast('Selected strokes deleted'); }
function duplicateSelection(){ let p=curPageObj(); if(!p||!S.selection.length) return; snapshotUndo(); let copies=S.selection.map(st=>{ let c=JSON.parse(JSON.stringify(st)); c.points=c.points.map(pt=>({x:pt.x+28,y:pt.y+28,p:pt.p})); return c; }); copies.forEach(c=>p.ink.push(c)); S.selection=copies; bumpV(p); drawSelectionOverlay(); renderPages(); toast('Duplicated. Drag to move the copies.'); }
function bringSelectionFront(){ let p=curPageObj(); if(!p||!S.selection.length) return; S.selection.forEach(st=>{ let i=p.ink.indexOf(st); if(i>=0){ p.ink.splice(i,1); p.ink.push(st); } let j=p.hi.indexOf(st); if(j>=0){ p.hi.splice(j,1); p.hi.push(st); } }); bumpV(p); drawSelectionOverlay(); renderPages(); }
/* Selection transforms, rotation (snapped to the angle step the buttons
   use), scaling and flipping about the selection's own centre, plus an
   in-app clipboard so strokes can move between pages. */
function selectionCenter(){ let bb=selectionBBox(); return bb? {x:(bb.x1+bb.x2)/2, y:(bb.y1+bb.y2)/2} : null; }
function transformSelection(fn,msg){ let p=curPageObj(); if(!p||!S.selection.length) return; let c=selectionCenter(); if(!c) return; snapshotUndo(); S.selection.forEach(st=>{ st.points=st.points.map(pt=>{ let r=fn(pt,c); return {x:r.x,y:r.y,p:pt.p}; }); }); bumpV(p); drawSelectionOverlay(); renderPages(); if(msg) toast(msg); }
function rotateSelection(deg){ let rad=deg*Math.PI/180, cs=Math.cos(rad), sn=Math.sin(rad); transformSelection((pt,c)=>({x:c.x+(pt.x-c.x)*cs-(pt.y-c.y)*sn, y:c.y+(pt.x-c.x)*sn+(pt.y-c.y)*cs})); }
function scaleSelection(f){ transformSelection((pt,c)=>({x:c.x+(pt.x-c.x)*f, y:c.y+(pt.y-c.y)*f})); }
function flipSelection(axis){ transformSelection((pt,c)=> axis==='x'? {x:2*c.x-pt.x, y:pt.y} : {x:pt.x, y:2*c.y-pt.y}); }
function copySelection(){ if(!S.selection.length){ toast('Select some strokes first'); return; } S.clipboard=JSON.parse(JSON.stringify(S.selection)); toast(S.clipboard.length+' stroke(s) copied. Paste works on any page of any notebook.'); }
function pasteSelection(){ let p=curPageObj(); if(!p){ toast('Open a notebook page first'); return; } if(!S.clipboard.length){ toast('Nothing copied yet. Select strokes and tap Copy.'); return; } snapshotUndo(); let copies=JSON.parse(JSON.stringify(S.clipboard)); copies.forEach(c=>{ c.points=c.points.map(pt=>({x:Math.min(CW-4,(pt.x||0)+36), y:Math.min(PH-4,(pt.y||0)+36), p:pt.p})); delete c._layer; p.ink.push(c); }); S.selection=copies; bumpV(p); drawSelectionOverlay(); renderPages(); toast('Pasted '+copies.length+' stroke(s)'); }
function snapVal(v){ return S.snapGrid? Math.round(v/24)*24 : v; }
function finishSelection(){ let p=curPageObj(); if(!p||!S.selRect) return; let r={x1:Math.min(S.selRect.x1,S.selRect.x2),y1:Math.min(S.selRect.y1,S.selRect.y2),x2:Math.max(S.selRect.x1,S.selRect.x2),y2:Math.max(S.selRect.y1,S.selRect.y2)}; S.selRect=null;
  /* Deselect fix: a tap is a box with no area — it only deselects.
     It must not re-select a stroke whose (much larger) bounding box the
     tap point happens to fall inside, and it must not nag with
     "Nothing in that box": a tap is not a failed drag. Only a real
     dragged box reports what it found. */
  if(Math.abs(r.x2-r.x1)<8 && Math.abs(r.y2-r.y1)<8){ S.selection=[]; drawSelectionOverlay(); return; }
  let all=p.ink.concat(p.hi); S.selection=all.filter(st=>{ let b=strokeBBox(st); return b.x2>=r.x1 && b.x1<=r.x2 && b.y2>=r.y1 && b.y1<=r.y2; });
  drawSelectionOverlay(); if(S.selection.length) toast(S.selection.length+' stroke(s) selected. Drag inside the box to move.'); else toast('Nothing in that box. Drag around some ink.');
}
/* ============ Lasso select, vertical space, spline, set square ============
   Lasso: a freehand loop; a stroke is selected when the centre of its
   bounding box falls inside the loop (point-in-polygon ray cast).
   Vertical space: everything whose top edge sits below the drag line is
   shifted by the drag distance, strokes, on-page text, equations,
   images and stickies all move together.
   Spline: tapped anchor points are joined with a Catmull-Rom curve,
   sampled into an ordinary polyline stroke so it exports and erases
   like any other ink. */
let lassoPts=null, vspaceDrag=null, splinePts=[];
function ptInPolygon(x,y,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    let xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function drawLassoOverlay(){
  if(!lassoPts || lassoPts.length<2) return;
  inkX.save(); inkX.strokeStyle='#2456c8'; inkX.lineWidth=2; inkX.setLineDash([7,6]);
  inkX.beginPath(); inkX.moveTo(lassoPts[0].x,lassoPts[0].y);
  for(let i=1;i<lassoPts.length;i++) inkX.lineTo(lassoPts[i].x,lassoPts[i].y);
  inkX.closePath(); inkX.stroke(); inkX.restore();
}
function finishLasso(){
  let p=curPageObj(); let poly=lassoPts; lassoPts=null;
  if(!p||!poly){ drawSelectionOverlay(); return; }
  let all=p.ink.concat(p.hi);
  S.selection=all.filter(st=>{ let b=strokeBBox(st); return ptInPolygon((b.x1+b.x2)/2,(b.y1+b.y2)/2,poly); });
  drawSelectionOverlay();
  toast(S.selection.length? S.selection.length+' stroke(s) lassoed. Drag inside the box to move them.' : 'Nothing inside that loop');
}
function drawVspaceOverlay(){
  if(!vspaceDrag) return;
  inkX.save(); inkX.strokeStyle='#b23a2e'; inkX.lineWidth=2; inkX.setLineDash([10,6]);
  inkX.beginPath(); inkX.moveTo(20,vspaceDrag.y); inkX.lineTo(CW-20,vspaceDrag.y); inkX.stroke();
  inkX.setLineDash([]); inkX.beginPath(); inkX.moveTo(CW/2,vspaceDrag.y); inkX.lineTo(CW/2,vspaceDrag.cur); inkX.stroke();
  inkX.beginPath(); inkX.moveTo(CW/2-8,vspaceDrag.cur-((vspaceDrag.cur>vspaceDrag.y)?10:-10)); inkX.lineTo(CW/2,vspaceDrag.cur); inkX.lineTo(CW/2+8,vspaceDrag.cur-((vspaceDrag.cur>vspaceDrag.y)?10:-10)); inkX.stroke();
  inkX.restore();
}
function finishVspace(){
  let p=curPageObj(); let d=vspaceDrag; vspaceDrag=null;
  if(!p||!d){ drawSelectionOverlay(); return; }
  let dy=d.cur-d.y;
  drawSelectionOverlay();
  if(Math.abs(dy)<8){ toast('Drag further to make or close up space'); return; }
  snapshotUndo();
  let moved=0;
  [p.ink,p.hi].forEach(arr=>arr.forEach(st=>{ let b=strokeBBox(st); if(b.y1>=d.y-2){ st.points.forEach(q=>q.y+=dy); moved++; } }));
  (p.texts||[]).forEach(t=>{ if(t.y>=d.y-2) t.y+=dy; });
  (p.texs||[]).forEach(t=>{ if(t.y>=d.y-2) t.y+=dy; });
  (p.images||[]).forEach(im=>{ if(im.y>=d.y-2) im.y+=dy; });
  (p.stickies||[]).forEach(st=>{ if(st.y/100*PH>=d.y-2) st.y+=dy/PH*100; });
  bumpV(p); redrawLayer('ink'); redrawLayer('hi'); renderCanvasTexts(); renderCanvasImages(); renderTexLayer(); renderStickies(); renderPages();
  toast(moved? 'Moved '+moved+' stroke(s) '+(dy>0?'down':'up')+' to '+(dy>0?'make':'close')+' space' : 'Nothing below that line to move');
}
function drawSplineOverlay(){
  redrawLayer('ink');
  if(splinePts.length<1) return;
  inkX.save();
  inkX.fillStyle='#b23a2e';
  splinePts.forEach(pt=>{ inkX.beginPath(); inkX.arc(pt.x,pt.y,6,0,7); inkX.fill(); });
  if(splinePts.length>1){
    let sm=splineSmoothPoints(splinePts);
    inkX.strokeStyle=S.color; inkX.lineWidth=Math.max(1.5,(+$('brushSize').value)*1.4); inkX.setLineDash([8,6]);
    inkX.beginPath(); inkX.moveTo(sm[0].x,sm[0].y); sm.forEach(pt=>inkX.lineTo(pt.x,pt.y)); inkX.stroke();
  }
  inkX.restore();
}
function splineSmoothPoints(anchors){
  if(anchors.length<3) return anchors.slice();
  let pts=[anchors[0]].concat(anchors).concat([anchors[anchors.length-1]]);
  let out=[];
  for(let i=1;i<pts.length-2;i++){
    let p0=pts[i-1], p1=pts[i], p2=pts[i+1], p3=pts[i+2];
    for(let s=0;s<10;s++){
      let t=s/10, t2=t*t, t3=t2*t;
      out.push({ x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
                 y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3), p:0.6 });
    }
  }
  out.push({x:anchors[anchors.length-1].x, y:anchors[anchors.length-1].y, p:0.6});
  return out;
}
function finishSpline(){
  let p=curPageObj();
  $('splineDoneBtn').classList.add('hidden');
  if(!p||splinePts.length<2){ splinePts=[]; redrawLayer('ink'); return; }
  snapshotUndo();
  let st={tool:'poly', points:splineSmoothPoints(splinePts), color:S.color, size:+$('brushSize').value, style:S.strokeStyle};
  splinePts=[];
  p.ink.push(st); S.stats.strokes++; bumpV(p); redrawLayer('ink'); renderPages();
  toast('Spline drawn');
}
document.addEventListener('keydown',e=>{ if(S.view==='editor' && S.tool==='spline' && e.key==='Enter'){ e.preventDefault(); finishSpline(); } if(S.view==='editor' && e.key==='Escape' && splinePts.length){ splinePts=[]; $('splineDoneBtn').classList.add('hidden'); redrawLayer('ink'); } });
/* Set square: a draggable, rotatable triangular guide over the page. */
let sqAngle=0, sqDrag=null;
function toggleSetSquare(force){
  let el=$('setSquare'); let show= typeof force==='boolean'? force : el.classList.contains('hidden');
  el.classList.toggle('hidden',!show);
  $('setSquareBtn').classList.toggle('primary',show);
  if(show) toast('Set square on the page. Drag it to position it, use its buttons to rotate it. Draw along its long edge for a guided straight line.');
}
function rotateSetSquare(deg){ sqAngle=(sqAngle+deg)%360; $('setSquare').style.transform='rotate('+sqAngle+'deg)'; }
$('sqBody').addEventListener('pointerdown',e=>{
  e.stopPropagation(); let el=$('setSquare'); sqDrag={x:e.clientX,y:e.clientY,l:el.offsetLeft,t:el.offsetTop}; $('sqBody').setPointerCapture(e.pointerId);
});
$('sqBody').addEventListener('pointermove',e=>{ if(!sqDrag) return; let el=$('setSquare'); el.style.left=Math.max(0,sqDrag.l+e.clientX-sqDrag.x)+'px'; el.style.top=Math.max(0,sqDrag.t+e.clientY-sqDrag.y)+'px'; el.style.right='auto'; });
$('sqBody').addEventListener('pointerup',()=>sqDrag=null);

/* ============ Shape recogniser (inertia-based polygonal recognition) ============
   Each stroke is split into straight segments by recursive polygonal
   approximation: a candidate segment is scored by the determinant of its
   inertia tensor (an ideal straight segment scores 0), grown while the
   score stays low, and the break points are then optimised. Segments are
   queued across consecutive strokes, so a triangle or rectangle drawn
   side-by-side in several strokes still combines into one shape. A lone
   segment becomes a snapped line; a non-polygonal stroke is tested as a
   circle by its inertia radius and radial deviation score. */
const RECO_MAX_SIDES=4;                    /* MAX_POLYGON_SIDES */
const RECO_SEGMENT_MAX_DET=0.045;          /* SEGMENT_MAX_DET: max score for a polygon segment (ideal line = 0) */
const RECO_LINE_MAX_DET=0.015;             /* LINE_MAX_DET: max score for a single line, stricter than for polygons */
const RECO_LINE_POINT_DIST2=15;            /* LINE_POINT_DIST2_THRESHOLD */
const RECO_CIRCLE_MIN_DET=0.95;            /* CIRCLE_MIN_DET (ideal circle = 1) */
const RECO_CIRCLE_MAX_SCORE=0.10;          /* CIRCLE_MAX_SCORE (ideal circle = 0) */
const RECO_SLANT_TOL=5*Math.PI/180;        /* SLANT_TOLERANCE: ignore slanting by +/- 5 degrees */
const RECO_TRI_TOL=0.3;                    /* TRIANGLE_LINEAR_TOLERANCE */
const RECO_RECT_ANGLE_TOL=15*Math.PI/180;  /* RECTANGLE_ANGLE_TOLERANCE */
const RECO_RECT_TOL=0.20;                  /* RECTANGLE_LINEAR_TOLERANCE */
const RECO_MIN_SIZE=10;                    /* smallest stroke (bounds diagonal) worth recognising */

function inertiaNew(){ return {mass:0,sx:0,sy:0,sxx:0,sxy:0,syy:0}; }
function inertiaCopy(s){ return {mass:s.mass,sx:s.sx,sy:s.sy,sxx:s.sxx,sxy:s.sxy,syy:s.syy}; }
function inertiaIncrease(s,p1,p2,coef){ let dm=coef*Math.hypot(p2.x-p1.x,p2.y-p1.y); s.mass+=dm; s.sx+=dm*p1.x; s.sy+=dm*p1.y; s.sxx+=dm*p1.x*p1.x; s.syy+=dm*p1.y*p1.y; s.sxy+=dm*p1.x*p1.y; }
function inertiaCalc(s,pts,i1,i2){ s.mass=s.sx=s.sy=s.sxx=s.sxy=s.syy=0; for(let i=i1;i<i2;i++) inertiaIncrease(s,pts[i],pts[i+1],1); }
function inertiaXX(s){ return s.mass<=0?0:(s.sxx-s.sx*s.sx/s.mass)/s.mass; }
function inertiaXY(s){ return s.mass<=0?0:(s.sxy-s.sx*s.sy/s.mass)/s.mass; }
function inertiaYY(s){ return s.mass<=0?0:(s.syy-s.sy*s.sy/s.mass)/s.mass; }
function inertiaRad(s){ let v=inertiaXX(s)+inertiaYY(s); return v<=0?0:Math.sqrt(v); }
function inertiaDet(s){ let a=inertiaXX(s), b=inertiaYY(s), c=inertiaXY(s); if(s.mass<=0||a+b<=0) return 0; return 4*(a*b-c*c)/(a+b)/(a+b); }
function inertiaCX(s){ return s.sx/s.mass; }
function inertiaCY(s){ return s.sy/s.mass; }

function recoSegmentGeometry(pts,start,end,s){
  let seg={startpt:start,endpt:end,xcenter:inertiaCX(s),ycenter:inertiaCY(s),angle:0,radius:0,x1:0,y1:0,x2:0,y2:0,reversed:false,srcStroke:null};
  let a=inertiaXX(s), b=inertiaXY(s), c=inertiaYY(s);
  /* max angle for inertia quadratic form solves: tan(2t) = 2b/(a-c) */
  seg.angle=Math.atan2(2*b,a-c)/2;
  seg.radius=Math.sqrt(3*(a+c));
  let lmin=0, lmax=0, ca=Math.cos(seg.angle), sa=Math.sin(seg.angle);
  for(let i=start;i<=end;i++){ let l=(pts[i].x-seg.xcenter)*ca+(pts[i].y-seg.ycenter)*sa; if(l<lmin) lmin=l; if(l>lmax) lmax=l; }
  seg.x1=seg.xcenter+lmin*ca; seg.y1=seg.ycenter+lmin*sa;
  seg.x2=seg.xcenter+lmax*ca; seg.y2=seg.ycenter+lmax*sa;
  return seg;
}
function recoEdgeIsect(r1,r2){
  let t=(r2.xcenter-r1.xcenter)*Math.sin(r2.angle)-(r2.ycenter-r1.ycenter)*Math.cos(r2.angle);
  t/=Math.sin(r2.angle-r1.angle);
  return {x:r1.xcenter+t*Math.cos(r1.angle), y:r1.ycenter+t*Math.sin(r1.angle)};
}
function recoDist2(p,q){ let dx=p.x-q.x, dy=p.y-q.y; return dx*dx+dy*dy; }

/* Check if a stroke range is a polygonal line with at most nsides sides.
   [start, finish] (inclusive) is the range in pts; brk/ss are filled at offset off. */
function recoFindPolygonal(pts,start,finish,nsides,brk,ss,off){
  let s=inertiaNew(), i1=0, i2=0, n1=0, n2=0;
  if(finish===start) return 0;
  if(nsides<=0) return 0;
  if(finish-start<5) nsides=1; /* too small for a polygon */
  /* look for a linear piece that's big enough */
  let k=0;
  for(;k<nsides;k++){
    i1=start+Math.floor(k*(finish-start)/nsides);
    i2=start+Math.floor((k+1)*(finish-start)/nsides);
    inertiaCalc(s,pts,i1,i2);
    if(inertiaDet(s)<RECO_SEGMENT_MAX_DET) break;
  }
  if(k===nsides) return 0; /* failed */
  /* grow the linear piece we found */
  while(true){
    let det1, det2, s1=null, s2=null;
    if(i1>start){ s1=inertiaCopy(s); inertiaIncrease(s1,pts[i1-1],pts[i1],1); det1=inertiaDet(s1); } else det1=1.0;
    if(i2<finish){ s2=inertiaCopy(s); inertiaIncrease(s2,pts[i2],pts[i2+1],1); det2=inertiaDet(s2); } else det2=1.0;
    if(det1<det2 && det1<RECO_SEGMENT_MAX_DET){ i1--; s=s1; }
    else if(det2<det1 && det2<RECO_SEGMENT_MAX_DET){ i2++; s=s2; }
    else break;
  }
  if(i1>start){
    n1=recoFindPolygonal(pts,start,i1,(i2===finish)?(nsides-1):(nsides-2),brk,ss,off);
    if(n1===0) return 0; /* it doesn't work */
  }
  brk[off+n1]=i1; brk[off+n1+1]=i2; ss[off+n1]=s;
  if(i2<finish){
    n2=recoFindPolygonal(pts,i2,finish,nsides-n1-1,brk,ss,off+n1+1);
    if(n2===0) return 0;
  }
  return n1+n2+1;
}
/* Improve on the polygon found by recoFindPolygonal() */
function recoOptimizePolygonal(pts,nsides,brk,ss){
  for(let i=1;i<nsides;i++){
    /* optimize break between sides i and i+1 */
    let a0=inertiaDet(ss[i-1]), b0=inertiaDet(ss[i]);
    let cost=a0*a0+b0*b0;
    let s1=inertiaCopy(ss[i-1]), s2=inertiaCopy(ss[i]);
    let improved=false;
    while(brk[i]>brk[i-1]+1){
      /* try moving the break to the left */
      inertiaIncrease(s1,pts[brk[i]-1],pts[brk[i]-2],-1);
      inertiaIncrease(s2,pts[brk[i]-1],pts[brk[i]-2],1);
      let a=inertiaDet(s1), b=inertiaDet(s2), nc=a*a+b*b;
      if(nc>=cost) break;
      improved=true; cost=nc; brk[i]--; ss[i-1]=inertiaCopy(s1); ss[i]=inertiaCopy(s2);
    }
    if(improved) continue;
    s1=inertiaCopy(ss[i-1]); s2=inertiaCopy(ss[i]);
    while(brk[i]<brk[i+1]-1){
      /* try moving the break to the right */
      inertiaIncrease(s1,pts[brk[i]],pts[brk[i]+1],1);
      inertiaIncrease(s2,pts[brk[i]],pts[brk[i]+1],-1);
      let a=inertiaDet(s1), b=inertiaDet(s2), nc=a*a+b*b;
      if(nc>=cost) break;
      cost=nc; brk[i]++; ss[i-1]=inertiaCopy(s1); ss[i]=inertiaCopy(s2);
    }
  }
}

let recoQueue=[], recoQueuePage=null;
function recoTryTriangle(){
  if(recoQueue.length<3) return null;
  let rs=recoQueue.slice(recoQueue.length-3);
  if(rs[0].startpt!==0) return null;
  /* orient segments so neighbours point towards each other (all clockwise or all counter-clockwise) */
  for(let i=0;i<=2;i++){
    let r1=rs[i], r2=rs[(i+1)%3];
    let minPRPS=Math.min(recoDist2({x:r1.x1,y:r1.y1},{x:r2.x1,y:r2.y1}), recoDist2({x:r1.x1,y:r1.y1},{x:r2.x2,y:r2.y2}));
    let minQRQS=Math.min(recoDist2({x:r1.x2,y:r1.y2},{x:r2.x1,y:r2.y1}), recoDist2({x:r1.x2,y:r1.y2},{x:r2.x2,y:r2.y2}));
    r1.reversed = minPRPS<minQRQS;
  }
  for(let i=0;i<=2;i++){
    let r1=rs[i], r2=rs[(i+1)%3];
    let x1=r1.reversed?r1.x1:r1.x2, y1=r1.reversed?r1.y1:r1.y2;
    let x2=r2.reversed?r2.x2:r2.x1, y2=r2.reversed?r2.y2:r2.y1;
    if(Math.hypot(x1-x2,y1-y2) > RECO_TRI_TOL*(r1.radius+r2.radius)) return null;
  }
  let pts=[]; for(let i=0;i<=2;i++) pts.push(recoEdgeIsect(rs[i],rs[(i+1)%3]));
  pts.push({x:pts[0].x,y:pts[0].y});
  return {pts:pts,count:3};
}
function recoTryRectangle(){
  if(recoQueue.length<4) return null;
  let rs=recoQueue.slice(recoQueue.length-4);
  if(rs[0].startpt!==0) return null;
  /* check edges make angles ~= Pi/2 and vertices roughly match */
  let avgAngle=0;
  for(let i=0;i<=3;i++){
    let r1=rs[i], r2=rs[(i+1)%4];
    if(Math.abs(Math.abs(r1.angle-r2.angle)-Math.PI/2) > RECO_RECT_ANGLE_TOL) return null;
    avgAngle+=r1.angle;
    if(r2.angle>r1.angle) avgAngle+=(i+1)*Math.PI/2; else avgAngle-=(i+1)*Math.PI/2;
    /* test if r1 points away from r2 rather than towards it */
    r1.reversed = ((r1.x2-r1.x1)*(r2.xcenter-r1.xcenter)+(r1.y2-r1.y1)*(r2.ycenter-r1.ycenter))<0;
  }
  for(let i=0;i<=3;i++){
    let r1=rs[i], r2=rs[(i+1)%4];
    let d=Math.hypot((r1.reversed?r1.x1:r1.x2)-(r2.reversed?r2.x2:r2.x1), (r1.reversed?r1.y1:r1.y2)-(r2.reversed?r2.y2:r2.y1));
    if(d > RECO_RECT_TOL*(r1.radius+r2.radius)) return null;
  }
  /* make a rectangle of the correct size and slope */
  avgAngle/=4;
  if(Math.abs(avgAngle)<RECO_SLANT_TOL) avgAngle=0;
  if(Math.abs(avgAngle)>Math.PI/2-RECO_SLANT_TOL) avgAngle=Math.PI/2;
  for(let i=0;i<=3;i++) rs[i].angle=avgAngle+i*Math.PI/2;
  let pts=[]; for(let i=0;i<=3;i++) pts.push(recoEdgeIsect(rs[i],rs[(i+1)%4]));
  pts.push({x:pts[0].x,y:pts[0].y});
  return {pts:pts,count:4};
}
function recoScoreCircle(pts,s){
  let r0=inertiaRad(s), divisor=s.mass*r0;
  if(divisor===0) return 0;
  let sum=0, x0=inertiaCX(s), y0=inertiaCY(s);
  for(let i=0;i+1<pts.length;i++){
    let dm=Math.hypot(pts[i+1].x-pts[i].x, pts[i+1].y-pts[i].y);
    let deltar=Math.hypot(pts[i].x-x0,pts[i].y-y0)-r0;
    sum+=dm*Math.abs(deltar);
  }
  return sum/divisor;
}
function recoTryCircle(st){
  let s=inertiaNew(); inertiaCalc(s,st.points,0,st.points.length-1);
  if(inertiaDet(s)>RECO_CIRCLE_MIN_DET && recoScoreCircle(st.points,s)<RECO_CIRCLE_MAX_SCORE){
    /* the recognised shape is a circle of radius inertia.rad() about the inertia centre */
    let cx=inertiaCX(s), cy=inertiaCY(s), r=inertiaRad(s);
    return {tool:'shape',shape:'ellipse',color:st.color,size:st.size,fill:!!($('fillTgl')&&$('fillTgl').checked),points:[{x:cx-r,y:cy-r},{x:cx+r,y:cy+r}]};
  }
  return null;
}
function recoFinishShape(res,st){
  let used=recoQueue.splice(recoQueue.length-res.count, res.count);
  let consumed=[], seen=[];
  used.forEach(seg=>{ if(seg.srcStroke && seg.srcStroke!==st && seen.indexOf(seg.srcStroke)<0){ seen.push(seg.srcStroke); consumed.push(seg.srcStroke); } });
  let stroke={tool:'poly',points:res.pts,color:st.color,size:st.size,fill:!!($('fillTgl')&&$('fillTgl').checked)};
  return {stroke:stroke, consumed:consumed};
}
/* Main recognition entry: returns {stroke, consumed[]} or null to keep the stroke as drawn. */
function recognizeStroke(st,pageObj){
  if(recoQueuePage!==pageObj){ recoQueue=[]; recoQueuePage=pageObj; }
  let pts=st.points;
  if(pts.length<3) return null;
  let bb=strokeBBox(st);
  if(Math.hypot(bb.x2-bb.x1,bb.y2-bb.y1)<RECO_MIN_SIZE) return null;
  let brk=[0,0,0,0,0], ss=[null,null,null,null];
  /* first see if it's a polygon */
  let n=recoFindPolygonal(pts,0,pts.length-1,RECO_MAX_SIDES,brk,ss,0);
  if(n>0){
    recoOptimizePolygonal(pts,n,brk,ss);
    /* update recognizer segment queue (most recent at end) */
    while(n+recoQueue.length>RECO_MAX_SIDES){
      /* remove oldest polygonal stroke */
      let i=1; while(i<recoQueue.length && recoQueue[i].startpt!==0) i++;
      recoQueue.splice(0,i);
      if(!recoQueue.length) break;
    }
    for(let i=0;i<n;i++){ let seg=recoSegmentGeometry(pts,brk[i],brk[i+1],ss[i]); seg.srcStroke=st; recoQueue.push(seg); }
    let tri=recoTryTriangle(); if(tri) return recoFinishShape(tri,st);
    let rect=recoTryRectangle(); if(rect) return recoFinishShape(rect,st);
    if(n===1 && inertiaDet(ss[0])<RECO_LINE_MAX_DET){
      /* current stroke is a line */
      let rs=recoQueue[recoQueue.length-1];
      let aligned=true;
      if(Math.abs(rs.angle)<RECO_SLANT_TOL){ rs.angle=0; rs.y1=rs.y2=rs.ycenter; }         /* nearly horizontal */
      else if(Math.abs(rs.angle)>Math.PI/2-RECO_SLANT_TOL){ rs.angle=rs.angle>0?Math.PI/2:-Math.PI/2; rs.x1=rs.x2=rs.xcenter; } /* nearly vertical */
      else aligned=false;
      let out;
      if(aligned) out=[{x:rs.x1,y:rs.y1},{x:rs.x2,y:rs.y2}];
      else{
        let P={x:rs.x1,y:rs.y1}, Q={x:rs.x2,y:rs.y2}, last=pts[pts.length-1];
        let dx=Q.x-P.x, dy=Q.y-P.y;
        let num=dy*last.x-dx*last.y+Q.x*P.y-Q.y*P.x;
        let dist2=(num*num)/(dy*dy+dx*dx);
        if(dist2<RECO_LINE_POINT_DIST2) out=[P,Q];
        else out=[{x:pts[0].x,y:pts[0].y},{x:last.x,y:last.y}];
      }
      let stroke={tool:'poly',points:out,color:st.color,size:st.size};
      rs.srcStroke=stroke; /* the queued segment now belongs to the snapped line that lands on the page */
      return {stroke:stroke, consumed:[]};
    }
  }
  /* not a polygon: maybe a circle? */
  let circ=recoTryCircle(st);
  if(circ) return {stroke:circ, consumed:[]};
  return null;
}
function renderCanvasTexts(){
  let p=curPageObj(); let host=$('pageTextLayer'); if(!host) return; host.innerHTML=''; if(!p) return;
  (p.texts||[]).forEach(t=>{
    let d=document.createElement('div'); d.className='canvasText'; d.contentEditable='true'; d.textContent=t.text;
    d.style.left=(t.x/CW*100)+'%'; d.style.top=(t.y/PH*100)+'%'; d.style.color=pageInkColor(t.color,p); if(t.font) d.style.fontFamily=t.font; let cwPx=inkC.getBoundingClientRect().width; let scale=cwPx? cwPx/CW : 0.55; d.style.fontSize=Math.max(10,(t.size||26)*scale)+'px';
    d.addEventListener('input',()=>{ t.text=d.textContent; bumpV(p); });
    d.addEventListener('blur',()=>{ if(!d.textContent.trim()){ p.texts=p.texts.filter(x=>x!==t); renderCanvasTexts(); renderPages(); } });
    d.addEventListener('pointerdown',e=>e.stopPropagation());
    host.appendChild(d);
  });
  // scale text with canvas width via container query fallback: set font proportionally on resize is handled by % width; keep stored px size
}
function addPageText(pt){
  let p=curPageObj(); if(!p) return; if(!p.texts) p.texts=[];
  let fontSel=$('textFontSel'); let t={id:uid(),x:Math.max(0,snapVal(pt.x)-6),y:Math.max(0,snapVal(pt.y)-18),text:'Type here',color:S.color,size:16+ (+$('brushSize').value)*2,font:fontSel? fontSel.value:'Newsreader, serif'};
  p.texts.push(t); bumpV(p); renderCanvasTexts(); renderPages();
  let els=$('pageTextLayer').querySelectorAll('.canvasText'); let el=els[els.length-1]; if(el){ el.focus(); document.execCommand && document.execCommand('selectAll',false,null); }
  toast('Text on the page. Type to replace it, clear it to remove it.');
}
function renderCanvasImages(){
  let p=curPageObj(); let host=$('pageImageLayer'); if(!host) return; host.innerHTML=''; if(!p) return;
  (p.images||[]).forEach(im=>{
    if(!im._img){ let img=new Image(); img.src=im.src; im._img=img; img.onload=()=>renderPages(); }
    let wrap=document.createElement('div'); wrap.className='canvasImgWrap';
    wrap.style.left=(im.x/CW*100)+'%'; wrap.style.top=(im.y/PH*100)+'%'; wrap.style.width=(im.w/CW*100)+'%'; wrap.style.height=(im.h/PH*100)+'%';
    let imgEl=document.createElement('img'); imgEl.src=im.src; imgEl.alt='Inserted image on this page'; wrap.appendChild(imgEl);
    let grip=document.createElement('span'); grip.className='canvasImgGrip'; grip.textContent='↘'; wrap.appendChild(grip);
    let del=document.createElement('button'); del.className='miniBtn'; del.textContent='×'; del.title='Remove image'; del.style.cssText='position:absolute;top:-10px;left:-10px;z-index:3'; del.classList.add('onPage'); del.onclick=e=>{ e.stopPropagation(); p.images=p.images.filter(x=>x!==im); bumpV(p); renderCanvasImages(); renderPages(); };
    wrap.appendChild(del);
    wrap.addEventListener('pointerdown',e=>{
      if(e.target===grip||e.target===del) return; e.stopPropagation(); wrap.setPointerCapture(e.pointerId);
      let shell=inkC.getBoundingClientRect(); let sx=e.clientX, sy=e.clientY, ox=im.x, oy=im.y;
      function mv(ev){ im.x=ox+(ev.clientX-sx)*(CW/shell.width); im.y=oy+(ev.clientY-sy)*(PH/shell.height); wrap.style.left=(im.x/CW*100)+'%'; wrap.style.top=(im.y/PH*100)+'%'; }
      function up(){ wrap.removeEventListener('pointermove',mv); wrap.removeEventListener('pointerup',up); bumpV(p); renderPages(); }
      wrap.addEventListener('pointermove',mv); wrap.addEventListener('pointerup',up);
    });
    grip.addEventListener('pointerdown',e=>{
      e.stopPropagation(); grip.setPointerCapture(e.pointerId);
      let shell=inkC.getBoundingClientRect(); let sx=e.clientX, sy=e.clientY, ow=im.w, oh=im.h;
      function mv(ev){ im.w=Math.max(40, ow+(ev.clientX-sx)*(CW/shell.width)); im.h=Math.max(30, oh+(ev.clientY-sy)*(PH/shell.height)); wrap.style.width=(im.w/CW*100)+'%'; wrap.style.height=(im.h/PH*100)+'%'; }
      function up(){ grip.removeEventListener('pointermove',mv); grip.removeEventListener('pointerup',up); bumpV(p); renderPages(); }
      grip.addEventListener('pointermove',mv); grip.addEventListener('pointerup',up);
    });
    host.appendChild(wrap);
  });
}
function insertPageImage(e){
  let f=e.target.files[0]; e.target.value=''; if(!f) return;
  let nb=curNb(); if(!nb){ toast('Open a notebook first, then insert the image'); return; }
  if(S.view!=='editor'){ openNotebook(nb.id); }
  let r=new FileReader();
  r.onload=()=>{ let img=new Image(); img.onload=()=>{ let p=curPageObj(); if(!p) return; if(!p.images) p.images=[]; let w=Math.min(440, img.naturalWidth||440); let h=w*((img.naturalHeight||300)/(img.naturalWidth||440)); let im={id:uid(),x:90,y:90,w:w,h:h,src:String(r.result),_img:img}; p.images.push(im); bumpV(p); renderCanvasImages(); renderPages(); toast('Image on the page. Drag to move, drag the corner dot to resize, or use × to remove it.'); }; img.src=String(r.result); };
  r.readAsDataURL(f);
}
let editorZoom=1; let readerZoom=1; let readerZoomT=null;
function editorZoomBy(f){ editorZoom= f===0? 1 : Math.max(0.5, Math.min(2.5, editorZoom*f)); S.zoom=editorZoom; $('canvasShell').style.width=(editorZoom*100)+'%'; var zl=$('zoomLabel'); if(zl) zl.textContent=Math.round(editorZoom*100)+'%'; var zs=$('zoomSlider'); if(zs) zs.value=Math.round(editorZoom*100); var zp=$('zoomFabPct'); if(zp) zp.textContent=Math.round(editorZoom*100)+'%'; updateStatusBar(); clearTimeout(zoomRescaleT); zoomRescaleT=setTimeout(rescaleCanvases,140); } function readerZoomBy(f){ readerZoom=prClampZoom(f===0?1:readerZoom*f); let b=curBook(); if(b) b.readerZoom=readerZoom; let host=$('pdfPages'); if(host) host.style.width=(readerZoom*100)+'%'; let zl3=$('readerZoomLabel'); if(zl3) zl3.textContent=Math.round(readerZoom*100)+'%'; clearTimeout(readerZoomT); readerZoomT=setTimeout(()=>{ if(host) pdfRefresh(host,pdfDrawIO); },120); } let readerPinch=null; function readerTouchStart(e){ if(!e.touches||e.touches.length!==2) return; let b=curBook(); if(!b||b.kind!=='pdf') return; let host=$('pdfPages'); if(!host) return; let a=e.touches[0],c=e.touches[1],r=host.getBoundingClientRect(); readerPinch={host:host,d0:Math.max(20,Math.hypot(a.clientX-c.clientX,a.clientY-c.clientY)),z0:readerZoom,s:1}; e.preventDefault(); host.style.transformOrigin=((a.clientX+c.clientX)/2-r.left)+'px '+((a.clientY+c.clientY)/2-r.top)+'px'; } function readerTouchMove(e){ if(!readerPinch||!e.touches||e.touches.length!==2) return; e.preventDefault(); let a=e.touches[0],c=e.touches[1]; let z=prClampZoom(readerPinch.z0*Math.hypot(a.clientX-c.clientX,a.clientY-c.clientY)/readerPinch.d0); readerPinch.s=z/readerPinch.z0; readerPinch.host.style.transform='scale('+readerPinch.s+')'; } function readerTouchEnd(e){ if(!readerPinch||(e.touches&&e.touches.length>=2)) return; let p=readerPinch; readerPinch=null; p.host.style.transform=''; p.host.style.transformOrigin=''; if(Math.abs(p.s-1)>0.02) readerZoomBy(p.s); } (function(){ let pv=$('pdfView'); if(!pv) return; pv.style.touchAction='pan-x pan-y'; pv.addEventListener('touchstart',readerTouchStart,{passive:false}); pv.addEventListener('touchmove',readerTouchMove,{passive:false}); pv.addEventListener('touchend',readerTouchEnd,{passive:false}); pv.addEventListener('touchcancel',readerTouchEnd,{passive:false}); })();
function setPageBg(v){ let p=curPageObj(); if(!p) return; p.bgColor=v; bumpV(p); drawBackground(); renderPages(); }

/* Xiaomi Focus Pen (8192 pressure levels, tilt, barrel button): pen-first
   mode, a pressure curve with a dead zone, and a hover ring.
   - Pen-first: once a pen has been used on this device, a finger pans
     instead of drawing. The user can switch finger drawing back on with
     the "Pen only" toggle in the toolbar; that choice wins over the latch.
     Stored in localStorage (same try/catch pattern as the theme key);
     mouse drawing is never affected. Until a pen has been used, nothing
     changes: one finger still draws, two fingers still scroll.
   - Pressure curve: the pen reports 0..1 over 8192 levels, so raw pressure
     is far too jumpy at the light end. Below 0.04 nothing draws at all
     (hover-pressure noise), above it the response is eased (power 1.25)
     so a light stroke stays visibly thin and a firm stroke reaches full
     width. Applies to pen + highlighter; the eraser ignores pressure.
   - Barrel button: already mapped by applyStylusButton (button 5 / middle
     / buttons bit 32) via the "Pen button" select. The pen's Bluetooth
     shortcut button does NOT arrive as a pointer event in Chrome, so
     there is nothing to map it to here.
   - Tilt is not used: the calligraphy nib already keys off stroke
     direction, and nothing else in the stroke engine takes an angle. */
const PEN_DEADZONE=0.04, PEN_ONLY_KEY='inkwell-pen-only', PEN_SEEN_KEY='inkwell-pen-seen';
let penSeen=false, penOnlyStored=null;
try{ penSeen=localStorage.getItem(PEN_SEEN_KEY)==='1'; let v=localStorage.getItem(PEN_ONLY_KEY); penOnlyStored= v==='1'? true : v==='0'? false : null; }catch(e){}
function penOnlyActive(){ return penOnlyStored!==null? penOnlyStored : penSeen; }
function syncPenOnlyUI(){ let on=penOnlyActive(); document.querySelectorAll('[data-pen-only-btn]').forEach(b=>{ b.classList.toggle('active',on); b.setAttribute('aria-pressed',on?'true':'false'); }); }
function togglePenOnly(){ let on=!penOnlyActive(); penOnlyStored=on; try{ localStorage.setItem(PEN_ONLY_KEY,on?'1':'0'); }catch(e){} syncPenOnlyUI(); toast(on? 'Pen only: the pen draws, your finger scrolls' : 'Finger drawing on again — tap Pen only to switch it back'); }
function notePenSeen(){ if(penSeen) return; penSeen=true; try{ localStorage.setItem(PEN_SEEN_KEY,'1'); }catch(e){} syncPenOnlyUI(); toast('Pen seen — your finger now scrolls instead of drawing. Tap Pen only in the toolbar to change it.'); }

/* Links panel: closed by default at ≤1024px so the page fills the
   screen, one tap away via the Links button in the editor top bar;
   always open on wider screens (same mobileMoved hiding the pages
   panel uses). Stored choice wins on phones/tablets and survives a
   reload; desktop ignores it and stays open. */
const LINKS_OPEN_KEY='inkwell-links-open';
let linksOpenStored=null;
try{ let v=localStorage.getItem(LINKS_OPEN_KEY); linksOpenStored= v==='1'? true : v==='0'? false : null; }catch(e){}
function linksPanelOpen(){ if(window.matchMedia('(min-width:1025px)').matches) return true; return linksOpenStored!==null? linksOpenStored : false; }
function applyLinksPanel(){ let p=$('linksPanel'); if(!p) return; let open=linksPanelOpen(); p.classList.toggle('mobileMoved',!open); let b=$('linksToggleBtn'); if(b) b.setAttribute('aria-pressed',open?'true':'false'); }
function toggleLinksPanel(){ let open=!linksPanelOpen(); linksOpenStored=open; try{ localStorage.setItem(LINKS_OPEN_KEY,open?'1':'0'); }catch(e){} applyLinksPanel(); if(open){ let p=$('linksPanel'); if(p) p.scrollIntoView({block:'nearest'}); } }
function penPressureCurve(raw){ if(!(raw>0)) return 0; if(raw<PEN_DEADZONE) return 0; return Math.pow((raw-PEN_DEADZONE)/(1-PEN_DEADZONE),1.25); }
/* Hover ring: a ring at the pen tip, sized to the stroke the pen would
   make and tinted with the current colour. Moved with transform only
   (compositor), shown/hidden with opacity. */
let penHoverEl=null;
function penHoverRingEl(){ if(penHoverEl) return penHoverEl; let d=document.createElement('div'); d.id='penHoverRing'; d.setAttribute('aria-hidden','true'); document.body.appendChild(d); penHoverEl=d; return d; }
function showPenHoverRing(x,y,diameterPx,color,cursorEl){ let d=penHoverRingEl(); d.style.width=diameterPx+'px'; d.style.height=diameterPx+'px'; d.style.borderColor=color||'#18202B'; d.style.transform='translate('+(x-diameterPx/2)+'px,'+(y-diameterPx/2)+'px)'; d.style.opacity='1'; if(cursorEl) cursorEl.style.cursor='none'; }
function hidePenHoverRing(cursorEl){ if(penHoverEl) penHoverEl.style.opacity='0'; if(cursorEl) cursorEl.style.cursor=''; }
function penHoverMove(e){
  if(S.tool!=='pen' && S.tool!=='calligraphy' && S.tool!=='highlighter'){ hidePenHoverRing(inkC); return; }
  let size=+$('brushSize').value||4, rect=inkC.getBoundingClientRect(), scale=rect.width/CW;
  let w=(S.tool==='highlighter'? size*4.5 : S.tool==='calligraphy'? size*1.7 : size*1.4)*scale;
  showPenHoverRing(e.clientX,e.clientY,Math.max(6,w),S.color,inkC);
}
syncPenOnlyUI();

/* pointer drawing */
let drawing=false, curStroke=null, lastPt=null, lastT=0, eraseChanged=false;
function canvasPos(e,r){ r=r||inkC.getBoundingClientRect(); return { x:(e.clientX-r.left)*(CW/r.width), y:(e.clientY-r.top)*(PH/r.height) }; }
function pointerPressure(e,pt){
  if(e.pointerType==='pen' && e.pressure && e.pressure>0) return penPressureCurve(e.pressure);
  if(lastPt){ let d=Math.hypot(pt.x-lastPt.x,pt.y-lastPt.y); return Math.max(0.2,Math.min(1, 1.05 - d/46)); }
  return 0.6;
}
const SHAPE_TOOLS=['line','rect','ellipse','arrow'];
function isShapeTool(t){ return SHAPE_TOOLS.indexOf(t)>=0; }
function shouldDraw(e){ return S.tool!=='hand'; }
/* Scrolling while annotating, the way note apps do it. The canvas keeps
   touch-action:none at all times, so a drawing finger never makes the
   page jump; scrolling is done by hand here instead. ONE finger (or a
   stylus / mouse) draws with whatever tool is picked. A TWO-finger drag
   pans the page, and the zoomed canvas inside its scroller, even while
   a drawing tool is active. Spreading or pinching the two fingers zooms the page. The Hand tool pans with one finger. There is
   no Finger mode to set and nothing to confirm: a selected tool just
   works, and two fingers always move the page.
   When the second finger lands, any half-drawn stroke is thrown away
   (it was never committed to the page) along with its undo snapshot, and
   both fingers are marked "dead" for drawing: the finger that stays down
   after the pan ends is ignored until it lifts, so lifting one finger
   never drops the other back into a stroke mid-page. A touch that lands
   while a stylus is down is treated as a palm, not a pan. */
let inkPtrs=new Map(), panMid=null, handPan=null, panDead=new Set(), strokeUndoPushed=false, pinchZoom=null, gesturePtr=null, strokePtr=null;
function updateInkTouchAction(){ inkC.style.touchAction='none'; inkC.style.cursor= S.tool==='hand'? 'grab' : 'crosshair'; }
function zoomScroller(){ return inkC.closest? inkC.closest('.zoomScroll') : null; }
function panViewportBy(dx,dy){
  /* Content follows the fingers: scroll positions move against the drag.
     The zoom scroller consumes what it can; the rest pans the window. */
  let remX=dx, remY=dy, sc=zoomScroller();
  if(sc){ let pl=sc.scrollLeft, pt=sc.scrollTop; sc.scrollLeft-=dx; sc.scrollTop-=dy; remX=dx-(pl-sc.scrollLeft); remY=dy-(pt-sc.scrollTop); }
  /* Hand fix: the window fallback must be instant. html{scroll-behavior:
     smooth} makes a plain scrollBy lag far behind the finger during a
     drag — a 150px two-finger drag moved the page only ~15px, and a
     quick drag could read as no movement at all — while horizontal
     panning inside .zoomScroll was always instant. That gap is why the
     grab tool felt dead on the vertical axis. */
  if(remX||remY) window.scrollBy({left:-remX, top:-remY, behavior:'instant'});
}
function inkPtrMid(){ let ps=Array.from(inkPtrs.values()); return ps.length>=2? {x:(ps[0].x+ps[1].x)/2, y:(ps[0].y+ps[1].y)/2} : null; } function inkPtrDist(){ let ps=Array.from(inkPtrs.values()); return ps.length>=2?Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y):0; }
function abortGestureForPan(){
  gesturePtr=null; strokePtr=null;
  let wasMove=!!moveDrag;
  if(curStroke){ if(strokeUndoPushed && S.undoStack.length) S.undoStack.pop(); curStroke=null; }
  liveX.clearRect(0,0,CW,PH);
  drawing=false; lastPt=null; strokeUndoPushed=false; handPan=null;
  selDrag=false; moveDrag=null; lassoPts=null; vspaceDrag=null; S.selRect=null;
  drawSelectionOverlay();
  if(wasMove || S.tool==='eraser') renderPages();
}
function cloneStrokes(a){ return JSON.parse(JSON.stringify(a||[])); }
function snapshotUndo(){ let p=curPageObj(); if(!p) return; S.undoStack.push({ink:cloneStrokes(p.ink),hi:cloneStrokes(p.hi)}); if(S.undoStack.length>60) S.undoStack.shift(); S.redoStack=[]; }
function undoStroke(){ let p=curPageObj(); if(!p) return; let s=S.undoStack.pop(); if(!s){toast('Nothing to undo');return} S.redoStack.push({ink:cloneStrokes(p.ink),hi:cloneStrokes(p.hi)}); p.ink=s.ink; p.hi=s.hi; S.selection=[]; bumpV(p); redrawLayer('ink'); redrawLayer('hi'); drawSelectionOverlay(); renderPages(); }
function redoStroke(){ let p=curPageObj(); if(!p) return; let s=S.redoStack.pop(); if(!s){toast('Nothing to redo');return} S.undoStack.push({ink:cloneStrokes(p.ink),hi:cloneStrokes(p.hi)}); p.ink=s.ink; p.hi=s.hi; S.selection=[]; bumpV(p); redrawLayer('ink'); redrawLayer('hi'); drawSelectionOverlay(); renderPages(); }
function renderLive(){
  if(!curStroke) return;
  let p=curPageObj(); if(!p) return;
  /* The stroke in progress draws on its own overlay canvas, not on the
     ink layer. The old renderLive cleared the layer and re-drew EVERY
     committed stroke on the page for each pointer event — O(all ink on
     the page) per move, ~7ms on a page with 200 strokes, so the stylus
     lagged behind the pen and got worse the more was on the page. Now a
     move costs only the live stroke itself (one path, a few dozen
     points), whatever else the page holds. On lift, endStroke clears
     the overlay and redraws the layer once with the exact final stroke
     (tapered pressure outline), so what you see while drawing is a
     plain round-cap preview of the same line. */
  liveX.clearRect(0,0,CW,PH);
  if(curStroke.tool==='shape' || curStroke._compassCenter){ drawStroke(liveX,curStroke,p); return; }
  let pts=curStroke.points; if(!pts.length) return;
  liveX.save();
  liveX.lineCap='round'; liveX.lineJoin='round';
  if(curStroke.tool==='highlighter'){ liveX.globalCompositeOperation=isDarkPage(p)?'screen':'multiply'; liveX.globalAlpha=0.42; liveX.strokeStyle=pageInkColor(curStroke.color,p); liveX.lineWidth=curStroke.size*4.5; }
  else { liveX.strokeStyle=pageInkColor(curStroke.color,p); liveX.lineWidth=Math.max(1.5,curStroke.size*1.4); if(curStroke.style&&curStroke.style!=='solid') liveX.setLineDash(dashFor(curStroke)); }
  if(pts.length===1){ liveX.fillStyle=liveX.strokeStyle; liveX.beginPath(); liveX.arc(pts[0].x,pts[0].y,Math.max(1.1,curStroke.size*0.6),0,7); liveX.fill(); }
  else { liveX.beginPath(); liveX.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++) liveX.lineTo(pts[i].x,pts[i].y); liveX.stroke(); }
  liveX.restore();
}
/* Stylus button mapping: the pen's eraser end or barrel button temporarily
   swaps in the mapped tool for the length of that stroke, then the chosen
   tool comes back, the toolbar never changes. */
let barrelSavedTool=null;
function applyStylusButton(e){
  if(e.pointerType!=='pen') return;
  let mapEl=$('stylusBtnSel'); let map=mapEl? mapEl.value : 'eraser';
  if(map==='none') return;
  if(e.button===5 || e.button===1 || (e.buttons&32)){
    barrelSavedTool=S.tool;
    S.tool= map==='select'? 'select':'eraser';
  }
}
inkC.addEventListener('pointerup',()=>{ if(barrelSavedTool!==null){ S.tool=barrelSavedTool; barrelSavedTool=null; } });
inkC.addEventListener('pointercancel',()=>{ if(barrelSavedTool!==null){ S.tool=barrelSavedTool; barrelSavedTool=null; } });
inkC.addEventListener('pointerleave',()=>hidePenHoverRing(inkC));
inkC.addEventListener('pointerdown',e=>{
  inkPtrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
  if(e.pointerType==='pen'){ notePenSeen(); hidePenHoverRing(inkC); }
  if(inkPtrs.size===2){
    /* Second finger down: abandon whatever the first finger was doing and
       turn the gesture into a two-finger pan. Skipped when a stylus is
       down (that touch is a resting palm) or the new pointer isn't touch. */
    let types=Array.from(inkPtrs.values()).map(p=>p.type);
    if(e.pointerType!=='touch' || types.indexOf('pen')>=0) return;
    e.preventDefault();
    try{ inkC.setPointerCapture(e.pointerId); }catch(err){}
    abortGestureForPan();
    panMid=inkPtrMid(); pinchZoom={d0:Math.max(20,inkPtrDist()),z0:editorZoom};
    inkPtrs.forEach((v,id)=>panDead.add(id));
    return;
  }
  if(inkPtrs.size>2 || panMid || panDead.has(e.pointerId)) return;
  gesturePtr=e.pointerId; /* the pointer that starts the gesture owns it: a resting palm moving mid-gesture is ignored in pointermove */
  applyStylusButton(e);
  if(!curPageObj()) return;
  if(S.tool==='hand' || (e.pointerType==='touch' && penOnlyActive())){
    /* Hand tool: one finger pans, through the same manual pan as two fingers.
       Pen only: with the latch on, a finger pans too — only the pen draws. */
    e.preventDefault();
    try{ inkC.setPointerCapture(e.pointerId); }catch(err){}
    handPan={x:e.clientX,y:e.clientY};
    return;
  }
  if(!shouldDraw(e)) return;
  let pt0=canvasPos(e);
  if(S.tool==='text'){ e.preventDefault(); addPageText(pt0); return; }
  if(S.tool==='select'){
    e.preventDefault(); inkC.setPointerCapture(e.pointerId);
    let bb=selectionBBox();
    if(bb && pt0.x>=bb.x1-10 && pt0.x<=bb.x2+10 && pt0.y>=bb.y1-10 && pt0.y<=bb.y2+10){ snapshotUndo(); moveDrag={x:pt0.x,y:pt0.y}; return; }
    S.selection=[]; selDrag=true; S.selRect={x1:pt0.x,y1:pt0.y,x2:pt0.x,y2:pt0.y}; drawSelectionOverlay(); return;
  }
  if(S.tool==='lasso'){
    e.preventDefault(); inkC.setPointerCapture(e.pointerId);
    S.selection=[]; lassoPts=[{x:pt0.x,y:pt0.y}]; drawSelectionOverlay(); return;
  }
  if(S.tool==='vspace'){
    e.preventDefault(); inkC.setPointerCapture(e.pointerId);
    vspaceDrag={y:pt0.y, cur:pt0.y}; drawVspaceOverlay(); return;
  }
  if(S.tool==='spline'){
    e.preventDefault();
    let sp={x:snapVal(pt0.x), y:snapVal(pt0.y)};
    if(splinePts.length && Math.hypot(sp.x-splinePts[splinePts.length-1].x, sp.y-splinePts[splinePts.length-1].y)<14){ finishSpline(); return; }
    splinePts.push(sp); $('splineDoneBtn').classList.remove('hidden'); drawSplineOverlay();
    if(splinePts.length===1) toast('Spline: tap more points along the curve, double-tap the last point, or press Finish spline.');
    return;
  }
  if(S.tool==='compass'){
    e.preventDefault(); inkC.setPointerCapture(e.pointerId);
    drawing=true; snapshotUndo(); strokeUndoPushed=true;
    curStroke={tool:'shape', shape:'ellipse', color:S.color, size:+$('brushSize').value, fill:!!$('fillTgl').checked, style:S.strokeStyle, points:[{x:pt0.x,y:pt0.y},{x:pt0.x,y:pt0.y}]};
    curStroke._layer='ink'; curStroke._compassCenter={x:pt0.x,y:pt0.y};
    renderLive(); return;
  }
  e.preventDefault(); inkC.setPointerCapture(e.pointerId);
  drawing=true; eraseChanged=false; snapshotUndo(); strokeUndoPushed=true; strokePtr=e.pointerId;
  let pt=pt0; pt.p=pointerPressure(e,pt); lastPt=pt;
  if(S.tool==='eraser'){
    if(S.eraserMode==='whiteout'){ let pg=curPageObj(); curStroke={tool:'pen', color:(pg&&pg.bgColor)||'#fffdf6', size:Math.max(10,+$('brushSize').value*3), points:[pt]}; curStroke._layer='ink'; curStroke._whiteout=true; renderLive(); return; }
    eraseAt(pt); return;
  }
  if(isShapeTool(S.tool)){ let sx=snapVal(pt.x), sy=snapVal(pt.y); curStroke={tool:'shape', shape:S.tool, color:S.color, size:+$('brushSize').value, fill:!!$('fillTgl').checked, style:S.strokeStyle, points:[{x:sx,y:sy},{x:sx,y:sy}]}; curStroke._layer='ink'; renderLive(); return; }
  /* Dead zone: a pen resting below 0.04 pressure starts an empty stroke;
     points arrive with the first real press, and an empty stroke is
     dropped on lift (see endStroke) instead of leaving a hairline. */
  curStroke={tool:S.tool, color:S.color, size:+$('brushSize').value, style:S.strokeStyle, points:(pt.p>0?[pt]:[])};
  if(S.recording) curStroke.t=Date.now()-S.recStart;
  curStroke._layer= S.tool==='highlighter'? 'hi':'ink';
  renderLive();
});
inkC.addEventListener('pointermove',e=>{
  if(inkPtrs.has(e.pointerId)) inkPtrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
  if(e.pointerType==='pen'){
    if(e.buttons===0 && !drawing && !panMid && !handPan && gesturePtr===null) penHoverMove(e);
    else hidePenHoverRing(inkC);
  }
  if(gesturePtr!==null && e.pointerId!==gesturePtr && !panMid) return; /* a resting palm moving while another pointer owns the gesture */
  if(panMid){
    let m=inkPtrMid(); if(!m) return;
    let dx=m.x-panMid.x, dy=m.y-panMid.y; panMid=m;
    if(dx||dy){ e.preventDefault(); panViewportBy(dx,dy); } if(pinchZoom){ let z=Math.max(0.5,Math.min(2.5,pinchZoom.z0*inkPtrDist()/Math.max(20,pinchZoom.d0))); if(Math.abs(z-editorZoom)>0.005) editorZoomBy(z/editorZoom); }
    return;
  }
  if(panDead.has(e.pointerId)) return;
  if(handPan){
    let dx=e.clientX-handPan.x, dy=e.clientY-handPan.y; handPan={x:e.clientX,y:e.clientY};
    if(dx||dy){ e.preventDefault(); panViewportBy(dx,dy); }
    return;
  }
  if(S.tool==='select'){
    let pt=canvasPos(e);
    if(moveDrag){ let dx=pt.x-moveDrag.x, dy=pt.y-moveDrag.y; moveDrag.x=pt.x; moveDrag.y=pt.y;
      if(S.snapGrid){ moveDrag.rx=(moveDrag.rx||0)+dx; moveDrag.ry=(moveDrag.ry||0)+dy; dx=Math.round(moveDrag.rx/24)*24; dy=Math.round(moveDrag.ry/24)*24; moveDrag.rx-=dx; moveDrag.ry-=dy; if(!dx&&!dy){ drawSelectionOverlay(); return; } }
      S.selection.forEach(st=>st.points.forEach(q=>{ q.x+=dx; q.y+=dy; })); drawSelectionOverlay(); return; }
    if(selDrag && S.selRect){ S.selRect.x2=pt.x; S.selRect.y2=pt.y; drawSelectionOverlay(); }
    return;
  }
  if(S.tool==='lasso'){
    if(lassoPts){ let pt=canvasPos(e); let last=lassoPts[lassoPts.length-1]; if(Math.hypot(pt.x-last.x,pt.y-last.y)>6){ lassoPts.push({x:pt.x,y:pt.y}); drawSelectionOverlay(); drawLassoOverlay(); } }
    return;
  }
  if(S.tool==='vspace'){
    if(vspaceDrag){ vspaceDrag.cur=canvasPos(e).y; drawSelectionOverlay(); drawVspaceOverlay(); }
    return;
  }
  if(!drawing) return;
  let evts=e.getCoalescedEvents? e.getCoalescedEvents():[e];
  let rect=inkC.getBoundingClientRect(); /* once per dispatch, not once per coalesced point */
  evts.forEach(ev=>{
    let pt=canvasPos(ev,rect); pt.p=pointerPressure(ev,pt);
    if(curStroke && curStroke.tool==='shape' && curStroke._compassCenter){ let c=curStroke._compassCenter; let r=Math.hypot(pt.x-c.x,pt.y-c.y); curStroke.points=[{x:c.x-r,y:c.y-r},{x:c.x+r,y:c.y+r}]; renderLive(); lastPt=pt; return; }
    if(curStroke && curStroke.tool==='shape'){ curStroke.points[1]={x:snapVal(pt.x),y:snapVal(pt.y)}; renderLive(); lastPt=pt; return; }
    if(lastPt){ let keep=1-(S.stabilize||0)/100; pt.x=lastPt.x+(pt.x-lastPt.x)*keep; pt.y=lastPt.y+(pt.y-lastPt.y)*keep; } // input stabilization (streamline): Smooth slider sets how much jitter is filtered
    if(pt.p<=0 && curStroke && (curStroke.tool==='pen'||curStroke.tool==='calligraphy'||curStroke.tool==='highlighter')){ lastPt=pt; return; } /* dead zone: below 0.04 pressure, no point */
    if(S.tool==='eraser'){ eraseAt(pt); lastPt=pt; return; }
    if(curStroke){ curStroke.points.push(pt); renderLive(); }
    lastPt=pt;
  });
});
function bumpV(p){ if(p) p._v=(p._v||0)+1; scheduleSave(); }
function endStroke(){
  liveX.clearRect(0,0,CW,PH); /* the stroke in progress lives on the overlay; the layer below holds the finished one */
  if(S.tool==='select'){ if(moveDrag){ moveDrag=null; let p=curPageObj(); bumpV(p); renderPages(); drawSelectionOverlay(); } if(selDrag){ selDrag=false; finishSelection(); } return; }
  if(S.tool==='lasso'){ if(lassoPts && lassoPts.length>2) finishLasso(); else { lassoPts=null; drawSelectionOverlay(); } return; }
  if(S.tool==='vspace'){ if(vspaceDrag) finishVspace(); return; }
  if(!drawing) return; drawing=false;
  let p=curPageObj();
  if(curStroke && p && curStroke.points.length===0){ /* pen never pressed past the dead zone: no mark, drop the undo snapshot too */
    if(strokeUndoPushed && S.undoStack.length) S.undoStack.pop();
    curStroke=null; lastPt=null; strokeUndoPushed=false; return;
  }
  if(curStroke && p){
    let layer=curStroke._layer||'ink';
    let finalStroke=curStroke;
    if(finalStroke.tool!=='shape' && !finalStroke._whiteout && $('recognizerTgl') && $('recognizerTgl').checked && (finalStroke.tool==='pen'||finalStroke.tool==='calligraphy')){
      let rec=recognizeStroke(finalStroke,p);
      if(rec){ finalStroke=rec.stroke; (rec.consumed||[]).forEach(cs=>{ let ix=p.ink.indexOf(cs); if(ix>=0) p.ink.splice(ix,1); }); }
    }
    delete finalStroke._layer; delete finalStroke._whiteout; delete finalStroke._compassCenter;
    p[layer].push(finalStroke); S.stats.strokes++; redrawLayer(layer); bumpV(p);
  }
  curStroke=null; lastPt=null;
  if(S.tool==='eraser'){ redrawLayer('ink'); redrawLayer('hi'); } /* clear the eraser touch ring */
  renderPages();
}
function inkPointerUp(e){
  let wasPan=!!panMid, wasHand=!!handPan;
  inkPtrs.delete(e.pointerId); panDead.delete(e.pointerId);
  if(e.pointerId===gesturePtr) gesturePtr=null;
  if(e.pointerId===strokePtr) strokePtr=null;
  if(wasPan){ if(inkPtrs.size<2){ panMid=null; pinchZoom=null; } return; }
  if(panDead.size) return; /* a finger left over from a pan never draws */
  if(wasHand){ handPan=null; return; }
  endStroke();
  strokeUndoPushed=false;
}
inkC.addEventListener('pointerup',inkPointerUp);
inkC.addEventListener('pointercancel',inkPointerUp);
/* ============ Eraser: padded-box stroke splitting ============
   The eraser is a square. Around it sits a second, larger square padded
   by 0.4 x the stroke's width (the round-cap padding coefficient). A
   stretch of stroke is erased only where it crosses the padded square
   AND the stroke actually reaches the inner square somewhere along the
   way, so ink is cut exactly at the padded boundary, but a near miss
   erases nothing. The surviving stretches are rebuilt as new strokes
   from the path parameters between the crossings; a closed stroke whose
   two ends survive is rejoined into one circular section. */
const ERASE_PAD_COEFF=0.4;        /* PADDING_COEFFICIENT_CAP for round caps */
const ERASE_CLOSED_DIST=0.3;      /* CLOSED_STROKE_DISTANCE */
function eraseRect(cx,cy,half){ return {x:cx-half,y:cy-half,w:2*half,h:2*half}; }
function ptInRect(x,y,r){ return x>=r.x && x<=r.x+r.w && y>=r.y && y<=r.y+r.h; }
/* Interval of the infinite line p->q inside rect as [tmin,tmax], or null */
function lineRectInterval(p,q,rect){
  function strip(a1,a2,amin,aw){ let norm=1/(a2-a1); let t1=(amin-a1)*norm; let t2=t1+aw*norm; return [Math.min(t1,t2),Math.max(t1,t2)]; }
  if(p.x===q.x){
    if(p.y===q.y) return null; /* single dot */
    if(rect.x<p.x && p.x<rect.x+rect.w) return strip(p.y,q.y,rect.y,rect.h); /* vertical segment */
    return null;
  }
  if(p.y===q.y){
    if(rect.y<p.y && p.y<rect.y+rect.h) return strip(p.x,q.x,rect.x,rect.w); /* horizontal segment */
    return null;
  }
  let v=strip(p.y,q.y,rect.y,rect.h), h=strip(p.x,q.x,rect.x,rect.w);
  let lo=Math.max(v[0],h[0]), hi=Math.min(v[1],h[1]);
  return lo<=hi ? [lo,hi] : null;
}
/* Same, but only the parameters between 0 and 1 (points between p and q) */
function segRectParams(p,q,rect){
  let iv=lineRectInterval(p,q,rect); if(!iv) return [];
  let out=[];
  if(iv[0]>0.0 && iv[0]<=1.0) out.push(iv[0]);
  if(iv[1]>0.0 && iv[1]<=1.0) out.push(iv[1]);
  return out;
}
function pointAtParam(pts,par){
  let p=pts[par.index], q=pts[par.index+1];
  let pr=(p.p!=null?p.p:0.5);
  if(!q) return {x:p.x,y:p.y,p:pr};
  return {x:p.x+(q.x-p.x)*par.t, y:p.y+(q.y-p.y)*par.t, p:pr}; /* pressure is that of the segment's first point */
}
/* Parameters where the stroke crosses in/out of the padded box (flat, even count, sorted) */
function strokePaddedBoxParams(pts,box){
  let n=pts.length;
  if(n<2){
    if(n===1 && ptInRect(pts[0].x,pts[0].y,eraseRect(box.cx,box.cy,box.half))) return [{index:0,t:0},{index:0,t:0}];
    return [];
  }
  let inner=eraseRect(box.cx,box.cy,box.half), outer=eraseRect(box.cx,box.cy,box.halfPad);
  let firstIndex=0, lastIndex=n-2;
  let flags;
  (function initFlags(){
    let fk=pts[firstIndex], ht=pts[firstIndex+1];
    if(ptInRect(fk.x,fk.y,inner)){ flags={insideOuter:true,wentInner:true,endedOnBoundary:false}; return; }
    if(ptInRect(fk.x,fk.y,outer)){
      let iv=lineRectInterval(fk,ht,inner);
      /* if the half tangent goes towards the inner box, say we've been inside it */
      flags={insideOuter:true,wentInner:!!(iv && iv[1]<=0.0),endedOnBoundary:false}; return;
    }
    flags={insideOuter:false,wentInner:false,endedOnBoundary:false};
  })();
  let result=[];
  if(flags.insideOuter) result.push({index:firstIndex,t:0}); /* we start inside the padded box: fake intersection */
  for(let index=firstIndex; index<=lastIndex; index++){
    let fk=pts[index], sk=pts[index+1];
    let outerHits=segRectParams(fk,sk,outer);
    if(outerHits.length || ptInRect(fk.x,fk.y,outer) || ptInRect(sk.x,sk.y,outer)){
      /* some part of the segment lies inside the padded box */
      let innerHits=segRectParams(fk,sk,inner), ii=0;
      function skipInnerBelow(v){ let skipped=false; while(ii<innerHits.length && innerHits[ii]<v){ skipped=true; ii++; } return skipped; }
      if(flags.endedOnBoundary){
        flags.endedOnBoundary=false;
        let px=sk.x, py=sk.y;
        if(outerHits.length){ let t=0.5*outerHits[0]; px=fk.x+(sk.x-fk.x)*t; py=fk.y+(sk.y-fk.y)*t; }
        if(ptInRect(px,py,outer) !== (result.length%2!==0)){
          /* the stroke bounced back on the box border and never got in or out */
          if(result.length) result.pop();
        }
      }
      for(let oi=0; oi<outerHits.length; oi++){
        let t=outerHits[oi];
        if(skipInnerBelow(t)) flags.wentInner=true;
        if(!flags.insideOuter || flags.wentInner){
          result.push({index:index,t:t});
          if(t===1.0) flags.endedOnBoundary=true;
        } else {
          if(result.length) result.pop();
        }
        flags.wentInner=false;
        flags.insideOuter=!flags.insideOuter;
      }
      if(ii<innerHits.length) flags.wentInner=true;
    }
  }
  let inconsistent=false;
  if(result.length%2!==0){
    /* not necessarily inconsistent: the stroke may end inside the outer box */
    let lastPt=pts[n-1], prevPt=pts[n-2];
    if(ptInRect(lastPt.x,lastPt.y,outer)){
      let toward=flags.wentInner;
      if(!toward){ let iv=lineRectInterval(lastPt,prevPt,inner); toward=!!(iv && iv[1]<0.0); }
      if(toward) result.push({index:lastIndex,t:1.0});
      else result.pop();
    } else inconsistent=true;
  }
  if(!inconsistent){
    /* sanity check: a point midway through each erased stretch must lie inside the outer box */
    for(let i=0;i+1<result.length;i+=2){
      let a=result[i], b=result[i+1], mid;
      if(a.index===b.index) mid=pointAtParam(pts,{index:a.index,t:(a.t+b.t)/2});
      else mid=pts[Math.floor((a.index+b.index+1)/2)];
      if(!ptInRect(mid.x,mid.y,outer)){ inconsistent=true; break; }
    }
  }
  return inconsistent ? [] : result;
}
function cloneStrokeWithPoints(st,newPts){
  let out=[]; newPts.forEach((pt,i)=>{ if(i===0 || pt.x!==newPts[i-1].x || pt.y!==newPts[i-1].y) out.push(pt); });
  if(out.length<2) return null;
  let c={}; for(let k in st) if(k!=='points') c[k]=st[k];
  c.points=out; return c;
}
function cloneSectionStroke(st,lo,hi){
  let pts=st.points, np=[pointAtParam(pts,lo)];
  for(let i=lo.index+1;i<=hi.index;i++) np.push({x:pts[i].x,y:pts[i].y,p:(pts[i].p!=null?pts[i].p:0.5)});
  np.push(pointAtParam(pts,hi));
  return cloneStrokeWithPoints(st,np);
}
function cloneCircularSectionStroke(st,startPar,endPar){
  let pts=st.points, n=pts.length, np=[pointAtParam(pts,startPar)];
  for(let i=startPar.index+1;i<=n-2;i++) np.push({x:pts[i].x,y:pts[i].y,p:(pts[i].p!=null?pts[i].p:0.5)});
  for(let i=0;i<=endPar.index;i++) np.push({x:pts[i].x,y:pts[i].y,p:(pts[i].p!=null?pts[i].p:0.5)});
  np.push(pointAtParam(pts,endPar));
  return cloneStrokeWithPoints(st,np);
}
/* Split one stroke around the eraser box: null = untouched, [] = fully erased, else the surviving strokes */
function eraseStrokeSplit(st,box){
  let pts=st.points, n=pts.length;
  if(n===1) return ptInRect(pts[0].x,pts[0].y,eraseRect(box.cx,box.cy,box.half)) ? [] : null;
  if(n<2) return null;
  let params=strokePaddedBoxParams(pts,box);
  if(!params.length) return null;
  /* remaining sections = complement of the erased stretches over the whole path */
  function cmpPar(a,b){ return (a.index+a.t)-(b.index+b.t); }
  let end={index:n-2,t:1.0}, sections=[], cur={index:0,t:0};
  for(let i=0;i+1<params.length;i+=2){
    if(cmpPar(params[i],cur)>0) sections.push({min:cur,max:params[i]});
    cur=params[i+1];
  }
  if(cmpPar(end,cur)>0) sections.push({min:cur,max:end});
  let closed = n>=3 && Math.hypot(pts[0].x-pts[n-1].x,pts[0].y-pts[n-1].y)<ERASE_CLOSED_DIST;
  let merge = closed && sections.length>=2 &&
    sections[0].min.index===0 && sections[0].min.t===0 &&
    sections[sections.length-1].max.index===n-2 && sections[sections.length-1].max.t===1.0;
  let out=[], from=0, to=sections.length;
  if(merge){
    /* clone the first and last sections as a single circular stroke */
    let m=cloneCircularSectionStroke(st,sections[sections.length-1].min,sections[0].max);
    if(m) out.push(m);
    from=1; to=sections.length-1;
  }
  for(let i=from;i<to;i++){ let c=cloneSectionStroke(st,sections[i].min,sections[i].max); if(c) out.push(c); }
  return out;
}
function strokeWidthOf(st){
  if(st.tool==='highlighter') return st.size*4.5;
  if(st.tool==='shape'||st.tool==='poly') return Math.max(1.5,st.size*1.4);
  if(st.tool==='calligraphy') return st.size*1.7;
  return st.size*1.8;
}
/* Parametric shape strokes are outlines too once the eraser touches them */
function shapeToPolylines(st){
  let a=st.points[0], b=st.points[st.points.length-1]; if(!a||!b) return [];
  function mk(np){ let c={}; for(let k in st) if(k!=='points'&&k!=='shape'&&k!=='fill') c[k]=st[k]; c.tool='poly'; c.points=np; return c; }
  if(st.shape==='line') return [mk([{x:a.x,y:a.y},{x:b.x,y:b.y}])];
  if(st.shape==='rect'){ let x1=Math.min(a.x,b.x), y1=Math.min(a.y,b.y), x2=Math.max(a.x,b.x), y2=Math.max(a.y,b.y); return [mk([{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2},{x:x1,y:y1}])]; }
  if(st.shape==='ellipse'){ let cx=(a.x+b.x)/2, cy=(a.y+b.y)/2, rx=Math.abs(b.x-a.x)/2, ry=Math.abs(b.y-a.y)/2, np=[]; for(let i=0;i<=64;i++){ let t=i/64*Math.PI*2; np.push({x:cx+rx*Math.cos(t),y:cy+ry*Math.sin(t)}); } return [mk(np)]; }
  if(st.shape==='arrow'){ let ang=Math.atan2(b.y-a.y,b.x-a.x), hl=18+st.size*2; let h1={x:b.x-hl*Math.cos(ang-0.42),y:b.y-hl*Math.sin(ang-0.42)}, h2={x:b.x-hl*Math.cos(ang+0.42),y:b.y-hl*Math.sin(ang+0.42)}; return [mk([{x:a.x,y:a.y},{x:b.x,y:b.y}]), mk([h1,{x:b.x,y:b.y},h2])]; }
  return [];
}
/* Whole-stroke eraser: the touch zone grows with the Size slider, and the
   hit test measures the true distance from the eraser's path to the stroke
   itself, never its bounding box, so touching a stroke deletes exactly
   that stroke, nearby strokes survive, and a fast flick still catches the
   strokes it sweeps across between pointer samples. */
function eraserRadius(){ return 16 + (+$('brushSize').value)*3; }
function distPtSeg(px,py,ax,ay,bx,by){
  let dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy;
  let t= l2? Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)) : 0;
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}
function segSegDist(a,b,c,d){
  function orient(p,q,r){ let v=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x); return v===0?0:(v>0?1:2); }
  function onSeg(p,q,r){ return q.x<=Math.max(p.x,r.x) && q.x>=Math.min(p.x,r.x) && q.y<=Math.max(p.y,r.y) && q.y>=Math.min(p.y,r.y); }
  let o1=orient(a,b,c), o2=orient(a,b,d), o3=orient(c,d,a), o4=orient(c,d,b);
  if(o1!==o2 && o3!==o4) return 0;
  if(o1===0 && onSeg(a,c,b)) return 0;
  if(o2===0 && onSeg(a,d,b)) return 0;
  if(o3===0 && onSeg(c,a,d)) return 0;
  if(o4===0 && onSeg(c,b,d)) return 0;
  return Math.min(
    distPtSeg(a.x,a.y,c.x,c.y,d.x,d.y), distPtSeg(b.x,b.y,c.x,c.y,d.x,d.y),
    distPtSeg(c.x,c.y,a.x,a.y,b.x,b.y), distPtSeg(d.x,d.y,a.x,a.y,b.x,b.y));
}
function strokeTouchedByEraser(st,a,b){
  let tol=eraserRadius() + strokeWidthOf(st)/2;
  if(st.tool==='shape' && st.fill){
    /* A filled shape is solid: touching its inside deletes it too. */
    let p0=st.points[0], p1=st.points[st.points.length-1];
    if(p0 && p1){
      if(st.shape==='ellipse'){
        let cx=(p0.x+p1.x)/2, cy=(p0.y+p1.y)/2, rx=Math.abs(p1.x-p0.x)/2+tol, ry=Math.abs(p1.y-p0.y)/2+tol;
        if(rx>0 && ry>0){ let inside=q=>((q.x-cx)*(q.x-cx))/(rx*rx)+((q.y-cy)*(q.y-cy))/(ry*ry)<=1; if(inside(a)||inside(b)) return true; }
      } else {
        let x1=Math.min(p0.x,p1.x)-tol, x2=Math.max(p0.x,p1.x)+tol, y1=Math.min(p0.y,p1.y)-tol, y2=Math.max(p0.y,p1.y)+tol;
        let inside=q=> q.x>=x1 && q.x<=x2 && q.y>=y1 && q.y<=y2;
        if(inside(a)||inside(b)||inside({x:(a.x+b.x)/2,y:(a.y+b.y)/2})) return true;
      }
    }
  }
  let polys= st.tool==='shape'? shapeToPolylines(st) : [st];
  for(let pi=0; pi<polys.length; pi++){
    let pts=polys[pi].points; if(!pts || !pts.length) continue;
    if(pts.length===1){ if(distPtSeg(pts[0].x,pts[0].y,a.x,a.y,b.x,b.y)<=tol) return true; continue; }
    for(let i=1;i<pts.length;i++){ if(segSegDist(a,b,pts[i-1],pts[i])<=tol) return true; }
  }
  return false;
}
function drawEraserCursor(pt){
  if(S.tool!=='eraser' || S.eraserMode!=='stroke' || !pt) return;
  liveX.save(); liveX.strokeStyle='rgba(178,38,30,.8)'; liveX.lineWidth=2;
  liveX.beginPath(); liveX.arc(pt.x,pt.y,eraserRadius(),0,7); liveX.stroke(); liveX.restore();
}
/* Brush size in plain words, with a live preview drawn at the stroke's real
   width (in page-canvas units) in the current ink colour, so how thick the
   next stroke will be is obvious at a glance, no numbers to decode. */
function sizeWord(v){ return v<=3? 'Thin' : v<=7? 'Medium' : v<=11? 'Thick' : 'Extra thick'; }
function updateSizeUI(){
  let slider=$('brushSize'); if(!slider) return;
  let v=+slider.value;
  let w=$('sizeWord'); if(w) w.textContent=sizeWord(v);
  let c=$('sizePreview'); if(!c) return;
  let x=c.getContext('2d'); x.clearRect(0,0,c.width,c.height);
  x.lineCap='round'; x.lineJoin='round';
  let midY=c.height/2;
  if(S.tool==='eraser' && S.eraserMode!=='whiteout'){
    /* Preview the eraser's touch zone instead of a stroke. */
    x.strokeStyle='#b2261e'; x.lineWidth=1.6; x.setLineDash([4,3]);
    x.beginPath(); x.arc(c.width/2,midY,Math.min(13,5+v*0.55),0,7); x.stroke(); x.setLineDash([]);
    return;
  }
  let width, alpha=1;
  if(S.tool==='highlighter'){ width=Math.min(26, v*4.5); alpha=0.45; }
  else if(S.tool==='eraser'){ width=Math.min(28, Math.max(10, v*3)*1.8); } /* whiteout paints a page-coloured stroke */
  else if(isShapeTool(S.tool) || S.tool==='compass'){ width=Math.max(1.5, v*1.4); }
  else if(S.tool==='calligraphy'){ width=v*1.7; }
  else { width=v*1.8; }
  x.strokeStyle= S.tool==='eraser'? '#c9c2ae' : S.color;
  x.globalAlpha= (S.tool==='eraser')? 1 : alpha;
  x.lineWidth=Math.max(1,width);
  x.beginPath(); x.moveTo(5,midY+3); x.quadraticCurveTo(c.width/2,midY-4,(c.width-5),midY+3); x.stroke();
  x.globalAlpha=1;
}
function eraseAt(pt){
  let p=curPageObj(); if(!p) return;
  if(S.eraserMode==='stroke'){
    /* Whole-stroke eraser: touch a stroke and it's gone. The test sweeps
       the segment from the previous sample to this one, so strokes crossed
       mid-drag are caught too. */
    let a=lastPt||pt, b=pt, hit=false;
    ['ink','hi'].forEach(layer=>{
      let before=p[layer].length;
      p[layer]=p[layer].filter(st=>!strokeTouchedByEraser(st,a,b));
      if(p[layer].length!==before) hit=true;
    });
    if(hit){ eraseChanged=true; bumpV(p); redrawLayer('ink'); redrawLayer('hi'); }
    /* No hit, no redraw: the old code re-drew both layers on every move
       even when the eraser touched nothing (~6ms a move on a full page).
       The ring lives on the overlay now, so it needs no layer redraw. */
    liveX.clearRect(0,0,CW,PH); drawEraserCursor(b);
    return;
  }
  let half=8+(+$('brushSize').value); /* halfEraserSize: half the side of the eraser square */
  let changed=false;
  ['ink','hi'].forEach(layer=>{
    let out=[], layerChanged=false;
    p[layer].forEach(st=>{
      let list = st.tool==='shape' ? shapeToPolylines(st) : [st];
      let anyHit=false, pieces=[];
      list.forEach(t=>{
        let box={cx:pt.x, cy:pt.y, half:half, halfPad:half+ERASE_PAD_COEFF*strokeWidthOf(t)};
        let res=eraseStrokeSplit(t,box);
        if(res===null) pieces.push(t);
        else { anyHit=true; res.forEach(r=>pieces.push(r)); }
      });
      if(!anyHit) out.push(st);
      else { layerChanged=true; pieces.forEach(pc=>out.push(pc)); }
    });
    if(layerChanged){ p[layer]=out; changed=true; }
  });
  if(changed){ eraseChanged=true; bumpV(p); redrawLayer('ink'); redrawLayer('hi'); }
}
function setTool(t,el){
  /* P4: switching to a different tool dismisses any open tool-options
     popover, it used to stay open and silently re-label itself for the
     new tool, so settings for one tool looked like another's. */
  /* Deselect fix: switching tools also drops the selection. A selection
     left over from the Select tool had no obvious way out, so the dashed
     box just stayed until the user tapped empty canvas. Tapping the
     already-active tool keeps the selection, like it keeps the tool. */
  if(S.tool!==t){ closeAllPopovers(); clearSelection(); }
  /* Gap 2: tapping the already-selected tool must NOT turn it off or
     switch to Hand, it stays selected until a different tool is picked. */
  S.tool=t; document.querySelectorAll('#mainToolbar .tool, #editorSheet .tool').forEach(b=>{ let on=b.dataset.tool===t; b.classList.toggle('active',on); b.setAttribute('aria-pressed',String(on)); });
  /* P2: the Shapes disclosure shows active while any shape tool is picked. */
  var sh=$('shapesBtn'); if(sh){ var isShape=['line','rect','ellipse','arrow','spline','compass'].indexOf(t)>=0; sh.classList.toggle('active',isShape); sh.setAttribute('aria-pressed',String(isShape)); }
  updateInkTouchAction(); updateSizeUI(); updateToolOptsUI(); updateStatusBar();
}
function setColor(c,el){ S.color=c;
  /* Colour-picker fix: the sheet swatches and the pill popover swatches
     stay in sync whichever place the colour was picked from. */
  document.querySelectorAll('#swatchBox .swatch, #colorPop .swatch').forEach(s=>s.classList.toggle('active', (s.getAttribute('data-c')||'').toLowerCase()===String(c).toLowerCase()));
  let cp=$('customColor'); if(cp && /^#[0-9a-f]{6}$/i.test(c)) cp.value=c;
  var dot=$('pillColorDot'); if(dot) dot.style.background=c;
  var pc=$('pillCustomColor'); if(pc && /^#[0-9a-f]{6}$/i.test(c)) pc.value=c;
  updateSizeUI(); }
/* P2: left rail tabs (Pages | Layers). */
function switchRailTab(tab){
  var pages=tab==='pages';
  var tp=$('railTabPages'), tl=$('railTabLayers'), rp=$('railPages'), rl=$('railLayers');
  if(tp) tp.setAttribute('aria-selected',String(pages));
  if(tl) tl.setAttribute('aria-selected',String(!pages));
  if(rp) rp.hidden=!pages;
  if(rl) rl.hidden=pages;
}
function toggleLayer(which,on){ (which==='ink'?inkC:hiC).style.display= on? 'block':'none'; updateStatusBar(); }
document.addEventListener('keydown',e=>{
  if(S.view!=='editor') return;
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z' && !e.shiftKey){ e.preventDefault(); undoStroke(); }
  if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase()==='y' || (e.key.toLowerCase()==='z'&&e.shiftKey))){ e.preventDefault(); redoStroke(); }
});


/* P2: on phones the Draw/Insert/Page/Notes&Audio controls live in the
   inspector's bottom-sheet tabs; on wider screens they live in the
   rails and under the canvas. The nodes themselves move -- same ids,
   same handlers -- so nothing is duplicated or re-bound. */
let edSheetMode=null;
function layoutEditorSheet(){
  /* Links panel state is applied on every layout pass (load + resize)
     so crossing the 1024px line can't leave it stale; the stored
     choice is read fresh each time, so a toggle survives resizes. */
  applyLinksPanel();
  var mobile=window.matchMedia('(max-width:768px)').matches;
  if(mobile===edSheetMode) return; edSheetMode=mobile;
  /* Guarded: a layout slip here must never abort the rest of app.js
     (a throw during load used to leave PR uninitialised and break
     every showView call on desktop widths). */
  try{
  var pp=$('pagesPanel'), rp=$('railPages'), rl=$('railLayers'),
      nb=document.querySelector('.noteBlock'), sr=document.querySelector('.studioRow'),
      tabPage=$('sheetTabPage'), tabDraw=$('sheetTabDraw'), tabNotes=$('sheetTabNotes'),
      stage=$('stageWrap'), th=$('tableHost');
  if(!pp||!rp||!rl||!nb||!sr||!tabPage||!tabDraw||!tabNotes||!stage||!th) return;
  if(mobile){
    tabPage.appendChild(rp);
    tabDraw.appendChild(rl);
    tabNotes.appendChild(nb);
    tabNotes.appendChild(sr);
    /* Each panel lives alone in its own sheet tab now, so both must be
       shown: the rail tab buttons that used to toggle them are inside
       #pagesPanel, which hides on mobile. */
    rp.hidden=false; rl.hidden=false;
    pp.classList.add('mobileMoved');
  }else{
    var d=$('editorSheet'); if(d) d.style.height='';
    var help=pp.querySelector('.helpBox');
    pp.appendChild(rp); pp.appendChild(rl); if(help) pp.appendChild(help);
    /* Restore the rail-tab state the buttons show (Pages by default). */
    switchRailTab(($('railTabLayers') && $('railTabLayers').getAttribute('aria-selected')==='true') ? 'layers' : 'pages');
    /* Pass 2 audit (mockup 17): on desktop the notes + audio live in
       the .notesAudioRow flex row (side by side) — put them back in
       the wrapper, not loose before the status bar. */
    var wrap=document.querySelector('.notesAudioRow');
    if(wrap){ wrap.appendChild(nb); wrap.appendChild(sr); }
    else { var anchor=$('editorStatus')||th; var parent=anchor.parentNode; parent.insertBefore(nb, anchor); parent.insertBefore(sr, anchor); }
    pp.classList.remove('mobileMoved');
  }
  }catch(err){ try{ console.warn('layoutEditorSheet', err); }catch(e){} }
}
/* P2: drag the inspector's grip to resize the bottom sheet (phones). */
(function(){
  var grip=$('editorSheetGrip'), d=$('editorSheet'); if(!grip||!d) return;
  var startY=0, startH=0, dragging=false;
  grip.addEventListener('pointerdown',e=>{
    if(!window.matchMedia('(max-width:768px)').matches || !d.open) return;
    dragging=true; startY=e.clientY; startH=d.getBoundingClientRect().height;
    try{ grip.setPointerCapture(e.pointerId); }catch(err){}
    e.preventDefault();
  });
  grip.addEventListener('pointermove',e=>{
    if(!dragging) return;
    var h=startH+(startY-e.clientY);
    var min=Math.round(innerHeight*0.45), max=Math.round(innerHeight*0.92);
    d.style.height=Math.max(min,Math.min(max,h))+'px';
  });
  function endDrag(){
    if(!dragging) return; dragging=false;
    var h=d.getBoundingClientRect().height;
    d.style.height=(h<innerHeight*0.7 ? Math.round(innerHeight*0.55) : Math.round(innerHeight*0.92))+'px';
  }
  grip.addEventListener('pointerup',endDrag);
  grip.addEventListener('pointercancel',()=>{ dragging=false; });
  grip.addEventListener('dblclick',()=>{
    if(!window.matchMedia('(max-width:768px)').matches || !d.open) return;
    var h=d.getBoundingClientRect().height;
    d.style.height=(h>innerHeight*0.7 ? Math.round(innerHeight*0.55) : Math.round(innerHeight*0.92))+'px';
  });
  d.addEventListener('close',()=>{ d.style.height=''; });
})();
window.addEventListener('resize',()=>{ clearTimeout(window.__edSheetT); window.__edSheetT=setTimeout(layoutEditorSheet,150); clearTimeout(zoomRescaleT); zoomRescaleT=setTimeout(rescaleCanvases,200); });
layoutEditorSheet();

/* ============ editor: pages ============ */
function loadPageIntoEditor(){
  let nb=curNb(); if(!nb) return;
  let p=nb.pages[nb.cur];
  decodeBgPdfImg(p); /* restored pages decode their PDF background on view, not at startup */
  $('templateSel').value=nb.template;
  $('noteText').value=p.text||'';
  if(!p.texts) p.texts=[]; if(!p.images) p.images=[]; if(!p.texs) p.texs=[]; if(!p.bgColor) p.bgColor='#fffdf6';
  let bgSel=$('pageBgSel'); if(bgSel) bgSel.value=p.bgColor; syncPageBgSwatches(p.bgColor);
  S.selection=[]; S.selRect=null; let sb=$('selBar'); if(sb) sb.classList.remove('open');
  redrawAll(); rescaleCanvases(); renderStickies(); renderTable(); renderPages(); refreshLinks(); updateWordCount(); updateAudioUI(); renderCanvasTexts(); renderCanvasImages(); renderTexLayer(); let btr=$('backToReadingBtn'); if(btr) btr.classList.toggle('hidden',!nb.pdfBookId);
  if(!$('floatingBoard').classList.contains('hidden')) loadBoard();
  /* Split View follows the notebook: refresh the pane only when the
     book it should show has changed, so page switches never reset
     the pane's scroll position. A PDF page that never drew (the editor
     was still hidden when it was first asked for) is retried in place
     instead — the host, not the whole pane, so the scroll stays put. */
  if(S.split){ let sb=splitBookFor(curNb()); let pane=$('splitPane'); if(pane){
    if(!sb) renderSplitPicker(pane);
    else if((sb.id)!==(pane.dataset.bookId||'')) renderSplitBook(pane,sb);
    else if(sb.kind==='pdf'){ let host=pane.querySelector('#splitPdfHost'); if(host&&!host.querySelector('canvas')&&!host.dataset.splitLoading) splitRenderPdfPage(pane,sb); }
  } }
  syncSplitPaneHeight();
}
function switchPage(i){
  let nb=curNb(); if(!nb) return;
  saveEditorToModel(); nb.cur=i; S.undoStack=[]; S.redoStack=[];
  loadPageIntoEditor();
  /* Tablet/phone flow: the thumbnails sit below the stage in the
     single-column layout, so after jumping to a page from them, bring
     the editor back into view — otherwise the new page loads above the
     fold and the tap looks like it did nothing. Scroll the TOOLBAR,
     not the canvas shell: the shell's top would land at the viewport
     top and the pill toolbar would slide up under the sticky editor
     top bar (its title input then eats taps meant for the pill — that
     is exactly how the Hand button went dead on tablets). block:
     'nearest' only scrolls when the toolbar is actually out of view
     (same pattern as toggleBoard), so chevron taps at the top of the
     page are untouched; scroll-margin-top on #mainToolbar clears the
     sticky bar. */
  if(window.matchMedia('(max-width:1024px)').matches){ var tb=$('mainToolbar'); if(tb) tb.scrollIntoView({block:'nearest'}); }
}
/* Page-navigation pill: step one page, clamping at the ends (the buttons
   are disabled there too, so this is a second guard, not the only one). */
function editorPageStep(d){
  let nb=curNb(); if(!nb) return;
  let i=nb.cur+d; if(i<0 || i>=nb.pages.length) return;
  switchPage(i);
}
/* Page-navigation pill label: jump to the thumbnails. On phones the
   thumbnails live in the inspector's Page tab (layoutEditorSheet moves
   #railPages there at <=768px); on tablets (769-1024px) they stay in
   #pagesPanel, which is stacked below the stage in the single-column
   layout — so reveal that panel instead of opening an inspector tab
   that has no thumbnails in it. */
function openPageNavList(){
  if(window.matchMedia('(max-width:768px)').matches){ openInspector('page'); return; }
  var pp=$('pagesPanel'); if(!pp) return;
  switchRailTab('pages');
  var cur=document.querySelector('#pageList .pageThumb.active');
  if(cur) cur.scrollIntoView({block:'nearest'});
  else pp.scrollIntoView({block:'nearest'});
}
function addPage(){ let nb=curNb(); if(!nb) return; saveEditorToModel(); nb.pages.push(blankPage()); nb.cur=nb.pages.length-1; S.undoStack=[]; S.redoStack=[]; loadPageIntoEditor(); toast('Page added'); }
function pageAction(i,act,ev){
  if(ev) ev.stopPropagation();
  let nb=curNb(); if(!nb) return;
  saveEditorToModel();
  if(act==='del'){ if(nb.pages.length===1){ toast('A notebook keeps at least one page'); return; }
    askConfirm('Delete page '+(i+1)+'?','Its ink, notes, stickies and board go with it.',()=>{ nb.pages.splice(i,1); if(nb.cur>=nb.pages.length) nb.cur=nb.pages.length-1; loadPageIntoEditor(); });
    return; }
  if(act==='dup'){ let copy=JSON.parse(JSON.stringify(nb.pages[i],(k,v)=>k==='img'?undefined:v)); copy.bgPdf=nb.pages[i].bgPdf; delete copy._thumb; delete copy._thumbV; copy._v=0; nb.pages.splice(i+1,0,copy); nb.cur=i+1; }
  if(act==='up' && i>0){ let t=nb.pages[i-1]; nb.pages[i-1]=nb.pages[i]; nb.pages[i]=t; nb.cur=i-1; }
  if(act==='down' && i<nb.pages.length-1){ let t=nb.pages[i+1]; nb.pages[i+1]=nb.pages[i]; nb.pages[i]=t; nb.cur=i+1; }
  loadPageIntoEditor();
}
/* Page-list thumbnails are LAZY. renderPages used to compose a full-resolution
   (1200x1697, ~8 MB) canvas for EVERY page and keep it in p._thumb — for a
   2000-page annotation notebook that retained ~16 GB and the tab was
   OOM-killed when opening Annotate on a long PDF. Now each thumb is composed
   transiently (drawn, then dropped), only for pages near the current one or
   scrolled into view, and the thumb canvases are 150x100 (they display at
   ~110px wide on phones). */
let pageThumbIO=null;
function drawPageThumb(i){
  let nb=curNb(); if(!nb) return;
  let p=nb.pages[i]; if(!p) return;
  let th=document.querySelector('canvas[data-thumb="'+i+'"]'); if(!th) return;
  let v=(p._v===undefined?-1:p._v); /* fresh pages have no _v; store -1 so "drawn" is recordable */
  if(th._drawnV!==undefined && th._drawnV===v) return;
  let comp=composePage(p, nb.template); /* transient: drawn, then GC'd */
  let x=th.getContext('2d'); x.clearRect(0,0,150,100); x.fillStyle='#fff'; x.fillRect(0,0,150,100);
  let iw=comp.width, ih=comp.height, ts=Math.min(150/iw,100/ih);
  x.drawImage(comp,(150-iw*ts)/2,(100-ih*ts)/2,iw*ts,ih*ts);
  th._drawnV=v;
}
function renderPages(){
  let nb=curNb(); if(!nb) return;
  /* The row list only shows each page's number, its PDF page and a board
     marker, so it only needs rebuilding when that changes (pages added,
     removed, duplicated or reordered). A plain page switch used to
     rebuild all 3,000 rows (12,000 icon calls) on every switch — ~800ms
     on a long annotation notebook. When the rows are unchanged, just
     move the active marker and draw the thumbs near the current page. */
  let rowSig=nb.pages.map(p=>((p.bgPdf&&p.bgPdf.page)||0)+':'+((p.board&&p.board.strokes&&p.board.strokes.length)?1:0)).join(',');
  if(nb._pagesRowSig===rowSig && $('pageList').children.length===nb.pages.length){
    document.querySelectorAll('#pageList .pageThumb').forEach((el,i)=>el.classList.toggle('active',i===nb.cur));
    setStat('statEditorPages','statEditorPagesLabel',nb.pages.length,'Page','Pages'); updateStatusBar();
    for(let i=Math.max(0,nb.cur-12); i<=Math.min(nb.pages.length-1,nb.cur+12); i++) drawPageThumb(i);
    scheduleSave(); return;
  }
  nb._pagesRowSig=rowSig;
  $('pageList').innerHTML=nb.pages.map((p,i)=>{
    return '<div class="pageThumb '+(i===nb.cur?'active':'')+'" onclick="switchPage('+i+')"><canvas width="150" height="100" data-thumb="'+i+'"></canvas>'
    +'<div class="ptRow"><span class="kbd">Page '+(i+1)+(p.board&&p.board.strokes.length?' · board':'')+(p.bgPdf?' · PDF p.'+p.bgPdf.page:'')+'</span><span class="ptBtns">'
    +'<button class="miniBtn" title="Move up" aria-label="Move page up" onclick="pageAction('+i+',\'up\',event)">'+icon('arrow-up')+'</button>'
    +'<button class="miniBtn" title="Move down" aria-label="Move page down" onclick="pageAction('+i+',\'down\',event)">'+icon('arrow-down')+'</button>'
    +'<button class="miniBtn" title="Duplicate" aria-label="Duplicate page" onclick="pageAction('+i+',\'dup\',event)">'+icon('copy')+'</button>'
    +'<button class="miniBtn" title="Delete page" aria-label="Delete page" onclick="pageAction('+i+',\'del\',event)">'+icon('trash')+'</button></span></div></div>';
  }).join('');
  setStat('statEditorPages','statEditorPagesLabel',nb.pages.length,'Page','Pages'); updateStatusBar();
  /* draw the pages around the current one now; the rest draw when scrolled into view */
  for(let i=Math.max(0,nb.cur-12); i<=Math.min(nb.pages.length-1,nb.cur+12); i++) drawPageThumb(i);
  if(pageThumbIO) pageThumbIO.disconnect();
  pageThumbIO=new IntersectionObserver(es=>{ es.forEach(en=>{ if(en.isIntersecting){ let i=+en.target.dataset.thumb; drawPageThumb(i); let pg=curNb()&&curNb().pages[i]; /* keep watching until the page's PDF background has landed, so a thumbnail first drawn blank (before its decode) is redrawn with the preview when the user scrolls to it */ if(!pg||!pg.bgPdf||pg.bgPdf.img) pageThumbIO.unobserve(en.target); } }); },{rootMargin:'300px'});
  document.querySelectorAll('#pageList canvas[data-thumb]').forEach(c=>pageThumbIO.observe(c));
  scheduleSave();
}

/* ============ floating board: true infinite canvas ============ */
let boardTool='pen', bDrawing=false, bStroke=null, bLast=null, boardPointers={}, pinchStart=null;
let boardFull=false, boardRestoreGeom=null, boardSizeQueued=false;
const BOARD_MIN_W=260, BOARD_MIN_H=210;
const boardC=$('boardCanvas'), bX=boardC.getContext('2d'); bX.lineCap='round'; bX.lineJoin='round';
function pageBoard(){ let p=curPageObj(); if(!p) return null; if(!p.board) p.board=blankBoard(); return p.board; }
function toggleBoard(force){
  let b=$('floatingBoard'); let show= typeof force==='boolean'? force : b.classList.contains('hidden');
  if(show){ closeAllToolPops(); closeExportPop(); var t=$('toast'); if(t) t.style.display='none'; }
  if(!show && boardFull){ boardFull=false; boardRestoreGeom=null; b.classList.remove('boardFull'); setBtnContent('boardFsBtn','arrows-maximize','Expand'); }
  b.classList.toggle('hidden',!show);
  var bb=$('boardBtn'); if(bb) bb.setAttribute('aria-pressed', show?'true':'false');
  if(show){ loadBoard(); requestAnimationFrame(()=>{ sizeBoardCanvas(); var sh=$('canvasShell'); if(sh) sh.scrollIntoView({block:'nearest'}); }); }
  syncBoardMini();
}
function loadBoard(){
  let bd=pageBoard(); if(!bd) return;
  if(boardFull){ boardFull=false; boardRestoreGeom=null; $('floatingBoard').classList.remove('boardFull'); setBtnContent('boardFsBtn','arrows-maximize','Expand'); }
  $('floatingBoard').style.background=BOARD_COLORS[bd.color];
  if(bd.color===6){ $('floatingBoard').style.color='#f8fafc'; } else { $('floatingBoard').style.color='#1b2a4a'; }
  let sw=$('boardColorSwatch'); if(sw) sw.style.background=BOARD_COLORS[bd.color];
  applyBoardGeom(bd.geom||defaultBoardGeom());
  sizeBoardCanvas(); redrawBoard(); syncBoardMini();
}
/* --- board window geometry: position + size, remembered per page ---
   The canvas inside stays infinite; only this window frame changes.
   Every move/resize starts from a snapshot of the current geometry and
   writes clamped values back, so the board never jumps or drifts, and
   the far edge stays pinned when dragging the top or left edge. */
function boardGeomFromEl(){ let el=$('floatingBoard'); return {x:el.offsetLeft, y:el.offsetTop, w:el.offsetWidth, h:el.offsetHeight}; }
function boardParentSize(){ let el=$('floatingBoard'); let op=el.offsetParent; return {w: op? op.clientWidth : window.innerWidth, h: op? op.clientHeight : window.innerHeight}; }
function clampBoardSize(g){ let ps=boardParentSize(); let maxW=Math.max(BOARD_MIN_W, Math.min(ps.w, window.innerWidth)-4); let maxH=Math.max(BOARD_MIN_H, Math.min(ps.h, window.innerHeight)-4); g.w=Math.round(Math.max(BOARD_MIN_W, Math.min(maxW, g.w))); g.h=Math.round(Math.max(BOARD_MIN_H, Math.min(maxH, g.h))); return g; }
function clampBoardPos(g){ let ps=boardParentSize(); g.x=Math.round(Math.max(0, Math.min(Math.max(0, ps.w-56), g.x))); g.y=Math.round(Math.max(0, Math.min(Math.max(0, ps.h-44), g.y))); return g; }
function applyBoardGeom(g){ let el=$('floatingBoard'); if(!g || el.classList.contains('hidden')) return; let c=clampBoardPos(clampBoardSize({x:+g.x||0, y:+g.y||0, w:+g.w||360, h:+g.h||316})); el.style.left=c.x+'px'; el.style.top=c.y+'px'; el.style.right='auto'; el.style.bottom='auto'; el.style.width=c.w+'px'; el.style.height=c.h+'px'; }
function defaultBoardGeom(){ let ps=boardParentSize(); return {x:8, y:8, w:Math.max(BOARD_MIN_W, ps.w-16), h:316}; }
function saveBoardGeom(){ let bd=pageBoard(); if(!bd || boardFull) return; bd.geom=boardGeomFromEl(); }
function queueBoardSize(){ if(boardSizeQueued) return; boardSizeQueued=true; requestAnimationFrame(()=>{ boardSizeQueued=false; sizeBoardCanvas(); }); }
function toggleBoardFullscreen(){
  let el=$('floatingBoard'); if(el.classList.contains('hidden')) return;
  if(boardFull){ exitBoardFullscreen(false); return; }
  boardRestoreGeom=boardGeomFromEl();
  boardFull=true; el.classList.add('boardFull');
  setBtnContent('boardFsBtn','arrows-minimize','Restore');
  sizeBoardCanvas(); syncBoardMini();
}
function exitBoardFullscreen(silent){
  let el=$('floatingBoard'); boardFull=false; el.classList.remove('boardFull');
  let bd=pageBoard(); let g=boardRestoreGeom||(bd&&bd.geom)||defaultBoardGeom(); boardRestoreGeom=null;
  applyBoardGeom(g);
  if(bd) bd.geom=boardGeomFromEl();
  setBtnContent('boardFsBtn','arrows-maximize','Expand');
  sizeBoardCanvas(); syncBoardMini();
  if(!silent) scheduleSave();
}
function sizeBoardCanvas(){
  let w=boardC.clientWidth||340, h=boardC.clientHeight||230, dpr=Math.min(window.devicePixelRatio||1,2);
  boardC.width=Math.round(w*dpr); boardC.height=Math.round(h*dpr); redrawBoard();
}
function redrawBoard(){
  let bd=pageBoard(); if(!bd) return;
  let v=bd.view;
  bX.setTransform(1,0,0,1,0,0); bX.clearRect(0,0,boardC.width,boardC.height);
  bX.setTransform(v.k,0,0,v.k, v.x, v.y);
  bd.strokes.forEach(st=>{
    bX.strokeStyle=st.color; bX.lineWidth=st.size; bX.beginPath();
    bX.moveTo(st.points[0].x,st.points[0].y);
    for(let i=1;i<st.points.length;i++) bX.lineTo(st.points[i].x,st.points[i].y);
    bX.stroke();
  });
  bX.setTransform(1,0,0,1,0,0);
  updateBoardZoomLabel(); updateBoardMini();
}
function boardWorld(e){ let r=boardC.getBoundingClientRect(); let bd=pageBoard(); let sx=(e.clientX-r.left)*(boardC.width/r.width), sy=(e.clientY-r.top)*(boardC.height/r.height); return { x:(sx-bd.view.x)/bd.view.k, y:(sy-bd.view.y)/bd.view.k, sx, sy }; }
function setBoardTool(t){ boardTool=t; $('boardPenBtn').classList.toggle('primary',t==='pen'); $('boardPanBtn').classList.toggle('primary',t==='pan'); boardC.style.cursor= t==='pan'?'grab':'crosshair'; }
/* Board strokes use the same ink colour selected in the toolbar as
   strokes on the page itself. The one exception: on the dark Slate
   board the untouched default navy would be invisible, so the light
   default stays there until the user actually picks a colour. */
function boardInkColor(bd){ let c=S.color||'#1b2a4a'; if(bd && bd.color===6 && String(c).toLowerCase()==='#1b2a4a') return '#f8fafc'; return c; }
boardC.addEventListener('pointerdown',e=>{
  boardC.setPointerCapture(e.pointerId); boardPointers[e.pointerId]={x:e.clientX,y:e.clientY};
  if(Object.keys(boardPointers).length===2){ let ps=Object.values(boardPointers); pinchStart={d:Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y), k:pageBoard().view.k}; bDrawing=false; bStroke=null; return; }
  let w=boardWorld(e);
  if(boardTool==='pan'){ bLast={x:e.clientX,y:e.clientY}; bDrawing=true; return; }
  bDrawing=true; let bd=pageBoard();
  bStroke={color: boardInkColor(bd), size:3/bd.view.k*1.6, points:[{x:w.x,y:w.y}]};
  bLast=w;
});
boardC.addEventListener('pointermove',e=>{
  if(boardPointers[e.pointerId]) boardPointers[e.pointerId]={x:e.clientX,y:e.clientY};
  let bd=pageBoard(); if(!bd) return;
  if(pinchStart && Object.keys(boardPointers).length===2){
    let ps=Object.values(boardPointers); let d=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    bd.view.k=Math.max(0.2,Math.min(6, pinchStart.k*(d/Math.max(20,pinchStart.d)))); redrawBoard(); return;
  }
  if(!bDrawing) return;
  if(boardTool==='pan' && bLast){ let r=boardC.getBoundingClientRect(); bd.view.x+=(e.clientX-bLast.x)*(boardC.width/r.width); bd.view.y+=(e.clientY-bLast.y)*(boardC.height/r.height); bLast={x:e.clientX,y:e.clientY}; redrawBoard(); return; }
  let w=boardWorld(e); if(bStroke){ let a=bLast; bStroke.points.push({x:w.x,y:w.y}); bd.strokes=bd.strokes.filter(s=>s!==bStroke); bd.strokes.push(bStroke);
    /* Draw just the new segment, not the whole board: redrawBoard() re-drew
       every board stroke per move, the same lag as the editor had. */
    let v=bd.view; bX.setTransform(v.k,0,0,v.k,v.x,v.y); bX.strokeStyle=bStroke.color; bX.lineWidth=bStroke.size; bX.lineCap='round'; bX.lineJoin='round'; bX.beginPath(); bX.moveTo(a.x,a.y); bX.lineTo(w.x,w.y); bX.stroke(); bX.setTransform(1,0,0,1,0,0);
    bLast=w; }
});
function boardEnd(e){ delete boardPointers[e.pointerId]; if(Object.keys(boardPointers).length<2) pinchStart=null; if(bDrawing && bStroke){ renderPages(); updateBoardMini(); } bDrawing=false; bStroke=null; bLast=null; }
boardC.addEventListener('pointerup',boardEnd); boardC.addEventListener('pointercancel',boardEnd);
boardC.addEventListener('wheel',e=>{ e.preventDefault(); let bd=pageBoard(); let f=e.deltaY<0?1.12:0.89; bd.view.k=Math.max(0.2,Math.min(6,bd.view.k*f)); redrawBoard(); },{passive:false});
function updateBoardZoomLabel(){ let bd=pageBoard(); let l=$('boardZoomLabel'); if(l&&bd) l.textContent=Math.round(bd.view.k*100)+'%'; }
function boardZoomReset(){ let bd=pageBoard(); if(!bd) return; bd.view.k=1; redrawBoard(); }
function boardZoom(f){ let bd=pageBoard(); bd.view.k=Math.max(0.2,Math.min(6,bd.view.k*f)); redrawBoard(); }
function boardClear(){ let bd=pageBoard(); askConfirm('Clear this board?','The board on this page is emptied; the page itself is untouched.',()=>{ bd.strokes=[]; redrawBoard(); renderPages(); }); }
function cycleBoardColor(){ let bd=pageBoard(); bd.color=(bd.color+1)%BOARD_COLORS.length; loadBoard(); scheduleSave(); toast('Board colour saved for this page'); }
/* P3: board mini-map (mockup 6) — a live thumbnail of the board, bottom
   right of the screen, headed Board with the board's own Expand / Close
   actions. The thumbnail re-renders from the same stroke data as the
   board, scaled to fit; it shows only while the board is open, not
   fullscreen, at >=768px. Expand opens the board fullscreen; Close
   closes the board — both reuse the existing handlers. */
function updateBoardMini(){
  let cv=$('boardMiniCanvas'); if(!cv) return;
  let bd=pageBoard(); if(!bd) return;
  let ctx=cv.getContext('2d'); if(!ctx) return;
  ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,any=false;
  bd.strokes.forEach(st=>{ st.points.forEach(p=>{ any=true; if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }); });
  if(!any) return;
  let w=Math.max(1,maxX-minX), h=Math.max(1,maxY-minY);
  let k=Math.min((cv.width-16)/w,(cv.height-16)/h);
  let ox=(cv.width-w*k)/2-minX*k, oy=(cv.height-h*k)/2-minY*k;
  bd.strokes.forEach(st=>{
    if(!st.points.length) return;
    ctx.strokeStyle=st.color; ctx.lineWidth=Math.max(1,st.size*k); ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(st.points[0].x*k+ox,st.points[0].y*k+oy);
    for(let i=1;i<st.points.length;i++) ctx.lineTo(st.points[i].x*k+ox,st.points[i].y*k+oy);
    ctx.stroke();
  });
}
function syncBoardMini(){
  let m=$('boardMini'); if(!m) return;
  let b=$('floatingBoard');
  let show=b && !b.classList.contains('hidden') && !boardFull && window.matchMedia('(min-width:768px)').matches;
  m.classList.toggle('hidden',!show);
  if(show) updateBoardMini();
}
window.addEventListener('resize',()=>{ clearTimeout(window.__boardMiniT); window.__boardMiniT=setTimeout(syncBoardMini,150); });
/* drag + resize board, built for steady controls:
   - the head captures the pointer, so a drag tracks one finger/mouse
     exactly and never drifts or gets lost mid-move;
   - taps on the head's buttons never start a drag;
   - every edge and corner resizes from a snapshot of the starting
     geometry, with the opposite edge pinned, no jumping, no shift;
   - handles are children of the board frame, so they stay glued to
     their edge/corner while the board moves or resizes. */
let dragB=null, resizeB=null;
const boardHeadEl=$('boardHead');
boardHeadEl.addEventListener('pointerdown',e=>{
  if(boardFull) return;
  if(e.target.closest('button')) return;
  dragB={x0:e.clientX, y0:e.clientY, g0:boardGeomFromEl()};
  try{ boardHeadEl.setPointerCapture(e.pointerId); }catch(err){}
});
boardHeadEl.addEventListener('pointermove',e=>{
  if(!dragB) return;
  let g=clampBoardPos({x:dragB.g0.x+(e.clientX-dragB.x0), y:dragB.g0.y+(e.clientY-dragB.y0), w:dragB.g0.w, h:dragB.g0.h});
  let el=$('floatingBoard'); el.style.left=g.x+'px'; el.style.top=g.y+'px'; el.style.right='auto'; el.style.bottom='auto';
});
function boardDragEnd(){ if(!dragB) return; dragB=null; saveBoardGeom(); scheduleSave(); }
boardHeadEl.addEventListener('pointerup',boardDragEnd);
boardHeadEl.addEventListener('pointercancel',boardDragEnd);
document.querySelectorAll('#floatingBoard [data-bdir]').forEach(h=>{
  h.addEventListener('pointerdown',e=>{
    if(boardFull) return;
    e.preventDefault(); e.stopPropagation();
    let g0=boardGeomFromEl();
    resizeB={dir:h.getAttribute('data-bdir'), x0:e.clientX, y0:e.clientY, g0:g0, right:g0.x+g0.w, bottom:g0.y+g0.h, el:h};
    try{ h.setPointerCapture(e.pointerId); }catch(err){}
  });
  h.addEventListener('pointermove',e=>{
    if(!resizeB || resizeB.el!==h) return;
    let dx=e.clientX-resizeB.x0, dy=e.clientY-resizeB.y0, d=resizeB.dir;
    let g={x:resizeB.g0.x, y:resizeB.g0.y, w:resizeB.g0.w, h:resizeB.g0.h};
    if(d.indexOf('e')>=0) g.w=resizeB.g0.w+dx;
    if(d.indexOf('s')>=0) g.h=resizeB.g0.h+dy;
    if(d.indexOf('w')>=0) g.w=resizeB.g0.w-dx;
    if(d.indexOf('n')>=0) g.h=resizeB.g0.h-dy;
    clampBoardSize(g);
    if(d.indexOf('w')>=0) g.x=resizeB.right-g.w;
    if(d.indexOf('n')>=0) g.y=resizeB.bottom-g.h;
    clampBoardPos(g);
    let el=$('floatingBoard'); el.style.left=g.x+'px'; el.style.top=g.y+'px'; el.style.right='auto'; el.style.bottom='auto'; el.style.width=g.w+'px'; el.style.height=g.h+'px';
    queueBoardSize();
  });
  function resizeEnd(){ if(!resizeB || resizeB.el!==h) return; resizeB=null; saveBoardGeom(); scheduleSave(); sizeBoardCanvas(); }
  h.addEventListener('pointerup',resizeEnd);
  h.addEventListener('pointercancel',resizeEnd);
});

/* ============ stickies & tables ============ */
const STICKY_COLORS=['#fef08a','#fda4af','#93c5fd','#86efac','#f3e8c8'];
function renderStickies(){
  let p=curPageObj(); let host=$('stickyLayer'); host.innerHTML=''; if(!p) return;
  p.stickies.forEach(st=>{
    let d=document.createElement('div'); d.className='sticky'; d.style.left=st.x+'%'; d.style.top=st.y+'%'; d.style.background=st.color;
    d.innerHTML='<div class="stickyHead"><span>Sticky</span><span><button title="Change colour" aria-label="Change sticky colour">'+icon('palette')+'</button><button title="Delete sticky" aria-label="Delete sticky">'+icon('x')+'</button></span></div><textarea placeholder="Type a note...">'+esc(st.text)+'</textarea>';
    let [colorBtn,delBtn]=d.querySelectorAll('.stickyHead button');
    let ta=d.querySelector('textarea');
    ta.addEventListener('input',()=>{ st.text=ta.value; scheduleSave(); });
    ta.addEventListener('pointerdown',e=>e.stopPropagation());
    colorBtn.onclick=()=>{ let i=STICKY_COLORS.indexOf(st.color); st.color=STICKY_COLORS[(i+1)%STICKY_COLORS.length]; d.style.background=st.color; scheduleSave(); };
    delBtn.onclick=()=>{ p.stickies=p.stickies.filter(s=>s!==st); renderStickies(); scheduleSave(); };
    d.querySelector('.stickyHead').addEventListener('pointerdown',e=>{
      if(e.target.tagName==='BUTTON') return;
      let shell=$('canvasShell').getBoundingClientRect(); let sx=e.clientX, sy=e.clientY, ox=st.x, oy=st.y;
      function mv(ev){ st.x=Math.max(0,Math.min(82, ox+(ev.clientX-sx)/shell.width*100)); st.y=Math.max(0,Math.min(80, oy+(ev.clientY-sy)/shell.height*100)); d.style.left=st.x+'%'; d.style.top=st.y+'%'; }
      function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); }
      window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
    });
    host.appendChild(d);
  });
}
function addSticky(){ let p=curPageObj(); if(!p) return; p.stickies.push({x:62,y:58,text:'',color:STICKY_COLORS[0]}); renderStickies(); toast('Sticky added. Drag it by its top bar.'); }
function renderTable(){
  let p=curPageObj(); let host=$('tableHost'); if(!p||!p.table){ host.innerHTML=''; return; }
  let rows=p.table.rows;
  let html='<div class="panel" style="margin-top:12px"><h4>Table</h4><table class="inkTable">';
  rows.forEach((r,ri)=>{ html+='<tr>'+r.map((c,ci)=>'<td contenteditable="true" data-r="'+ri+'" data-c="'+ci+'">'+esc(c)+'</td>').join('')+'</tr>'; });
  html+='</table><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn small" onclick="tableAddRow()">'+icon('plus','ic-sm')+' Row</button><button class="btn small" onclick="tableAddCol()">'+icon('plus','ic-sm')+' Column</button><button class="btn small danger" onclick="tableDelete()">Delete table</button></div></div>';
  host.innerHTML=html;
  host.querySelectorAll('td').forEach(td=>td.addEventListener('input',()=>{ p.table.rows[+td.dataset.r][+td.dataset.c]=td.textContent; scheduleSave(); }));
}
function insertTable(){ let p=curPageObj(); if(!p) return; if(p.table){ toast('This page already has a table'); return; } p.table={rows:[['Item','Notes'],['',''],['','']]}; renderTable(); toast('Table inserted. Tap cells to edit.'); }
function tableAddRow(){ let p=curPageObj(); p.table.rows.push(p.table.rows[0].map(()=>'') ); renderTable(); }
function tableAddCol(){ let p=curPageObj(); p.table.rows.forEach(r=>r.push('')); renderTable(); }
function tableDelete(){ let p=curPageObj(); askConfirm('Delete this table?','',()=>{ p.table=null; renderTable(); }); }

/* ============ audio-synced notes (real mic recording) ============ */
let mediaRec=null, recChunks=[], syncAudio=null, syncRaf=null;
async function toggleRecord(){
  let p=curPageObj(); if(!p) return;
  if(S.recording){
    mediaRec && mediaRec.stop(); return;
  }
  if(!navigator.mediaDevices || !window.MediaRecorder){ toast('Recording is not supported in this browser'); return; }
  try{
    let stream=await navigator.mediaDevices.getUserMedia({audio:true});
    recChunks=[]; mediaRec=new MediaRecorder(stream);
    mediaRec.ondataavailable=e=>{ if(e.data.size) recChunks.push(e.data); };
    mediaRec.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      let blob=new Blob(recChunks,{type:mediaRec.mimeType||'audio/webm'});
      p.audio={url:URL.createObjectURL(blob), dur:(Date.now()-S.recStart)/1000, blob:blob};
      S.recording=false; setBtnContent('recBtn','microphone','Record');
      $('recStatus').textContent='Saved. '+Math.round(p.audio.dur)+' seconds of audio synced to the ink you drew while recording.';
      updateAudioUI(); scheduleSave(); toast('Audio note saved with this page');
    };
    S.recStart=Date.now(); mediaRec.start(); S.recording=true;
    setBtnContent('recBtn','player-stop','Stop');
    $('recStatus').textContent='Recording. Strokes you draw now are timestamped to the audio.';
  }catch(err){ toast('Microphone unavailable. Permission is needed to record.'); }
}
function updateAudioUI(){ let p=curPageObj(); $('playSyncBtn').classList.toggle('hidden', !(p&&p.audio)); }
function playSyncedAudio(){
  let p=curPageObj(); if(!p||!p.audio) return;
  if(syncAudio){ syncAudio.pause(); syncAudio=null; cancelAnimationFrame(syncRaf); redrawLayer.cutoff=null; redrawLayer('ink'); setBtnContent('playSyncBtn','player-play','Play with ink sync'); return; }
  syncAudio=new Audio(p.audio.url);
  let tick=()=>{ if(!syncAudio) return; redrawLayer.cutoff=syncAudio.currentTime*1000; redrawLayer('ink'); if(!syncAudio.ended && !syncAudio.paused) syncRaf=requestAnimationFrame(tick); };
  syncAudio.onplay=()=>{ setBtnContent('playSyncBtn','player-stop','Stop sync playback'); tick(); };
  syncAudio.onended=()=>{ redrawLayer.cutoff=null; redrawLayer('ink'); syncAudio=null; setBtnContent('playSyncBtn','player-play','Play with ink sync'); };
  syncAudio.play();
}

/* ============ links & backlinks, split view ============ */
function refreshLinks(){
  let nb=curNb(); let host=$('linksList'); if(!nb||!host) return;
  let text=$('noteText')? $('noteText').value : '';
  let out=[...new Set([...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>m[1]))];
  let back=S.items.filter(i=>i.kind==='notebook' && !i.pdfBookId && i.id!==nb.id && i.pages.some(p=>p.text.includes('[['+nb.title+']]'))).map(i=>i.title);
  let html='';
  if(out.length) html+=out.map(l=>'<div class="listRow"><a href="#" onclick="openLink(\''+esc(l).replace(/'/g,"\\'")+'\');return false">[[ '+esc(l)+' ]]</a><span class="kbd">link</span></div>').join('');
  if(back.length) html+='<h4 style="margin-top:12px">Backlinks</h4>'+back.map(t=>'<div class="listRow"><span>'+esc(t)+'</span><span class="kbd">links here</span></div>').join('');
  host.innerHTML= html || '<p class="kbd">No links yet.</p>';
}
function openLink(title){
  let nb=S.items.find(i=>i.kind==='notebook' && !i.pdfBookId && i.title.toLowerCase()===title.toLowerCase());
  if(nb){ openNotebook(nb.id); return; }
  let created=createNotebookSilent(title,'#1e3a5f','lined');
  toast('Created linked notebook “'+title+'”');
}
function updateWordCount(){ let v=$('noteText').value; $('wordCount').textContent=(v.trim()? v.trim().split(/\s+/).length:0)+' words'; refreshLinks(); }
$('noteText').addEventListener('input',()=>{ saveEditorToModel(); updateWordCount(); });
function toggleSplit(){
  S.split=!S.split;
  document.body.classList.toggle('splitOn',S.split);
  if(!S.split) closeRailPanel();
  var stb=$('splitTopBtn'); if(stb) stb.setAttribute('aria-pressed', S.split?'true':'false');
  $('stageWrap').classList.toggle('split',S.split);
  let pane=$('splitPane'); pane.classList.toggle('hidden',!S.split);
  /* P3: Split View halves the page shell, re-clamp the floating
     board's window to the new width so its Colour / Expand / Close
     controls are never pushed past the shell's right edge. */
  let fb=$('floatingBoard');
  if(fb && !fb.classList.contains('hidden') && !boardFull){ applyBoardGeom(boardGeomFromEl()); queueBoardSize(); }
  if(S.split){
    let b=splitBookFor(curNb());
    if(b) renderSplitBook(pane,b);
    else renderSplitPicker(pane);
    syncSplitPaneHeight();
  } else {
    pane.style.height='';
  }
}
/* P3: Split View icon rail (mockup 13) — desktop only. When split is on,
   both sidebars collapse into a 48px rail; each rail button opens its
   panel as an overlay drawer while split stays on. The drawer reuses the
   real panel DOM (same ids, same handlers) — nothing is duplicated. */
let railOpen=null; /* 'pages' | 'layers' | 'links' | null */
function railPanelEl(which){ return which==='links'? $('linksPanel') : $('pagesPanel'); }
function openRailPanel(which){
  if(which!=='pages'&&which!=='layers'&&which!=='links') return;
  let el=railPanelEl(which); if(!el) return;
  if(which==='pages'||which==='layers') switchRailTab(which);
  ['pagesPanel','linksPanel'].forEach(id=>{ let p=$(id); if(p&&p!==el) p.classList.remove('railDrawer'); });
  el.classList.add('railDrawer');
  railOpen=which;
  ['pages','layers','links'].forEach(w=>{ let b=$('railBtn'+w[0].toUpperCase()+w.slice(1)); if(b) b.setAttribute('aria-pressed', w===which?'true':'false'); });
  let bd=$('railBackdrop'); if(bd) bd.classList.remove('hidden');
}
function closeRailPanel(){
  ['pagesPanel','linksPanel'].forEach(id=>{ let p=$(id); if(p) p.classList.remove('railDrawer'); });
  railOpen=null;
  ['pages','layers','links'].forEach(w=>{ let b=$('railBtn'+w[0].toUpperCase()+w.slice(1)); if(b) b.setAttribute('aria-pressed','false'); });
  let bd=$('railBackdrop'); if(bd) bd.classList.add('hidden');
}
function toggleRailPanel(which){ if(railOpen===which) closeRailPanel(); else openRailPanel(which); }
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&railOpen) closeRailPanel(); });
/* Split View book picker: the pane shows the notebook's picked book
   (persisted per notebook as splitBookId, like parallelWith on books),
   else the book open in the reader, else a chooser of the real books.
   Nothing is invented: an empty library keeps "Nothing to read yet". */
function splitBookFor(nb){
  let b=nb && nb.splitBookId ? S.items.find(i=>i.id===nb.splitBookId && (i.kind==='epub'||i.kind==='pdf')) : null;
  if(b) return b;
  let c=curBook();
  return (c && (c.kind==='epub'||c.kind==='pdf')) ? c : null;
}
/* Split View alignment: the pane is a column — the book fills the body
   and the book/page controls sit in a footer UNDER it, so the page
   starts at the pane's top edge, level with the notebook page, instead
   of being pushed down by a header above it. (A header cannot live in
   the 76px band above the pane: the pill floats centred over the stage
   and covers that band at phone width.) The pane's height is synced to
   the notebook page (the shell) in JS, so both windows share a top edge
   and a height at every width. */
function renderSplitBook(pane,b){
  pane.dataset.bookId=b.id;
  syncSplitPaneHeight(); /* body height must be right before the page is fitted to it */
  let head='<div class="splitHead"><span class="badge">'+esc(b.title)+'</span><button type="button" class="btn small" onclick="splitShowPicker()">Change</button><span class="splitZoomGroup"><button type="button" class="btn small" onclick="splitPdfZoomBy(0.8)" aria-label="Zoom out">−</button><button type="button" class="btn small" id="splitZoomLabel" onclick="splitPdfZoomBy(0)" aria-label="Reset zoom" title="Tap to reset zoom">100%</button><button type="button" class="btn small" onclick="splitPdfZoomBy(1.25)" aria-label="Zoom in">+</button></span></div>';
  if(b.kind==='epub'){ let c=(b.chapters||[])[b.ch]||{title:'',html:''}; let n=(b.chapters||[]).length; let nav=n>1?'<div class="splitEpubNav"><button type="button" class="btn small" onclick="splitEpubChapter(-1)" aria-label="Previous chapter"'+(b.ch<=0?' disabled':'')+'>\u2039</button><span class="kbd" id="splitEpubLabel">'+esc(c.title||('Chapter '+(b.ch+1)+' of '+n))+'</span><button type="button" class="btn small" onclick="splitEpubChapter(1)" aria-label="Next chapter"'+(b.ch>=n-1?' disabled':'')+'>\u203a</button></div>':''; pane.innerHTML='<div class="splitPaneBody"><h3>'+esc(c.title)+'</h3>'+c.html+'</div><div class="splitPaneFoot">'+head+nav+'</div>'; }
  else if(b.kind==='pdf'){
    pane.innerHTML='<div class="splitPaneBody"><div class="splitPdfHost" id="splitPdfHost"><p class="kbd">Loading page…</p></div></div><div class="splitPaneFoot">'+head+'<div class="splitPdfNav"><button type="button" class="btn small" onclick="splitPdfPage(-1)" aria-label="Previous page">‹</button><span class="kbd" id="splitPdfLabel">…</span><button type="button" class="btn small" onclick="splitPdfPage(1)" aria-label="Next page">›</button></div></div>';
    splitRenderPdfPage(pane,b);
  }
  else pane.innerHTML='<div class="splitPaneBody"><h3>Nothing to read yet</h3><p>Open or import a book and it will appear here beside your notebook.</p></div>';
  syncSplitPaneHeight();
}
/* The pane is exactly as tall as the notebook page (the shell), so the
   two windows share a top edge and a height. The shell's height follows
   the page aspect and the zoom, so it is measured and copied whenever
   the page, zoom or viewport changes. */
function syncSplitPaneHeight(){
  if(!S.split) return;
  let shell=$('canvasShell'), pane=$('splitPane');
  if(!shell||!pane) return;
  /* The pane matches the notebook shell's full height, in every
     orientation — the two windows stay parallel and the PDF page fills
     its half. Capping the pane at the scroller's visible height (an
     earlier version of this) made the pane 300px against a 560px shell
     in phone landscape: the windows were visibly unequal and the PDF
     page shrank to ~130px wide, wasting the wide stage. In short
     landscape the footer now sits at the bottom of the stage and is
     reached by the same scroll that reveals the notebook page's bottom;
     the pane's body scrolls internally, so the page itself stays put. */
  let h=shell.offsetHeight;
  pane.style.height=h+'px';
}
/* Split View PDF pages: the pane used to show only cached text, so a PDF
   never opened in the reader showed "Open the PDF in the reader once…"
   and a scanned/image PDF — no extractable text on any page — could
   never show at all, however large or small. The pane now draws the
   actual page with the reader's own lazy machinery (pdfDrawPage): one
   page at a time, nothing eager, text layer included (which also fills
   that page's text cache on demand). */
let splitPdfGen=0;
/* P3: EPUB chapter stepper in the split pane (mockup 6 footer). Mirrors
   splitPdfPage: step b.ch through b.chapters and re-render the pane. */
function splitEpubChapter(d){
  let nb=curNb(); if(!nb) return;
  let b=splitBookFor(nb); if(!b||b.kind!=='epub') return;
  let n=(b.chapters||[]).length; if(!n) return;
  b.ch=Math.max(0,Math.min(n-1,(b.ch||0)+d));
  scheduleSave();
  let pane=$('splitPane'); if(pane) renderSplitBook(pane,b);
}
function splitPdfPage(d){
  let nb=curNb(); if(!nb) return;
  let b=splitBookFor(nb); if(!b||b.kind!=='pdf') return;
  b.page=Math.max(1,Math.min(b.numPages||1,(b.page||1)+d));
  scheduleSave();
  let pane=$('splitPane'); if(pane) splitRenderPdfPage(pane,b);
}
/* Split-pane zoom: the same approach as the reader (readerZoomBy) — the
   page holder widens by a percentage and the page is re-rendered crisply
   at the new width after a short settle delay, never an upscaled bitmap.
   The zoom lives on the book (b.splitZoom, like the reader's readerZoom)
   so page turns keep it; it resets when another book is picked. */
let splitZoomT=null; let splitPaneResizeT=null;
function splitPdfZoomBy(f){
  let nb=curNb(); if(!nb) return;
  let b=splitBookFor(nb); if(!b||b.kind!=='pdf') return;
  b.splitZoom= f===0? 1 : Math.max(0.5, Math.min(2.5, (b.splitZoom||1)*f));
  let pane=$('splitPane'); if(!pane) return;
  let host=pane.querySelector('#splitPdfHost'); if(host) host.style.width=(b.splitZoom*100)+'%';
  let zl=pane.querySelector('#splitZoomLabel'); if(zl) zl.textContent=Math.round(b.splitZoom*100)+'%';
  clearTimeout(splitZoomT);
  splitZoomT=setTimeout(()=>{ splitPdfRedraw(pane,b); },120);
}
/* Space use: the pane page fits its body — width AND height, whichever
   binds — so the stage does not sit half-empty. The holder's width is
   capped at the width that fits the body's height at the page's aspect
   ratio; the cap scales with the pane zoom, so zooming in still grows
   the page (and the body scrolls). The page is centred when narrower
   than the body. */
function splitFitPanePage(pane,b,holder){
  let body=pane.querySelector('.splitPaneBody'); if(!body||!holder) return 0;
  let sz=(b._pageSizes&&b._pageSizes[b.page-1])||[612,792];
  /* The body's padding is 12px a side horizontally but only 12px at the
     bottom vertically (top is 0) — subtracting 24px vertically
     double-counted it and shrank the page by ~12px of height at phone
     widths, where the body is shortest. */
  let availW=body.clientWidth-24, availH=body.clientHeight-12;
  let fitW=Math.min(availW, availH*sz[0]/sz[1]);
  let cap=Math.max(40, Math.floor(fitW*(b.splitZoom||1)));
  holder.style.maxWidth=cap+'px'; holder.style.margin='0 auto';
  return cap;
}
function splitRefitCurrentPage(){
  if(!S.split) return;
  let pane=$('splitPane'); if(!pane) return;
  let nb=curNb(); if(!nb) return;
  let b=splitBookFor(nb); if(!b||b.kind!=='pdf') return;
  let host=pane.querySelector('#splitPdfHost'); if(!host) return;
  let holder=host.querySelector('.pdfHolder'); if(!holder||!holder._drawn) return;
  let before=parseInt(holder.style.maxWidth||'0',10)||0;
  let cap=splitFitPanePage(pane,b,holder);
  if(Math.abs(cap-before)>2) splitPdfRedraw(pane,b);
}
function splitPdfRedraw(pane,b){
  let host=pane.querySelector('#splitPdfHost'); if(!host) return;
  let holder=host.querySelector('.pdfHolder'); if(!holder) return;
  splitFitPanePage(pane,b,holder);
  let gen=splitPdfGen;
  let live=()=>gen===splitPdfGen&&pane.isConnected&&pane.dataset.bookId===b.id&&holder.isConnected;
  pdfReleasePage(holder);
  let jump=(n)=>{ if(typeof n==='number'){ b.page=Math.max(1,Math.min(b.numPages,n)); scheduleSave(); splitRenderPdfPage(pane,b); } };
  pdfDrawPage(b,+holder.dataset.n,holder,live,jump);
}
/* Pinch-to-zoom in the pane, mirroring the reader's pinch (readerTouch*):
   a live scale preview while pinching, the real crisp zoom on lift. */
let splitPinch=null;
function splitPdfTouchStart(e){
  if(!e.touches||e.touches.length!==2) return;
  let host=e.currentTarget.querySelector('#splitPdfHost'); if(!host || !host.querySelector('.pdfHolder')) return;
  let a=e.touches[0],c=e.touches[1],r=host.getBoundingClientRect();
  let b=splitBookFor(curNb());
  splitPinch={host:host,d0:Math.max(20,Math.hypot(a.clientX-c.clientX,a.clientY-c.clientY)),z0:(b&&b.splitZoom)||1,s:1};
  e.preventDefault();
  host.style.transformOrigin=((a.clientX+c.clientX)/2-r.left)+'px '+((a.clientY+c.clientY)/2-r.top)+'px';
}
function splitPdfTouchMove(e){
  if(!splitPinch||!e.touches||e.touches.length!==2) return;
  e.preventDefault();
  let a=e.touches[0],c=e.touches[1];
  let z=Math.max(0.5,Math.min(2.5,splitPinch.z0*Math.hypot(a.clientX-c.clientX,a.clientY-c.clientY)/splitPinch.d0));
  splitPinch.s=z/splitPinch.z0; splitPinch.host.style.transform='scale('+splitPinch.s+')';
}
function splitPdfTouchEnd(e){
  if(!splitPinch||(e.touches&&e.touches.length>=2)) return;
  let p=splitPinch; splitPinch=null;
  p.host.style.transform=''; p.host.style.transformOrigin='';
  if(Math.abs(p.s-1)>0.02) splitPdfZoomBy(p.s);
}
(function(){ let pane=$('splitPane'); if(!pane) return; pane.addEventListener('touchstart',splitPdfTouchStart,{passive:false}); pane.addEventListener('touchmove',splitPdfTouchMove,{passive:false}); pane.addEventListener('touchend',splitPdfTouchEnd,{passive:false}); pane.addEventListener('touchcancel',splitPdfTouchEnd,{passive:false}); })();
async function splitRenderPdfPage(pane,b){
  let gen=++splitPdfGen;
  let host=pane.querySelector('#splitPdfHost'); if(!host) return;
  let label=pane.querySelector('#splitPdfLabel');
  b.page=Math.max(1,Math.min(b.numPages||1,b.page||1));
  if(label) label.textContent=b.page+'/'+(b.numPages||'?'); /* compact footer label */
  /* free the previous page's bitmap (and cancel a draw still in flight) */
  let old=host.querySelector('.pdfHolder'); if(old) pdfReleasePage(old);
  host.innerHTML='<p class="kbd">Loading page…</p>';
  host.dataset.splitLoading='1';
  let ok=await ensurePdfDoc(b);
  if(gen!==splitPdfGen||!pane.isConnected||pane.dataset.bookId!==b.id) return;
  delete host.dataset.splitLoading;
  if(!ok){ host.innerHTML='<p>This PDF\u2019s file could not be restored from this browser. Import the file again to read it.</p>'; return; }
  b.page=Math.max(1,Math.min(b.numPages,b.page||1));
  if(label) label.textContent=b.page+'/'+b.numPages;
  host.style.width=((b.splitZoom||1)*100)+'%'; /* page turns keep the pane zoom */
  let zl=pane.querySelector('#splitZoomLabel'); if(zl) zl.textContent=Math.round((b.splitZoom||1)*100)+'%';
  host.innerHTML='';
  let holder=document.createElement('div');
  holder.className='pdfHolder'; holder.dataset.n=b.page;
  let sz=(b._pageSizes&&b._pageSizes[b.page-1])||[612,792];
  holder.style.aspectRatio=sz[0]+' / '+sz[1];
  host.appendChild(holder);
  splitFitPanePage(pane,b,holder);
  let jump=(n)=>{ if(typeof n==='number'){ b.page=Math.max(1,Math.min(b.numPages,n)); scheduleSave(); splitRenderPdfPage(pane,b); } };
  let live=()=>gen===splitPdfGen&&pane.isConnected&&pane.dataset.bookId===b.id&&holder.isConnected;
  splitDrawWhenVisible(holder,b,pane,gen,live,jump,14);
}
/* pdfDrawPage draws nothing while the holder has no width (the editor
   view is still hidden when a notebook first opens), so retry briefly
   until it is visible; each attempt is cheap and the draw itself is
   guarded by the generation token. */
function splitDrawWhenVisible(holder,b,pane,gen,live,jump,left){
  if(!live()||holder._drawn) return;
  pdfDrawPage(b,+holder.dataset.n,holder,live,jump);
  if(left<=0) return;
  setTimeout(()=>{ if(live()&&!holder._drawn) splitDrawWhenVisible(holder,b,pane,gen,live,jump,left-1); },150);
}
function renderSplitPicker(pane){
  pane.dataset.bookId='';
  let books=S.items.filter(i=>i.kind==='pdf'||i.kind==='epub');
  if(!books.length){ pane.innerHTML='<div class="splitPaneBody"><h3>Nothing to read yet</h3><p>Open or import a book and it will appear here beside your notebook.</p></div>'; return; }
  pane.innerHTML='<div class="splitPaneBody"><h3>Read beside this notebook</h3><p class="kbd">Pick a book to open beside the notebook.</p></div>';
  let list=document.createElement('div');
  books.forEach(b=>{
    let row=document.createElement('button');
    row.type='button'; row.className='pickRow'; row.onclick=()=>splitPickBook(b.id);
    let meta=b.kind==='pdf' ? ((b.numPages||'?')+' pages · PDF') : (((b.chapters||[]).length)+' chapters · EPUB');
    row.innerHTML='<span class="pickDot" style="background:'+esc(b.color||'#4a5a74')+'"></span><span class="pickMain"><b>'+esc(b.title)+'</b><span class="kbd">'+esc(meta)+'</span></span><span class="pickGo" aria-hidden="true">›</span>';
    list.appendChild(row);
  });
  pane.querySelector('.splitPaneBody').appendChild(list);
}
function splitPickBook(id){
  let nb=curNb(); if(nb){ nb.splitBookId=id; scheduleSave(); }
  let b=S.items.find(i=>i.id===id); if(b) renderSplitBook($('splitPane'),b);
}
function splitShowPicker(){ renderSplitPicker($('splitPane')); }

/* ============ LaTeX equations on the page (KaTeX rendering) ============ */
const TEX_TEMPLATES={frac:'\\frac{a}{b}', sqrt:'\\sqrt{x^2 + y^2}', int:'\\int_0^1 f(x)\\,dx', sum:'\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', matrix:'\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', pyth:'a^2 + b^2 = c^2'};
function texRenderInto(el,tex,size,color){
  el.style.fontSize=size+'px'; el.style.color=color||'#1b2a4a';
  if(window.katex){ try{ katex.render(tex, el, {throwOnError:false, displayMode:false}); return; }catch(e){} }
  el.textContent=tex; el.style.fontStyle='italic'; el.style.fontFamily='Newsreader, serif';
}
function renderTexLayer(){
  let p=curPageObj(); let host=$('texLayer'); if(!host) return; host.innerHTML=''; if(!p) return;
  let scale=(inkC.getBoundingClientRect().width||660)/CW;
  (p.texs||[]).forEach(t=>{
    let d=document.createElement('div'); d.className='texEl';
    d.style.left=(t.x/CW*100)+'%'; d.style.top=(t.y/PH*100)+'%';
    texRenderInto(d, t.tex, Math.max(10,(t.size||26)*scale), pageInkColor(t.color,p));
    let del=document.createElement('button'); del.className='miniBtn'; del.innerHTML=icon('x'); del.title='Remove equation'; del.setAttribute('aria-label','Remove equation'); del.style.cssText='position:absolute;top:-10px;left:-12px;z-index:3;background:var(--surface)'; /* P9: top-left keeps the control clear of superscripts */
    del.onclick=e=>{ e.stopPropagation(); p.texs=p.texs.filter(x=>x!==t); bumpV(p); renderTexLayer(); renderPages(); };
    d.appendChild(del);
    d.addEventListener('pointerdown',e=>{
      if(e.target===del) return; e.stopPropagation(); d.setPointerCapture(e.pointerId);
      let shell=inkC.getBoundingClientRect(); let sx=e.clientX, sy=e.clientY, ox=t.x, oy=t.y;
      function mv(ev){ t.x=ox+(ev.clientX-sx)*(CW/shell.width); t.y=oy+(ev.clientY-sy)*(PH/shell.height); d.style.left=(t.x/CW*100)+'%'; d.style.top=(t.y/PH*100)+'%'; }
      function up(){ d.removeEventListener('pointermove',mv); d.removeEventListener('pointerup',up); bumpV(p); renderPages(); }
      d.addEventListener('pointermove',mv); d.addEventListener('pointerup',up);
    });
    host.appendChild(d);
  });
}
function openTexModal(){
  if(!curNb()){ toast('Open a notebook first'); return; }
  if(S.view!=='editor'){ openNotebook(curNb().id); }
  openDialog('texModal'); updateTexPreview();
  setTimeout(()=>$('texInput').focus(),50);
}
function applyTexTemplate(k){ if(k && TEX_TEMPLATES[k]){ $('texInput').value=TEX_TEMPLATES[k]; updateTexPreview(); } }
function updateTexPreview(){ let v=$('texInput').value.trim(); let pv=$('texPreview'); if(!v){ /* P8: an empty box previews nothing, so Place cannot accept a phantom equation */ pv.className='texPreviewEmpty'; pv.textContent='Your equation will preview here as you type.'; return; } pv.className=''; texRenderInto(pv, v, +$('texSize').value, S.color); }
function insertTex(){
  let p=curPageObj(); if(!p) return;
  let tex=$('texInput').value.trim(); if(!tex){ toast('Write some TeX first'); return; }
  if(!p.texs) p.texs=[];
  p.texs.push({id:uid(), x:120, y:110, tex:tex, size:+$('texSize').value, color:S.color});
  bumpV(p); closeModal('texModal'); renderTexLayer(); renderPages();
  toast('Equation on the page. Drag it to move it.');
}
document.addEventListener('input',e=>{ if(e.target && (e.target.id==='texInput'||e.target.id==='texSize')) updateTexPreview(); });

/* ============ colour palettes (.gpl) & toolbar layouts ============ */
function importGpl(e){
  let f=e.target.files[0]; e.target.value=''; if(!f) return;
  let r=new FileReader();
  r.onload=()=>{
    let cols=[];
    String(r.result).split(/\r?\n/).forEach(line=>{
      let m=line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/);
      if(m){ let hex='#'+[m[1],m[2],m[3]].map(v=>Math.min(255,+v).toString(16).padStart(2,'0')).join(''); cols.push({hex:hex, name:m[4]||hex}); }
    });
    if(!cols.length){ toast('No colours found in that .gpl file'); return; }
    let box=$('swatchBox'); box.innerHTML='';
    cols.slice(0,24).forEach((c,i)=>{
      let b=document.createElement('button'); b.className='swatch'+(i===0?' active':''); b.style.background=c.hex; b.title=c.name; b.setAttribute('aria-label',c.name);
      b.onclick=()=>setColor(c.hex,b); box.appendChild(b);
    });
    setColor(cols[0].hex, box.querySelector('.swatch'));
    toast('Palette loaded. '+Math.min(24,cols.length)+' colours from '+f.name);
  };
  r.readAsText(f);
}
function setToolbarLayout(v){ let tb=$('mainToolbar'); tb.classList.remove('compact','minimal'); if(v) tb.classList.add(v); }
/* Dismissal for the editor sheets (native <dialog> bottom sheets). The old
   popover names are kept because the sheet buttons and setTool() call them. */
function closeAllToolPops(){ ['editorSheet','exportSheet','prMarksSheet'].forEach(id=>{ var d=$(id); if(d && d.open) d.close(); }); document.querySelectorAll('.toolPop.open, .shapePop.open, .colorPop.open').forEach(el=>el.classList.remove('open')); var sb=$('shapesBtn'); if(sb) sb.setAttribute('aria-expanded','false'); var cb=$('pillColorBtn'); if(cb) cb.setAttribute('aria-expanded','false'); }
/* P2: Shapes popover on the floating pill toolbar. */
function toggleShapePop(){
  var pop=$('shapePop'), btn=$('shapesBtn'); if(!pop||!btn) return;
  var open=!pop.classList.contains('open');
  if(open) closeColorPop();
  pop.classList.toggle('open',open); btn.setAttribute('aria-expanded',String(open));
}
function closeShapePop(){ var pop=$('shapePop'), btn=$('shapesBtn'); if(pop) pop.classList.remove('open'); if(btn) btn.setAttribute('aria-expanded','false'); }
/* Colour-picker fix: ink-colour popover on the floating pill toolbar,
   same pattern as the shapes popover. Only one pill popover is open at
   a time, and a tap anywhere else (or Escape) closes it. */
function toggleColorPop(){
  var pop=$('colorPop'), btn=$('pillColorBtn'); if(!pop||!btn) return;
  var open=!pop.classList.contains('open');
  if(open) closeShapePop();
  pop.classList.toggle('open',open); btn.setAttribute('aria-expanded',String(open));
}
function closeColorPop(){ var pop=$('colorPop'), btn=$('pillColorBtn'); if(pop) pop.classList.remove('open'); if(btn) btn.setAttribute('aria-expanded','false'); }
document.addEventListener('pointerdown',e=>{
  var pop=$('shapePop'); if(pop&&pop.classList.contains('open')){
    var btn=$('shapesBtn');
    if(!pop.contains(e.target) && !(btn && (e.target===btn || btn.contains(e.target)))) closeShapePop();
  }
  var cp=$('colorPop'); if(cp&&cp.classList.contains('open')){
    var cb=$('pillColorBtn');
    if(!cp.contains(e.target) && !(cb && (e.target===cb || cb.contains(e.target)))) closeColorPop();
  }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ var pop=$('shapePop'); if(pop&&pop.classList.contains('open')) closeShapePop(); var cp=$('colorPop'); if(cp&&cp.classList.contains('open')) closeColorPop(); if(S.view==='editor' && S.selection.length) clearSelection(); }
});
/* P2: inspector sheet tabs (Draw | Insert | Page | Notes & Audio). */
function switchSheetTab(tab){
  ['draw','insert','page','notes'].forEach(t=>{
    var cap=t[0].toUpperCase()+t.slice(1);
    var b=$('sheetTabBtn'+cap), p=$('sheetTab'+cap);
    if(b) b.setAttribute('aria-selected',String(t===tab));
    if(p) p.hidden=(t!==tab);
  });
}
/* P2: page-colour swatches (the select stays as the state mirror). */
function hexToRgb(h){ h=String(h||'').replace('#',''); return 'rgb('+parseInt(h.substr(0,2),16)+', '+parseInt(h.substr(2,2),16)+', '+parseInt(h.substr(4,2),16)+')'; }
function syncPageBgSwatches(v){
  var box=$('pageSwatches'); if(!box||!v) return;
  var want=hexToRgb(v);
  box.querySelectorAll('.pageSwatch').forEach(b=>{
    var cur=''; try{ cur=getComputedStyle(b).backgroundColor; }catch(e){}
    b.classList.toggle('active', cur===want);
  });
}
function pickPageBg(v){
  var sel=$('pageBgSel'); if(sel) sel.value=v;
  setPageBg(v); syncPageBgSwatches(v);
}
/* P2: open the Tools & Insert inspector (side drawer on desktop,
   4-tab bottom sheet on mobile). */
function openInspector(section){
  var d=$('editorSheet'); if(!d) return;
  if(!d.open) d.showModal();
  var b=$('pillInsertBtn'); if(b) b.setAttribute('aria-expanded','true');
  if(section && typeof switchSheetTab==='function') switchSheetTab(section);
}
/* Pass 2 audit (mockup 17): on desktop the pill's Insert button opens a
   popover menu under the pill (menu guide: popover + focusgroup,
   script-positioned like the + New menu); on phones it opens the
   inspector sheet, as before. */
function onPillInsertClick(){
  if(window.matchMedia('(max-width:768px)').matches){ openInspector('insert'); return; }
  let m=$('insertMenu'); if(!m) return;
  if(m.matches(':popover-open')) m.hidePopover(); else m.showPopover({source:$('pillInsertBtn')});
}
function closeInsertMenu(){ let m=$('insertMenu'); if(m&&m.matches(':popover-open')) m.hidePopover(); }
function focusWrittenNotes(){ let t=$('noteText'); if(t){ t.scrollIntoView({block:'center'}); t.focus(); } }
(function(){
  let menu=$('insertMenu'); if(!menu) return;
  let btn=$('pillInsertBtn'); if(!btn) return;
  let lastKey=false;
  btn.addEventListener('keydown',()=>{ lastKey=true; });
  btn.addEventListener('pointerdown',()=>{ lastKey=false; });
  menu.addEventListener('toggle',e=>{
    let open=e.newState==='open';
    btn.setAttribute('aria-expanded',open?'true':'false');
    if(!open) return;
    /* Script positioning, below the trigger, flipping above when there
       is no room, clamped to the viewport. */
    let r=btn.getBoundingClientRect();
    menu.style.position='fixed'; menu.style.margin='0';
    let top=r.bottom+6, left=Math.max(8,Math.min(r.right-menu.offsetWidth,window.innerWidth-menu.offsetWidth-8));
    if(top+menu.offsetHeight>window.innerHeight-8) top=Math.max(8,r.top-menu.offsetHeight-6);
    menu.style.top=top+'px'; menu.style.left=left+'px';
    if(lastKey){ let first=menu.querySelector('[focusgroup] button'); if(first) first.focus(); }
  });
})();
/* Toolbar guide: focusgroup gives the roving tab stop natively; where
   it is unsupported, a small roving-tabindex fallback does the same. */
(function(){
  var d=$('editorSheet'); if(d) d.addEventListener('close',()=>{ var b=$('pillInsertBtn'); if(b) b.setAttribute('aria-expanded','false'); });
  if('focusGroup' in HTMLElement.prototype) return;
  var bar=$('mainToolbar'); if(!bar) return;
  function items(){ return Array.from(bar.querySelectorAll('button:not([disabled])')).filter(b=>b.offsetParent!==null); }
  bar.addEventListener('focusin',e=>{ if(items().includes(e.target)) items().forEach(b=>{ b.tabIndex=(b===e.target?0:-1); }); });
  bar.addEventListener('keydown',e=>{
    var list=items(); var i=list.indexOf(document.activeElement); if(i<0) return;
    var rtl=getComputedStyle(bar).direction==='rtl';
    var step={ArrowRight:rtl?-1:1,ArrowLeft:rtl?1:-1,Home:'home',End:'end'}[e.key];
    if(step===undefined) return; e.preventDefault();
    var n= step==='home'?0 : step==='end'?list.length-1 : (i+step+list.length)%list.length;
    list[n].focus();
  });
})();
function closeAllPopovers(){ closeAllToolPops(); closeExportPop(); }
const TOOL_LABELS={pen:'Pen',calligraphy:'Calligraphy',highlighter:'Highlighter',eraser:'Eraser',hand:'Hand',select:'Select',text:'Text',line:'Line',rect:'Rectangle',ellipse:'Ellipse',arrow:'Arrow',spline:'Spline',compass:'Compass',lasso:'Lasso',vspace:'Vertical space'};
function updateToolOptsUI(){ var label=TOOL_LABELS[S.tool]||'Tool'; var btn=$('toolOptsBtn'); if(btn) btn.innerHTML=label+' options '+icon('chevron-down','ic-sm'); var title=$('toolOptsTitle'); if(title) title.textContent=label+' options'; document.querySelectorAll('.toolOptSection').forEach(sec=>{ var tools=(sec.getAttribute('data-tools')||'').split(/\s+/); sec.classList.toggle('show', tools.indexOf(S.tool)>=0); }); }
function updateStatusBar(){ var nb=curNb(); var sp=$('statusPage'); if(sp && nb) sp.textContent=(nb.cur+1)+' / '+nb.pages.length; var sl=$('statusLayer'); if(sl){ var inkOn=!$('layerInkTgl')||$('layerInkTgl').checked; var hiOn=!$('layerHiTgl')||$('layerHiTgl').checked; sl.textContent= S.tool==='highlighter'?'Highlight': (inkOn&&hiOn?'Ink + Highlight': inkOn?'Ink': hiOn?'Highlight':'None'); } var lc=$('layerChip'); if(lc) lc.textContent='Layer: '+(S.tool==='highlighter'?'Highlight':'Ink'); var sz=$('statusZoom'); if(sz) sz.textContent=Math.round((typeof editorZoom!=='undefined'?editorZoom:1)*100)+'%'; var st=$('statusTool'); if(st) st.textContent=TOOL_LABELS[S.tool]||S.tool;
  /* Page-navigation pill: same numbers as the status bar, updated on
     every path that changes the page (renderPages calls this on every
     loadPageIntoEditor, so thumbnail taps, Add page, link opens and
     page actions all land here — no polling). */
  var pl=$('pageNavLabel'); if(pl && nb) pl.textContent=(nb.cur+1)+' / '+nb.pages.length;
  var pv=$('pageNavPrev'); if(pv) pv.disabled=!nb || nb.cur<=0;
  var nx=$('pageNavNext'); if(nx) nx.disabled=!nb || nb.cur>=nb.pages.length-1; }
function closeExportPop(){ var d=$('exportSheet'); if(d && d.open) d.close(); var b=$('exportBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function selectLayerStrokes(which){ let p=curPageObj(); if(!p) return; S.selection=(which==='ink'? p.ink : p.hi).slice(); drawSelectionOverlay(); toast(S.selection.length? S.selection.length+' stroke(s) selected on the '+(which==='ink'?'ink':'highlight')+' layer' : 'That layer is empty on this page'); }

/* ============ exports ============ */
function exportPagePNG(){ let nb=curNb(); if(!nb) return; saveEditorToModel(); let c=composePage(curPageObj(), nb.template); c.toBlob(b=>{ download(nb.title.replace(/[^\w\- ]+/g,'')+', page '+(nb.cur+1)+'.png', b); toast('PNG exported'); }); }
/* P10: plain-text export of the whole notebook, typed notes plus the
   text placed on each page, one headed section per page. The reader
   already exported annotations as .txt; notebooks had no text option. */
function exportNotebookTXT(){
  let nb=curNb(); if(!nb) return; saveEditorToModel();
  let body=nb.pages.map((p,i)=>{
    let parts=['--- Page '+(i+1)+' ---'];
    if(p.text && p.text.trim()) parts.push(p.text.trim());
    (p.texts||[]).forEach(t=>{ let tx=String(t.text||'').trim(); if(tx) parts.push(tx); });
    return parts.join('\n');
  }).join('\n\n');
  download(nb.title.replace(/[^\w\- ]+/g,'')+'.txt', new Blob([body],{type:'text/plain'}));
  toast('Notebook exported as .txt');
}
async function exportNotebookPDF(){
  let nb=curNb(); if(!nb) return; saveEditorToModel();
  if(!window.jspdf){ toast('PDF export library could not load. Check the connection.'); return; }
  let doc=new window.jspdf.jsPDF({unit:'px', format:[CW,pageH(nb.pages[0])], orientation: pageH(nb.pages[0])>CW?'portrait':'landscape'});
  for(let i=0;i<nb.pages.length;i++){ let p=nb.pages[i];
    /* Decode this page's PDF background first (lazy since the restore
       change): exporting an unviewed page used to print the blank
       template instead of its PDF page. */
    if(p.bgPdf) await decodeBgPdfImg(p);
    let ph=pageH(p); if(i>0) doc.addPage([CW,ph], ph>CW?'portrait':'landscape'); let c=composePage(p, nb.template); doc.addImage(c.toDataURL('image/jpeg',0.92),'JPEG',0,0,CW,c.height);
  }
  doc.save(nb.title.replace(/[^\w\- ]+/g,'')+'.pdf'); toast('Notebook exported as PDF');
}
/* SVG export, strokes become real vector elements, so the page opens in
   any vector editor and scales without loss. */
function svgForStroke(st){
  let pts=st.points; if(!pts.length) return '';
  let w=Math.max(1,st.size*1.3), dash=(st.style&&st.style!=='solid'&&DASH_PATTERNS[st.style])? ' stroke-dasharray="'+DASH_PATTERNS[st.style].join(' ')+'"':'';
  if(st.tool==='shape'){
    let a=pts[0], b=pts[pts.length-1];
    if(st.shape==='line') return '<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="'+st.color+'" stroke-width="'+w+'" stroke-linecap="round"'+dash+'/>';
    if(st.shape==='rect') return '<rect x="'+Math.min(a.x,b.x)+'" y="'+Math.min(a.y,b.y)+'" width="'+Math.abs(b.x-a.x)+'" height="'+Math.abs(b.y-a.y)+'" fill="'+(st.fill? st.color:'none')+'" fill-opacity="'+(st.fill?0.28:0)+'" stroke="'+st.color+'" stroke-width="'+w+'"'+dash+'/>';
    if(st.shape==='ellipse') return '<ellipse cx="'+((a.x+b.x)/2)+'" cy="'+((a.y+b.y)/2)+'" rx="'+Math.abs(b.x-a.x)/2+'" ry="'+Math.abs(b.y-a.y)/2+'" fill="'+(st.fill? st.color:'none')+'" fill-opacity="'+(st.fill?0.28:0)+'" stroke="'+st.color+'" stroke-width="'+w+'"'+dash+'/>';
    if(st.shape==='arrow'){ let ang=Math.atan2(b.y-a.y,b.x-a.x), hl=18+st.size*2; let h1={x:b.x-hl*Math.cos(ang-0.42),y:b.y-hl*Math.sin(ang-0.42)}, h2={x:b.x-hl*Math.cos(ang+0.42),y:b.y-hl*Math.sin(ang+0.42)}; return '<path d="M'+a.x+' '+a.y+' L'+b.x+' '+b.y+' M'+h1.x+' '+h1.y+' L'+b.x+' '+b.y+' L'+h2.x+' '+h2.y+'" fill="none" stroke="'+st.color+'" stroke-width="'+w+'" stroke-linecap="round"'+dash+'/>'; }
    return '';
  }
  let d='M'+pts.map(p=>p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' L');
  if(st.tool==='highlighter') return '<path d="'+d+'" fill="none" stroke="'+st.color+'" stroke-width="'+(st.size*4.5)+'" stroke-linecap="round" stroke-linejoin="round" opacity="0.42"/>';
  return '<path d="'+d+'" fill="none" stroke="'+st.color+'" stroke-width="'+w+'" stroke-linecap="round" stroke-linejoin="round"'+dash+'/>';
}
function exportPageSVG(){
  let nb=curNb(); if(!nb) return; saveEditorToModel(); let p=curPageObj();
  let parts=['<svg xmlns="http://www.w3.org/2000/svg" width="'+CW+'" height="'+CH+'" viewBox="0 0 '+CW+' '+CH+'">',
    '<rect width="'+CW+'" height="'+CH+'" fill="'+(p.bgColor||'#fffdf6')+'"/>'];
  (p.images||[]).forEach(im=>{ parts.push('<image x="'+im.x+'" y="'+im.y+'" width="'+im.w+'" height="'+im.h+'" href="'+String(im.src).replace(/"/g,'&quot;')+'"/>'); });
  p.hi.forEach(st=>parts.push(svgForStroke(st)));
  p.ink.forEach(st=>parts.push(svgForStroke(st)));
  (p.texts||[]).forEach(t=>{ parts.push('<text x="'+t.x+'" y="'+(t.y+(t.size||26))+'" font-size="'+(t.size||26)+'" fill="'+t.color+'" font-family="'+(t.font||'serif').replace(/"/g,'')+'">'+esc(t.text)+'</text>'); });
  (p.texs||[]).forEach(t=>{ parts.push('<text x="'+t.x+'" y="'+(t.y+(t.size||26))+'" font-size="'+(t.size||26)+'" fill="'+(t.color||'#1b2a4a')+'" font-style="italic">'+esc(t.tex)+'</text>'); });
  parts.push('</svg>');
  download(nb.title.replace(/[^\w\- ]+/g,'')+', page '+(nb.cur+1)+'.svg', new Blob([parts.join('\n')],{type:'image/svg+xml'}));
  toast('SVG exported. The file is fully vector and opens in any vector editor.');
}
/* .xopp interchange, the gzipped-XML notebook format used by Xournal++:
   pages, layers, pen/highlighter strokes (with width + colour) and text
   elements are written out, and .xopp/.xoj files are read back the same way. */
function xoppEscape(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function xoppStrokeXml(st,tool){
  let pts=st.points.map(p=>p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
  return '<stroke tool="'+tool+'" color="'+st.color+'" width="'+(Math.max(0.6,st.size*(tool==='highlighter'?4.5:1.4))).toFixed(2)+'" fill="'+(st.fill? st.color+'46':'none')+'">'+pts+'</stroke>';
}
async function gzipBlob(text){
  if(window.CompressionStream){
    let stream=new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return await new Response(stream).blob();
  }
  return null;
}
async function gunzipText(buf){
  if(window.DecompressionStream){
    try{ let stream=new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')); return await new Response(stream).text(); }catch(e){}
  }
  return new TextDecoder().decode(buf);
}
async function exportXopp(){
  let nb=curNb(); if(!nb) return; saveEditorToModel();
  let xml='<?xml version="1.0" standalone="no"?>\n<xournal creator="Inkwell" fileversion="4">\n<title>'+xoppEscape(nb.title)+'</title>\n';
  nb.pages.forEach(p=>{
    xml+='<page width="'+CW+'" height="'+CH+'">\n<background type="solid" color="'+(p.bgColor||'#fffdf6')+'ff" style="plain"/>\n<layer>\n';
    p.hi.forEach(st=>{ xml+=xoppStrokeXml(st,'highlighter')+'\n'; });
    p.ink.forEach(st=>{ xml+=xoppStrokeXml(st, st.tool==='highlighter'?'highlighter':'pen')+'\n'; });
    (p.texts||[]).forEach(t=>{ xml+='<text font="Sans" size="'+(t.size||26)+'" x="'+t.x+'" y="'+t.y+'" color="'+t.color+'ff">'+xoppEscape(t.text)+'</text>\n'; });
    xml+='</layer>\n</page>\n';
  });
  xml+='</xournal>';
  let gz=await gzipBlob(xml);
  if(gz) download(nb.title.replace(/[^\w\- ]+/g,'')+'.xopp', gz);
  else download(nb.title.replace(/[^\w\- ]+/g,'')+'.xopp', new Blob([xml],{type:'text/xml'}));
  toast('.xopp exported. It opens in Xournal++ and other handwriting apps.');
}
async function importXopp(e){
  let f=e.target.files[0]; e.target.value=''; if(!f) return;
  try{
    let text=await gunzipText(await f.arrayBuffer());
    let doc=new DOMParser().parseFromString(text,'text/xml');
    if(doc.querySelector('parsererror')) throw new Error('not XML');
    let pageEls=doc.querySelectorAll('page'); if(!pageEls.length) throw new Error('no pages');
    let titleEl=doc.querySelector('title');
    let nb={id:uid(), kind:'notebook', title:(titleEl&&titleEl.textContent.trim())||f.name.replace(/\.(xopp|xoj)$/i,''), color:'#4a5a74', template:'blank', cur:0, updated:'Imported just now', annotations:[], pages:[]};
    pageEls.forEach(pg=>{
      let p=blankPage();
      let bg=pg.querySelector('background'); let col=bg&&bg.getAttribute('color'); if(col&&/^#[0-9a-f]{6}/i.test(col)) p.bgColor=col.slice(0,7);
      pg.querySelectorAll('layer').forEach(layer=>{
        layer.querySelectorAll('stroke').forEach(stEl=>{
          let nums=(stEl.textContent||'').trim().split(/\s+/).map(Number).filter(v=>!isNaN(v));
          if(nums.length<2) return;
          let points=[]; for(let i=0;i+1<nums.length;i+=2) points.push({x:nums[i],y:nums[i+1],p:0.6});
          let tool=stEl.getAttribute('tool')==='highlighter'? 'highlighter':'pen';
          let width=parseFloat(stEl.getAttribute('width'))||3;
          let st={tool:tool, color:(stEl.getAttribute('color')||'#1b2a4a').slice(0,7), size:Math.max(1,width/1.4), points:points};
          (tool==='highlighter'? p.hi : p.ink).push(st);
        });
        layer.querySelectorAll('text').forEach(tEl=>{
          p.texts.push({id:uid(), x:parseFloat(tEl.getAttribute('x'))||40, y:parseFloat(tEl.getAttribute('y'))||40, text:tEl.textContent||'', color:(tEl.getAttribute('color')||'#1b2a4a').slice(0,7), size:parseFloat(tEl.getAttribute('size'))||24, font:'Newsreader, serif'});
        });
      });
      nb.pages.push(p);
    });
    if(!nb.pages.length) nb.pages.push(blankPage());
    S.items.unshift(nb); openNotebook(nb.id);
    toast('Opened '+f.name+'. '+nb.pages.length+' page(s).');
  }catch(err){ toast('That .xopp file could not be read ('+(err&&err.message?err.message:'unknown error')+')'); }
}
function exportBackup(){
  saveEditorToModel();
  let data={app:'inkwell', version:2, exported:new Date().toISOString(),
    notebooks:S.items.filter(i=>i.kind==='notebook').map(nb=>({title:nb.title,color:nb.color,template:nb.template,cur:nb.cur,
      pages:nb.pages.map(p=>({ink:p.ink,hi:p.hi,text:p.text,stickies:p.stickies,table:p.table,texts:p.texts||[],texs:p.texs||[],images:(p.images||[]).map(im=>({x:im.x,y:im.y,w:im.w,h:im.h,src:im.src})),bgColor:p.bgColor||'#fffdf6',board:p.board?{color:p.board.color,strokes:p.board.strokes,view:p.board.view,geom:p.board.geom||null}:null, bgPdf:p.bgPdf?{bookTitle:p.bgPdf.bookTitle,page:p.bgPdf.page,w:(bgPdfSize(p.bgPdf)||[])[0]||null,h:(bgPdfSize(p.bgPdf)||[])[1]||null}:null}))})),
    bookNotes:S.items.filter(i=>i.kind!=='notebook').map(b=>({title:b.title,kind:b.kind,bookmarks:b.bookmarks,annotations:b.annotations,page:b.page,ch:b.ch,parallelNotes:b.parallelNotes}))};
  download('inkwell-backup.json', new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  toast('Backup downloaded. Notebooks are included in full, with bookmarks and annotations.');
}
async function relinkPdfBackgrounds(){
  /* Backgrounds are NOT rendered here any more. Rendering every missing
     page up front (one full-size canvas per page, retained) was the same
     blow-up as the old annotatePdf; decodeBgPdfImg() renders a page's
     background when it is actually viewed, and exportNotebookPDF()
     decodes on demand before composing. Nothing needs doing eagerly. */
  if(S.view==='editor' && curNb()){ loadPageIntoEditor(); }
}
function importBackup(e){
  let f=e.target.files[0]; e.target.value=''; if(!f) return;
  let r=new FileReader();
  r.onload=()=>{
    try{
      let data=JSON.parse(String(r.result));
      if(data.app!=='inkwell' || !Array.isArray(data.notebooks)) throw new Error('not an Inkwell backup');
      data.notebooks.forEach(nb=>{
        let item={id:uid(), kind:'notebook', title:nb.title||'Restored notebook', color:nb.color||'#b4552d', template:nb.template||'lined', cur:nb.cur||0, updated:'Restored', annotations:[],
          pages:(nb.pages&&nb.pages.length?nb.pages:[{}]).map(p=>({ink:p.ink||[],hi:p.hi||[],text:p.text||'',stickies:p.stickies||[],table:p.table||null,texts:p.texts||[],texs:p.texs||[],images:(p.images||[]).map(im=>({id:uid(),x:im.x,y:im.y,w:im.w,h:im.h,src:im.src})),bgColor:p.bgColor||'#fffdf6',board:p.board?{color:p.board.color,strokes:p.board.strokes,view:p.board.view||{x:0,y:0,k:1},geom:p.board.geom||null}:null,audio:null,bgPdf:p.bgPdf?{img:null,page:p.bgPdf.page,bookTitle:p.bgPdf.bookTitle}:null}))};
        S.items.unshift(item);
      });
      (data.bookNotes||[]).forEach(bn=>{ let b=S.items.find(i=>i.title===bn.title && i.kind===bn.kind); if(b){ b.bookmarks=bn.bookmarks||b.bookmarks; b.annotations=bn.annotations||b.annotations; backfillAnnoIds(b.annotations); b.parallelNotes=bn.parallelNotes||{}; } });
      relinkPdfBackgrounds();
      renderLibrary(); toast('Backup restored. '+data.notebooks.length+' notebook(s)');
    }catch(err){ toast('That file is not a readable Inkwell backup'); }
  };
  r.readAsText(f);
}

/* ============ import: PDF / EPUB / TXT ============ */
function handleImport(e){
  let f=e.target.files[0]; e.target.value=''; if(!f) return;
  let name=f.name.toLowerCase();
  if(name.endsWith('.pdf')){ importPdf(f); return; }
  if(name.endsWith('.epub')){ importEpub(f); return; }
  if(name.endsWith('.txt')){ let r=new FileReader(); r.onload=()=>{ let text=String(r.result);
    let book={id:uid(),kind:'epub',title:f.name.replace(/\.[^.]+$/,''),color:'#2e6f6a',updated:'Imported just now',ch:0,mode:'scroll',bookmarks:[],annotations:[],parallelNotes:{},
      chapters:[{title:f.name.replace(/\.[^.]+$/,''), html:text.split(/\n\s*\n/).map(p=>'<p>'+esc(p)+'</p>').join(''), text:text}]};
    S.items.unshift(book); renderLibrary(); afterImportOpen(book); toast('Text file opened in the reader'); }; r.readAsText(f); return; }
  toast('That file type is not supported. Use PDF, EPUB or TXT.');
}
async function importPdf(f){
  if(!window.pdfjsLib){ toast('PDF engine could not load. Check the connection and try again.'); return; }
  toast('Loading PDF…');
  try{
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    /* The file itself is the book: hand pdf.js a blob URL and store the
       File object, instead of copying the bytes three times (arrayBuffer
       + a slice for storage + a slice for pdf.js). A 151 MB file used to
       drive the heap past 350 MB at import; a 400 MB file would be
       ~850 MB transient on a phone. pdf.js fetches the blob URL once
       into memory it owns; the stored File is a reference, not a copy,
       and ensurePdfDoc() re-opens it the same way after a reload. */
    let doc=await pdfjsLib.getDocument({url:URL.createObjectURL(f),isEvalSupported:false}).promise;
    let book={id:uid(),kind:'pdf',title:f.name.replace(/\.[^.]+$/,''),color:'#4a5a74',updated:'Imported just now',doc:doc,numPages:doc.numPages,page:1,mode:'scroll',bookmarks:[],annotations:[],textCache:{},parallelNotes:{},fileName:f.name,fileData:f};
    S.items.unshift(book); renderLibrary();
    /* The file bytes ARE the book: wait until they are actually written
       before opening, and say so if the write fails, a silent failure
       here used to leave a book that was gone, or would not open, after
       the next reload. */
    try{ await persistPdfFile(book); }
    catch(e){ toast('The PDF opened, but its file could not be saved in this browser, so it may not survive a reload. Storage may be full. Export a backup to keep it safe.',6000); }
    afterImportOpen(book);
  }catch(err){ toast('That PDF could not be opened'+(err&&err.message? ' ('+err.message+')':'')+'. Password-protected or damaged files will not open.'); }
}

/* EPUB: real parsing with JSZip */
function resolvePath(base,rel){
  let parts=(base+rel).split('/'), out=[];
  parts.forEach(p=>{ if(p==='.'||p==='')return; if(p==='..')out.pop(); else out.push(p); });
  return out.join('/');
}
function sanitizeHtml(doc){
  doc.querySelectorAll('script,style,iframe,object,form,input,button,link,meta,title').forEach(el=>el.remove());
  doc.querySelectorAll('*').forEach(el=>{
    [...el.attributes].forEach(a=>{ if(/^on/i.test(a.name) || (a.name==='href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); });
  });
  return doc;
}
async function importEpub(f){
  if(!window.JSZip){ toast('EPUB engine could not load. Check the connection and try again.'); return; }
  toast('Unpacking EPUB…');
  try{
    let zip=await JSZip.loadAsync(f);
    let contFile=zip.file('META-INF/container.xml'); if(!contFile) throw new Error('no container.xml');
    let cont=new DOMParser().parseFromString(await contFile.async('text'),'text/xml');
    let rootPath=cont.querySelector('rootfile').getAttribute('full-path');
    let base=rootPath.includes('/')? rootPath.slice(0,rootPath.lastIndexOf('/')+1):'';
    let opf=new DOMParser().parseFromString(await zip.file(rootPath).async('text'),'text/xml');
    let manifest={};
    opf.querySelectorAll('manifest item').forEach(it=>{ manifest[it.getAttribute('id')]={href:it.getAttribute('href'), type:it.getAttribute('media-type'), props:it.getAttribute('properties')||''}; });
    let titleEl=opf.querySelector('metadata title, dc\\:title, title');
    let bookTitle=(titleEl&&titleEl.textContent.trim())||f.name.replace(/\.[^.]+$/,'');
    // TOC titles from NCX or nav
    let tocTitles={};
    let ncxItem=Object.values(manifest).find(m=>m.type==='application/x-dtbncx+xml');
    if(ncxItem){ try{ let ncx=new DOMParser().parseFromString(await zip.file(resolvePath(base,ncxItem.href)).async('text'),'text/xml');
      ncx.querySelectorAll('navPoint').forEach(np=>{ let src=np.querySelector('content')&&np.querySelector('content').getAttribute('src'); let lab=np.querySelector('navLabel text')&&np.querySelector('navLabel text').textContent.trim(); if(src&&lab) tocTitles[src.split('#')[0]]=lab; }); }catch(e){} }
    let spineIds=[...opf.querySelectorAll('spine itemref')].map(r=>r.getAttribute('idref'));
    let chapters=[];
    for(let id of spineIds){
      let item=manifest[id]; if(!item) continue;
      if(!/xhtml|html/.test(item.type)) continue;
      let path=resolvePath(base,item.href);
      let file=zip.file(path); if(!file) continue;
      let raw=await file.async('text');
      let doc=new DOMParser().parseFromString(raw,'text/html');
      // images -> blob URLs
      let chBase=path.includes('/')? path.slice(0,path.lastIndexOf('/')+1):'';
      let imgs=doc.querySelectorAll('img, image');
      for(let img of imgs){
        let src=img.getAttribute('src')||img.getAttribute('xlink:href')||img.getAttribute('href'); if(!src||/^https?:|^data:/.test(src)) continue;
        let ipath=resolvePath(chBase, decodeURIComponent(src.split('#')[0]));
        let ifile=zip.file(ipath);
        if(ifile){ let b64=await ifile.async('base64'); let ext=(ipath.split('.').pop()||'').toLowerCase(); let mime={'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','webp':'image/webp','svg':'image/svg+xml'}[ext]||'image/png'; img.setAttribute('src','data:'+mime+';base64,'+b64); /* data URL, not a blob URL, so the image survives the book being saved and restored */ }
      }
      sanitizeHtml(doc);
      let body=doc.body; if(!body) continue;
      let h=body.querySelector('h1,h2,h3');
      let title=(h&&h.textContent.trim())||tocTitles[item.href]||('Section '+(chapters.length+1));
      let text=body.textContent.replace(/\s+/g,' ').trim();
      if(!text && !body.querySelector('img')) continue;
      chapters.push({title:title.slice(0,90), html:body.innerHTML, text:text});
    }
    if(!chapters.length) throw new Error('no readable chapters found');
    let book={id:uid(),kind:'epub',title:bookTitle,color:'#2e6f6a',updated:'Imported just now',ch:0,mode:'scroll',bookmarks:[],annotations:[],chapters:chapters,parallelNotes:{}};
    S.items.unshift(book); renderLibrary(); afterImportOpen(book);
    toast('EPUB opened. '+chapters.length+' chapters, in reading mode');
  }catch(err){ toast('That EPUB could not be read ('+(err&&err.message?err.message:'unknown error')+')'); }
}

/* ============ reader ============ */
function openBook(id){
  let b=S.items.find(i=>i.id===id); if(!b||b.kind==='notebook') return;
  b.openedAt=Date.now(); /* Recent tab sorts on this; persisted by serializeLibrary */
  if(b.kind==='pdf' && !b.doc){
    /* Not parsed yet is NOT the same as lost: parse from the stored
       bytes now (ensurePdfDoc re-reads the file record if needed) and
       only declare the file gone when there are no bytes anywhere. */
    toast('Opening PDF…');
    ensurePdfDoc(b).then(ok=>{
      if(ok){ openBook(id); return; }
      if(b.fileData || b.id===SAMPLE_PDF_ID) toast('That PDF could not be opened. The PDF engine may still be loading, so try again in a moment.');
      else toast('This PDF\u2019s file could not be restored from this browser. Import the file again to read it. Its bookmarks and annotations are kept.');
    });
    return; }
  closeParallelRead(true); /* a different book opens in the normal reader */
  S.curBookId=id;
  /* phone: always open at fit-to-width so the page uses the freed space —
     a zoom left over from an earlier pinch (e.g. 70%) used to leave the
     page small with empty margins around it */
  if(window.matchMedia('(max-width:860px)').matches && b.kind==='pdf') b.readerZoom=1;
  $('modeScrollBtn').classList.toggle('active',b.mode!=='page'); $('modePageBtn').classList.toggle('active',b.mode==='page');
  $('ocrBox').classList.add('hidden'); $('parallelBox').classList.add('hidden');
  if(b.kind==='pdf'){ showPdfChrome(); renderPdfBook(); }
  else { showEpubChrome(); renderEpubBook(); }
  showView('reader'); renderReaderSide();
}
function showEpubChrome(){ $('pdfView').classList.add('hidden'); $('readerArticle').classList.remove('hidden'); $('ttsBar').classList.add('hidden'); var f=$('annotateFab'); if(f) f.classList.add('hidden'); var rz=$('readerZoomGroup'); if(rz) rz.classList.add('hidden'); }
function showPdfChrome(){ $('pdfView').classList.remove('hidden'); $('readerArticle').classList.add('hidden'); $('ttsBar').classList.add('hidden'); $('parallelBox').classList.add('hidden'); var f=$('annotateFab'); if(f) f.classList.remove('hidden'); var rz=$('readerZoomGroup'); if(rz) rz.classList.remove('hidden'); }
function closePdf(){ let b=curBook(); if(b) b.mode='scroll'; showView('library'); }
function setReaderMode(m){
  prLeave();
  closeReaderCards();
  $('modeScrollBtn').classList.toggle('active',m==='scroll'); $('modePageBtn').classList.toggle('active',m==='page');
  let b=curBook(); if(b){ b.mode=m; if(b.kind==='pdf') renderPdfBook(); else renderEpubBook(); }
  toast(m==='scroll'?'Scroll view':'Page view, one at a time. Use Prev and Next.');
}
function setReaderTheme(v){ $('readerArticle').className='reader '+v; $('parallelRead').dataset.theme=v; let pv=$('pdfView'); pv.style.filter= v==='dark'? 'invert(0.92) hue-rotate(180deg)':''; }
function readerFont(d){ let cur=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-fs'))||19; let next=Math.max(15,Math.min(26,cur+d*1.5)); document.documentElement.style.setProperty('--reader-fs',next+'px'); }
function toggleReaderSide(){ prLeave(); $('readerSide').classList.toggle('open'); }
function updateResume(){ updateReadProgress();
  let b=curBook(); if(!b) return;
  scheduleSave();
  if(b.kind==='pdf'){ $('pageLabel').textContent='Page '+b.page+' / '+b.numPages; $('resumeLabel').textContent='Reading · '+b.title+' · Page '+b.page+' of '+b.numPages+' · '+Math.round(b.page/b.numPages*100)+'%. Resumes here.'; S.stats.pagesRead['pdf:'+b.id+':'+b.page]=1; }
  else { $('pageLabel').textContent='Chapter '+(b.ch+1)+' / '+b.chapters.length; $('resumeLabel').textContent='Reading · '+b.title+' · Chapter '+(b.ch+1)+' of '+b.chapters.length+'. Resumes here.'; S.stats.pagesRead['epub:'+b.id+':'+b.ch]=1; }
  syncBookmarkBtn();
}

/* --- EPUB rendering --- */
function renderEpubBook(){
  let b=curBook(); if(!b||b.kind!=='epub') return;
  /* the OCR panel may have been parked inside the body, rescue it
     before innerHTML is rebuilt */
  ['ocrBox'].forEach(id=>{ let el=$(id); if(el && el.closest('#readerBody')) $('readerArticle').appendChild(el); });
  $('readerBadge').textContent=(b.sample?'Sample book':'EPUB')+' • '+b.chapters.length+' chapters';
  $('readerTitle').textContent=b.title;
  let body=$('readerBody');
  if(b.mode==='page'){ let c=b.chapters[b.ch]; body.innerHTML='<h3>'+esc(c.title)+'</h3>'+c.html; }
  else { body.innerHTML=b.chapters.map((c,i)=>'<div data-ch="'+i+'"><h3>'+esc(c.title)+'</h3>'+c.html+'</div>').join(''); }
  reapplyAnnotations();
  updateResume();
}
/* P2: highlights used to live only as DOM <mark> wrappers, so any
   re-render (Scroll → Page switch, chapter jump) rebuilt the body from
   the raw chapter HTML and the marks vanished even though the annotation
   list kept them. Re-wrap the stored annotation texts after every render. */
/* Cross-node re-wrap: a stored mark's text often spans several text nodes
   (on a PDF each word or line is its own span in the text layer), so the
   single-node wrapTextOnce misses it and the mark vanishes on re-render.
   Whitespace is normalised on both sides, then the match is wrapped with
   the same extract-contents fallback the live mark uses. */
function wrapTextAcross(container,needle,kind,color,opacity,annoId){
  if(!container||!needle) return false;
  let want=String(needle).replace(/\s+/g,' ').trim(); if(!want) return false;
  let walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT,{acceptNode:n=>{
    if(!n.nodeValue) return NodeFilter.FILTER_REJECT;
    if(n.parentElement && n.parentElement.closest('mark,[data-hl]')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  let nodes=[], full='', nd;
  while((nd=walker.nextNode())){ nodes.push({node:nd,start:full.length,text:nd.nodeValue}); full+=nd.nodeValue; }
  if(!full) return false;
  let norm='', map=[];
  for(let i=0;i<full.length;i++){
    let ch=full[i];
    if(/\s/.test(ch)){ if(norm.length && norm[norm.length-1]!==' '){ norm+=' '; map.push(i); } }
    else { norm+=ch; map.push(i); }
  }
  while(norm.endsWith(' ')){ norm=norm.slice(0,-1); map.pop(); }
  let idx=norm.indexOf(want); if(idx<0) return false;
  let s0=map[idx], e0=map[idx+want.length-1]+1, sn=null, so=0, en=null, eo=0;
  for(let r of nodes){
    let re=r.start+r.text.length;
    if(!sn && s0>=r.start && s0<re){ sn=r.node; so=s0-r.start; }
    if(sn && e0>r.start && e0<=re){ en=r.node; eo=e0-r.start; break; }
  }
  if(!sn||!en) return false;
  /* wrap each touched node in its own mark (see wrapRangePerNode): one
     range across the layer's spans would land a single malformed mark at
     the layer origin and break mouse selection in the whole layer. */
  let made=false;
  for(let r of nodes){
    let rs=r.start, re=r.start+r.text.length;
    let s=Math.max(s0,rs), e=Math.min(e0,re);
    if(e<=s) continue;
    let el=wrapMarkEl(kind,color,opacity,annoId), rr=document.createRange();
    rr.setStart(r.node,s-rs); rr.setEnd(r.node,e-rs);
    try{ rr.surroundContents(el); }catch(e2){ let frag=rr.extractContents(); el.appendChild(frag); rr.insertNode(el); }
    made=true;
  }
  return made;
}
function wrapTextOnce(container,needle,kind,color,opacity,annoId){
  if(!container||!needle) return false;
  let walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT,{acceptNode:n=>{
    if(!n.nodeValue||n.nodeValue.indexOf(needle)<0) return NodeFilter.FILTER_REJECT;
    if(n.parentElement && n.parentElement.closest('mark,[data-hl]')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  let node=walker.nextNode(); if(!node) return false;
  let idx=node.nodeValue.indexOf(needle);
  let range=document.createRange(); range.setStart(node,idx); range.setEnd(node,idx+needle.length);
  let wrapEl=wrapMarkEl(kind,color,opacity,annoId);
  try{ range.surroundContents(wrapEl); return true; }catch(e){ return false; }
}
function reapplyAnnotations(){
  let b=curBook(); if(!b||b.kind!=='epub') return;
  (b.annotations||[]).forEach(a=>{
    let m=/Chapter\s+(\d+)/.exec(a.where||''); let ci=m? (+m[1]-1) : b.ch;
    let container= b.mode==='page'? (ci===b.ch? $('readerBody') : null) : document.querySelector('[data-ch="'+ci+'"]');
    if(container) (wrapTextAcross(container,a.text,a.kind||'highlight',a.color,a.opacity,a.id)||wrapTextOnce(container,a.text,a.kind||'highlight',a.color,a.opacity,a.id));
  });
}
/* P3: OCR card, closable, and never left behind on a new page */
function closeReaderCards(){ let o=$('ocrBox'); if(o) o.classList.add('hidden'); }
function jumpToChapter(i){ let b=curBook(); if(!b||b.kind!=='epub') return; closeReaderCards();
  if(window.matchMedia('(max-width:1024px)').matches) $('readerSide').classList.remove('open'); /* drawer over the pages: close it on navigation */
  b.ch=Math.max(0,Math.min(b.chapters.length-1,i));
  if(b.mode==='page') renderEpubBook(); else { let el=document.querySelector('[data-ch="'+b.ch+'"]'); if(el) el.scrollIntoView({behavior:smoothOrInstant()}); updateResume(); }
  renderReaderSide(); }

/* ============ PDF pages: sharp, lazy drawing, shared by the reader and Parallel Read ============
   Why pages used to look soft: each page was drawn at exactly the size it
   shows on screen (one canvas pixel per screen pixel). On a screen with
   fractional scaling (125%, 150%) that canvas lands between screen pixels
   and the browser resamples the whole page, smearing every letter; the
   canvas width was also rounded to whole CSS pixels, adding a small stretch.
   Now:
   - every page is drawn at at least 2x the screen's pixel density (up to
     3x on very dense phone screens) from the page's EXACT on-screen width,
     and the browser scales it DOWN, downscaling keeps edges crisp;
   - one canvas never exceeds ~16 million pixels (phone browsers refuse or
     crash on bigger ones);
   - a page is only drawn when it comes within ~1200px of the visible area
     and is freed again when it goes further away, so a long PDF no longer
     keeps every page in memory (the reader used to draw and keep ALL pages);
   - pages are redrawn when the width, browser zoom or screen scaling changes.
   Each page is a placeholder sized to its own page shape before drawing, so
   the layout is final from the start and never jumps. */
const PDF_MAX_CANVAS_PX=16e6;
function pdfDensity(){ let d=window.devicePixelRatio||1; return Math.min(3, Math.max(2, d)); }
let pdfToken=0, pdfObserver=null, pdfDrawIO=null, pdfLastW=0;
/* every page's size (rotation included), read once per opened file, kept in memory only */
async function pdfPageSizes(book){
  if(book._pageSizes && book._pageSizesDoc===book.doc && book._pageSizes.length===book.numPages) return book._pageSizes;
  let sizes=[];
  for(let start=1; start<=book.numPages; start+=16){
    let batch=[]; for(let n=start; n<Math.min(book.numPages+1,start+16); n++) batch.push(n);
    let got=await Promise.all(batch.map(n=>book.doc.getPage(n).then(p=>{ let v=p.getViewport({scale:1}); return [v.width,v.height]; })));
    sizes=sizes.concat(got);
  }
  book._pageSizes=sizes; book._pageSizesDoc=book.doc;
  return sizes;
}
/* placeholders: <section class=pageClass data-page=n data-unit=n-1><label/><div class=pdfHolder data-n=n/></section> */
function pdfBuildPages(host,book,sizes,nums,pageClass){
  let holders=[];
  nums.forEach(n=>{
    let pg=document.createElement('section'); pg.className=pageClass; pg.dataset.page=n; pg.dataset.unit=n-1;
    let lab=document.createElement('div'); lab.className='pdfPageNum'; lab.textContent='Page '+n+' of '+book.numPages; pg.appendChild(lab);
    let sz=sizes[n-1]||sizes[0]||[612,792];
    let holder=document.createElement('div'); holder.className='pdfHolder'; holder.dataset.n=n; holder.style.aspectRatio=sz[0]+' / '+sz[1]; pg.appendChild(holder);
    host.appendChild(pg); holders.push(holder);
  });
  return holders;
}
async function pdfDrawPage(book,n,holder,isLive,onJump){
  if(holder._drawn || holder._drawing) return;
  holder._drawing=true; let gen=holder._gen=(holder._gen||0)+1;
  let stale=()=> !isLive() || holder._gen!==gen || !holder.isConnected;
  try{
    let page=await book.doc.getPage(n); if(stale()) return;
    let cssW=holder.getBoundingClientRect().width; if(cssW<20) return;
    let base=page.getViewport({scale:1}), cssScale=cssW/base.width, dens=pdfDensity();
    let px=(base.width*cssScale*dens)*(base.height*cssScale*dens);
    if(px>PDF_MAX_CANVAS_PX) dens*=Math.sqrt(PDF_MAX_CANVAS_PX/px);
    let vp=page.getViewport({scale:cssScale*dens});
    let cv=document.createElement('canvas'); cv.width=Math.ceil(vp.width); cv.height=Math.ceil(vp.height);
    let task=page.render({canvasContext:cv.getContext('2d'),viewport:vp}); holder._task=task;
    await task.promise;
    if(stale()){ cv.width=cv.height=0; return; }
    holder.querySelectorAll('canvas,.textLayer,.pdfLink').forEach(x=>x.remove());
    holder.appendChild(cv);
    holder._drawn=true; holder._cssW=cssW; holder._dens=pdfDensity();
    let cssVp=page.getViewport({scale:cssScale});
    renderPdfTextLayer(page,cssVp,holder,book,n);
    renderPdfLinks(page,cssVp,holder,book,onJump);
    renderPdfInkOverlay(book,n,holder,vp); /* the linked notebook's ink, in reading mode too; no-op in Parallel Read panes (guarded inside) */
    if(holder._afterDraw) holder._afterDraw(); /* e.g. Parallel Read puts the page's handwriting over it */
  }catch(e){ /* a page that fails to draw keeps its blank placeholder; the rest still reads */ }
  finally{ if(holder._gen===gen){ holder._drawing=false; holder._task=null; } }
}
function pdfReleasePage(holder){
  holder._gen=(holder._gen||0)+1; holder._drawing=false;
  if(holder._task){ try{ holder._task.cancel(); }catch(e){} holder._task=null; }
  holder.querySelectorAll('canvas').forEach(c=>{ c.width=c.height=0; c.remove(); }); /* zeroing frees the bitmap right away on mobile browsers */
  holder.querySelectorAll('.textLayer,.pdfLink').forEach(x=>x.remove());
  holder._drawn=false;
}
/* draw pages near the visible area, free pages far from it */
function pdfWatch(holders,root,book,isLive,onJump){
  let io=new IntersectionObserver(es=>{ es.forEach(en=>{ let h=en.target; if(en.isIntersecting) pdfDrawPage(book,+h.dataset.n,h,isLive,onJump); else if(h._drawn||h._drawing) pdfReleasePage(h); }); },{root:root||null, rootMargin:'1200px 0px'});
  holders.forEach(h=>io.observe(h));
  return io;
}
/* redraw every page in a container at the current width / density (re-observing makes the observer report the near ones again) */
function pdfRefresh(container,io){
  if(!container || !io) return;
  container.querySelectorAll('.pdfHolder').forEach(h=>{ if(h._drawn||h._drawing) pdfReleasePage(h); io.unobserve(h); io.observe(h); });
}
/* the whole book's text, read in the background, pages are only drawn
   near the screen now, but search should still find text on every page.
   The fill runs a few pages per idle slot (requestIdleCallback, with a
   timeout so it still progresses on a busy page) — the old fixed pace
   read every page straight through at open, so a 500-page PDF spent
   ~2s of CPU at first open and starved the reader on phones. Pages the
   reader actually views fill the cache on demand when they are drawn
   (renderPdfTextLayer), so the current page is searchable right away. */
async function pdfFillTextCache(book,isLive){
  if(!book.textCache) book.textCache={};
  for(let n=1;n<=book.numPages;n++){
    if(!isLive()) return;
    if(book.textCache[n]) continue;
    try{ let tc=await (await book.doc.getPage(n)).getTextContent(); book.textCache[n]=tc.items.map(i=>i.str||'').join(' ').replace(/\s+/g,' ').trim()||(book.ocrPages&&book.ocrPages[n]?book.ocrPages[n].text||'':''); }catch(e){}
    if(n%4===0) await pdfIdleSlot();
  }
  scheduleSave();
}
/* wait for a quiet moment on the main thread before the next batch of
   background work; falls back to a short timer where requestIdleCallback
   is unavailable */
function pdfIdleSlot(){
  return new Promise(r=>{
    if(typeof requestIdleCallback==='function') requestIdleCallback(()=>r(),{timeout:2000});
    else setTimeout(r,100);
  });
}
/* selectable text over a drawn page; positions in CSS pixels from the page's CSS-size viewport */
async function renderPdfTextLayer(page,cssVp,holder,book,pageNum){
  try{
    let tc=await page.getTextContent();
    if(!holder.isConnected) return;
    let layer=document.createElement('div'); layer.className='textLayer'; layer.tabIndex=-1; holder.appendChild(layer);
    let full=''; let pending=[]; /* spans still needing a width measure: one rAF per page, not one per span (~500/page, each forcing layout) */
    tc.items.forEach(item=>{
      if(!item.str) return;
      let tx=pdfjsLib.Util.transform(cssVp.transform,item.transform);
      let fontSize=Math.hypot(tx[2],tx[3]);
      let span=document.createElement('span');
      span.textContent=item.str;
      span.style.left=tx[4]+'px'; span.style.top=(tx[5]-fontSize)+'px'; span.style.fontSize=fontSize+'px';
      span.dataset.pg=pageNum;
      layer.appendChild(span);
      full+=item.str+' ';
      pending.push({span:span, w:item.width*cssVp.scale});
    });
    if(!full.trim()&&book.ocrPages&&book.ocrPages[pageNum]&&book.ocrPages[pageNum].words&&book.ocrPages[pageNum].words.length){let o=book.ocrPages[pageNum];o.words.forEach(w=>{if(!w.t)return;let s=document.createElement('span');s.textContent=w.t;s.style.left=(w.x*cssVp.width)+'px';s.style.top=(w.y*cssVp.height)+'px';s.style.fontSize=Math.max(4,w.h*cssVp.height)+'px';s.dataset.pg=pageNum;s.dataset.ocr='1';layer.appendChild(s);pending.push({span:s, w:w.w*cssVp.width});});full=o.text||o.words.map(w=>w.t).join(' ');} if(pending.length) requestAnimationFrame(()=>{ pending.forEach(q=>{ let ow=q.span.offsetWidth; if(ow>2 && q.w>2) q.span.style.transform='scaleX('+(q.w/ow)+')'; }); }); if(book.textCache) book.textCache[pageNum]=full.trim();
    /* put this page's saved highlights / underlines back, they used to vanish after a reload */
    (book.annotations||[]).forEach(a=>{ if(a.where==='PDF page '+pageNum) (wrapTextAcross(layer,a.text,a.kind||'highlight',a.color,a.opacity,a.id)||wrapTextOnce(layer,a.text,a.kind||'highlight',a.color,a.opacity,a.id)); });
  }catch(e){ /* text layer is best-effort; page image still reads */ }
}
/* Draw the linked annotation notebook's ink on a PDF page in reading mode.
   The ink lives in that notebook (prInkPage) in notebook-page coordinates;
   prInkGeom says where the PDF page sits inside the notebook page, so the
   same transform the Parallel Read panes use (prRenderInk) puts every stroke
   back in the same place, drawn by the editor's own drawStroke(). Without
   this, ink drawn in Annotate was saved but never visible in reading mode. */
function renderPdfInkOverlay(book,num,holder,vp){
 let old=holder.querySelector(':scope>canvas.pdfInk');
 let pg=prInkPage(book,num,false);
 let has=pg&&((pg.ink&&pg.ink.length)||(pg.hi&&pg.hi.length));
 if(!has||holder.closest('.prPane')){ if(old) old.remove(); return; }
 let W=Math.max(1,Math.floor(vp.width)), Hh=Math.max(1,Math.floor(vp.height));
 let cv=old||document.createElement('canvas');
 cv.className='pdfInk'; cv.setAttribute('aria-hidden','true');
 if(cv.width!==W||cv.height!==Hh){ cv.width=W; cv.height=Hh; }
 if(!cv.isConnected) holder.appendChild(cv);
 let x=cv.getContext('2d'); x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,W,Hh);
 let g=prInkGeom(book,num,pg), kx=W/g.dw, ky=Hh/g.dh;
 x.setTransform(kx,0,0,ky,-g.ox*kx,-g.oy*ky); x.lineCap='round'; x.lineJoin='round';
 (pg.hi||[]).forEach(st=>drawStroke(x,st)); (pg.ink||[]).forEach(st=>drawStroke(x,st));
}
async function renderPdfPageInto(num,host,book){
  let page=await book.doc.getPage(num);
  let wrap=document.createElement('div'); wrap.className='pdfPage'; wrap.dataset.page=num;
  let label=document.createElement('div'); label.className='pdfPageNum'; label.textContent='Page '+num+' of '+book.numPages; wrap.appendChild(label);
  let holder=document.createElement('div'); holder.className='pageHolder'; wrap.appendChild(holder);
  let canvas=document.createElement('canvas'); holder.appendChild(canvas); host.appendChild(wrap);
  let base=page.getViewport({scale:1}); let scale=pdfPageWidth()/base.width;
  let dpr=Math.min(window.devicePixelRatio||1,2); let vp=page.getViewport({scale:scale*dpr});
  canvas.width=Math.floor(vp.width); canvas.height=Math.floor(vp.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  renderPdfTextLayer(page,vp,holder,book,num);
  renderPdfLinks(page,vp,holder,book); renderPdfInkOverlay(book,num,holder,vp);
}
/* Follow links from the background PDF: link annotations become clickable
   overlays, web links open in a new tab, internal links jump pages. */
async function renderPdfLinks(page,vp,holder,book){
  try{
    let annos=await page.getAnnotations();
    if(!holder.isConnected) return;
    annos.forEach(a=>{
      if(a.subtype!=='Link' || !a.rect) return;
      let r=pdfjsLib.Util.normalizeRect(a.rect);
      let rect=cssVp.convertToViewportRectangle(r);
      let x=Math.min(rect[0],rect[2]), y=Math.min(rect[1],rect[3]), w=Math.abs(rect[2]-rect[0]), h=Math.abs(rect[3]-rect[1]);
      if(w<2||h<2) return;
      let link=document.createElement('a'); link.className='pdfLink';
      link.style.left=x+'px'; link.style.top=y+'px'; link.style.width=w+'px'; link.style.height=h+'px';
      if(a.url){ link.href=a.url; link.target='_blank'; link.rel='noopener'; link.title=a.url; }
      else if(a.dest){
        link.href='#'; link.title='Go to linked page';
        link.addEventListener('click',async ev=>{
          ev.preventDefault();
          try{ let dest=typeof a.dest==='string'? await book.doc.getDestination(a.dest):a.dest; let idx=await book.doc.getPageIndex(dest[0]); (onJump||jumpToPdfPage)(idx+1); }
          catch(e){ toast('That link has no readable destination'); }
        });
      } else return;
      holder.appendChild(link);
    });
  }catch(e){ /* links are best-effort; the page itself still reads */ }
}
async function renderPdfBook(){
  let b=curBook(); if(!b||b.kind!=='pdf') return;
  let token=++pdfToken; let host=$('pdfPages'); host.innerHTML='';
  if(pdfObserver){ pdfObserver.disconnect(); pdfObserver=null; }
  if(pdfDrawIO){ pdfDrawIO.disconnect(); pdfDrawIO=null; }
  $('pdfName').textContent=b.title||b.fileName;
  $('pdfMeta').textContent=b.numPages+' page'+(b.numPages===1?'':'s')+' • Fit to width • Text is selectable';
  let st=$('pdfStatus'); st.classList.remove('hidden'); st.textContent='Rendering pages…';
  let live=()=> token===pdfToken && curBook()===b && S.view==='reader';
  let sizes; try{ sizes=await pdfPageSizes(b); }catch(e){ if(token===pdfToken) st.textContent='This PDF could not be drawn.'; return; }
  if(token!==pdfToken) return;
  b.page=Math.max(1,Math.min(b.numPages,b.page||1));
  let nums=[]; if(b.mode==='page') nums.push(b.page); else for(let n=1;n<=b.numPages;n++) nums.push(n);
  let holders=pdfBuildPages(host,b,sizes,nums,'pdfPage'); readerZoom=b.readerZoom||1; host.style.width=(readerZoom*100)+'%'; var rzl=$('readerZoomLabel'); if(rzl) rzl.textContent=Math.round(readerZoom*100)+'%';
  st.classList.add('hidden'); st.textContent='';
  pdfLastW=window.innerWidth;
  pdfDrawIO=pdfWatch(holders,null,b,live);
  updateResume(); renderReaderSide();
  if(b.mode!=='page'){
    let target=host.querySelector('.pdfPage[data-page="'+b.page+'"]'); if(target && b.page>1) target.scrollIntoView();
    pdfObserver=new IntersectionObserver(es=>{ es.forEach(en=>{ if(en.isIntersecting && !pdfJump){ b.page=+en.target.dataset.page; updateResume(); } }); },{rootMargin:'-35% 0px -55% 0px'});
    host.querySelectorAll('.pdfPage').forEach(el=>pdfObserver.observe(el));
  }
  pdfFillTextCache(b,live);
}
/* While a jump is scrolling to its page, the page tracker must not record
   the pages it glides past (a save in the middle of the glide used to
   store one of those instead of the page asked for). The guard lifts when
   the scroll ends, or after 1.5s on browsers without 'scrollend'. */
let pdfJump=null;
function pdfJumpGuard(){
  if(pdfJump){ clearTimeout(pdfJump.t); window.removeEventListener('scrollend',pdfJump.done); }
  let g={}; g.done=()=>{ if(pdfJump!==g) return; clearTimeout(g.t); window.removeEventListener('scrollend',g.done); pdfJump=null; };
  g.t=setTimeout(g.done,1500); window.addEventListener('scrollend',g.done);
  pdfJump=g;
}
function jumpToPdfPage(n,instant){
  let b=curBook(); if(!b||b.kind!=='pdf') return; closeReaderCards();
  /* On phone/tablet the Contents panel is a drawer over the pages: close
     it once the jump lands, so the page is actually visible. */
  if(window.matchMedia('(max-width:1024px)').matches) $('readerSide').classList.remove('open');
  b.page=Math.max(1,Math.min(b.numPages,n));
  if(b.mode==='page'){ renderPdfBook(); window.scrollTo({top:0}); }
  else { let el=document.querySelector('.pdfPage[data-page="'+b.page+'"]'); if(el){ pdfJumpGuard(); el.scrollIntoView({behavior: instant? 'auto':smoothOrInstant()}); } updateResume(); }
}
let pdfResizeT=null;
window.addEventListener('resize',()=>{
  if(S.split){ clearTimeout(splitPaneResizeT); splitPaneResizeT=setTimeout(()=>{ syncSplitPaneHeight(); splitRefitCurrentPage(); },100); }
  if(S.view==='editor' && document.activeElement && document.activeElement.className!=='canvasText') renderCanvasTexts();
  let b=curBook(); if(!b||b.kind!=='pdf'||S.view!=='reader'||!pdfDrawIO) return;
  /* a phone's address bar showing / hiding changes only the height: pages keep their size, nothing to redraw */
  if(window.innerWidth===pdfLastW) return;
  pdfLastW=window.innerWidth;
  clearTimeout(pdfResizeT); pdfResizeT=setTimeout(()=>pdfRefresh($('pdfPages'),pdfDrawIO),250);
});
/* browser zoom or moving the window to a screen with different scaling changes the pixel density, redraw so pages stay crisp */
(function watchDensity(){
  let d=window.devicePixelRatio||1;
  try{
    window.matchMedia('(resolution: '+d+'dppx)').addEventListener('change',()=>{
      if(pdfDrawIO && S.view==='reader') pdfRefresh($('pdfPages'),pdfDrawIO);
      if(typeof PR!=='undefined' && PR.on) prRefreshPages();
      watchDensity();
    },{once:true});
  }catch(e){}
})();
/* --- reader sidebar: TOC, bookmarks, annotations, thumbnails --- */
/* Reading progress: the native <progress> under the reader top bar. EPUB counts chapters, PDF counts pages. */ function updateReadProgress(){ let el=$('readProgress'); if(!el) return; let b=curBook(); if(!b){ el.value=0; return; } if(b.kind==='pdf'){ el.value= b.numPages? Math.round((b.page||1)/b.numPages*100):0; } else if(b.kind==='epub'){ let n=(b.chapters||[]).length; el.value= n? Math.round(((b.ch||0)+1)/n*100):0; } else el.value=0; } let thumbIO=null; async function renderReaderSide(){ updateReadProgress(); renderSelColor(); syncReaderToolUI();
  scheduleSave();
  let b=curBook(); let toc=$('tocList'), bm=$('bookmarkList'), an=$('annoList'), th=$('thumbList');
  if(!b){ toc.innerHTML='<p class="kbd">Open a book to see its contents.</p>'; return; }
  bm.innerHTML= b.bookmarks.length? b.bookmarks.map(x=>'<div class="listRow"><span>'+esc(x.label)+'</span><button class="btn small" onclick="jumpBookmark('+x.at+')">Go</button></div>').join('') : '<p class="kbd">No bookmarks yet</p>';
  an.innerHTML= b.annotations.length? b.annotations.map(a=>'<div class="listRow"><span class="annoSwatch" style="background:'+annoSwatch(a)+'"></span><span style="font-size:13px;line-height:1.45">“'+esc(a.text.slice(0,90))+'”<br/><span class="kbd">'+esc(a.where)+(a.kind&&a.kind!=='highlight'?' · '+esc(a.kind):'')+'</span></span></div>').join('')+'<button class="btn small" style="margin-top:8px" onclick="exportAnnotations()">Export annotations</button>' : '<p class="kbd">Select text → Highlight, Underline or Strikethrough</p>';
  if(b.kind==='epub'){
    th.dataset.bookId=b.id;
    toc.innerHTML=b.chapters.map((c,i)=>'<div class="tocItem" onclick="jumpToChapter('+i+')">'+(i+1)+'. '+esc(c.title)+'</div>').join('');
    th.innerHTML=b.chapters.map((c,i)=>'<div class="thumbItem '+(i===b.ch?'active':'')+'" onclick="jumpToChapter('+i+')"><b style="font-size:12px">Ch. '+(i+1)+'</b><br/><span class="kbd">'+esc(c.text.slice(0,70))+'…</span></div>').join('');
  } else {
    if(th.dataset.bookId===b.id){ th.querySelectorAll('.thumbItem').forEach((el,i)=>el.classList.toggle('active',i+1===b.page)); return; }
    th.dataset.bookId=b.id;
    toc.innerHTML='<p class="kbd">Loading outline…</p>'; th.innerHTML='<p class="kbd">Rendering thumbnails…</p>';
    try{ let outline=await b.doc.getOutline();
      if(outline&&outline.length){ toc.innerHTML=''; let walk=(items,depth)=>{ items.forEach(o=>{ let d=document.createElement('div'); d.className='tocItem'; d.style.paddingLeft=(6+depth*14)+'px'; d.textContent=o.title||'Section';
        d.onclick=async()=>{ try{ let dest=typeof o.dest==='string'? await b.doc.getDestination(o.dest):o.dest; let idx=await b.doc.getPageIndex(dest[0]); jumpToPdfPage(idx+1); }catch(e){ toast('That outline entry has no page'); } };
        toc.appendChild(d); if(o.items&&o.items.length) walk(o.items,depth+1); }); }; walk(outline,0); }
      else toc.innerHTML='<p class="kbd">This PDF has no outline.</p>';
    }catch(e){ toc.innerHTML='<p class="kbd">Outline unavailable.</p>'; }
    th.innerHTML='';
    /* Thumbnails are LAZY now. Rendering every page up front (one 130px
       render per page, sequential, ~15ms each) kept the reader busy for
       ~30s on a 2,000-page PDF and retained ~176 MB of bitmaps — and on
       image-heavy PDFs it starved the first page's own draw, so a
       151 MB scanned book took 12s to show page 1. Rows are built
       cheaply; each page's picture renders only when its row scrolls
       near, and is freed again when it scrolls far away. */
    if(thumbIO){ thumbIO.disconnect(); thumbIO=null; }
    /* A fast scroll through the list fires the observer for hundreds of
       rows at once. Without a cap, hundreds of renders queue on the pdf.js
       worker and each inserts its bitmap even after its row scrolled far
       away — one probe scroll retained 522 bitmaps and starved a jump to
       page 1500 past its 20s timeout. So: at most 6 renders in flight,
       the rest wait in a set, and a finished render is only inserted while
       its row is still near the viewport; a stale one is dropped and its
       row re-renders when it next scrolls near. */
    let thumbInFlight=0; const thumbPending=new Set();
    const thumbNear=(item)=>{ let r=item.getBoundingClientRect(); return r.bottom>=-600 && r.top<=innerHeight+600; };
    function pumpThumb(){ if(thumbInFlight>=6) return; for(let it of thumbPending){ thumbPending.delete(it);
      if(th.dataset.bookId!==b.id || curBook()!==b || it._thumbDone) continue;
      if(!thumbNear(it)) continue; renderThumb(it,+it.dataset.n); if(thumbInFlight>=6) break; } }
    let renderThumb=async(item,n)=>{
      if(th.dataset.bookId!==b.id || curBook()!==b || item._thumbDone) return;
      if(thumbInFlight>=6){ thumbPending.add(item); return; }
      item._thumbDone=true; thumbInFlight++;
      try{ let pg=await b.doc.getPage(n); if(th.dataset.bookId!==b.id || curBook()!==b) return;
        let v0=pg.getViewport({scale:1}); let vp=pg.getViewport({scale:130/v0.width});
        let cv=document.createElement('canvas'); cv.width=Math.ceil(vp.width); cv.height=Math.ceil(vp.height);
        await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        if(!item.isConnected || th.dataset.bookId!==b.id) { item._thumbDone=false; return; }
        if(!thumbNear(item)){ item._thumbDone=false; return; } /* row scrolled away while rendering */
        item.insertBefore(cv,item.firstChild);
      }catch(e){ item._thumbDone=false; }
      finally{ thumbInFlight--; pumpThumb(); }
    };
    thumbIO=new IntersectionObserver(es=>{ es.forEach(en=>{ let item=en.target, n=+item.dataset.n;
      if(en.isIntersecting){ if(!item.querySelector('canvas')) renderThumb(item,n); }
      else { thumbPending.delete(item); let cv=item.querySelector('canvas'); if(cv){ cv.width=cv.height=0; cv.remove(); item._thumbDone=false; } }
    }); },{rootMargin:'600px 0px'});
    for(let n=1;n<=b.numPages;n++){
      let item=document.createElement('div'); item.className='thumbItem'+(n===b.page?' active':''); item.dataset.n=n; item.innerHTML='<span class="kbd">Page '+n+'</span>';
      /* Reserve the thumb's height up front: the canvas is display:block
         at the column width, so a row grows ~110-140px when its picture
         lands. Rows above the scroll target growing shoved the target
         itself out of view (and out of the observer's margin) before its
         own render finished, so far rows never got a picture. The reserve
         is the page's aspect at a 100px column plus the label/padding. */
      let sz=(b._pageSizes&&b._pageSizes[n-1])||[612,792];
      item.style.minHeight=Math.ceil(100*sz[1]/sz[0])+28+'px';
      item.onclick=()=>jumpToPdfPage(n); th.appendChild(item); thumbIO.observe(item);
    }
    return;
  }
}
function jumpBookmark(at){ let b=curBook(); if(!b) return; if(b.kind==='pdf') jumpToPdfPage(at); else jumpToChapter(at); }
function syncBookmarkBtn(){
  let b=curBook(), btn=$('bookmarkBtn'); if(!b||!btn) return;
  let at= b.kind==='pdf'? b.page : b.ch;
  let on=(b.bookmarks||[]).some(x=>x.at===at);
  btn.classList.toggle('marked',on); btn.setAttribute('aria-pressed',String(on));
}
function toggleBookmark(){
  let b=curBook(); if(!b){ toast('Open a book first'); return; }
  let at= b.kind==='pdf'? b.page : b.ch;
  let label= b.kind==='pdf'? 'Page '+at : 'Chapter '+(at+1)+' · '+b.chapters[at].title;
  if(b.bookmarks.some(x=>x.at===at)){ b.bookmarks=b.bookmarks.filter(x=>x.at!==at); toast('Bookmark removed'); }
  else { b.bookmarks.push({at:at,label:label}); toast('Bookmarked: '+label); }
  syncBookmarkBtn();
  renderReaderSide();
  /* P7: open the Bookmarks panel so the new bookmark is actually
     visible, it used to land inside a collapsed <details>. */
  let bd=$('bookmarkDetails'); if(bd) bd.open=true;
}
function changePage(d){
  let b=curBook(); if(!b){ toast('Open a book first'); return; }
  if(b.kind==='pdf') jumpToPdfPage(b.page+d);
  else jumpToChapter(b.ch+d);
}

/* --- highlights & annotations --- */
/* wrap a selected range in a highlight / underline / strikethrough, shared by the reader and Parallel Read */
/* One wrapper element for a mark of the given kind. */
function wrapMarkEl(kind, color, opacity, annoId){
  let el;
  if(kind==='underline'){ el=document.createElement('span'); el.style.cssText='text-decoration:underline;text-decoration-color:'+hexA(color||'#2456c8', opacity==null?1:opacity)+';text-decoration-thickness:2px'; }
  else if(kind==='strike'){ el=document.createElement('span'); el.style.cssText='text-decoration:line-through;text-decoration-color:'+hexA(color||'#b23a2e', opacity==null?1:opacity)+';text-decoration-thickness:2px'; }
  else { el=document.createElement('mark'); if(color) el.style.backgroundColor=hexA(color, opacity==null?1:opacity); }
  el.setAttribute('data-hl','1'); if (annoId) el.dataset.annoId = annoId;
  return el;
}
/* Wrap a range in marks, one per text node it touches. A range across
   several absolutely-positioned PDF spans cannot be surroundContents'd as
   one (it throws), and the extractContents fallback drops a single mark
   at the layer origin, leaves empty spans behind, and that malformed mark
   then breaks mouse selection in the whole layer: every mousedown puts
   the caret at offset 0 of the first node and no drag ever extends it
   (probe diag5b12 — removing the mark restores selection at once).
   Wrapping each node's own portion keeps every span intact and each mark
   sitting exactly over its own text. Returns the first mark made, or null. */
function wrapRangePerNode(range,kind,color,opacity,annoId){
  let sc=range.startContainer, so=range.startOffset, ec=range.endContainer, eo=range.endOffset;
  if(sc===ec && sc.nodeType===3){
    let el=wrapMarkEl(kind,color,opacity, annoId), r=document.createRange(); r.setStart(sc,so); r.setEnd(ec,eo);
    try{ r.surroundContents(el); }catch(e){ let frag=r.extractContents(); el.appendChild(frag); r.insertNode(el); }
    return el;
  }
  let root=range.commonAncestorContainer;
  let walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=> range.intersectsNode(n)? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT});
  let parts=[], nd;
  while((nd=walker.nextNode())){
    let s= nd===sc? so : 0, e= nd===ec? eo : nd.nodeValue.length;
    if(e>s) parts.push({node:nd, s:s, e:e});
  }
  let first=null;
  parts.forEach(p=>{
    let el=wrapMarkEl(kind,color,opacity, annoId), r=document.createRange(); r.setStart(p.node,p.s); r.setEnd(p.node,p.e);
    try{ r.surroundContents(el); }catch(e){ let frag=r.extractContents(); el.appendChild(frag); r.insertNode(el); }
    if(!first) first=el;
  });
  return first;
}
function wrapRangeAsMark(range,kind,color,opacity,annoId){
  let el=wrapRangePerNode(range,kind,color,opacity,annoId);
  if(!el) throw new Error('nothing to wrap');
  return el;
}
/* A tap on a toolbar button collapses the live selection on a phone, so by
   the time Highlight / Listen runs there is nothing to act on.
   Keep the last real selection made inside the reader (or a Parallel Read
   pane) and hand it back when the live one is gone. */
let lastReaderSel=null;
document.addEventListener('selectionchange',()=>{
  let sel=window.getSelection(); if(!sel||!sel.rangeCount||sel.isCollapsed) return;
  let text=sel.toString().trim(); if(!text) return;
  let node=sel.getRangeAt(0).commonAncestorContainer, el=node.nodeType===1? node : node.parentElement;
  if(!el||!el.closest||!el.closest('#readerBody, #pdfPages, .prPane')) return;
  try{ lastReaderSel={range:sel.getRangeAt(0).cloneRange(), text:text}; }catch(e){}
});
function readerSelection(){
  let sel=window.getSelection();
  if(sel&&sel.rangeCount&&!sel.isCollapsed&&sel.toString().trim()) return sel;
  if(lastReaderSel&&lastReaderSel.range){
    try{
      let node=lastReaderSel.range.commonAncestorContainer;
      if(node&&(node.isConnected===undefined||node.isConnected)){ sel.removeAllRanges(); sel.addRange(lastReaderSel.range.cloneRange()); return sel; }
    }catch(e){}
  }
  return sel;
}
/* The reader sheet is a modal <dialog>: while it is open the page behind it
   is inert, and a range in an inert subtree cannot be selected — so a
   Highlight / Listen tap inside the sheet finds no text, even
   though the stored selection is intact (probe diag5b2). Close the sheet
   first, then run the action on the next frame, when the page is readable
   again and the stored selection restores. */
function readerSheetAction(fn){
  let d=$('readerSheet'); if(d && d.open) d.close();
  readerHideSelBar();
  requestAnimationFrame(()=>{ try{ fn(); }catch(e){} });
}
/* The floating text-tools bar over a selection in the normal reader — the
   compact menu (Play Books / Kindle / MarginNote model): it is a plain
   positioned div, not a modal dialog, so the page stays live and the
   selection is still there when a tool is tapped. Its buttons preventDefault
   on pointerdown so the tap itself does not collapse the selection, the
   same trick the Parallel Read bar already uses. */
function readerSelInfo(){
  if(PR.on || S.view!=='reader') return null;
  let sel=window.getSelection(); if(!sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) return null;
  let r=sel.getRangeAt(0), node=r.commonAncestorContainer, el=node.nodeType===1? node : node.parentElement;
  if(!el||!el.closest||!el.closest('#readerBody, #pdfPages')) return null;
  let rect=r.getBoundingClientRect(); if(!rect.width && !rect.height){ let rs=r.getClientRects(); if(!rs.length) return null; rect=rs[0]; }
  return {rect:rect};
}
function readerShowSelBar(){
  let bar=$('readerSelBar'); if(!bar) return;
  let info=readerSelInfo(); if(!info){ readerHideSelBar(); return; }
  bar.classList.remove('hidden'); renderSelColor();
  let su=$('readerSelUndo'); if(su){ let cb=curBook(); su.disabled=!(cb&&cb.annotations&&cb.annotations.length); }
  let bw=bar.offsetWidth, bh=bar.offsetHeight, r=info.rect, coarse=window.matchMedia && matchMedia('(pointer:coarse)').matches;
  let x=Math.max(8,Math.min(window.innerWidth-bw-8, r.left+r.width/2-bw/2));
  /* above the selection with a mouse; below it on touch screens, clear of the phone's own copy / paste menu */
  let y= coarse? r.bottom+10 : r.top-bh-8;
  if(y<8) y=r.bottom+8;
  if(y+bh>window.innerHeight-8) y=Math.max(8,r.top-bh-8);
  bar.style.left=Math.round(x)+'px'; bar.style.top=Math.round(y)+'px';
}
function readerHideSelBar(){ let b=$('readerSelBar'); if(b) b.classList.add('hidden'); hideSelColorPop(); }
/* Touch-safe bar taps (Item A). The bar buttons preventDefault on
   pointerdown so the tap does not collapse the selection — but on a phone
   that tap may never produce a click (the compatibility click is
   suppressed, or the tap is consumed dismissing the touch selection), so
   a tap there did nothing at all while the same tap worked with a
   mouse. Fire touch/pen taps on pointerup and mouse/keyboard taps on
   click; the 250ms same-action guard stops a double fire if a browser
   ever delivers both for one tap. barTapOk ignores a pointerup after the
   finger slid off the button. */
let _barActAt=0, _barActKind='';
function barTapOk(ev){ let b=ev.currentTarget; if(!b) return false; let r=b.getBoundingClientRect(); return ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom; }
function barAct(ev, act, bar){
  if(ev.type==='pointerup'){ if(ev.pointerType==='mouse') return; if(!barTapOk(ev)) return; }
  let now=Date.now();
  if(act===_barActKind && now-_barActAt<250) return;
  _barActAt=now; _barActKind=act;
  if(act==='highlight') annotateSelection('highlight');
  else if(act==='underline') annotateSelection('underline');
  else if(act==='strike') annotateSelection('strike');
  else if(act==='color') toggleSelColorPop(bar);
  else if(act==='undo') undoLastAnnotation();
}
/* Mark colour + intensity (Item B). A mark stores the colour and opacity
   it was made with, so it re-renders the same after reload; a book
   remembers the last choice (markColor/markOpacity) for the next mark.
   No colour chosen means the old default look (palette-yellow highlight,
   blue underline, red strikethrough), so marks made before this change
   render exactly as they did. */
const MARK_COLORS=[{label:'Default',value:''},{label:'Yellow',value:'#FFE600'},{label:'Orange',value:'#FF9F0A'},{label:'Pink',value:'#FF6482'},{label:'Green',value:'#30D158'},{label:'Blue',value:'#0A84FF'},{label:'Purple',value:'#BF5AF2'}];
const MARK_COLOR_DEFAULT='conic-gradient(#FFE600,#FF9F0A,#FF6482,#BF5AF2,#0A84FF,#30D158,#FFE600)';
function hexA(hex,a){ if(!hex) return ''; let h=hex.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); let n=parseInt(h,16); if(isNaN(n)) return hex; return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+(a==null?1:a)+')'; }
/* Per-tool mark settings (reference video r04/r06/r07): Highlight,
   Underline and Strikethrough each remember their OWN colour + opacity,
   so switching tools switches to that tool's last-used colour. Old books
   only have the one shared markColor/markOpacity — those are the fallback
   for any tool without its own settings yet, so nothing already saved
   changes. Fresh tools start at 60% intensity, not 100%: the old 100%
   default is what made the first highlight in the user's video (f05/f08)
   come out as a solid block the text could not be read through. */
const MARK_TOOL_DEFAULTS={highlight:{color:'#FFE600',opacity:0.6},underline:{color:'#2456c8',opacity:0.6},strike:{color:'#b23a2e',opacity:0.6}};
const MARK_TOOL_NAMES={highlight:'Highlight',underline:'Underline',strike:'Strikeout'};
function toolSettings(b,kind){ if(!b.markSettings) b.markSettings={}; if(!b.markSettings[kind]) b.markSettings[kind]={}; return b.markSettings[kind]; }
function markSettingsFor(b,kind){
  let d=MARK_TOOL_DEFAULTS[kind]||MARK_TOOL_DEFAULTS.highlight;
  let st=b&&b.markSettings&&b.markSettings[kind];
  let color=(st&&st.color)? st.color : (b&&b.markColor? b.markColor : d.color);
  let op=(st&&typeof st.opacity==='number')? st.opacity : (b&&typeof b.markOpacity==='number'? b.markOpacity : d.opacity);
  return {color:color, opacity:Math.min(1,Math.max(0.25,op))};
}
function markColorFor(b,kind){ return markSettingsFor(b,kind).color; }
function markOpacityFor(b,kind){ return markSettingsFor(b,kind).opacity; }
function annoSwatch(a){ let c=a&&a.color? a.color : (a&&a.kind==='underline'?'#2456c8':a&&a.kind==='strike'?'#b23a2e':'#FFE600'); return hexA(c, a&&a.opacity!=null? a.opacity : 1); }
let _selColorFrom='reader';
function selColorBook(){ return _selColorFrom==='pr'&&PR.panes[PR.active] ? PR.panes[PR.active].book : curBook(); }
function selColorDotsHTML(){ return MARK_COLORS.map(c=>'<button type="button" class="selDot'+(c.value?'':' selDotDefault')+'" data-color="'+c.value+'" style="--dot:'+(c.value||'#E8E4DA')+'" aria-label="'+c.label+'" title="'+c.label+'" onpointerdown="event.preventDefault()" onpointerup="selDotAct(event,\''+c.value+'\')" onclick="selDotAct(event,\''+c.value+'\')"><span></span></button>').join(''); }
function bookForSelEl(el){ let h=el.closest? el.closest('[data-selcolor-for]') : null; return h&&h.dataset.selcolorFor==='pop' ? selColorBook() : curBook(); }
function renderSelColor(){
  document.querySelectorAll('.selDots').forEach(w=>{
    if(!w.children.length) w.innerHTML=selColorDotsHTML();
    let b=bookForSelEl(w); if(!b) return;
    let col=b.markColor||'';
    w.querySelectorAll('.selDot').forEach(d=>{ let on=d.dataset.color===col; d.classList.toggle('sel',on); d.setAttribute('aria-pressed',on?'true':'false'); });
  });
  document.querySelectorAll('.selSlider').forEach(s=>{
    let b=bookForSelEl(s); if(!b) return;
    let op=markOpacityFor(b); s.value=op; let v=s.parentElement.querySelector('.selSliderVal'); if(v) v.textContent=Math.round(op*100)+'%';
  });
  let rb=$('readerSelBar')&&$('readerSelBar').querySelector('.selColorDot'), pb=$('prSelBar')&&$('prSelBar').querySelector('.selColorDot');
  if(rb){ let cb=curBook(); rb.style.background=cb&&cb.markColor? hexA(cb.markColor,markOpacityFor(cb)) : MARK_COLOR_DEFAULT; }
  if(pb){ let pbn=PR.panes[PR.active]? PR.panes[PR.active].book : null; pb.style.background=pbn&&pbn.markColor? hexA(pbn.markColor,markOpacityFor(pbn)) : MARK_COLOR_DEFAULT; } let fd=$('readerFabDot'), cb=curBook(); if(fd){ let s2=cb? markSettingsFor(cb, readerActiveTool||_lastReaderTool||'highlight') : null; fd.style.background=s2? hexA(s2.color,s2.opacity) : MARK_COLOR_DEFAULT; }
}
function selColorSet(color){ let b=selColorBook(); if(!b) return; b.markColor=color||null; scheduleSave(); renderSelColor(); }
function selColorSetOpacity(v){ let b=selColorBook(); if(!b) return; b.markOpacity=Math.min(1,Math.max(0.25,+v||1)); scheduleSave(); renderSelColor(); }
function hideSelColorPop(){ let p=$('selColorPop'); if(p) p.classList.add('hidden'); }
function toggleSelColorPop(bar){
  let p=$('selColorPop'); if(!p) return;
  _selColorFrom=bar||'reader'; renderSelColor();
  if(!p.classList.contains('hidden')){ hideSelColorPop(); return; }
  let barEl=$(bar==='pr'?'prSelBar':'readerSelBar');
  if(!barEl) return;
  let r=barEl.getBoundingClientRect();
  p.classList.remove('hidden');
  let pw=p.offsetWidth, ph=p.offsetHeight;
  let x=Math.max(8,Math.min(window.innerWidth-pw-8, r.left+r.width/2-pw/2));
  let y=r.top-ph-8; if(y<8) y=Math.min(window.innerHeight-ph-8, r.bottom+8);
  p.style.left=x+'px'; p.style.top=y+'px';
}
let _selDotAt=0, _selDotColor='';
function selDotAct(ev, color){
  if(ev.type==='pointerup'){ if(ev.pointerType==='mouse') return; if(!barTapOk(ev)) return; }
  let now=Date.now();
  if(color===_selDotColor && now-_selDotAt<250) return;
  _selDotAt=now; _selDotColor=color;
  let host=ev.currentTarget.closest('[data-selcolor-for]');
  if(host&&host.dataset.selcolorFor==='sheet') _selColorFrom='reader';
  selColorSet(color);
}
document.addEventListener('click',e=>{ let pop=$('selColorPop'); if(pop&&!pop.classList.contains('hidden')&&e.target&&!e.target.closest('#selColorPop')&&!e.target.closest('.selColorBtn')) hideSelColorPop(); });
document.addEventListener('input',e=>{ if(e.target&&e.target.classList&&e.target.classList.contains('selSlider')){ let host=e.target.closest('[data-selcolor-for]'); if(host&&host.dataset.selcolorFor==='sheet') _selColorFrom='reader'; selColorSetOpacity(e.target.value); } });
let readerSelT=null;
/* Long-press fix: Android Chrome fires contextmenu on a touch long-press,
   popping the native copy/paste menu over our own selection bar. Suppress
   it on reader prose (touch only, so desktop right-click keeps its menu);
   inputs keep their menu so paste still works. */
document.addEventListener('contextmenu',e=>{
  if(!window.matchMedia('(pointer:coarse)').matches) return;
  if(!e.target.closest || !e.target.closest('#readerArticle, #pdfView, #parallelRead')) return;
  if(e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  e.preventDefault();
});
/* Touch-to-Search (Chrome Android): a long-press on selectable text pops
   Google's "Tap to see search results" bar over the reader (user video
   f12). contextmenu prevention + -webkit-touch-callout do NOT stop it —
   per developer.chrome.com/blog/tap-to-search Chrome skips the bar for
   text it sees as interactive: focusable, or with a click handler that
   preventDefaults / touches the DOM. The text layer is neither, so mark
   each layer focusable (tabindex -1 above: focusable, never in the tab
   order) and swallow clicks inside it. Selection itself is untouched;
   link annotations live in the annotation layer, not the text layer, so
   they keep working. NOTE: desktop Chrome has no Touch-to-Search, so
   this can only be confirmed on a real Android phone. */
document.addEventListener('click',e=>{
  let t=e.target; if(!t||!t.closest) return;
  if(t.closest('a,button,input,select,textarea,[contenteditable="true"]')) return;
  if(!t.closest('#pdfView .textLayer, .prPane .textLayer')) return;
  e.preventDefault();
},true);
document.addEventListener('selectionchange',()=>{ if(PR.on || S.view!=='reader') return; clearTimeout(readerSelT); if(readerActiveTool){ readerHideSelBar(); scheduleAutoReaderMark(); return; } readerSelT=setTimeout(readerShowSelBar,120); });
/* a scroll moves the passage away from the bar — hide it rather than leave it floating over the wrong text */
['pdfView','readerBody'].forEach(id=>{ let el=$(id); if(el) el.addEventListener('scroll',()=>{ let b=$('readerSelBar'); if(b && !b.classList.contains('hidden')) readerHideSelBar(); },{passive:true}); });
window.addEventListener('scroll',()=>{ let b=$('readerSelBar'); if(b && !b.classList.contains('hidden')) readerHideSelBar(); },{passive:true});
function annotateSelection(kind){
  let b=curBook(); if(!b){ toast('Open a book first'); return; }
  if(PR.on){ prAnnotateSelection(kind); return; } /* Parallel Read: the mark goes to whichever book the text was selected in */
  let sel=readerSelection(); let text=sel.toString().trim();
  if(!text){ toast('Select some text in the book first'); return; }
  let where=''; const annoId = 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  try{
    let range=sel.getRangeAt(0);
    let node=range.commonAncestorContainer.nodeType===1? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    let holder=node.closest? node.closest('.pdfPage') : null;
    let chEl=node.closest? node.closest('[data-ch]') : null;
    if(b.kind==='pdf') where='PDF page '+(holder? holder.dataset.page : b.page);
    else where='Chapter '+( (chEl? +chEl.dataset.ch : b.ch) +1)+' · '+b.chapters[chEl? +chEl.dataset.ch : b.ch].title;
    let wrapEl=wrapRangePerNode(range,kind,markColorFor(b,kind),markOpacityFor(b,kind),annoId);
    if(!wrapEl) throw new Error('nothing to wrap');
  }catch(e){ toast('Select a clean stretch inside one paragraph'); return; }
  b.annotations.push({id:annoId, text:text, where:where, kind:kind, color:markColorFor(b,kind), opacity:markOpacityFor(b,kind)});
  sel.removeAllRanges();
  renderReaderSide(); renderLibrary(); scheduleSave(); syncReaderToolUI();;
  /* P7: open the Annotations panel so the new entry is visible. */
  let ad=$('annoDetails'); if(ad) ad.open=true;
  toast((kind==='highlight'?'Highlighted': kind==='underline'?'Underlined':'Struck through')+' & saved to annotations');
}
function highlightSelection(){ annotateSelection('highlight'); }
function underlineSelection(){ annotateSelection('underline'); }
/* Undo fallback: a mark whose spans cannot be found by id (legacy marks
   saved before r21 carry no id) is removed by repainting its page or
   chapter from the annotation list, which no longer holds it. Only the
   text-layer wrappers are stripped and re-applied — the same wrap the
   layer does when it is first drawn — so the PDF canvas is untouched.
   Each repaint returns 'removed' (spans were on screen and are gone),
   'absent' (the page/chapter is not in the DOM, so the mark is not
   visible), or 'kept' (repainted, but the mark is still there). */
function unwrapMarkSpans(root){
  root.querySelectorAll('[data-hl]').forEach(el=>{
    let p=el.parentNode;
    while(el.firstChild) p.insertBefore(el.firstChild,el);
    p.removeChild(el);
  });
  root.normalize();
}
function repaintPdfLayerMarks(layer,b,pageNum){
  let before=layer.querySelectorAll('[data-hl]').length;
  if(!before) return 'absent';
  unwrapMarkSpans(layer);
  (b.annotations||[]).forEach(a=>{
    if(a.where==='PDF page '+pageNum)
      (wrapTextAcross(layer,a.text,a.kind||'highlight',a.color,a.opacity,a.id)||wrapTextOnce(layer,a.text,a.kind||'highlight',a.color,a.opacity,a.id));
  });
  return layer.querySelectorAll('[data-hl]').length<before ? 'removed' : 'kept';
}
function repaintPdfMarksForUndo(b,pageNum){
  let out='absent';
  document.querySelectorAll('#pdfPages .pdfPage[data-page="'+pageNum+'"] .textLayer').forEach(layer=>{
    let r=repaintPdfLayerMarks(layer,b,pageNum);
    if(r==='removed') out='removed'; else if(r==='kept') out='kept';
  });
  if(PR.on){ ['L','R'].forEach(s=>{
    let P=PR.panes[s]; if(!P||P.book!==b||!P.el) return;
    let pg=P.el.querySelector('.pdfPage[data-page="'+pageNum+'"]');
    let layer=pg&&pg.querySelector('.textLayer'); if(!layer) return;
    let r=repaintPdfLayerMarks(layer,b,pageNum);
    if(r==='removed') out='removed'; else if(r==='kept') out='kept';
  }); }
  return out;
}
function repaintEpubMarksForUndo(b,chapterIdx){
  let container = b.mode==='page'
    ? (chapterIdx===b.ch ? $('readerBody') : null)
    : document.querySelector('[data-ch="'+chapterIdx+'"]');
  if(!container) return 'absent';
  let before=container.querySelectorAll('[data-hl]').length;
  if(!before) return 'absent';
  unwrapMarkSpans(container);
  reapplyAnnotations();
  return container.querySelectorAll('[data-hl]').length<before ? 'removed' : 'kept';
}
function undoLastAnnotation(){
  let b=curBook();
  if(!b||!b.annotations||!b.annotations.length){ toast('Nothing to undo'); return; }
  let last=b.annotations.pop();
  let unwrapped=0;
  if(last&&last.id){
    document.querySelectorAll('[data-hl][data-anno-id="'+last.id+'"]').forEach(el=>{
      unwrapped++;
      let p=el.parentNode;
      while(el.firstChild) p.insertBefore(el.firstChild,el);
      p.removeChild(el); p.normalize();
    });
  }
  let gone = last&&last.id
    ? document.querySelectorAll('[data-hl][data-anno-id="'+last.id+'"]').length===0
    : true; /* no id to match: only the repaint below can clear the mark */
  if(!unwrapped){
    /* Legacy mark, or a mark whose spans were never drawn: repaint its
       page or chapter from the list, which no longer holds it. */
    try{
      let res='absent';
      if(b.kind==='pdf'){
        let m=/PDF page\s+(\d+)/.exec(last&&last.where||'');
        res=repaintPdfMarksForUndo(b, m? +m[1] : (b.page||1));
      } else {
        let m=/Chapter\s+(\d+)/.exec(last&&last.where||'');
        res=repaintEpubMarksForUndo(b, m? (+m[1]-1) : (b.ch||0));
      }
      if(last&&last.id) gone=document.querySelectorAll('[data-hl][data-anno-id="'+last.id+'"]').length===0;
      else gone=(res!=='kept');
    }catch(e){ gone=false; }
  }
  renderReaderSide(); renderLibrary(); syncReaderToolUI(); scheduleSave();
  toast(gone?'Undid last annotation':'Undo didn’t clear that mark — reopen the book to clear it');
}
let readerActiveTool='', readerPointerDown=false, readerAutoMarkT=null, _lastReaderTool='highlight', _armedHintShown={};
/* Xiaomi Focus Pen in the reader: dragging the pen across text selects
   it instead of scrolling the page, and a palm landing mid-selection
   neither scrolls nor collapses the selection. The browser's native
   pen-drag selection is not reliable here because #pdfView declares
   touch-action pan-x pan-y (needed for finger scrolling), so the
   selection is built in JS: anchor on pen pointerdown with
   caretRangeFromPoint, extend on pen pointermove, apply on pointerup
   through the same auto-mark timer as a touch selection. While the pen
   selection is active, the two scroll containers get touch-action none
   (their previous value is restored on lift) so the browser never
   hijacks the drag as a scroll. Pen long-press: the pen pointerdown is
   preventDefaulted, and the coarse-gated contextmenu prevention above
   already covers the reader. */
let penSel=null;
function penSelTarget(e){
  if(S.view!=='reader' || PR.on) return null;
  let t=e.target; if(!t || !t.closest) return null;
  if(t.closest('a,button,input,select,textarea,[contenteditable="true"]')) return null;
  if(t.closest('#pdfView .textLayer')) return 'pdf';
  if(t.closest('#readerArticle')) return 'epub';
  return null;
}
function penSelStart(e){
  if(!penSelTarget(e)) return false;
  if(!document.caretRangeFromPoint) return false;
  let r=document.caretRangeFromPoint(e.clientX,e.clientY); if(!r) return false;
  e.preventDefault();
  let sel=getSelection(); sel.removeAllRanges(); sel.addRange(r);
  let pv=$('pdfView'), rb=$('readerBody');
  penSel={moved:false, savedTA:{pv:pv?pv.style.touchAction:'', rb:rb?rb.style.touchAction:''}};
  if(pv) pv.style.touchAction='none'; if(rb) rb.style.touchAction='none';
  return true;
}
function penSelMove(e){
  if(!penSel || e.pointerType!=='pen' || !(e.buttons&1)) return;
  e.preventDefault();
  if(!document.caretRangeFromPoint) return;
  let r=document.caretRangeFromPoint(e.clientX,e.clientY); if(!r) return;
  let sel=getSelection(); if(!sel.rangeCount) return;
  try{ sel.extend(r.startContainer,r.startOffset); penSel.moved=true; }catch(_){}
}
function penSelEnd(){
  if(!penSel) return;
  let pv=$('pdfView'), rb=$('readerBody');
  if(pv) pv.style.touchAction=penSel.savedTA.pv; if(rb) rb.style.touchAction=penSel.savedTA.rb;
  if(!penSel.moved){ let sel=getSelection(); sel.removeAllRanges(); } /* a pen tap is not a selection */
  penSel=null;
}
document.addEventListener('pointerdown',e=>{
  if(e.pointerType==='pen'){ if(penSelStart(e)) return; }
  else if(e.pointerType==='touch' && penSel){ e.preventDefault(); e.stopImmediatePropagation(); } /* palm during a pen selection: no scroll, no collapse, no panel close */
},true);
document.addEventListener('pointermove',e=>{ if(penSel) penSelMove(e); },true);
document.addEventListener('pointerup',e=>{ if(e.pointerType==='pen') penSelEnd(); },true);
document.addEventListener('pointercancel',e=>{ if(e.pointerType==='pen') penSelEnd(); },true);
function toggleReaderToolPanel(forceOpen){ let p=$('readerToolPanel'); if(!p) return; let show=typeof forceOpen==='boolean'? forceOpen : p.classList.contains('hidden'); p.classList.toggle('hidden',!show); let fab=$('readerToolFab'); if(fab) fab.setAttribute('aria-expanded',show?'true':'false'); syncReaderToolUI(); }
function toggleReaderTool(tool){
  readerActiveTool=(readerActiveTool===tool)?'':tool;
  if(!readerActiveTool) clearTimeout(readerAutoMarkT);
  else{
    _lastReaderTool=tool;
    toggleReaderToolPanel(false); /* armed: get the panel out of the way so the page is clear to drag over */
    if(!_armedHintShown[tool]){ _armedHintShown[tool]=true; toast('Drag over text to '+(tool==='highlight'?'highlight':tool==='underline'?'underline':'strikethrough')); }
  }
  syncReaderToolUI();
}
function syncReaderToolUI(){
  let b=curBook();
  let fab=$('readerToolFab')||$('readerFab');
  if(fab){ fab.classList.toggle('armed',!!readerActiveTool); fab.classList.toggle('active',!!readerActiveTool); fab.dataset.tool=readerActiveTool||''; }
  document.querySelectorAll('[data-rtool], #readerToolPanel [data-tool]').forEach(btn=>{ let t=btn.dataset.rtool||btn.dataset.tool; let on=t===readerActiveTool; btn.classList.toggle('active',on); btn.setAttribute('aria-pressed',on?'true':'false'); });
  /* each tool row shows its own colour + opacity; the FAB dot shows the armed tool's (or the last-used tool's) */
  if(b){
    let cur=markSettingsFor(b, readerActiveTool||_lastReaderTool||'highlight');
    let fd=$('readerFabDot'); if(fd) fd.style.background=hexA(cur.color,cur.opacity);
    document.querySelectorAll('#readerToolPanel [data-swatch]').forEach(sw=>{ let s=markSettingsFor(b, sw.dataset.swatch); sw.style.setProperty('--sw', hexA(s.color,s.opacity)); });
  }
  let hasMarks=!!(b&&b.annotations&&b.annotations.length);
  let ub=$('readerUndoBtn'); if(ub) ub.disabled=!hasMarks;
  let tu=$('readerTopUndo'); if(tu) tu.disabled=!hasMarks;
  let su=$('readerSelUndo'); if(su) su.disabled=!hasMarks;
  let qu=$('readerQuickUndo'); if(qu) qu.classList.toggle('hidden',!hasMarks);
}
function scheduleAutoReaderMark(){ clearTimeout(readerAutoMarkT); if(!readerActiveTool||readerPointerDown||PR.on||S.view!=='reader') return; readerAutoMarkT=setTimeout(()=>{ if(!readerActiveTool||readerPointerDown||PR.on||S.view!=='reader') return; let sel=readerSelection(); if(sel&&sel.toString().trim()) annotateSelection(readerActiveTool); },500); }
document.addEventListener('pointerdown',e=>{ if(penSel && e.pointerType==='touch') return; /* palm during a pen selection */ readerPointerDown=true; clearTimeout(readerAutoMarkT); let p=$('readerToolPanel'); if(p&&!p.classList.contains('hidden')&&!e.target.closest('#readerToolPanel')&&!e.target.closest('#readerToolFab')&&!e.target.closest('#readerFab')) toggleReaderToolPanel(false); },true);
document.addEventListener('pointerup',e=>{ if(penSel && e.pointerType==='touch') return; /* palm lifting must not end the pen's selection early */ readerPointerDown=false; if(readerActiveTool&&!PR.on&&S.view==='reader') scheduleAutoReaderMark(); },true);
document.addEventListener('pointercancel',e=>{ if(penSel && e.pointerType==='touch') return; readerPointerDown=false; },true);
/* --- "<Tool> color" bottom sheet (reference video r06: colour grid + Opacity slider) --- */
const TOOL_COLORS=['#0A84FF','#30D158','#FFE600','#FF9F0A','#FF3B30','#BF5AF2','#64D2FF','#7EE787','#FFF3A3','#FFD9B3','#FF6482','#E84393','#FFFFFF','#E8E4DA','#AEAEB2','#6E6E73','#3A3A3C','#000000'];
let _colorSheetTool='highlight', _toolColorGridBuilt=false;
function toolColorLum(hex){ let h=hex.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); let n=parseInt(h,16); let r=((n>>16)&255)/255, g=((n>>8)&255)/255, b=(n&255)/255; let f=c=> c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); }
function openToolColorSheet(tool){
  _colorSheetTool=tool; renderToolColorSheet();
  let d=$('toolColorSheet'); if(d&&!d.open) d.showModal();
}
function renderToolColorSheet(){
  let b=curBook(); if(!b) return;
  let tool=_colorSheetTool, s=markSettingsFor(b,tool);
  let t=$('toolColorSheetTitle'); if(t) t.textContent=MARK_TOOL_NAMES[tool]+' color';
  let g=$('toolColorGrid');
  if(g&&!_toolColorGridBuilt){ _toolColorGridBuilt=true; g.innerHTML=TOOL_COLORS.map(c=>'<button type="button" class="toolColorCell" data-color="'+c+'" style="--cell:'+c+'" aria-label="'+c+'" onclick="setToolColor(\''+c+'\')"><span class="toolColorCheck" aria-hidden="true">\u2713</span></button>').join(''); }
  if(g) g.querySelectorAll('.toolColorCell').forEach(cell=>{ let on=cell.dataset.color===s.color; cell.classList.toggle('sel',on); cell.querySelector('.toolColorCheck').style.color=toolColorLum(cell.dataset.color)>0.5? '#18181B' : '#FFFFFF'; });
  let sl=$('toolOpacitySlider'); if(sl) sl.value=s.opacity;
  let f=$('toolOpacityFill'); if(f){ f.style.width=Math.round(s.opacity*100)+'%'; f.style.background=s.color; }
  let v=$('toolOpacityVal'); if(v) v.textContent=Math.round(s.opacity*100)+'%';
}
function setToolColor(color){
  let b=curBook(); if(!b) return;
  toolSettings(b,_colorSheetTool).color=color||null;
  scheduleSave(); renderToolColorSheet(); syncReaderToolUI();
}
function setToolColorOpacity(val){
  let b=curBook(); if(!b) return;
  toolSettings(b,_colorSheetTool).opacity=Math.min(1,Math.max(0.25,parseFloat(val)||0.6));
  scheduleSave(); renderToolColorSheet(); syncReaderToolUI();
}
/* Modern-web-guidance fallbacks: focusgroup is Chrome 150+ only — where it
   is missing, give each [role="toolbar"][focusgroup] a roving tabindex
   (first item tabbable, arrows move, Home/End jump). closedby is missing
   in Safari — where it is missing, a press+release outside a
   closedby="any" dialog closes it, so a selection drag ending on the
   backdrop does not dismiss. */
(function(){
  if(!('focusGroup' in HTMLElement.prototype)){
    document.querySelectorAll('[role="toolbar"][focusgroup]').forEach(bar=>{
      let items=[...bar.querySelectorAll('button')].filter(b=>!b.disabled);
      if(!items.length) return;
      items.forEach((b,i)=> b.tabIndex=i? -1 : 0);
      bar.addEventListener('focusin',e=>{ if(items.includes(e.target)) items.forEach(b=> b.tabIndex=b===e.target? 0 : -1); });
      bar.addEventListener('keydown',e=>{
        let i=items.indexOf(document.activeElement); if(i<0) return;
        let rtl=getComputedStyle(bar).direction==='rtl';
        let step={ArrowRight:rtl?-1:1, ArrowLeft:rtl?1:-1, Home:'home', End:'end'}[e.key];
        if(step===undefined) return;
        e.preventDefault();
        let n=step==='home'? 0 : step==='end'? items.length-1 : (i+step+items.length)%items.length;
        items[n].focus();
      });
    });
  }
  if(!('closedBy' in HTMLDialogElement.prototype)){
    let outside=(e,d)=>{ let r=d.getBoundingClientRect(); return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom; };
    document.querySelectorAll('dialog[closedby="any"]').forEach(d=>{
      let pressedOutside=false;
      d.addEventListener('pointerdown',e=>{ pressedOutside=outside(e,d); });
      d.addEventListener('pointerup',e=>{ if(pressedOutside&&outside(e,d)) d.close(); });
    });
  }
})();
function strikeSelection(){ annotateSelection('strike'); }
function exportAnnotations(){
  let b=curBook(); if(!b||!b.annotations.length){ toast('No annotations to export'); return; }
  let txt=b.title+' annotations\n\n'+b.annotations.map(a=>'• '+a.text+'\n  ('+a.where+')').join('\n\n');
  download('annotations-'+b.title.replace(/[^\w\- ]+/g,'')+'.txt', new Blob([txt],{type:'text/plain'}));
}

/* --- OCR: Tesseract.js on-device --- */
let lastOcrText='';let ocrWorker=null,ocrCancelled=false;function cancelOcr(){ocrCancelled=true;let w=ocrWorker;ocrWorker=null;if(w)w.terminate().catch(()=>{});let st=$('ocrStatus'),pr=$('ocrProgress'),btn=$('ocrRunBtn'),cb=$('ocrCancelBtn');if(pr)pr.classList.add('hidden');if(btn)btn.disabled=false;if(cb)cb.classList.add('hidden');if(st)st.textContent='OCR cancelled. You can run it again.';}
function openOcrPanel(){ prLeave(); let box=$('ocrBox'); /* P3: move the panel to the top of the article so it opens on-screen, not past the end of the book; for a PDF the article is hidden, so it goes to the top of the PDF view instead */ let b=curBook(); let host=(b&&b.kind==='pdf')?$('pdfView'):$('readerArticle'); if(host && box.parentNode!==host) host.appendChild(box); if(host){ let ref=(b&&b.kind==='pdf')?$('pdfPages'):$('readerBody'); if(ref&&ref.parentNode===host) host.insertBefore(box,ref); } box.classList.remove('hidden'); box.scrollIntoView({behavior:smoothOrInstant(),block:'nearest'}); }
async function ocrSourceCanvas(){
  let b=curBook();
  if(S.view==='reader' && b && b.kind==='epub'){ toast('This book already has real text. OCR is for scanned PDF pages and images.'); return null; }
  if(b && b.kind==='pdf'){
    let page=await b.doc.getPage(b.page);
    let v0=page.getViewport({scale:1}); let vp=page.getViewport({scale:Math.min(2.2, 1600/v0.width)});
    let c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height;
    let x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:x,viewport:vp}).promise;
    return c;
  }
  let nb=curNb(); if(nb){ return composePage(curPageObj(), 'blank'); }
  return null;
}
async function saveOcrToPage(book,pageNum,text,words){if(!book||book.kind!=='pdf'||!book.doc)return '';try{let pg=await book.doc.getPage(pageNum);let tc=await pg.getTextContent();if(tc.items.some(i=>(i.str||'').trim()))return 'real';}catch(e){}if(!book.ocrPages)book.ocrPages={};book.ocrPages[pageNum]={text:text,words:words||[],source:'ocr',lang:$('ocrLang').value,at:Date.now()};if(!book.textCache)book.textCache={};book.textCache[pageNum]=text;scheduleSave();ocrRedrawPage(book,pageNum);return 'saved';} async function runOcrOn(source,label){
  if(!window.Tesseract){ toast('OCR engine could not load. Check the connection.'); return; }
  let st=$('ocrStatus'), pr=$('ocrProgress'), btn=$('ocrRunBtn');
  pr.classList.remove('hidden'); pr.value=0; btn.disabled=true; ocrCancelled=false;let cancelBtn=$('ocrCancelBtn');if(cancelBtn)cancelBtn.classList.remove('hidden');let pdfBook=curBook(),pdfPage=(pdfBook&&pdfBook.kind==='pdf'&&label==='this page')?pdfBook.page:0;st.textContent='Starting OCR ('+label+')…';
  try{
    let res;if(window.Tesseract&&Tesseract.createWorker){ocrWorker=await Tesseract.createWorker($('ocrLang').value,1,{logger:m=>{if(m.status==='recognizing text'){pr.value=m.progress;st.textContent='Recognising… '+Math.round(m.progress*100)+'%';}else if(m.status)st.textContent=m.status+'…';}});if(ocrCancelled){await ocrWorker.terminate();ocrWorker=null;throw new Error('cancelled');}res=await ocrWorker.recognize(source);await ocrWorker.terminate();ocrWorker=null;}else{res=await Tesseract.recognize(source,$('ocrLang').value,{logger:m=>{if(m.status==='recognizing text'){pr.value=m.progress;st.textContent='Recognising… '+Math.round(m.progress*100)+'%';}else if(m.status)st.textContent=m.status+'…';}});}
    lastOcrText=(res.data.text||'').trim();
    let ocrSaved='';if(lastOcrText&&pdfPage){let sw=source&&source.width||0,sh=source&&source.height||0,words=[];if(res&&res.data&&Array.isArray(res.data.words)&&sw&&sh)words=res.data.words.filter(w=>w&&w.text&&w.bbox).map(w=>({t:String(w.text).trim(),x:+(w.bbox.x0/sw).toFixed(4),y:+(w.bbox.y0/sh).toFixed(4),w:+((w.bbox.x1-w.bbox.x0)/sw).toFixed(4),h:+((w.bbox.y1-w.bbox.y0)/sh).toFixed(4)}));ocrSaved=await saveOcrToPage(pdfBook,pdfPage,lastOcrText,words);} $('ocrText').textContent= lastOcrText || 'No print text was recognised on this page.';
    $('ocrCopyBtn').classList.toggle('hidden', !lastOcrText);
    $('ocrNoteBtn').classList.toggle('hidden', !lastOcrText);
    st.textContent= lastOcrText? 'Done. '+lastOcrText.split(/\s+/).length+' words recognised.'+(ocrSaved==='saved'?' Saved to this page, so you can select, highlight and search it after a reload.':ocrSaved==='real'?' This page already has real text, so the recognised text was not saved over it.':'') : 'Nothing recognised.';
  }catch(err){ if(ocrCancelled||(err&&err.message==='cancelled'))st.textContent='OCR cancelled. You can run it again.';else st.textContent='OCR failed ('+(err&&err.message?err.message:'error')+'). Language data downloads on first use, so check the connection and retry.'; }
  pr.classList.add('hidden');btn.disabled=false;let cb=$('ocrCancelBtn');if(cb)cb.classList.add('hidden');if(ocrWorker){ocrWorker.terminate().catch(()=>{});ocrWorker=null;}
}
async function ocrRedrawPage(book,pageNum){if(!book||!book.doc)return;document.querySelectorAll('.pdfHolder[data-n="'+pageNum+'"]').forEach(h=>{if(!h.isConnected||h._drawing||h.clientWidth<10)return;h.querySelectorAll('.textLayer').forEach(x=>x.remove());book.doc.getPage(pageNum).then(pg=>{let v0=pg.getViewport({scale:1});renderPdfTextLayer(pg,pg.getViewport({scale:h.clientWidth/v0.width}),h,book,pageNum);}).catch(()=>{});});} async function runOCR(){ let src=await ocrSourceCanvas(); if(!src){ toast('Open a PDF page (or a notebook page) to OCR'); return; } runOcrOn(src,'this page'); }
function ocrImageFile(e){ let f=e.target.files[0]; e.target.value=''; if(!f) return; let img=new Image(); img.onload=()=>runOcrOn(img,'image'); img.src=URL.createObjectURL(f); }
function copyOcrText(){ if(navigator.clipboard) navigator.clipboard.writeText(lastOcrText).then(()=>toast('OCR text copied')); }
function ocrToNote(){
  let nb=curNb();
  if(nb){ let p=nb.pages[nb.cur]; p.text=(p.text? p.text+'\n\n':'')+'[OCR] '+lastOcrText; $('noteText').value=p.text; updateWordCount(); scheduleSave(); toast('OCR text added to “'+nb.title+'”'); return; }
  let book=curBook();
  if(book && book.kind==='pdf'){
    /* no notebook open: the text belongs with the PDF, in its annotation
       store — no separate file on the shelf for it */
    let pg=prInkPage(book, book.page||1, true);
    if(pg){ pg.text=(pg.text? pg.text+'\n\n':'')+'[OCR] '+lastOcrText; scheduleSave(); toast('OCR text saved with this PDF'); return; }
  }
  nb=S.items.find(i=>i.kind==='notebook' && !i.pdfBookId);
  if(!nb){ nb=createNotebookSilent('OCR notes','#7c2d12','blank'); }
  let p=nb.pages[nb.cur]; p.text=(p.text? p.text+'\n\n':'')+'[OCR] '+lastOcrText;
  scheduleSave();
  toast('OCR text added to “'+nb.title+'”');
}

/* --- handwriting to text: Tesseract over the ink canvas --- */
async function handwritingToText(){
  let p=curPageObj(); if(!p){ toast('Open a notebook first'); return; }
  if(!p.ink.length){ toast('Write something on the page first'); return; }
  if(!window.Tesseract){ toast('Recognition engine could not load. Check the connection.'); return; }
  let btn=$('hwBtn'); btn.disabled=true; let hwLab=btn?btn.querySelector('span'):null; if(hwLab) hwLab.textContent='Recognising…'; else if(btn) btn.textContent='Recognising…';
  try{
    let comp=composePage(p,'blank');
    let res=await Tesseract.recognize(comp,'eng');
    let text=(res.data.text||'').replace(/\s+\n/g,'\n').trim();
    if(text){ $('noteText').value=($('noteText').value? $('noteText').value+'\n':'')+text; saveEditorToModel(); updateWordCount(); toast('Handwriting recognised and added below'); }
    else toast('No text recognised. Try larger, clearer letters.');
  }catch(e){ toast('Recognition failed. Check the connection and retry.'); }
  btn.disabled=false; if(hwLab) hwLab.textContent='Handwriting → Text'; else btn.textContent='Handwriting → Text';
}

/* --- TTS --- */
let voicesCache=[];
function detectGender(v){ let n=(v.name||'').toLowerCase(); if(/\bfemale\b|woman/.test(n)) return 'female'; if(/\bmale\b|\bman\b/.test(n)) return 'male'; let knownF=['zira','samantha','victoria','karen','moira','tessa','fiona','veena','lekha','google uk english female','microsoft aria','microsoft jenny']; let knownM=['david','alex','daniel','fred','thomas','oliver','rishi','google uk english male','microsoft guy','microsoft christopher']; if(knownF.some(k=>n.includes(k))) return 'female'; if(knownM.some(k=>n.includes(k))) return 'male'; let m=n.match(/[-_ ]([fm])\d?\b/); if(m) return m[1]==='f'?'female':'male'; return ''; }
function accentName(lang){ let map={'en-US':'American','en-GB':'British','en-AU':'Australian','en-IN':'Indian','en-CA':'Canadian','en-IE':'Irish','en-ZA':'South African','bn':'Bengali','ur':'Urdu','hi':'Hindi','ja':'Japanese','ko':'Korean','fr':'French','de':'German','es':'Spanish','ar':'Arabic'}; return map[lang]||map[lang.split('-')[0]]||lang; }
function buildVoiceList(){
  if(!('speechSynthesis' in window)) return;
  let all=speechSynthesis.getVoices(); voicesCache=all.filter(v=>v.localService); if(!voicesCache.length) voicesCache=all.slice(0,12);
  let groups={}; voicesCache.forEach(v=>{ let g=detectGender(v); let id=v.lang+'|'+g; if(!groups[id]) groups[id]={lang:v.lang,gender:g,voice:v}; });
  let list=Object.values(groups).sort((a,b)=>accentName(a.lang).localeCompare(accentName(b.lang)));
  let sel=$('accentSel'); sel.innerHTML='';
  if(!list.length){ sel.innerHTML='<option>No on-device voice found</option>'; $('voiceHint').textContent='No on-device voice on this device. Network voices are hidden so nothing silently fails.'; return; }
  list.slice(0,18).forEach(g=>{ let o=document.createElement('option'); o.value=g.lang+'|'+g.gender; o.textContent=accentName(g.lang)+(g.gender? ' · '+(g.gender==='female'?'Female':'Male'):''); sel.appendChild(o); });
  $('voiceHint').textContent=list.length+' working accent(s). Duplicates are collapsed and network-only voices are hidden.';
}
if('speechSynthesis' in window){ speechSynthesis.onvoiceschanged=buildVoiceList; buildVoiceList(); setTimeout(buildVoiceList,600); }
let speaking=false;
function currentReadableText(){
  let b=curBook(); if(!b) return '';
  if(b.kind==='epub') return b.chapters[b.ch].text;
  if(b.kind==='pdf') return (b.textCache&&b.textCache[b.page])||'';
  return '';
}
/* Read one PDF page's text on demand (Listen): the background text cache may
   not have reached this page yet, so do not make the user wait for it. */
async function pdfPageText(b,n){
  if(!b||b.kind!=='pdf'||!b.doc) return '';
  if(b.textCache&&b.textCache[n]) return b.textCache[n];
  try{
    let tc=await b.doc.getPage(n).getTextContent();
    let t=tc.items.map(i=>i.str||'').join(' ').replace(/\s+/g,' ').trim();
    if(!b.textCache) b.textCache={}; b.textCache[n]=t; scheduleSave();
    return t;
  }catch(e){ return ''; }
}
async function toggleTTS(){
  if(!('speechSynthesis' in window)){ toast('Speech is not supported in this browser'); return; }
  if(speaking){ speechSynthesis.cancel(); speaking=false; setBtnContent('ttsBtn','player-play','Play'); return; }
  let text=currentReadableText(); if(!text){ let b=curBook(); if(b&&b.kind==='pdf') text=await pdfPageText(b,b.page); }
  if(!text){ toast('No readable text here yet. For PDFs, let the page finish rendering first.'); return; }
  let val=$('accentSel').value||''; let parts=val.split('|'); let lang=parts[0], gender=parts[1];
  let genderPref=$('genderSel').value;
  let candidates=voicesCache.filter(v=>v.lang===lang || v.lang.startsWith((lang||'').split('-')[0]));
  let pick=candidates.find(v=> (genderPref||gender) && detectGender(v)===(genderPref||gender)) || candidates[0];
  let chunks=text.match(/[^.!?]+[.!?]+["']?\s*/g)||[text];
  let queue=chunks.map(s=>s.trim()).filter(Boolean);
  let i=0; speaking=true; setBtnContent('ttsBtn','player-stop','Stop');
  let speakNext=()=>{ if(!speaking) return; if(i>=queue.length){ speaking=false; setBtnContent('ttsBtn','player-play','Play'); return; }
    let u=new SpeechSynthesisUtterance(queue[i++]); u.rate=+$('ttsRate').value; if(pick) u.voice=pick; if(lang) u.lang=lang;
    u.onend=speakNext; u.onerror=speakNext; speechSynthesis.speak(u); };
  speakNext();
}

/* --- Parallel Read: original + live translation + notes --- */
function toggleParallel(){
  let box=$('parallelBox'); let show=box.classList.contains('hidden');
  box.classList.toggle('hidden',!show);
  if(show){ let t=currentReadableText(); $('parallelOrig').textContent=t? t.slice(0,1600) : 'Open a book page first.'; let b=curBook(); if(b) $('parallelNotes').value=(b.parallelNotes&&b.parallelNotes[parallelKey()])||''; }
}
function parallelKey(){ let b=curBook(); if(!b) return 'x'; return b.kind==='pdf'? 'p'+b.page : 'c'+b.ch; }
function saveParallelNotes(){ let b=curBook(); if(!b) return; if(!b.parallelNotes) b.parallelNotes={}; b.parallelNotes[parallelKey()]=$('parallelNotes').value; scheduleSave(); }
async function translateParallel(){
  let text=currentReadableText().slice(0,1400);
  if(!text){ toast('Nothing to translate on this page yet'); return; }
  let out=$('parallelTrans'); out.textContent='Translating…';
  let lang=$('parLang').value;
  let chunks=[]; let rest=text;
  while(rest.length>400){ let cut=rest.lastIndexOf('. ',400); if(cut<120) cut=400; chunks.push(rest.slice(0,cut+1)); rest=rest.slice(cut+1); }
  if(rest.trim()) chunks.push(rest);
  try{
    let done=[];
    for(let c of chunks){
      let r=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(c)+'&langpair=en|'+lang);
      let j=await r.json();
      let t=j&&j.responseData&&j.responseData.translatedText;
      if(!t) throw new Error('no translation returned');
      done.push(t);
    }
    out.textContent=done.join(' ');
    out.setAttribute('lang',lang); /* with the Noto Sans Bengali/Arabic webfonts loaded in <head>, the translation renders real glyphs on devices with no Bengali font installed */
    let b=curBook(); if(b) $('parallelNotes').value=(b.parallelNotes&&b.parallelNotes[parallelKey()])||'';
  }catch(e){ out.textContent='Translation needs a connection, and the free service has a daily limit. Try again in a moment.'; }
}

/* --- PDF annotation: open the PDF in the editor, ink over its pages --- */
async function annotatePdf(id){
  let b=S.items.find(i=>i.id===id); if(!b||b.kind!=='pdf') return;
  if(!b.doc){ let ok=await ensurePdfDoc(b); if(!ok){ toast('This PDF\u2019s file could not be restored from this browser. Import the file again to annotate it.'); return; } }
  let existing=S.items.find(i=>i.kind==='notebook' && i.pdfBookId===id);
  if(existing){ /* land on the page the user was reading (b.page, kept in sync by backToReading) instead of a stale last page: a notebook restored from an earlier session used to open on whatever page it was left on, which could be a blank page added at the end, and looked as if no PDF had loaded at all */ let pg=Math.max(1,Math.min(b.numPages||existing.pages.length,b.page||1)); let idx=existing.pages.findIndex(p=>p.bgPdf && p.bgPdf.page===pg); existing.cur= idx>=0 ? idx : Math.max(0,Math.min(existing.pages.length-1,pg-1)); openNotebook(existing.id); toast('Opened your annotations for this PDF'); return; }
  toast('Preparing annotation pages…');
  /* Lazy: record each page's size only (cheap, no rasterisation) and let
     decodeBgPdfImg render a page's background when it is actually viewed.
     Rendering every page up front built one full-size canvas per page —
     ~8 MB each, ~1 GB for a 120-page PDF — and crashed the tab on phones
     when opening annotation on a long PDF. This is the same lazy shape
     prInkNotebook already uses. */
  let sizes=[]; try{ sizes=await pdfPageSizes(b); }catch(e){}
  let nb={id:uid(),kind:'notebook',title:'Annotations for '+b.title,color:'#1e3a5f',template:'blank',cur:0,updated:'Just now',annotations:[],pdfBookId:id,pages:[]};
  for(let n=1;n<=b.numPages;n++){
    let pg=blankPage();
    let sz=sizes[n-1]||[612,792];
    pg.bgPdf={img:null,imgData:null,page:n,bookTitle:b.title,w:sz[0],h:sz[1]};
    nb.pages.push(pg);
  }
  S.items.unshift(nb); openNotebook(nb.id);
  toast('Annotate freely. Your marks stay with this PDF, and the PDF file is untouched.');
}
function annotateCurrentPdf(){ let b=curBook(); if(b) annotatePdf(b.id); } function backToReading(){ let nb=curNb(); if(!nb||!nb.pdfBookId) return; saveEditorToModel(); saveNow(); /* flush the strokes now, not on the 700ms timer, so leaving annotation mode really saves them */ let b=S.items.find(i=>i.id===nb.pdfBookId); if(!b){ toast('The PDF for these annotations is no longer on the shelf'); return; } let p=nb.pages[nb.cur]; let pg=(p&&p.bgPdf&&p.bgPdf.page)||(nb.cur+1); if(b.kind==='pdf'&&b.numPages) b.page=Math.max(1,Math.min(b.numPages,pg)); openBook(nb.pdfBookId); }

/* ============ focus timer ============ */
let timerSec=25*60, timerInt=null, timerPaused=false;
/* P8: every Focus label updates together, the Library button
   (#timerLabel) and the editor's Focus button (.timerLabel), so the
   countdown is visible in whichever view the timer was started from. */
function setTimerLabel(txt){ document.querySelectorAll('#timerLabel, .timerLabel').forEach(el=>{ el.textContent=txt; }); }
function fmtTimer(sec){ let m=Math.floor(sec/60),s=sec%60; return m+':'+String(s).padStart(2,'0'); }
/* P3: the timer tick is factored out so pause/resume reuse it. On
   completion the session counts and the timer resets, exactly as before;
   if Focus Mode is open, the view closes with the session. */
function timerTick(){
  timerSec--; setTimerLabel('Focus '+fmtTimer(timerSec)); updateFocusPill();
  if(timerSec<=0){ clearInterval(timerInt); timerInt=null; timerPaused=false; timerSec=25*60; setTimerLabel('Focus 25:00'); S.stats.focusDone++; updateStatsPanel(); toast('Focus session done. Nice work.'); if(S.focusMode) setFocusMode(false); updateFocusPill(); }
}
function startTimer(){ timerSec=25*60; timerPaused=false; clearInterval(timerInt); timerInt=setInterval(timerTick,1000); setTimerLabel('Focus '+fmtTimer(timerSec)); toast('Focus timer started. 25 minutes.'); }
function pauseTimer(){ if(!timerInt) return; clearInterval(timerInt); timerInt=null; timerPaused=true; updateFocusPill(); }
function resumeTimer(){ if(timerInt||!timerPaused) return; timerPaused=false; timerInt=setInterval(timerTick,1000); updateFocusPill(); }
function openTimer(){
  if(timerInt){ clearInterval(timerInt); timerInt=null; timerPaused=false; timerSec=25*60; setTimerLabel('Focus 25:00'); toast('Focus timer stopped'); updateFocusPill(); return; }
  if(timerPaused){ resumeTimer(); toast('Focus timer resumed'); return; }
  startTimer();
}

/* P3: Focus Mode (mockup 3). The timer engine above is reused, extended
   with pause/resume; the view is the same editor with its chrome hidden
   (see body.focusMode in styles.css) — no second canvas, no DOM moves.
   Session N comes from existing data: (focusDone % 4) + 1. Entering from
   the editor starts (or resumes) the timer and turns Split View off; the
   timer started from library/drawer/palette still just runs the countdown. */
function focusSessionNum(){ return (S.stats.focusDone%4)+1; }
function updateFocusPill(){
  let pill=$('focusPillText'); if(!pill) return;
  pill.textContent='Focus '+fmtTimer(timerSec)+' \u00b7 Session '+focusSessionNum()+'/4 \u00b7 '+(timerInt?'Pause':(timerPaused?'Resume':'Pause'));
  let fg=$('focusRingFg'); if(fg){ let C=2*Math.PI*9; fg.style.strokeDasharray=C.toFixed(2); fg.style.strokeDashoffset=(C*(1-timerSec/(25*60))).toFixed(2); }
}
function setFocusMode(on){
  S.focusMode=on;
  document.body.classList.toggle('focusMode',on);
  let bar=$('focusBar'); if(bar){ bar.classList.toggle('hidden',!on); bar.setAttribute('aria-hidden',on?'false':'true'); }
  updateFocusPill(); updateFocusAudioPill();
  if(on){ let sh=$('canvasShell'); if(sh) sh.scrollIntoView({block:'nearest'}); }
}
function enterFocusMode(){
  if(S.view!=='editor') return;
  closeAllToolPops(); closeRailPanel();
  if(S.split) toggleSplit();
  if(timerInt){ /* already running */ }
  else if(timerPaused){ resumeTimer(); }
  else { startTimer(); }
  setFocusMode(true);
}
function exitFocusMode(){
  if(!S.focusMode) return;
  pauseTimer();
  setFocusMode(false);
}
function toggleFocusPause(){ if(timerInt) pauseTimer(); else if(timerPaused) resumeTimer(); }
function updateFocusAudioPill(){
  let pill=$('focusAudioPill'); if(!pill) return;
  let show=S.focusMode && S.recording;
  pill.classList.toggle('hidden',!show);
  if(show){ let s=Math.floor((Date.now()-S.recStart)/1000); $('focusAudioText').textContent='Audio Recording \u00b7 '+fmtTimer(s); }
}

/* ============ session stats ticker ============ */
setInterval(()=>{ if(S.view==='editor') S.stats.writeSec++; if(S.view==='reader') S.stats.readSec++; if(S.stats.writeSec%15===0||S.stats.readSec%15===0) updateStatsPanel(); updateFocusAudioPill(); },1000);

/* ============ Parallel Read: two books side by side, synced scroll ============
   The book open in the reader sits in the left pane; any other PDF or
   EPUB on the shelf sits in the right pane. Each pane scrolls on its own
   and the other follows.
   Sync works on "units", a chapter of an EPUB, a page of a PDF. The
   scrolled pane reports which unit is at its top edge and how far into
   that unit it is (0..1); the other pane is put at the same fraction of
   its matching unit (shifted by the Offset, for books whose front matter
   differs). "By overall position" maps the whole-book scroll fraction
   instead; "Off" lets each pane scroll freely.
   Echo guard: when a pane (or a page-number rail) is moved by code, the
   position it was moved to is remembered (expect / railExpect). The scroll
   event that move produces is recognised and ignored, so nothing bounces.
   Page-number rail: ONE column of page (or chapter) numbers on the left,
   for the book the reader is using right now (see "one page-number rail"
   below).
   Zoom: each book has its own, the book under the pointer / fingers
   zooms (see "zoom" below).
   Each book's reading place and zoom, and the left book's partner, sync
   mode and offset, are saved with the rest of the shelf. */
const PR={on:false, token:0, panes:{}, raf:0, driver:null, posT:null, resizeT:null, suspend:false, lastW:0, railRaf:0, active:'L', railBook:null, railExpect:null, railActive:-1};
let PR_RAIL_H=40;   /* sidebar row pitch (row height + gap), measured from the real rows, since it differs on touch screens */
const PR_ZOOM_MIN=0.6, PR_ZOOM_MAX=3;
let prPinch=null;
function prOtherBooks(leftId){ return S.items.filter(i=>(i.kind==='pdf'||i.kind==='epub') && i.id!==leftId); }
/* Parallel Read is home-screen only: the only way in is the home-screen
   button (pick two books first) or the picker inside Parallel Read itself
   (change the second book). There is no in-reader entry. */
let prPickStep=null, prPickFirst=null, prImportTarget=null;
function prClosePicker(){ let d=$('prPickSheet'); if(d && d.open) d.close(); }
/* Open both books side by side from their ids (home flow). Works whether
   or not Parallel Read is already on; when it is on with the same first
   book, just swap the second one instead of rebuilding everything. */
function prUseAsSecond(firstId, secondId){
  if(PR.on && curBook() && curBook().id===firstId){ prPickRight(secondId); return; }
  openParallelReadPair(firstId, secondId);
}
async function openParallelReadPair(firstId, secondId){
  let L=S.items.find(i=>i.id===firstId); if(!L) return;
  let R=S.items.find(i=>i.id===secondId);
  if(!R){ toast('Pick a second book'); return; }
  L.parallelWith=secondId;
  if(['unit','percent','off'].indexOf(L.parallelSync)<0) L.parallelSync='unit';
  if(typeof L.parallelOffset!=='number' || !isFinite(L.parallelOffset)) L.parallelOffset=0;
  S.curBookId=firstId;
  showView('reader');
  PR.active='L';
  closeReaderCards(); $('parallelBox').classList.add('hidden');
  PR.on=true; PR.lastW=window.innerWidth; document.body.classList.add('prOn');
  $('readerGrid').classList.add('hidden'); $('annotateFab').classList.add('hidden');
  $('parallelRead').classList.remove('hidden');
  $('prSync').value=L.parallelSync; $('prOffset').value=L.parallelOffset;
  $('prOffsetWrap').classList.toggle('hidden', L.parallelSync!=='unit');
  prFillSecondBtn(L);
  window.scrollTo({top:0});
  await prRenderBoth();
  scheduleSave();
}
/* The picker popup: shelf books already on the device, plus Open from
   files. Step 'first' picks the left book, step 'second' the right one. */
function prOpenPicker(step){
  let leftId=null;
  if(step==='second') leftId = (PR.on && curBook()) ? curBook().id : prPickFirst;
  if(step==='second' && !leftId){ toast('Pick the first book first'); step='first'; }
  prPickStep=step;
  let books=S.items.filter(i=>(i.kind==='pdf'||i.kind==='epub') && i.id!==leftId);
  $('prPickTitle').textContent = step==='first' ? 'Parallel Read — pick the first book' : 'Pick the second book';
  $('prPickEmpty').classList.toggle('hidden', books.length>0);
  let list=$('prPickList'); list.innerHTML='';
  books.forEach(b=>{
    let row=document.createElement('button');
    row.type='button'; row.className='pickRow'; row.onclick=()=>prPickBook(b.id);
    let meta=b.kind==='pdf' ? ((b.numPages||'?')+' pages · PDF') : (((b.chapters||[]).length)+' chapters · EPUB');
    row.innerHTML='<span class="pickDot" style="background:'+esc(b.color||'#4a5a74')+'"></span><span class="pickMain"><b>'+esc(b.title)+'</b><span class="kbd">'+esc(meta)+'</span></span><span class="pickGo" aria-hidden="true">›</span>';
    list.appendChild(row);
  });
  let d=$('prPickSheet');
  if(!d.open){ try{ d.showModal(); }catch(e){ d.show(); } }
}
function prPickBook(id){
  if(prPickStep==='first'){ prPickFirst=id; prOpenPicker('second'); return; }
  prClosePicker();
  prUseAsSecond(prPickFirst, id);
  prPickFirst=null; prPickStep=null;
}
/* Import from the picker: the file becomes the picked book instead of
   opening on its own in the normal reader. */
function prPickImport(e){
  let step=prPickStep||'second';
  let firstId = step==='second' ? ((PR.on && curBook()) ? curBook().id : prPickFirst) : null;
  prImportTarget={step:step, firstId:firstId};
  handleImport(e);
}
function afterImportOpen(book){
  let t=prImportTarget; prImportTarget=null;
  if(!t){ openBook(book.id); return; }
  if(t.step==='first'){ prPickFirst=book.id; prOpenPicker('second'); return; }
  prClosePicker();
  prUseAsSecond(t.firstId, book.id);
  prPickFirst=null; prPickStep=null;
}
/* The second-book control in the Parallel Read bar: a button showing the
   book in use (tap it to pick another), not a dropdown. */
function prFillSecondBtn(L){
  let R=S.items.find(i=>i.id===L.parallelWith)||null;
  let lab=$('prRightLabel'); if(lab) lab.textContent=R? R.title : 'Choose a book';
}
/* the OCR card can be parked inside a pane, move it home before a pane is emptied */
function prRescueCards(){ ['ocrBox'].forEach(id=>{ let x=$(id); if(x && x.closest('#parallelRead')){ x.classList.add('hidden'); $('readerArticle').appendChild(x); } }); }
function prClampZoom(z){ z=+z; if(!isFinite(z)||z<=0) z=1; return Math.max(PR_ZOOM_MIN,Math.min(PR_ZOOM_MAX,Math.round(z*100)/100)); }
function prUnitIndex(b){ return b.kind==='pdf'? Math.max(0,(b.page||1)-1) : Math.max(0,b.ch||0); }
function prClearPane(s){ let el=$('prPane'+s); if(el._io){ el._io.disconnect(); el._io=null; } el.querySelectorAll('.pdfHolder').forEach(pdfReleasePage); el.innerHTML=''; let r=$('prRail'+s); if(r) r.innerHTML=''; }
async function prRenderBoth(){
  let L=curBook(); if(!L || !PR.on) return;
  let tok=++PR.token;
  prInkCancel(); prHideSelBar(); prCloseMarks();
  /* which books were being annotated: they keep annotating if they are still there after the rebuild */
  let keepInk={L:PRA.inkOn.L? PRA.inkBook.L : null, R:PRA.inkOn.R? PRA.inkBook.R : null};
  PRA.inkOn={L:false,R:false};
  PR.suspend=true; PR.panes={};
  prRescueCards();
  let R=S.items.find(i=>i.id===L.parallelWith)||null;
  $('prTitleL').textContent=L.title; $('prTitleR').textContent=R? R.title : '';
  $('prPosL').textContent=''; $('prPosR').textContent='';
  ['L','R'].forEach(s=>{ prClearPane(s); let el=$('prPane'+s); el.innerHTML='<p class="kbd">Opening…</p>'; el.scrollTop=0; el.scrollLeft=0; });
  let okL= L.kind!=='pdf' || await ensurePdfDoc(L);
  let okR= !!R && (R.kind!=='pdf' || await ensurePdfDoc(R));
  if(tok!==PR.token) return;
  let PL= okL? await prBuildPane('L',L,tok) : null;
  if(tok!==PR.token) return;
  let PRt= okR? await prBuildPane('R',R,tok) : null;
  if(tok!==PR.token) return;
  if(!PL) $('prPaneL').innerHTML='<p class="kbd">This book could not be opened here.</p>';
  if(!PRt) $('prPaneR').innerHTML='<p class="kbd">'+(R? 'That book’s file could not be restored from this browser, import it again to read it here.' : 'Pick a second book above.')+'</p>';
  PR.panes={L:PL, R:PRt};
  if(PL) prScrollToUnit(PL, prUnitIndex(L));
  if(PRt){ if(L.parallelSync!=='off' && PL) prSyncFrom('L'); else prScrollToUnit(PRt, prUnitIndex(R)); }
  /* the rail shows the book in use, keep the side that was active (e.g. after picking a new partner), else the first book */
  let act= PR.panes[PR.active]? PR.active : (PL? 'L' : 'R');
  if(PR.panes[act]) prSetActive(act,true); else { $('prRail').innerHTML=''; PR.railBook=null; }
  { let want=!!(keepInk.L || keepInk.R || PRA.pending.L || PRA.pending.R); PRA.pending={L:false,R:false}; if(want) prToggleInk(true,true); }
  $('parallelRead').classList.toggle('prInking',PRA.ink); $('prInkBar').classList.toggle('hidden',!PRA.ink);
  if(!PRA.inkOn[PRA.barSide]) PRA.barSide= PRA.inkOn.L? 'L' : PRA.inkOn.R? 'R' : null;
  if(PRA.ink) prRenderInkBar();
  prUpdateAnnotateFab();
  prUpdatePositions();
  /* scroll events from the moves above arrive before the next frames' callbacks, release the guard after them */
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(tok===PR.token) PR.suspend=false; }));
}
async function prBuildPane(side,book,tok){
  let el=$('prPane'+side);
  let P={side:side, el:el, book:book, expect:null, tok:tok, lastPos:null, zoom:prClampZoom(book.parallelZoom||1), zoomT:null};
  if(book.kind==='epub'){
    let wrap=document.createElement('div'); wrap.className='prEpub';
    wrap.innerHTML=(book.chapters||[]).map((c,i)=>'<section data-unit="'+i+'"><h3>'+esc(c.title)+'</h3>'+c.html+'</section>').join('');
    el.innerHTML=''; el.appendChild(wrap); prReapplyEpubMarks(P); prApplyZoom(P); prPadEnd(P);
    requestAnimationFrame(()=>{ if(tok===PR.token) prRefreshInk(P); }); /* its handwriting, once the chapters are laid out */
    return P;
  }
  /* PDF: placeholders sized to each page's own shape (final layout from
     the start), drawn sharp near the visible part of the pane and freed
     far from it, see "PDF pages" above */
  let sizes;
  try{ sizes=await pdfPageSizes(book); }catch(e){ return null; }
  if(tok!==PR.token) return null;
  let wrap=document.createElement('div'); wrap.className='prPdf';
  let nums=[]; for(let n=1;n<=book.numPages;n++) nums.push(n);
  let holders=pdfBuildPages(wrap,book,sizes,nums,'prPage');
  holders.forEach(h=>{ h._afterDraw=()=>prRenderInk(P,h); }); /* each page gets its handwriting back whenever it is drawn */
  el.innerHTML=''; el.appendChild(wrap); prApplyZoom(P); prPadEnd(P);
  el._io=pdfWatch(holders, el, book, ()=> tok===PR.token && PR.on, n=>prJump(side,n-1));
  return P;
}
/* room after the last chapter / page, so even a short last one can be
   scrolled up to the top of its pane, only as much as the last unit
   needs: a page taller than the pane needs none, so the end of a PDF is
   never a screen of blank */
function prPadEnd(P){
  let w=P.el.firstElementChild; if(!w) return;
  let us=w.querySelectorAll('[data-unit]'); let last=us[us.length-1];
  let lastH= last? last.offsetHeight : 0;
  w.style.paddingBottom=Math.max(0,P.el.clientHeight-lastH-24)+'px';
}
function prUnits(P){ return Array.from(P.el.querySelectorAll('[data-unit]')).map(u=>({top:u.offsetTop, h:u.offsetHeight})); }
/* where a pane is: unit at its top edge, fraction into it, and whole-book fraction */
function prPos(P){
  let el=P.el, y=el.scrollTop, max=el.scrollHeight-el.clientHeight;
  let us=prUnits(P); if(!us.length) return null;
  let i=0; for(let k=0;k<us.length;k++){ if(us[k].top<=y+1) i=k; else break; }
  let u=us[i]; let f= u.h>0? Math.max(0,Math.min(1,(y-u.top)/u.h)) : 0;
  return {i:i, f:f, n:us.length, ratio: max>0? Math.max(0,Math.min(1,y/max)) : 0};
}
function prMoveTo(P,y){
  let el=P.el, max=Math.max(0,el.scrollHeight-el.clientHeight);
  y=Math.max(0,Math.min(max,Math.round(y)));
  if(Math.abs(el.scrollTop-y)<1) return;
  el.scrollTop=y; P.expect=el.scrollTop;
}
function prScrollToUnit(P,i){ let us=prUnits(P); if(!us.length) return; i=Math.max(0,Math.min(us.length-1,i||0)); prMoveTo(P, i===0? 0 : us[i].top); }
function prSyncFrom(side){
  let L=curBook(); if(!L || !PR.on) return;
  let mode=L.parallelSync; if(mode==='off') return;
  let A=PR.panes[side], B=PR.panes[side==='L'?'R':'L']; if(!A || !B) return;
  let pa=prPos(A); if(!pa) return;
  if(mode==='percent'){ prMoveTo(B, pa.ratio*(B.el.scrollHeight-B.el.clientHeight)); return; }
  let us=prUnits(B); if(!us.length) return;
  let off=Math.round(L.parallelOffset||0);
  let j= side==='L'? pa.i+off : pa.i-off;
  if(j<0){ prMoveTo(B,0); return; }                      /* partner has not started yet: rest at its top */
  if(j>=us.length){ let u=us[us.length-1]; prMoveTo(B,u.top+u.h); return; } /* partner already finished: rest at its last line, "End" in view */
  prMoveTo(B, us[j].top + pa.f*us[j].h);
}
function prOnScroll(side){
  if(!PR.on || PR.suspend) return;
  let P=PR.panes[side]; if(!P) return;
  if(P.expect!==null && Math.abs(P.el.scrollTop-P.expect)<=2){ P.expect=null; prQueuePositions(); return; } /* our own move, not the reader */
  P.expect=null;
  PR.driver=side;
  if(!PR.raf) PR.raf=requestAnimationFrame(()=>{ PR.raf=0; if(PR.on && PR.driver){ prSetActive(PR.driver); prSyncFrom(PR.driver); prRefreshRails(); } prQueuePositions(); });
}
$('prPaneL').addEventListener('scroll',()=>prOnScroll('L'),{passive:true});
$('prPaneR').addEventListener('scroll',()=>prOnScroll('R'),{passive:true});

/* --- one page-number rail for the book you are using ---
   A single rail sits on the left of Parallel Read. It shows the page (or
   chapter) numbers of the ACTIVE book, the one the reader last touched,
   clicked, scrolled, zoomed or tabbed into, and switches to the other
   book as soon as the reader starts using that one. Merely moving the
   mouse across does not switch it (no flicker). The active book's panel
   gets an accent edge so it is clear which book the numbers belong to.
   Rail position p (in units) = rail.scrollTop / PR_RAIL_H = page index +
   fraction into that page, the same position the book reports. Scrolling
   the rail scrolls the active book (the partner follows by the sync
   mode); scrolling the active book scrolls the rail; tapping a number
   jumps the active book there. */
function prSetActive(side,force){
  if(!PR.on) return;
  let P=PR.panes[side]; if(!P) return;
  if(!force && PR.active===side && PR.railBook===P.book.id) return;
  PR.active=side;
  ['L','R'].forEach(s=>{ let c=$('prPane'+s).closest('.prCol'); if(c) c.classList.toggle('prActive', s===side && !!PR.panes.L && !!PR.panes.R); });
  prBuildRail(P);
  prSetRail();
  prShowZoom();
  prUpdateMarksBtn();
  prUpdateAnnotateFab();
}
function prBuildRail(P){
  let rail=$('prRail'); if(!rail) return;
  PR.railBook=P.book.id; PR.railExpect=null; PR.railActive=-1;
  let n=prUnits(P).length, isPdf=P.book.kind==='pdf', items='';
  for(let k=0;k<n;k++){
    let t= isPdf? 'Page '+(k+1) : 'Chapter '+(k+1)+((P.book.chapters&&P.book.chapters[k])? ', '+P.book.chapters[k].title : '');
    items+='<button type="button" class="prRailNum" data-k="'+k+'" title="'+esc(t)+'" aria-label="'+esc(t)+'">'+(k+1)+'</button>';
  }
  rail.innerHTML='<div class="prRailPad" aria-hidden="true"></div>'+items+'<div class="prRailPad" aria-hidden="true"></div>';
  rail.setAttribute('aria-label',(isPdf?'Pages of ':'Chapters of ')+P.book.title);
  let lab=$('prRailLabel');
  if(lab){ lab.textContent= isPdf? 'Pages' : 'Chapters'; lab.title=(isPdf?'Pages of ':'Chapters of ')+P.book.title+' ('+(P.side==='L'?'first':'second')+' book)'; lab.dataset.side=P.side; }
  rail.scrollTop=0;
  prRailPads();
}
/* half a rail of padding above and below, so number k sits on the reading line when rail.scrollTop = k * PR_RAIL_H */
function prRailPads(){
  let rail=$('prRail'); if(!rail) return;
  let rows=rail.querySelectorAll('.prRailNum');
  if(rows.length>1) PR_RAIL_H=rows[1].offsetTop-rows[0].offsetTop;
  else if(rows.length===1){ let cs=getComputedStyle(rows[0]); PR_RAIL_H=rows[0].offsetHeight+parseFloat(cs.marginBottom||0); }
  /* padding so the centre of row k sits mid-panel when rail.scrollTop = k * pitch; the bottom pad is one
     row taller so the rail can scroll all the way to the end of the last page (p = n) */
  let mid=rail.clientHeight/2, pads=rail.querySelectorAll('.prRailPad');
  if(pads[0]) pads[0].style.height=Math.max(0,Math.round(mid-PR_RAIL_H/2))+'px';
  if(pads[1]) pads[1].style.height=Math.max(0,Math.round(mid+PR_RAIL_H/2))+'px';
}
function prMarkRail(i){
  let rail=$('prRail'); if(!rail || PR.railActive===i) return; PR.railActive=i;
  rail.querySelectorAll('.prRailNum.active').forEach(b=>{ b.classList.remove('active'); b.removeAttribute('aria-current'); });
  let b=rail.querySelector('.prRailNum[data-k="'+i+'"]'); if(b){ b.classList.add('active'); b.setAttribute('aria-current','page'); }
}
/* put the rail where the active book is */
function prSetRail(){
  let P=PR.panes[PR.active], r=$('prRail'); if(!P||!r||PR.railBook!==P.book.id) return;
  let pos=prPos(P); if(!pos) return;
  let max=Math.max(0,r.scrollHeight-r.clientHeight);
  let target=Math.max(0,Math.min(max,Math.round((pos.i+pos.f)*PR_RAIL_H)));
  if(Math.abs(r.scrollTop-target)>=1){ r.scrollTop=target; PR.railExpect=r.scrollTop; }
  prMarkRail(pos.i);
}
function prRefreshRails(){ prSetRail(); }
function prOnRailScroll(){
  if(!PR.on || PR.suspend) return;
  let r=$('prRail');
  if(PR.railExpect!==null && Math.abs(r.scrollTop-PR.railExpect)<=2){ PR.railExpect=null; return; } /* moved by code to follow its book */
  PR.railExpect=null;
  if(!PR.railRaf) PR.railRaf=requestAnimationFrame(()=>{ PR.railRaf=0; if(PR.on) prFollowRail(); });
}
/* the reader scrolled the rail: the active book follows, the partner follows by the sync mode */
function prFollowRail(){
  let side=PR.active, P=PR.panes[side]; if(!P) return;
  let us=prUnits(P); if(!us.length) return;
  let p=$('prRail').scrollTop/PR_RAIL_H;
  let i=Math.max(0,Math.min(us.length-1,Math.floor(p))), f=Math.max(0,Math.min(1,p-i));
  prMoveTo(P, us[i].top+f*us[i].h);
  prSyncFrom(side);
  prMarkRail(i);
  prQueuePositions();
}
/* tap a number (or follow a link inside a PDF): jump that book to the start of that page / chapter */
function prJump(side,k){
  let P=PR.panes[side]; if(!P) return;
  let us=prUnits(P); if(!us.length) return;
  k=Math.max(0,Math.min(us.length-1,k));
  prMoveTo(P, k===0? 0 : us[k].top);
  PR.driver=side;
  prSetActive(side);
  prSyncFrom(side); prSetRail(); prQueuePositions();
}
(function(){
  let r=$('prRail');
  r.addEventListener('scroll',prOnRailScroll,{passive:true});
  r.addEventListener('click',e=>{ let b=e.target.closest('.prRailNum'); if(b) prJump(PR.active,+b.dataset.k); });
})();
/* using a book makes it the active one (hover alone does not) */
['L','R'].forEach(s=>{
  let el=$('prPane'+s);
  ['pointerdown','wheel','touchstart','focusin','keydown'].forEach(t=>el.addEventListener(t,()=>{ if(PR.on) prSetActive(s); },{passive:true}));
});

/* --- zoom: each book has its own ---
   Ctrl + mouse wheel / trackpad pinch zooms the book under the pointer;
   a two-finger pinch zooms the book under the fingers; the - / 100% / +
   buttons zoom the active book. PDF pages are re-laid-out at the new
   width and redrawn sharp at that size (never just stretched); EPUB text
   is scaled. Pointer and pinch zoom happen around the pointer / fingers;
   the other book does not move or zoom; each book remembers its own zoom. */
function prApplyZoom(P){
  let w=P&&P.el.firstElementChild; if(!w) return;
  if(P.book.kind==='pdf') w.style.width=(P.zoom*100)+'%';
  else { w.style.setProperty('--pr-zoom',String(P.zoom)); requestAnimationFrame(()=>prRefreshInk(P)); } /* chapters re-flow: redraw their ink */
}
function prShowZoom(){
  let P=PR.panes[PR.active], lab=$('prZoomLabel'); if(!lab) return;
  lab.textContent=Math.round((P? P.zoom : 1)*100)+'%';
  let which= PR.active==='L'? 'first' : 'second';
  $('parallelRead').querySelectorAll('.prZoom button').forEach(b=>{ let base=b.dataset.base||(b.dataset.base=b.title); b.title=base+', '+which+' book'; });
}
function prZoomBy(f){ let P=PR.panes[PR.active]; if(!P) return; prSetZoom(PR.active, f===0? 1 : P.zoom*f); }
/* ax, ay (screen point, optional): zoom AROUND that point, the spot under
   the pointer / between the fingers stays where it is while the page grows
   or shrinks around it. Without a point (the buttons) the page's top line
   and horizontal centre stay put. */
function prSetZoom(side,z,ax,ay){
  if(!PR.on) return;
  let P=PR.panes[side]; if(!P) return;
  z=prClampZoom(z);
  if(Math.abs(z-P.zoom)<0.005) return;
  let el=P.el, pos=prPos(P), hx= el.scrollWidth>el.clientWidth? (el.scrollLeft+el.clientWidth/2)/el.scrollWidth : 0.5;
  let anchor=null;
  if(typeof ax==='number' && typeof ay==='number'){
    let rect=el.getBoundingClientRect(), oy=Math.max(0,Math.min(el.clientHeight,ay-rect.top)), ox=Math.max(0,Math.min(el.clientWidth,ax-rect.left));
    let yc=el.scrollTop+oy, us=prUnits(P), i=0;
    for(let k=0;k<us.length;k++){ if(us[k].top<=yc) i=k; else break; }
    if(us.length) anchor={i:i, g: us[i].h? (yc-us[i].top)/us[i].h : 0, oy:oy, ox:ox, fx:(el.scrollLeft+ox)/Math.max(1,el.scrollWidth)};
  }
  P.zoom=z; P.book.parallelZoom=z; scheduleSave();
  PR.suspend=true;
  prApplyZoom(P); prPadEnd(P);
  if(anchor){
    let us=prUnits(P), u=us[Math.min(anchor.i,us.length-1)];
    if(u) prMoveTo(P, u.top+anchor.g*u.h-anchor.oy);
    el.scrollLeft=Math.max(0, anchor.fx*el.scrollWidth-anchor.ox);
  } else {
    if(pos){ let us=prUnits(P), u=us[Math.min(pos.i,us.length-1)]; if(u) prMoveTo(P,u.top+pos.f*u.h); }
    el.scrollLeft=Math.max(0,hx*el.scrollWidth-el.clientWidth/2);
  }
  /* zooming is a change of view, not of place: the other book is left exactly where it is (the two re-align on the next scroll) */
  prSetRail(); prShowZoom();
  let tok=PR.token;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(tok===PR.token) PR.suspend=false; }));
  /* the new layout shows at once; pages are redrawn sharp at the new size a moment after the zooming stops */
  clearTimeout(P.zoomT); P.zoomT=setTimeout(()=>{ if(PR.on && PR.panes[side]===P && P.book.kind==='pdf') pdfRefresh(P.el,P.el._io); },220);
}
function prRefreshPages(){ ['L','R'].forEach(s=>{ let P=PR.panes[s]; if(P && P.book.kind==='pdf') pdfRefresh(P.el, P.el._io); }); }
/* Ctrl + mouse wheel, and a laptop trackpad pinch (which the browser reports as Ctrl + wheel): the book under the pointer */
function prOnWheel(side,e){ if(!PR.on || !(e.ctrlKey||e.metaKey)) return; e.preventDefault(); let P=PR.panes[side]; if(!P) return; prSetZoom(side, P.zoom*Math.exp(-e.deltaY*0.0025), e.clientX, e.clientY); }
/* two-finger pinch on phones and tablets: the book under the fingers; a live preview while pinching, the real (sharp) zoom when the fingers lift */
function prTouchStart(side,e){
  if(!PR.on || !e.touches || e.touches.length!==2) return;
  let P=PR.panes[side]; if(!P) return;
  let w=P.el.firstElementChild; if(!w) return;
  let a=e.touches[0], b=e.touches[1], r=w.getBoundingClientRect();
  prPinch={side:side, w:w, d0:Math.max(20,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)), z0:P.zoom, s:1, mx:(a.clientX+b.clientX)/2, my:(a.clientY+b.clientY)/2};
  w.style.transformOrigin=((a.clientX+b.clientX)/2-r.left)+'px '+((a.clientY+b.clientY)/2-r.top)+'px';
}
function prTouchMove(e){
  if(!prPinch || !e.touches || e.touches.length!==2) return;
  let a=e.touches[0], b=e.touches[1];
  let z=prClampZoom(prPinch.z0*Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)/prPinch.d0);
  prPinch.s=z/prPinch.z0;
  prPinch.w.style.transform='scale('+prPinch.s+')';
}
function prTouchEnd(e){
  if(!prPinch || (e.touches && e.touches.length>=2)) return;
  let p=prPinch; prPinch=null;
  p.w.style.transform=''; p.w.style.transformOrigin='';
  if(Math.abs(p.s-1)>0.02) prSetZoom(p.side, p.z0*p.s, p.mx, p.my);
}
['L','R'].forEach(s=>{
  let el=$('prPane'+s);
  el.addEventListener('wheel',e=>prOnWheel(s,e),{passive:false});
  el.addEventListener('touchstart',e=>prTouchStart(s,e),{passive:true});
  el.addEventListener('touchmove',prTouchMove,{passive:true});
  el.addEventListener('touchend',prTouchEnd,{passive:true});
  el.addEventListener('touchcancel',prTouchEnd,{passive:true});
});

function prQueuePositions(){ clearTimeout(PR.posT); PR.posT=setTimeout(prUpdatePositions,150); }
/* keep each book's own reading place in step with its pane, and label it */
function prUpdatePositions(){
  if(!PR.on) return;
  ['L','R'].forEach(side=>{
    let P=PR.panes[side], lab=$('prPos'+side); if(!P){ lab.textContent=''; return; }
    let pos=prPos(P); if(!pos) return;
    P.lastPos={i:pos.i, f:pos.f};
    let b=P.book;
    if(b.kind==='pdf'){ b.page=pos.i+1; lab.textContent='Page '+b.page+' / '+pos.n; S.stats.pagesRead['pdf:'+b.id+':'+b.page]=1; }
    else { b.ch=pos.i; lab.textContent='Chapter '+(b.ch+1)+' / '+pos.n; S.stats.pagesRead['epub:'+b.id+':'+b.ch]=1; }
  });
  updateResume(); /* the left book's resume label + a save */
}
function prPickRight(id){ let L=curBook(); if(!L) return; L.parallelWith=id; prFillSecondBtn(L); scheduleSave(); prRenderBoth(); }
function prSetSync(v){
  let L=curBook(); if(!L) return;
  L.parallelSync=(['unit','percent','off'].indexOf(v)>=0)? v : 'unit';
  $('prOffsetWrap').classList.toggle('hidden', L.parallelSync!=='unit');
  scheduleSave(); prSyncFrom('L'); prRefreshRails();
  toast(L.parallelSync==='off'? 'Sync off, each book scrolls on its own' : L.parallelSync==='percent'? 'Synced by overall position' : 'Synced by chapter / page');
}
function prSetOffset(v){
  let L=curBook(); if(!L) return;
  let n=Math.round(+v); if(!isFinite(n)) n=0; n=Math.max(-999,Math.min(999,n));
  L.parallelOffset=n; $('prOffset').value=n;
  scheduleSave(); prSyncFrom('L'); prRefreshRails();
}
function closeParallelRead(silent){
  if(!PR.on) return;
  prUpdatePositions(); /* capture both places while the panes can still be measured */
  prAnnotationsOnClose(silent); /* tools off; the normal reader redraws marks made here */
  PR.on=false; PR.token++; PR.panes={}; PR.suspend=false; prPinch=null;
  if(PR.raf){ cancelAnimationFrame(PR.raf); PR.raf=0; }
  if(PR.railRaf){ cancelAnimationFrame(PR.railRaf); PR.railRaf=0; }
  clearTimeout(PR.posT); clearTimeout(PR.resizeT);
  prRescueCards();
  ['L','R'].forEach(s=>{ let el=$('prPane'+s); el.closest('.prCol').classList.remove('prActive'); prClearPane(s); });
  $('prRail').innerHTML=''; PR.railBook=null; PR.railExpect=null; PR.railActive=-1;
  $('parallelRead').classList.add('hidden'); $('readerGrid').classList.remove('hidden');
  document.body.classList.remove('prOn');
  scheduleSave();
  if(silent) return;
  let b=curBook(); if(!b) return;
  if(b.kind==='pdf'){
    $('annotateFab').classList.remove('hidden');
    /* Parallel Read can be entered from the home screen, where this book
       was never opened in the normal reader — then the reader has no
       pages at all and the jump below is a no-op, leaving an empty
       reader. Build the pages first (renderPdfBook scrolls to the
       current page itself once they exist). */
    if(!document.querySelector('#pdfPages .pdfHolder')){ showPdfChrome(); renderPdfBook(); }
    else jumpToPdfPage(b.page,true);
  }
  else {
    if(!document.querySelector('#readerBody [data-ch]')){ showEpubChrome(); renderEpubBook(); }
    jumpToChapter(b.ch);
  }
}
/* reader tools that live in the normal reader view leave Parallel Read first */
function prLeave(){ if(PR.on) closeParallelRead(); }
window.addEventListener('resize',()=>{
  if(!PR.on) return;
  /* pane heights may have changed (rotation, phone address bar): end room + rail padding follow at once */
  Object.values(PR.panes).forEach(P=>{ if(P) prPadEnd(P); });
  prRailPads();
  prRefreshRails();
  /* width changed: pages re-lay-out by themselves; put each book back on its page and redraw pages sharp at the new size */
  if(window.innerWidth===PR.lastW) return;
  PR.lastW=window.innerWidth;
  clearTimeout(PR.resizeT);
  PR.resizeT=setTimeout(()=>{
    if(!PR.on) return;
    ['L','R'].forEach(s=>{ let P=PR.panes[s]; if(!P||!P.lastPos) return; let us=prUnits(P), u=us[Math.min(P.lastPos.i,us.length-1)]; if(u) prMoveTo(P,u.top+P.lastPos.f*u.h); });
    prSyncFrom('L'); prRefreshRails(); prRefreshPages();
  },250);
});

/* ============ Parallel Read: annotations, text marks and handwriting ============
   TEXT MARKS work exactly as in the normal reader, on either book: select
   text in a pane (a small bar appears beside it, or use More > Highlight /
   Underline / Strikethrough) and the mark is saved to THAT book's
   annotations with its page or chapter. Marks are redrawn whenever a page
   or chapter is shown (PDF text layers do it as they draw; EPUB panes as
   they are built) and appear in the normal reader too. "Marks" lists the
   marks of the book in use, tap one to jump there, and exports them.
   HANDWRITING ("Annotate") draws on the PDF pages themselves: pen,
   highlighter, eraser, colours, three sizes, undo / redo. One finger or a
   pen draws, two fingers scroll; a touch while the pen is down is a palm.
   The ink lives in the PDF's own annotation notebook (the one "Annotate
   this PDF" opens), in that notebook's page coordinates, so the same ink
   shows in Parallel Read and in the editor. If the PDF has no annotation
   notebook yet, one is made on the first stroke, its page pictures are
   drawn from the PDF only when the editor first shows them. EPUB text
   reflows, so handwriting cannot stay attached to it: PDFs only. */
const PRA={marksChanged:false, inkOn:{L:false,R:false}, inkBook:{L:null,R:null}, pending:{L:false,R:false}, barSide:null, hist:{}, tool:'pen', penColor:'#18202B', hiColor:'#F2D887', size:4, style:'solid', fill:false, eraserMode:'stroke',
  undo:[], redo:[], stroke:null, strokeHolder:null, strokeSide:null, strokePtr:null, erase:null, ptrs:new Map(), pan:null, last:null, raf:0, selT:null, warnedEpub:false};
/* PRA.ink: is any book being annotated (read-only) */
Object.defineProperty(PRA,'ink',{get(){ return !!(PRA.inkOn.L || PRA.inkOn.R); }});
const PR_PEN_COLORS=['#18202B','#2C4A6E','#A83A2C','#3F5C46','#57425F','#A9652B','#2B5F5B','#9A4A60'];
const PR_HI_COLORS=['#F2D887','#B9D8A8','#A9CBE8','#E8B3C0','#E8C49A'];

/* ---------- text marks ---------- */
function prSideOfNode(node){
  let el=node && (node.nodeType===1? node : node.parentElement);
  let pane=el && el.closest && el.closest('.prPane'); if(!pane) return null;
  return pane.id==='prPaneL'? 'L' : pane.id==='prPaneR'? 'R' : null;
}
function prAnnotateSelection(kind){
  let sel=readerSelection(), text=sel.toString().trim();
  if(!text || !sel.rangeCount){ toast('Select some text in one of the books first'); return; }
  let range=sel.getRangeAt(0), node=range.commonAncestorContainer, el=node.nodeType===1? node : node.parentElement;
  let side=prSideOfNode(el); if(!side){ toast('Select text inside one of the two books'); return; }
  let P=PR.panes[side]; if(!P) return; let b=P.book, where;
  if(b.kind==='pdf'){ let pg=el.closest('.prPage'); if(!pg){ toast('Select text on one page at a time'); return; } where='PDF page '+pg.dataset.page; }
  else { let sec=el.closest('section[data-unit]'); if(!sec){ toast('Select text inside one chapter at a time'); return; } let k=+sec.dataset.unit; where='Chapter '+(k+1)+', '+((b.chapters[k]||{}).title||''); }
  let annoId='a_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
  try{ wrapRangeAsMark(range,kind,markColorFor(b,kind),markOpacityFor(b,kind),annoId); }catch(e){ toast('Select a clean stretch inside one paragraph'); return; }
  if(!b.annotations) b.annotations=[];
  b.annotations.push({id:annoId, text:text, where:where, kind:kind, color:markColorFor(b,kind), opacity:markOpacityFor(b,kind)});
  sel.removeAllRanges(); prHideSelBar();
  PRA.marksChanged=true;
  prSetActive(side); prUpdateMarksBtn();
  if(b===curBook()) renderReaderSide(); scheduleSave();
  toast((kind==='highlight'?'Highlighted': kind==='underline'?'Underlined':'Struck through')+' in “'+b.title+'”, saved to its annotations');
}
/* put an EPUB book's saved marks back on its chapters in a pane */
function prReapplyEpubMarks(P){
  (P.book.annotations||[]).forEach(a=>{
    let m=/Chapter\s+(\d+)/.exec(a.where||''); if(!m) return;
    let sec=P.el.querySelector('section[data-unit="'+(+m[1]-1)+'"]'); if(sec) (wrapTextAcross(sec,a.text,a.kind||'highlight',a.color,a.opacity,a.id)||wrapTextOnce(sec,a.text,a.kind||'highlight',a.color,a.opacity,a.id));
  });
}
/* the little bar beside a selection */
function prSelInfo(){
  if(!PR.on) return null;
  let sel=window.getSelection(); if(!sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) return null;
  let r=sel.getRangeAt(0), side=prSideOfNode(r.commonAncestorContainer); if(!side || PRA.inkOn[side]) return null; /* the other book can be marked while one is annotated */
  let rect=r.getBoundingClientRect(); if(!rect.width && !rect.height){ let rs=r.getClientRects(); if(!rs.length) return null; rect=rs[0]; }
  return {rect:rect};
}
function prShowSelBar(){
  let bar=$('prSelBar'); if(!bar) return;
  let info=prSelInfo(); if(!info){ prHideSelBar(); return; }
  bar.classList.remove('hidden'); renderSelColor();
  let bw=bar.offsetWidth, bh=bar.offsetHeight, r=info.rect, coarse=window.matchMedia && matchMedia('(pointer:coarse)').matches;
  let x=Math.max(8,Math.min(window.innerWidth-bw-8, r.left+r.width/2-bw/2));
  /* above the selection with a mouse; below it on touch screens, clear of the phone's own copy / paste menu */
  let y= coarse? r.bottom+10 : r.top-bh-8;
  if(y<8) y=r.bottom+8;
  if(y+bh>window.innerHeight-8) y=Math.max(8,r.top-bh-8);
  bar.style.left=Math.round(x)+'px'; bar.style.top=Math.round(y)+'px';
}
function prHideSelBar(){ let b=$('prSelBar'); if(b) b.classList.add('hidden'); hideSelColorPop(); }
document.addEventListener('selectionchange',()=>{ if(!PR.on) return; clearTimeout(PRA.selT); PRA.selT=setTimeout(prShowSelBar,120); });
['L','R'].forEach(s=>$('prPane'+s).addEventListener('scroll',()=>{ let b=$('prSelBar'); if(b && !b.classList.contains('hidden')) prShowSelBar(); },{passive:true}));
/* "Marks": the marks of the book in use */
function prToggleMarks(btn){
  let d=$('prMarksSheet'); if(!d) return;
  if(d.open){ d.close(); if(btn) btn.setAttribute('aria-expanded','false'); }
  else { prRenderMarks(); d.showModal(); if(btn) btn.setAttribute('aria-expanded','true'); }
}
function prCloseMarks(){ let d=$('prMarksSheet'); if(d && d.open) d.close(); let b=$('prMarksBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function prRenderMarks(){
  let body=$('prMarksBody'), P=PR.panes[PR.active]; if(!body) return;
  let t=$('prMarksTitle');
  if(!P){ if(t) t.textContent='Marks'; body.innerHTML=''; return; }
  let b=P.book, list=b.annotations||[];
  if(t) t.textContent='Marks in “'+b.title+'”'+(list.length?' ('+list.length+')':'');
  body.innerHTML=(list.length
      ? '<div class="prMarksList">'+list.map((a,i)=>'<button type="button" class="prMarkRow" data-i="'+i+'"><span class="prMarkKind '+esc(a.kind||'highlight')+'" style="background:'+annoSwatch(a)+'" aria-hidden="true"></span><span class="prMarkText">“'+esc(String(a.text).slice(0,100))+'”</span><span class="kbd">'+esc(a.where||'')+(a.kind&&a.kind!=='highlight'?' · '+esc(a.kind):'')+'</span></button>').join('')+'</div>'
        +'<div class="prMarksFoot"><button class="btn small" type="button" onclick="exportAnnotationsFor(PR.panes[PR.active]&&PR.panes[PR.active].book)">Export marks</button></div>'
      : '<p class="kbd" style="margin:10px 4px 2px;line-height:1.5">No marks yet, select text in this book, then Highlight, Underline or Strikethrough.</p>');
}
function prUpdateMarksBtn(){
  let P=PR.panes[PR.active], n=P? (P.book.annotations||[]).length : 0, c=$('prMarksCount');
  if(c) c.textContent= n? String(n) : '';
  let d=$('prMarksSheet'); if(d && d.open) prRenderMarks();
}
$('prMarksBody').addEventListener('click',e=>{
  let r=e.target.closest('.prMarkRow'); if(!r) return;
  let P=PR.panes[PR.active]; if(!P) return;
  let a=(P.book.annotations||[])[+r.dataset.i]; if(!a) return;
  let m=/(?:PDF page|Chapter)\s+(\d+)/.exec(a.where||''); if(m) prJump(PR.active,+m[1]-1);
  prCloseMarks();
});

/* ---------- handwriting on both books ("Annotate", right in Parallel Read) ----------
   The same drawing tools as the editor, on the page itself: pen, calligraphy
   pen, highlighter, eraser (whole stroke, or cut only where you rub), line,
   rectangle, ellipse, arrow (optionally filled), the size slider with its
   plain-word sizes, the ink colours plus a custom colour, solid / dashed /
   dotted / dash-dot lines, undo / redo. Strokes are the editor's own stroke
   objects drawn by the editor's own drawStroke(), so they look the same in
   both places. "Open in editor" goes to the same notebook page for the
   editor-only extras (text, images, stickies, LaTeX, floating board). */
const PR_PEN_TOOLS=['pen','calligraphy','highlighter','eraser','line','rect','ellipse','arrow'];
function prInkNotebook(book,create){
  let nb=S.items.find(i=>i.kind==='notebook' && i.pdfBookId===book.id);
  if(nb || !create) return nb||null;
  let sizes=book._pageSizes||[];
  nb={id:uid(),kind:'notebook',title:'Annotations for '+book.title,color:'#1e3a5f',template:'blank',cur:0,updated:'Just now',annotations:[],pdfBookId:book.id,pages:[]};
  for(let n=1;n<=book.numPages;n++){ let pg=blankPage(), sz=sizes[n-1]||sizes[0]||[612,792]; pg.bgPdf={img:null,imgData:null,page:n,bookTitle:book.title,w:sz[0],h:sz[1]}; nb.pages.push(pg); }
  S.items.unshift(nb); scheduleSave();
  return nb;
}
/* the notebook page holding the ink of PDF page n (matched by PDF page, so reordering pages in the editor is fine) */
function prInkPage(book,n,create){
  let nb=prInkNotebook(book,create); if(!nb) return null;
  let pg=nb.pages.find(p=>p.bgPdf && p.bgPdf.page===n);
  if(!pg && create){
    let sz=(book._pageSizes||[])[n-1]||[612,792];
    pg=blankPage(); pg.bgPdf={img:null,imgData:null,page:n,bookTitle:book.title,w:sz[0],h:sz[1]};
    let at=nb.pages.findIndex(p=>p.bgPdf && p.bgPdf.page>n); if(at<0) at=nb.pages.length;
    nb.pages.splice(at,0,pg); scheduleSave();
  }
  return pg||null;
}
/* where the PDF page sits inside the notebook page (the editor's own fit: centred, scaled to fit) */
function prInkGeom(book,n,pg){
  let sz=(pg && bgPdfSize(pg.bgPdf)) || (book._pageSizes && book._pageSizes[n-1]) || [612,792];
  /* the notebook page's own height for this PDF page (same clamp as pageH),
     never the editor's current page height, so the overlay lands right
     even when the reader opens without the editor having been there */
  let PHp=Math.max(400,Math.min(2200,Math.round(CW*sz[1]/sz[0])));
  let s=Math.min(CW/sz[0],PHp/sz[1]), dw=sz[0]*s, dh=sz[1]*s;
  return {ox:(CW-dw)/2, oy:(PHp-dh)/2, dw:dw, dh:dh};
}
/* Annotate works on EVERY book in Parallel Read: PDF pages and EPUB chapters alike.
   A "surface" is one PDF page (.pdfHolder; ink kept in the PDF's annotation notebook, in the
   editor's page coordinates) or one EPUB chapter (its <section>; ink kept on the book itself in
   book.parallelInk, in coordinates scaled to the chapter's width, CW units across). */
function prSurfSel(P){ return P.book.kind==='pdf'? '.pdfHolder' : 'section[data-unit]'; }
function prSurfN(h){ return h.dataset.n? +h.dataset.n : (+h.dataset.unit)+1; }   /* page / chapter number, 1-based */
function prSurfReady(P,h){ return P.book.kind==='pdf'? !!h._drawn : true; }
function prSurfFor(P,n){ return P.el.querySelector(P.book.kind==='pdf'? '.pdfHolder[data-n="'+n+'"]' : 'section[data-unit="'+(n-1)+'"]'); }
function prInkPageOf(P,n,create){
  if(P.book.kind==='pdf') return prInkPage(P.book,n,create);
  let book=P.book;
  if(!book.parallelInk || typeof book.parallelInk!=='object'){ if(!create) return null; book.parallelInk={}; }
  let pg=book.parallelInk[n];
  if(!pg && create){ pg=book.parallelInk[n]={ink:[],hi:[]}; scheduleSave(); }
  if(pg){ if(!Array.isArray(pg.ink)) pg.ink=[]; if(!Array.isArray(pg.hi)) pg.hi=[]; }
  return pg||null;
}
function prGeomOf(P,n,pg,h){
  if(P.book.kind==='pdf') return prInkGeom(P.book,n,pg);
  let r=h.getBoundingClientRect(), w=Math.max(1,r.width);
  return {ox:0, oy:0, dw:CW, dh:CW*Math.max(1,r.height)/w};
}
function prRenderInk(P,holder){
  if(!P || !holder || !holder.isConnected) return;
  let n=prSurfN(holder), pg=prInkPageOf(P,n,false);
  let live= PRA.stroke && PRA.strokeHolder===holder ? PRA.stroke : null;
  let cv=holder.querySelector(':scope > canvas.prInk');
  let hasInk= pg && ((pg.ink&&pg.ink.length)||(pg.hi&&pg.hi.length));
  if(!hasInk && !live && !PRA.inkOn[P.side]){ if(cv) cv.remove(); return; }
  let r=holder.getBoundingClientRect(); if(r.width<10 || r.height<4) return;
  if(P.book.kind!=='pdf' && !live){ /* long chapters: keep canvases only near what is on screen */
    let pr=P.el.getBoundingClientRect();
    if(r.bottom<pr.top-1500 || r.top>pr.bottom+1500){ if(cv) cv.remove(); return; }
  }
  let dpr=Math.min(2,window.devicePixelRatio||1);
  dpr=Math.max(0.25,Math.min(dpr, Math.sqrt(16e6/(r.width*r.height)), 16000/r.height, 16000/r.width)); /* stay within canvas limits */
  if(!cv){ cv=document.createElement('canvas'); cv.className='prInk'; cv.setAttribute('aria-hidden','true'); holder.appendChild(cv); }
  let W=Math.max(1,Math.round(r.width*dpr)), Hh=Math.max(1,Math.round(r.height*dpr));
  if(cv.width!==W || cv.height!==Hh){ cv.width=W; cv.height=Hh; }
  let x=cv.getContext('2d'); x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,W,Hh);
  let g=prGeomOf(P,n,pg,holder), kx=W/g.dw, ky=Hh/g.dh;
  x.setTransform(kx,0,0,ky,-g.ox*kx,-g.oy*ky); x.lineCap='round'; x.lineJoin='round';
  if(pg){ (pg.hi||[]).forEach(st=>drawStroke(x,st)); (pg.ink||[]).forEach(st=>drawStroke(x,st)); }
  if(live) drawStroke(x,live);
}
/* redraw every ready surface of a book pane (on/off, zoom, scrolling a long EPUB, resize) */
function prRefreshInk(P){ if(!P || !PR.on || !P.el.isConnected) return; P.el.querySelectorAll(prSurfSel(P)).forEach(h=>{ if(prSurfReady(P,h)) prRenderInk(P,h); }); }
function prRedrawInkFor(book,n){ ['L','R'].forEach(s=>{ let P=PR.panes[s]; if(!P || P.book!==book) return; let h=prSurfFor(P,n); if(h && prSurfReady(P,h)) prRenderInk(P,h); }); }
{ let rafE={L:0,R:0};
  ['L','R'].forEach(s=>$('prPane'+s).addEventListener('scroll',()=>{ let P=PR.panes[s]; if(!P || P.book.kind==='pdf' || rafE[s]) return; rafE[s]=requestAnimationFrame(()=>{ rafE[s]=0; prRefreshInk(PR.panes[s]); }); },{passive:true}));
  window.addEventListener('resize',()=>{ if(PR.on) ['L','R'].forEach(s=>{ let P=PR.panes[s]; if(P && P.book.kind!=='pdf') requestAnimationFrame(()=>prRefreshInk(P)); }); });
}
/* ONE "Annotate" button for Parallel Read: it switches Annotate on for BOTH books at once,
   PDF or EPUB, so you can draw on either one straight away. Done (or Esc) switches it off
   for both. One undo / redo history covers both books, in the order you drew. */
function prUpdateAnnotateFab(){
  let has=!!(PR.on && (PR.panes.L || PR.panes.R)), on=!!(PRA.inkOn.L || PRA.inkOn.R), waiting=!!(PRA.pending.L || PRA.pending.R);
  let f=$('prAnnotateFab');
  if(f) f.classList.toggle('hidden', !PR.on || on || waiting || (!has && !PR.suspend));
  ['L','R'].forEach(s=>{
    let el=$('prPane'+s), col=el && el.closest('.prCol'); if(col) col.classList.toggle('prInkOn', !!(PR.on && PR.panes[s] && PRA.inkOn[s]));
  });
}
/* the blue "Annotate" button */
function prAnnotateThisPdf(){
  if(PR.suspend || !(PR.panes.L || PR.panes.R)){ PRA.pending={L:true,R:true}; prUpdateAnnotateFab(); toast('Annotate starts as soon as the books have loaded'); return; } /* still loading: switch on when ready */
  prToggleInk(true);
}
function prSetInk(side,on,quiet){
  let P=PR.panes[side];
  if(on && !P) return;
  PRA.pending[side]=false;
  if(!on && PRA.strokeSide===side) prInkCancel();
  if(!on && PRA.erase && PRA.erase.side===side) PRA.erase=null;
  PRA.inkOn[side]=!!on; PRA.inkBook[side]= on? P.book.id : null;
  let other= side==='L'? 'R' : 'L';
  if(on){ PRA.barSide=side; let sel=window.getSelection(); if(sel && sel.rangeCount && prSideOfNode(sel.getRangeAt(0).commonAncestorContainer)===side) sel.removeAllRanges(); prHideSelBar(); }
  else if(PRA.barSide===side) PRA.barSide= PRA.inkOn[other]? other : null;
  let any=PRA.inkOn.L || PRA.inkOn.R;
  $('parallelRead').classList.toggle('prInking',any);
  $('prInkBar').classList.toggle('hidden',!any);
  if(any) prRenderInkBar();
  if(P) prRefreshInk(P);
  prUpdateAnnotateFab();
}
/* Annotate on (both books) / off (both books): the button, Done, Esc, leaving */
function prToggleInk(force,quiet){
  let on= typeof force==='boolean'? force : !(PRA.inkOn.L || PRA.inkOn.R);
  if(on){
    let sides=['L','R'].filter(s=>PR.panes[s]); if(!sides.length) return;
    sides.forEach(s=>prSetInk(s,true,true));
    PRA.barSide= PR.panes[PR.active]? PR.active : sides[0]; prRenderInkBar();
    if(!quiet) toast(sides.length>1? 'Annotate is on for both books: draw on either one. Two fingers scroll.' : 'Annotate is on: one finger or a pen draws, two fingers scroll.');
  } else { ['L','R'].forEach(s=>{ if(PRA.inkOn[s]) prSetInk(s,false,true); }); PRA.pending={L:false,R:false}; prUpdateAnnotateFab(); }
}
/* the pen bar's Done: Annotate off for both books */
function prInkDone(){ prToggleInk(false,true); }
function prInkColor(){ return PRA.tool==='highlighter'? PRA.hiColor : PRA.penColor; }
function prRenderInkBar(){
  let bar=$('prInkBar'); if(!bar) return;
  bar.querySelectorAll('[data-tool]').forEach(b=>{ let on=b.dataset.tool===PRA.tool; b.classList.toggle('active',on); b.setAttribute('aria-pressed',on?'true':'false'); });
  let er=PRA.tool==='eraser', hi=PRA.tool==='highlighter', shape=SHAPE_TOOLS.indexOf(PRA.tool)>=0;
  let box=$('prInkSwatches');
  if(er) box.innerHTML='';
  else {
    let cols= hi? PR_HI_COLORS : PR_PEN_COLORS, cur=prInkColor();
    box.innerHTML=cols.map(c=>'<button type="button" class="swatch'+(c.toLowerCase()===String(cur).toLowerCase()?' active':'')+'" style="background:'+c+'" data-color="'+c+'" aria-label="Colour '+c+'" aria-pressed="'+(c===cur)+'"></button>').join('');
  }
  let cp=$('prInkCustom'); cp.classList.toggle('hidden',er); if(/^#[0-9a-f]{6}$/i.test(prInkColor())) cp.value=prInkColor();
  $('prInkStyleWrap').classList.toggle('hidden',er||hi);
  $('prInkFillWrap').classList.toggle('hidden',!(PRA.tool==='rect'||PRA.tool==='ellipse'));
  $('prInkEraserWrap').classList.toggle('hidden',!er);
  $('prInkStyle').value=PRA.style; $('prInkFill').checked=!!PRA.fill; $('prInkEraser').value=PRA.eraserMode;
  $('prInkSize').value=PRA.size; $('prInkSizeWord').textContent=sizeWord(PRA.size);
  prDrawSizePreview();
  $('prUndoBtn').disabled=!PRA.undo.length; $('prRedoBtn').disabled=!PRA.redo.length;
  let both=PR.panes.L && PR.panes.R && PRA.inkOn.L && PRA.inkOn.R, one=PR.panes[PRA.inkOn.L? 'L' : 'R'];
  let who=$('prInkWho'); if(who) who.textContent= both? 'both books' : one? one.book.title : '';
  let BP=PR.panes[PRA.barSide], ed=$('prOpenEditorBtn'); if(ed) ed.classList.toggle('hidden', !(BP && BP.book.kind==='pdf'));
}
/* the size preview: the next stroke at its real width (at 100% zoom), on page-coloured paper */
function prDrawSizePreview(){
  let c=$('prInkSizePreview'); if(!c) return; let x=c.getContext('2d'); x.clearRect(0,0,c.width,c.height);
  let v=PRA.size, my=c.height/2; x.lineCap='round';
  if(PRA.tool==='eraser'){ x.strokeStyle='#b2261e'; x.lineWidth=1.6; x.setLineDash([4,3]); x.beginPath(); x.arc(c.width/2,my,Math.min(13,5+v*0.55),0,7); x.stroke(); return; }
  let w= PRA.tool==='highlighter'? Math.min(26,v*4.5) : SHAPE_TOOLS.indexOf(PRA.tool)>=0? Math.max(1.5,v*1.4) : PRA.tool==='calligraphy'? v*1.7 : v*1.8;
  x.strokeStyle=prInkColor(); x.globalAlpha= PRA.tool==='highlighter'? 0.45 : 1; x.lineWidth=Math.max(1,w);
  x.beginPath(); x.moveTo(5,my+3); x.quadraticCurveTo(c.width/2,my-4,c.width-5,my+3); x.stroke(); x.globalAlpha=1;
}
function prSetInkTool(t){ if(PR_PEN_TOOLS.indexOf(t)<0) t='pen'; PRA.tool=t; prRenderInkBar(); }
function prSetInkSize(v){ v=Math.round(+v); PRA.size=Math.max(1,Math.min(16,isFinite(v)? v : 4)); prRenderInkBar(); }
function prSetInkColor(c){ if(!/^#[0-9a-f]{6}$/i.test(c)) return; if(PRA.tool==='highlighter') PRA.hiColor=c; else PRA.penColor=c; prRenderInkBar(); }
$('prInkSwatches').addEventListener('click',e=>{ let b=e.target.closest('[data-color]'); if(b) prSetInkColor(b.dataset.color); });
/* "Open in editor": the same notebook, at the page in use, for text, images, stickies, LaTeX, the board */
function prOpenInEditor(){
  let s= PR.panes[PRA.barSide]&&PR.panes[PRA.barSide].book.kind==='pdf'? PRA.barSide : ['L','R'].find(x=>PR.panes[x] && PR.panes[x].book.kind==='pdf');
  if(!s){ toast('The editor extras (text, images, stickies) are for PDF pages; your handwriting on this book stays here'); return; }
  let P=PR.panes[s], n=prPos(P).i+1, book=P.book;
  let nb=prInkNotebook(book,true); prInkPage(book,n,true);
  let i=nb.pages.findIndex(p=>p.bgPdf && p.bgPdf.page===n);
  closeParallelRead(true);
  openNotebook(nb.id); if(i>=0) switchPage(i);
  toast('The same page in the editor, everything you add here shows in Parallel Read too');
}
/* page coordinates (the notebook page's) of a pointer over a page */
/* Pen hover ring on Parallel Read surfaces (same ring as the editor,
   sized from the surface's own scale). A hovering pen has no pointerdown,
   so it is not in PRA.ptrs — the pane is found from the event target. */
function prHoverRec(e){
  for(let side of ['L','R']){ let P=PR.panes[side]; if(!P) continue;
    if(e.target && e.target.closest && e.target.closest(prSurfSel(P))) return {side:side}; }
  return null;
}
function prHoverSurface(e,rec){
  if(!rec) return null;
  let P=PR.panes[rec.side]; if(!P) return null;
  let h=e.target && e.target.closest? e.target.closest(prSurfSel(P)) : null;
  return h||null;
}
function prHoverMove(e,rec){
  let h=prHoverSurface(e,rec); if(!h){ hidePenHoverRing(null); return; }
  let P=PR.panes[rec.side], n=prSurfN(h), g=prGeomOf(P,n,prInkPageOf(P,n,false),h);
  if(!g||!g.dw) return;
  let r=h.getBoundingClientRect(), scale=r.width/g.dw;
  let w=(PRA.tool==='highlighter'? PRA.size*4.5 : PRA.size*1.4)*scale;
  showPenHoverRing(e.clientX,e.clientY,Math.max(6,w),prInkColor(),h);
}
function prInkPoint(P,h,e){
  let r=h.getBoundingClientRect(), n=prSurfN(h), g=prGeomOf(P,n,prInkPageOf(P,n,false),h);
  let fx=(e.clientX-r.left)/r.width, fy=(e.clientY-r.top)/r.height, p;
  if(e.pointerType==='pen' && e.pressure>0) p=penPressureCurve(e.pressure);
  else if(PRA.last){ let d=Math.hypot(e.clientX-PRA.last.x,e.clientY-PRA.last.y); p=Math.max(0.25,Math.min(1,1.05-d/30)); } /* mouse / finger: faster = thinner */
  else p=0.6;
  return {x:g.ox+fx*g.dw, y:g.oy+fy*g.dh, p:p};
}
function prMid(ps){ return {x:(ps[0].x+ps[1].x)/2, y:(ps[0].y+ps[1].y)/2}; }
function prInkCancel(){
  let h=PRA.strokeHolder, side=PRA.strokeSide;
  PRA.stroke=null; PRA.strokeHolder=null; PRA.strokeSide=null; PRA.strokePtr=null; PRA.erase=null; PRA.last=null;
  if(h && PR.panes[side]) prRenderInk(PR.panes[side],h);
}
/* one undo / redo history for both books, in the order things were drawn */
function prInkSnapshot(book,pg,n){ PRA.undo.push({book:book, n:n, pg:pg, ink:cloneStrokes(pg.ink), hi:cloneStrokes(pg.hi)}); if(PRA.undo.length>120) PRA.undo.shift(); PRA.redo=[]; }
function prInkStep(dir){
  let from= dir<0? PRA.undo : PRA.redo, to= dir<0? PRA.redo : PRA.undo;
  let st=from.pop(); if(!st){ toast(dir<0? 'Nothing to undo' : 'Nothing to redo'); return; }
  to.push({book:st.book, n:st.n, pg:st.pg, ink:cloneStrokes(st.pg.ink), hi:cloneStrokes(st.pg.hi)});
  st.pg.ink=st.ink; st.pg.hi=st.hi; bumpV(st.pg); prRedrawInkFor(st.book,st.n); prRenderInkBar();
}
function prInkUndo(){ prInkStep(-1); }
function prInkRedo(){ prInkStep(1); }
/* eraser, whole-stroke mode: removes strokes it touches, swept from the last sample to this one (the editor's test) */
function prStrokeHit(st,a,b,r){
  let tol=r+strokeWidthOf(st)/2, polys= st.tool==='shape'? shapeToPolylines(st) : [st];
  for(let pi=0;pi<polys.length;pi++){
    let pts=polys[pi].points; if(!pts || !pts.length) continue;
    if(pts.length===1){ if(distPtSeg(pts[0].x,pts[0].y,a.x,a.y,b.x,b.y)<=tol) return true; continue; }
    for(let i=1;i<pts.length;i++) if(segSegDist(a,b,pts[i-1],pts[i])<=tol) return true;
  }
  return false;
}
function prEraseAt(P,h,a,b){
  let n=prSurfN(h), pg=prInkPageOf(P,n,false); if(!pg) return;
  let hit=false, snap=()=>{ if(!PRA.erase.snap){ prInkSnapshot(P.book,pg,n); PRA.erase.snap=true; } };
  if(PRA.eraserMode==='split'){
    /* cut mode: the editor's padded-box splitter, only the rubbed stretch goes, the rest of the stroke stays */
    let half=8+PRA.size;
    ['ink','hi'].forEach(layer=>{
      let out=[], changed=false;
      pg[layer].forEach(st=>{
        let list= st.tool==='shape'? shapeToPolylines(st) : [st], any=false, pieces=[];
        list.forEach(t=>{ let res=eraseStrokeSplit(t,{cx:b.x, cy:b.y, half:half, halfPad:half+ERASE_PAD_COEFF*strokeWidthOf(t)}); if(res===null) pieces.push(t); else { any=true; res.forEach(x=>pieces.push(x)); } });
        if(!any) out.push(st); else { changed=true; pieces.forEach(x=>out.push(x)); }
      });
      if(changed){ snap(); pg[layer]=out; hit=true; }
    });
  } else {
    let r=10+PRA.size*2;
    ['ink','hi'].forEach(layer=>{
      let keep=pg[layer].filter(st=>!prStrokeHit(st,a,b,r));
      if(keep.length!==pg[layer].length){ snap(); pg[layer]=keep; hit=true; }
    });
  }
  if(hit){ bumpV(pg); prRenderInk(P,h); }
}
function prInkDown(side,e){
  if(!PR.on || !PRA.inkOn[side]) return; /* this book is not being annotated: it reads, selects and scrolls as usual */
  let P=PR.panes[side]; if(!P) return;
  PRA.ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType,side:side});
  if(e.pointerType==='pen') notePenSeen();
  if(PRA.barSide!==side){ PRA.barSide=side; prRenderInkBar(); }
  let all=[...PRA.ptrs.values()], touches=all.filter(p=>p.type==='touch');
  if(e.pointerType==='touch' && all.some(p=>p.type==='pen')) return;            /* a palm resting while the pen draws */
  if(touches.length>=2){ prInkCancel(); PRA.pan={side:side, mid:prMid(touches)}; e.preventDefault(); return; } /* two fingers: scroll */
  if(e.pointerType==='touch' && penOnlyActive()){ prInkCancel(); PRA.pan={side:side, mid:{x:e.clientX,y:e.clientY}, single:e.pointerId}; e.preventDefault(); return; } /* Pen only: one finger scrolls */
  if(PRA.pan) return;
  let h=e.target.closest && e.target.closest(prSurfSel(P)); if(!h || !P.el.contains(h) || !prSurfReady(P,h)) return;
  e.preventDefault();
  try{ P.el.setPointerCapture(e.pointerId); }catch(err){}
  PRA.last=null;
  let pt=prInkPoint(P,h,e);
  if(PRA.tool==='eraser'){ PRA.erase={side:side, h:h, last:pt, snap:false, ptr:e.pointerId}; prEraseAt(P,h,pt,pt); return; }
  if(SHAPE_TOOLS.indexOf(PRA.tool)>=0){
    PRA.stroke={tool:'shape', shape:PRA.tool, color:PRA.penColor, size:PRA.size, fill:!!PRA.fill && (PRA.tool==='rect'||PRA.tool==='ellipse'), style:PRA.style, points:[{x:pt.x,y:pt.y},{x:pt.x,y:pt.y}]};
  } else {
    PRA.stroke={tool:PRA.tool, color:prInkColor(), size:PRA.size, style: PRA.tool==='highlighter'? 'solid' : PRA.style, points:(pt.p>0?[pt]:[])};
  }
  PRA.strokeHolder=h; PRA.strokeSide=side; PRA.strokePtr=e.pointerId; PRA.last={x:e.clientX,y:e.clientY};
  prRenderInk(P,h);
}
function prInkMove(e){
  if(!PRA.inkOn.L && !PRA.inkOn.R) return;
  let rec=PRA.ptrs.get(e.pointerId); if(rec){ rec.x=e.clientX; rec.y=e.clientY; }
  if(e.pointerType==='pen' && e.buttons===0 && !PRA.stroke && !PRA.pan && !PRA.erase){ prHoverMove(e,rec||prHoverRec(e)); } else if(e.pointerType==='pen'){ hidePenHoverRing(prHoverSurface(e,rec)); }
  if(PRA.pan){
    if(PRA.pan.single){ let r2=PRA.ptrs.get(PRA.pan.single); if(!r2) return; let P=PR.panes[PRA.pan.side]; if(P){ P.el.scrollTop-=(r2.y-PRA.pan.mid.y); P.el.scrollLeft-=(r2.x-PRA.pan.mid.x); } PRA.pan.mid={x:r2.x,y:r2.y}; e.preventDefault(); return; }
    let touches=[...PRA.ptrs.values()].filter(p=>p.type==='touch'); if(touches.length<2) return;
    let m=prMid(touches), P=PR.panes[PRA.pan.side];
    if(P){ P.el.scrollTop-=(m.y-PRA.pan.mid.y); P.el.scrollLeft-=(m.x-PRA.pan.mid.x); }
    PRA.pan.mid=m; e.preventDefault(); return;
  }
  /* only the pointer that started the stroke draws it, a resting palm's movement is ignored */
  if(PRA.erase){ if(e.pointerId!==PRA.erase.ptr) return; let er=PRA.erase, P=PR.panes[er.side]; if(!P) return; e.preventDefault(); let pt=prInkPoint(P,er.h,e); prEraseAt(P,er.h,er.last,pt); er.last=pt; return; }
  if(!PRA.stroke || !rec || e.pointerId!==PRA.strokePtr) return;
  e.preventDefault();
  let P=PR.panes[PRA.strokeSide], h=PRA.strokeHolder; if(!P) return;
  if(PRA.stroke.tool==='shape'){ let pt=prInkPoint(P,h,e); PRA.stroke.points[1]={x:pt.x,y:pt.y}; }
  else (e.getCoalescedEvents? e.getCoalescedEvents() : [e]).forEach(ev=>{ let q=prInkPoint(P,h,ev); if(q.p<=0) return; /* dead zone */ PRA.stroke.points.push(q); PRA.last={x:ev.clientX,y:ev.clientY}; });
  if(!PRA.raf) PRA.raf=requestAnimationFrame(()=>{ PRA.raf=0; if(PRA.stroke && PR.panes[PRA.strokeSide]) prRenderInk(PR.panes[PRA.strokeSide],PRA.strokeHolder); });
}
function prInkUp(e){
  if(!PRA.ptrs.has(e.pointerId)) return;
  PRA.ptrs.delete(e.pointerId);
  if(PRA.pan){ if(PRA.pan.single){ if(e.pointerId===PRA.pan.single) PRA.pan=null; return; } if([...PRA.ptrs.values()].filter(p=>p.type==='touch').length<2) PRA.pan=null; return; }
  if(PRA.erase){ if(e.pointerId===PRA.erase.ptr){ PRA.erase=null; prRenderInkBar(); } return; }
  if(!PRA.stroke || e.pointerId!==PRA.strokePtr) return; /* a palm lifting does not end the pen's stroke */
  let st=PRA.stroke, side=PRA.strokeSide, P=PR.panes[side], h=PRA.strokeHolder;
  PRA.stroke=null; PRA.strokeHolder=null; PRA.strokeSide=null; PRA.strokePtr=null; PRA.last=null;
  if(!P || !h) return;
  if(st.tool==='shape' && Math.hypot(st.points[1].x-st.points[0].x, st.points[1].y-st.points[0].y)<3){ prRenderInk(P,h); return; } /* a tap is not a shape */
  if(st.points.length===0){ prRenderInk(P,h); return; } /* pen never pressed past the dead zone */
  let n=prSurfN(h), pg=prInkPageOf(P,n,true);
  prInkSnapshot(P.book,pg,n);
  (st.tool==='highlighter'? pg.hi : pg.ink).push(st); S.stats.strokes++; bumpV(pg);
  prRenderInk(P,h); prRenderInkBar();
}
['L','R'].forEach(s=>$('prPane'+s).addEventListener('pointerdown',e=>prInkDown(s,e)));
document.addEventListener('pointermove',prInkMove,{passive:false});
document.addEventListener('pointerup',prInkUp);
document.addEventListener('pointercancel',e=>{ if(PRA.ptrs.has(e.pointerId)){ PRA.ptrs.delete(e.pointerId); if(PRA.pan && [...PRA.ptrs.values()].filter(p=>p.type==='touch').length<2) PRA.pan=null; if((PRA.stroke && e.pointerId===PRA.strokePtr) || (PRA.erase && e.pointerId===PRA.erase.ptr)) prInkCancel(); } });
document.addEventListener('keydown',e=>{
  if(!PR.on) return;
  if(e.key==='Escape'){ if(PRA.inkOn.L||PRA.inkOn.R){ prToggleInk(false); e.preventDefault(); } prHideSelBar(); prCloseMarks(); return; }
  if(!(PRA.inkOn.L||PRA.inkOn.R) || !(e.ctrlKey||e.metaKey)) return;
  let k=e.key.toLowerCase();
  if(k==='z' && !e.shiftKey){ e.preventDefault(); prInkUndo(); }
  else if(k==='y' || (k==='z' && e.shiftKey)){ e.preventDefault(); prInkRedo(); }
});
/* leaving Parallel Read: tools off, and the normal reader shows marks made here */
function prAnnotationsOnClose(silent){
  prToggleInk(false,true);
  prHideSelBar(); prCloseMarks(); PRA.ptrs.clear(); PRA.pan=null;
  { let f=$('prAnnotateFab'); if(f) f.classList.add('hidden'); }
  let changed=PRA.marksChanged; PRA.marksChanged=false;
  if(!changed || silent) return false;
  let b=curBook(); if(!b) return false;
  if(b.kind==='epub'){ renderEpubBook(); return false; }
  if(b.kind==='pdf' && pdfDrawIO){ pdfRefresh($('pdfPages'),pdfDrawIO); return false; }
  return false;
}

/* ============ hash routing (P14, safe part) ============
   Routes: #/ (library), #/note/:id (notebook editor), #/book/:id (reader).
   Back/Forward now move between shelf, notebook and book. This stays a
   classic script on purpose: dozens of inline onclick/onchange/oninput
   handlers call these functions as globals, so converting to ES modules
   would break every one of them. No test suite is added in this pass. */
function syncHashForView(v){
  let h= v==='editor' && S.curNbId? '#/note/'+S.curNbId : v==='reader' && S.curBookId? '#/book/'+S.curBookId : '#/';
  if(window.location.hash!==h){ try{ history.pushState(null,'',h); }catch(e){ /* sandboxed frames may refuse pushState, the view still works, only the hash stays stale */ } }
}
function applyRoute(){
  let h=window.location.hash||'#/';
  let mNote=/^#\/note\/(.+)$/.exec(h), mBook=/^#\/book\/(.+)$/.exec(h);
  if(mNote){ let id=decodeURIComponent(mNote[1]); if(S.view==='editor' && S.curNbId===id) return; let nb=S.items.find(i=>i.id===id && i.kind==='notebook'); if(nb){ openNotebook(id); return; } }
  if(mBook){ let id=decodeURIComponent(mBook[1]); if(S.view==='reader' && S.curBookId===id) return; let b=S.items.find(i=>i.id===id && i.kind!=='notebook'); if(b){ openBook(id); return; } }
  if(S.view!=='library') showView('library');
}
window.addEventListener('hashchange',applyRoute);
window.addEventListener('popstate',applyRoute);

/* ============ init ============ */
syncThemeToggle();
updateInkTouchAction();
updateSizeUI();
updateToolOptsUI();
initApp();
async function initApp(){
  /* First paint must not wait for storage. Paint the starter shelf,
     the two built-in demos, straight away, with saves still OFF so
     this placeholder can never overwrite the saved shelf, then swap
     the real shelf in when the restore lands. finishInit() re-adds the
     demos to the restored shelf if they are missing and the restore
     merge keeps anything created in the meantime, so the demos always
     show and are never duplicated. If IndexedDB is unavailable, the
     restore simply reports false and the starter shelf becomes the
     shelf, exactly as a fast failed restore behaved before. */
  startHash=window.location.hash||'';
  let myToken=++restoreToken;
  let restorePromise=(async()=>{ try{ return await restoreLibrary(myToken); }catch(e){ return false; } })();
  if(!S.items.length){ S.items.push(sampleBook()); S.items.push(samplePdfBook()); }
  renderLibrary(); showView('library');
  ensureSamplePdf();
  let initDone=false;
  restorePromise.then(v=>{ if(!initDone){ initDone=true; finishInit(v); } });
  setTimeout(()=>{ if(!initDone) toast('Your saved shelf is taking a while to open. Give it a moment.',4000); },15000);
}
let sigTimerStarted=false;
function finishInit(restored){
  if(!S.items.some(i=>i.id===SAMPLE_ID)) S.items.unshift(sampleBook());
  if(!S.items.some(i=>i.id===SAMPLE_PDF_ID)){ let ix=S.items.findIndex(i=>i.id===SAMPLE_ID); S.items.splice(ix>=0? ix+1 : S.items.length, 0, samplePdfBook()); }
  ensureSamplePdf();
  persistReady=true;
  renderLibrary();
  /* the starter render already reset the hash to the shelf, so replay
     the address the page was actually opened with (a reload while
     reading used to reopen the book; it still does) */
  let routeHash=startHash||window.location.hash||'';
  if(/^#\/(note|book)\//.test(routeHash)){ if(window.location.hash!==routeHash){ try{ history.replaceState(null,'',routeHash); }catch(e){} } applyRoute(); if(S.view==='library' && !S.curNbId && !S.curBookId) showView('library'); }
  else showView('library');
  updateSaveStatus(false);
  if(navigator.storage && navigator.storage.persist){ try{ navigator.storage.persist(); }catch(e){} }
  saveNow(); /* write the restored/fresh shelf back in the current format */
  if(!sigTimerStarted){ sigTimerStarted=true;
    let lastSig=librarySignature();
    setInterval(()=>{ let sig=librarySignature(); if(sig!==lastSig){ lastSig=sig; scheduleSave(); } },4000);
  }
}
