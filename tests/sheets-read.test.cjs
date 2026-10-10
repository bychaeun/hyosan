const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('native Sheets read preserves displayed paper numbers and aliases without REST API',()=>{
  let opens=0,reads=0;
  const ctx=vm.createContext({console,
    UrlFetchApp:{fetch(){throw new Error('Disabled REST API must not be called')}},
    SpreadsheetApp:{openById(){opens++;return {getSheetByName(name){
      if(name==='missing')return null;
      return {getLastRow:()=>name==='empty'?1:4,getLastColumn:()=>3,
        getRange(...range){reads++;assert.deepEqual(range,[1,1,4,3]);return {
          getDisplayValues:()=>[['PaperNumber','ProductName','Active'],['0012','N1\nN2','TRUE'],['','',''],['12','N3','FALSE']]
        }}};
    }}}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8'),ctx);
  const result=JSON.parse(JSON.stringify(ctx.readSheetsBatch_(['products','missing','empty','products'])));
  assert.equal(opens,1);assert.equal(reads,1);
  assert.deepEqual(result,{products:[{PaperNumber:'0012',ProductName:'N1\nN2',Active:'TRUE'},{PaperNumber:'12',ProductName:'N3',Active:'FALSE'}],missing:[],empty:[]});
});
