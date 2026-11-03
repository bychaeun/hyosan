const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../OrderBoard.gs'),'utf8'),c);
test('ERP notes group items sharing a remark and keep paper, spec-out and index notes without labels',()=>{
 const items=[{paper:'DG3265A',name:'HS8139',remark:'종이소진후 스펙아웃'},{paper:'dg3265a ',name:'HS9131',remark:'종이소진후\n스펙아웃'},{paper:'DG3265A',name:'16762SE',specout:'2025-05-30'},{paper:'DG3265A',name:'X',remark:''}];
 const notes=c.erpNoteLines_(items,[{paper:'DG3265A',remark:'전량사용후 스펙아웃예정'}],[{paper:'DG3265A',name:'조색인쇄지',specOut:'2023-12-31',remark:'실린더폐기'},{paper:'DG3265A',remark:'WALNUT & OTHERS'}]).get('DG3265A');
 assert.deepEqual(Array.from(notes),['종이 비고: 전량사용후 스펙아웃예정','스펙아웃 2025-05-30: 16762SE','스펙아웃 2023-12-31 (조색인쇄지)','조색인쇄지: 실린더폐기','WALNUT & OTHERS','HS8139, HS9131: 종이소진후 스펙아웃']);
 assert(!Array.from(notes).some(l=>/\[ERP\]|인덱스 비고/.test(l)));
});
test('one-time move keeps hand-written 내용 lines in 내용2 and drops old [ERP] lines',()=>{
 assert.equal(c.movedManualNote_('직접 쓴 메모\n[ERP] 예전 비고',''),'직접 쓴 메모');
 assert.equal(c.movedManualNote_(2024,'기존 내용2'),'기존 내용2\n2024');
 assert.equal(c.movedManualNote_('[ERP] a\n[ERP] b','유지'),'유지');
 assert.equal(c.movedManualNote_('',''),'');
});
