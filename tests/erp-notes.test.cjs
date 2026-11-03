const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../OrderBoard.gs'),'utf8'),c);
test('ERP notes keep only the product list spec-out and remark columns, grouping names that share a remark',()=>{
 const items=[{paper:'14-10233-001',name:'N704',remark:'X'},{paper:'14-10233-001',name:'수입N711',remark:'아트텍'},{paper:'14-10233-001',name:'HS9437',remark:''},{paper:'DG3265A',name:'HS8139',remark:'종이소진후 스펙아웃'},{paper:'dg3265a ',name:'HS9131',remark:'종이소진후\n스펙아웃'},{paper:'DG3265A',name:'16762SE',specout:'2025-05-30'}];
 const notes=c.erpNoteLines_(items);
 assert.deepEqual(Array.from(notes.get('14-10233-001')),['N704: X','수입N711: 아트텍']);
 assert.deepEqual(Array.from(notes.get('DG3265A')),['스펙아웃 2025-05-30: 16762SE','HS8139, HS9131: 종이소진후 스펙아웃']);
 assert(!Array.from(notes.values()).flat().some(l=>/^제품명:|\[ERP\]|인덱스 비고/.test(l)));
});
