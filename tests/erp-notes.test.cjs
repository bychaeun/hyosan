const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../OrderBoard.gs'),'utf8'),c);
test('ERP notes group items sharing a remark and keep paper, spec-out and index notes',()=>{
 const items=[{paper:'DG3265A',name:'HS8139',remark:'종이소진후 스펙아웃'},{paper:'dg3265a ',name:'HS9131',remark:'종이소진후\n스펙아웃'},{paper:'DG3265A',name:'16762SE',specout:'2025-05-30'},{paper:'DG3265A',name:'X',remark:''}];
 const notes=c.erpNoteLines_(items,[{paper:'DG3265A',remark:'전량사용후 스펙아웃예정'}],[{paper:'DG3265A',name:'조색인쇄지',specOut:'2023-12-31',remark:'실린더폐기'}]).get('DG3265A');
 assert.deepEqual(Array.from(notes),['[ERP] 종이 비고: 전량사용후 스펙아웃예정','[ERP] 스펙아웃 2025-05-30: 16762SE','[ERP] 인덱스 스펙아웃 2023-12-31 (조색인쇄지)','[ERP] 인덱스 비고 (조색인쇄지): 실린더폐기','[ERP] HS8139, HS9131: 종이소진후 스펙아웃']);
});
test('merging replaces only [ERP] lines and leaves hand-written content alone',()=>{
 assert.equal(c.mergeErpNote_('직접 쓴 메모\n[ERP] 예전 비고',['[ERP] 새 비고']),'직접 쓴 메모\n[ERP] 새 비고');
 assert.equal(c.mergeErpNote_(2024,[]),'2024');
 assert.equal(c.mergeErpNote_('',['[ERP] a']),'[ERP] a');
 assert.equal(c.mergeErpNote_('[ERP] 사라진 비고',[]),'');
});
