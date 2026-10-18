const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function fn(name){const start=html.search(new RegExp('(?:async )?function '+name+'\\('));const tail=html.slice(start),end=tail.search(/\r?\n(?:async )?function /);return end<0?tail:tail.slice(0,end)}
test('image checks skip recent/duplicate images and stop layout work at six visible files',()=>{
 let layouts=0;const checked=new Map([['recent',Date.now()]]);
 const img=(id,visible=true)=>({src:id,getBoundingClientRect:()=>{layouts++;return {width:10,height:10,top:visible?0:2000,bottom:2010,left:0,right:10}}});
 const images=[img('recent'),img('same',false),img('same'),img('same'),...Array.from({length:100},(_,i)=>img('id'+i))];
 const c=vm.createContext({Date,Set,imageCheckedAt:checked,qa:()=>images,driveFileId:id=>id,innerHeight:800,innerWidth:400});vm.runInContext(fn('visibleImageRefreshIds'),c);
 assert.deepEqual([...c.visibleImageRefreshIds()],['same','id0','id1','id2','id3','id4']);assert.equal(layouts,7);
});
test('bootstrap shares one lazy storage read across both restore paths',async()=>{
 let reads=0;const cache={lpm:[]};const c=vm.createContext({restoreSession:async()=>{},loadCachedData:async()=>{reads++;return cache},resumeRecentTab:async load=>{assert.equal(await load(),cache);return false},resumeSavedSession:async load=>{assert.equal(await load(),cache);return true}});
 vm.runInContext('let accessPromise=null;'+fn('bootstrapAccess'),c);await c.bootstrapAccess();assert.equal(reads,1);
});
test('restoring local catalog does not write it back or mark server approval fresh',()=>{
 const code=fn('startApp');assert(!code.includes('saveCachedData'));assert(!code.includes('lastAccessVerifiedAt=Date.now()'));
});
