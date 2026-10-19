import {extractPalette,brightenPalette,category,rank,selectionRect} from './photo-color-core.mjs';

export function createPhotoSearch(api) {
 let colorIndex=0,active=false,palette=null,selected='ALL',file=null,url='',generation=0,busy=false,crop={x:0,y:0,w:1,h:1},drag=null;
 const dialog=document.createElement('dialog');dialog.id='photoColorDialog';dialog.setAttribute('aria-labelledby','photoColorTitle');
 dialog.innerHTML=`<div class="photo-dialog-inner"><header><h2 id="photoColorTitle">사진으로 색상 찾기</h2><button type="button" class="photo-close" aria-label="닫기">×</button></header><div class="photo-choices"><button type="button" class="btn" data-source="library">사진첩에서 선택하기</button><button type="button" class="btn ghost" data-source="camera">촬영하기</button><p>사진은 서버에 업로드하지 않고 이 기기에서만 분석합니다.</p></div><div class="photo-review" hidden><img class="photo-preview" alt="선택한 사진 미리보기"><p>패턴 종류를 선택해 주세요.</p><div class="photo-categories" aria-label="패턴 종류"></div><p class="photo-note">선택 영역의 주요 색상을 비교합니다. 종류는 직접 선택하며, 무늬는 자동 분석하지 않습니다.</p><div class="photo-actions"><button type="button" class="btn ghost" data-action="back">뒤로가기</button><button type="button" class="btn" data-action="analyze">분석하기</button></div></div><p class="photo-message" role="status" aria-live="polite"></p><input type="file" accept="image/*" data-input="library" hidden><input type="file" accept="image/*" capture="environment" data-input="camera" hidden></div>`;
 document.body.append(dialog);
 const $=s=>dialog.querySelector(s),message=t=>$('.photo-message').textContent=t;
 const preview=$('.photo-preview'),cropBox=document.createElement('div'),outline=document.createElement('div');cropBox.className='photo-crop-box';outline.className='photo-crop-outline';outline.setAttribute('aria-hidden','true');preview.before(cropBox);cropBox.append(preview,outline);preview.draggable=false;
 const cropTools=document.createElement('div');cropTools.className='photo-crop-tools';cropTools.innerHTML='<span>사진 위를 드래그해 분석 영역 선택</span><button type="button" class="chip">사진 전체</button>';cropBox.after(cropTools);
 const coords=document.createElement('div');coords.className='photo-crop-coordinates';coords.innerHTML='<label>왼쪽 %<input type="number" min="0" max="99" value="0" data-axis="x"></label><label>위쪽 %<input type="number" min="0" max="99" value="0" data-axis="y"></label><label>너비 %<input type="number" min="1" max="100" value="100" data-axis="w"></label><label>높이 %<input type="number" min="1" max="100" value="100" data-axis="h"></label>';cropTools.after(coords);
 function imageRect(){const r=cropBox.getBoundingClientRect(),scale=Math.min(r.width/(preview.naturalWidth||1),r.height/(preview.naturalHeight||1)),w=preview.naturalWidth*scale,h=preview.naturalHeight*scale;return {left:r.left+(r.width-w)/2,top:r.top+(r.height-h)/2,width:w,height:h,offsetX:(r.width-w)/2,offsetY:(r.height-h)/2}}
 function showCrop(){const r=imageRect();Object.assign(outline.style,{left:r.offsetX+crop.x*r.width+'px',top:r.offsetY+crop.y*r.height+'px',width:crop.w*r.width+'px',height:crop.h*r.height+'px'});for(const input of coords.querySelectorAll('input'))input.value=Math.round(crop[input.dataset.axis]*100)}
 preview.onload=showCrop;new ResizeObserver(showCrop).observe(cropBox);
 const point=e=>{const r=imageRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}};
 cropBox.onpointerdown=e=>{if(busy||!preview.naturalWidth||e.button!==0)return;e.preventDefault();drag={id:e.pointerId,start:point(e),previous:{...crop}};cropBox.setPointerCapture(e.pointerId)};
 cropBox.onpointermove=e=>{if(drag?.id!==e.pointerId)return;crop=selectionRect(drag.start,point(e));showCrop()};
 cropBox.onpointerup=e=>{if(drag?.id!==e.pointerId)return;if(crop.w<.01||crop.h<.01)crop=drag.previous;drag=null;showCrop();if(cropBox.hasPointerCapture(e.pointerId))cropBox.releasePointerCapture(e.pointerId)};
 cropBox.onpointercancel=()=>{if(drag)crop=drag.previous;drag=null;showCrop()};
 cropTools.querySelector('button').onclick=()=>{if(busy)return;crop={x:0,y:0,w:1,h:1};showCrop()};
 coords.onchange=e=>{if(busy||!e.target.dataset.axis)return;const key=e.target.dataset.axis,value=Number(e.target.value);if(!Number.isFinite(value)){showCrop();return}crop[key]=Math.max(key==='x'||key==='y'?0:.01,Math.min((key==='x'||key==='y') ? .99 : 1,value/100));crop.w=Math.min(crop.w,1-crop.x);crop.h=Math.min(crop.h,1-crop.y);showCrop()};
 const summary=document.createElement('section');summary.className='photo-results';summary.hidden=true;summary.setAttribute('aria-label','사진 색상 추천');summary.innerHTML='<div class="photo-result-head"><strong>사진 색상 추천 · 밝기 +10%</strong></div><div class="photo-palette" aria-label="사진의 주요 색상"></div><div class="photo-categories" aria-label="추천 패턴 종류"></div><p>색상 참고 점수이며 실제 일치율이 아닙니다. 조명·배경에 영향을 받으며 실제 샘플을 확인해 주세요.</p>';
 api.grid.before(summary);
 const edit=document.createElement('button');edit.type='button';edit.className='btn ghost';edit.textContent='영역 다시 선택';edit.onclick=()=>{if(!file)return;$('.photo-choices').hidden=true;$('.photo-review').hidden=false;reviewCategories();message('');dialog.showModal();requestAnimationFrame(showCrop)};summary.querySelector('.photo-result-head').append(edit);
 function categories(){const out=new Map([['WOOD',{code:'WOOD',label:'우드'}],['STONE',{code:'STONE',label:'스톤 · 타일'}],['FABRIC',{code:'FABRIC',label:'패브릭'}],['MARBLE',{code:'MARBLE',label:'대리석'}],['SOLID',{code:'SOLID',label:'단색'}]]);api.entries(false).forEach(x=>{const c=category(x.item.Category);out.set(c.code,c)});return [{code:'ALL',label:'전체'},...[...out.values()].sort((a,b)=>a.label.localeCompare(b.label,'ko'))]}
 function buttons(container,change){container.replaceChildren(...categories().map(c=>{const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=c.label;b.classList.toggle('active',selected===c.code);b.setAttribute('aria-pressed',String(selected===c.code));b.onclick=()=>{selected=c.code;change()};return b}))}
 function release(){generation++;file=null;if(url)URL.revokeObjectURL(url);url='';$('.photo-preview').removeAttribute('src');busy=false;$('[data-action="analyze"]').disabled=false}
 function choices(){generation++;busy=false;$('[data-action="analyze"]').disabled=false;$('.photo-choices').hidden=false;$('.photo-review').hidden=true;message('')}
 function reset(){active=false;palette=null;selected='ALL';summary.hidden=true;release()}
 function chosenPalette(){return palette?.[colorIndex]?[{...palette[colorIndex],weight:1}]:palette}
 function render(){
  if(!active||!palette)return false;
  summary.hidden=false;api.note.textContent='기본색 · 밝기 10% 보정 · 사진의 약 '+Math.round(palette[colorIndex].weight*100)+'%';buttons(summary.querySelector('.photo-categories'),()=>api.render());
  summary.querySelector('.photo-palette').replaceChildren(...palette.map((p,i)=>{const sw=document.createElement('button');sw.type='button';sw.style.background=p.hex;sw.title=p.hex+' · '+Math.round(p.weight*100)+'%';sw.setAttribute('aria-label',sw.title);sw.setAttribute('aria-pressed',String(i===colorIndex));sw.onclick=()=>{colorIndex=i;api.setColor(p.hex);api.render()};return sw}));
  const rows=rank(api.entries(true),chosenPalette(),selected);api.help.textContent=`사진 색상 기준 · ${categories().find(c=>c.code===selected)?.label||selected} · ${rows.length}개${rows.length?'':' — 다른 종류를 선택하거나 검색어를 지워 주세요.'}`;
  api.grid.replaceChildren(...rows.map(item=>{const card=api.card(item),score=document.createElement('div');score.className='photo-score';score.textContent='색상 참고 점수 '+item._photoScore+'/100';card.querySelector('.body').append(score);return card}));api.updateSelection();return true;
 }
 $('.photo-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{generation++;busy=false;drag=null;$('[data-action="analyze"]').disabled=false});
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
 $('[data-action="back"]').onclick=choices;
 for(const source of ['library','camera']){
  const input=$(`[data-input="${source}"]`);$(`[data-source="${source}"]`).onclick=()=>{input.value='';input.click()};
  input.onchange=()=>{const next=input.files?.[0];if(!next)return;if(!next.type.startsWith('image/')){message('사진 파일을 선택해 주세요.');return}if(next.size>25*1024*1024){message('25MB 이하의 사진을 선택해 주세요.');return}release();active=false;palette=null;crop={x:0,y:0,w:1,h:1};summary.hidden=true;api.grid.replaceChildren();api.help.textContent='새 사진의 영역과 종류를 선택한 뒤 분석해 주세요.';file=next;url=URL.createObjectURL(file);$('.photo-preview').src=url;$('.photo-choices').hidden=true;$('.photo-review').hidden=false;reviewCategories();message('');$('[data-action="analyze"]').focus()};
 }
 // Rebind a single category renderer so any number of category changes remains interactive.
 function reviewCategories(){buttons($('.photo-review .photo-categories'),reviewCategories)}
 $('[data-action="analyze"]').onclick=async()=>{
  if(busy||!file)return;busy=true;const current=generation,source=file,sourceUrl=url;$('[data-action="analyze"]').disabled=true;message('사진의 색상을 분석하고 있습니다…');
  let bitmap=null;
  try{
   await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
   if(current!==generation||!dialog.open)return;
   if(typeof createImageBitmap==='function'){try{bitmap=await createImageBitmap(source,{imageOrientation:'from-image'})}catch(e){/* Safari/HEIC fallback below. */}}
   if(!bitmap)bitmap=await new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>{img.src='';reject(new Error('사진을 읽는 시간이 초과되었습니다. 다시 선택해 주세요.'))},15000);img.onload=()=>{clearTimeout(timer);resolve(img)};img.onerror=()=>{clearTimeout(timer);reject(new Error('이 사진 형식을 읽을 수 없습니다. JPG 또는 PNG로 다시 선택해 주세요.'))};img.src=sourceUrl});
   if(current!==generation||!dialog.open)return;
   const canvas=document.createElement('canvas');canvas.width=canvas.height=192;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('이 브라우저에서 사진 분석을 사용할 수 없습니다.');
   const width=bitmap.naturalWidth||bitmap.width,height=bitmap.naturalHeight||bitmap.height;
   ctx.drawImage(bitmap,crop.x*width,crop.y*height,Math.max(1,crop.w*width),Math.max(1,crop.h*height),0,0,192,192);const pixels=ctx.getImageData(0,0,192,192).data;canvas.width=canvas.height=0;
   palette=brightenPalette(extractPalette(pixels));colorIndex=0;active=true;api.setColor(palette[0].hex);api.render();dialog.close();
  }catch(e){if(current===generation)message(e.message||'사진 분석에 실패했습니다. 다른 사진을 선택해 주세요.')}
  finally{bitmap?.close?.();if(current===generation){busy=false;$('[data-action="analyze"]').disabled=false}}
 };
 function open(){choices();dialog.showModal()}
 return {open,render,reset,getRows(){return active?rank(api.entries(true),chosenPalette(),selected):null}};
}
