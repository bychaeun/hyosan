/* Prepare first, then require a fresh user tap for native file sharing. */
const SHARE_ICON='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>';
function shareImageButton(handler,label='이미지 공유'){
 return `<button type="button" class="btn ghost share-image" aria-label="${label}" title="${label}" onclick="${handler}">${SHARE_ICON}</button>`;
}
function openImageShareDialog(blob,name){
 const previous=document.getElementById('imageShareDialog');if(previous){previous.close();previous.remove()}
 const file=new File([blob],name,{type:blob.type||'image/png'}),url=URL.createObjectURL(blob),dialog=document.createElement('dialog');
 dialog.id='imageShareDialog';dialog.className='image-share-dialog';dialog.setAttribute('aria-label','이미지 공유');
 dialog.innerHTML='<div class="modal-head"><h2>이미지 공유</h2><button class="close" type="button" aria-label="닫기">×</button></div><img alt="공유할 이미지 미리보기"><p role="status"></p><div class="actions"><button type="button" class="btn share-confirm">공유하기</button><a class="btn ghost">이미지 저장</a></div>';
 const image=dialog.querySelector('img'),status=dialog.querySelector('[role=status]'),button=dialog.querySelector('.share-confirm'),download=dialog.querySelector('a');
 image.src=url;download.href=url;download.download=name;
 const supported=!!navigator.share&&!!navigator.canShare&&navigator.canShare({files:[file]});
 status.textContent=supported?'공유하기를 누른 후 카카오톡을 선택하세요. 카카오톡 설치 및 기기 지원 여부에 따라 목록이 달라집니다.':'이 브라우저는 이미지 공유를 지원하지 않습니다. 이미지를 저장한 뒤 카카오톡에 첨부해 주세요.';
 button.hidden=!supported;
 button.onclick=async()=>{
  if(button.disabled)return;button.disabled=true;
  try{await navigator.share({files:[file],title:name.replace(/\.[^.]+$/,'')});status.textContent='공유창으로 전달했습니다.'}
  catch(error){status.textContent=error.name==='AbortError'?'공유를 취소했습니다.':'공유창을 열지 못했습니다. 이미지 저장 후 카카오톡에 첨부해 주세요.'}
  finally{button.disabled=false}
 };
 dialog.querySelector('.close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{image.removeAttribute('src');URL.revokeObjectURL(url);dialog.remove()},{once:true});
 document.body.appendChild(dialog);dialog.showModal();
}
async function shareCurrentImage(button){
 if(button.disabled)return;button.disabled=true;let canvas;
 try{
  const item={...state.modalImage};if(!item.url)throw Error('등록된 이미지가 없습니다.');
  const image=await loadComposerExportImage(item.url,2000);canvas=document.createElement('canvas');
  const scale=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('이미지 생성 실패');
  openImageShareDialog(blob,(item.name||'HYOSAN LPL').replace(/[\\/:*?"<>|]+/g,' ')+'.png');
 }catch(error){actionStatus('이미지 공유 준비 실패: '+error.message)}
 finally{if(canvas)canvas.width=canvas.height=0;button.disabled=false}
}
