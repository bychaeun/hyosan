const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),code=fs.readFileSync(path.join(root,'Code.gs'),'utf8')+'\n'+fs.readFileSync(path.join(root,'OrderBoard.gs'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function fn(name){const start=html.search(new RegExp('function '+name+'\\('));const tail=html.slice(start),end=tail.search(/\r?\n(?:async )?function /);return end<0?tail:tail.slice(0,end)}
function server(user,cache={}){
 const ctx=vm.createContext({console,JSON,Date,CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,getAll:keys=>Object.fromEntries(keys.map(k=>[k,cache[k]])),putAll(){}})},
  ContentService:{createTextOutput:t=>({text:t,setMimeType(){return this}}),MimeType:{JSON:'json'}}});
 vm.runInContext(code,ctx);
 ctx.getConfig_=()=>({});ctx.authenticateRequest_=()=>user;ctx.jsonOutput=o=>o;
 return ctx;
}
const post=(ctx,body)=>ctx.doPost({postData:{contents:JSON.stringify(body)}});
const full={Email:'a@x.com',Status:'APPROVED',Level:''},basic={Email:'b@x.com',Status:'APPROVED',Level:'BASIC'};
const stock={papers:{KY149G:{stock:161552,rolls:31}},lpm:{KY149G:[{s:'일반',t:'4*8',q:3399}]}};

test('only paper numbers in the HYOSAN_LPM sheet are asked for',()=>{
 const ctx=server(full);
 ctx.getAllData_=()=>({lpm:[{PaperNumber:' ky149g '},{PaperNo:'SCS677\n1016-355B'},{PaperNumber:'-'},{PaperNumber:''},{PaperNumber:'KY149G'}]});
 assert.equal(JSON.stringify(ctx.stockPapers_()),'["1016-355B","KY149G","SCS677"]');
});
test('하위 users cannot read stock',()=>{
 const ctx=server(basic);ctx.stockResponse_=()=>assert.fail('must not load');
 assert.equal(post(ctx,{action:'stock'}).code,'LEVEL_REQUIRED');
});
test('상위 users get stock, then "not modified" while it is unchanged',()=>{
 const json=JSON.stringify(stock),cache={'stock-meta':JSON.stringify({updatedAt:'2026-10-29T06:54:00Z',hash:'s1',chunks:1,parts:1}),'stock-raw-0':json};
 const ctx=server(full,cache);
 const r=JSON.parse(post(ctx,{action:'stock'}).text);
 assert.equal(r.hash,'s1');assert.equal(r.stock.papers.KY149G.stock,161552);
 const again=post(ctx,{action:'stock',since:'s1'});
 assert.equal(again.notModified,true);assert.equal(again.stock,undefined);
});
test('popup shows stock under the sheet text, and nothing for 하위 users',()=>{
 assert.match(html,/info\('내용',[^\n]*\+stockBox\(x\)\)/,'stock sits inside 내용 after the sheet text');
 const c=vm.createContext({auth:{user:{level:'FULL'}},esc:s=>String(s),paperNumber:x=>x.PaperNumber||'',loadStock(){},stockData:null,stockFailed:false,stockCheckedAt:0,stockUpdatedAt:''});
 vm.runInContext('let stockData=null,stockFailed=false,stockCheckedAt=0,stockUpdatedAt="";const stockKey=v=>String(v||"").normalize("NFKC").trim().replace(/\\s+/g,"").toUpperCase();'+fn('canSeePaper')+'\n'+fn('stockHtml')+'\n'+fn('stockBox')+';this.setStock=s=>{stockData=s;stockCheckedAt=1}',c);
 assert.equal(c.stockBox({PaperNumber:'-'}),'');
 assert.match(c.stockBox({PaperNumber:'ky149g'}),/재고 확인 중/);
 c.setStock(stock);
 const box=c.stockBox({PaperNumber:'ky149g'});
 assert.match(box,/data-paper="KY149G"/);assert.match(box,/161,552/);assert.match(box,/3,399매/);
 assert.match(c.stockBox({PaperNumber:'NOTEXIST'}),/종이 재고<\/span><span class="muted">없음/);
 c.auth.user.level='BASIC';assert.equal(c.stockBox({PaperNumber:'KY149G'}),'');
});
