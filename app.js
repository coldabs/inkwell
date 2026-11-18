/* ============ utils ============ */
function $(id){return document.getElementById(id)}
let _uid=1; function uid(){return 'id'+(Date.now().toString(36))+(_uid++)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
let toastT=null;
function toast(msg,ms){let t=$('toast');t.textContent=msg;t.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>t.style.display='none',ms||2600)}
function download(name, blob){let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},400)}
function closeModal(id){$(id).classList.remove('open')}
let pendingConfirm=null;
function askConfirm(title,text,fn){$('confirmTitle').textContent=title;$('confirmText').textContent=text;pendingConfirm=fn;$('confirmModal').classList.add('open')}
function doConfirm(){closeModal('confirmModal');if(pendingConfirm){let f=pendingConfirm;pendingConfirm=null;f()}}
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open'));
  closeAllPopovers();
  let sr=$('searchResults'); if(sr) sr.classList.add('hidden');
  let lh=$('libHint'); if(lh) lh.style.visibility='';
});
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('pointerdown',e=>{ if(e.target===m) m.classList.remove('open'); }));
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
  if(e.defaultPrevented || S.view!=='library') return;
  let el=document.activeElement, tag=el?el.tagName:'';
  if(e.key==='/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !(el&&el.isContentEditable)){
    let s=$('globalSearch'); if(s){ e.preventDefault(); s.focus(); s.select(); }
  }
});

/* ============ architecture note (P12) ============
   This app stays one classic script on purpose: the markup calls these
   functions from inline onclick/onchange/oninput handlers, so they
   must remain globals — an ES-module conversion would break every
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
const CW=1200, CH=800;
let PH=CH; /* live height of the page being edited — portrait PDF pages grow it so the page fills the width instead of shrinking into the middle of a landscape sheet */
function pageH(p){ if(p&&p.bgPdf&&p.bgPdf.img&&p.bgPdf.img.width&&p.bgPdf.img.height){ return Math.max(400,Math.min(2200,Math.round(CW*p.bgPdf.img.height/p.bgPdf.img.width))); } return CH; }
function syncPageHeight(){ let h=pageH(curPageObj()); if(h!==PH||bgC.height!==h){ PH=h; [bgC,hiC,inkC].forEach(c=>{c.height=h}); [bgX,hiX,inkX].forEach(c=>{c.lineCap='round';c.lineJoin='round'}); } }
const SAMPLE_ID='sample-book';
function blankPage(){return {ink:[],hi:[],text:'',stickies:[],table:null,board:null,audio:null,bgPdf:null,texts:[],images:[],texs:[],bgColor:'#fffdf6'}}
function blankBoard(){return {color:0,strokes:[],view:{x:0,y:0,k:1},geom:null}}
const BOARD_COLORS=['#fffdf6','#f6e8c8','#d9e9f7','#dcf0dd','#f8e0e0','#e6def6','#39404e'];
let S={
  items:[], filter:'all',
  curNbId:null, curBookId:null,
  tool:'pen', color:'#18202B',
  undoStack:[], redoStack:[],
  view:'library',
  stats:{writeSec:0, readSec:0, strokes:0, pagesRead:{}, focusDone:0},
  split:false, recording:false, recStart:0,
  searchResults:[], zoom:1, selection:[], selRect:null,
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
function idbOpen(){ return new Promise((res,rej)=>{ if(!('indexedDB' in window)){ rej(new Error('IndexedDB unavailable')); return; } let rq=indexedDB.open(IDB_NAME,1); rq.onupgradeneeded=()=>{ if(!rq.result.objectStoreNames.contains('kv')) rq.result.createObjectStore('kv'); }; rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); rq.onblocked=()=>rej(new Error('IndexedDB blocked')); }); }
let _idbP=null; function idb(){ if(!_idbP) _idbP=idbOpen(); return _idbP; }
async function idbGet(key){ let db=await idb(); return new Promise((res,rej)=>{ let rq=db.transaction('kv','readonly').objectStore('kv').get(key); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }
async function idbPut(key,val){ let db=await idb(); return new Promise((res,rej)=>{ let tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(val,key); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error); }); }
async function idbDel(key){ try{ let db=await idb(); await new Promise(res=>{ let tx=db.transaction('kv','readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete=()=>res(); tx.onerror=()=>res(); tx.onabort=()=>res(); }); }catch(e){} }
function persistPdfFile(book){ if(book && book.fileData) return idbPut('pdf:'+book.id, book.fileData); return Promise.resolve(); }
function deletePdfFile(id){ idbDel('pdf:'+id); }
function updateSaveStatus(failed){
  let el=$('saveStatus'); if(!el) return;
  if(failed){ el.textContent='Could not save in this browser. Use Backup to keep your notes safe.'; return; }
  el.textContent= lastSaveAt? 'Saved in this browser · '+new Date(lastSaveAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'Saves automatically in this browser';
}
function scheduleSave(){ if(!persistReady || inSave) return; persistDirty=true; clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,700); }
function bgPdfImgData(bg){
  if(!bg) return null;
  if(bg._imgData && bg._imgDataFor===bg.img) return bg._imgData;
  if(!bg.img) return bg.imgData||null; /* restored page whose background has not been decoded yet — its saved data URL is still the lossless form */
  try{
    let src=bg.img, c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
    let x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(src,0,0);
    bg._imgData=c.toDataURL('image/jpeg',0.85); bg._imgDataFor=src; return bg._imgData;
  }catch(e){ return null; }
}
function serializeLibrary(){
  return { v:1, savedAt:Date.now(), stats:S.stats,
    items:S.items.map(it=>{
      if(it.kind==='notebook') return {id:it.id,kind:'notebook',title:it.title,color:it.color,template:it.template,cur:it.cur,updated:it.updated,annotations:it.annotations||[],pdfBookId:it.pdfBookId||null,
        pages:(it.pages||[]).map(p=>({ink:p.ink||[],hi:p.hi||[],text:p.text||'',stickies:p.stickies||[],table:p.table||null,texts:p.texts||[],texs:p.texs||[],bgColor:p.bgColor||'#fffdf6',
          images:(p.images||[]).map(im=>({id:im.id,x:im.x,y:im.y,w:im.w,h:im.h,src:im.src})),
          board:p.board?{color:p.board.color,strokes:p.board.strokes,view:p.board.view,geom:p.board.geom||null}:null,
          audio:(p.audio&&p.audio.blob)?{blob:p.audio.blob,dur:p.audio.dur}:null,
          bgPdf:p.bgPdf?{page:p.bgPdf.page,bookTitle:p.bgPdf.bookTitle,imgData:bgPdfImgData(p.bgPdf)}:null }))};
      if(it.kind==='pdf') return {id:it.id,kind:'pdf',title:it.title,color:it.color,updated:it.updated,sample:!!it.sample,fileName:it.fileName,numPages:it.numPages,page:it.page,mode:it.mode,bookmarks:it.bookmarks||[],annotations:it.annotations||[],textCache:it.textCache||{},parallelNotes:it.parallelNotes||{}};
      return {id:it.id,kind:'epub',title:it.title,color:it.color,updated:it.updated,sample:!!it.sample,ch:it.ch||0,mode:it.mode||'scroll',bookmarks:it.bookmarks||[],annotations:it.annotations||[],parallelNotes:it.parallelNotes||{},chapters:it.chapters||[]};
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
  if(persistSaveAgain){ persistSaveAgain=false; scheduleSave(); }
}
function dataUrlToCanvas(url){ return new Promise((res,rej)=>{ let img=new Image(); img.onload=()=>{ let c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight; c.getContext('2d').drawImage(img,0,0); res(c); }; img.onerror=()=>rej(new Error('image failed')); img.src=url; }); }
/* A restored notebook page keeps its PDF background as a data URL and
   decodes it only when the page is actually viewed — decoding every
   page of every notebook during startup was a major cause of the slow
   first paint. Repaints if the decoded page is the one on screen. */
function decodeBgPdfImg(p){
  if(!p || !p.bgPdf || p.bgPdf.img || !p.bgPdf.imgData) return Promise.resolve();
  if(p.bgPdf._decodeP) return p.bgPdf._decodeP;
  p.bgPdf._decodeP=dataUrlToCanvas(p.bgPdf.imgData).then(c=>{ p.bgPdf.img=c; }).catch(()=>{}).then(()=>{ p.bgPdf._decodeP=null; let nb=curNb(); if(nb && nb.pages[nb.cur]===p && S.view==='editor') redrawAll(); });
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
      let nb={id:raw.id,kind:'notebook',title:raw.title||'Untitled notebook',color:raw.color||'#b4552d',template:raw.template||'lined',cur:raw.cur||0,updated:raw.updated||'',annotations:raw.annotations||[],pdfBookId:raw.pdfBookId||null,pages:[]};
      for(let rp of (raw.pages||[])){
        let p=blankPage();
        p.ink=rp.ink||[]; p.hi=rp.hi||[]; p.text=rp.text||''; p.stickies=rp.stickies||[]; p.table=rp.table||null;
        p.texts=rp.texts||[]; p.texs=rp.texs||[]; p.bgColor=rp.bgColor||'#fffdf6';
        p.images=(rp.images||[]).map(im=>({id:im.id||uid(),x:im.x,y:im.y,w:im.w,h:im.h,src:im.src}));
        p.board=rp.board?{color:rp.board.color||0,strokes:rp.board.strokes||[],view:rp.board.view||{x:0,y:0,k:1},geom:rp.board.geom||null}:null;
        if(rp.audio && rp.audio.blob){ try{ p.audio={blob:rp.audio.blob,dur:rp.audio.dur||0,url:URL.createObjectURL(rp.audio.blob)}; }catch(e){} }
        if(rp.bgPdf){ /* keep the data URL and decode it lazily when the page is viewed — decoding every page here was a big part of the slow startup */
          p.bgPdf={page:rp.bgPdf.page,bookTitle:rp.bgPdf.bookTitle,img:null,imgData:rp.bgPdf.imgData||null}; }
        nb.pages.push(p);
      }
      if(!nb.pages.length) nb.pages.push(blankPage());
      if(nb.cur>=nb.pages.length) nb.cur=nb.pages.length-1; if(nb.cur<0) nb.cur=0;
      items.push(nb);
    } else if(raw.kind==='pdf'){
      let b={id:raw.id,kind:'pdf',title:raw.title||'PDF',color:raw.color||'#4a5a74',updated:raw.updated||'',sample:!!raw.sample,fileName:raw.fileName||raw.title,numPages:raw.numPages||0,page:raw.page||1,mode:raw.mode||'scroll',bookmarks:raw.bookmarks||[],annotations:raw.annotations||[],textCache:raw.textCache||{},parallelNotes:raw.parallelNotes||{},doc:null,fileData:null};
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
      items.push({id:raw.id,kind:'epub',title:raw.title||'Book',color:raw.color||'#2e6f6a',updated:raw.updated||'',sample:!!raw.sample,ch:raw.ch||0,mode:raw.mode||'scroll',bookmarks:raw.bookmarks||[],annotations:raw.annotations||[],parallelNotes:raw.parallelNotes||{},chapters:raw.chapters||[]});
    }
   }catch(e){ /* one damaged item must not cost the whole shelf */ }
  }
  if(token!==restoreToken || !items.length) return false;
  /* merge, not replace: anything created while a slow restore was still
     running (e.g. on the starter shelf) survives the swap */
  let preExisting=S.items.filter(i=> items.every(r=>r.id!==i.id));
  S.items=items.concat(preExisting);
  return true;
}
/* Turn a PDF book's stored bytes into a readable pdf.js doc, on demand.
   Tries, in order: the bytes already in memory, a fresh read of the
   book's own 'pdf:<id>' record (the startup restore may have raced or
   skipped it), and — for the built-in demo — freshly generated bytes.
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
      let doc=await pdfjsLib.getDocument({data:b.fileData.slice(0)}).promise;
      b.doc=doc; b.numPages=doc.numPages;
      return true;
    }catch(e){ return false; }
    finally{ b._docP=null; }
  })();
  return b._docP;
}
function librarySignature(){
  try{
    return S.items.map(it=> it.kind==='notebook'
      ? 'n:'+it.title+':'+it.cur+':'+it.pages.reduce((a,p)=>a+(p.ink||[]).length+(p.hi||[]).length+((p.text||'').length)+((p.stickies||[]).reduce((x,s)=>x+(s.text||'').length+((s.x|0)+(s.y|0)),0))+((p.table&&p.table.rows)?p.table.rows.reduce((x,r)=>x+r.join('').length,0):0)+((p.board&&p.board.strokes)?p.board.strokes.length:0)+(p.texts||[]).length+(p.texs||[]).length+(p.images||[]).length+(p.audio?1:0),0)+':'+it.pages.reduce((a,p)=>a+((p.board&&p.board.geom)?((p.board.geom.x|0)+','+(p.board.geom.y|0)+','+(p.board.geom.w|0)+','+(p.board.geom.h|0)+';'):''),'')
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
   byte right here — nothing to fetch — then handed to the reader
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
      ['h',11.5,17,'Select any word to look it up in the dictionary or on Wikipedia,'],
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
  S.view=v;
  ['library','editor','reader'].forEach(x=>$('view-'+x).classList.toggle('hidden',x!==v));
  $('mainLayout').classList.toggle('shelf',v==='library');
  document.body.classList.toggle('inEditor',v==='editor'); document.body.classList.toggle('inReader',v==='reader');
  if(v!=='reader'){ var af=$('annotateFab'); if(af) af.classList.add('hidden'); }
  let sr=$('searchResults'); if(sr) sr.classList.add('hidden');
  let lh=$('libHint'); if(lh) lh.style.visibility='';
  syncHashForView(v);
  if(v==='library') renderLibrary();
  if(v==='editor' && !curNb()){ // guarantee an editable notebook exists
    let nb=S.items.find(i=>i.kind==='notebook');
    if(nb) openNotebook(nb.id); else { createNotebookSilent('Untitled notebook','#b4552d','lined'); }
  }
  window.scrollTo({top:0});
}
function filterLib(f,btn){ S.filter=f; document.querySelectorAll('.chip[data-filter]').forEach(c=>c.classList.toggle('active',c.getAttribute('data-filter')===f)); renderLibrary(); }
function toggleAbout(){ $('aboutPanel').classList.toggle('hidden'); }
function toggleLibUtils(btn){ let el=$('libUtils'); if(!el) return; el.classList.toggle('hidden'); if(btn) btn.setAttribute('aria-expanded',String(!el.classList.contains('hidden'))); }
function toggleTtsBar(){ let b=$('ttsBar'); b.classList.toggle('hidden'); if(!b.classList.contains('hidden')) b.scrollIntoView({block:'nearest'}); }

/* ============ library ============ */
function itemPages(it){ if(it.kind==='notebook') return it.pages.length; if(it.kind==='pdf') return it.numPages||0; if(it.kind==='epub') return it.chapters?it.chapters.length:0; return 1 }
function renderLibrary(){
  let q=($('globalSearch').value||'').toLowerCase().trim();
  /* P5: with no query in the box the shelf chrome is always restored,
     whatever hid it while a search was in progress. */
  if(!q){ let lg=$('libraryGrid'); if(lg) lg.classList.remove('hidden'); let cr0=$('chipRow'); if(cr0) cr0.classList.remove('hidden'); }
  let items=S.items.filter(n=>{
    if(S.filter!=='all' && n.kind!==S.filter) return false;
    if(!q) return true;
    return n.title.toLowerCase().includes(q);
  });
  $('statNotebooks').textContent=S.items.filter(i=>i.kind==='notebook').length;
  $('statBooks').textContent=S.items.filter(i=>i.kind!=='notebook').length;
  $('statPages').textContent=S.items.reduce((a,n)=>a+itemPages(n),0);
  $('statAnnos').textContent=S.items.reduce((a,n)=>a+((n.annotations||[]).length),0);
  /* P11: the shelf is only "empty" when nothing is on it at all — the
     built-in sample book counts, so the banner no longer claims a fresh,
     empty shelf while the sample book sits right below it. */
  $('emptyState').classList.toggle('hidden', S.items.length>0);
  $('libHint').textContent=q? items.length+(items.length===1?' match':' matches')+'. Search also looks inside notes, books and annotations.' : '';
  $('libraryGrid').innerHTML=items.map(n=>{
    let cov=coverFor(n);
    let kindLabel = n.kind==='notebook'? 'Notebook' : n.kind==='pdf'? 'PDF' : 'EPUB';
    let kindIcon = n.kind==='notebook'? 'notebook' : n.kind==='pdf'? 'file-type-pdf' : 'book';
    let count = n.kind==='notebook'? itemPages(n)+(itemPages(n)===1?' page':' pages')
      : n.kind==='pdf'? (n.numPages||'?')+(n.numPages===1?' page':' pages')
      : (n.chapters?n.chapters.length:0)+(n.chapters&&n.chapters.length===1?' chapter':' chapters');
    let openAct= n.kind==='notebook'? 'openNotebook(\''+n.id+'\')' : 'openBook(\''+n.id+'\')';
    let menu='<button type="button" onclick="event.stopPropagation();'+openAct+'">'+icon(n.kind==='notebook'?'notebook':'book-2')+(n.kind==='notebook'?'Open notebook':'Read book')+'</button>'
      + (n.kind==='pdf'? '<button type="button" onclick="event.stopPropagation();annotatePdf(\''+n.id+'\')">'+icon('pencil')+'Annotate</button>':'')
      + '<button type="button" class="danger" onclick="event.stopPropagation();askDeleteItem(\''+n.id+'\')">'+icon('trash')+'Delete</button>';
    return '<article class="bookCard"><button type="button" class="book" style="background:'+cov.bg+';color:'+cov.ink+'" onclick="'+openAct+'"><span class="srOnly">Open </span><span class="bookSpine" style="background:'+cov.spine+'"></span><span class="bookFace"><span class="bookKind">'+icon(kindIcon,'ic-sm')+kindLabel+'</span><span class="bookTitle">'+esc(n.title).split('_').join('_&#8203;')+'</span><span class="bookMeta"><span>'+count+'</span><span>'+(n.sample?'Sample':'Edited '+esc(n.updated||'just now'))+'</span></span></span></button>'
      +'<button type="button" class="bookMenu" aria-label="Options for '+esc(n.title)+'" aria-haspopup="true" onclick="toggleCardMenu(this)">'+icon('dots','ic-sm')+'</button>'
      +'<div class="bookActions">'+menu+'</div></article>';
  }).join('') || '<p class="kbd">Nothing matches this filter.</p>';
  updateStatsPanel();
  scheduleSave();
}
/* Notebook covers — the same eight as the app, plus the old website colours mapped onto them. */
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
    if(it.kind==='pdf') deletePdfFile(id);
    S.items=S.items.filter(i=>i.id!==id);
    if(S.curNbId===id) S.curNbId=null;
    if(S.curBookId===id) S.curBookId=null;
    renderLibrary(); toast('Deleted');
  });
}
function updateStatsPanel(){
  let words=S.items.filter(i=>i.kind==='notebook').reduce((a,nb)=>a+nb.pages.reduce((b,p)=>b+(p.text.trim()?p.text.trim().split(/\s+/).length:0),0),0);
  $('statWrite').textContent=Math.floor(S.stats.writeSec/60)+'m';
  $('statRead').textContent=Math.floor(S.stats.readSec/60)+'m';
  $('statStrokes').textContent=S.stats.strokes;
  $('statPagesRead').textContent=Object.keys(S.stats.pagesRead).length;
  $('statFocus').textContent=S.stats.focusDone;
  $('statWords').textContent=words;
  let w2=$('statWrite2'); if(w2) w2.textContent=Math.floor(S.stats.writeSec/60)+'m';
}

/* ============ library-wide search ============ */
/* P5: while a search query is present, the shelf grid and the filter
   chip row step aside entirely. renderLibrary() filters by title only,
   so leaving the grid up let it flash "Nothing matches this filter"
   behind the (full-text) results dropdown, which also covered the
   chips. Both come back when the query is cleared or results close. */
function setSearchChrome(active){
  let g=$('libraryGrid'); if(g) g.classList.toggle('hidden',active);
  let cr=$('chipRow'); if(cr) cr.classList.toggle('hidden',active);
}
function onSearchInput(){
  let q=($('globalSearch').value||'').trim().toLowerCase();
  let box=$('searchResults');
  if(S.view==='library') renderLibrary();
  setSearchChrome(q.length>0);
  if(q.length<2){ box.classList.add('hidden'); S.searchResults=[]; $('libHint').style.visibility=''; return; }
  let res=[];
  S.items.forEach(it=>{
    if(it.title.toLowerCase().includes(q)) res.push({label:it.title, sub:(it.kind==='notebook'?'Notebook':'Book')+' · title match', act:()=> it.kind==='notebook'? openNotebook(it.id): openBook(it.id)});
    if(it.kind==='notebook') it.pages.forEach((p,pi)=>{
      let idx=p.text.toLowerCase().indexOf(q);
      if(idx>=0) res.push({label:it.title+', page '+(pi+1), sub:'“…'+esc(p.text.slice(Math.max(0,idx-30),idx+60))+'…”', act:()=>{openNotebook(it.id); switchPage(pi);}});
      (p.stickies||[]).forEach(st=>{ if(st.text.toLowerCase().includes(q)) res.push({label:it.title+', sticky, page '+(pi+1), sub:esc(st.text.slice(0,80)), act:()=>{openNotebook(it.id); switchPage(pi);}}); });
      (p.texts||[]).forEach(t=>{ if(String(t.text).toLowerCase().includes(q)) res.push({label:it.title+', on-page text, page '+(pi+1), sub:esc(String(t.text).slice(0,80)), act:()=>{openNotebook(it.id); switchPage(pi);}}); });
      (p.texs||[]).forEach(t=>{ if(String(t.tex).toLowerCase().includes(q)) res.push({label:it.title+', equation, page '+(pi+1), sub:esc(String(t.tex).slice(0,80)), act:()=>{openNotebook(it.id); switchPage(pi);}}); });
      if(p.board && p.board.strokes.length && 'board'.includes(q)) res.push({label:it.title+', floating board, page '+(pi+1), sub:'This page has board work', act:()=>{openNotebook(it.id); switchPage(pi); toggleBoard(true);}});
    });
    if(it.kind==='epub' && it.chapters) it.chapters.forEach((c,ci)=>{
      let idx=c.text.toLowerCase().indexOf(q);
      if(idx>=0) res.push({label:it.title+' · '+c.title, sub:'“…'+esc(c.text.slice(Math.max(0,idx-30),idx+60))+'…”', act:()=>{openBook(it.id); jumpToChapter(ci);}});
    });
    if(it.kind==='pdf' && it.textCache) Object.keys(it.textCache).forEach(pg=>{
      let idx=it.textCache[pg].toLowerCase().indexOf(q);
      if(idx>=0) res.push({label:it.title+', PDF page '+pg, sub:'“…'+esc(it.textCache[pg].slice(Math.max(0,idx-30),idx+60))+'…”', act:()=>{openBook(it.id); jumpToPdfPage(+pg);}});
    });
    (it.annotations||[]).forEach(a=>{ if(a.text.toLowerCase().includes(q)) res.push({label:it.title+', annotation', sub:'“'+esc(a.text.slice(0,80))+'”', act:()=> openBook(it.id)}); });
  });
  S.searchResults=res.slice(0,14);
  box.innerHTML= S.searchResults.length? S.searchResults.map((r,i)=>'<div class="srItem" onclick="runSearchResult('+i+')"><b>'+esc(r.label)+'</b><span>'+r.sub+'</span></div>').join('') : '<div class="srItem"><span>No matches inside your notes and books.</span></div>';
  box.classList.remove('hidden');
  /* P13: while the results dropdown is open, blank the status line under
     it so the two never overlap/read through each other. */
  $('libHint').style.visibility='hidden';
}
function runSearchResult(i){ let r=S.searchResults[i]; $('searchResults').classList.add('hidden'); $('libHint').style.visibility=''; setSearchChrome(false); if(r&&r.act) r.act(); }
document.addEventListener('click',e=>{ if(!e.target.closest('.searchWrap')){ $('searchResults').classList.add('hidden'); let lh=$('libHint'); if(lh) lh.style.visibility=''; setSearchChrome(false); } });
$('globalSearch').addEventListener('keydown',e=>{ if(e.key!=='Escape') return; $('searchResults').classList.add('hidden'); $('libHint').style.visibility=''; setSearchChrome(false); e.currentTarget.blur(); });

/* ============ notebooks: create / open ============ */
function openNewNotebook(){$('newModal').classList.add('open'); setTimeout(()=>$('newTitle').focus(),50)}
function createNotebook(){
  let title=$('newTitle').value.trim()||'Untitled notebook';
  createNotebookSilent(title,$('newColor').value,$('newTemplate').value);
  closeModal('newModal'); $('newTitle').value='';
  toast('Notebook created');
}
function createNotebookSilent(title,color,template){
  let nb={id:uid(), kind:'notebook', title:title, color:color, template:template, pages:[blankPage()], cur:0, updated:'Just now', annotations:[]};
  S.items.unshift(nb); openNotebook(nb.id); return nb;
}
function openNotebook(id){
  let nb=S.items.find(i=>i.id===id); if(!nb||nb.kind!=='notebook') return;
  saveEditorToModel();
  S.curNbId=id;
  $('noteTitle').value=nb.title;
  $('templateSel').value=nb.template;
  loadPageIntoEditor();
  showView('editor');
  requestAnimationFrame(()=>{ renderCanvasTexts(); });
  renderLibrary();
  /* warm this notebook's remaining page backgrounds in the background,
     one at a time, so turning a page (or exporting) finds them ready */
  (async()=>{ for(let pg of nb.pages){ await decodeBgPdfImg(pg); } })();
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
const bgC=$('bgCanvas'), hiC=$('hiCanvas'), inkC=$('inkCanvas');
const bgX=bgC.getContext('2d'), hiX=hiC.getContext('2d'), inkX=inkC.getContext('2d');
[bgX,hiX,inkX].forEach(c=>{c.lineCap='round';c.lineJoin='round'});

/* Page backgrounds — the template set: blank, lined, grid, dotted, plus
   music staff, Cornell notes and checklist layouts. One painter is shared
   by the live editor background and by page export/thumbnails so a page
   looks identical everywhere. */
/* P1: Dark Slate pages (#2b2f36) need light ruling and light ink. The
   mapping happens at render time only — stored stroke/text colours stay
   as picked, so switching the page back to a light colour restores the
   original navy exactly. Same idea as boardInkColor() for the board. */
function isDarkPage(p){ return !!(p && String(p.bgColor||'').toLowerCase()==='#2b2f36'); }
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
  if(tool==='calligraphy'){ let f=0.22+0.78*Math.abs(Math.sin((dirAng||0)-0.785)); return Math.max(0.7, size*1.7*f*(0.45+0.55*(p.p||0.5))); }
  return Math.max(0.6, size*(0.32+0.95*(p.p||0.5)));
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
       highlight vanishes into it — 'screen' lightens instead. */
    ctx.save(); ctx.globalCompositeOperation= isDarkPage(p)? 'screen':'multiply'; ctx.globalAlpha=0.42; ctx.strokeStyle=col; ctx.lineWidth=st.size*4.5;
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y); ctx.stroke(); ctx.restore(); return;
  }
  if(st.style && st.style!=='solid' && (st.tool==='pen'||st.tool==='calligraphy')){
    /* Dashed/dotted pen strokes are drawn as a dashed centreline — a filled
       outline cannot dash. Pressure still drives the line width. */
    ctx.save(); ctx.strokeStyle=col; ctx.setLineDash(dashFor(st)); ctx.lineCap='round'; ctx.lineJoin='round';
    for(let i=1;i<pts.length;i++){ ctx.lineWidth=Math.max(0.8, st.size*(0.5+1.5*((pts[i-1].p||0.5)+(pts[i].p||0.5))/2)); ctx.beginPath(); ctx.moveTo(pts[i-1].x,pts[i-1].y); ctx.lineTo(pts[i].x,pts[i].y); ctx.stroke(); }
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
  $('statPageStrokes').textContent=p.ink.length+p.hi.length;
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
/* Selection transforms — rotation (snapped to the angle step the buttons
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
  let all=p.ink.concat(p.hi); S.selection=all.filter(st=>{ let b=strokeBBox(st); return b.x2>=r.x1 && b.x1<=r.x2 && b.y2>=r.y1 && b.y1<=r.y2; });
  drawSelectionOverlay(); if(S.selection.length) toast(S.selection.length+' stroke(s) selected. Drag inside the box to move.'); else toast('Nothing in that box. Drag around some ink.');
}
/* ============ Lasso select, vertical space, spline, set square ============
   Lasso: a freehand loop; a stroke is selected when the centre of its
   bounding box falls inside the loop (point-in-polygon ray cast).
   Vertical space: everything whose top edge sits below the drag line is
   shifted by the drag distance — strokes, on-page text, equations,
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
    let del=document.createElement('button'); del.className='miniBtn'; del.textContent='×'; del.title='Remove image'; del.style.cssText='position:absolute;top:-10px;left:-10px;z-index:3;background:#fff'; del.onclick=e=>{ e.stopPropagation(); p.images=p.images.filter(x=>x!==im); bumpV(p); renderCanvasImages(); renderPages(); };
    wrap.appendChild(del);
    wrap.addEventListener('pointerdown',e=>{
      if(e.target===grip||e.target===del) return; e.stopPropagation(); wrap.setPointerCapture(e.pointerId);
      let shell=inkC.getBoundingClientRect(); let sx=e.clientX, sy=e.clientY, ox=im.x, oy=im.y;
      function mv(ev){ im.x=ox+(ev.clientX-sx)*(CW/shell.width); im.y=oy+(ev.clientY-sy)*((inkC.height||CH)/shell.height); wrap.style.left=(im.x/CW*100)+'%'; wrap.style.top=(im.y/PH*100)+'%'; }
      function up(){ wrap.removeEventListener('pointermove',mv); wrap.removeEventListener('pointerup',up); bumpV(p); renderPages(); }
      wrap.addEventListener('pointermove',mv); wrap.addEventListener('pointerup',up);
    });
    grip.addEventListener('pointerdown',e=>{
      e.stopPropagation(); grip.setPointerCapture(e.pointerId);
      let shell=inkC.getBoundingClientRect(); let sx=e.clientX, sy=e.clientY, ow=im.w, oh=im.h;
      function mv(ev){ im.w=Math.max(40, ow+(ev.clientX-sx)*(CW/shell.width)); im.h=Math.max(30, oh+(ev.clientY-sy)*((inkC.height||CH)/shell.height)); wrap.style.width=(im.w/CW*100)+'%'; wrap.style.height=(im.h/PH*100)+'%'; }
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
let editorZoom=1;
function editorZoomBy(f){ editorZoom= f===0? 1 : Math.max(0.5, Math.min(2.5, editorZoom*f)); S.zoom=editorZoom; $('canvasShell').style.width=(editorZoom*100)+'%'; var zl=$('zoomLabel'); if(zl) zl.textContent=Math.round(editorZoom*100)+'%'; updateStatusBar(); }
function setPageBg(v){ let p=curPageObj(); if(!p) return; p.bgColor=v; bumpV(p); drawBackground(); renderPages(); }

/* pointer drawing */
let drawing=false, curStroke=null, lastPt=null, lastT=0, eraseChanged=false;
function canvasPos(e){ let r=inkC.getBoundingClientRect(); return { x:(e.clientX-r.left)*(CW/r.width), y:(e.clientY-r.top)*((inkC.height||CH)/r.height) }; }
function pointerPressure(e,pt){
  if(e.pointerType==='pen' && e.pressure && e.pressure>0) return e.pressure;
  if(lastPt){ let d=Math.hypot(pt.x-lastPt.x,pt.y-lastPt.y); return Math.max(0.2,Math.min(1, 1.05 - d/46)); }
  return 0.6;
}
const SHAPE_TOOLS=['line','rect','ellipse','arrow'];
function isShapeTool(t){ return SHAPE_TOOLS.indexOf(t)>=0; }
function shouldDraw(e){ return S.tool!=='hand'; }
/* Scrolling while annotating — the way note apps do it. The canvas keeps
   touch-action:none at all times, so a drawing finger never makes the
   page jump; scrolling is done by hand here instead. ONE finger (or a
   stylus / mouse) draws with whatever tool is picked. A TWO-finger drag
   pans the page — and the zoomed canvas inside its scroller — even while
   a drawing tool is active. The Hand tool pans with one finger. There is
   no Finger mode to set and nothing to confirm: a selected tool just
   works, and two fingers always move the page.
   When the second finger lands, any half-drawn stroke is thrown away
   (it was never committed to the page) along with its undo snapshot, and
   both fingers are marked "dead" for drawing: the finger that stays down
   after the pan ends is ignored until it lifts, so lifting one finger
   never drops the other back into a stroke mid-page. A touch that lands
   while a stylus is down is treated as a palm, not a pan. */
let inkPtrs=new Map(), panMid=null, handPan=null, panDead=new Set(), strokeUndoPushed=false;
function updateInkTouchAction(){ inkC.style.touchAction='none'; inkC.style.cursor= S.tool==='hand'? 'grab' : 'crosshair'; }
function zoomScroller(){ return inkC.closest? inkC.closest('.zoomScroll') : null; }
function panViewportBy(dx,dy){
  /* Content follows the fingers: scroll positions move against the drag.
     The zoom scroller consumes what it can; the rest pans the window. */
  let remX=dx, remY=dy, sc=zoomScroller();
  if(sc){ let pl=sc.scrollLeft, pt=sc.scrollTop; sc.scrollLeft-=dx; sc.scrollTop-=dy; remX=dx-(pl-sc.scrollLeft); remY=dy-(pt-sc.scrollTop); }
  if(remX||remY) window.scrollBy(-remX,-remY);
}
function inkPtrMid(){ let ps=Array.from(inkPtrs.values()); return ps.length>=2? {x:(ps[0].x+ps[1].x)/2, y:(ps[0].y+ps[1].y)/2} : null; }
function abortGestureForPan(){
  let wasMove=!!moveDrag;
  if(curStroke){ if(strokeUndoPushed && S.undoStack.length) S.undoStack.pop(); curStroke=null; }
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
  let layer=curStroke._layer, ctx= layer==='ink'? inkX:hiX;
  ctx.clearRect(0,0,CW,PH);
  p[layer].forEach(st=>drawStroke(ctx,st,p));
  drawStroke(ctx,curStroke,p);
}
/* Stylus button mapping: the pen's eraser end or barrel button temporarily
   swaps in the mapped tool for the length of that stroke, then the chosen
   tool comes back — the toolbar never changes. */
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
inkC.addEventListener('pointerdown',e=>{
  inkPtrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
  if(inkPtrs.size===2){
    /* Second finger down: abandon whatever the first finger was doing and
       turn the gesture into a two-finger pan. Skipped when a stylus is
       down (that touch is a resting palm) or the new pointer isn't touch. */
    let types=Array.from(inkPtrs.values()).map(p=>p.type);
    if(e.pointerType!=='touch' || types.indexOf('pen')>=0) return;
    e.preventDefault();
    try{ inkC.setPointerCapture(e.pointerId); }catch(err){}
    abortGestureForPan();
    panMid=inkPtrMid();
    inkPtrs.forEach((v,id)=>panDead.add(id));
    return;
  }
  if(inkPtrs.size>2 || panMid || panDead.has(e.pointerId)) return;
  applyStylusButton(e);
  if(!curPageObj()) return;
  if(S.tool==='hand'){
    /* Hand tool: one finger pans, through the same manual pan as two fingers. */
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
  drawing=true; eraseChanged=false; snapshotUndo(); strokeUndoPushed=true;
  let pt=pt0; pt.p=pointerPressure(e,pt); lastPt=pt;
  if(S.tool==='eraser'){
    if(S.eraserMode==='whiteout'){ let pg=curPageObj(); curStroke={tool:'pen', color:(pg&&pg.bgColor)||'#fffdf6', size:Math.max(10,+$('brushSize').value*3), points:[pt]}; curStroke._layer='ink'; curStroke._whiteout=true; renderLive(); return; }
    eraseAt(pt); return;
  }
  if(isShapeTool(S.tool)){ let sx=snapVal(pt.x), sy=snapVal(pt.y); curStroke={tool:'shape', shape:S.tool, color:S.color, size:+$('brushSize').value, fill:!!$('fillTgl').checked, style:S.strokeStyle, points:[{x:sx,y:sy},{x:sx,y:sy}]}; curStroke._layer='ink'; renderLive(); return; }
  curStroke={tool:S.tool, color:S.color, size:+$('brushSize').value, style:S.strokeStyle, points:[pt]};
  if(S.recording) curStroke.t=Date.now()-S.recStart;
  curStroke._layer= S.tool==='highlighter'? 'hi':'ink';
  renderLive();
});
inkC.addEventListener('pointermove',e=>{
  if(inkPtrs.has(e.pointerId)) inkPtrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
  if(panMid){
    let m=inkPtrMid(); if(!m) return;
    let dx=m.x-panMid.x, dy=m.y-panMid.y; panMid=m;
    if(dx||dy){ e.preventDefault(); panViewportBy(dx,dy); }
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
  evts.forEach(ev=>{
    let pt=canvasPos(ev); pt.p=pointerPressure(ev,pt);
    if(curStroke && curStroke.tool==='shape' && curStroke._compassCenter){ let c=curStroke._compassCenter; let r=Math.hypot(pt.x-c.x,pt.y-c.y); curStroke.points=[{x:c.x-r,y:c.y-r},{x:c.x+r,y:c.y+r}]; renderLive(); lastPt=pt; return; }
    if(curStroke && curStroke.tool==='shape'){ curStroke.points[1]={x:snapVal(pt.x),y:snapVal(pt.y)}; renderLive(); lastPt=pt; return; }
    if(lastPt){ let keep=1-(S.stabilize||0)/100; pt.x=lastPt.x+(pt.x-lastPt.x)*keep; pt.y=lastPt.y+(pt.y-lastPt.y)*keep; } // input stabilization (streamline): Smooth slider sets how much jitter is filtered
    if(S.tool==='eraser'){ eraseAt(pt); lastPt=pt; return; }
    if(curStroke){ curStroke.points.push(pt); renderLive(); }
    lastPt=pt;
  });
});
function bumpV(p){ if(p) p._v=(p._v||0)+1; scheduleSave(); }
function endStroke(){
  if(S.tool==='select'){ if(moveDrag){ moveDrag=null; let p=curPageObj(); bumpV(p); renderPages(); drawSelectionOverlay(); } if(selDrag){ selDrag=false; finishSelection(); } return; }
  if(S.tool==='lasso'){ if(lassoPts && lassoPts.length>2) finishLasso(); else { lassoPts=null; drawSelectionOverlay(); } return; }
  if(S.tool==='vspace'){ if(vspaceDrag) finishVspace(); return; }
  if(!drawing) return; drawing=false;
  let p=curPageObj();
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
  if(wasPan){ if(inkPtrs.size<2) panMid=null; return; }
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
   way — so ink is cut exactly at the padded boundary, but a near miss
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
   itself — never its bounding box — so touching a stroke deletes exactly
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
  inkX.save(); inkX.strokeStyle='rgba(178,38,30,.8)'; inkX.lineWidth=2;
  inkX.beginPath(); inkX.arc(pt.x,pt.y,eraserRadius(),0,7); inkX.stroke(); inkX.restore();
}
/* Brush size in plain words, with a live preview drawn at the stroke's real
   width (in page-canvas units) in the current ink colour — so how thick the
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
    if(hit){ eraseChanged=true; bumpV(p); }
    redrawLayer('ink'); redrawLayer('hi'); drawEraserCursor(b);
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
     popover — it used to stay open and silently re-label itself for the
     new tool, so settings for one tool looked like another's. */
  if(S.tool!==t) closeAllPopovers();
  /* Gap 2: tapping the already-selected tool must NOT turn it off or
     switch to Hand — it stays selected until a different tool is picked. */
  S.tool=t; document.querySelectorAll('.tool').forEach(b=>{ let on=b.dataset.tool===t; b.classList.toggle('active',on); b.setAttribute('aria-pressed',String(on)); });
  updateInkTouchAction(); updateSizeUI(); updateToolOptsUI(); updateStatusBar(); updateOptsRow();
}
/* The Size + colours row is only up while a tool that draws (or sizes
   what it touches) is active — Hand / Select / Lasso / Vertical space
   collapse it so the page gets the room back. The tool menus live in
   the tools row now, so nothing becomes unreachable. */
const OPTS_ROW_TOOLS=['pen','calligraphy','highlighter','eraser','text','line','rect','ellipse','arrow','spline','compass'];
function updateOptsRow(){ var row=$('tbOptsRow'); if(!row) return; row.classList.toggle('hidden', OPTS_ROW_TOOLS.indexOf(S.tool)<0); }
function setColor(c,el){ S.color=c; document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('active')); if(el) el.classList.add('active'); let cp=$('customColor'); if(cp && /^#[0-9a-f]{6}$/i.test(c)) cp.value=c; updateSizeUI(); }
function toggleLayer(which,on){ (which==='ink'?inkC:hiC).style.display= on? 'block':'none'; updateStatusBar(); }
document.addEventListener('keydown',e=>{
  if(S.view!=='editor') return;
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z' && !e.shiftKey){ e.preventDefault(); undoStroke(); }
  if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase()==='y' || (e.key.toLowerCase()==='z'&&e.shiftKey))){ e.preventDefault(); redoStroke(); }
});

/* ============ editor: pages ============ */
function loadPageIntoEditor(){
  let nb=curNb(); if(!nb) return;
  let p=nb.pages[nb.cur];
  decodeBgPdfImg(p); /* restored pages decode their PDF background on view, not at startup */
  $('templateSel').value=nb.template;
  $('noteText').value=p.text||'';
  if(!p.texts) p.texts=[]; if(!p.images) p.images=[]; if(!p.texs) p.texs=[]; if(!p.bgColor) p.bgColor='#fffdf6';
  let bgSel=$('pageBgSel'); if(bgSel) bgSel.value=p.bgColor;
  S.selection=[]; S.selRect=null; let sb=$('selBar'); if(sb) sb.classList.remove('open');
  redrawAll(); renderStickies(); renderTable(); renderPages(); refreshLinks(); updateWordCount(); updateAudioUI(); renderCanvasTexts(); renderCanvasImages(); renderTexLayer();
  if(!$('floatingBoard').classList.contains('hidden')) loadBoard();
}
function switchPage(i){
  let nb=curNb(); if(!nb) return;
  saveEditorToModel(); nb.cur=i; S.undoStack=[]; S.redoStack=[];
  loadPageIntoEditor();
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
function renderPages(){
  let nb=curNb(); if(!nb) return;
  $('pageList').innerHTML=nb.pages.map((p,i)=>{
    return '<div class="pageThumb '+(i===nb.cur?'active':'')+'" onclick="switchPage('+i+')"><canvas width="300" height="200" data-thumb="'+i+'"></canvas>'
    +'<div class="ptRow"><span class="kbd">Page '+(i+1)+(p.board&&p.board.strokes.length?' · board':'')+(p.bgPdf?' · PDF p.'+p.bgPdf.page:'')+'</span><span class="ptBtns">'
    +'<button class="miniBtn" title="Move up" aria-label="Move page up" onclick="pageAction('+i+',\'up\',event)">'+icon('arrow-up')+'</button>'
    +'<button class="miniBtn" title="Move down" aria-label="Move page down" onclick="pageAction('+i+',\'down\',event)">'+icon('arrow-down')+'</button>'
    +'<button class="miniBtn" title="Duplicate" aria-label="Duplicate page" onclick="pageAction('+i+',\'dup\',event)">'+icon('copy')+'</button>'
    +'<button class="miniBtn" title="Delete page" aria-label="Delete page" onclick="pageAction('+i+',\'del\',event)">'+icon('trash')+'</button></span></div></div>';
  }).join('');
  $('statEditorPages').textContent=nb.pages.length; updateStatusBar();
  nb.pages.forEach((p,i)=>{
    let th=document.querySelector('canvas[data-thumb="'+i+'"]'); if(!th) return;
    if(!p._thumb || p._thumbV!==p._v){ p._thumb=composePage(p, nb.template); p._thumbV=p._v; }
    let x=th.getContext('2d'); x.clearRect(0,0,300,200); x.fillStyle='#fff'; x.fillRect(0,0,300,200); let iw=p._thumb.width, ih=p._thumb.height, ts=Math.min(300/iw,200/ih); x.drawImage(p._thumb,(300-iw*ts)/2,(200-ih*ts)/2,iw*ts,ih*ts);
  });
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
}
function loadBoard(){
  let bd=pageBoard(); if(!bd) return;
  if(boardFull){ boardFull=false; boardRestoreGeom=null; $('floatingBoard').classList.remove('boardFull'); setBtnContent('boardFsBtn','arrows-maximize','Expand'); }
  $('floatingBoard').style.background=BOARD_COLORS[bd.color];
  if(bd.color===6){ $('floatingBoard').style.color='#f8fafc'; } else { $('floatingBoard').style.color='#1b2a4a'; }
  applyBoardGeom(bd.geom||defaultBoardGeom());
  sizeBoardCanvas(); redrawBoard();
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
  sizeBoardCanvas();
}
function exitBoardFullscreen(silent){
  let el=$('floatingBoard'); boardFull=false; el.classList.remove('boardFull');
  let bd=pageBoard(); let g=boardRestoreGeom||(bd&&bd.geom)||defaultBoardGeom(); boardRestoreGeom=null;
  applyBoardGeom(g);
  if(bd) bd.geom=boardGeomFromEl();
  setBtnContent('boardFsBtn','arrows-maximize','Expand');
  sizeBoardCanvas();
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
  let w=boardWorld(e); if(bStroke){ bStroke.points.push({x:w.x,y:w.y}); bd.strokes=bd.strokes.filter(s=>s!==bStroke); bd.strokes.push(bStroke); redrawBoard(); }
});
function boardEnd(e){ delete boardPointers[e.pointerId]; if(Object.keys(boardPointers).length<2) pinchStart=null; if(bDrawing && bStroke){ renderPages(); } bDrawing=false; bStroke=null; bLast=null; }
boardC.addEventListener('pointerup',boardEnd); boardC.addEventListener('pointercancel',boardEnd);
boardC.addEventListener('wheel',e=>{ e.preventDefault(); let bd=pageBoard(); let f=e.deltaY<0?1.12:0.89; bd.view.k=Math.max(0.2,Math.min(6,bd.view.k*f)); redrawBoard(); },{passive:false});
function boardZoom(f){ let bd=pageBoard(); bd.view.k=Math.max(0.2,Math.min(6,bd.view.k*f)); redrawBoard(); }
function boardClear(){ let bd=pageBoard(); askConfirm('Clear this board?','The board on this page is emptied; the page itself is untouched.',()=>{ bd.strokes=[]; redrawBoard(); renderPages(); }); }
function cycleBoardColor(){ let bd=pageBoard(); bd.color=(bd.color+1)%BOARD_COLORS.length; loadBoard(); scheduleSave(); toast('Board colour saved for this page'); }
/* drag + resize board — built for steady controls:
   - the head captures the pointer, so a drag tracks one finger/mouse
     exactly and never drifts or gets lost mid-move;
   - taps on the head's buttons never start a drag;
   - every edge and corner resizes from a snapshot of the starting
     geometry, with the opposite edge pinned — no jumping, no shift;
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
  let back=S.items.filter(i=>i.kind==='notebook' && i.id!==nb.id && i.pages.some(p=>p.text.includes('[['+nb.title+']]'))).map(i=>i.title);
  let html='';
  if(out.length) html+=out.map(l=>'<div class="listRow"><a href="#" onclick="openLink(\''+esc(l).replace(/'/g,"\\'")+'\');return false">[[ '+esc(l)+' ]]</a><span class="kbd">link</span></div>').join('');
  if(back.length) html+='<h4 style="margin-top:12px">Backlinks</h4>'+back.map(t=>'<div class="listRow"><span>'+esc(t)+'</span><span class="kbd">links here</span></div>').join('');
  host.innerHTML= html || '<p class="kbd">Type [[Title]] in the note to link another notebook. Links create the notebook if it does not exist yet.</p>';
}
function openLink(title){
  let nb=S.items.find(i=>i.kind==='notebook' && i.title.toLowerCase()===title.toLowerCase());
  if(nb){ openNotebook(nb.id); return; }
  let created=createNotebookSilent(title,'#1e3a5f','lined');
  toast('Created linked notebook “'+title+'”');
}
function updateWordCount(){ let v=$('noteText').value; $('wordCount').textContent=(v.trim()? v.trim().split(/\s+/).length:0)+' words'; refreshLinks(); }
$('noteText').addEventListener('input',()=>{ saveEditorToModel(); updateWordCount(); });
function toggleSplit(){
  S.split=!S.split;
  $('stageWrap').classList.toggle('split',S.split);
  let pane=$('splitPane'); pane.classList.toggle('hidden',!S.split);
  /* P3: Split View halves the page shell — re-clamp the floating
     board's window to the new width so its Colour / Expand / Close
     controls are never pushed past the shell's right edge. */
  let fb=$('floatingBoard');
  if(fb && !fb.classList.contains('hidden') && !boardFull){ applyBoardGeom(boardGeomFromEl()); queueBoardSize(); }
  if(S.split){
    let b=curBook()||S.items.find(i=>i.kind==='epub');
    if(b && b.kind==='epub'){ let c=b.chapters[b.ch]; pane.innerHTML='<span class="badge">'+esc(b.title)+'</span><h3>'+esc(c.title)+'</h3>'+c.html; }
    else if(b && b.kind==='pdf' && b.textCache){ pane.innerHTML='<span class="badge">'+esc(b.title)+'</span><h3>Page '+b.page+'</h3><p>'+esc((b.textCache[b.page]||'Open the PDF in the reader once so its text is ready here.').slice(0,2200))+'</p>'; }
    else pane.innerHTML='<h3>Nothing to read yet</h3><p>Open or import a book and it will appear here beside your notebook.</p>';
  }
}

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
      function mv(ev){ t.x=ox+(ev.clientX-sx)*(CW/shell.width); t.y=oy+(ev.clientY-sy)*((inkC.height||CH)/shell.height); d.style.left=(t.x/CW*100)+'%'; d.style.top=(t.y/PH*100)+'%'; }
      function up(){ d.removeEventListener('pointermove',mv); d.removeEventListener('pointerup',up); bumpV(p); renderPages(); }
      d.addEventListener('pointermove',mv); d.addEventListener('pointerup',up);
    });
    host.appendChild(d);
  });
}
function openTexModal(){
  if(!curNb()){ toast('Open a notebook first'); return; }
  if(S.view!=='editor'){ openNotebook(curNb().id); }
  $('texModal').classList.add('open'); updateTexPreview();
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
function toggleMoreTools(btn){ togglePageMenu(btn); }
function closeAllToolPops(){ document.querySelectorAll('.toolPop.open').forEach(el=>el.classList.remove('open')); ['toolOptsBtn','insertBtn','pageOptsBtn'].forEach(id=>{ var b=$(id); if(b) b.setAttribute('aria-expanded','false'); }); }
/* One dismissal entry point for every popover in the editor (P4/P12
   hygiene): tool-options popovers plus the Export menu. */
function closeAllPopovers(){ closeAllToolPops(); closeExportPop(); }
function toggleOnePop(id,btn){ var el=$(id); var willOpen=el && !el.classList.contains('open'); closeAllToolPops(); if(el && willOpen){ el.classList.add('open'); if(btn) btn.setAttribute('aria-expanded','true'); } return willOpen; }
function toggleToolOpts(btn){ if(toggleOnePop('toolOptsPop',btn)) updateToolOptsUI(); }
function toggleInsertMenu(btn){ toggleOnePop('insertPop',btn); }
function togglePageMenu(btn){ toggleOnePop('pagePop',btn); }
const TOOL_LABELS={pen:'Pen',calligraphy:'Calligraphy',highlighter:'Highlighter',eraser:'Eraser',hand:'Hand',select:'Select',text:'Text',line:'Line',rect:'Rectangle',ellipse:'Ellipse',arrow:'Arrow',spline:'Spline',compass:'Compass',lasso:'Lasso',vspace:'Vertical space'};
function updateToolOptsUI(){ var label=TOOL_LABELS[S.tool]||'Tool'; var btn=$('toolOptsBtn'); if(btn) btn.innerHTML=label+' options '+icon('chevron-down','ic-sm'); var title=$('toolOptsTitle'); if(title) title.textContent=label+' options'; document.querySelectorAll('.toolOptSection').forEach(sec=>{ var tools=(sec.getAttribute('data-tools')||'').split(/\s+/); sec.classList.toggle('show', tools.indexOf(S.tool)>=0); }); }
function updateStatusBar(){ var nb=curNb(); var sp=$('statusPage'); if(sp && nb) sp.textContent=(nb.cur+1)+' / '+nb.pages.length; var sl=$('statusLayer'); if(sl){ var inkOn=!$('layerInkTgl')||$('layerInkTgl').checked; var hiOn=!$('layerHiTgl')||$('layerHiTgl').checked; sl.textContent= S.tool==='highlighter'?'Highlight': (inkOn&&hiOn?'Ink + Highlight': inkOn?'Ink': hiOn?'Highlight':'None'); } var sz=$('statusZoom'); if(sz) sz.textContent=Math.round((typeof editorZoom!=='undefined'?editorZoom:1)*100)+'%'; var st=$('statusTool'); if(st) st.textContent=TOOL_LABELS[S.tool]||S.tool; }
document.addEventListener('click',e=>{ if(!e.target.closest('#mainToolbar')) closeAllToolPops(); });
function toggleExportMenu(btn){ let p=$('exportPop'); let open=p.classList.toggle('open'); if(btn) btn.setAttribute('aria-expanded',open); }
function closeExportPop(){ let p=$('exportPop'); if(p) p.classList.remove('open'); let b=$('exportBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function toggleReaderMore(btn){ let p=$('readerMore'); let open=p.classList.toggle('open'); if(btn){ let label=$('readerMoreLabel'); if(label) label.textContent= open? 'Fewer':'More'; btn.setAttribute('aria-expanded',open); } }
function selectLayerStrokes(which){ let p=curPageObj(); if(!p) return; S.selection=(which==='ink'? p.ink : p.hi).slice(); drawSelectionOverlay(); toast(S.selection.length? S.selection.length+' stroke(s) selected on the '+(which==='ink'?'ink':'highlight')+' layer' : 'That layer is empty on this page'); }

/* ============ exports ============ */
function exportPagePNG(){ let nb=curNb(); if(!nb) return; saveEditorToModel(); let c=composePage(curPageObj(), nb.template); c.toBlob(b=>{ download(nb.title.replace(/[^\w\- ]+/g,'')+', page '+(nb.cur+1)+'.png', b); toast('PNG exported'); }); }
/* P10: plain-text export of the whole notebook — typed notes plus the
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
function exportNotebookPDF(){
  let nb=curNb(); if(!nb) return; saveEditorToModel();
  if(!window.jspdf){ toast('PDF export library could not load. Check the connection.'); return; }
  let doc=new window.jspdf.jsPDF({unit:'px', format:[CW,pageH(nb.pages[0])], orientation: pageH(nb.pages[0])>CW?'portrait':'landscape'});
  nb.pages.forEach((p,i)=>{ let ph=pageH(p); if(i>0) doc.addPage([CW,ph], ph>CW?'portrait':'landscape'); let c=composePage(p, nb.template); doc.addImage(c.toDataURL('image/jpeg',0.92),'JPEG',0,0,CW,c.height); });
  doc.save(nb.title.replace(/[^\w\- ]+/g,'')+'.pdf'); toast('Notebook exported as PDF');
}
/* SVG export — strokes become real vector elements, so the page opens in
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
/* .xopp interchange — the gzipped-XML notebook format used by Xournal++:
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
      pages:nb.pages.map(p=>({ink:p.ink,hi:p.hi,text:p.text,stickies:p.stickies,table:p.table,texts:p.texts||[],texs:p.texs||[],images:(p.images||[]).map(im=>({x:im.x,y:im.y,w:im.w,h:im.h,src:im.src})),bgColor:p.bgColor||'#fffdf6',board:p.board?{color:p.board.color,strokes:p.board.strokes,view:p.board.view,geom:p.board.geom||null}:null, bgPdf:p.bgPdf?{bookTitle:p.bgPdf.bookTitle,page:p.bgPdf.page}:null}))})),
    bookNotes:S.items.filter(i=>i.kind!=='notebook').map(b=>({title:b.title,kind:b.kind,bookmarks:b.bookmarks,annotations:b.annotations,page:b.page,ch:b.ch,parallelNotes:b.parallelNotes}))};
  download('inkwell-backup.json', new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  toast('Backup downloaded. Notebooks are included in full, with bookmarks and annotations.');
}
async function relinkPdfBackgrounds(){
  for(let nb of S.items){ if(nb.kind!=='notebook') continue;
    for(let p of nb.pages){ if(!p.bgPdf || p.bgPdf.img) continue;
      let book=S.items.find(i=>i.kind==='pdf' && i.title===p.bgPdf.bookTitle);
      if(!book) continue;
      if(!book.doc && !(await ensurePdfDoc(book))) continue;
      try{ let page=await book.doc.getPage(p.bgPdf.page); let v0=page.getViewport({scale:1}); let vp=page.getViewport({scale:CW/v0.width});
        let cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
        await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        p.bgPdf.img=cv;
      }catch(e){}
    }
  }
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
      (data.bookNotes||[]).forEach(bn=>{ let b=S.items.find(i=>i.title===bn.title && i.kind===bn.kind); if(b){ b.bookmarks=bn.bookmarks||b.bookmarks; b.annotations=bn.annotations||b.annotations; b.parallelNotes=bn.parallelNotes||{}; } });
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
    S.items.unshift(book); renderLibrary(); openBook(book.id); toast('Text file opened in the reader'); }; r.readAsText(f); return; }
  toast('That file type is not supported. Use PDF, EPUB or TXT.');
}
async function importPdf(f){
  if(!window.pdfjsLib){ toast('PDF engine could not load. Check the connection and try again.'); return; }
  toast('Loading PDF…');
  try{
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    let buf=await f.arrayBuffer();
    let storedBuf=buf.slice(0); /* kept so the file itself is saved in this browser and the book reopens after a reload */
    let doc=await pdfjsLib.getDocument({data:buf.slice(0)}).promise;
    let book={id:uid(),kind:'pdf',title:f.name.replace(/\.[^.]+$/,''),color:'#4a5a74',updated:'Imported just now',doc:doc,numPages:doc.numPages,page:1,mode:'scroll',bookmarks:[],annotations:[],textCache:{},parallelNotes:{},fileName:f.name,fileData:storedBuf};
    S.items.unshift(book); renderLibrary();
    /* The file bytes ARE the book: wait until they are actually written
       before opening, and say so if the write fails — a silent failure
       here used to leave a book that was gone, or would not open, after
       the next reload. */
    try{ await persistPdfFile(book); }
    catch(e){ toast('The PDF opened, but its file could not be saved in this browser, so it may not survive a reload. Storage may be full. Export a backup to keep it safe.',6000); }
    openBook(book.id);
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
    S.items.unshift(book); renderLibrary(); openBook(book.id);
    toast('EPUB opened. '+chapters.length+' chapters, in reading mode');
  }catch(err){ toast('That EPUB could not be read ('+(err&&err.message?err.message:'unknown error')+')'); }
}

/* ============ reader ============ */
function openBook(id){
  let b=S.items.find(i=>i.id===id); if(!b||b.kind==='notebook') return;
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
  S.curBookId=id;
  $('modeScrollBtn').classList.toggle('active',b.mode!=='page'); $('modePageBtn').classList.toggle('active',b.mode==='page');
  $('dictBox').classList.add('hidden'); $('ocrBox').classList.add('hidden'); $('parallelBox').classList.add('hidden');
  if(b.kind==='pdf'){ showPdfChrome(); renderPdfBook(); }
  else { showEpubChrome(); renderEpubBook(); }
  showView('reader'); renderReaderSide();
}
function showEpubChrome(){ $('pdfView').classList.add('hidden'); $('readerArticle').classList.remove('hidden'); $('ttsBar').classList.add('hidden'); var f=$('annotateFab'); if(f) f.classList.add('hidden'); }
function showPdfChrome(){ $('pdfView').classList.remove('hidden'); $('readerArticle').classList.add('hidden'); $('ttsBar').classList.add('hidden'); $('parallelBox').classList.add('hidden'); var f=$('annotateFab'); if(f) f.classList.remove('hidden'); }
function closePdf(){ let b=curBook(); if(b) b.mode='scroll'; showView('library'); }
function setReaderMode(m){
  closeReaderCards();
  $('modeScrollBtn').classList.toggle('active',m==='scroll'); $('modePageBtn').classList.toggle('active',m==='page');
  let b=curBook(); if(b){ b.mode=m; if(b.kind==='pdf') renderPdfBook(); else renderEpubBook(); }
  toast(m==='scroll'?'Scroll view':'Page view, one at a time. Use Prev and Next.');
}
function setReaderTheme(v){ $('readerArticle').className='reader '+v; let pv=$('pdfView'); pv.style.filter= v==='dark'? 'invert(0.92) hue-rotate(180deg)':''; }
function readerFont(d){ let cur=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-fs'))||19; let next=Math.max(15,Math.min(26,cur+d*1.5)); document.documentElement.style.setProperty('--reader-fs',next+'px'); }
function toggleReaderSide(){ $('readerSide').classList.toggle('open'); }
function updateResume(){
  let b=curBook(); if(!b) return;
  scheduleSave();
  if(b.kind==='pdf'){ $('pageLabel').textContent='Page '+b.page+' / '+b.numPages; $('resumeLabel').textContent='Reading · '+b.title+' · Page '+b.page+' of '+b.numPages+' · '+Math.round(b.page/b.numPages*100)+'%. Resumes here.'; S.stats.pagesRead['pdf:'+b.id+':'+b.page]=1; }
  else { $('pageLabel').textContent='Chapter '+(b.ch+1)+' / '+b.chapters.length; $('resumeLabel').textContent='Reading · '+b.title+' · Chapter '+(b.ch+1)+' of '+b.chapters.length+'. Resumes here.'; S.stats.pagesRead['epub:'+b.id+':'+b.ch]=1; }
  syncBookmarkBtn();
}

/* --- EPUB rendering --- */
function renderEpubBook(){
  let b=curBook(); if(!b||b.kind!=='epub') return;
  /* the lookup card may have been parked inside the body next to a
     selection — rescue it (and the OCR panel) before innerHTML is rebuilt */
  ['dictBox','ocrBox'].forEach(id=>{ let el=$(id); if(el && el.closest('#readerBody')) $('readerArticle').appendChild(el); });
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
function wrapTextOnce(container,needle,kind){
  if(!container||!needle) return false;
  let walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT,{acceptNode:n=>{
    if(!n.nodeValue||n.nodeValue.indexOf(needle)<0) return NodeFilter.FILTER_REJECT;
    if(n.parentElement && n.parentElement.closest('mark,[data-hl]')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  let node=walker.nextNode(); if(!node) return false;
  let idx=node.nodeValue.indexOf(needle);
  let range=document.createRange(); range.setStart(node,idx); range.setEnd(node,idx+needle.length);
  let wrapEl;
  if(kind==='underline'){ wrapEl=document.createElement('span'); wrapEl.style.cssText='text-decoration:underline;text-decoration-color:#2456c8;text-decoration-thickness:2px'; }
  else if(kind==='strike'){ wrapEl=document.createElement('span'); wrapEl.style.cssText='text-decoration:line-through;text-decoration-color:#b23a2e;text-decoration-thickness:2px'; }
  else wrapEl=document.createElement('mark');
  wrapEl.setAttribute('data-hl','1');
  try{ range.surroundContents(wrapEl); return true; }catch(e){ return false; }
}
function reapplyAnnotations(){
  let b=curBook(); if(!b||b.kind!=='epub') return;
  (b.annotations||[]).forEach(a=>{
    let m=/Chapter\s+(\d+)/.exec(a.where||''); let ci=m? (+m[1]-1) : b.ch;
    let container= b.mode==='page'? (ci===b.ch? $('readerBody') : null) : document.querySelector('[data-ch="'+ci+'"]');
    if(container) wrapTextOnce(container,a.text,a.kind||'highlight');
  });
}
/* P3: lookup / OCR cards — closable, and never left behind on a new page */
function closeReaderCards(){ let d=$('dictBox'); if(d) d.classList.add('hidden'); let o=$('ocrBox'); if(o) o.classList.add('hidden'); }
function jumpToChapter(i){ let b=curBook(); if(!b||b.kind!=='epub') return; closeReaderCards(); b.ch=Math.max(0,Math.min(b.chapters.length-1,i));
  if(b.mode==='page') renderEpubBook(); else { let el=document.querySelector('[data-ch="'+b.ch+'"]'); if(el) el.scrollIntoView({behavior:'smooth'}); updateResume(); }
  renderReaderSide(); }

/* --- PDF rendering with real text layer --- */
let pdfToken=0, pdfObserver=null;
function pdfPageWidth(){ let host=$('pdfPages'); return Math.max(260,(host&&host.clientWidth)||document.documentElement.clientWidth-32); }
async function renderPdfTextLayer(page,vp,holder,book,pageNum){
  try{
    let tc=await page.getTextContent();
    let layer=document.createElement('div'); layer.className='textLayer'; holder.appendChild(layer);
    let vpCss=page.getViewport({scale:vp.scale/(Math.min(window.devicePixelRatio||1,2))});
    let full='';
    tc.items.forEach(item=>{
      if(!item.str) return;
      let tx=pdfjsLib.Util.transform(vpCss.transform,item.transform);
      let fontSize=Math.hypot(tx[2],tx[3]);
      let span=document.createElement('span');
      span.textContent=item.str;
      span.style.left=tx[4]+'px'; span.style.top=(tx[5]-fontSize)+'px'; span.style.fontSize=fontSize+'px';
      span.dataset.pg=pageNum;
      layer.appendChild(span);
      full+=item.str+' ';
      requestAnimationFrame(()=>{ let w=item.width*vpCss.scale; let ow=span.offsetWidth; if(ow>2 && w>2) span.style.transform='scaleX('+(w/ow)+')'; });
    });
    book.textCache[pageNum]=full.trim();
  }catch(e){ /* text layer is best-effort; page image still reads */ }
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
  renderPdfLinks(page,vp,holder,book);
}
/* Follow links from the background PDF: link annotations become clickable
   overlays — web links open in a new tab, internal links jump pages. */
async function renderPdfLinks(page,vp,holder,book){
  try{
    let annos=await page.getAnnotations();
    annos.forEach(a=>{
      if(a.subtype!=='Link' || !a.rect) return;
      let r=pdfjsLib.Util.normalizeRect(a.rect);
      let rect=vp.convertToViewportRectangle(r);
      let x=Math.min(rect[0],rect[2]), y=Math.min(rect[1],rect[3]), w=Math.abs(rect[2]-rect[0]), h=Math.abs(rect[3]-rect[1]);
      if(w<2||h<2) return;
      let link=document.createElement('a'); link.className='pdfLink';
      link.style.left=x+'px'; link.style.top=y+'px'; link.style.width=w+'px'; link.style.height=h+'px';
      if(a.url){ link.href=a.url; link.target='_blank'; link.rel='noopener'; link.title=a.url; }
      else if(a.dest){
        link.href='#'; link.title='Go to linked page';
        link.addEventListener('click',async ev=>{
          ev.preventDefault();
          try{ let dest=typeof a.dest==='string'? await book.doc.getDestination(a.dest):a.dest; let idx=await book.doc.getPageIndex(dest[0]); jumpToPdfPage(idx+1); }
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
  $('pdfName').textContent=b.fileName||b.title;
  $('pdfMeta').textContent=b.numPages+' page'+(b.numPages===1?'':'s')+' • Fit to width • Text is selectable';
  let st=$('pdfStatus'); st.classList.remove('hidden'); st.textContent='Rendering pages…';
  if(b.mode==='page'){ try{ await renderPdfPageInto(b.page,host,b); }catch(e){} if(token!==pdfToken) return; st.classList.add('hidden'); updateResume(); renderReaderSide(); return; }
  for(let n=1;n<=b.numPages;n++){ if(token!==pdfToken) return; try{ await renderPdfPageInto(n,host,b); }catch(e){} if(n===1) st.classList.add('hidden'); }
  if(token!==pdfToken) return;
  updateResume(); renderReaderSide();
  let target=document.querySelector('.pdfPage[data-page="'+b.page+'"]'); if(target && b.page>1) target.scrollIntoView();
  pdfObserver=new IntersectionObserver(es=>{ es.forEach(en=>{ if(en.isIntersecting){ b.page=+en.target.dataset.page; updateResume(); } }); },{rootMargin:'-35% 0px -55% 0px'});
  host.querySelectorAll('.pdfPage').forEach(el=>pdfObserver.observe(el));
}
function jumpToPdfPage(n){
  let b=curBook(); if(!b||b.kind!=='pdf') return; closeReaderCards();
  b.page=Math.max(1,Math.min(b.numPages,n));
  if(b.mode==='page'){ renderPdfBook(); window.scrollTo({top:0}); }
  else { let el=document.querySelector('.pdfPage[data-page="'+b.page+'"]'); if(el) el.scrollIntoView({behavior:'smooth'}); updateResume(); }
}
let pdfResizeT=null;
window.addEventListener('resize',()=>{ if(S.view==='editor' && document.activeElement && document.activeElement.className!=='canvasText') renderCanvasTexts(); let b=curBook(); if(!b||b.kind!=='pdf'||S.view!=='reader') return; clearTimeout(pdfResizeT); pdfResizeT=setTimeout(()=>renderPdfBook(),400); });

/* --- reader sidebar: TOC, bookmarks, annotations, thumbnails --- */
async function renderReaderSide(){
  scheduleSave();
  let b=curBook(); let toc=$('tocList'), bm=$('bookmarkList'), an=$('annoList'), th=$('thumbList');
  if(!b){ toc.innerHTML='<p class="kbd">Open a book to see its contents.</p>'; return; }
  bm.innerHTML= b.bookmarks.length? b.bookmarks.map(x=>'<div class="listRow"><span>'+esc(x.label)+'</span><button class="btn small" onclick="jumpBookmark('+x.at+')">Go</button></div>').join('') : '<p class="kbd">No bookmarks yet</p>';
  an.innerHTML= b.annotations.length? b.annotations.map(a=>'<div class="listRow"><span style="font-size:13px;line-height:1.45">“'+esc(a.text.slice(0,90))+'”<br/><span class="kbd">'+esc(a.where)+(a.kind&&a.kind!=='highlight'?' · '+esc(a.kind):'')+'</span></span></div>').join('')+'<button class="btn small" style="margin-top:8px" onclick="exportAnnotations()">Export annotations</button>' : '<p class="kbd">Select text → Highlight, Underline or Strikethrough</p>';
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
    for(let n=1;n<=b.numPages;n++){
      if(curBook()!==b) return;
      let item=document.createElement('div'); item.className='thumbItem'+(n===b.page?' active':''); item.innerHTML='<span class="kbd">Page '+n+'</span>';
      item.onclick=()=>jumpToPdfPage(n); th.appendChild(item);
      try{ let pg=await b.doc.getPage(n); let v0=pg.getViewport({scale:1}); let vp=pg.getViewport({scale:130/v0.width});
        let cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
        await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        item.insertBefore(cv,item.firstChild);
      }catch(e){}
      if(n%4===0) await new Promise(r=>setTimeout(r,10));
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
     visible — it used to land inside a collapsed <details>. */
  let bd=$('bookmarkDetails'); if(bd) bd.open=true;
}
function changePage(d){
  let b=curBook(); if(!b){ toast('Open a book first'); return; }
  if(b.kind==='pdf') jumpToPdfPage(b.page+d);
  else jumpToChapter(b.ch+d);
}

/* --- highlights & annotations --- */
function annotateSelection(kind){
  let b=curBook(); if(!b){ toast('Open a book first'); return; }
  let sel=window.getSelection(); let text=sel.toString().trim();
  if(!text){ toast('Select some text in the book first'); return; }
  let where='';
  try{
    let range=sel.getRangeAt(0);
    let node=range.commonAncestorContainer.nodeType===1? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    let holder=node.closest? node.closest('.pdfPage') : null;
    let chEl=node.closest? node.closest('[data-ch]') : null;
    if(b.kind==='pdf') where='PDF page '+(holder? holder.dataset.page : b.page);
    else where='Chapter '+( (chEl? +chEl.dataset.ch : b.ch) +1)+' · '+b.chapters[chEl? +chEl.dataset.ch : b.ch].title;
    let wrapEl;
    if(kind==='underline'){ wrapEl=document.createElement('span'); wrapEl.style.cssText='text-decoration:underline;text-decoration-color:#2456c8;text-decoration-thickness:2px'; }
    else if(kind==='strike'){ wrapEl=document.createElement('span'); wrapEl.style.cssText='text-decoration:line-through;text-decoration-color:#b23a2e;text-decoration-thickness:2px'; }
    else wrapEl=document.createElement('mark');
    try{ range.surroundContents(wrapEl); }
    catch(e2){
      /* P7: a selection crossing element boundaries makes
         surroundContents() throw. Fall back to extracting the selected
         contents into the wrapper and inserting that instead, so the
         annotation is still made instead of silently dropped. */
      let frag=range.extractContents();
      wrapEl.appendChild(frag);
      range.insertNode(wrapEl);
    }
  }catch(e){ toast('Select a clean stretch inside one paragraph'); return; }
  b.annotations.push({text:text, where:where, kind:kind});
  sel.removeAllRanges();
  renderReaderSide(); renderLibrary();
  /* P7: open the Annotations panel so the new entry is visible. */
  let ad=$('annoDetails'); if(ad) ad.open=true;
  toast((kind==='highlight'?'Highlighted': kind==='underline'?'Underlined':'Struck through')+' & saved to annotations');
}
function highlightSelection(){ annotateSelection('highlight'); }
function underlineSelection(){ annotateSelection('underline'); }
function strikeSelection(){ annotateSelection('strike'); }
function exportAnnotations(){
  let b=curBook(); if(!b||!b.annotations.length){ toast('No annotations to export'); return; }
  let txt=b.title+' annotations\n\n'+b.annotations.map(a=>'• '+a.text+'\n  ('+a.where+')').join('\n\n');
  download('annotations-'+b.title.replace(/[^\w\- ]+/g,'')+'.txt', new Blob([txt],{type:'text/plain'}));
}

/* --- dictionary / Wikipedia: live lookup --- */
/* P9: normalise a messy selection to the word the reader means.
   Take the LAST word of the selection, then strip punctuation from its
   two ends only — inner characters (the apostrophe in "don't", the
   hyphen in "well-known") are part of the word and stay. A token that
   is pure punctuation (an em dash, a quote mark) is skipped for the
   word before it. Written from that rule, not from the audit's regex:
   its trailing alternative stripped word characters, not punctuation. */
function normalizeLookupWord(raw){
  let tokens=String(raw||'').trim().split(/\s+/).filter(Boolean);
  for(let i=tokens.length-1;i>=0;i--){
    let w=tokens[i].replace(/^[^\p{L}\p{N}]+/u,'').replace(/[^\p{L}\p{N}]+$/u,'');
    if(w) return w;
  }
  return '';
}
async function lookupSelection(){
  let w=normalizeLookupWord(window.getSelection().toString());
  let box=$('dictBox');
  if(!w){ toast('Select a word in the text first'); return; }
  /* P3: park the card right after the paragraph the word sits in, so it
     lands on-screen next to the selection instead of at the end of the
     whole book (where it sat in Scroll mode), and give it a close button. */
  try{ let sel=window.getSelection(); if(sel.rangeCount){ let node=sel.getRangeAt(0).commonAncestorContainer; let el=node.nodeType===1? node : node.parentElement; let block=el && el.closest? (el.closest('p,li,div')||el) : null; if(block && block.parentNode) block.parentNode.insertBefore(box, block.nextSibling); } }catch(e){}
  let closeBtn='<div class="cardHead"><span></span><button class="btn small cardClose" type="button" onclick="closeReaderCards()" aria-label="Close lookup">✕ Close</button></div>';
  box.classList.remove('hidden'); box.innerHTML=closeBtn+'<b>'+esc(w)+'</b><p class="kbd">Looking it up…</p>'; box.scrollIntoView({behavior:'smooth',block:'nearest'});
  let html=closeBtn+'<b style="font-size:18px">'+esc(w)+'</b>';
  try{
    let r=await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(w.toLowerCase()));
    if(r.ok){ let data=await r.json(); let e0=data[0];
      if(e0.phonetic) html+=' <span class="kbd">'+esc(e0.phonetic)+'</span>';
      e0.meanings.slice(0,2).forEach(m=>{ html+='<p style="line-height:1.6;font-family:Newsreader,serif"><i>'+esc(m.partOfSpeech)+'</i>: '+esc(m.definitions[0].definition)+'</p>'; });
    } else html+='<p class="kbd">No dictionary entry for this word.</p>';
  }catch(e){ html+='<p class="kbd">Dictionary needs a connection. Try again.</p>'; }
  try{
    let r2=await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(w));
    if(r2.ok){ let s=await r2.json(); if(s.extract) html+='<p style="line-height:1.6;font-family:Newsreader,serif"><b>Wikipedia:</b> '+esc(s.extract.slice(0,420))+'…</p>'; }
  }catch(e){}
  html+='<p><a href=https://en.wiktionary.org/wiki/'+encodeURIComponent(w.toLowerCase())+' target=_blank rel=noopener>Wiktionary</a> · <a href=https://en.wikipedia.org/wiki/'+encodeURIComponent(w)+' target=_blank rel=noopener>Wikipedia</a></p>';
  box.innerHTML=html;
}

/* --- OCR: Tesseract.js on-device --- */
let lastOcrText='';
function openOcrPanel(){ let box=$('ocrBox'); /* P3: move the panel to the top of the article so it opens on-screen, not past the end of the book */ let art=$('readerArticle'); if(art && box.parentNode!==art) art.appendChild(box); if(art) art.insertBefore(box, $('readerBody')); box.classList.remove('hidden'); box.scrollIntoView({behavior:'smooth',block:'nearest'}); }
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
async function runOcrOn(source,label){
  if(!window.Tesseract){ toast('OCR engine could not load. Check the connection.'); return; }
  let st=$('ocrStatus'), pr=$('ocrProgress'), btn=$('ocrRunBtn');
  pr.classList.remove('hidden'); pr.value=0; btn.disabled=true; st.textContent='Starting OCR ('+label+')…';
  try{
    let res=await Tesseract.recognize(source, $('ocrLang').value, { logger:m=>{ if(m.status==='recognizing text'){ pr.value=m.progress; st.textContent='Recognising… '+Math.round(m.progress*100)+'%'; } else if(m.status) st.textContent=m.status+'…'; } });
    lastOcrText=(res.data.text||'').trim();
    $('ocrText').textContent= lastOcrText || 'No print text was recognised on this page.';
    $('ocrCopyBtn').classList.toggle('hidden', !lastOcrText);
    $('ocrNoteBtn').classList.toggle('hidden', !lastOcrText);
    st.textContent= lastOcrText? 'Done. '+lastOcrText.split(/\s+/).length+' words recognised.' : 'Nothing recognised.';
  }catch(err){ st.textContent='OCR failed ('+(err&&err.message?err.message:'error')+'). Language data downloads on first use, so check the connection and retry.'; }
  pr.classList.add('hidden'); btn.disabled=false;
}
async function runOCR(){ let src=await ocrSourceCanvas(); if(!src){ toast('Open a PDF page (or a notebook page) to OCR'); return; } runOcrOn(src,'this page'); }
function ocrImageFile(e){ let f=e.target.files[0]; e.target.value=''; if(!f) return; let img=new Image(); img.onload=()=>runOcrOn(img,'image'); img.src=URL.createObjectURL(f); }
function copyOcrText(){ if(navigator.clipboard) navigator.clipboard.writeText(lastOcrText).then(()=>toast('OCR text copied')); }
function ocrToNote(){
  let nb=curNb()||S.items.find(i=>i.kind==='notebook');
  if(!nb){ nb=createNotebookSilent('OCR notes','#7c2d12','blank'); }
  let p=nb.pages[nb.cur]; p.text=(p.text? p.text+'\n\n':'')+'[OCR] '+lastOcrText;
  if(curNb()===nb){ $('noteText').value=p.text; updateWordCount(); }
  toast('OCR text added to “'+nb.title+'”');
}

/* --- handwriting to text: Tesseract over the ink canvas --- */
async function handwritingToText(){
  let p=curPageObj(); if(!p){ toast('Open a notebook first'); return; }
  if(!p.ink.length){ toast('Write something on the page first'); return; }
  if(!window.Tesseract){ toast('Recognition engine could not load. Check the connection.'); return; }
  let btn=$('hwBtn'); btn.disabled=true; btn.textContent='Recognising…';
  try{
    let comp=composePage(p,'blank');
    let res=await Tesseract.recognize(comp,'eng');
    let text=(res.data.text||'').replace(/\s+\n/g,'\n').trim();
    if(text){ $('noteText').value=($('noteText').value? $('noteText').value+'\n':'')+text; saveEditorToModel(); updateWordCount(); toast('Handwriting recognised and added below'); }
    else toast('No text recognised. Try larger, clearer letters.');
  }catch(e){ toast('Recognition failed. Check the connection and retry.'); }
  btn.disabled=false; btn.textContent='Handwriting → Text';
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
  if(b.kind==='pdf') return b.textCache[b.page]||'';
  return '';
}
function toggleTTS(){
  if(!('speechSynthesis' in window)){ toast('Speech is not supported in this browser'); return; }
  if(speaking){ speechSynthesis.cancel(); speaking=false; setBtnContent('ttsBtn','player-play','Play'); return; }
  let text=currentReadableText();
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
  if(existing){ openNotebook(existing.id); toast('Opened your annotation notebook for this PDF'); return; }
  toast('Preparing annotation pages…');
  let nb={id:uid(),kind:'notebook',title:'Annotations for '+b.title,color:'#1e3a5f',template:'blank',cur:0,updated:'Just now',annotations:[],pdfBookId:id,pages:[]};
  for(let n=1;n<=b.numPages;n++){
    let pg=blankPage();
    try{ let page=await b.doc.getPage(n); let v0=page.getViewport({scale:1}); let vp=page.getViewport({scale:CW/v0.width});
      let cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
      await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
      pg.bgPdf={img:cv,page:n,bookTitle:b.title};
    }catch(e){}
    nb.pages.push(pg);
  }
  S.items.unshift(nb); openNotebook(nb.id);
  toast('Annotate freely. Ink stays in this notebook, and the PDF file is untouched.');
}
function annotateCurrentPdf(){ let b=curBook(); if(b) annotatePdf(b.id); }

/* ============ focus timer ============ */
let timerSec=25*60, timerInt=null;
/* P8: every Focus label updates together — the Library button
   (#timerLabel) and the editor's Focus button (.timerLabel) — so the
   countdown is visible in whichever view the timer was started from. */
function setTimerLabel(txt){ document.querySelectorAll('#timerLabel, .timerLabel').forEach(el=>{ el.textContent=txt; }); }
function openTimer(){
  if(timerInt){ clearInterval(timerInt); timerInt=null; timerSec=25*60; setTimerLabel('Focus 25:00'); toast('Focus timer stopped'); return; }
  toast('Focus timer started. 25 minutes.');
  timerInt=setInterval(()=>{ timerSec--; let m=Math.floor(timerSec/60),s=timerSec%60; setTimerLabel('Focus '+m+':'+String(s).padStart(2,'0'));
    if(timerSec<=0){ clearInterval(timerInt); timerInt=null; timerSec=25*60; setTimerLabel('Focus 25:00'); S.stats.focusDone++; updateStatsPanel(); toast('Focus session done. Nice work.'); } },1000);
}

/* ============ session stats ticker ============ */
setInterval(()=>{ if(S.view==='editor') S.stats.writeSec++; if(S.view==='reader') S.stats.readSec++; if(S.stats.writeSec%15===0||S.stats.readSec%15===0) updateStatsPanel(); },1000);

/* ============ hash routing (P14, safe part) ============
   Routes: #/ (library), #/note/:id (notebook editor), #/book/:id (reader).
   Back/Forward now move between shelf, notebook and book. This stays a
   classic script on purpose: dozens of inline onclick/onchange/oninput
   handlers call these functions as globals, so converting to ES modules
   would break every one of them. No test suite is added in this pass. */
function syncHashForView(v){
  let h= v==='editor' && S.curNbId? '#/note/'+S.curNbId : v==='reader' && S.curBookId? '#/book/'+S.curBookId : '#/';
  if(window.location.hash!==h){ try{ history.pushState(null,'',h); }catch(e){ /* sandboxed frames may refuse pushState — the view still works, only the hash stays stale */ } }
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
updateOptsRow();
initApp();
async function initApp(){
  /* First paint must not wait for storage. Paint the starter shelf —
     the two built-in demos — straight away, with saves still OFF so
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
