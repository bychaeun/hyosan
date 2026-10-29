const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function server(user,meta={count:1,hash:'h1'}){
 const ctx=vm.createContext({console,JSON,Date,CacheService:{getScriptCache:()=>({get:k=>k.endsWith('meta')?JSON.stringify(meta):null})}});
 vm.runInContext(code,ctx);
 ctx.getConfig_=()=>({});ctx.authenticateRequest_=()=>user;ctx.jsonOutput=o=>o;
 ctx.getAllData_=()=>({lpm:[{LPM_ID:'LPM-1',ProductName:'N246',PaperNumber:'SCS677',BasePaperCompany:'원지사',ColorHex:'#fff'}],specialSpecs:[{SpecialSpec_ID:'S1',PaperNumber:'SCS677'}],patterns:[],emboss:[],sites:[],dataHash:'h1'});
 return ctx;
}
const post=(ctx,body)=>JSON.parse(JSON.stringify(ctx.doPost({postData:{contents:JSON.stringify(body)}})));
const basic={Email:'b@x.com',Status:'APPROVED',Level:'BASIC'},legacy={Email:'a@x.com',Status:'APPROVED',Level:''};

test('existing users without a level stay 상위 and new sign-ups start 하위',()=>{
 const ctx=server(legacy);
 assert.equal(ctx.userLevel_(legacy),'FULL');assert.equal(ctx.userLevel_(basic),'BASIC');assert.equal(ctx.userLevel_({Status:'ADMIN',Level:'BASIC'}),'FULL');
 assert.match(code,/setValue\('BASIC'\);row\.Level='BASIC'/,'new users are written as BASIC');
});
test('하위 users never receive paper numbers or paper companies',()=>{
 const r=post(server(basic),{action:'data'});
 assert.equal(r.user.level,'BASIC');assert.equal(r.lpm[0].PaperNumber,undefined);assert.equal(r.lpm[0].BasePaperCompany,undefined);
 assert.equal(r.specialSpecs[0].PaperNumber,undefined);assert.equal(r.lpm[0].ProductName,'N246');assert.equal(r.lpm[0].ColorHex,'#fff','colorist still works');
 assert.equal(r.dataHash,'h1.b','level-specific fingerprint');
 const full=post(server(legacy),{action:'data'});assert.equal(full.lpm[0].PaperNumber,'SCS677');assert.equal(full.user.level,'FULL');
});
test('"not modified" never mixes 상위 and 하위 data',()=>{
 assert.equal(post(server(basic),{action:'data',since:'h1.b'}).notModified,true);
 assert.equal(post(server(basic),{action:'data',since:'h1'}).notModified,undefined);
 assert.equal(post(server(legacy),{action:'data',since:'h1.b'}).notModified,undefined);
});
test('하위 users cannot open the order board',()=>{
 const ctx=server(basic);ctx.orderBoardResponse_=()=>assert.fail('must not load');
 assert.equal(post(ctx,{action:'orderBoard'}).code,'LEVEL_REQUIRED');
});
test('screen hides the order menu, paper rows and the colour row',()=>{
 assert.match(html,/body\.level-basic \.nav button\[data-page="orders"\]\{display:none\}/);
 assert.match(html,/\(canSeePaper\(\)\?`<div class="meta-pair">\$\{info\('종이 넘버'/);
 assert.doesNotMatch(html,/info\('컬러'/,'colour row removed from the LPM popup');
 assert.match(html,/function renderOrders\(force=false\)\{\r?\n if\(!canSeePaper\(\)\)return;/);
});
