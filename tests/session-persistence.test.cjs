const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function fn(name){const start=html.search(new RegExp('(?:async )?function '+name+'\\('));const tail=html.slice(start),end=tail.search(/\r?\n(?:async )?function /);return end<0?tail:tail.slice(0,end)}
function context(code=''){
 const backing=new Map(),local=new Map();const store={put(v,k){const request={};queueMicrotask(()=>{backing.set(k,v);request.onsuccess?.()});return request},delete(k){const request={};queueMicrotask(()=>{backing.delete(k);request.onsuccess?.()});return request},get(k){const request={};queueMicrotask(()=>{request.result=backing.get(k);request.onsuccess?.()});return request}};
 const c=vm.createContext({console,queueMicrotask,localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},cacheDb:async()=>({transaction:()=>({objectStore:()=>store})}),auth:{sessionToken:'',idToken:'',user:null},Promise});
 vm.runInContext('let sessionPersistence=Promise.resolve();'+['rememberSession','restoreSession','clearSession'].map(fn).join('\n')+code,c);return {c,backing,local};
}
test('session is backed up, restored after localStorage loss and explicitly erased on logout',async()=>{
 const {c,backing,local}=context();await c.rememberSession('signed-session');assert.equal(local.get('hyosan-session'),'signed-session');assert.equal(backing.get('session'),'signed-session');local.clear();c.auth.sessionToken='';await c.restoreSession();assert.equal(c.auth.sessionToken,'signed-session');await c.clearSession();assert.equal(c.auth.sessionToken,'');assert.equal(backing.has('session'),false);assert.equal(local.has('hyosan-session'),false);
});
test('temporary mobile network failures do not erase a saved login',async()=>{
 const {c}=context();c.auth.sessionToken='saved';c.retryAccessGate=()=>{};c.loginStatus=()=>{};c.CONFIG={AUTH_TIMEOUT_MS:100};c.apiPost=async()=>{throw new Error('Failed to fetch')};c.DATA_KEYS=['lpm'];vm.runInContext('let accessPromise=null;'+fn('bootstrapAccess'),c);await c.bootstrapAccess();assert.equal(c.auth.sessionToken,'saved');
});
test('saved session validates approval and loads data in one request before displaying the app',async()=>{
 const {c}=context();c.auth.sessionToken='saved';c.CONFIG={AUTH_TIMEOUT_MS:100};c.DATA_KEYS=['lpm'];c.loginStatus=()=>{};let calls=[],started=null;c.apiPost=async action=>{calls.push(action);return {user:{email:'staff'},lpm:[]}};c.startApp=(user,data)=>{started={user,data}};vm.runInContext('let accessPromise=null;'+fn('bootstrapAccess'),c);await c.bootstrapAccess();assert.deepEqual(calls,['data']);assert.equal(started.user.email,'staff');assert.equal(started.data.lpm.length,0);
});
test('revoked approval erases local and backup tokens and never displays cached data',async()=>{
 const {c,backing}=context();await c.rememberSession('saved');c.CONFIG={AUTH_TIMEOUT_MS:100};c.DATA_KEYS=['lpm'];c.loginStatus=()=>{};c.apiPost=async()=>{const e=new Error('Revoked');e.code='ACCESS_REVOKED';throw e};c.fetchAppConfig=async()=>({authRequired:true,clientId:'client'});c.showGoogleGate=()=>{};c.startApp=()=>assert.fail('Revoked user must not enter');vm.runInContext('let accessPromise=null;'+fn('bootstrapAccess'),c);await c.bootstrapAccess();assert.equal(c.auth.sessionToken,'');assert.equal(backing.has('session'),false);
});
test('server renews near-expiry approved sessions only, preserving the existing window',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8'),start=code.indexOf('function renewSessionResponse_'),end=code.indexOf('\nfunction ',start+1),c=vm.createContext({Date,JSON,Utilities:{base64DecodeWebSafe:s=>s,newBlob:s=>({getDataAsString:()=>s})},createSessionToken_:email=>'renewed:'+email});vm.runInContext(code.slice(start,end),c);
 const body={sessionToken:JSON.stringify({exp:Date.now()+1000})+'.signature'};assert.equal(c.renewSessionResponse_(body,{Status:'APPROVED',Email:'staff'},{}).sessionToken,'renewed:staff');assert.equal(c.renewSessionResponse_(body,{Status:'REVOKED',Email:'staff'},{}).sessionToken,undefined);assert.equal(c.renewSessionResponse_({sessionToken:JSON.stringify({exp:Date.now()+20*86400000})+'.signature'},{Status:'APPROVED',Email:'staff'},{}).sessionToken,undefined);
});
