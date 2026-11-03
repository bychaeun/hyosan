const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
test('phone full view uses nearly the full screen width',()=>{
 assert.match(html,/\.image-viewer-stage\{padding:64px 8px 46px\}\.image-viewer-stage img\{max-width:calc\(100vw - 16px\)/);
});
test('pinch zoom only promotes the layer while fingers are down so the image re-rasterizes sharply',()=>{
 assert.doesNotMatch(html,/#fullViewImage\{[^}]*will-change/);
 assert.match(html,/style\.willChange='transform'/);assert.match(html,/style\.willChange=''/);
});
test('full view shows the cached popup image while the 2048px version loads',()=>{
 assert.match(html,/function fullViewImageUrl\(value\)\{return COARSE_POINTER\?sizedDriveImage\(value,2048\):value\}/);
 assert.match(html,/function showProgressive\(img,src,hold\)\{[^}]*const low=hold\|\|sizedDriveImage\(src,640\)/);
 assert.match(html,/if\(!viewer\.open\)viewer\.showModal\(\);setModalImage\(state\.modalIndex\)/);
});
test('checked SpecOut puts a red stamp over the LPM popup image and is searchable',()=>{
 assert.match(html,/function isSpecOut\(x\)/);assert.match(html,/'fullview-enabled pinch-enabled'\+\(isSpecOut\(x\)\?' specout':''\)/);
 assert.match(html,/class="specout-stamp"[^>]*>스펙아웃</);assert.match(html,/\.specout-stamp\{[^}]*color:#e0201b/);assert.match(html,/'스펙아웃 specout':''\]/);
});
