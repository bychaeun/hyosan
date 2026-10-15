const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/image-share.js'),'utf8');
function setup(supported=true,error=null){
 let shares=0,expire;
 const context={File:class{constructor(b,name,opts){this.name=name;this.type=opts.type}},
 navigator:{canShare:()=>supported,share:()=>{shares++;return error?Promise.reject(error):Promise.resolve()}},
 setTimeout:fn=>{expire=fn},clearTimeout(){}};
 vm.runInNewContext(source,context);
 return {context,get shares(){return shares},expire:()=>expire()};
}
test('opens native sharing immediately without DOM or dialog',async()=>{
 const t=setup(),result=t.context.shareImageBlob({type:'image/png'},'sample.png','a');
 assert.equal(t.shares,1);assert.match(await result,/전달/);
});
test('unsupported sharing explains download fallback without popup',async()=>{
 const t=setup(false);assert.match(await t.context.shareImageBlob({},'a.png','a'),/지원하지/);assert.equal(t.shares,0);
});
test('cancel is not reported as success and cached retry calls share synchronously',async()=>{
 const t=setup(true,{name:'AbortError'});assert.match(await t.context.shareImageBlob({},'a.png','a'),/취소/);
 const result=t.context.shareImageFile(t.context.cachedImageShare('a'));assert.equal(t.shares,2);await result;
});
test('activation failure retains file for retry and rejects changed keys',async()=>{
 const t=setup(true,{name:'NotAllowedError'});assert.match(await t.context.shareImageBlob({},'a.png','a'),/다시/);
 assert.ok(t.context.cachedImageShare('a'));assert.equal(t.context.cachedImageShare('b'),null);
 await t.context.shareImageBlob({},'b.png','b');assert.equal(t.context.cachedImageShare('a'),null);
 t.expire();assert.equal(t.context.cachedImageShare('b'),null);
});
test('concurrent shares do not open multiple native sheets',async()=>{
 const t=setup();let finish;t.context.navigator.share=()=>new Promise(resolve=>finish=resolve);
 const first=t.context.shareImageBlob({},'a.png','a');
 assert.match(await t.context.shareImageFile(t.context.cachedImageShare('a')),/이미/);finish();await first;
});
test('product sharing sends only the image with no product number metadata',async()=>{
 const t=setup();let data;t.context.navigator.share=async value=>data=value;
 await t.context.shareImageBlob({},'N400\nN401.png','product');
 assert.deepEqual(Object.keys(data),['files']);assert.equal(data.files[0].name,'HYOSAN-image.png');
});
test('site image sharing omits title and text, including cached retry',async()=>{
 const t=setup();let data;t.context.navigator.share=async value=>data=value;
 await t.context.shareImageBlob({},'HYOSAN-image.png','site');
 assert.deepEqual(Object.keys(data),['files']);
 await t.context.shareImageFile(t.context.cachedImageShare('site'));
 assert.deepEqual(Object.keys(data),['files']);
});
test('dialog position and focus are restored after native sharing',async()=>{
 const t=setup();let focused,restored=false;
 const dialog={style:{},scrollTop:42,scrollLeft:0,open:true,getAttribute:()=>null,
 getBoundingClientRect:()=>({top:15,left:20,width:600,height:500}),removeAttribute:()=>restored=true};
 t.context.document={querySelector:()=>dialog,activeElement:{isConnected:true,focus:opts=>focused=opts}};
 t.context.navigator.share=async()=>{assert.equal(dialog.style.position,'fixed');dialog.scrollTop=0};
 await t.context.shareImageBlob({},'a.png','a');
 assert.equal(dialog.scrollTop,42);assert.equal(restored,true);assert.equal(focused.preventScroll,true);
});
