const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'('),tail=html.slice(start),end=tail.search(/\r?\n(?:async )?function /);return end<0?tail:tail.slice(0,end)}
test('emboss options and both comparison boards use native closed accordions',()=>{
 assert.match(html,/<details class="composer-settings"><summary>/);for(const g of [0,1])assert.match(html,new RegExp('<details class="composer-candidates" id="composerCandidateBoard'+g+'">'));
 assert.match(html,/grid-template-areas:"controls preview" "candidates preview"/);assert.match(html,/grid-template-areas:"controls" "preview" "candidates"/);
});
test('mobile opens chosen candidate board and closes only its sibling; desktop preserves both',()=>{
 const boards=[{open:false},{open:true}],c=vm.createContext({$:id=>boards[Number(id.at(-1))],matchMedia:()=>({matches:true})});vm.runInContext(fn('openComposerCandidateBoard'),c);c.openComposerCandidateBoard(0);assert.equal(boards[0].open,true);assert.equal(boards[1].open,false);c.matchMedia=()=>({matches:false});c.openComposerCandidateBoard(1);assert.equal(boards[0].open,true);assert.equal(boards[1].open,true);
});
test('mobile preview keeps the same full width before and after choosing a candidate',()=>{
 const calls=[],preview={parentElement:{clientWidth:390},style:{setProperty(){}}},c=vm.createContext({state:{composerActiveCandidate:-1},matchMedia:()=>({matches:true}),innerHeight:844,embossPixelSize:()=>({width:1000,height:1000}),composerBaseCanvas:()=>({}),drawComposerBase:(...args)=>calls.push(args)});vm.runInContext(fn('applyComposerResolution'),c);const base={naturalWidth:2000,naturalHeight:2000};c.applyComposerResolution(base,{},preview,{});const before=[preview.style.width,preview.style.height];c.state.composerActiveCandidate=0;c.applyComposerResolution(base,{},preview,{});assert.deepEqual([preview.style.width,preview.style.height],before);assert.equal(preview.style.width,'390px');assert.equal(preview.style.height,'390px');assert.equal(calls[0][2],1000);assert.equal(calls[0][3],1000);
});
