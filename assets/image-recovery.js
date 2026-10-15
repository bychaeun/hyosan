/* Retry failed Drive images only; never loop or reload successful catalog images. */
const imageRecoveryState=new WeakMap();
function recoverDriveImage(img){
 if(img?.tagName!=='IMG'||!img.isConnected)return;
 let url;try{url=new URL(img.src)}catch{return}
 let id='';
 if(url.hostname==='drive.google.com')id=url.searchParams.get('id')||'';
 else if(url.hostname==='lh3.googleusercontent.com')id=url.pathname.match(/^\/d\/([^=/?]+)/)?.[1]||'';
 if(!/^[\w-]+$/.test(id))return;
 const revision=url.searchParams.get('rev')||'',key=id+'|'+revision;
 let entry=imageRecoveryState.get(img);
 if(!entry||entry.key!==key||img.src!==entry.last)entry={key,attempt:0,last:img.src};
 if(entry.attempt>=2)return;
 const requested=Number((url.searchParams.get('sz')||url.pathname).match(/w(\d+)/)?.[1])||1600;
 const size=entry.attempt===0?Math.min(requested,1600):Math.min(requested,800);
 entry.attempt++;
 const next='https://lh3.googleusercontent.com/d/'+encodeURIComponent(id)+'=w'+size+(revision?'?rev='+encodeURIComponent(revision):'');
 entry.last=next;imageRecoveryState.set(img,entry);
 img.src=next;
}
document.addEventListener('error',event=>recoverDriveImage(event.target),true);
