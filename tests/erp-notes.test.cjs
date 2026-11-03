const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../OrderBoard.gs'),'utf8'),c);
test('ERP notes group items sharing a remark and keep paper, spec-out and index notes without labels',()=>{
 const items=[{paper:'DG3265A',name:'HS8139',remark:'종이소진후 스펙아웃'},{paper:'dg3265a ',name:'HS9131',remark:'종이소진후\n스펙아웃'},{paper:'DG3265A',name:'16762SE',specout:'2025-05-30'},{paper:'DG3265A',name:'X',remark:''}];
 const notes=c.erpNoteLines_(items,[{paper:'DG3265A',remark:'전량사용후 스펙아웃예정'}],[{paper:'DG3265A',name:'조색인쇄지',specOut:'2023-12-31',remark:'실린더폐기'},{paper:'DG3265A',remark:'WALNUT & OTHERS'}]).get('DG3265A');
 assert.deepEqual(Array.from(notes),['제품명: HS8139, HS9131, 16762SE, X','종이 비고: 전량사용후 스펙아웃예정','스펙아웃 2025-05-30: 16762SE','스펙아웃 2023-12-31 (조색인쇄지)','조색인쇄지: 실린더폐기','WALNUT & OTHERS','HS8139, HS9131: 종이소진후 스펙아웃']);
 assert(!Array.from(notes).some(l=>/\[ERP\]|인덱스 비고/.test(l)));
});
test('product-name line keeps only names missing from ProductName/PreviousNames',()=>{
 const known=c.sheetNameKeys_([['HS8139'],['hs 9131, OLD1\nOLD2']]);
 assert.equal(c.unlistedNamesLine_('제품명: HS8139, HS9131, 16762SE, old2',known),'제품명: 16762SE');
 assert.equal(c.unlistedNamesLine_('제품명: HS8139',known),'');
 assert.equal(c.unlistedNamesLine_('HS8139: 비고',known),'HS8139: 비고');
 assert.equal(c.unlistedNamesLine_('제품명: SM8025I, sm8025j, W06ME',known,c.sheetNameKeys_([['SM8025I']])),'제품명: sm8025j, W06ME');   // 자기 종이넘버만 빼고 다른 종이넘버는 남김
});
