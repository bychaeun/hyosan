const SPREADSHEET_ID='1RC-6ibPA86zaWOGt1rzgmQf9tLpT4OcgdI6K9XcUPTI';
const SHEET_NAMES={patterns:'PATTERN_DESIGN',lpm:'HYOSAN_LPM',specialSpecs:'SPECIAL_SPECS',emboss:'EMBOSS_PLATE',sites:'CONSTRUCTION_SITES',config:'CONFIG',users:'APP_USERS'};
const USER_HEADERS=['Email','Name','PictureURL','Status','RequestedAt','LastLoginAt','ApprovedBy','ApprovedAt'];
// LPM index and image synchronization is maintained in IndexSync.gs.

function doGet(e){
  try{
    const action=(e&&e.parameter&&e.parameter.action)||'data',cfg=getConfig_();
    if(action==='appConfig')return jsonOutput({ok:true,clientId:cfg.GOOGLE_CLIENT_ID||'',authRequired:true,appName:cfg.LIBRARY_TITLE||'HYOSAN LPM Library'});
    if(action==='health')return jsonOutput({ok:true,authRequired:true});
    if(action==='data')return jsonOutput({ok:false,error:'Google login required',code:'AUTH_REQUIRED'});
    return jsonOutput({ok:false,error:'Unknown action'});
  }catch(err){return jsonOutput({ok:false,error:String(err),code:err&&err.code?err.code:'REQUEST_FAILED'})}
}

function doPost(e){
  try{
    const body=JSON.parse((e&&e.postData&&e.postData.contents)||'{}'),cfg=getConfig_();
    if(body.action==='authStatus'){
      const identity=verifyGoogleToken_(body.idToken,cfg),loginUser=touchUser_(identity,cfg),loginResponse=userResponse_(loginUser);
      if(loginResponse.ok)loginResponse.sessionToken=createSessionToken_(loginUser.Email);
      return jsonOutput(loginResponse);
    }
    if(body.action==='orderBoardPush')return jsonOutput(orderBoardPush_(body));     // 사무실 PC 자동 전송 (OrderBoard.gs)
    if(body.action==='orderBoardStatus')return jsonOutput(orderBoardStatus_(body));
    const user=authenticateRequest_(body,cfg);
    if(body.action==='sessionStatus')return jsonOutput(renewSessionResponse_(body,user,userResponse_(user)));
    if(user.Status!=='ADMIN'&&user.Status!=='APPROVED')return jsonOutput(userResponse_(user));
    if(body.action==='imageVersions')return jsonOutput({ok:true,imageVersions:imageVersionBatch_(body.ids,body.force===true)});
    const level=userLevel_(user);
    if(body.action==='data'){
      // 휴대폰이 가진 데이터와 같으면 본문 없이 "그대로"만 알려 준다(30분 동기화·앱 재실행 때 수백 KB 절약)
      const hash=levelHash_(cachedDataHash_(),level);
      if(body.force!==true&&body.since&&body.since===hash)return jsonOutput(renewSessionResponse_(body,user,{ok:true,notModified:true,dataHash:body.since,user:userResponse_(user).user}));
      return jsonOutput(renewSessionResponse_(body,user,Object.assign(dataForLevel_(getAllData_(body.force===true),level),{user:userResponse_(user).user})));
    }
    if(body.action==='orderBoard'){if(level!=='FULL')throw appError_('상위 사용자만 볼 수 있습니다.','LEVEL_REQUIRED');return orderBoardResponse_(body,user)}
    if(body.action==='exportToSlides')return jsonOutput(exportToSlides_(body.lpmIds||body.lpmId,user.Email,cfg,level));
    if(body.action==='listUsers')return jsonOutput(listUsers_(user));
    if(body.action==='setUserStatus')return jsonOutput(setUserStatus_(user,body.email,body.status));
    if(body.action==='setUserLevel')return jsonOutput(setUserLevel_(user,body.email,body.level));
    return jsonOutput({ok:false,error:'Unknown action'});
  }catch(err){return jsonOutput({ok:false,error:String(err),code:err&&err.code?err.code:'REQUEST_FAILED'})}
}

function getConfig_(){
  const cache=CacheService.getScriptCache(),key='app-config-v1',cached=cache.get(key);
  if(cached){try{return JSON.parse(cached)}catch(e){}}
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),cfg={};
  readSheet_(ss,SHEET_NAMES.config).forEach(r=>{if(r.KEY)cfg[r.KEY]=r.VALUE});
  try{cache.put(key,JSON.stringify(cfg),300)}catch(e){}
  return cfg;
}

function authenticateRequest_(body,cfg){
  if(body.sessionToken)return getUserByEmail_(verifySessionToken_(body.sessionToken));
  return touchUser_(verifyGoogleToken_(body.idToken,cfg),cfg);
}

function createSessionToken_(email){
  const payload=Utilities.base64EncodeWebSafe(JSON.stringify({email:String(email).toLowerCase(),exp:Date.now()+SESSION_DAYS*24*60*60*1000})).replace(/=+$/,''),signature=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload,getSessionSecret_())).replace(/=+$/,'');
  return payload+'.'+signature;
}

// 한 번 로그인하면 계속 쓰도록: 로그인은 1년 유효, 쓰는 동안 한 달마다 다시 1년으로 늘린다.
// 승인 상태는 요청마다 시트 기준으로 확인하므로, 관리자가 사용 중지하면 토큰이 남아 있어도 바로 막힌다.
const SESSION_DAYS=365,SESSION_RENEW_AFTER_DAYS=30;
function renewSessionResponse_(body,user,response){
  if(!user||!['ADMIN','APPROVED'].includes(user.Status)||!body.sessionToken)return response;
  try{
    const payload=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(String(body.sessionToken).split('.')[0])).getDataAsString());
    if(Number(payload.exp)-Date.now()<(SESSION_DAYS-SESSION_RENEW_AFTER_DAYS)*24*60*60*1000)response.sessionToken=createSessionToken_(user.Email);
  }catch(e){}
  return response;
}

function verifySessionToken_(token){
  const parts=String(token||'').split('.');if(parts.length!==2)throw appError_('로그인이 만료되었습니다.','INVALID_SESSION');
  const expected=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0],getSessionSecret_())).replace(/=+$/,'');if(parts[1]!==expected)throw appError_('로그인이 만료되었습니다.','INVALID_SESSION');
  const payload=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());if(!payload.email||Number(payload.exp)<Date.now())throw appError_('로그인이 만료되었습니다.','INVALID_SESSION');return String(payload.email).toLowerCase();
}

function getSessionSecret_(){const props=PropertiesService.getScriptProperties();let secret=props.getProperty('SESSION_SECRET');if(!secret){secret=Utilities.getUuid()+Utilities.getUuid();props.setProperty('SESSION_SECRET',secret)}return secret}

const USER_CACHE_KEY='app-users-v1';
function readUsers_(){
  const cache=CacheService.getScriptCache(),cached=cache.get(USER_CACHE_KEY);
  if(cached){try{return JSON.parse(cached)}catch(e){}}
  const rows=readSheet_(SpreadsheetApp.openById(SPREADSHEET_ID),SHEET_NAMES.users);
  // 승인·중지·로그인 기록을 앱에서 바꾸면 clearUserCache_로 즉시 지워진다. 시트를 직접 고친 경우만 최대 5분 뒤 반영.
  try{cache.put(USER_CACHE_KEY,JSON.stringify(rows),300)}catch(e){}
  return rows;
}
function clearUserCache_(){try{CacheService.getScriptCache().remove(USER_CACHE_KEY)}catch(e){}}

function getUserByEmail_(email){
  const user=readUsers_().find(r=>String(r.Email||'').toLowerCase()===String(email||'').toLowerCase());if(!user)throw appError_('사용자를 찾을 수 없습니다.','USER_NOT_FOUND');return user;
}

function verifyGoogleToken_(idToken,cfg){
  if(!idToken)throw appError_('Google 로그인이 필요합니다.','AUTH_REQUIRED');
  if(!cfg.GOOGLE_CLIENT_ID)throw appError_('CONFIG 시트에 GOOGLE_CLIENT_ID를 설정해 주세요.','AUTH_NOT_CONFIGURED');
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,idToken)).slice(0,36),cache=CacheService.getScriptCache(),key='google-id-'+digest,cached=cache.get(key);
  if(cached){try{return JSON.parse(cached)}catch(e){}}
  const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(idToken),{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw appError_('Google 로그인 정보를 확인할 수 없습니다.','INVALID_TOKEN');
  const payload=JSON.parse(response.getContentText());
  if(payload.aud!==cfg.GOOGLE_CLIENT_ID||String(payload.email_verified)!=='true'||!payload.email)throw appError_('허용되지 않은 Google 로그인입니다.','INVALID_TOKEN');
  const identity={email:String(payload.email).toLowerCase(),name:payload.name||'',picture:payload.picture||''};
  try{cache.put(key,JSON.stringify(identity),300)}catch(e){}
  return identity;
}

function touchUser_(identity,cfg){
  // 같은 사람이 6시간 안에 다시 로그인하면(이름·사진도 그대로) 시트를 잠그고 다시 쓰지 않는다
  const email0=identity.email.toLowerCase(),known=readUsers_().find(r=>String(r.Email||'').toLowerCase()===email0);
  if(known&&(email0!==String(cfg.ADMIN_EMAIL||'').toLowerCase()||known.Status==='ADMIN')&&(!identity.name||identity.name===known.Name)&&(!identity.picture||identity.picture===known.PictureURL)&&Date.now()-Date.parse(known.LastLoginAt||'')<6*3600e3)return known;
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=getUserSheet_(ss),values=sh.getDataRange().getDisplayValues(),headers=values[0],email=identity.email.toLowerCase(),now=new Date().toISOString();
    let rowIndex=-1,row=null;
    for(let i=1;i<values.length;i++)if(String(values[i][0]||'').toLowerCase()===email){rowIndex=i+1;row=Object.fromEntries(headers.map((h,j)=>[h,values[i][j]]));break}
    const adminEmail=String(cfg.ADMIN_EMAIL||'').toLowerCase();
    if(!row){
      const status=email===adminEmail?'ADMIN':'PENDING',newRow=[email,identity.name,identity.picture,status,now,now,status==='ADMIN'?email:'',status==='ADMIN'?now:''];
      sh.appendRow(newRow);row=Object.fromEntries(USER_HEADERS.map((h,i)=>[h,newRow[i]]));
      if(status!=='ADMIN'){sh.getRange(sh.getLastRow(),levelColumn_(sh)).setValue('BASIC');row.Level='BASIC'}   // 새로 가입하는 사람은 하위로 시작
    }else{
      row.Name=identity.name||row.Name;row.PictureURL=identity.picture||row.PictureURL;row.LastLoginAt=now;
      if(email===adminEmail)row.Status='ADMIN';
      sh.getRange(rowIndex,2,1,5).setValues([[row.Name,row.PictureURL,row.Status,row.RequestedAt||now,row.LastLoginAt]]);
    }
    clearUserCache_();
    return row;
  }finally{lock.releaseLock()}
}

function getUserSheet_(ss){
  let sh=ss.getSheetByName(SHEET_NAMES.users);
  if(!sh){sh=ss.insertSheet(SHEET_NAMES.users);sh.getRange(1,1,1,USER_HEADERS.length).setValues([USER_HEADERS]);sh.setFrozenRows(1)}
  return sh;
}

function userResponse_(user){
  const status=user.Status||'PENDING';
  return {ok:status==='ADMIN'||status==='APPROVED',code:status==='PENDING'?'APPROVAL_PENDING':status==='REVOKED'?'ACCESS_REVOKED':'',status:status,user:{email:user.Email,name:user.Name,picture:user.PictureURL,isAdmin:status==='ADMIN',level:userLevel_(user)},message:status==='PENDING'?'관리자 승인을 기다리고 있습니다.':status==='REVOKED'?'관리자가 사용 권한을 중지했습니다.':''};
}

// 사용자 단계 — 상위(FULL): 수주현황판·종이 넘버·원지 회사명·재고까지, 하위(BASIC): 그 밖의 라이브러리만.
// APP_USERS의 Level 칸이 비어 있으면(기존 사용자) 상위, BASIC이면 하위. 관리자는 항상 상위.
const BASIC_HIDDEN_FIELDS=['PaperNumber','PaperNo','BasePaperCompany'];
function userLevel_(user){return user&&(user.Status==='ADMIN'||String(user.Level||'').trim().toUpperCase()!=='BASIC')?'FULL':'BASIC'}
function levelHash_(hash,level){return hash?hash+(level==='BASIC'?'.b':''):''}
// 하위 사용자에게는 종이 넘버·원지 회사명을 아예 보내지 않는다(화면에서 숨기는 것만으로는 개발자 도구로 보임)
function dataForLevel_(data,level){
  if(level!=='BASIC')return data;
  const strip=rows=>(rows||[]).map(r=>{const o=Object.assign({},r);BASIC_HIDDEN_FIELDS.forEach(k=>delete o[k]);return o});
  return Object.assign({},data,{lpm:strip(data.lpm),specialSpecs:strip(data.specialSpecs),dataHash:levelHash_(data.dataHash,level)});
}
function levelColumn_(sh){
  const width=Math.max(sh.getLastColumn(),USER_HEADERS.length),headers=sh.getRange(1,1,1,width).getDisplayValues()[0].map(v=>String(v).trim()),found=headers.indexOf('Level');
  if(found>=0)return found+1;
  sh.getRange(1,width+1).setValue('Level');return width+1;
}

function listUsers_(admin){
  assertAdmin_(admin);const rows=readUsers_();
  return {ok:true,users:rows.map(r=>({email:r.Email,name:r.Name,picture:r.PictureURL,status:r.Status,level:userLevel_(r),requestedAt:r.RequestedAt,lastLoginAt:r.LastLoginAt,approvedBy:r.ApprovedBy,approvedAt:r.ApprovedAt}))};
}

function setUserLevel_(admin,email,level){
  assertAdmin_(admin);email=String(email||'').trim().toLowerCase();level=String(level||'').toUpperCase();
  if(!email||!['FULL','BASIC'].includes(level))throw appError_('사용자 또는 단계 값이 올바르지 않습니다.','INVALID_USER_UPDATE');
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=getUserSheet_(ss),values=sh.getDataRange().getDisplayValues();
  for(let i=1;i<values.length;i++)if(String(values[i][0]||'').toLowerCase()===email){
    if(String(values[i][3]||'').toUpperCase()==='ADMIN')throw appError_('관리자는 항상 상위입니다.','ADMIN_PROTECTED');
    sh.getRange(i+1,levelColumn_(sh)).setValue(level);clearUserCache_();return {ok:true,email:email,level:level};
  }
  throw appError_('사용자를 찾을 수 없습니다.','USER_NOT_FOUND');
}

function setUserStatus_(admin,email,status){
  assertAdmin_(admin);email=String(email||'').trim().toLowerCase();status=String(status||'').toUpperCase();
  if(!email||!['APPROVED','REVOKED'].includes(status))throw appError_('사용자 또는 상태 값이 올바르지 않습니다.','INVALID_USER_UPDATE');
  if(email===String(admin.Email||'').toLowerCase())throw appError_('관리자 본인의 권한은 변경할 수 없습니다.','ADMIN_PROTECTED');
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=getUserSheet_(ss),values=sh.getDataRange().getDisplayValues(),now=new Date().toISOString();
  for(let i=1;i<values.length;i++)if(String(values[i][0]||'').toLowerCase()===email){sh.getRange(i+1,4).setValue(status);sh.getRange(i+1,7,1,2).setValues([[admin.Email,now]]);clearUserCache_();return {ok:true,email:email,status:status}}
  throw appError_('사용자를 찾을 수 없습니다.','USER_NOT_FOUND');
}

function assertAdmin_(user){if(!user||user.Status!=='ADMIN')throw appError_('관리자 권한이 필요합니다.','ADMIN_REQUIRED')}
function appError_(message,code){const err=new Error(message);err.code=code;return err}

const DATA_CACHE_PREFIX='library-data-v17-';
function cachedDataHash_(){try{return (JSON.parse(CacheService.getScriptCache().get(DATA_CACHE_PREFIX+'meta')||'null')||{}).hash||''}catch(e){return ''}}
function readDataCache_(cache){
  try{
    const meta=JSON.parse(cache.get(DATA_CACHE_PREFIX+'meta')||'null');if(!meta||!meta.count)return null;
    const keys=Array.from({length:meta.count},(_,i)=>DATA_CACHE_PREFIX+i),parts=cache.getAll(keys);if(keys.some(k=>!parts[k]))return null;
    const bytes=Utilities.base64Decode(keys.map(k=>parts[k]).join('')),json=Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString();
    return JSON.parse(json);
  }catch(e){return null}
}
function writeDataCache_(cache,data){
  try{
    delete data.dataHash;
    data.dataHash=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,JSON.stringify(data),Utilities.Charset.UTF_8));
    const zipped=Utilities.gzip(Utilities.newBlob(JSON.stringify(data),'application/json')),encoded=Utilities.base64Encode(zipped.getBytes()),size=80000,values={};
    for(let i=0,n=0;i<encoded.length;i+=size,n++)values[DATA_CACHE_PREFIX+n]=encoded.slice(i,i+size);
    values[DATA_CACHE_PREFIX+'meta']=JSON.stringify({count:Math.ceil(encoded.length/size),hash:data.dataHash});
    cache.putAll(values,3600);
  }catch(e){console.warn('Data cache skipped: '+e.message)}
}
function rowsFromValues_(values){
  if(!values||values.length<2)return [];
  const headers=values[0]||[];
  return values.slice(1).filter(r=>r.some(v=>String(v==null?'':v)!=='')).map(r=>{
    const item={};
    headers.forEach((h,i)=>{const value=r[i];if(h&&value!=null&&String(value)!=='')item[h]=value});
    return item;
  });
}
function readSheetsBatch_(names){
  // Apps Script's native service uses the existing spreadsheet authorization;
  // it does not require enabling the separate Sheets REST API in a Cloud project.
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),result={};
  [...new Set(names)].forEach(name=>{result[name]=readSheet_(ss,name)});
  return result;
}
// Inspect metadata only; image bytes are still loaded lazily by the browser.
function imageVersions_(data,previous){
  const ids=new Set(),versions={};
  ['patterns','lpm','specialSpecs','emboss','sites'].forEach(key=>(data[key]||[]).forEach(row=>Object.keys(row).filter(field=>/image.*url/i.test(field)).forEach(field=>{
    String(row[field]||'').split(/[\r\n,;|]+/).forEach(value=>{
      const match=value.trim().match(/^https?:\/\/(?:drive\.google\.com|drive\.usercontent\.google\.com)\/(?:file\/d\/([\w-]+)|[^\s]*[?&]id=([\w-]+))/i);
      if(match)ids.add(match[1]||match[2]);
    });
  })));
  const list=Array.from(ids).sort();
  list.forEach(id=>{if(previous&&previous[id])versions[id]=previous[id]});
  if(!list.length)return versions;
  try{
    const headers={Authorization:'Bearer '+ScriptApp.getOAuthToken()};
    for(let start=0;start<list.length;start+=50){
      const batch=list.slice(start,start+50),responses=UrlFetchApp.fetchAll(batch.map(id=>({url:'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=modifiedTime&supportsAllDrives=true',headers:headers,muteHttpExceptions:true})));
      responses.forEach((response,index)=>{
        if(response.getResponseCode()!==200)return;
        const modified=JSON.parse(response.getContentText()).modifiedTime;
        if(modified&&Number.isFinite(Date.parse(modified)))versions[batch[index]]=String(Date.parse(modified));
      });
    }
  }catch(e){console.warn('Image metadata refresh incomplete; retaining known image versions.');}
  return versions;
}
// Authenticated, bounded background work. Never scan Drive during login/data loading.
function imageVersionBatch_(requested,force){
  const ids=Array.from(new Set((Array.isArray(requested)?requested:[]).map(String))).filter(id=>/^[\w-]+$/.test(id)).slice(0,12);
  if(!ids.length)return {};
  const catalog=getAllData_(false),allowed=new Set();
  ['patterns','lpm','specialSpecs','emboss','sites'].forEach(key=>(catalog[key]||[]).forEach(row=>Object.keys(row).filter(field=>/image.*url/i.test(field)).forEach(field=>{
    String(row[field]||'').split(/[\r\n,;|]+/).forEach(value=>{const match=value.trim().match(/^https?:\/\/(?:drive\.google\.com|drive\.usercontent\.google\.com)\/(?:file\/d\/([\w-]+)|[^\s]*[?&]id=([\w-]+))/i);if(match)allowed.add(match[1]||match[2])});
  })));
  const selected=ids.filter(id=>allowed.has(id)),cache=CacheService.getScriptCache(),versions={},missing=[];
  selected.forEach(id=>{const saved=force?null:cache.get('image-revision-'+id);if(saved)versions[id]=saved;else missing.push(id)});
  if(missing.length){
    const fresh=imageVersions_({lpm:missing.map(id=>({ImageURL:'https://drive.google.com/uc?id='+id}))},{});
    Object.keys(fresh).forEach(id=>{versions[id]=fresh[id];try{cache.put('image-revision-'+id,fresh[id],300)}catch(e){}});
  }
  return versions;
}
// Keep older published clients compatible while sites store LPM IDs and emboss separately.
function integrateSiteSpecs_(out){
  const byId=new Map(out.lpm.map(x=>[x.LPM_ID,x])),aliases=new Map();
  const lines=v=>String(v||'').split(/\r?\n/).map(s=>s.trim());
  const key=v=>String(v||'').replace(/[\[\]]/g,'').replace(/\([^)]*\)/g,'').replace(/\s+/g,'').toLowerCase();
  out.lpm.filter(x=>String(x.Active||'').toUpperCase()!=='FALSE').forEach(x=>{
    new Set(lines(x.SpecialNumbers).map(key).filter(Boolean)).forEach(k=>{const list=aliases.get(k)||[];list.push(x);aliases.set(k,list)});
  });
  out.sites.forEach(site=>{
    if(!site.SpecialSpecNumbers)return;
    const names=lines(site.SpecialSpecNumbers),ids=lines(site.LinkedLPM_IDs),emboss=lines(site.EmbossNames),refs=[];
    site.SpecialSpecNumbers=names.map((name,i)=>{
      if(!name){refs.push('');return ''}
      const label=name.replace(/^\[|\]$/g,'').replace(/\([^)]*\)/g,'').trim()+(emboss[i]?' ('+emboss[i]+')':'');
      const matches=aliases.get(key(name))||[],item=byId.get(ids[i])||(matches.length===1?matches[0]:null),id='SITE:'+site.Construction_ID+':'+i;refs.push(item?id:'');
      if(item)out.specialSpecs.push({SpecialSpec_ID:id,SpecialSpecNumber:label,LinkedLPM_ID:item.LPM_ID,PaperNumber:item.PaperNumber,ImageURL:item.ImageURL,EmbossType:emboss[i]||'',SubCategory:item.Category,Active:item.Active});
      return label;
    }).join('\n');
    site.LinkedSpecialSpec_IDs=refs.join('\n');
  });
}
function getAllData_(forceRefresh){
  const cache=CacheService.getScriptCache(),cached=forceRefresh?null:readDataCache_(cache);
  if(cached)return cached;
  const names=[SHEET_NAMES.patterns,SHEET_NAMES.lpm,SHEET_NAMES.specialSpecs,SHEET_NAMES.emboss,SHEET_NAMES.sites,SHEET_NAMES.config,'RELATIONS'];
  const tables=readSheetsBatch_(names);
  const out={patterns:tables[SHEET_NAMES.patterns]||[],lpm:tables[SHEET_NAMES.lpm]||[],specialSpecs:tables[SHEET_NAMES.specialSpecs]||[],emboss:tables[SHEET_NAMES.emboss]||[],sites:tables[SHEET_NAMES.sites]||[],config:{}};
  integrateSiteSpecs_(out);
  const publicConfig=['LIBRARY_TITLE','SYNC_INTERVAL_SECONDS','COLOR_TOLERANCE_PERCENT','VERSION'];
  (tables[SHEET_NAMES.config]||[]).forEach(r=>{if(r.KEY)out.config[r.KEY]=r.VALUE});
  out.patterns.forEach(item=>{delete item.RelatedLPM_IDs;delete item.RecommendedEmbossPlate_IDs});
  out.lpm.forEach(item=>{delete item.RelatedPattern_IDs;delete item.EmbossPlate_IDs});
  const relationIds_=value=>String(value||'').split(/[\r\n,;|]+/).map(v=>v.trim()).filter(Boolean);
  const relationKey_=value=>String(value||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  const nameLookup_=(items,nameFields,idField,splitAliases=false)=>{
    const lookup=new Map();
    items.forEach(item=>nameFields.forEach(field=>{
      const id=String(item[idField]||'').trim();if(!id)return;
      const aliases=splitAliases?relationIds_(item[field]):[item[field]];
      aliases.forEach(alias=>{const key=relationKey_(alias);if(!key)return;
        const ids=lookup.get(key)||[];if(!ids.includes(id))ids.push(id);lookup.set(key,ids);
      });
    }));
    return lookup;
  };
  const relationValue_=(relation,names)=>{for(const name of names)if(relation[name]!=null&&String(relation[name]).trim())return relation[name];return ''};
  const resolveRelationIds_=(value,byId,byName)=>Array.from(new Set(relationIds_(value).flatMap(token=>byId.has(token)?[token]:(byName.get(relationKey_(token))||[]))));
  const addRelationIds_=(item,key,ids)=>{if(item&&ids.length)item[key]=Array.from(new Set(relationIds_(item[key]).concat(ids))).join(',')};
  const patternsById=new Map(out.patterns.map(item=>[String(item.ID||'').trim(),item]));
  const lpmById=new Map(out.lpm.map(item=>[String(item.LPM_ID||'').trim(),item]));
  const embossById=new Map(out.emboss.map(item=>[String(item.EmbossPlate_ID||'').trim(),item]));
  const patternsByName=nameLookup_(out.patterns,['PatternName_KR','PatternName_EN'],'ID');
  const lpmByName=nameLookup_(out.lpm,['ProductName','PreviousNames','PaperNumber','SpecialNumbers'],'LPM_ID',true);
  const embossByName=nameLookup_(out.emboss,['PlateName'],'EmbossPlate_ID');
  (tables.RELATIONS||[]).forEach(relation=>{
    const patternIds=resolveRelationIds_(relationValue_(relation,['Pattern_Name','PatternName','Pattern_ID']),patternsById,patternsByName),lpmIds=resolveRelationIds_(relationValue_(relation,['LPM_ProductName','LPM_Name','ProductName','LPM_ID']),lpmById,lpmByName),embossIds=resolveRelationIds_(relationValue_(relation,['EmbossPlate_Name','PlateName','EmbossPlate_ID']),embossById,embossByName);
    patternIds.forEach(patternId=>{const pattern=patternsById.get(patternId);addRelationIds_(pattern,'RelatedLPM_IDs',lpmIds);addRelationIds_(pattern,'RecommendedEmbossPlate_IDs',embossIds)});
    lpmIds.forEach(lpmId=>{const lpm=lpmById.get(lpmId);addRelationIds_(lpm,'RelatedPattern_IDs',patternIds);addRelationIds_(lpm,'EmbossPlate_IDs',embossIds)});
  });
  writeDataCache_(cache,out);
  return out;
}
function readSheet_(ss,name){
  const sh=ss.getSheetByName(name);if(!sh)return [];
  const lastRow=sh.getLastRow(),lastColumn=sh.getLastColumn();if(lastRow<2||lastColumn<1)return [];
  return rowsFromValues_(sh.getRange(1,1,lastRow,lastColumn).getDisplayValues());
}

function lpmDisplayName_(item){return String(item.ProductName||'').trim()||String(item.PaperNumber||item.PaperNo||item.PatternForm||'').trim()||'-'}

function getLpmsForExport_(lpmIds){
  const ids=Array.from(new Set((Array.isArray(lpmIds)?lpmIds:[lpmIds]).map(v=>String(v||'').trim()).filter(Boolean))).slice(0,50);
  if(!ids.length)throw new Error('lpmId is required');
  const wanted=new Set(ids),rows=getAllData_(false).lpm||[],byId=new Map(rows.filter(r=>wanted.has(String(r.LPM_ID||'').trim())).map(r=>[String(r.LPM_ID||'').trim(),r])),items=ids.map(id=>byId.get(id)).filter(Boolean);
  if(!items.length)throw new Error('선택한 LPM 제품을 찾을 수 없습니다.');
  return items;
}

function exportImageUrls_(item){
  const values=[item.ImageURL,item.ImageURLs,item.ImageURL2,item.ImageURL3],seen={};
  return values.flatMap(v=>String(v||'').split(/[\r\n,;|]+/)).map(v=>v.trim()).filter(v=>/^https?:\/\//i.test(v)&&!seen[v]&&(seen[v]=true));
}

function exportToSlides_(lpmIds,requesterEmail,cfg,level){
  cfg=cfg||getConfig_();
  const items=dataForLevel_({lpm:getLpmsForExport_(lpmIds)},level).lpm,title=items.length===1?'HYOSAN LPM Export - '+lpmDisplayName_(items[0]):'HYOSAN LPM Export - '+items.length+' products',destinationId=String(cfg.SLIDES_DESTINATION_ID||'').trim();
  let pres,created=false,destinationWarning='';
  if(destinationId){
    try{pres=SlidesApp.openById(destinationId)}
    catch(err){destinationWarning='설정된 슬라이드 파일을 열 수 없어 새 파일로 생성했습니다.';pres=SlidesApp.create(title);created=true}
  }else{pres=SlidesApp.create(title);created=true}
  const initialSlide=created?pres.getSlides()[0]:null,W=pres.getPageWidth(),H=pres.getPageHeight(),results=items.map(item=>appendLpmSlide_(pres,item,W,H));
  if(initialSlide)initialSlide.remove();
  const presentationId=pres.getId(),url='https://docs.google.com/presentation/d/'+presentationId+'/edit';
  pres.saveAndClose();
  const sharing=sharePresentation_(presentationId,requesterEmail,cfg),warnings=[destinationWarning,sharing.warning||''].filter(Boolean).join(' '),failed=results.filter(r=>!r.imageInserted);
  return {ok:true,presentationId:presentationId,url:url,imageInserted:failed.length===0,exportedCount:results.length,failedCount:failed.length,failedIds:failed.map(r=>r.id),sharedWith:sharing.shared?requesterEmail:'',shareWarning:warnings};
}

function appendLpmSlide_(pres,item,W,H){
  const slide=pres.appendSlide(SlidesApp.PredefinedLayout.BLANK),imageSize=Math.min(H,W*.58);
  let imageInserted=false;
  try{imageInserted=insertSquareImage_(slide,exportImageUrls_(item),0,(H-imageSize)/2,imageSize)}catch(err){console.warn('Slides image failed for '+item.LPM_ID+': '+err.message)}
  const x=W*.62,w=W*.32;
  addText_(slide,lpmDisplayName_(item),x,H*.12,w,40,15,true);
  if(item.PaperNumber||item.PaperNo||item.PatternForm){addText_(slide,'종이 넘버',x,H*.23,w,18,11,true);addText_(slide,item.PaperNumber||item.PaperNo||item.PatternForm,x,H*.28,w,24,8,false)}   // 하위 사용자는 종이 넘버 없이
  addText_(slide,'샘플북',x,H*.39,w,18,11,true);addText_(slide,item.SampleBook||'-',x,H*.44,w,24,8,false);
  addText_(slide,'분류',x,H*.55,w,18,11,true);addText_(slide,item.Category||'-',x,H*.60,w,24,8,false);
  addText_(slide,'용도',x,H*.71,w,18,11,true);addText_(slide,item.Applications||'-',x,H*.76,w,44,8,false);
  return {id:item.LPM_ID,imageInserted:imageInserted};
}

function sharePresentation_(presentationId,requesterEmail,cfg){
  const email=String(requesterEmail||'').trim().toLowerCase();
  if(!email)return {shared:false};
  const owners=[cfg.ADMIN_EMAIL].map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
  if(owners.includes(email))return {shared:false};
  try{
    const response=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(presentationId)+'/permissions?sendNotificationEmail=false',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},payload:JSON.stringify({type:'user',role:'writer',emailAddress:email}),muteHttpExceptions:true});
    const code=response.getResponseCode();
    if(code<200||code>=300)throw new Error('HTTP '+code+' '+response.getContentText().slice(0,240));
    return {shared:true};
  }catch(err){return {shared:false,warning:'슬라이드는 생성됐지만 요청 계정 자동 공유에 실패했습니다. 관리자에게 Drive 파일 공유 권한 승인을 요청해 주세요.'}}
}

function addText_(slide,text,x,y,w,h,size,bold){
  const box=slide.insertTextBox(String(text||''),x,y,w,h),style=box.getText().getTextStyle();style.setFontFamily('Noto Sans KR').setFontSize(size).setBold(!!bold).setForegroundColor('#171717');return box;
}

function firstImageUrl_(value){return String(value||'').split(/[\r\n,;|]+/).map(v=>v.trim()).find(v=>/^https?:\/\//i.test(v))||''}
function driveFileId_(value){
  const text=String(value||'').trim();
  if(!/^https:\/\/(?:[^/]+\.)?(?:drive\.google\.com|drive\.usercontent\.google\.com)\//i.test(text))return '';
  const pathMatch=text.match(/\/file\/d\/([^/?#]+)/),queryMatch=text.match(/[?&]id=([^&#]+)/);
  return pathMatch?pathMatch[1]:queryMatch?decodeURIComponent(queryMatch[1]):'';
}
function imageBlob_(url){
  const fileId=driveFileId_(url);
  let blob;
  if(fileId){
    const file=DriveApp.getFileById(fileId);
    // 원본 샘플 이미지는 25MP를 넘는 경우가 많아 Slides 삽입 한도를 초과한다.
    // Drive가 생성한 축소 이미지를 우선 사용하면 비공개 파일 권한을 유지하면서 안정적으로 삽입된다.
    blob=file.getThumbnail()||file.getBlob();
  }else{
    const response=UrlFetchApp.fetch(url,{followRedirects:true,muteHttpExceptions:true});
    const status=response.getResponseCode();
    if(status<200||status>=300)throw new Error('이미지 URL 응답 오류(HTTP '+status+')');
    blob=response.getBlob();
  }
  if(!blob||!/^image\//i.test(blob.getContentType()||''))throw new Error('이미지 형식이 아닙니다.');
  return /^image\/(?:png|jpeg|gif)$/i.test(blob.getContentType()||'')?blob:blob.getAs('image/png');
}
function insertSquareImage_(slide,urls,x,y,size){
  const candidates=Array.isArray(urls)?urls:[urls];
  if(!candidates.length)throw new Error('시트에 이미지 URL이 없습니다.');
  let lastError;
  for(let i=0;i<candidates.length;i++){
    let placeholder;
    try{
      const blob=imageBlob_(candidates[i]);placeholder=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,x,y,size,size);
      placeholder.replaceWithImage(blob,true);
      return true;
    }catch(err){try{if(placeholder)placeholder.remove()}catch(removeErr){}lastError=err;console.warn('Slides image candidate '+(i+1)+' failed: '+err.message)}
  }
  throw new Error('슬라이드 이미지 삽입 실패: '+(lastError?lastError.message:'이미지를 읽을 수 없습니다.'));
}
function jsonOutput(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}

