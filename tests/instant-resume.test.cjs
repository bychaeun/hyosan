const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('async function resumeSavedSession()'),html.indexOf('async function bootstrapAccess()'));
function setup(){
 const token=Buffer.from(JSON.stringify({email:'staff@example.com',exp:Date.now()+86400000})).toString('base64url')+'.signature';
 const calls=[];let cached={user:{email:'staff@example.com'},lpm:[]};
 const c=vm.createContext({Date,Number,JSON,atob:s=>Buffer.from(s,'base64').toString(),auth:{sessionToken:token},DATA_KEYS:['lpm'],loadCachedData:async()=>cached,startApp:()=>calls.push('open'),setStatus:()=>{},syncData:()=>{calls.push('verify');return new Promise(()=>{})}});
 vm.runInContext(source,c);return {c,calls,setCache:v=>cached=v};
}
test('saved user opens from local data without waiting for background server authorization',async()=>{const {c,calls}=setup();assert.equal(await c.resumeSavedSession(),true);assert.deepEqual(calls,['open','verify']);assert.equal(c.lastAccessVerifiedAt,0)});
test('missing or another account cache never opens',async()=>{for(const cached of [null,{user:{email:'other'},lpm:[]},{user:{email:'staff@example.com'}}]){const {c,calls,setCache}=setup();setCache(cached);assert.equal(await c.resumeSavedSession(),false);assert.equal(calls.length,0)}});
test('expired and malformed saved tokens cannot open cached content',async()=>{for(const exp of [Date.now()-1,'invalid']){const {c,calls}=setup();c.auth.sessionToken=Buffer.from(JSON.stringify({email:'staff@example.com',exp})).toString('base64url')+'.signature';assert.equal(await c.resumeSavedSession(),false);assert.equal(calls.length,0)}const {c}=setup();c.auth.sessionToken='bad';assert.equal(await c.resumeSavedSession(),false)});
test('logout during storage load prevents cached restore',async()=>{const {c,calls}=setup();c.loadCachedData=async()=>{c.auth.sessionToken='';return {user:{email:'staff@example.com'},lpm:[]}};assert.equal(await c.resumeSavedSession(),false);assert.equal(calls.length,0)});
