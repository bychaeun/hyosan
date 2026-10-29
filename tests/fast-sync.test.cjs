const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function fn(name){const start=html.search(new RegExp('(?:async )?function '+name+'\\('));const tail=html.slice(start),end=tail.search(/\r?\n(?:async )?function /);return end<0?tail:tail.slice(0,end)}
function server(meta){
 const ctx=vm.createContext({console,JSON,Date,CacheService:{getScriptCache:()=>({get:k=>k.endsWith('meta')?JSON.stringify(meta):null})},ContentService:{createTextOutput:t=>({text:t,setMimeType(){return this}}),MimeType:{JSON:'json'}}});
 vm.runInContext(code,ctx);
 ctx.getConfig_=()=>({});ctx.authenticateRequest_=()=>({Email:'staff',Status:'APPROVED'});ctx.jsonOutput=o=>o;
 return ctx;
}
const post=(ctx,body)=>ctx.doPost({postData:{contents:JSON.stringify(body)}});

test('same catalog answers "not modified" without reading sheets',()=>{
 const ctx=server({count:1,hash:'h1'});ctx.getAllData_=()=>assert.fail('catalog must not be read');
 const r=post(ctx,{action:'data',since:'h1'});
 assert.equal(r.notModified,true);assert.equal(r.user.email,'staff');assert.equal(r.lpm,undefined);
});
test('changed catalog or forced refresh still sends full data',()=>{
 const ctx=server({count:1,hash:'h2'});let reads=0;ctx.getAllData_=()=>{reads++;return {lpm:[],dataHash:'h2'}};
 assert.deepEqual(post(ctx,{action:'data',since:'h1'}).lpm,[]);
 assert.deepEqual(post(ctx,{action:'data',since:'h2',force:true}).lpm,[]);
 assert.equal(reads,2);
});
test('repeat Google login within 6 hours skips the sheet lock and write',()=>{
 const ctx=server({});const known={Email:'staff@x.com',Name:'Staff',PictureURL:'p',Status:'APPROVED',LastLoginAt:new Date(Date.now()-3600e3).toISOString()};
 ctx.readUsers_=()=>[known];ctx.LockService={getScriptLock:()=>assert.fail('must not lock')};
 assert.equal(ctx.touchUser_({email:'Staff@x.com',name:'Staff',picture:'p'},{ADMIN_EMAIL:'boss@x.com'}),known);
 known.LastLoginAt=new Date(Date.now()-7*3600e3).toISOString();let locked=false;
 ctx.LockService={getScriptLock:()=>{locked=true;throw new Error('stop')}};
 assert.throws(()=>ctx.touchUser_({email:'staff@x.com',name:'Staff',picture:'p'},{}),/stop/);assert.equal(locked,true);
});
test('phone keeps its catalog when the server says nothing changed',async()=>{
 let rebuilt=0,sent=null,status='';
 const c=vm.createContext({console,Date,JSON,CONFIG:{API_URL:'x'},DATA_KEYS:['lpm'],auth:{sessionToken:'s',user:null},
  apiPost:async(a,extra)=>{sent=extra;return {ok:true,notModified:true,user:{email:'staff'}}},setStatus:(t,k)=>{status=k},startImageRefresh(){},
  rebuildIndexes:()=>rebuilt++,renderActive(){},saveCachedData(){},isTransientError:()=>false,clearSession(){}});
 vm.runInContext('let syncPromise=null,appStarted=true,lastPayloadText="",lastAccessVerifiedAt=0,db={lpm:[1],dataHash:"h1"};'+fn('syncData'),c);
 await c.syncData();
 assert.equal(JSON.stringify(sent),'{"since":"h1"}');assert.equal(rebuilt,0);assert.equal(status,'ok');assert.equal(c.auth.user.email,'staff');
});
