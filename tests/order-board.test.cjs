const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function load(){const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/order-board.js'),'utf8'),context);const board=context.OrderBoard;return{...board,computeRegion:(...args)=>JSON.parse(JSON.stringify(board.computeRegion(...args)))}}
const NOW=Date.parse('2026-10-29T10:00:00+09:00');
const data={
 locates:[{code:'10',name:'지역1(지방)'},{code:'20',name:'지역2'}],
 orders:[
  {locate_code:'10',sj_code:'S1',tocomp_code:'T2',tocomp_short:'대일',comp_code:'T2',comp_short:'대일',item:'N1',pattern:'P1',spec_code:'100',spec:'일반',st_code:'100',standard:'4*8',ord_qnty:100,out_qnty:0,express:0,cancel_time:null,order_time:'2026-10-20T09:00:00+09:00',remark1:''},
  {locate_code:'10',sj_code:'S2',tocomp_code:'T1',tocomp_short:'경북',comp_code:'C9',comp_short:'셈초',item:'X',pattern:'X',spec_code:'200',spec:'유광',st_code:'',standard:'4*8',ord_qnty:50,out_qnty:0,express:2,cancel_time:null,order_time:'2026-10-29T09:30:00+09:00',remark1:''},
  {locate_code:'10',sj_code:'S3',tocomp_code:'T1',tocomp_short:'경북',comp_code:'T1',comp_short:'경북',item:'Y',pattern:'Y',spec_code:'100',spec:'일반',st_code:'',standard:'4*8',ord_qnty:5,out_qnty:0,express:0,cancel_time:'2026-10-29T08:00:00+09:00',order_time:null,remark1:''},
  {locate_code:'20',sj_code:'S4',tocomp_code:'T3',tocomp_short:'신태광',comp_code:'T3',comp_short:'신태광',item:'Z',pattern:'Z',spec_code:'100',spec:'일반',st_code:'',standard:'4*8',ord_qnty:8,out_qnty:0,express:0,cancel_time:null,order_time:null,remark1:'부족보충분'}
 ],
 worksheet:[{sj_code:'S1',wk_code:'W1',stock_req:0,stock_wk:0,pd_req:300,mach_no:3,stock_done:null,end_time:null,cancel_time:null}],
 outwait:[
  {sj_code:'S1',mode:2,out_code:'O1',up_code:null,wk_code:null,qnty:10},
  {sj_code:'S2',mode:2,out_code:null,up_code:null,wk_code:null,qnty:25},
  {sj_code:'S2',mode:2,out_code:null,up_code:null,wk_code:null,qnty:25}
 ],
 todaylist:[{id:1,tocomp_code:'T1',comp_code:null,today:'2026-10-29',towhere:'오후 출고'},{id:2,tocomp_code:'T2',comp_code:null,today:'2026-10-31',towhere:null}],
 wkRemark:{S1:'메모'},sdrequest:[],sdOut:{},icc:[],statecomp:[],locatesub:{T2:'포천2'},
 specColor:{'100':16777215,'200':16776960},stColor:{}
};

test('groups customers in ERP order with today labels, states and sums',()=>{
 const items=load().computeRegion(data,'10',NOW);
 assert.deepEqual(items.map(x=>x.type),['comp','order','order','sum','comp','order','sum']);
 const [gb,b,c,gbSum,dy,a,dySum]=items;
 assert.equal(gb.name,'경북');assert.equal(gb.today,'금일');assert.equal(gb.towhere,'오후 출고');
 assert.equal(b.outqnty,'(셈초,50)');assert.equal(b.state.text,'금  일');assert.equal(b.bg,'#ffff00');
 assert.deepEqual(b.stock.chips.map(x=>[x.q,x.n,x.bg]),[[25,2,'#ffff00']]);assert.equal(b.producible,true);
 assert.equal(b.specB,'#00ffff');assert.equal(b.specF,'#000000');
 assert.equal(c.state.text,'취  소');assert.equal(c.bg,'#c0c0c0');
 assert.deepEqual([gbSum.remain,gbSum.stock,gbSum.pd],[50,50,0]);
 assert.equal(dy.name,'대일');assert.equal(dy.today,'31일(토)');assert.equal(dy.locatesub,'포천2');
 assert.equal(a.item,'N1(P1)');assert.equal(a.outqnty,'(110)');assert.equal(a.remark,'메모');assert.equal(a.producible,false);
 assert.deepEqual(a.stock.chips.map(x=>[x.q,x.bg]),[[10,'#00f0f0']]);assert.equal(a.pd.req,300);assert.equal(a.pd.mach,3);
 assert.equal(a.specF,'#808080');assert.equal(a.bg,'#ffffff');
 assert.deepEqual([dySum.remain,dySum.stock,dySum.pd],[100,10,300]);
});

test('regions are separated and recent orders turn cyan',()=>{
 const board=load();
 const other=board.computeRegion(data,'20',NOW);
 assert.deepEqual(other.map(x=>x.type),['comp','order','sum']);assert.equal(other[1].remark,'부족보충분');
 const recent=board.computeRegion({...data,orders:[{...data.orders[0],order_time:'2026-10-29T09:30:00+09:00'}]},'10',NOW);
 assert.equal(recent[1].bg,'#80ffff');
 assert.equal(board.vfpColor(255),'#ff0000');assert.equal(board.vfpColor(16744576),'#8080ff');
});

test('long-idle orders without production are hidden like the ERP procedure',()=>{
 const base={locate_code:'99',tocomp_code:'T9',tocomp_short:'효산LPL',comp_code:'T9',item:'X',pattern:'X',spec_code:'100',spec:'일반',standard:'4*8',ord_qnty:10,out_qnty:0,express:0,cancel_time:null};
 const orders=[
  {...base,sj_code:'OLD',state:'오더접수',ord_date:'2019-03-15T15:00:00+09:00'},
  {...base,sj_code:'OLD_PD',state:'오더접수',ord_date:'2026-02-23T15:00:00+09:00'},
  {...base,sj_code:'OLD_WK',state:'생산지시',ord_date:'2026-02-22T15:00:00+09:00'},
  {...base,sj_code:'NEW',state:'오더접수',ord_date:'2026-10-13T15:00:00+09:00'},
  {...base,sj_code:'BUSY',state:'생산중',ord_date:'2025-01-01T15:00:00+09:00'}
 ];
 const items=load().computeRegion({...data,orders,outwait:[{sj_code:'OLD_PD',mode:1,out_code:null,up_code:null,wk_code:null,qnty:100}],worksheet:[],todaylist:[]},'99',NOW);
 assert.deepEqual(items.filter(x=>x.type==='order').map(x=>x.sj),['OLD_PD','NEW','BUSY']);
 assert.equal(items.find(x=>x.type==='sum').remain,30);
});

test('order board menu and backend routes are wired',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),code=fs.readFileSync(path.join(root,'Code.gs'),'utf8');
 assert.match(html,/<button data-page="orders" data-mobile-label="수주">수주현황판<\/button>/);
 assert.match(html,/<section id="orders" class="page"><div id="orderBoard"><\/div><\/section>/);
 assert.match(html,/<script src="assets\/order-board\.js(\?v=\d+)?"><\/script>/);
 assert.match(html,/else if\(id==='orders'\)renderOrders\(\)/);
 assert.match(html,/classList\.toggle\('orders-mode',id==='orders'\)/,'order board opens without the title/search row');
 assert.match(fs.readFileSync(path.join(root,'assets/order-board.css'),'utf8'),/body\.orders-mode main>\.top\{display:none\}/);
 assert.ok(code.indexOf("body.action==='orderBoardPush'")<code.indexOf('authenticateRequest_(body,cfg)'),'PC push must not need a user session');
 assert.ok(code.indexOf("body.action==='orderBoard'")>code.indexOf("user.Status!=='ADMIN'&&user.Status!=='APPROVED'"),'board data requires an approved user');
});

test('phones get "not modified" for the same data and cached text otherwise',()=>{
 const cache={get:k=>k==='order-board-meta'?JSON.stringify({updatedAt:'2026-10-29T10:00:00+09:00',hash:'h1',chunks:1,parts:1}):null,getAll:()=>({'order-board-raw-0':'{"orders":[],"locates":[{"code":"10"}]}'}),put(){},putAll(){}};
 const context={CacheService:{getScriptCache:()=>cache},renewSessionResponse_:(b,u,r)=>r,jsonOutput:o=>({json:o}),
  ContentService:{createTextOutput:t=>({text:t,setMimeType(){return this}}),MimeType:{JSON:'json'}},
  SpreadsheetApp:{openById:()=>{throw new Error('sheet should not be read when cached')}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'OrderBoard.gs'),'utf8'),context);
 const same=context.orderBoardResponse_({since:'h1'},{});
 assert.equal(same.json.notModified,true);assert.equal(same.json.board,undefined);
 const full=JSON.parse(context.orderBoardResponse_({since:'old'},{}).text);
 assert.equal(full.hash,'h1');assert.equal(full.board.locates[0].code,'10');assert.equal(full.updatedAt,'2026-10-29T10:00:00+09:00');
});

test('push rejects a wrong key before touching the sheet',()=>{
 const context={PropertiesService:{getScriptProperties:()=>({getProperty:()=>'right-key'})},appError_:(m,c)=>Object.assign(new Error(m),{code:c}),
  LockService:{getScriptLock:()=>{throw new Error('should not lock')}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'OrderBoard.gs'),'utf8'),context);
 assert.throws(()=>context.orderBoardPush_({secret:'wrong-key!',board:{orders:[],locates:[]}}),e=>e.code==='ORDER_PUSH_DENIED');
 assert.throws(()=>context.orderBoardPush_({secret:'right-key',board:{}}),e=>e.code==='ORDER_PUSH_INVALID');
});
