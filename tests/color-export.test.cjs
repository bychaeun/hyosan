const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function setup(file,urls=['one','two','three']){
 const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
 const start=html.indexOf('async function saveColorRecommendations(){');
 const fn=html.slice(start,html.indexOf('\nfunction renderColor()',start));
 const ui=html.split('\n').find(line=>line.startsWith('function updateColorSelectionUi('));
 const items=urls.map((url,i)=>({LPM_ID:String(i),ProductName:'Product '+i,ImageURL:url}));
 const positions=[],requests=[],downloads=[],button={},status={},ctx={fillRect(){},fillText(){}};
 const canvas={getContext:()=>ctx,toBlob:cb=>cb({})};
 const sandbox={state:{selectedColorLpmIds:new Set(items.map(i=>i.LPM_ID))},indexes:{lpm:new Map(items.map(i=>[i.LPM_ID,i]))},
  $:id=>id==='#saveColorRecommendations'?button:id==='#colorSaveStatus'?status:id==='#colorExportTitle'?{value:''}:null,
  document:{createElement:()=>canvas},composerImageUrl:url=>url,
  loadComposerExportImage:async(url,size)=>{requests.push({url,size});return {url}},
  drawCoverImage:(ctx,img,x,y)=>positions.push({url:img.url,x,y}),fitCanvasText(){},
  URL:{createObjectURL:()=> 'blob:result',revokeObjectURL(){}},triggerImageDownload:(...args)=>downloads.push(args),setTimeout(){}};
 vm.createContext(sandbox);vm.runInContext(ui+'\n'+fn,sandbox);
 return {sandbox,positions,requests,downloads,button,status,canvas};
}
for(const file of ['index.html','dist/index.html']){
 test(file+': preserves 1–4 item order/layout and releases canvas',async()=>{
  for(let n=1;n<=4;n++){
   const t=setup(file,Array.from({length:n},(_,i)=>'image'+i));await t.sandbox.saveColorRecommendations();
   assert.equal(t.positions.length,n);assert.equal(t.downloads.length,1);
   assert.deepEqual(t.positions.map(p=>p.url),Array.from({length:n},(_,i)=>'image'+i));
   assert.equal(t.positions[0].x,n===1?250:60);
   if(n>=3){assert.equal(t.positions[2].x,t.positions[0].x);assert.ok(t.positions[2].y>t.positions[0].y);}
   if(n===4){assert.equal(t.positions[3].x,t.positions[1].x);assert.equal(t.positions[3].y,t.positions[2].y);}
   assert.equal(t.requests[0].size,n===1?1100:728);
   assert.equal(t.canvas.width,0);assert.equal(t.canvas.height,0);
   assert.match(t.status.textContent,/저장했습니다/);assert.equal(t.button.disabled,false);
  }
 });
 test(file+': parallel loading deduplicates requests and blocks a second export',async()=>{
  const t=setup(file,['one','two','one']),pending=[];
  t.sandbox.loadComposerExportImage=(url,size)=>new Promise(resolve=>pending.push({url,size,resolve}));
  const saving=t.sandbox.saveColorRecommendations();assert.equal(pending.length,2);assert.equal(t.button.disabled,true);
  await t.sandbox.saveColorRecommendations();assert.equal(pending.length,2);
  pending[1].resolve({url:'two'});pending[0].resolve({url:'one'});await saving;
  assert.deepEqual(t.positions.map(p=>p.url),['one','two','one']);assert.equal(t.downloads.length,1);
 });
 test(file+': failed image preserves error, unlocks button, permits retry',async()=>{
  const t=setup(file);
  t.sandbox.loadComposerExportImage=async()=>{throw Error('image access denied')};
  await t.sandbox.saveColorRecommendations();assert.match(t.status.textContent,/image access denied/);
  assert.equal(t.button.disabled,false);assert.equal(t.sandbox.state.colorExportBusy,false);assert.equal(t.downloads.length,0);
  t.sandbox.loadComposerExportImage=async url=>({url});await t.sandbox.saveColorRecommendations();assert.equal(t.downloads.length,1);
 });
}
