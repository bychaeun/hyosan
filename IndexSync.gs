const INDEX_SOURCE={folderId:'1q_c5qhZr8GpOqVf2MK11v9hwlmoHNFuU',fileName:'인덱스코드.XLS'};
const LPM_IMAGE_FOLDER_ID='1TgLqm-7qjsDqtSEXVFnPM3cC9shPxGSR';
const INDEX_COLORS={changed:'#FFF2CC',manual:'#D9EAF7',added:'#D9EAD3',ambiguous:'#FCE5CD',clear:'#FFFFFF'};

// Run once as an account that can edit the sheet and read both Drive folders.
function installIndexSyncTrigger(){
  // Validate and perform the first synchronization before replacing the schedule.
  const result=syncIndexCode();
  const old=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncIndexCode');
  ScriptApp.newTrigger('syncIndexCode').timeBased().everyMinutes(30).create();
  old.forEach(t=>ScriptApp.deleteTrigger(t));
  return result;
}

function syncIndexCode(){
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  let convertedId='';
  try{
    const sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAMES.lpm);
    if(!sheet)throw new Error('HYOSAN_LPM 시트를 찾을 수 없습니다.');
    lpmColumns_(sheet); // Fail before any mutation if the schema is incompatible.
    let sourceRows=null,images=null,sourceId='';
    const errors=[];
    try{
      const file=latestIndexFile_();sourceId=file.getId();
      convertedId=convertIndexWorkbook_(file);
      sourceRows=parseIndexRows_(SpreadsheetApp.openById(convertedId).getSheets()[0].getDataRange().getDisplayValues());
    }catch(e){errors.push('인덱스: '+e.message)}
    try{images=readLpmImages_()}catch(e){errors.push('이미지: '+e.message)}
    const result=reconcileLpmRows_(sheet,sourceRows,images);
    result.ok=errors.length===0;result.errors=errors;result.syncedAt=new Date().toISOString();
    SpreadsheetApp.flush();
    clearLibraryDataCache_();
    PropertiesService.getScriptProperties().setProperties({
      INDEX_LAST_SYNC_AT:result.syncedAt,INDEX_LAST_SOURCE_ID:sourceId,
      INDEX_LAST_RESULT:JSON.stringify(result)
    });
    if(errors.length)throw new Error('일부 동기화 실패 (성공한 항목은 반영됨): '+errors.join(' / '));
    return result;
  }finally{
    if(convertedId)try{Drive.Files.remove(convertedId)}catch(e){console.warn('임시 변환 파일 정리 실패: '+convertedId+' / '+e.message)}
    lock.releaseLock();
  }
}

function latestIndexFile_(){
  const files=DriveApp.getFolderById(INDEX_SOURCE.folderId).getFiles(),candidates=[];
  while(files.hasNext()){
    const file=files.next();
    if(/^인덱스코드\.xlsx?$/i.test(file.getName()))candidates.push(file);
  }
  candidates.sort((a,b)=>b.getLastUpdated().getTime()-a.getLastUpdated().getTime()||a.getId().localeCompare(b.getId()));
  if(candidates.length)return candidates[0];
  // Never silently read an obsolete file outside the configured source folder.
  throw new Error('인덱스 폴더에 인덱스코드.XLS 또는 인덱스코드.xlsx 파일이 없습니다.');
}
function convertIndexWorkbook_(file){
  const converted=Drive.Files.create({name:'__HYOSAN_INDEX_SYNC__'+Date.now(),mimeType:'application/vnd.google-apps.spreadsheet'},file.getBlob(),{fields:'id'});
  if(!converted||!converted.id)throw new Error('인덱스코드 엑셀 변환에 실패했습니다.');
  return converted.id;
}
function parseIndexRows_(values){
  // Existing workbook layout: row 6 onward; A:O name history, P paper, Q company.
  if(values.length<6||!values.some(row=>row.length>=17))throw new Error('인덱스 양식 확인 필요: 6행부터 A:O 제품명, P 종이넘버, Q 종이회사');
  const out=[];
  for(let i=5;i<values.length;i++){
    const row=values[i]||[],cells=row.slice(0,15).map(v=>String(v||'').trim()).filter(Boolean);
    const paper=String(row[15]||'').trim(),company=String(row[16]||'').trim();
    if(!cells.length||indexNorm_(paper)==='SPECOUT')continue;
    const current=splitIndexNames_(cells[cells.length-1]);
    const previous=indexUniqueNames_(cells.slice(0,-1).flatMap(splitIndexNames_)).filter(n=>!current.some(c=>indexNorm_(c)===indexNorm_(n)));
    out.push({paper:paper,company:company,current:current.join('\n'),previous:previous,sourceRow:i+1});
  }
  if(!out.some(row=>indexNorm_(row.paper)))throw new Error('인덱스에서 종이넘버가 있는 제품을 찾지 못했습니다. 엑셀 양식을 확인해 주세요.');
  return out;
}
function readLpmImages_(){
  const files=DriveApp.getFolderById(LPM_IMAGE_FOLDER_ID).getFiles(),images=[];
  while(files.hasNext()){
    const file=files.next();
    if(!/^image\//i.test(file.getMimeType()))continue;
    const paper=file.getName().replace(/\.(?:jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|svg)$/i,'').trim();
    if(paper)images.push({paper:paper,id:file.getId()});
  }
  return images.sort((a,b)=>a.id.localeCompare(b.id));
}
function lpmColumns_(sheet){
  const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0].map(v=>String(v).trim());
  const columns={};
  ['LPM_ID','ProductName','PreviousNames','PaperNumber','BasePaperCompany','ImageURL','Active'].forEach(name=>{
    const matches=headers.map((v,i)=>v===name?i+1:0).filter(Boolean);
    if(matches.length!==1)throw new Error(name+' 열이 없거나 중복되어 있습니다.');
    columns[name]=matches[0];
    if(matches[0]===13)throw new Error('M열이 '+name+' 열입니다. M열을 상태 전용으로 정리한 뒤 실행해 주세요.');
  });
  if(headers[12]&&!['인덱스 변경 내용','자동화 상태'].includes(headers[12]))throw new Error('M열에 기존 항목이 있습니다: '+headers[12]+'. 상태 전용 열인지 확인해 주세요.');
  return columns;
}
function reconcileLpmRows_(sheet,sourceRows,images){
  const cols=lpmColumns_(sheet),width=Math.max(sheet.getLastColumn(),13),last=sheet.getLastRow();
  const values=last>1?sheet.getRange(2,1,last-1,sheet.getLastColumn()).getDisplayValues():[];
  const original=values.map(row=>Array.from({length:width},(_,i)=>row[i]||''));
  const rows=original.map(row=>row.slice()),colors=new Map(),byPaper=new Map();
  const get=(row,key)=>row[cols[key]-1];
  const set=(row,key,value)=>{row[cols[key]-1]=value};
  rows.forEach((row,i)=>{const key=indexNorm_(get(row,'PaperNumber'));if(key)indexMapAdd_(byPaper,key,i)});
  let nextId=rows.reduce((n,row)=>Math.max(n,Number((String(get(row,'LPM_ID')).match(/(\d+)$/)||[])[1]||0)),0)+1;
  const result={ok:true,addedCount:0,updatedCount:0,imageUpdatedCount:0,imageOnlyAddedCount:0,ambiguousCount:0,skippedIndexRows:0};
  const newRow=paper=>{
    const row=Array(width).fill(''),i=rows.length;
    set(row,'LPM_ID','LPM-'+String(nextId++).padStart(3,'0'));set(row,'PaperNumber',paper);set(row,'Active','FALSE');
    rows.push(row);indexMapAdd_(byPaper,indexNorm_(paper),i);colors.set(i,INDEX_COLORS.added);result.addedCount++;
    return i;
  };
  const status=(row,kind,text)=>{
    const prefix='['+kind+'] ';
    const keep=String(row[12]||'').split('\n').filter(line=>line&&!line.startsWith(prefix));
    if(text)keep.push(prefix+text);
    row[12]=keep.join('\n');
  };
  if(sourceRows!==null){
    const groups=new Map();
    sourceRows.forEach(item=>{
      const key=indexNorm_(item.paper);
      if(!key){result.skippedIndexRows++;return}
      indexMapAdd_(groups,key,item);
    });
    groups.forEach((group,key)=>{
      const indices=byPaper.get(key)||[newRow(group[0].paper)];
      indices.forEach(i=>{
        const row=rows[i],before=row.slice(),company=indexCompanyNorm_(get(row,'BasePaperCompany'));
        let matches=group;
        // A paper number may be reused by different manufacturers.
        if(company){
          const same=group.filter(item=>indexCompanyNorm_(item.company)===company);
          if(same.length)matches=same;
        }
        const companies=indexUniqueNames_(matches.map(item=>item.company));
        const companyKeys=new Set(companies.map(indexCompanyNorm_));
        if(companyKeys.size>1||(company&&companyKeys.size===1&&!companyKeys.has(company))){
          status(row,'인덱스','내용 확인 필요 · 같은 종이넘버의 종이회사 충돌: '+companies.join(' / '));
          colors.set(i,INDEX_COLORS.ambiguous);result.ambiguousCount++;return;
        }
        // Preserve manually entered names and their order, including newline-separated exceptions.
        const products=indexUniqueNames_(matches.flatMap(item=>splitIndexNames_(item.current)));
        const previous=indexUniqueNames_(matches.flatMap(item=>item.previous));
        const merge=(old,extra)=>{
          const seen=new Set(splitIndexNames_(old).map(indexNorm_));
          const missing=extra.filter(name=>!seen.has(indexNorm_(name)));
          return missing.length?[String(old||'').trim(),...missing].filter(Boolean).join('\n'):old;
        };
        set(row,'ProductName',merge(get(row,'ProductName'),products));
        set(row,'PreviousNames',merge(get(row,'PreviousNames'),previous));
        if(!company&&companies.length)set(row,'BasePaperCompany',companies[0]);
        const fields=['ProductName','PreviousNames','BasePaperCompany'].filter(name=>get(before,name)!==get(row,name));
        if(fields.length){
          status(row,'인덱스',(i>=original.length?'신규 제품 · 검토 후 Active=TRUE':'자동 보완')+' · '+fields.join(', '));
          if(!colors.has(i))colors.set(i,INDEX_COLORS.changed);
          result.updatedCount++;
        }else if(String(row[12]).includes('[인덱스] 내용 확인 필요')){
          status(row,'인덱스','종이회사 충돌 해소 · 내용 확인 완료');
        }
      });
    });
  }
  if(images!==null){
    const groups=new Map();
    images.forEach(image=>indexMapAdd_(groups,indexNorm_(image.paper),image));
    groups.forEach((group,key)=>{
      if(!key)return;
      const missing=!byPaper.has(key),indices=missing?[newRow(group[0].paper)]:byPaper.get(key);
      if(missing)result.imageOnlyAddedCount++;
      indices.forEach(i=>{
        const row=rows[i],old=get(row,'ImageURL');
        const urls=String(old||'').split(/[\r\n,;|]+/).map(v=>v.trim()).filter(Boolean);
        const ids=new Set(urls.map(lpmDriveId_).filter(Boolean));
        group.forEach(image=>{if(!ids.has(image.id)){urls.push('https://drive.google.com/file/d/'+image.id+'/view');ids.add(image.id)}});
        if(urls.join('\n')!==old){
          set(row,'ImageURL',urls.join('\n'));result.imageUpdatedCount++;
          if(!colors.has(i))colors.set(i,INDEX_COLORS.changed);
        }
        const pending=missing||!get(row,'ProductName')||String(row[12]).includes('[이미지] 내용 확인 필요');
        status(row,'이미지',pending?'내용 확인 필요 · 이미지 추가 완료':'이미지 추가 완료');
        if(pending)colors.set(i,INDEX_COLORS.ambiguous);
      });
    });
  }
  if(sheet.getMaxColumns()<width)sheet.insertColumnsAfter(sheet.getMaxColumns(),width-sheet.getMaxColumns());
  if(sheet.getMaxRows()<rows.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
  sheet.getRange(1,13).setValue('자동화 상태');
  // Write changed cells only: preserve unrelated formulas, formatting and manual content.
  const writable=[...Object.values(cols),13];
  writable.forEach(column=>{
    let start=-1,batch=[];
    const flush=()=>{
      if(start<0)return;
      const range=sheet.getRange(start+2,column,batch.length,1);
      if(column!==cols.Active)range.setNumberFormat('@');
      range.setValues(batch.map(value=>[String(value).startsWith('=')?"'"+value:value])).setWrap(true);
      start=-1;batch=[];
    };
    rows.forEach((row,i)=>{
      if(row[column-1]!==((original[i]||[])[column-1]||'')){
        if(start<0)start=i;
        batch.push(row[column-1]);
      }else flush();
    });
    flush();
  });
  colors.forEach((color,i)=>sheet.getRange(i+2,1,1,width).setBackground(color));
  return result;
}
function lpmDriveId_(url){
  const match=String(url).match(/^https:\/\/(?:drive\.google\.com|drive\.usercontent\.google\.com)\/(?:file\/d\/([^/?#]+)|[^#]*[?&]id=([^&#]+))/i);
  return match?(match[1]||match[2]):'';
}
function indexMapAdd_(map,key,item){if(!key)return;const list=map.get(key)||[];if(!list.includes(item))list.push(item);map.set(key,list)}
function indexUniqueNames_(names){const seen=new Set();return names.filter(name=>{const key=indexNorm_(name);if(!key||seen.has(key))return false;seen.add(key);return true})}
function splitIndexNames_(value){return String(value||'').split(/[\r\n,;|]+/).map(v=>v.trim()).filter(Boolean)}
function indexNorm_(value){return String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase()}
function indexCompanyNorm_(value){return indexNorm_(value).replace(/\(주\)|㈜/g,'')}
function clearLibraryDataCache_(){
  const cache=CacheService.getScriptCache();
  try{const meta=JSON.parse(cache.get(DATA_CACHE_PREFIX+'meta')||'null'),keys=[DATA_CACHE_PREFIX+'meta'];if(meta&&meta.count)for(let i=0;i<meta.count;i++)keys.push(DATA_CACHE_PREFIX+i);cache.removeAll(keys)}catch(e){}
}
