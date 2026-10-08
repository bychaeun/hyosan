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
  let latest=null,latestUpdated=0,files=DriveApp.getFolderById(INDEX_SOURCE.folderId).getFilesByName(INDEX_SOURCE.fileName);
  while(files.hasNext()){
    const file=files.next(),updated=file.getLastUpdated().getTime();
    if(updated>latestUpdated){latest=file;latestUpdated=updated}
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
  const lastRow=sheet.getLastRow(),lastColumn=Math.max(sheet.getLastColumn(),13),headers=sheet.getRange(1,1,1,lastColumn).getDisplayValues()[0],activeColumn=headers.indexOf('Active')+1,values=lastRow>1?sheet.getRange(2,1,lastRow-1,9).getDisplayValues():[];
  if(!activeColumn)throw new Error('Active 열이 필요합니다. 신규 제품을 FALSE로 추가하기 위해 동기화를 중단했습니다.');
  const targets=values.map((row,i)=>({sheetRow:i+2,id:row[0],product:row[1],previous:row[2],paper:row[7],company:row[8]}));
  const aliasMap=new Map(),paperMap=new Map();
  sourceRows.forEach(source=>{
    source.aliases.forEach(alias=>indexMapAdd_(aliasMap,indexNorm_(alias),source));
    indexMapAdd_(paperMap,indexNorm_(source.paper),source);
  });
  const used=new Set(),changed=[],changedNotes=[],manual=[],ambiguous=[];
  targets.forEach(target=>{
    const keys=splitIndexNames_(target.product).concat(splitIndexNames_(target.previous)).map(indexNorm_).filter(Boolean),keySet=new Set(keys),paperMatches=paperMap.get(indexNorm_(target.paper))||[];
    let matched=paperMatches.slice(),paperFirst=!!matched.length;
    if(matched.length){
      const sameCompany=matched.filter(item=>indexCompanyNorm_(item.company)===indexCompanyNorm_(target.company));
      if(sameCompany.length)matched=sameCompany;
      const sharedNames=matched.filter(item=>item.aliases.some(alias=>keySet.has(indexNorm_(alias))));
      if(sharedNames.length)matched=sharedNames;
    }else{
      keys.forEach(key=>(aliasMap.get(key)||[]).forEach(item=>{if(!matched.includes(item))matched.push(item)}));
      if(matched.length>1){const sameCompany=matched.filter(item=>indexCompanyNorm_(item.company)===indexCompanyNorm_(target.company));if(sameCompany.length)matched=sameCompany;}
    }
    if(!matched.length){manual.push(target.sheetRow);return;}
    // Reserve even uncertain matches: a review warning must not create duplicate products.
    matched.forEach(source=>used.add(source));
    const papers=[...new Set(matched.map(item=>indexNorm_(item.paper)))],companies=[...new Set(matched.map(item=>indexCompanyNorm_(item.company)))],diffs=[];
    if(!paperFirst&&papers.length>1){
      ambiguous.push(target.sheetRow);changedNotes.push({row:target.sheetRow,diffs:['제품명은 일치하지만 종이번호 후보가 여러 개입니다: '+matched.map(item=>item.current+' / '+item.paper+' / '+item.company).join('; '),'자동 변경하지 않았습니다. 종이번호를 직접 확인해 주세요.']});return;
    }
    const currentNames=indexUniqueNames_(matched.map(item=>item.current)),previousNames=indexUniqueNames_(matched.flatMap(item=>item.previous)),sourceNames=indexUniqueNames_(currentNames.concat(previousNames)),targetNames=splitIndexNames_(target.product).concat(splitIndexNames_(target.previous)),sourceSet=new Set(sourceNames.map(indexNorm_));
    const missing=sourceNames.filter(name=>!keySet.has(indexNorm_(name))),extra=targetNames.filter(name=>!sourceSet.has(indexNorm_(name)));
    if(paperFirst&&(missing.length||extra.length))diffs.push('같은 종이번호 '+target.paper+' 기준 제품명 확인: 현재 ProductName = '+indexDisplay_(target.product)+' / 인덱스 현재명 = '+currentNames.join(', ')+' / 인덱스 이전명 = '+indexDisplay_(previousNames.join(', ')));
    if(missing.length)diffs.push('시트에 없는 제품넘버: '+missing.join(', ')+' (같은 시리즈인지 확인 후 ProductName에 함께 표기)');
    if(extra.length)diffs.push('인덱스에서 확인되지 않는 기존 제품넘버: '+extra.join(', ')+' (직접 확인, 삭제하지 않음)');
    if(!paperFirst)diffs.push('종이번호: '+indexDisplay_(target.paper)+' → '+matched.map(item=>item.paper).filter((v,i,a)=>a.indexOf(v)===i).join(', ')+' (제품넘버로 찾은 후보, 직접 확인 필요)');
    if(companies.length!==1||companies[0]!==indexCompanyNorm_(target.company))diffs.push('종이회사: '+indexDisplay_(target.company)+' → '+matched.map(item=>item.company).filter((v,i,a)=>a.indexOf(v)===i).join(', '));
    if(paperFirst&&matched.length>1&&!matched.some(item=>item.aliases.some(alias=>keySet.has(indexNorm_(alias)))))diffs.push('같은 종이번호에 여러 인덱스 행이 있습니다. 샘플북/시리즈를 확인해 주세요. 기존 행은 통합하지 않았습니다.');
    if(diffs.length){changed.push(target.sheetRow);changedNotes.push({row:target.sheetRow,diffs:diffs});}
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
    sheet.getRange(startRow,activeColumn,newRows.length,1).setValues(newRows.map(()=>['FALSE']));
    newRows.forEach(row=>changedNotes.push({row:row.row,diffs:['인덱스 신규 제품 · Active=FALSE (검토 후 직접 TRUE로 변경)','현재 제품넘버: '+row.item.current,'이전 제품넘버: '+indexDisplay_(row.item.previous.join(', ')),'종이번호: '+indexDisplay_(row.item.paper),'종이회사: '+indexDisplay_(row.item.company)]}));
    colorIndexRows_(sheet,newRows.map(row=>row.row),lastColumn,INDEX_COLORS.added);
  }
  writeIndexDiffColumn_(sheet,sheet.getLastRow(),changedNotes);
  SpreadsheetApp.flush();
  return {ok:true,sourceFile:INDEX_SOURCE.fileName,sourceCount:sourceRows.length,changedCount:changed.length,manualCount:manual.length,ambiguousCount:ambiguous.length,addedCount:newRows.length,addedIds:newRows.map(row=>row.id),syncedAt:new Date().toISOString()};
}

function indexMapAdd_(map,key,item){if(!key)return;const list=map.get(key)||[];if(!list.includes(item))list.push(item);map.set(key,list);}
function indexUniqueNames_(names){const seen=new Set();return names.filter(name=>{const key=indexNorm_(name);if(!key||seen.has(key))return false;seen.add(key);return true;});}

// Run once when migrating already-added green rows; ordinary sync preserves manual approval.
function hideExistingGreenIndexRows(){
  const sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAMES.lpm),lastRow=sheet.getLastRow();
  if(lastRow<2)return {hiddenCount:0};
  const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0],column=headers.indexOf('Active')+1;
  if(!column)throw new Error('Active 열을 찾을 수 없습니다.');
  const rows=sheet.getRange(2,1,lastRow-1,1).getBackgrounds().map((value,i)=>String(value[0]).toUpperCase()===INDEX_COLORS.added?i+2:0).filter(Boolean);
  if(rows.length)sheet.getRangeList(rows.map(row=>columnLetter_(column)+row)).setValue('FALSE');
  clearLibraryDataCache_();return {hiddenCount:rows.length};
}

function indexDisplay_(value){const text=String(value==null?'':value).trim();return text||'(빈칸)'}
function writeIndexDiffColumn_(sheet,lastRow,entries){
  const column=13,header='인덱스 변경 내용';
  if(sheet.getMaxColumns()<column)sheet.insertColumnsAfter(sheet.getMaxColumns(),column-sheet.getMaxColumns());
  sheet.getRange(1,column).setValue(header);
  if(lastRow<2)return;
  const values=Array.from({length:lastRow-1},()=>['']);
  entries.forEach(entry=>{values[entry.row-2][0]=entry.diffs.join('\n')});
  sheet.getRange(2,column,lastRow-1,1).setValues(values).setWrap(true);
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
