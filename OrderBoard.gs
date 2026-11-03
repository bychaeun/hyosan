// 수주현황판: 사무실 PC(automation/order-sync)가 10분마다 보낸 ERP 조회 결과를 보관하고, 로그인한 사용자에게 돌려준다.
// 전송 키는 스크립트 속성 ORDER_PUSH_SECRET — 처음 한 번 편집기에서 orderBoardSetup 을 실행해 만든다.
// 보관: 숨김 시트 ORDER_BOARD_DATA(압축) + 스크립트 캐시(바로 응답용). 휴대폰은 지문(hash)이 같으면 "변경 없음"만 받는다.
const ORDER_BOARD_SHEET='ORDER_BOARD_DATA',ORDER_BOARD_CHUNK=45000,ORDER_CACHE_CHUNK=30000,ORDER_CACHE_TTL=21600;

function orderBoardSetup(){
  const props=PropertiesService.getScriptProperties();let secret=props.getProperty('ORDER_PUSH_SECRET');
  if(!secret){secret=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');props.setProperty('ORDER_PUSH_SECRET',secret)}
  orderBoardSheet_();
  Logger.log('수주 전송 키: '+secret);
}

function orderBoardCheckKey_(body){
  const secret=PropertiesService.getScriptProperties().getProperty('ORDER_PUSH_SECRET');
  if(!secret||typeof body.secret!=='string'||!orderBoardSafeEqual_(body.secret,secret))throw appError_('수주 전송 키가 올바르지 않습니다.','ORDER_PUSH_DENIED');
}

/* PC가 조회 전에 묻는다: 다른 PC가 방금 보냈으면 DB 조회를 건너뛴다.
   papers:true 이면 재고를 조회할 종이 넘버 목록(시트 HYOSAN_LPM에 있는 것만)도 함께 준다 */
function orderBoardStatus_(body){
  orderBoardCheckKey_(body);
  const meta=orderBoardMeta_(),res={ok:true,updatedAt:meta?meta.updatedAt:null};
  if(body.papers===true)res.papers=stockPapers_();
  res.newPapersDue=newPapersDue_();   // 7일이 지났으면 PC가 신규 종이 목록도 보낸다
  res.erpItemsDue=erpItemsDue_();     // 7일이 지났으면 PC가 ERP 품목·비고도 보낸다
  return res;
}

function orderBoardPush_(body){
  orderBoardCheckKey_(body);
  const board=body.board;
  if(!board||!Array.isArray(board.orders)||!Array.isArray(board.locates))throw appError_('수주 데이터 형식이 올바르지 않습니다.','ORDER_PUSH_INVALID');
  const generatedAt=String(body.generatedAt||''),json=JSON.stringify(board);
  const hash=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,json,Utilities.Charset.UTF_8)).slice(0,22);
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const sh=orderBoardSheet_(),head=sh.getRange(1,1,1,6).getDisplayValues()[0],previous=head[1]||'';
    if(previous&&previous>generatedAt)return {ok:true,skipped:true,updatedAt:previous};   // 다른 PC가 더 새 데이터를 이미 보냄
    if(body.stock&&typeof body.stock==='object')stockSave_(body.stock,generatedAt);
    if(head[5]===hash&&Number(head[3])){                                                   // 내용 그대로: 갱신 시각만
      sh.getRange(1,2).setNumberFormat('@').setValue(generatedAt);
      orderBoardCacheMeta_({updatedAt:generatedAt,hash,chunks:Number(head[3])});
      return {ok:true,unchanged:true,updatedAt:generatedAt};
    }
    const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json,'application/json')).getBytes());
    const chunks=[];for(let i=0;i<packed.length;i+=ORDER_BOARD_CHUNK)chunks.push([packed.slice(i,i+ORDER_BOARD_CHUNK)]);
    if(sh.getMaxRows()<chunks.length+1)sh.insertRowsAfter(sh.getMaxRows(),chunks.length+1-sh.getMaxRows());
    sh.getRange(2,1,sh.getMaxRows()-1,1).clearContent();
    sh.getRange(2,1,chunks.length,1).setNumberFormat('@').setValues(chunks);
    sh.getRange(1,1,1,6).setNumberFormat('@').setValues([['updatedAt',generatedAt,'chunks',String(chunks.length),'hash',hash]]);
    orderBoardCacheWrite_(json,{updatedAt:generatedAt,hash,chunks:chunks.length});
    return {ok:true,updatedAt:generatedAt,orders:board.orders.length};
  }finally{lock.releaseLock()}
}

/* 로그인 사용자 응답: 지문이 같으면 변경 없음, 다르면 캐시의 원문을 그대로 붙여 보낸다(다시 해석·변환하지 않음) */
function orderBoardResponse_(body,user){
  const meta=orderBoardMeta_();
  if(!meta)return jsonOutput(renewSessionResponse_(body,user,{ok:true,board:null,updatedAt:null}));
  const head=renewSessionResponse_(body,user,{ok:true,updatedAt:meta.updatedAt,hash:meta.hash});
  if(body.since&&body.since===meta.hash){head.notModified=true;return jsonOutput(head)}
  const text=JSON.stringify(head);
  return ContentService.createTextOutput(text.slice(0,-1)+',"board":'+orderBoardRaw_(meta)+'}').setMimeType(ContentService.MimeType.JSON);
}

function orderBoardMeta_(){
  try{const cached=CacheService.getScriptCache().get('order-board-meta');if(cached)return JSON.parse(cached)}catch(e){}
  const sh=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ORDER_BOARD_SHEET);if(!sh)return null;
  const head=sh.getRange(1,1,1,6).getDisplayValues()[0];
  if(!Number(head[3]))return null;
  const meta={updatedAt:head[1]||null,hash:head[5]||'',chunks:Number(head[3]),parts:0};
  orderBoardCacheMeta_(meta);
  return meta;
}

function orderBoardRaw_(meta){
  if(meta.parts){
    const keys=[];for(let i=0;i<meta.parts;i++)keys.push('order-board-raw-'+i);
    try{const got=CacheService.getScriptCache().getAll(keys);if(keys.every(k=>got[k]!=null))return keys.map(k=>got[k]).join('')}catch(e){}
  }
  const sh=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ORDER_BOARD_SHEET);
  const packed=sh.getRange(2,1,meta.chunks,1).getDisplayValues().map(r=>r[0]).join('');
  const json=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(packed),'application/x-gzip')).getDataAsString('UTF-8');
  orderBoardCacheWrite_(json,meta);
  return json;
}

function orderBoardCacheWrite_(json,meta){
  try{
    const parts={},count=Math.ceil(json.length/ORDER_CACHE_CHUNK);
    for(let i=0;i<count;i++)parts['order-board-raw-'+i]=json.slice(i*ORDER_CACHE_CHUNK,(i+1)*ORDER_CACHE_CHUNK);
    parts['order-board-meta']=JSON.stringify({updatedAt:meta.updatedAt,hash:meta.hash,chunks:meta.chunks,parts:count});
    CacheService.getScriptCache().putAll(parts,ORDER_CACHE_TTL);
  }catch(e){}
}

function orderBoardCacheMeta_(meta){
  try{
    const cache=CacheService.getScriptCache(),old=JSON.parse(cache.get('order-board-meta')||'{}');
    const parts=old.hash===meta.hash?old.parts||0:0;
    cache.put('order-board-meta',JSON.stringify({updatedAt:meta.updatedAt,hash:meta.hash,chunks:meta.chunks,parts}),ORDER_CACHE_TTL);
  }catch(e){}
}

function orderBoardSheet_(){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);let sh=ss.getSheetByName(ORDER_BOARD_SHEET);
  if(!sh){sh=ss.insertSheet(ORDER_BOARD_SHEET);sh.hideSheet()}
  return sh;
}

/* ───── 재고: 사무실 PC가 수주와 같은 전송에 함께 보낸다(body.stock) ─────
   { papers:{종이넘버:{stock,rolls}}, lpm:{종이넘버:[{s:사양,t:규격,q:매수}]} } — 시트 HYOSAN_LPM의 종이 넘버만.
   보관: 숨김 시트 STOCK_DATA(압축) + 스크립트 캐시. 상위 사용자만 받는다. */
const STOCK_SHEET='STOCK_DATA';
function stockKey_(value){return String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase()}
function stockPapers_(){
  const seen=new Set();
  (getAllData_(false).lpm||[]).forEach(r=>String(r.PaperNumber||r.PaperNo||'').split(/[\r\n,;|]+/).forEach(v=>{const k=stockKey_(v);if(k&&k!=='-')seen.add(k)}));
  return Array.from(seen).sort();
}
function stockSave_(stock,generatedAt){
  const json=JSON.stringify(stock),hash=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,json,Utilities.Charset.UTF_8)).slice(0,22);
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);let sh=ss.getSheetByName(STOCK_SHEET);if(!sh){sh=ss.insertSheet(STOCK_SHEET);sh.hideSheet()}
  const head=sh.getRange(1,1,1,6).getDisplayValues()[0];
  if(head[5]===hash&&Number(head[3])){sh.getRange(1,2).setNumberFormat('@').setValue(generatedAt);stockCachePut_(null,{updatedAt:generatedAt,hash,chunks:Number(head[3])});return}
  const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json,'application/json')).getBytes());
  const chunks=[];for(let i=0;i<packed.length;i+=ORDER_BOARD_CHUNK)chunks.push([packed.slice(i,i+ORDER_BOARD_CHUNK)]);
  if(sh.getMaxRows()<chunks.length+1)sh.insertRowsAfter(sh.getMaxRows(),chunks.length+1-sh.getMaxRows());
  sh.getRange(2,1,sh.getMaxRows()-1,1).clearContent();
  sh.getRange(2,1,chunks.length,1).setNumberFormat('@').setValues(chunks);
  sh.getRange(1,1,1,6).setNumberFormat('@').setValues([['updatedAt',generatedAt,'chunks',String(chunks.length),'hash',hash]]);
  stockCachePut_(json,{updatedAt:generatedAt,hash,chunks:chunks.length});
}
function stockMeta_(){
  try{const cached=CacheService.getScriptCache().get('stock-meta');if(cached)return JSON.parse(cached)}catch(e){}
  const sh=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(STOCK_SHEET);if(!sh)return null;
  const head=sh.getRange(1,1,1,6).getDisplayValues()[0];if(!Number(head[3]))return null;
  const meta={updatedAt:head[1]||null,hash:head[5]||'',chunks:Number(head[3]),parts:0};
  stockCachePut_(null,meta);return meta;
}
function stockRaw_(meta){
  if(meta.parts){
    const keys=[];for(let i=0;i<meta.parts;i++)keys.push('stock-raw-'+i);
    try{const got=CacheService.getScriptCache().getAll(keys);if(keys.every(k=>got[k]!=null))return keys.map(k=>got[k]).join('')}catch(e){}
  }
  const sh=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(STOCK_SHEET);
  const packed=sh.getRange(2,1,meta.chunks,1).getDisplayValues().map(r=>r[0]).join('');
  const json=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(packed),'application/x-gzip')).getDataAsString('UTF-8');
  stockCachePut_(json,meta);return json;
}
// json이 없으면 메타만 갱신(본문 캐시는 지문이 같을 때만 유지)
function stockCachePut_(json,meta){
  try{
    const cache=CacheService.getScriptCache(),values={};let parts=0;
    if(json!=null){parts=Math.ceil(json.length/ORDER_CACHE_CHUNK);for(let i=0;i<parts;i++)values['stock-raw-'+i]=json.slice(i*ORDER_CACHE_CHUNK,(i+1)*ORDER_CACHE_CHUNK)}
    else{const old=JSON.parse(cache.get('stock-meta')||'{}');parts=old.hash===meta.hash?old.parts||0:0}
    values['stock-meta']=JSON.stringify({updatedAt:meta.updatedAt,hash:meta.hash,chunks:meta.chunks,parts});
    cache.putAll(values,ORDER_CACHE_TTL);
  }catch(e){}
}
function stockResponse_(body,user){
  const meta=stockMeta_();
  if(!meta)return jsonOutput(renewSessionResponse_(body,user,{ok:true,stock:null,updatedAt:null}));
  const head=renewSessionResponse_(body,user,{ok:true,updatedAt:meta.updatedAt,hash:meta.hash});
  if(body.since&&body.since===meta.hash){head.notModified=true;return jsonOutput(head)}
  const text=JSON.stringify(head);
  return ContentService.createTextOutput(text.slice(0,-1)+',"stock":'+stockRaw_(meta)+'}').setMimeType(ContentService.MimeType.JSON);
}

function orderBoardSafeEqual_(a,b){
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

/* ───── 신규 종이(ERP): 사무실 PC가 7일마다(상태 응답의 newPapersDue) 최근 2년 입고 종이 중 HYOSAN_LPM에 없는 것을 보낸다 ─────
   papers:[{paper,company,first,last,lots,color}] → 'HYOSAN_LPM'과 같은 열의 '신규 종이(ERP)' 시트 맨 아래에 비활성으로 덧붙인다.
   사람이 HYOSAN_LPM으로 옮긴 뒤 지운 행·그냥 지운 행은 다시 넣지 않는다(한 번 넣은 종이넘버는 숨김 시트 NEW_PAPERS_SEEN에 기록).
   이미 HYOSAN_LPM에 들어간 종이는 이 시트에서 지운다. LPM_ID는 비워 두면 매시간 동기화가 붙인다. */
const NEW_PAPER_SHEET='신규 종이(ERP)',NEW_PAPER_SEEN='NEW_PAPERS_SEEN',NEW_PAPER_DAYS=7;
function newPapersDue_(){return Date.now()-Number(PropertiesService.getScriptProperties().getProperty('NEW_PAPERS_AT')||0)>NEW_PAPER_DAYS*864e5}
function newPapersPush_(body){
  orderBoardCheckKey_(body);
  if(!Array.isArray(body.papers))throw appError_('신규 종이 데이터 형식이 올바르지 않습니다.','NEW_PAPERS_INVALID');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const ss=SpreadsheetApp.openById(SPREADSHEET_ID),lpm=ss.getSheetByName(SHEET_NAMES.lpm),width=lpm.getLastColumn(),head=lpm.getRange(1,1,1,width).getDisplayValues()[0],col=name=>head.indexOf(name);
    if(col('PaperNumber')<0||col('Active')<0)throw appError_('HYOSAN_LPM 열 구조를 찾지 못했습니다.','NEW_PAPERS_HEADER');
    const present=new Set();
    lpm.getRange(2,col('PaperNumber')+1,Math.max(1,lpm.getLastRow()-1),1).getDisplayValues().forEach(r=>String(r[0]).split(/[\r\n,;|]+/).forEach(v=>{const k=stockKey_(v);if(k)present.add(k)}));
    let sh=ss.getSheetByName(NEW_PAPER_SHEET);
    if(!sh){   // 처음: HYOSAN_LPM 머리글·열 너비·첫 행 서식 그대로
      sh=ss.insertSheet(NEW_PAPER_SHEET);
      lpm.getRange(1,1,1,width).copyTo(sh.getRange(1,1,1,width));
      for(let c=1;c<=width;c++)sh.setColumnWidth(c,lpm.getColumnWidth(c));
      sh.setFrozenRows(1);
    }else if(sh.getLastColumn()<width){const had=sh.getLastColumn();lpm.getRange(1,1,1,width).copyTo(sh.getRange(1,1,1,width));for(let c=had+1;c<=width;c++)sh.setColumnWidth(c,lpm.getColumnWidth(c))}   // HYOSAN_LPM에 칸이 늘면 머리글도 맞춘다
    // 이미 HYOSAN_LPM에 들어간 행은 지운다(아래에서부터)
    const pc=col('PaperNumber')+1,last=sh.getLastRow();let removed=0;const inTab=new Set();
    const tabKeys=last>1?sh.getRange(2,pc,last-1,1).getDisplayValues().map(r=>stockKey_(r[0])):[];
    for(let i=tabKeys.length-1;i>=0;i--){const k=tabKeys[i];if(!k)continue;if(present.has(k)){sh.deleteRow(i+2);removed++}else inTab.add(k)}
    let seenSh=ss.getSheetByName(NEW_PAPER_SEEN);if(!seenSh){seenSh=ss.insertSheet(NEW_PAPER_SEEN);seenSh.hideSheet()}
    const seen=new Set(seenSh.getLastRow()?seenSh.getRange(1,1,seenSh.getLastRow(),1).getDisplayValues().map(r=>r[0]):[]);
    const rows=[],keys=[],picked=new Set();
    body.papers.forEach(p=>{
      const k=stockKey_(p&&p.paper);if(!k||present.has(k)||inTab.has(k)||seen.has(k)||picked.has(k))return;picked.add(k);
      const r=Array(width).fill(''),set=(name,v)=>{const i=col(name);if(i>=0)r[i]=v};
      set('PaperNumber',String(p.paper).trim());set('BasePaperCompany',String(p.company||''));
      if(/^#[0-9A-F]{6}$/i.test(String(p.color||'')))set('ColorHex',String(p.color).toUpperCase());
      set('Active',false);if(col('ManualManaged')>=0)set('ManualManaged',false);
      set('인덱스 변경 내용','ERP 신규: 첫 입고 '+(p.first||'?')+' · 최근 입고 '+(p.last||'?')+' · '+(Number(p.lots)||0)+'회');
      rows.push(r);keys.push(k);
    });
    if(rows.length){
      const start=sh.getLastRow()+1,target=sh.getRange(start,1,rows.length,width);
      const sample=lpm.getRange(2,1,1,width);   // HYOSAN_LPM 첫 데이터 행의 서식·체크박스 그대로
      sample.copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false);sample.copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,false);
      target.setValues(rows);
      seenSh.getRange(seenSh.getLastRow()+1,1,keys.length,1).setNumberFormat('@').setValues(keys.map(k=>[k]));
    }
    PropertiesService.getScriptProperties().setProperty('NEW_PAPERS_AT',String(Date.now()));
    return {ok:true,received:body.papers.length,added:rows.length,removed};
  }finally{lock.releaseLock()}
}

/* ───── ERP 품목·비고: 사무실 PC가 7일마다(상태 응답의 erpItemsDue) HYOSAN_LPM 종이의 ERP 품목과 비고를 보낸다 ─────
   items:[{paper,code,name,book,specout,remark,made,lastSale}] → 'ERP 품목' 시트를 통째로 다시 채운다(직접 고치지 않는 ERP 사본).
   paperRemarks:[{paper,remark}] · index:[{paper,name,specOut,remark}] + 품목 비고·스펙아웃 → HYOSAN_LPM '내용' 칸의 [ERP] 줄.
   사람이 쓴 '내용'(‘[ERP]’로 시작하지 않는 줄)은 그대로 둔다. 'SpecOut' 체크 칸이 없으면 맨 끝에 만든다(체크는 사람이 한다). */
const ERP_ITEM_SHEET='ERP 품목',ERP_NOTE_PREFIX='[ERP] ',ERP_ITEM_DAYS=7;
const ERP_ITEM_HEADERS=['종이넘버','품목코드','제품명','샘플북','스펙아웃','비고','등록일','최근 판매일'];
function erpItemsDue_(){return Date.now()-Number(PropertiesService.getScriptProperties().getProperty('ERP_ITEMS_AT')||0)>ERP_ITEM_DAYS*864e5}
function erpText_(v){return String(v==null?'':v).replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim()}
// 종이넘버(stockKey_)별 [ERP] 줄: 종이 비고 → 품목 스펙아웃 → 인덱스 → 품목 비고(같은 문구는 제품명을 묶어 한 줄)
function erpNoteLines_(items,paperRemarks,index){
  const notes=new Map(),add=(paper,line)=>{const k=stockKey_(paper);if(!k||!line)return;const list=notes.get(k)||[];if(!list.includes(line))list.push(line);notes.set(k,list)};
  const grouped=(rows,keyOf,lineOf)=>{const g=new Map();rows.forEach(r=>{const k=keyOf(r);if(!k)return;const id=stockKey_(r.paper)+'\u0000'+k;const o=g.get(id)||{paper:r.paper,key:k,names:[]};const n=erpText_(r.name);if(n&&!o.names.includes(n))o.names.push(n);g.set(id,o)});g.forEach(o=>add(o.paper,lineOf(o)))};
  (paperRemarks||[]).forEach(p=>{const t=erpText_(p.remark);if(t)add(p.paper,ERP_NOTE_PREFIX+'종이 비고: '+t)});
  grouped(items||[],r=>erpText_(r.specout),o=>ERP_NOTE_PREFIX+'스펙아웃 '+o.key+(o.names.length?': '+o.names.join(', '):''));
  (index||[]).forEach(x=>{const n=erpText_(x.name),d=erpText_(x.specOut),t=erpText_(x.remark);if(d)add(x.paper,ERP_NOTE_PREFIX+'인덱스 스펙아웃 '+d+(n?' ('+n+')':''));if(t)add(x.paper,ERP_NOTE_PREFIX+'인덱스 비고'+(n?' ('+n+')':'')+': '+t)});
  grouped(items||[],r=>erpText_(r.remark),o=>ERP_NOTE_PREFIX+(o.names.length?o.names.join(', ')+': ':'')+o.key);
  return notes;
}
// 기존 '내용'에서 [ERP] 줄만 새것으로 바꾼다
function mergeErpNote_(old,lines){
  const keep=String(old==null?'':old).split(/\r?\n/).filter(l=>!l.startsWith(ERP_NOTE_PREFIX.trim()));
  while(keep.length&&!keep[keep.length-1].trim())keep.pop();
  return keep.concat(lines||[]).join('\n');
}
function ensureSpecOutColumn_(lpm){
  const width=lpm.getLastColumn(),head=lpm.getRange(1,1,1,width).getDisplayValues()[0];let col=head.indexOf('SpecOut')+1,created=false;
  if(!col){col=width+1;lpm.getRange(1,width).copyTo(lpm.getRange(1,col));lpm.getRange(1,col).setValue('SpecOut');lpm.setColumnWidth(col,80);created=true}
  const last=lpm.getLastRow();if(last>1)lpm.getRange(2,col,last-1,1).insertCheckboxes();   // 새로 붙은 행에도 체크 칸
  return created;
}
function erpItemsPush_(body){
  orderBoardCheckKey_(body);
  if(!Array.isArray(body.items))throw appError_('ERP 품목 데이터 형식이 올바르지 않습니다.','ERP_ITEMS_INVALID');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const ss=SpreadsheetApp.openById(SPREADSHEET_ID),lpm=ss.getSheetByName(SHEET_NAMES.lpm);
    const specOutCreated=ensureSpecOutColumn_(lpm);
    // 1) ERP 품목 시트: 종이넘버 → 최근 판매일 순
    let sh=ss.getSheetByName(ERP_ITEM_SHEET);
    if(!sh){sh=ss.insertSheet(ERP_ITEM_SHEET);sh.setFrozenRows(1);[110,100,220,90,90,320,90,90].forEach((w,i)=>sh.setColumnWidth(i+1,w))}
    const rows=body.items.map(r=>[r.paper,r.code,r.name,r.book,r.specout,r.remark,r.made,r.lastSale].map(erpText_))
      .sort((a,b)=>a[0].localeCompare(b[0])||b[7].localeCompare(a[7])||a[2].localeCompare(b[2]));
    sh.clearContents();
    const out=[ERP_ITEM_HEADERS].concat(rows);
    sh.getRange(1,1,out.length,ERP_ITEM_HEADERS.length).setNumberFormat('@').setValues(out);
    sh.getRange(1,1,1,ERP_ITEM_HEADERS.length).setFontWeight('bold').setNote('ERP에서 7일마다 자동으로 다시 채워집니다. 여기서 고친 내용은 다음 동기화 때 사라집니다.');
    // 2) HYOSAN_LPM '내용'의 [ERP] 줄
    const width=lpm.getLastColumn(),head=lpm.getRange(1,1,1,width).getDisplayValues()[0],pc=head.indexOf('PaperNumber')+1,nc=head.indexOf('내용')+1,last=lpm.getLastRow();
    let changed=0;
    if(pc&&nc&&last>1){
      const notes=erpNoteLines_(body.items,body.paperRemarks,body.index);
      const papers=lpm.getRange(2,pc,last-1,1).getDisplayValues(),range=lpm.getRange(2,nc,last-1,1),values=range.getValues();
      const dirty=[];
      values.forEach((v,i)=>{const lines=String(papers[i][0]).split(/[\r\n,;|]+/).flatMap(p=>notes.get(stockKey_(p))||[]);const next=mergeErpNote_(v[0],Array.from(new Set(lines)));if(next!==String(v[0]==null?'':v[0])){v[0]=next;dirty.push(i)}});
      changed=dirty.length;
      if(changed){
        // 바뀐 칸만 이어진 묶음으로 쓴다(그 사이 사람이 고친 다른 칸을 덮지 않게). 묶음이 너무 많은 첫 실행만 칸 전체를 한 번에 쓴다.
        const runs=[];dirty.forEach(i=>{const r=runs[runs.length-1];if(r&&r.end===i)r.end++;else runs.push({start:i,end:i+1})});
        if(runs.length>60)range.setValues(values);else runs.forEach(r=>lpm.getRange(r.start+2,nc,r.end-r.start,1).setValues(values.slice(r.start,r.end)));
        try{CacheService.getScriptCache().remove(DATA_CACHE_PREFIX+'meta')}catch(e){}   // 웹앱이 다음 요청 때 새 '내용'을 읽게
      }
    }
    PropertiesService.getScriptProperties().setProperty('ERP_ITEMS_AT',String(Date.now()));
    return {ok:true,items:rows.length,notesChanged:changed,specOutCreated};
  }finally{lock.releaseLock()}
}
