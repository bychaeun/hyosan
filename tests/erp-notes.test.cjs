const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../OrderBoard.gs'),'utf8'),c);
test('ERP notes list product names, then only the product list spec-out and remark columns',()=>{
 const items=[{paper:'14-10233-001',name:'N704',remark:'X'},{paper:'14-10233-001',name:'수입N711',remark:'아트텍'},{paper:'14-10233-001',name:'HS9437',remark:''},{paper:'DG3265A',name:'HS8139',remark:'종이소진후 스펙아웃'},{paper:'dg3265a ',name:'HS9131',remark:'종이소진후\n스펙아웃'},{paper:'DG3265A',name:'16762SE',specout:'2025-05-30'}];
 const notes=c.erpNoteLines_(items);
 assert.deepEqual(Array.from(notes.get('14-10233-001')),['제품명: N704, 수입N711, HS9437','N704: X','수입N711: 아트텍']);
 assert.deepEqual(Array.from(notes.get('DG3265A')),['제품명: HS8139, HS9131, 16762SE','스펙아웃 2025-05-30: 16762SE','HS8139, HS9131: 종이소진후 스펙아웃']);
 assert(!Array.from(notes.values()).flat().some(l=>/\[ERP\]|인덱스 비고|종이 비고/.test(l)));
});
test('product-name line drops only names overlapping the row ProductName/PreviousNames/paper number',()=>{
 const row=c.sheetNameKeys_([['SM8025I','HS8139','hs 9131, OLD1\nOLD2']]);   // 그 행의 종이넘버·제품명·이전 이름
 assert.equal(c.unlistedNamesLine_('제품명: HS8139, HS9131, 16762SE, old2',row),'제품명: 16762SE');
 assert.equal(c.unlistedNamesLine_('제품명: HS8139',row),'');
 assert.equal(c.unlistedNamesLine_('HS8139: 비고',row),'HS8139: 비고');
 assert.equal(c.unlistedNamesLine_('제품명: SM8025I, sm8025j, W06ME',row),'제품명: sm8025j, W06ME');   // 자기 종이넘버만 빼고 다른 종이넘버는 남김
});
