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
  const lastRow=sheet.getLastRow(),lastColumn=Math.max(sheet.getLastColumn(),13),values=lastRow>1?sheet.getRange(2,1,lastRow-1,9).getDisplayValues():[];
  const targets=values.map((row,i)=>({sheetRow:i+2,id:row[0],product:row[1],previous:row[2],paper:row[7],company:row[8]}));
  const aliasMap=new Map();
  sourceRows.forEach(source=>source.aliases.forEach(alias=>{const key=indexNorm_(alias),list=aliasMap.get(key)||[];list.push(source);aliasMap.set(key,list)}));
  const used=new Set(),changed=[],changedNotes=[],manual=[],ambiguous=[];
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
      const oldPrevious=splitIndexNames_(target.previous).map(indexNorm_).filter(Boolean).sort().join('|'),newPrevious=source.previous.map(indexNorm_).filter(Boolean).sort().join('|'),diffs=[];
      if(indexNorm_(target.product)!==indexNorm_(source.current))diffs.push('제품명: '+indexDisplay_(target.product)+' → '+indexDisplay_(source.current));
      if(oldPrevious!==newPrevious)diffs.push('이전 제품명: '+indexDisplay_(target.previous)+' → '+indexDisplay_(source.previous.join(', ')));
      if(indexNorm_(target.paper)!==indexNorm_(source.paper))diffs.push('종이번호: '+indexDisplay_(target.paper)+' → '+indexDisplay_(source.paper));
      if(indexCompanyNorm_(target.company)!==indexCompanyNorm_(source.company))diffs.push('종이회사: '+indexDisplay_(target.company)+' → '+indexDisplay_(source.company));
      if(diffs.length){changed.push(target.sheetRow);changedNotes.push({row:target.sheetRow,diffs:diffs})}
    }else if(!matched.length)manual.push(target.sheetRow);else ambiguous.push(target.sheetRow);
  });
  clearOldIndexStatusColors_(sheet,lastRow,lastColumn);
  colorIndexRows_(sheet,changed,lastColumn,INDEX_COLORS.changed);
  colorIndexRows_(sheet,manual,lastColumn,INDEX_COLORS.manual);
  colorIndexRows_(sheet,ambiguous,lastColumn,INDEX_COLORS.ambiguous);
  writeIndexDiffColumn_(sheet,lastRow,changedNotes);
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
