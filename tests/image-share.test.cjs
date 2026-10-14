const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/image-share.js'),'utf8');
function setup(supported=true,error=null){
 const nodes=Object.fromEntries(['img','[role=status]','.share-confirm','a','.close'].map(k=>[k,{removeAttribute(){}}]));
 let shares=0,revoked=0,close;
 const dialog={setAttribute(){},querySelector:s=>nodes[s],addEventListener:(e,fn)=>close=fn,showModal(){},remove(){},close:()=>close()};
 const context={File:class {constructor(b,name,opts){this.name=name;this.type=opts.type}},navigator:{canShare:()=>supported,share:async()=>{shares++;if(error)throw error}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked++},document:{getElementById:()=>null,createElement:()=>dialog,body:{appendChild(){}}}};
 vm.runInNewContext(source,context);context.openImageShareDialog({type:'image/png'},'sample.png');
 return {nodes,dialog,get shares(){return shares},get revoked(){return revoked}};
}
test('sharing waits for explicit tap and releases blob on close',async()=>{
 const t=setup();assert.equal(t.shares,0);assert.equal(t.nodes.a.download,'sample.png');
 await t.nodes['.share-confirm'].onclick();assert.equal(t.shares,1);assert.equal(t.nodes['.share-confirm'].disabled,false);
 t.dialog.close();assert.equal(t.revoked,1);
});
test('unsupported file sharing leaves download available',()=>{
 const t=setup(false);assert.equal(t.nodes['.share-confirm'].hidden,true);assert.equal(t.nodes.a.href,'blob:test');
 assert.match(t.nodes['[role=status]'].textContent,/지원하지/);
});
test('cancel does not claim delivery and permits retry',async()=>{
 const t=setup(true,{name:'AbortError'});await t.nodes['.share-confirm'].onclick();
 assert.match(t.nodes['[role=status]'].textContent,/취소/);assert.equal(t.nodes['.share-confirm'].disabled,false);
});
