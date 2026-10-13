const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8');
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
 const ctx=vm.createContext({URL,db:{imageVersions:{one:'100',two:'200'}}});
 vm.runInContext(html.slice(html.indexOf('function imageUrl(u)'),html.indexOf('function imageUrls(value)')),ctx);
 const one=ctx.imageUrl('https://drive.google.com/file/d/one/view'),two=ctx.imageUrl('https://drive.google.com/uc?id=two');
 ctx.db.imageVersions.one='101';
 assert.notEqual(ctx.imageUrl(one),one);assert.equal(ctx.imageUrl(two),two);
 assert.equal(ctx.imageUrl('https://example.com/image.jpg'),'https://example.com/image.jpg');
 assert.match(html,/function composerImageUrl[^\n]+modalImageUrl\(imageUrl\(raw\)\)/);
});
