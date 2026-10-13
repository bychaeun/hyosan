const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8');
test('login catalog never waits for Drive metadata',()=>{
 const ctx=vm.createContext({console,CacheService:{getScriptCache:()=>({})}});
 vm.runInContext(source,ctx);
 ctx.readDataCache_=()=>null;ctx.writeDataCache_=()=>{};ctx.readSheetsBatch_=()=>({});
 ctx.imageVersions_=()=>{throw new Error('Login must not inspect Drive')};
 assert.equal(ctx.getAllData_(false).lpm.length,0);assert.equal(ctx.getAllData_(true).lpm.length,0);
});
test('image endpoint bounds work, denies unrelated IDs and reuses metadata cache',()=>{
 let fetched=0;const saved=new Map(),ctx=vm.createContext({console,CacheService:{getScriptCache:()=>({get:k=>saved.get(k),put:(k,v)=>saved.set(k,v)})}});
 vm.runInContext(source,ctx);ctx.getAllData_=()=>({lpm:Array.from({length:20},(_,i)=>({ImageURL:'https://drive.google.com/uc?id=file'+i}))});
 ctx.imageVersions_=data=>{fetched++;return Object.fromEntries(data.lpm.map(x=>[x.ImageURL.split('=')[1],'100']))};
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.imageVersionBatch_(['private','file1'],false))),{file1:'100'});
 ctx.imageVersionBatch_(['file1'],false);assert.equal(fetched,1);
 assert.equal(Object.keys(ctx.imageVersionBatch_(Array.from({length:20},(_,i)=>'file'+i),false)).length,12);
 assert.ok(source.indexOf("if(body.action==='imageVersions')")>source.indexOf("if(user.Status!=='ADMIN'&&user.Status!=='APPROVED')"));
});
test('metadata checks referenced images once without downloading pixels; retains failures',()=>{
 const requests=[];
 const ctx=vm.createContext({console,ScriptApp:{getOAuthToken:()=> 'test'},UrlFetchApp:{fetchAll(batch){requests.push(...batch);return batch.map(r=>({getResponseCode:()=>r.url.includes('/failed?')?403:200,getContentText:()=>JSON.stringify({modifiedTime:'2026-10-13T00:44:51.704Z'})}))}}});
 vm.runInContext(source,ctx);
 const result=ctx.imageVersions_({emboss:[{ImageURL:'https://drive.google.com/file/d/wave/view\nhttps://drive.google.com/thumbnail?id=failed&sz=w640'}],lpm:[{ImageURL:'https://drive.google.com/uc?id=wave',OtherURL:'https://drive.google.com/uc?id=ignore'}]}, {failed:'old',removed:'old'});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{failed:'old',wave:'1791852291704'});
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.url.includes('fields=modifiedTime')));
});
test('unchanged revisions produce identical URLs; changed revision only changes its image',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const ctx=vm.createContext({URL,liveImageVersions:{},db:{imageVersions:{one:'100',two:'200'}}});
 vm.runInContext(html.slice(html.indexOf('function imageUrl(u)'),html.indexOf('function imageUrls(value)')),ctx);
 const one=ctx.imageUrl('https://drive.google.com/file/d/one/view'),two=ctx.imageUrl('https://drive.google.com/uc?id=two');
 ctx.db.imageVersions.one='101';
 assert.notEqual(ctx.imageUrl(one),one);assert.equal(ctx.imageUrl(two),two);
 assert.equal(ctx.imageUrl('https://example.com/image.jpg'),'https://example.com/image.jpg');
 assert.match(html,/function composerImageUrl[^\n]+modalImageUrl\(imageUrl\(raw\)\)/);
});
