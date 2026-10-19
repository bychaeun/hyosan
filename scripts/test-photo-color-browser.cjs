// Isolated local browser QA: mock catalog/session only; no production writes or uploads.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),errors=[];
const user={email:'fixture@example.com',isAdmin:false};
const lpm=[{LPM_ID:'redwood',ProductName:'RED WOOD',Category:'WOOD',ColorHex:'#FF0000'},{LPM_ID:'bluewood',ProductName:'BLUE WOOD',Category:'WOOD',ColorHex:'#0000FF'},{LPM_ID:'redstone',ProductName:'RED STONE',Category:'STONE',ColorHex:'#FF0000'}];
const data={patterns:[],lpm,specialSpecs:[],emboss:[],sites:[],config:{},user};
const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}const target=file===root+path.sep?path.join(root,'index.html'):file;fs.readFile(target,(e,b)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',target.endsWith('.mjs')||target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.html')?'text/html':'application/octet-stream');res.end(b)})});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  for(const width of [390,1024]){
   const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,serviceWorkers:'block'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin))return route.continue();if(u.startsWith('https://script.google.com/')){let body={};try{body=JSON.parse(route.request().postData()||'{}')}catch{}return route.fulfill({json:body.action==='data'?data:body.action==='imageVersions'?{imageVersions:{}}:{user}})}return route.abort()});
   await page.addInitScript(()=>localStorage.setItem('hyosan-session','fixture-session'));
   if(width===1024)await page.addInitScript(()=>{window.createImageBitmap=undefined});
   await page.goto(origin+'/index.html');await page.locator('#accessGate').waitFor({state:'hidden'});
   await page.locator('.nav button[data-page="tools"]').click();await page.locator('[data-tool-mode="colorist"]').click();
   assert.equal(await page.locator('#photoColorDialog').count(),0);await page.locator('#photoColorAdd').click();
   await page.getByRole('button',{name:'사진첩에서 선택하기',exact:true}).waitFor();
   assert.equal(await page.locator('[data-input="camera"]').getAttribute('capture'),'environment');
   await page.locator('[data-input="library"]').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
   await page.getByRole('button',{name:'분석하기',exact:true}).click();await page.getByText('이 사진 형식을 읽을 수 없습니다. JPG 또는 PNG로 다시 선택해 주세요.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'뒤로가기',exact:true}).click();
   const photo={name:'red.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path fill="red" d="M0 0h200v200H0z"/></svg>')};
   await page.locator('[data-input="library"]').setInputFiles(photo);
   await page.getByRole('button',{name:'뒤로가기',exact:true}).click();await page.getByRole('button',{name:'촬영하기',exact:true}).waitFor();
   await page.locator('[data-input="library"]').setInputFiles(photo);
   await page.locator('.photo-review').getByRole('button',{name:'스톤 · 타일',exact:true}).click();
   await page.locator('.photo-review').getByRole('button',{name:'우드',exact:true}).click();
   await page.screenshot({path:path.join(root,'tmp-photo-dialog-'+width+'.png')});
   await page.getByRole('button',{name:'분석하기',exact:true}).click();await page.locator('#photoColorDialog').waitFor({state:'hidden'});
   assert.equal(await page.locator('#colorGrid .card').count(),2);assert.equal(await page.locator('#colorGrid .card h2').first().textContent(),'RED WOOD');
   await page.locator('#colorGrid input[type="checkbox"]').first().check();assert.match(await page.locator('#saveColorRecommendations').textContent(),/1\/4/);
   await page.locator('.photo-results').getByRole('button',{name:'스톤 · 타일',exact:true}).click();assert.equal(await page.locator('#colorGrid .card').count(),1);
   await page.locator('#search').fill('not-found');await page.waitForTimeout(250);assert.equal(await page.locator('#colorGrid .card').count(),0);await page.locator('#search').fill('');await page.waitForTimeout(250);
   await page.screenshot({path:path.join(root,'tmp-photo-'+width+'.png')});
   assert.equal(await page.getByRole('button',{name:'사진 변경',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'색상환으로 돌아가기'}).count(),0);
   await page.locator('#photoColorAdd').click();
   await page.locator('[data-input="camera"]').setInputFiles({name:'blue.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path fill="blue" d="M0 0h200v200H0z"/></svg>')});
   await page.locator('#photoColorDialog').waitFor({state:'hidden'});
   await page.locator('.photo-results').getByRole('button',{name:'우드',exact:true}).click();
   assert.equal(await page.locator('#colorGrid .card h2').first().textContent(),'BLUE WOOD');assert.equal(await page.locator('#hex').textContent(),'#0000FF');
   await page.locator('#wheel').click({position:{x:80,y:80}});assert.equal(await page.locator('.photo-results').isVisible(),false);
   assert.equal(await page.locator('#wheel').evaluate(el=>getComputedStyle(el).touchAction),'none');
   const bounds=await page.locator('#wheel').boundingBox(),before=await page.evaluate(()=>scrollY),priorColor=await page.locator('#hex').textContent(),cdp=await context.newCDPSession(page);
   const point={x:bounds.x+bounds.width*.5,y:bounds.y+bounds.height*.5};
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
   for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+step*5,y:point.y-step*7}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.equal(await page.evaluate(()=>scrollY),before);assert.notEqual(await page.locator('#hex').textContent(),priorColor);
   await context.close();console.log('Photo workflow passed at '+width+'px');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
