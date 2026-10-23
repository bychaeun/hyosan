const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('site compatibility preserves blank emboss positions without SPECIAL_SPECS sheet',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(__dirname+'/../Code.gs','utf8'),c);
 const out={lpm:[{LPM_ID:'a',PaperNumber:'P',ImageURL:'photo'}],specialSpecs:[],sites:[{Construction_ID:'S',SpecialSpecNumbers:'HS1\nHS2',LinkedLPM_IDs:'a\na',EmbossNames:'\nUK'}]};
 c.integrateSiteSpecs_(out);assert.equal(out.sites[0].SpecialSpecNumbers,'HS1\nHS2 (UK)');
 assert.equal(out.specialSpecs[1].EmbossType,'UK');assert.equal(out.specialSpecs[0].ImageURL,'photo');
});
test('hourly manual rows preserve notes, still append images and do not duplicate index paper',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(__dirname+'/../automation/HourlyIndexSync.gs','utf8'),c);
 const row=Array(15).fill('');row[0]='LPM-1';row[1]='CUSTOM';row[7]='P';row[12]='KEEP';row[14]='TRUE';
 const plan=c.planIndexSync_([row],[{paper:'P',current:'OTHER',previous:[],company:'C'}],[{key:'P',id:'image',url:'https://drive.google.com/uc?id=image'}],14);
 assert.equal(plan.additions.length,0);assert.equal(plan.updates.length,1);assert.equal(plan.updates[0].col,11);
});
