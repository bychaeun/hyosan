const SPREADSHEET_ID='1RC-6ibPA86zaWOGt1rzgmQf9tLpT4OcgdI6K9XcUPTI';
const SHEET_NAMES={patterns:'PATTERN_DESIGN',lpm:'HYOSAN_LPM',specialSpecs:'SPECIAL_SPECS',emboss:'EMBOSS_PLATE',sites:'CONSTRUCTION_SITES',config:'CONFIG',users:'APP_USERS'};
const USER_HEADERS=['Email','Name','PictureURL','Status','RequestedAt','LastLoginAt','ApprovedBy','ApprovedAt'];
const INDEX_SOURCE={folderId:'1q_c5qhZr8GpOqVf2MK11v9hwlmoHNFuU',fileName:'인덱스코드.XLS',fallbackFileId:'1j4OCFPOoVzWcFDoe4WJ9LbV5EzurmS9v'};
const INDEX_COLORS={changed:'#FFF2CC',manual:'#D9EAF7',added:'#D9EAD3',ambiguous:'#FCE5CD',clear:'#FFFFFF'};

function installIndexSyncTrigger(){
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncIndexCode').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncIndexCode').timeBased().everyMinutes(30).create();
  return syncIndexCode();
}

function syncIndexCode(){
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  let convertedId='';
  try{
    const sourceFile=latestIndexFile_();
    convertedId=convertIndexWorkbook_(sourceFile);
    const sourceRows=parseIndexRows_(SpreadsheetApp.openById(convertedId).getSheets()[0].getDataRange().getDisplayValues());
    const sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAMES.lpm);
    if(!sheet)throw new Error('HYOSAN_LPM 시트를 찾을 수 없습니다.');
    const result=reconcileIndexRows_(sheet,sourceRows);
    clearLibraryDataCache_();
    PropertiesService.getScriptProperties().setProperties({INDEX_LAST_SYNC_AT:new Date().toISOString(),INDEX_LAST_SOURCE_ID:sourceFile.getId(),INDEX_LAST_RESULT:JSON.stringify(result)});
    return result;
  }finally{
    if(convertedId)try{Drive.Files.remove(convertedId)}catch(e){try{DriveApp.getFileById(convertedId).setTrashed(true)}catch(ignore){}}
    lock.releaseLock();
  }
}

function latestIndexFile_(){
  let latest=null,files=DriveApp.getFolderById(INDEX_SOURCE.folderId).getFilesByName(INDEX_SOURCE.fileName);
  while(files.hasNext()){
    const file=files.next();
    if(!latest||file.getLastUpdated().getTime()>latest.getLastUpdated().getTime())latest=file;
  }
  return latest||DriveApp.getFileById(INDEX_SOURCE.fallbackFileId);
}

function convertIndexWorkbook_(file){
  const converted=Drive.Files.create({name:'__HYOSAN_INDEX_SYNC__'+Date.now(),mimeType:'application/vnd.google-apps.spreadsheet'},file.getBlob(),{fields:'id'});
  if(!converted||!converted.id)throw new Error('인덱스코드 XLS 변환에 실패했습니다.');
  return converted.id;
}

function parseIndexRows_(values){
  const out=[];
  for(let rowIndex=5;rowIndex<values.length;rowIndex++){
    const row=values[rowIndex]||[],names=row.slice(0,15).map(v=>String(v||'').trim()).filter(Boolean),paper=String(row[15]||'').trim(),company=String(row[16]||'').trim();
    if(!names.length||indexNorm_(paper)==='SPECOUT')continue;
    const current=names[names.length-1],previous=[];
    names.forEach(name=>{if(indexNorm_(name)!==indexNorm_(current)&&!previous.some(v=>indexNorm_(v)===indexNorm_(name)))previous.push(name)});
    out.push({sourceRow:rowIndex+1,current:current,previous:previous,aliases:previous.concat([current]),paper:paper,company:company});
  }
  return out;
}

function reconcileIndexRows_(sheet,sourceRows){
  const lastRow=sheet.getLastRow(),lastColumn=Math.max(sheet.getMaxColumns(),9),values=lastRow>1?sheet.getRange(2,1,lastRow-1,9).getDisplayValues():[];
  const targets=values.map((row,i)=>({sheetRow:i+2,id:row[0],product:row[1],previous:row[2],paper:row[7],company:row[8]}));
  const aliasMap=new Map();
  sourceRows.forEach(source=>source.aliases.forEach(alias=>{const key=indexNorm_(alias),list=aliasMap.get(key)||[];list.push(source);aliasMap.set(key,list)}));
  const used=new Set(),changed=[],manual=[],ambiguous=[];
  targets.forEach(target=>{
    const keys=[target.product].concat(splitIndexNames_(target.previous)).map(indexNorm_).filter(Boolean),candidates=[];
    keys.forEach(key=>(aliasMap.get(key)||[]).forEach(item=>{if(!candidates.includes(item))candidates.push(item)}));
    let matched=candidates;
    if(matched.length>1){
      const byPaper=matched.filter(item=>indexNorm_(item.paper)===indexNorm_(target.paper));
      if(byPaper.length===1)matched=byPaper;else{
        const byCompany=matched.filter(item=>indexCompanyNorm_(item.company)===indexCompanyNorm_(target.company));
        if(byCompany.length===1)matched=byCompany;
      }
    }
    if(matched.length===1){
      const source=matched[0];used.add(source);
      const oldPrevious=splitIndexNames_(target.previous).map(indexNorm_).filter(Boolean).sort().join('|'),newPrevious=source.previous.map(indexNorm_).filter(Boolean).sort().join('|');
      if(indexNorm_(target.product)!==indexNorm_(source.current)||oldPrevious!==newPrevious||indexNorm_(target.paper)!==indexNorm_(source.paper)||indexCompanyNorm_(target.company)!==indexCompanyNorm_(source.company))changed.push(target.sheetRow);
    }else if(!matched.length)manual.push(target.sheetRow);else ambiguous.push(target.sheetRow);
  });
  clearOldIndexStatusColors_(sheet,lastRow,lastColumn);
  colorIndexRows_(sheet,changed,lastColumn,INDEX_COLORS.changed);
  colorIndexRows_(sheet,manual,lastColumn,INDEX_COLORS.manual);
  colorIndexRows_(sheet,ambiguous,lastColumn,INDEX_COLORS.ambiguous);
  const additions=sourceRows.filter(source=>!used.has(source)),newRows=[];
  if(additions.length){
    let nextId=targets.reduce((max,row)=>Math.max(max,Number((String(row.id||'').match(/(\d+)$/)||[])[1]||0)),0)+1,startRow=sheet.getLastRow()+1;
    additions.forEach((item,i)=>newRows.push({row:startRow+i,id:'LPM-'+String(nextId+i).padStart(3,'0'),item:item}));
    sheet.getRange(startRow,1,newRows.length,3).setValues(newRows.map(row=>[row.id,row.item.current,row.item.previous.join(', ')]));
    sheet.getRange(startRow,8,newRows.length,2).setValues(newRows.map(row=>[row.item.paper,row.item.company]));
    colorIndexRows_(sheet,newRows.map(row=>row.row),lastColumn,INDEX_COLORS.added);
  }
  SpreadsheetApp.flush();
  return {ok:true,sourceFile:INDEX_SOURCE.fileName,sourceCount:sourceRows.length,changedCount:changed.length,manualCount:manual.length,ambiguousCount:ambiguous.length,addedCount:newRows.length,addedIds:newRows.map(row=>row.id),syncedAt:new Date().toISOString()};
}

function splitIndexNames_(value){return String(value||'').split(/[\r\n,;|/]+/).map(v=>v.trim()).filter(Boolean)}
function indexNorm_(value){return String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase()}
function indexCompanyNorm_(value){return indexNorm_(value).replace(/\(주\)|㈜/g,'')}
function colorIndexRows_(sheet,rows,lastColumn,color){
  if(!rows.length)return;
  const endColumn=columnLetter_(lastColumn);
  for(let i=0;i<rows.length;i+=100)sheet.getRangeList(rows.slice(i,i+100).map(row=>'A'+row+':'+endColumn+row)).setBackground(color);
}
function clearOldIndexStatusColors_(sheet,lastRow,lastColumn){
  if(lastRow<2)return;
  const colors=sheet.getRange(2,1,lastRow-1,1).getBackgrounds(),rows=[];
  colors.forEach((row,i)=>{const color=String(row[0]||'').toUpperCase();if(color===INDEX_COLORS.changed||color===INDEX_COLORS.manual||color===INDEX_COLORS.ambiguous)rows.push(i+2)});
  colorIndexRows_(sheet,rows,lastColumn,INDEX_COLORS.clear);
}
function columnLetter_(column){let result='';while(column>0){column--;result=String.fromCharCode(65+column%26)+result;column=Math.floor(column/26)}return result}
function clearLibraryDataCache_(){
  const cache=CacheService.getScriptCache();
  try{const meta=JSON.parse(cache.get(DATA_CACHE_PREFIX+'meta')||'null'),keys=[DATA_CACHE_PREFIX+'meta'];if(meta&&meta.count)for(let i=0;i<meta.count;i++)keys.push(DATA_CACHE_PREFIX+i);cache.removeAll(keys)}catch(e){}
}

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
    const user=authenticateRequest_(body,cfg);
    if(body.action==='sessionStatus')return jsonOutput(userResponse_(user));
    if(user.Status!=='ADMIN'&&user.Status!=='APPROVED')return jsonOutput(userResponse_(user));
    if(body.action==='data')return jsonOutput(Object.assign(getAllData_(body.force===true),{user:userResponse_(user).user}));
    if(body.action==='exportToSlides')return jsonOutput(exportToSlides_(body.lpmIds||body.lpmId,user.Email,cfg));
    if(body.action==='listUsers')return jsonOutput(listUsers_(user));
    if(body.action==='setUserStatus')return jsonOutput(setUserStatus_(user,body.email,body.status));
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
  const payload=Utilities.base64EncodeWebSafe(JSON.stringify({email:String(email).toLowerCase(),exp:Date.now()+30*24*60*60*1000})).replace(/=+$/,''),signature=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload,getSessionSecret_())).replace(/=+$/,'');
  return payload+'.'+signature;
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
  try{cache.put(USER_CACHE_KEY,JSON.stringify(rows),30)}catch(e){}
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
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=getUserSheet_(ss),values=sh.getDataRange().getDisplayValues(),headers=values[0],email=identity.email.toLowerCase(),now=new Date().toISOString();
    let rowIndex=-1,row=null;
    for(let i=1;i<values.length;i++)if(String(values[i][0]||'').toLowerCase()===email){rowIndex=i+1;row=Object.fromEntries(headers.map((h,j)=>[h,values[i][j]]));break}
    const adminEmail=String(cfg.ADMIN_EMAIL||'').toLowerCase();
    if(!row){
      const status=email===adminEmail?'ADMIN':'PENDING',newRow=[email,identity.name,identity.picture,status,now,now,status==='ADMIN'?email:'',status==='ADMIN'?now:''];
      sh.appendRow(newRow);row=Object.fromEntries(USER_HEADERS.map((h,i)=>[h,newRow[i]]));
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
  return {ok:status==='ADMIN'||status==='APPROVED',code:status==='PENDING'?'APPROVAL_PENDING':status==='REVOKED'?'ACCESS_REVOKED':'',status:status,user:{email:user.Email,name:user.Name,picture:user.PictureURL,isAdmin:status==='ADMIN'},message:status==='PENDING'?'관리자 승인을 기다리고 있습니다.':status==='REVOKED'?'관리자가 사용 권한을 중지했습니다.':''};
}

function listUsers_(admin){
  assertAdmin_(admin);const rows=readUsers_();
  return {ok:true,users:rows.map(r=>({email:r.Email,name:r.Name,picture:r.PictureURL,status:r.Status,requestedAt:r.RequestedAt,lastLoginAt:r.LastLoginAt,approvedBy:r.ApprovedBy,approvedAt:r.ApprovedAt}))};
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

const DATA_CACHE_PREFIX='library-data-v8-';
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
    const zipped=Utilities.gzip(Utilities.newBlob(JSON.stringify(data),'application/json')),encoded=Utilities.base64Encode(zipped.getBytes()),size=80000,values={};
    for(let i=0,n=0;i<encoded.length;i+=size,n++)values[DATA_CACHE_PREFIX+n]=encoded.slice(i,i+size);
    values[DATA_CACHE_PREFIX+'meta']=JSON.stringify({count:Math.ceil(encoded.length/size)});
    cache.putAll(values,1800);
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
  const query=names.map(name=>'ranges='+encodeURIComponent("'"+String(name).replace(/'/g,"''")+"'")).join('&');
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(SPREADSHEET_ID)+'/values:batchGet?'+query+'&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
  const response=UrlFetchApp.fetch(url,{method:'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  const code=response.getResponseCode();
  if(code!==200)throw new Error('Google Sheets 일괄 읽기 실패 ('+code+'): '+response.getContentText().slice(0,300));
  const ranges=(JSON.parse(response.getContentText()).valueRanges||[]),result={};
  names.forEach((name,i)=>{result[name]=rowsFromValues_((ranges[i]&&ranges[i].values)||[])});
  return result;
}
function getAllData_(forceRefresh){
  const cache=CacheService.getScriptCache(),cached=forceRefresh?null:readDataCache_(cache);
  if(cached)return cached;
  const names=[SHEET_NAMES.patterns,SHEET_NAMES.lpm,SHEET_NAMES.specialSpecs,SHEET_NAMES.emboss,SHEET_NAMES.sites,SHEET_NAMES.config,'RELATIONS'];
  const tables=readSheetsBatch_(names);
  const out={patterns:tables[SHEET_NAMES.patterns]||[],lpm:tables[SHEET_NAMES.lpm]||[],specialSpecs:tables[SHEET_NAMES.specialSpecs]||[],emboss:tables[SHEET_NAMES.emboss]||[],sites:tables[SHEET_NAMES.sites]||[],config:{}};
  const publicConfig=['LIBRARY_TITLE','SYNC_INTERVAL_SECONDS','COLOR_TOLERANCE_PERCENT','VERSION'];
  (tables[SHEET_NAMES.config]||[]).forEach(r=>{if(r.KEY)out.config[r.KEY]=r.VALUE});
  out.patterns.forEach(item=>{delete item.RelatedLPM_IDs;delete item.RecommendedEmbossPlate_IDs});
  out.lpm.forEach(item=>{delete item.RelatedPattern_IDs;delete item.EmbossPlate_IDs});
  const relationIds_=value=>String(value||'').split(/[\r\n,;|]+/).map(v=>v.trim()).filter(Boolean);
  const relationKey_=value=>String(value||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  const nameLookup_=(items,nameFields,idField)=>{
    const lookup=new Map();
    items.forEach(item=>nameFields.forEach(field=>{
      const key=relationKey_(item[field]);if(!key)return;const id=String(item[idField]||'').trim();
      if(!id)return;const ids=lookup.get(key)||[];if(!ids.includes(id))ids.push(id);lookup.set(key,ids);
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
  const lpmByName=nameLookup_(out.lpm,['ProductName'],'LPM_ID');
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
  const values=sh.getRange(1,1,lastRow,lastColumn).getDisplayValues(),headers=values[0];
  return values.slice(1).filter(r=>r.some(v=>v!=='')).map(r=>{const item={};headers.forEach((h,i)=>{if(h&&r[i]!=='')item[h]=r[i]});return item});
}

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

function exportToSlides_(lpmIds,requesterEmail,cfg){
  cfg=cfg||getConfig_();
  const items=getLpmsForExport_(lpmIds),title=items.length===1?'HYOSAN LPM Export - '+(items[0].ProductName||items[0].LPM_ID):'HYOSAN LPM Export - '+items.length+' products',destinationId=String(cfg.SLIDES_DESTINATION_ID||'').trim();
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
  addText_(slide,item.ProductName||'',x,H*.12,w,40,15,true);
  addText_(slide,'종이 넘버',x,H*.23,w,18,11,true);addText_(slide,item.PaperNumber||item.PaperNo||item.PatternForm||'-',x,H*.28,w,24,8,false);
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

