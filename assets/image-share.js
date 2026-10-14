/* Native sharing without an intermediate dialog; retain only the latest prepared file. */
const SHARE_ICON='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>';
let preparedImageShare=null,nativeImageShareBusy=false,preparedImageShareTimer;
function shareImageButton(handler,label='이미지 공유'){
 return `<button type="button" class="btn ghost share-image" aria-label="${label}" title="${label}" onclick="${handler}">${SHARE_ICON}</button>`;
}
function cachedImageShare(key){
 return preparedImageShare?.key===key?preparedImageShare.file:null;
}
async function shareImageFile(file){
 if(nativeImageShareBusy)return '공유창이 이미 열려 있습니다.';
 if(!navigator.share||!navigator.canShare?.({files:[file]}))return '이 브라우저는 이미지 공유를 지원하지 않습니다. 이미지 저장 후 카카오톡에 첨부해 주세요.';
 nativeImageShareBusy=true;
 try{
  await navigator.share({files:[file],title:file.name.replace(/\.[^.]+$/,'')});
  return '공유창으로 전달했습니다.';
 }catch(error){
  if(error.name==='AbortError')return '공유를 취소했습니다.';
  return '이미지가 준비되었습니다. 공유 아이콘을 다시 눌러 주세요. 계속 실패하면 이미지 저장을 이용해 주세요.';
 }finally{nativeImageShareBusy=false}
}
function shareImageBlob(blob,name,key){
 const file=new File([blob],name,{type:blob.type||'image/png'});
 preparedImageShare={key,file};
 clearTimeout(preparedImageShareTimer);
 preparedImageShareTimer=setTimeout(()=>{preparedImageShare=null},120000);
 return shareImageFile(file);
}
async function shareCurrentImage(button){
 if(button.disabled)return;button.disabled=true;let canvas;
 try{
  const item={...state.modalImage};if(!item.url)throw Error('등록된 이미지가 없습니다.');
  const key=JSON.stringify(['modal',item]),cached=cachedImageShare(key);
  if(cached){actionStatus(await shareImageFile(cached));return}
  actionStatus('공유할 이미지를 준비하고 있습니다…');
  const image=await loadComposerExportImage(item.url,2000);canvas=document.createElement('canvas');
  const scale=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('이미지 생성 실패');
  actionStatus(await shareImageBlob(blob,(item.name||'HYOSAN LPL').replace(/[\\/:*?"<>|]+/g,' ')+'.png',key));
 }catch(error){actionStatus('이미지 공유 준비 실패: '+error.message)}
 finally{if(canvas)canvas.width=canvas.height=0;button.disabled=false}
}
