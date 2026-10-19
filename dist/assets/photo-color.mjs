import {extractPalette,category,rank} from './photo-color-core.mjs';

export function createPhotoSearch(api) {
 let active=false,palette=null,selected='ALL',file=null,url='',generation=0,busy=false,autoAnalyze=false;
 const dialog=document.createElement('dialog');dialog.id='photoColorDialog';dialog.setAttribute('aria-labelledby','photoColorTitle');
 dialog.innerHTML=`<div class="photo-dialog-inner"><header><h2 id="photoColorTitle">사진으로 색상 찾기</h2><button type="button" class="photo-close" aria-label="닫기">×</button></header><div class="photo-choices"><button type="button" class="btn" data-source="library">사진첩에서 선택하기</button><button type="button" class="btn ghost" data-source="camera">촬영하기</button><p>사진은 서버에 업로드하지 않고 이 기기에서만 분석합니다.</p></div><div class="photo-review" hidden><img class="photo-preview" alt="선택한 사진 미리보기"><p>패턴 종류를 선택해 주세요.</p><div class="photo-categories" aria-label="패턴 종류"></div><p class="photo-note">사진 전체의 주요 색상을 비교합니다. 종류는 직접 선택하며, 무늬는 자동 분석하지 않습니다.</p><div class="photo-actions"><button type="button" class="btn ghost" data-action="back">뒤로가기</button><button type="button" class="btn" data-action="analyze">분석하기</button></div></div><p class="photo-message" role="status" aria-live="polite"></p><input type="file" accept="image/*" data-input="library" hidden><input type="file" accept="image/*" capture="environment" data-input="camera" hidden></div>`;
 document.body.append(dialog);
 const $=s=>dialog.querySelector(s),message=t=>$('.photo-message').textContent=t;
 const summary=document.createElement('section');summary.className='photo-results';summary.hidden=true;summary.setAttribute('aria-label','사진 색상 추천');summary.innerHTML='<div class="photo-result-head"><strong>사진 색상 추천</strong><button type="button" class="btn ghost">색상환으로 돌아가기</button></div><div class="photo-palette" aria-label="사진의 주요 색상"></div><div class="photo-categories" aria-label="추천 패턴 종류"></div><p>색상 참고 점수이며 실제 일치율이 아닙니다. 조명·배경에 영향을 받으며 실제 샘플을 확인해 주세요.</p>';
 api.grid.before(summary);
 const replaceButton=document.createElement('button');replaceButton.type='button';replaceButton.className='btn ghost';replaceButton.textContent='사진 변경';replaceButton.onclick=()=>open();summary.querySelector('.photo-result-head').append(replaceButton);
 function categories(){const out=new Map();api.entries(false).forEach(x=>{const c=category(x.item.Category);out.set(c.code,c)});return [{code:'ALL',label:'전체'},...[...out.values()].sort((a,b)=>a.label.localeCompare(b.label,'ko'))]}
 function buttons(container,change){container.replaceChildren(...categories().map(c=>{const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=c.label;b.classList.toggle('active',selected===c.code);b.setAttribute('aria-pressed',String(selected===c.code));b.onclick=()=>{selected=c.code;change()};return b}))}
 function release(){generation++;file=null;if(url)URL.revokeObjectURL(url);url='';$('.photo-preview').removeAttribute('src');busy=false;$('[data-action="analyze"]').disabled=false}
 function choices(){release();$('.photo-choices').hidden=false;$('.photo-review').hidden=true;message('')}
 function reset(){active=false;palette=null;selected='ALL';summary.hidden=true;release()}
 function render(){
  if(!active||!palette)return false;
  summary.hidden=false;api.note.textContent='가장 많은 기본색 · 사진의 약 '+Math.round(palette[0].weight*100)+'%';buttons(summary.querySelector('.photo-categories'),()=>api.render());
  summary.querySelector('.photo-palette').replaceChildren(...palette.map(p=>{const sw=document.createElement('span');sw.style.background=p.hex;sw.title=p.hex+' · '+Math.round(p.weight*100)+'%';sw.setAttribute('aria-label',sw.title);return sw}));
  const rows=rank(api.entries(true),palette,selected);api.help.textContent=`사진 색상 기준 · ${categories().find(c=>c.code===selected)?.label||selected} · ${rows.length}개${rows.length?'':' — 다른 종류를 선택하거나 검색어를 지워 주세요.'}`;
  api.grid.replaceChildren(...rows.map(item=>{const card=api.card(item),score=document.createElement('div');score.className='photo-score';score.textContent='색상 참고 점수 '+item._photoScore+'/100';card.querySelector('.body').append(score);return card}));api.updateSelection();return true;
 }
 summary.querySelector('button').onclick=()=>{reset();api.render()};
 $('.photo-close').onclick=()=>dialog.close();dialog.addEventListener('close',release);
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
 $('[data-action="back"]').onclick=choices;
 for(const source of ['library','camera']){
  const input=$(`[data-input="${source}"]`);$(`[data-source="${source}"]`).onclick=()=>{input.value='';input.click()};
  input.onchange=()=>{const next=input.files?.[0];if(!next)return;if(!next.type.startsWith('image/')){message('사진 파일을 선택해 주세요.');return}if(next.size>25*1024*1024){message('25MB 이하의 사진을 선택해 주세요.');return}release();if(autoAnalyze){active=false;palette=null;summary.hidden=true;api.grid.replaceChildren();api.help.textContent='새 사진을 분석하고 있습니다…'}file=next;url=URL.createObjectURL(file);$('.photo-preview').src=url;$('.photo-choices').hidden=true;$('.photo-review').hidden=false;reviewCategories();message('');if(autoAnalyze)$('[data-action="analyze"]').click();else $('[data-action="analyze"]').focus()};
 }
 // Rebind a single category renderer so any number of category changes remains interactive.
 function reviewCategories(){buttons($('.photo-review .photo-categories'),reviewCategories)}
 $('[data-action="analyze"]').onclick=async()=>{
  if(busy||!file)return;busy=true;const current=generation,source=file,sourceUrl=url;$('[data-action="analyze"]').disabled=true;message('사진의 색상을 분석하고 있습니다…');
  let bitmap=null;
  try{
   await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
   if(current!==generation||!dialog.open)return;
   if(typeof createImageBitmap==='function'){try{bitmap=await createImageBitmap(source,{resizeWidth:192,resizeHeight:192,resizeQuality:'medium',imageOrientation:'from-image'})}catch(e){/* Safari/HEIC fallback below. */}}
   if(!bitmap)bitmap=await new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>{img.src='';reject(new Error('사진을 읽는 시간이 초과되었습니다. 다시 선택해 주세요.'))},15000);img.onload=()=>{clearTimeout(timer);resolve(img)};img.onerror=()=>{clearTimeout(timer);reject(new Error('이 사진 형식을 읽을 수 없습니다. JPG 또는 PNG로 다시 선택해 주세요.'))};img.src=sourceUrl});
   if(current!==generation||!dialog.open)return;
   const canvas=document.createElement('canvas');canvas.width=canvas.height=192;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('이 브라우저에서 사진 분석을 사용할 수 없습니다.');
   ctx.drawImage(bitmap,0,0,192,192);const pixels=ctx.getImageData(0,0,192,192).data;canvas.width=canvas.height=0;
   palette=extractPalette(pixels);active=true;api.setColor(palette[0].hex);api.render();dialog.close();
  }catch(e){if(current===generation)message(e.message||'사진 분석에 실패했습니다. 다른 사진을 선택해 주세요.')}
  finally{bitmap?.close?.();if(current===generation){busy=false;$('[data-action="analyze"]').disabled=false}}
 };
 function open(){autoAnalyze=active;choices();dialog.showModal()}
 return {open,render,reset,getRows(){return active?rank(api.entries(true),palette,selected):null}};
}
