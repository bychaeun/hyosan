const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('all newline product aliases and history resolve to the same LPM in relations',()=>{
  const ctx=vm.createContext({console,CacheService:{getScriptCache:()=>({})}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8'),ctx);
  ctx.readDataCache_=()=>null;ctx.writeDataCache_=()=>{};
  ctx.readSheetsBatch_=()=>({
    PATTERN_DESIGN:[{ID:'P-1',PatternName_KR:'Pattern'}],
    HYOSAN_LPM:[{LPM_ID:'LPM-785',ProductName:'N686\nN724\nN693',PreviousNames:'S100\nS101'}],
    EMBOSS_PLATE:[{EmbossPlate_ID:'E-1',PlateName:'Plate'}],
    RELATIONS:[{Pattern_Name:'Pattern',LPM_ProductName:'N724',EmbossPlate_Name:'Plate'},
      {Pattern_Name:'Pattern',LPM_ProductName:'S101',EmbossPlate_Name:'Plate'}]
  });
  const result=ctx.getAllData_(true);
  assert.equal(result.lpm[0].RelatedPattern_IDs,'P-1');
  assert.equal(result.lpm[0].EmbossPlate_IDs,'E-1');
  assert.equal(result.patterns[0].RelatedLPM_IDs,'LPM-785');
});
