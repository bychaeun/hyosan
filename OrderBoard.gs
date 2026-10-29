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

/* PC가 조회 전에 묻는다: 다른 PC가 방금 보냈으면 DB 조회를 건너뛴다 */
function orderBoardStatus_(body){
  orderBoardCheckKey_(body);
  const meta=orderBoardMeta_();
  return {ok:true,updatedAt:meta?meta.updatedAt:null};
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

function orderBoardSafeEqual_(a,b){
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
