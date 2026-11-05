const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function server(user,meta={count:1,hash:'h1'}){
 const ctx=vm.createContext({console,JSON,Date,CacheService:{getScriptCache:()=>({get:k=>k.endsWith('meta')?JSON.stringify(meta):null})}});
 vm.runInContext(code,ctx);
 ctx.getConfig_=()=>({});ctx.authenticateRequest_=()=>user;ctx.jsonOutput=o=>o;
 ctx.getAllData_=()=>({lpm:[{LPM_ID:'LPM-1',ProductName:'N246',PaperNumber:'SCS677',BasePaperCompany:'원지사',ColorHex:'#fff','내용':'ERP 비고','내용2':'모두 보는 내용'}],specialSpecs:[{SpecialSpec_ID:'S1',PaperNumber:'SCS677'}],patterns:[],emboss:[],sites:[],dataHash:'h1'});
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
 assert.equal(r.dataHash,'h1.b.n','level-specific fingerprint');
 const full=post(server(legacy),{action:'data'});assert.equal(full.lpm[0].PaperNumber,'SCS677');assert.equal(full.user.level,'FULL');
});
test('"not modified" never mixes 상위 and 하위 data',()=>{
 assert.equal(post(server(basic),{action:'data',since:'h1.b.n'}).notModified,true);
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
test('only admins receive the ERP 내용 column; everyone gets 내용2',()=>{
 const full=post(server(legacy),{action:'data'}),basicR=post(server(basic),{action:'data'}),admin=post(server({Email:'ad@x.com',Status:'ADMIN'}),{action:'data'});
 assert.equal(full.lpm[0]['내용'],undefined);assert.equal(basicR.lpm[0]['내용'],undefined);assert.equal(admin.lpm[0]['내용'],'ERP 비고');
 [full,basicR,admin].forEach(r=>assert.equal(r.lpm[0]['내용2'],'모두 보는 내용'));
 assert.equal(full.dataHash,'h1.n');assert.equal(admin.dataHash,'h1');
 assert.equal(post(server(legacy),{action:'data',since:'h1'}).notModified,undefined,'상위 users never reuse the admin copy');
});
test('guest (no login) gets only named LPM rows with photo, names, tabs and color',()=>{
 const ctx=server(null);const g=ctx.guestData_({lpm:[{LPM_ID:'L1',ProductName:'N246',PreviousNames:'OLD',SampleBook:'KY',Category:'SOLID',ColorHex:'#fff',ImageURL:'https://drive.google.com/file/d/1aZ08vjaH3IS2W9JG7ReDKoccOGlXn9m9/view',PaperNumber:'SCS677',BasePaperCompany:'원지사','내용':'ERP','내용2':'메모',SpecOut:true},{LPM_ID:'L2',PaperNumber:'X'},{LPM_ID:'L3',ProductName:'N9',Active:'FALSE'}],patterns:[{ID:'P'}],emboss:[{}],sites:[{}],specialSpecs:[{}],config:{LIBRARY_TITLE:'t',GOOGLE_CLIENT_ID:'secret'},imageVersions:{'1aZ08vjaH3IS2W9JG7ReDKoccOGlXn9m9':'r1',other_drive_file_id_1234567890:'r2'},dataHash:'h'});
 assert.deepEqual(JSON.parse(JSON.stringify(g.lpm)),[{LPM_ID:'L1',ProductName:'N246',PreviousNames:'OLD',SampleBook:'KY',Category:'SOLID',ColorHex:'#fff',ImageURL:'https://drive.google.com/file/d/1aZ08vjaH3IS2W9JG7ReDKoccOGlXn9m9/view'}]);
 assert.equal(g.patterns.length+g.emboss.length+g.sites.length+g.specialSpecs.length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(g.config)),{LIBRARY_TITLE:'t'});
 assert.deepEqual(Object.keys(g.imageVersions),['1aZ08vjaH3IS2W9JG7ReDKoccOGlXn9m9']);
 assert.equal(g.dataHash,'h.g');
});
test('guest GET: not-modified by hash, switch off via CONFIG, never needs login',()=>{
 const mk=cfg=>{const ctx=vm.createContext({console,JSON,Date,CacheService:{getScriptCache:()=>({get:k=>k.endsWith('meta')?JSON.stringify({count:1,hash:'h1'}):null,put(){}})},ContentService:{createTextOutput:t=>({text:t,setMimeType(){return this}}),MimeType:{JSON:'json'}}});vm.runInContext(code,ctx);ctx.getConfig_=()=>cfg;ctx.jsonOutput=o=>o;ctx.getAllData_=()=>({lpm:[{LPM_ID:'L1',ProductName:'N1',PaperNumber:'P'}],dataHash:'h1'});return ctx};
 assert.equal(mk({}).doGet({parameter:{action:'data',since:'h1.g'}}).notModified,true);
 const full=mk({}).doGet({parameter:{action:'data'}});assert.equal(full.lpm[0].PaperNumber,undefined);assert.equal(full.dataHash,'h1.g');
 assert.equal(mk({GUEST_ACCESS:'FALSE'}).doGet({parameter:{action:'data'}}).code,'AUTH_REQUIRED');
});
