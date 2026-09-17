const SPREADSHEET_ID='1RC-6ibPA86zaWOGt1rzgmQf9tLpT4OcgdI6K9XcUPTI';
const SHEET_NAMES={patterns:'PATTERN_DESIGN',lpm:'HYOSAN_LPM',emboss:'EMBOSS_PLATE',categories:'CATEGORIES',config:'CONFIG',users:'APP_USERS'};
const USER_HEADERS=['Email','Name','PictureURL','Status','RequestedAt','LastLoginAt','ApprovedBy','ApprovedAt'];

function doGet(e){
  try{
    const action=(e&&e.parameter&&e.parameter.action)||'data',cfg=getConfig_(),authRequired=isAuthRequired_(cfg);
    if(action==='appConfig')return jsonOutput({ok:true,clientId:cfg.GOOGLE_CLIENT_ID||'',authRequired:authRequired,appName:cfg.LIBRARY_TITLE||'HYOSAN LPM Library'});
    if(action==='health')return jsonOutput({ok:true,authRequired:authRequired});
    if(action==='data'&&!authRequired)return jsonOutput(getAllData_());
    if(action==='data')return jsonOutput({ok:false,error:'Google login required',code:'AUTH_REQUIRED'});
    return jsonOutput({ok:false,error:'Unknown action'});
  }catch(err){return jsonOutput({ok:false,error:String(err),code:err&&err.code?err.code:'REQUEST_FAILED'})}
}

function doPost(e){
  try{
    const body=JSON.parse((e&&e.postData&&e.postData.contents)||'{}'),cfg=getConfig_(),authRequired=isAuthRequired_(cfg);
    if(!authRequired&&body.action==='data')return jsonOutput(getAllData_());
    if(!authRequired&&body.action==='exportToSlides')return jsonOutput(exportToSlides_(body.lpmId));
    if(body.action==='authStatus'){
      const identity=verifyGoogleToken_(body.idToken,cfg),loginUser=touchUser_(identity,cfg),loginResponse=userResponse_(loginUser);
      if(loginResponse.ok)loginResponse.sessionToken=createSessionToken_(loginUser.Email);
      return jsonOutput(loginResponse);
    }
    const user=authenticateRequest_(body,cfg);
    if(body.action==='sessionStatus')return jsonOutput(userResponse_(user));
    if(user.Status!=='ADMIN'&&user.Status!=='APPROVED')return jsonOutput(userResponse_(user));
    if(body.action==='data')return jsonOutput(Object.assign(getAllData_(),{user:userResponse_(user).user}));
    if(body.action==='exportToSlides')return jsonOutput(exportToSlides_(body.lpmId,user.Email));
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
  try{cache.put(key,JSON.stringify(cfg),60)}catch(e){}
  return cfg;
}

function isAuthRequired_(cfg){return String(cfg.AUTH_REQUIRED||'').toUpperCase()==='TRUE'}

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

function getUserByEmail_(email){
  const rows=readSheet_(SpreadsheetApp.openById(SPREADSHEET_ID),SHEET_NAMES.users),user=rows.find(r=>String(r.Email||'').toLowerCase()===String(email||'').toLowerCase());if(!user)throw appError_('사용자를 찾을 수 없습니다.','USER_NOT_FOUND');return user;
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
  return {ok:status==='ADMIN'||status==='APPROVED',status:status,user:{email:user.Email,name:user.Name,picture:user.PictureURL,isAdmin:status==='ADMIN'},message:status==='PENDING'?'관리자 승인을 기다리고 있습니다.':status==='REVOKED'?'관리자가 사용 권한을 중지했습니다.':''};
}

function listUsers_(admin){
  assertAdmin_(admin);const rows=readSheet_(SpreadsheetApp.openById(SPREADSHEET_ID),SHEET_NAMES.users);
  return {ok:true,users:rows.map(r=>({email:r.Email,name:r.Name,picture:r.PictureURL,status:r.Status,requestedAt:r.RequestedAt,lastLoginAt:r.LastLoginAt,approvedBy:r.ApprovedBy,approvedAt:r.ApprovedAt}))};
}

function setUserStatus_(admin,email,status){
  assertAdmin_(admin);email=String(email||'').trim().toLowerCase();status=String(status||'').toUpperCase();
  if(!email||!['APPROVED','REVOKED'].includes(status))throw appError_('사용자 또는 상태 값이 올바르지 않습니다.','INVALID_USER_UPDATE');
  if(email===String(admin.Email||'').toLowerCase())throw appError_('관리자 본인의 권한은 변경할 수 없습니다.','ADMIN_PROTECTED');
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=getUserSheet_(ss),values=sh.getDataRange().getDisplayValues(),now=new Date().toISOString();
  for(let i=1;i<values.length;i++)if(String(values[i][0]||'').toLowerCase()===email){sh.getRange(i+1,4).setValue(status);sh.getRange(i+1,7,1,2).setValues([[admin.Email,now]]);return {ok:true,email:email,status:status}}
  throw appError_('사용자를 찾을 수 없습니다.','USER_NOT_FOUND');
}

function assertAdmin_(user){if(!user||user.Status!=='ADMIN')throw appError_('관리자 권한이 필요합니다.','ADMIN_REQUIRED')}
function appError_(message,code){const err=new Error(message);err.code=code;return err}

function getAllData_(){
  const cache=CacheService.getScriptCache(),cacheKey='library-data-v1',cached=cache.get(cacheKey);
  if(cached){try{return JSON.parse(cached)}catch(e){}}
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  const out={patterns:readSheet_(ss,SHEET_NAMES.patterns),lpm:readSheet_(ss,SHEET_NAMES.lpm),emboss:readSheet_(ss,SHEET_NAMES.emboss),categories:readSheet_(ss,SHEET_NAMES.categories),config:{}};
  const publicConfig=['LIBRARY_TITLE','SYNC_INTERVAL_SECONDS','COLOR_TOLERANCE_PERCENT','VERSION'];
  readSheet_(ss,SHEET_NAMES.config).forEach(r=>{if(publicConfig.includes(r.KEY))out.config[r.KEY]=r.VALUE});
  readSheet_(ss,'RELATIONS').forEach(r=>{
    const p=out.patterns.find(x=>x.ID===r.Pattern_ID),l=out.lpm.find(x=>x.LPM_ID===r.LPM_ID);
    const add=(o,key,id)=>{if(o&&id)o[key]=Array.from(new Set(String(o[key]||'').split(',').map(x=>x.trim()).filter(Boolean).concat(id))).join(',')};
    add(p,'RelatedLPM_IDs',r.LPM_ID);add(p,'RecommendedEmbossPlate_IDs',r.EmbossPlate_ID);
    add(l,'RelatedPattern_IDs',r.Pattern_ID);add(l,'EmbossPlate_IDs',r.EmbossPlate_ID);
  });
  try{cache.put(cacheKey,JSON.stringify(out),45)}catch(e){}
  return out;
}

function readSheet_(ss,name){
  const sh=ss.getSheetByName(name);if(!sh)return [];
  const values=sh.getDataRange().getDisplayValues();if(values.length<2)return [];
  const headers=values[0];
  return values.slice(1).filter(r=>r.some(v=>v!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}

function exportToSlides_(lpmId,requesterEmail){
  if(!lpmId)throw new Error('lpmId is required');
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),rows=readSheet_(ss,SHEET_NAMES.lpm),item=rows.find(r=>r.LPM_ID===lpmId);if(!item)throw new Error('LPM not found: '+lpmId);
  const cfg={};readSheet_(ss,SHEET_NAMES.config).forEach(r=>{if(r.KEY)cfg[r.KEY]=r.VALUE});
  let pres;
  if(cfg.SLIDES_DESTINATION_ID){pres=SlidesApp.openById(cfg.SLIDES_DESTINATION_ID)}else{pres=SlidesApp.create('HYOSAN LPM Export - '+item.ProductName)}
  const slide=pres.appendSlide(SlidesApp.PredefinedLayout.BLANK),W=pres.getPageWidth(),H=pres.getPageHeight();
  slide.insertShape(SlidesApp.ShapeType.RECTANGLE,0,0,W,H).getFill().setSolidFill('#F5F3EE');
  const slideImage=firstImageUrl_(item.ImageURL||item.PreviewImageURL),imageSize=Math.min(H,W*.58);
  const imageInserted=insertSquareImage_(slide,slideImage,0,(H-imageSize)/2,imageSize);
  const x=W*.62,w=W*.32;
  addText_(slide,item.ProductName||'',x,H*.12,w,40,15,true);
  addText_(slide,'종이 넘버',x,H*.23,w,18,11,true);addText_(slide,item.PaperNumber||item.PaperNo||item.PatternForm||'-',x,H*.28,w,24,8,false);
  addText_(slide,'샘플북',x,H*.39,w,18,11,true);addText_(slide,item.SampleBook||'-',x,H*.44,w,24,8,false);
  addText_(slide,'분류',x,H*.55,w,18,11,true);addText_(slide,item.Category||'-',x,H*.60,w,24,8,false);
  addText_(slide,'용도',x,H*.71,w,18,11,true);addText_(slide,item.Applications||'-',x,H*.76,w,44,8,false);
  if(pres.getSlides().length>1&&!cfg.SLIDES_DESTINATION_ID)pres.getSlides()[0].remove();
  const sharing=sharePresentation_(pres.getId(),requesterEmail,cfg);
  return {ok:true,presentationId:pres.getId(),url:pres.getUrl(),imageInserted:imageInserted,sharedWith:sharing.shared?requesterEmail:'',shareWarning:sharing.warning||''};
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
function insertSquareImage_(slide,url,x,y,size){
  if(!url)throw new Error('시트에 이미지 URL이 없습니다.');
  try{
    const blob=imageBlob_(url),image=slide.insertImage(blob);
    image.setLeft(x).setTop(y).setWidth(size).setHeight(size).replace(blob,true);return true;
  }catch(err){
    console.error('Slides image insert failed: '+err.message);
    throw new Error('슬라이드 이미지 삽입 실패: '+err.message);
  }
}
function jsonOutput(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}

