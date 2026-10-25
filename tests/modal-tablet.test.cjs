const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
test('tablet dialog has bounded image rows and close button outside scrolling details',()=>{
 assert.match(html,/grid-template-rows:minmax\(0,55%\) minmax\(0,1fr\)/);
 assert.match(html,/#modal \.img-wrap\{[^}]*height:auto;aspect-ratio:1/);
 assert.match(html,/#modal \.img-wrap\{width:100%;height:100%;aspect-ratio:auto/);
 assert.match(html,/#modal \.img-wrap img\{position:absolute;[^}]*object-fit:cover/);
 assert.match(html,/#modal \.modal>\.close\{position:absolute;z-index:10/);
 assert.match(html,/<\/p><\/div><button class="close" type="button" aria-label="팝업 닫기"/);
 assert.equal(html,fs.readFileSync(__dirname+'/../dist/index.html','utf8'));
});
test('native zoom suppression stays on photo and pointer pinch scales only photo',()=>{
 const listeners={},styles={},wrap={closest:()=>true,addEventListener:(n,f,o)=>listeners[n]={f,o},setPointerCapture(){},clientWidth:400,clientHeight:300,getBoundingClientRect:()=>({left:0,top:0,width:400,height:300}),style:{setProperty:(k,v)=>styles[k]=v}};
 const c=vm.createContext({$:()=>wrap});
 const start=html.indexOf('let modalImageZoom='),end=html.indexOf('function openImageFullView');
 vm.runInContext(html.slice(start,end),c);c.initModalImageGestures(wrap);
 let prevented=0;listeners.touchmove.f({cancelable:true,preventDefault:()=>prevented++});assert.equal(prevented,1);assert.equal(listeners.touchmove.o.passive,false);assert(listeners.gesturestart);
 const event=(id,x)=>({pointerId:id,clientX:x,clientY:100,pointerType:'touch',target:{closest:()=>false}});
 wrap.onpointerdown(event(1,100));wrap.onpointerdown(event(2,200));wrap.onpointermove(event(2,300));assert.equal(styles['--modal-zoom'],2);
});
