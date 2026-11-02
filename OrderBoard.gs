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
    }
    // 이미 HYOSAN_LPM에 들어간 행은 지운다(아래에서부터)
    const pc=col('PaperNumber')+1,last=sh.getLastRow();let removed=0;const inTab=new Set();
    const tabKeys=last>1?sh.getRange(2,pc,last-1,1).getDisplayValues().map(r=>stockKey_(r[0])):[];
    for(let i=tabKeys.length-1;i>=0;i--){const k=tabKeys[i];if(!k)continue;if(present.has(k)){sh.deleteRow(i+2);removed++}else inTab.add(k)}
    let seenSh=ss.getSheetByName(NEW_PAPER_SEEN);if(!seenSh){seenSh=ss.insertSheet(NEW_PAPER_SEEN);seenSh.hideSheet()}
    const seen=new Set(seenSh.getLastRow()?seenSh.getRange(1,1,seenSh.getLastRow(),1).getDisplayValues().map(r=>r[0]):[]);
    const rows=[],keys=[];
    body.papers.forEach(p=>{
      const k=stockKey_(p&&p.paper);if(!k||present.has(k)||inTab.has(k)||seen.has(k)||keys.includes(k))return;
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
