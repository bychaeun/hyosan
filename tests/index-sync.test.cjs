const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context=vm.createContext({console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../IndexSync.gs'),'utf8'),context);
const headers=['LPM_ID','ProductName','PreviousNames','SampleBook','Category','Other','ImageURL','PaperNumber','BasePaperCompany','Active','Custom','Spare','인덱스 변경 내용'];
class Sheet{
  constructor(records=[],names=headers){
    this.data=[names.slice(),...records.map(record=>names.map(name=>record[name]??''))];
    this.maxRows=this.data.length;this.maxColumns=names.length;this.writes=0;this.colors={};
  }
  getLastRow(){return this.data.length}
  getLastColumn(){return this.data[0].length}
  getMaxColumns(){return this.maxColumns}
  getMaxRows(){return this.maxRows}
  insertColumnsAfter(n,count){this.maxColumns+=count}
  insertRowsAfter(n,count){this.maxRows+=count}
  getRange(row,col,height=1,width=1){
    assert.ok(row+height-1<=this.maxRows,'range exceeds row capacity');
    assert.ok(col+width-1<=this.maxColumns,'range exceeds column capacity');
    const sheet=this;
    return {
      getDisplayValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>String(sheet.data[row+i-1]?.[col+j-1]??'')))},
      setValues(values){
        assert.equal(values.length,height);
        for(let i=0;i<height;i++){
          assert.equal(values[i].length,width);
          sheet.data[row+i-1]??=[];
          for(let j=0;j<width;j++)sheet.data[row+i-1][col+j-1]=values[i][j];
        }
        sheet.writes++;return this;
      },
      setValue(value){return this.setValues([[value]])},
      setNumberFormat(){return this},setWrap(){return this},
      setBackground(color){for(let i=0;i<height;i++)sheet.colors[row+i]=color;return this}
    };
  }
  value(row,name){return this.data[row-1][this.data[0].indexOf(name)]??''}
}
const src=(paper,current,previous=[],company='Company')=>({paper,current,previous,company});
const image=(paper,id='file1')=>({paper,id});
const run=(sheet,rows=[],images=[])=>context.reconcileLpmRows_(sheet,rows,images);

test('existing newline names preserved; missing products/history/company and images added',()=>{
  const sheet=new Sheet([{LPM_ID:'LPM-001',ProductName:'Manual A\nManual B',PaperNumber:'001-AB',Active:'TRUE',Custom:'=1+1','인덱스 변경 내용':'사용자 메모'}]);
  const result=run(sheet,[src('001-AB','New',['Old'])],[image('001-AB')]);
  assert.equal(sheet.value(2,'ProductName'),'Manual A\nManual B\nNew');
  assert.equal(sheet.value(2,'PreviousNames'),'Old');
  assert.equal(sheet.value(2,'BasePaperCompany'),'Company');
  assert.equal(sheet.value(2,'Active'),'TRUE');
  assert.equal(sheet.value(2,'Custom'),'=1+1');
  assert.match(sheet.value(2,'ImageURL'),/file1/);
  assert.match(sheet.value(2,'자동화 상태'),/사용자 메모/);
  assert.match(sheet.value(2,'자동화 상태'),/이미지 추가 완료/);
  assert.equal(result.imageUpdatedCount,1);
  const before=JSON.stringify(sheet.data);
  const second=run(sheet,[src('001-AB','New',['Old'])],[image('001-AB')]);
  assert.equal(JSON.stringify(sheet.data),before);
  assert.equal(second.addedCount,0);assert.equal(second.updatedCount,0);assert.equal(second.imageUpdatedCount,0);
});
test('multiple index products with one paper create one row with line breaks and stable ID',()=>{
  const sheet=new Sheet();
  const rows=[src('0001','One',['Old']),src('0001','Two',['Old'])];
  run(sheet,rows,[image('0001')]);
  assert.equal(sheet.getLastRow(),2);assert.equal(sheet.value(2,'ProductName'),'One\nTwo');
  assert.equal(sheet.value(2,'PreviousNames'),'Old');assert.equal(sheet.value(2,'PaperNumber'),'0001');
  assert.equal(sheet.value(2,'Active'),'FALSE');assert.equal(sheet.colors[2],'#D9EAD3');
  const before=JSON.stringify(sheet.data);run(sheet,rows,[image('0001')]);assert.equal(JSON.stringify(sheet.data),before);
});
test('image without sheet paper creates a review row and keeps warning on later runs',()=>{
  const sheet=new Sheet();run(sheet,[],[image('0002')]);
  assert.equal(sheet.value(2,'PaperNumber'),'0002');assert.equal(sheet.value(2,'ProductName'),'');
  assert.equal(sheet.value(2,'Active'),'FALSE');assert.match(sheet.value(2,'자동화 상태'),/내용 확인 필요/);
  run(sheet,[src('0002','Later')],[image('0002')]);
  assert.equal(sheet.getLastRow(),2);assert.equal(sheet.value(2,'ProductName'),'Later');
  assert.match(sheet.value(2,'자동화 상태'),/내용 확인 필요/);
});
test('all existing rows with same paper receive images without merging their IDs',()=>{
  const sheet=new Sheet([{LPM_ID:'LPM-007',PaperNumber:'A',ProductName:'One'},{LPM_ID:'LPM-008',PaperNumber:'A',ProductName:'Two'}]);
  run(sheet,[],[image('A'),image('A','file2')]);
  assert.equal(sheet.getLastRow(),3);assert.equal(sheet.value(2,'LPM_ID'),'LPM-007');
  assert.equal(sheet.value(3,'LPM_ID'),'LPM-008');assert.equal(sheet.value(2,'ImageURL').split('\n').length,2);
  assert.equal(sheet.value(3,'ImageURL'),sheet.value(2,'ImageURL'));
});
test('manufacturer collision is flagged without overwriting manual values',()=>{
  const sheet=new Sheet([{LPM_ID:'LPM-001',PaperNumber:'A',ProductName:'Manual',BasePaperCompany:'Existing'}]);
  const result=run(sheet,[src('A','New',[],'Other')],[image('A')]);
  assert.equal(sheet.value(2,'ProductName'),'Manual');assert.equal(sheet.value(2,'BasePaperCompany'),'Existing');
  assert.match(sheet.value(2,'자동화 상태'),/종이회사 충돌/);assert.equal(result.ambiguousCount,1);
  assert.equal(sheet.colors[2],'#FCE5CD');
});
test('same paper with manufacturers uses matching manufacturer',()=>{
  const sheet=new Sheet([{LPM_ID:'LPM-001',PaperNumber:'A',ProductName:'One',BasePaperCompany:'X'}]);
  run(sheet,[src('A','Two',[],'X'),src('A','Wrong',[],'Y')],[]);
  assert.equal(sheet.value(2,'ProductName'),'One\nTwo');
});
test('blank paper cannot create an unmatched product',()=>{
  const sheet=new Sheet();const result=run(sheet,[src('','Unknown')],[]);
  assert.equal(sheet.getLastRow(),1);assert.equal(result.skippedIndexRows,1);
});
test('existing Drive URL is deduplicated by file ID; unrelated URLs preserved',()=>{
  const sheet=new Sheet([{LPM_ID:'LPM-001',PaperNumber:'A',ImageURL:'https://drive.google.com/thumbnail?id=file1&sz=w1600\nhttps://example.com/image.png'}]);
  run(sheet,[],[image('A')]);assert.equal(sheet.value(2,'ImageURL').split('\n').length,2);
});
test('failed index read still allows images; failed image read preserves prior images/status',()=>{
  const sheet=new Sheet();run(sheet,null,[image('A')]);
  const old=sheet.value(2,'ImageURL');run(sheet,[src('A','New')],null);
  assert.equal(sheet.value(2,'ImageURL'),old);assert.match(sheet.value(2,'자동화 상태'),/이미지 추가 완료/);
});
test('column positions inferred from headers and incompatible M rejected before writes',()=>{
  const names=headers.slice();[names[1],names[7]]=[names[7],names[1]];
  const sheet=new Sheet([],names);run(sheet,[src('A','Name')],[]);
  assert.equal(sheet.value(2,'PaperNumber'),'A');assert.equal(sheet.value(2,'ProductName'),'Name');
  names[12]='Business data';const invalid=new Sheet([],names);
  assert.throws(()=>run(invalid,[],[]),/M열/);assert.equal(invalid.writes,0);
});
test('Excel parser preserves zeros and newlines; skips SPECOUT and rejects unknown format',()=>{
  const row=Array(17).fill('');row[0]='Old';row[2]='One\nTwo';row[15]='0012';row[16]='Company';
  const excluded=row.slice();excluded[15]='SPECOUT';
  const rows=context.parseIndexRows_([[],[],[],[],[],row,excluded]);
  assert.equal(rows.length,1);assert.equal(rows[0].current,'One\nTwo');assert.equal(rows[0].paper,'0012');
  assert.throws(()=>context.parseIndexRows_([['unexpected']]),/양식/);
});
test('image reader uses full paper filename without extension and skips non-images',()=>{
  const files=[['0012.jpg','image/jpeg','1'],['AB.12.PNG','image/png','2'],['notes.pdf','application/pdf','3']];
  let pos=0;
  context.DriveApp={getFolderById(id){assert.equal(id,'1TgLqm-7qjsDqtSEXVFnPM3cC9shPxGSR');return {getFiles(){return {hasNext:()=>pos<files.length,next(){const [name,mime,id]=files[pos++];return {getName:()=>name,getMimeType:()=>mime,getId:()=>id}}}}}}};
  const result=context.readLpmImages_();assert.equal(result.length,2);
  assert.equal(result[0].paper,'0012');assert.equal(result[1].paper,'AB.12');
});

test('complete sync records partial failure, invalidates cache and always cleans up and unlocks',()=>{
  const ctx=vm.createContext({console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../IndexSync.gs'),'utf8'),ctx);
  const sheet=new Sheet();let released=false,removed='',saved,invalidated=false;
  ctx.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){released=true}})};
  ctx.SpreadsheetApp={openById:id=>id==='temporary'?{getSheets:()=>[{getDataRange:()=>({getDisplayValues:()=>[]})}]}:{getSheetByName:()=>sheet},flush(){}};
  ctx.latestIndexFile_=()=>({getId:()=>'source'});
  ctx.convertIndexWorkbook_=()=>'temporary';
  ctx.parseIndexRows_=()=>{throw new Error('bad workbook')};
  ctx.readLpmImages_=()=>[image('A')];
  ctx.clearLibraryDataCache_=()=>{invalidated=true};
  ctx.PropertiesService={getScriptProperties:()=>({setProperties(value){saved=value}})};
  ctx.Drive={Files:{remove(id){removed=id}}};
  assert.throws(()=>ctx.syncIndexCode(),/일부 동기화 실패/);
  assert.equal(sheet.value(2,'PaperNumber'),'A');assert.equal(released,true);assert.equal(removed,'temporary');
  assert.equal(invalidated,true);assert.equal(JSON.parse(saved.INDEX_LAST_RESULT).ok,false);
});
test('trigger replacement follows successful sync and retains other handlers',()=>{
  const ctx=vm.createContext({console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../IndexSync.gs'),'utf8'),ctx);
  const calls=[],old={getHandlerFunction:()=>'syncIndexCode'},other={getHandlerFunction:()=>'other'};
  ctx.syncIndexCode=()=>{calls.push('sync');return {ok:true}};
  ctx.ScriptApp={getProjectTriggers:()=>[old,other],deleteTrigger(t){assert.equal(t,old);calls.push('delete')},newTrigger(name){assert.equal(name,'syncIndexCode');return {timeBased(){return this},everyMinutes(n){assert.equal(n,30);return this},create(){calls.push('create')}}}};
  ctx.installIndexSyncTrigger();assert.deepEqual(calls,['sync','create','delete']);
  calls.length=0;ctx.syncIndexCode=()=>{throw new Error('sync failed')};
  assert.throws(()=>ctx.installIndexSyncTrigger(),/sync failed/);assert.deepEqual(calls,[]);
});
test('newest XLS/XLSX source is selected without fallback to unrelated files',()=>{
  const ctx=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../IndexSync.gs'),'utf8'),ctx);
  const files=[['인덱스코드.XLS',1],['unrelated.xlsx',3],['인덱스코드.xlsx',2]];
  let pos=0;
  ctx.DriveApp={getFolderById:()=>({getFiles:()=>({hasNext:()=>pos<files.length,next(){const [name,time]=files[pos++];return {getName:()=>name,getId:()=>name,getLastUpdated:()=>new Date(time)}}})})};
  assert.equal(ctx.latestIndexFile_().getName(),'인덱스코드.xlsx');
  assert.throws(()=>ctx.latestIndexFile_(),/파일이 없습니다/);
});
