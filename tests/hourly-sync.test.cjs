const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({console});vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../automation/HourlyIndexSync.gs'),'utf8'),c);
const row=(paper='CR120-W-11',product='N916\nN711\nN727',images='https://drive.google.com/file/d/old/view')=>['LPM-001',product,'N704','','','','',paper,'Company','',images,'TRUE',''];
const src=(paper='CR120-W-11',current='N916')=>({paper,current,previous:['N704'],company:'Company'});
const image=(key,id)=>({key,id,url:'https://drive.google.com/thumbnail?id='+id+'&sz=w1600'});
test('numbered product/paper images append in order, retain originals and deduplicate Drive IDs',()=>{
 const images=[image('N916_02','two'),image('CR120-W-11_01','one'),image('N916_01','old')],r=row();
 const p=c.planIndexSync_([r],[src()],images),update=p.updates.find(u=>u.col===11);assert(update);assert.equal(update.value.split('\n').length,3);assert.equal(update.value.split('\n')[0],r[10]);assert(update.value.indexOf('one')<update.value.indexOf('two'));assert.equal(p.additions.length,0);
 r[10]=update.value;assert.equal(c.planIndexSync_([r],[src()],images).updates.filter(u=>u.col===11).length,0);
});
test('aliases and previous names link images while existing product/history text remains untouched',()=>{
 const r=row(),before=JSON.stringify(r);const p=c.planIndexSync_([r],[src()], [image('N711_01','alias'),image('N704_02','previous')]);assert.equal(JSON.stringify(r),before);assert.equal(p.updates.filter(u=>u.col!==11&&u.col!==13).length,0);assert.match(p.updates.find(u=>u.col===11).value,/alias/);assert.match(p.updates.find(u=>u.col===11).value,/previous/);
});
test('exact registered identifiers ending in _01 are not mistaken for image numbering',()=>{
 const p=c.planIndexSync_([row('P_01','N_01')],[src('P_01','N_01')],[image('P_01','exact')]);assert.match(p.updates.find(u=>u.col===11).value,/exact/);assert.equal(p.additions.length,0);
});
test('ambiguous product names cannot attach images to unrelated papers',()=>{
 const p=c.planIndexSync_([row('P1','N1'),row('P2','N1')],[],[image('N1_01','ambiguous')]);assert.equal(p.updates.filter(u=>u.col===11).length,0);assert.match(p.updates.find(u=>u.col===13).value,/여러 종이넘버/);
});
test('new rows grouped by paper remain hidden and contain newline-separated image URLs',()=>{
 const p=c.planIndexSync_([],[src('P1','N1'),src('P1','N2')],[image('P1_01','first'),image('P1_02','second')]);assert.equal(p.additions.length,1);assert.equal(p.additions[0][11],false);assert.equal(p.additions[0][1],'N1\nN2');assert.equal(p.additions[0][10].split('\n').length,2);
});
test('hourly schedule and contiguous batched writes',()=>{
 const calls=[];c.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyHours(n){calls.push(n);return this},create(){}})};c.installIndexSyncTrigger();assert.deepEqual(calls,[1]);
 const writes=[];c.writeIndexUpdates_({getRange:(row,col,n)=>({setNumberFormat(){return this},setValues(values){writes.push({row,col,n,values});return this},setWrap(){return this}})},[{row:2,col:11,value:'one'},{row:3,col:11,value:'two'},{row:8,col:13,value:'note'}]);assert.equal(writes.length,2);assert.equal(writes[0].n,2);
});
test('ERP folder images are tagged crop=erp and always listed after regular photos',()=>{
 const erp=(key,id)=>({key,id,crop:true,url:'https://drive.google.com/thumbnail?id='+id+'&sz=w1600&crop=erp'});
 // ERP image linked earlier without the tag, then a regular photo arrives later
 const r=row('CR120-W-11','N916','https://drive.google.com/thumbnail?id=scan&sz=w1600');
 const p=c.planIndexSync_([r],[src()],[erp('CR120-W-11','scan'),image('CR120-W-11_01','photo')]),urls=p.updates.find(u=>u.col===11).value.split('\n');
 assert.deepEqual(urls,['https://drive.google.com/thumbnail?id=photo&sz=w1600','https://drive.google.com/thumbnail?id=scan&sz=w1600&crop=erp']);
 r[10]=urls.join('\n');assert.equal(c.planIndexSync_([r],[src()],[erp('CR120-W-11','scan'),image('CR120-W-11_01','photo')]).updates.filter(u=>u.col===11).length,0);
 // rows with only regular photos are left untouched
 const plain=row();assert.equal(c.planIndexSync_([plain],[src()],[erp('OTHER','x')]).updates.filter(u=>u.col===11).length,0);
});
test('rows pasted with a blank LPM_ID get the next free ID once',()=>{
 const a=row(),b=row('NEW-1','');a[0]='LPM-120';b[0]='';
 const ids=c.planIndexSync_([a,b],[],[]).updates.filter(u=>u.col===1);assert.equal(ids.length,1);assert.equal(ids[0].row,3);assert.equal(ids[0].value,'LPM-121');
 b[0]=ids[0].value;assert.equal(c.planIndexSync_([a,b],[],[]).updates.filter(u=>u.col===1).length,0);
});
