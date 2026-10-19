const {test}=require('node:test'),assert=require('node:assert/strict');
const core=()=>import('../assets/photo-color-core.mjs');
test('photo correction raises RGB by ten percent once, clamps whites and retains area weights',async()=>{const {brightenPalette,lab,rank}=await core();const original=[{hex:'#646464',lab:lab({r:100,g:100,b:100}),weight:.8},{hex:'#FAFAFA',weight:.2}];const corrected=brightenPalette(original);assert.equal(corrected[0].hex,'#6E6E6E');assert.equal(corrected[1].hex,'#FFFFFF');assert.equal(corrected[0].weight,.8);assert.equal(original[0].hex,'#646464');const entries=[{item:{LPM_ID:'corrected'},lab:corrected[0].lab},{item:{LPM_ID:'original'},lab:original[0].lab}];assert.equal(rank(entries,corrected)[0].LPM_ID,'corrected');assert.equal(rank(entries,corrected)[0].LPM_ID,'corrected');assert.equal(corrected[0].hex,'#6E6E6E')});
test('dominant pale base wins over dark accents, and recommendations use that base only',async()=>{
 const {extractPalette,rank,lab}=await core();const pixels=[];
 for(let i=0;i<100;i++){const v=i<70?210+(i%3)*8:25;pixels.push(v,v,v,255)}
 const palette=extractPalette(new Uint8ClampedArray(pixels));assert(palette[0].weight>.65);assert(palette[0].lab.L>80);
 const entries=[{item:{LPM_ID:'base'},lab:palette[0].lab},{item:{LPM_ID:'shadow'},lab:lab({r:25,g:25,b:25})}];
 const rows=rank(entries,palette.slice().reverse());assert.equal(rows[0].LPM_ID,'base');assert.equal(rows[0]._photoScore,100);
});
test('whole-photo palette preserves proportions and ignores transparent pixels',async()=>{
 const {extractPalette}=await core(),pixels=new Uint8ClampedArray([255,0,0,255,255,0,0,255,255,0,0,255,0,0,255,255,0,255,0,0]);
 const p=extractPalette(pixels);assert.equal(p.length,2);assert.equal(p[0].hex,'#FF0000');assert.equal(p[0].weight,.75);assert.equal(p[1].weight,.25);
});
test('no visible pixels returns a recoverable error',async()=>{const {extractPalette}=await core();assert.throws(()=>extractPalette(new Uint8ClampedArray(4)),/색상/)});
test('manual category restricts recommendations before color ranking; search entries remain scoped',async()=>{
 const {rank,lab}=await core();const red=lab({r:255,g:0,b:0}),blue=lab({r:0,g:0,b:255});
 const entries=[{item:{LPM_ID:'1',Category:'WOOD'},lab:red},{item:{LPM_ID:'2',Category:'WOOD'},lab:blue},{item:{LPM_ID:'3',Category:'MARBLE'},lab:red}];
 const rows=rank(entries,[{lab:red,weight:1}],'WOOD');assert.deepEqual(rows.map(x=>x.LPM_ID),['1','2']);assert.equal(rows[0]._photoScore,100);assert(rows[1]._photoScore<100);assert.equal(rank(entries,[{lab:red,weight:1}],'FABRIC').length,0);
});
test('marble stays separate and custom sheet categories are retained',async()=>{const {category}=await core();assert.equal(category('MARBLE').code,'MARBLE');assert.equal(category('FABRIC').label,'패브릭');assert.equal(category('CUSTOM').code,'CUSTOM');assert.equal(category('').label,'미분류')});
test('photo modules never upload or download a model',()=>{const fs=require('node:fs');for(const name of ['photo-color.mjs','photo-color-core.mjs']){const s=fs.readFileSync(require('node:path').join(__dirname,'../assets',name),'utf8');assert(!/fetch\(|XMLHttpRequest|sendBeacon|transformers|huggingface/.test(s))}});
