// Standalone HYOSAN INDEX SYNC project. Do not add this file to the web API project.
const SPREADSHEET_ID='1RC-6ibPA86zaWOGt1rzgmQf9tLpT4OcgdI6K9XcUPTI';
const LPM_SHEET='HYOSAN_LPM',INDEX_FOLDER='1q_c5qhZr8GpOqVf2MK11v9hwlmoHNFuU',ERP_IMAGE_FOLDER='1Wn6eedmpG3dvLx9EtLCCutWZS1WVkx8t',IMAGE_FOLDERS=['17nAS6IOCC5tkl_L0NOYqdltnbRZmyZBb',ERP_IMAGE_FOLDER];
const SYNC_VERSION='2026-11-03-columns-by-header-v6';
function syncIndexCode(){return runIndexSync_(false)}
function previewIndexSync(){return runIndexSync_(true)}
function installIndexSyncTrigger(){
  const old=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncIndexCode');
  ScriptApp.newTrigger('syncIndexCode').timeBased().everyHours(1).create();
  old.forEach(t=>ScriptApp.deleteTrigger(t));
}
function runIndexSync_(dryRun){
  const lock=LockService.getScriptLock();lock.waitLock(30000);let convertedId='';
  try{
    const source=latestIndexFile_(),converted=Drive.Files.create({name:'__HYOSAN_INDEX_SYNC__'+Date.now(),mimeType:'application/vnd.google-apps.spreadsheet'},source.getBlob(),{fields:'id'});
    if(!converted||!converted.id)throw new Error('엑셀 변환 실패: 시트를 변경하지 않았습니다.');
    convertedId=converted.id;
    const sources=parseIndexRows_(SpreadsheetApp.openById(convertedId).getSheets()[0].getDataRange().getDisplayValues());
    if(!sources.length)throw new Error('유효한 종이넘버가 없습니다. 원본 엑셀의 A:Q 구조를 확인하세요.');
    const images=readIndexImages_(),sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(LPM_SHEET);
    if(!sheet)throw new Error('대상 시트가 없습니다.');
    const last=sheet.getLastRow(),values=sheet.getRange(1,1,Math.max(last,1),sheet.getLastColumn()).getDisplayValues(),cols=indexColumns_(values[0]),width=values[0].length;
    const formulas=last>1?sheet.getRange(2,1,last-1,width).getFormulas():[],plan=planIndexSync_(values.slice(1).map(r=>cols.map(c=>c>=0?r[c]:'')),sources,images,cols[13]>=0?13:-1);
    const updates=plan.updates.map(u=>({row:u.row,col:cols[u.col-1]+1,value:u.value}));   // 계획의 1·11·13번 칸 → 실제 시트 칸
    updates.forEach(u=>{if(formulas[u.row-2]&&formulas[u.row-2][u.col-1])throw new Error('자동 갱신 대상에 수식이 있습니다: '+u.row+'행 '+u.col+'열')});
    if(!dryRun){
      writeIndexUpdates_(sheet,updates);
      if(plan.additions.length){
        const start=last+1,end=last+plan.additions.length;
        if(end>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),end-sheet.getMaxRows());
        const rows=plan.additions.map(a=>{const r=Array(width).fill('');cols.forEach((c,i)=>{if(c>=0&&i<a.length)r[c]=a[i]});return r.map(literalIndexText_)});
        sheet.getRange(start,1,rows.length,width).setNumberFormat('@').setValues(rows).setBackground('#D9EAD3');
      }
      SpreadsheetApp.flush();
    }
    const result={ok:true,version:SYNC_VERSION,dryRun,sourceFile:source.getName(),sourceRows:sources.length,existingRows:values.length-1,addedCount:plan.additions.length,statusUpdates:plan.updates.filter(u=>u.col===13).length,imageUpdates:plan.updates.filter(u=>u.col===11).length,sourceDuplicatePapers:plan.duplicatePapers,ambiguousImages:plan.ambiguousImages,additionPreview:plan.additions.slice(0,8).map(r=>({paper:r[7],product:r[1]}))};
    if(!dryRun)PropertiesService.getScriptProperties().setProperties({INDEX_LAST_SYNC_AT:new Date().toISOString(),INDEX_LAST_SOURCE_ID:source.getId(),INDEX_LAST_RESULT:JSON.stringify(result)});
    console.log(JSON.stringify(result));return result;
  }finally{if(convertedId)try{DriveApp.getFileById(convertedId).setTrashed(true)}catch(e){console.warn('임시 변환 파일 정리 실패: '+convertedId)}lock.releaseLock()}
}
// Batch contiguous changes per column. Existing names, categories and images are not rewritten.
function writeIndexUpdates_(sheet,updates){
  Array.from(new Set(updates.map(u=>u.col))).sort((a,b)=>a-b).forEach(col=>{
    const list=updates.filter(u=>u.col===col).sort((a,b)=>a.row-b.row);let start=0,values=[];
    const flush=()=>{if(values.length)sheet.getRange(start,col,values.length,1).setNumberFormat('@').setValues(values).setWrap(true);values=[]};
    list.forEach(u=>{if(values.length&&u.row!==start+values.length)flush();if(!values.length)start=u.row;values.push([literalIndexText_(u.value)])});flush();
  });
}
function latestIndexFile_(){
  const files=DriveApp.getFolderById(INDEX_FOLDER).getFiles();let latest=null;
  while(files.hasNext()){const file=files.next();if(!/^인덱스코드\.xlsx?$/i.test(file.getName().trim()))continue;if(!latest||file.getLastUpdated().getTime()>latest.getLastUpdated().getTime()||(file.getLastUpdated().getTime()===latest.getLastUpdated().getTime()&&file.getId()>latest.getId()))latest=file}
  if(!latest)throw new Error('지정 폴더에 인덱스코드.XLS 또는 인덱스코드.xlsx가 없습니다.');return latest;
}
function indexNorm_(v){return String(v==null?'':v).normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase()}
function splitIndexNames_(v){return String(v||'').split(/[\r\n,;|/]+/).map(s=>s.trim()).filter(Boolean)}
function uniqueIndex_(values){return Array.from(new Map(values.filter(Boolean).map(v=>[indexNorm_(v),v])).values())}
function indexSet_(values){return uniqueIndex_(values).map(indexNorm_).sort().join('\u0001')}
function literalIndexText_(v){return typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v}
function parseIndexRows_(values){
  const out=[];for(let i=5;i<values.length;i++){const r=values[i]||[],names=r.slice(0,15).map(v=>String(v||'').trim()).filter(Boolean),paper=String(r[15]||'').trim();if(!paper||indexNorm_(paper)==='SPECOUT'||!names.length)continue;const current=names[names.length-1];out.push({paper,current,previous:uniqueIndex_(names.slice(0,-1).flatMap(splitIndexNames_)).filter(v=>!splitIndexNames_(current).some(n=>indexNorm_(n)===indexNorm_(v))),company:String(r[16]||'').trim()})}return out;
}
function readIndexImages_(){
  const out=[];
  // An unreadable folder is skipped; sync only adds URLs, so nothing is lost.
  IMAGE_FOLDERS.forEach(id=>{let files;try{files=DriveApp.getFolderById(id).getFiles()}catch(e){console.warn('이미지 폴더 읽기 실패: '+id);return}
  while(files.hasNext()){const f=files.next();if(!/^image\//.test(f.getMimeType()))continue;const name=f.getName().replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif|svg)$/i,''),crop=id===ERP_IMAGE_FOLDER;
    // ERP scans carry crop=erp so the web app hides the printed paper number at the bottom.
    out.push({key:indexNorm_(name),id:f.getId(),crop,url:'https://drive.google.com/thumbnail?id='+encodeURIComponent(f.getId())+'&sz=w1600'+(crop?'&crop=erp':'')})}});
  return out.sort((a,b)=>a.key.localeCompare(b.key,undefined,{numeric:true})||a.id.localeCompare(b.id));
}
// 시트 칸은 제목으로 찾는다('내용2'처럼 칸이 끼어들어도 그대로 동작). 계획(planIndexSync_)은 아래 순서의 예전 13칸(+수동관리)으로 짠다.
const INDEX_COLUMNS=['LPM_ID','ProductName','PreviousNames','SampleBook','Category','ColorTone','ColorHex','PaperNumber','BasePaperCompany','내용','ImageURL','Active',['인덱스 변경 내용','자동화 상태'],['ManualManaged','수동관리']];
const INDEX_REQUIRED=[0,1,2,7,8,10,11,12];
function indexColumns_(head){
  const h=head.map(v=>String(v).trim()),cols=INDEX_COLUMNS.map(n=>[].concat(n).map(x=>h.indexOf(x)).find(i=>i>=0)??-1);
  INDEX_REQUIRED.forEach(i=>{if(cols[i]<0)throw new Error('시트에서 칸을 찾지 못했습니다: '+[].concat(INDEX_COLUMNS[i])[0])});
  return cols;
}
function driveImageId_(url){try{const s=String(url);if(!/^https:\/\/(?:drive\.google\.com|drive\.usercontent\.google\.com|lh3\.googleusercontent\.com)\//i.test(s))return '';const m=s.match(/\/(?:file\/d|d)\/([^/?#]+)/)||s.match(/[?&]id=([^&#]+)/);return m?decodeURIComponent(m[1]):''}catch(e){return ''}}
const isErpImageUrl_=url=>/[?&]crop=erp(?:&|#|$)/.test(String(url));
// ERP scans always go after regular photos; ERP files linked before tagging get the crop tag.
function mergeImageUrls_(existing,images,cropUrls){
  cropUrls=cropUrls||new Map(images.filter(im=>im.crop).map(im=>[im.id,im.url]));
  const urls=String(existing||'').split(/[\r\n,;|]+/).map(v=>v.trim()).filter(Boolean).map(v=>cropUrls.get(driveImageId_(v))||v),seen=new Set(urls.map(v=>driveImageId_(v)||v));
  images.forEach(im=>{const key=im.id||driveImageId_(im.url)||im.url;if(!seen.has(key)){urls.push(im.url);seen.add(key)}});
  return urls.filter(v=>!isErpImageUrl_(v)).concat(urls.filter(isErpImageUrl_)).join('\n');
}
function planIndexSync_(rows,sources,images,manualColumn=-1){
  const groups=new Map(),present=new Set(),updates=[],additions=[];let ambiguousImages=0;
  sources.forEach(s=>{const key=indexNorm_(s.paper);if(!key)return;if(!groups.has(key))groups.set(key,{paper:s.paper,current:[],previous:[],companies:[],count:0});const g=groups.get(key);g.count++;g.current.push(...splitIndexNames_(s.current));g.previous.push(...(s.previous||[]).flatMap(splitIndexNames_));if(s.company)g.companies.push(s.company)});
  groups.forEach(g=>{g.current=uniqueIndex_(g.current);g.previous=uniqueIndex_(g.previous).filter(p=>!g.current.some(n=>indexNorm_(n)===indexNorm_(p)));g.companies=uniqueIndex_(g.companies)});
  rows.forEach(r=>{const p=indexNorm_(r[7]);if(p)present.add(p)});
  const namePapers=new Map(),imageMap=new Map(),cropUrls=new Map(images.filter(im=>im.crop).map(im=>[im.id,im.url]));
  const hasUntaggedErp=v=>String(v||'').split(/[\r\n,;|]+/).some(u=>cropUrls.has(driveImageId_(u.trim()))&&!isErpImageUrl_(u));
  const register=(name,paper)=>{const key=indexNorm_(name);if(!key||!paper)return;if(!namePapers.has(key))namePapers.set(key,new Set());namePapers.get(key).add(paper)};
  rows.forEach(r=>splitIndexNames_(r[1]).concat(splitIndexNames_(r[2])).forEach(n=>register(n,indexNorm_(r[7]))));
  groups.forEach((g,p)=>g.current.concat(g.previous).forEach(n=>register(n,p)));
  images.slice().sort((a,b)=>a.key.localeCompare(b.key,undefined,{numeric:true})||a.id.localeCompare(b.id)).forEach(im=>{
    // Never strip a suffix that is itself an exact registered paper or product.
    const exact=present.has(im.key)||groups.has(im.key)||namePapers.has(im.key),key=exact?im.key:im.key.replace(/_\d+$/,'').replace(/[-_]FULL$/,'');
    if(!imageMap.has(key))imageMap.set(key,[]);imageMap.get(key).push(im);
  });
  const imageFor=(paper,names)=>{
    const matches=[...(imageMap.get(paper)||[])];let warning='';
    uniqueIndex_(names).forEach(n=>{const k=indexNorm_(n),candidates=imageMap.get(k)||[];if(!candidates.length||k===paper)return;const owners=namePapers.get(k);if(owners&&owners.size===1&&owners.has(paper))matches.push(...candidates);else{ambiguousImages++;warning='이미지 확인: 파일명이 여러 종이넘버에 일치하여 자동 연결하지 않았습니다.'}});
    return {images:Array.from(new Map(matches.map(im=>[im.id,im])).values()),warning};
  };
  let next=rows.reduce((max,r)=>Math.max(max,Number((String(r[0]||'').match(/(\d+)$/)||[])[1]||0)),0)+1;
  rows.forEach((r,i)=>{
    const paper=indexNorm_(r[7]),g=groups.get(paper),messages=[];
    // '신규 종이(ERP)' 시트에서 옮겨 붙인 행처럼 LPM_ID가 빈 행에는 다음 번호를 붙인다
    if(paper&&!String(r[0]||'').trim())updates.push({row:i+2,col:1,value:'LPM-'+String(next++).padStart(3,'0')});
    const manual=manualColumn>=0&&/^(true|1|yes|수동)$/i.test(String(r[manualColumn]||'').trim());
    if(g&&!manual){
      if(indexSet_(splitIndexNames_(r[1]))!==indexSet_(g.current))messages.push('제품명: 시트 ['+(r[1]||'없음')+'] / 인덱스 ['+g.current.join(', ')+']');
      if(indexSet_(splitIndexNames_(r[2]))!==indexSet_(g.previous))messages.push('이전제품명: 시트 ['+(r[2]||'없음')+'] / 인덱스 ['+(g.previous.join(', ')||'없음')+']');
      if(indexSet_(splitIndexNames_(r[8]))!==indexSet_(g.companies))messages.push('종이회사: 시트 ['+(r[8]||'없음')+'] / 인덱스 ['+(g.companies.join(', ')||'없음')+']');
    }
    const image=imageFor(paper,splitIndexNames_(r[1]).concat(splitIndexNames_(r[2]),g?g.current.concat(g.previous):[]));
    if(image.warning)messages.push(image.warning);
    if(image.images.length||hasUntaggedErp(r[10])){const urls=mergeImageUrls_(r[10],image.images,cropUrls);if(urls!==String(r[10]||''))updates.push({row:i+2,col:11,value:urls})}
    if(manual)return;
    const status=messages.join('\n');if(status!==String(r[12]||''))updates.push({row:i+2,col:13,value:status});
  });
  groups.forEach((g,paper)=>{if(present.has(paper))return;const image=imageFor(paper,g.current.concat(g.previous)),r=Array(13).fill('');r[0]='LPM-'+String(next++).padStart(3,'0');r[1]=g.current.join('\n');r[2]=g.previous.join('\n');r[7]=g.paper;r[8]=g.companies.join(', ');r[10]=mergeImageUrls_('',image.images,cropUrls);r[11]=false;r[12]=image.warning;additions.push(r);present.add(paper)});
  return {updates,additions,duplicatePapers:Array.from(groups.values()).filter(g=>g.count>1).length,ambiguousImages};
}
