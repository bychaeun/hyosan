const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('installed app names agree across iOS, web and Android',()=>{
 for(const file of ['manifest.webmanifest','mobile.webmanifest']){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  assert.equal(manifest.name,'HYOSAN LPL');
  assert.equal(manifest.short_name,'HYOSAN LPL');
 }
 assert.match(html,/<meta name="apple-mobile-web-app-title" content="HYOSAN LPL">/);
 assert.match(fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8'),/android:label="HYOSAN LPL"/);
});
test('install chooser offers iOS instructions and an existing Android APK',()=>{
 let output='';
 const source=html.slice(html.indexOf('function installApp(){'),html.indexOf('async function installWebApp(){'));
 vm.runInNewContext(source+';installApp();',{showInstallHelp:value=>output=value});
 assert.match(output,/iPhone · iPad/);
 assert.match(output,/공유 → 홈 화면에 추가 → 추가/);
 assert.match(output,/Android APK 다운로드/);
 assert.match(output,/<p class="muted">보안 경고가 표시되면 내용을 확인한 후 진행하세요\.<\/p>/);
 const file=output.match(/href="\.\/(assets\/[^\"]+\.apk)"/)[1];
 assert.ok(fs.statSync(path.join(root,file)).size>100000);
 assert.match(html,/\$\('#installButton'\)\.textContent='앱 설치'/);
 assert.doesNotMatch(html,/textContent=isMobileDevice\(\)\?'모바일 앱 설치'/);
});
