const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const context={URL,document:{addEventListener(){}}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/image-recovery.js'),'utf8'),context);
 return context.recoverDriveImage;
}
test('failed thumbnail uses alternate route, retains revision, and stops after two attempts',()=>{
 const recover=setup(),img={tagName:'IMG',isConnected:true,src:'https://drive.google.com/thumbnail?id=test-1&sz=w4096&rev=2'};
 recover(img);assert.equal(img.src,'https://lh3.googleusercontent.com/d/test-1=w1600?rev=2');
 recover(img);assert.equal(img.src,'https://lh3.googleusercontent.com/d/test-1=w800?rev=2');
 const last=img.src;recover(img);assert.equal(img.src,last);
});
test('small previews are not enlarged; changed file starts a new recovery',()=>{
 const recover=setup(),img={tagName:'IMG',isConnected:true,src:'https://drive.google.com/thumbnail?id=test-1&sz=w640'};
 recover(img);assert.match(img.src,/w640$/);
 img.src='https://drive.google.com/thumbnail?id=test-2&sz=w2048';recover(img);assert.match(img.src,/test-2=w1600$/);
});
test('unrelated, detached and non-image failures are ignored',()=>{
 const recover=setup();
 for(const img of [{tagName:'SCRIPT',isConnected:true,src:'https://drive.google.com/thumbnail?id=a'},{tagName:'IMG',isConnected:false,src:'https://drive.google.com/thumbnail?id=a'},{tagName:'IMG',isConnected:true,src:'https://example.com/a.jpg'}]){
 const old=img.src;recover(img);assert.equal(img.src,old);
 }
});
