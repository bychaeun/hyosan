/* 휴대폰용 PDF 내보내기 — 휴대폰에는 PC 같은 인쇄 화면(window.print)이 없으므로,
   선택한 효산 LPM·경면판을 PC 인쇄본과 같은 A4 배치(한 쪽 4×4)로 그려 PDF 파일로 바로 내려받는다.
   외부 라이브러리 없이 쪽마다 JPEG 한 장을 만들어 PDF로 묶는다. 사진은 쪽 단위로만 불러와 메모리를 아낀다. */
const PDF_PX_PER_MM=7.0866,PDF_PAGE_SIZE=16;   // A4 210mm → 1488px (약 180dpi)

function pdfFromJpegs(pages){
 const enc=new TextEncoder(),parts=[],offsets=[];let size=0;
 const push=p=>{const b=typeof p==='string'?enc.encode(p):p;parts.push(b);size+=b.length};
 const obj=(n,write)=>{offsets[n]=size;push(n+' 0 obj\n');write();push('\nendobj\n')};
 const W=595.28,H=841.89,total=3+pages.length*3;
 push('%PDF-1.4\n%âãÏÓ\n');
 obj(1,()=>push('<< /Type /Catalog /Pages 2 0 R >>'));
 obj(2,()=>push('<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>'));
 pages.forEach((p,i)=>{
  const id=3+i*3,content='q '+W+' 0 0 '+H+' 0 0 cm /Im0 Do Q';
  obj(id,()=>push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /XObject << /Im0 '+(id+2)+' 0 R >> >> /Contents '+(id+1)+' 0 R >>'));
  obj(id+1,()=>push('<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'));
  obj(id+2,()=>{push('<< /Type /XObject /Subtype /Image /Width '+p.w+' /Height '+p.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+p.bytes.length+' >>\nstream\n');push(p.bytes);push('\nendstream')});
 });
 const xref=size;
 push('xref\n0 '+total+'\n0000000000 65535 f \n'+offsets.slice(1,total).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join(''));
 push('trailer\n<< /Size '+total+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
 return new Blob(parts,{type:'application/pdf'});
}

function pdfCardText(item,type){
 if(type==='pattern')return {title:item.PatternName_KR||item.PatternName_EN||'-',sub:item.SubCategory||'',extra:'',image:item.MainImageURL||item.ImageURL};
 if(type==='special'){const linked=indexes.lpm.get(item.LinkedLPM_ID);return {title:item.SpecialSpecNumber||'-',sub:[specialMajorValue(item),specialSubValue(item)].filter(Boolean).join(' · '),extra:'',image:item.ImageURL||(linked&&linked.ImageURL)}}
 if(type==='emboss')return {title:item.PlateName||'-',sub:item.Company||'',extra:'',image:item.ImageURL};
 if(type==='site'){const dates=[item.MHOpenDate&&'MH '+item.MHOpenDate,item.CompletionDate&&'완공 '+item.CompletionDate].filter(Boolean).join(' · ');return {title:item.SiteName||item.Company||'-',sub:[siteTypeLabel(item),siteCategoryValue(item)].filter(Boolean).join(' · '),extra:dates,image:item.ImageURL}}
 const prev=String(item.PreviousNames||'').trim();   // 종이 넘버는 PC 인쇄본처럼 넣지 않는다
 return {title:lpmExportName(item),sub:[lpmBookLabel(item),item.Category].filter(Boolean).join(' · '),extra:prev?'이전: '+prev:'',image:item.ImageURL};
}
async function pdfBitmap(blob){
 if(window.createImageBitmap){try{return await createImageBitmap(blob)}catch(e){}}
 const url=URL.createObjectURL(blob),img=new Image();img.src=url;
 try{await img.decode();return img}finally{setTimeout(()=>URL.revokeObjectURL(url),60000)}
}
async function pdfImage(value){
 const url=imageUrls(value)[0];if(!/^https?:\/\//i.test(url||''))return null;
 try{return await pdfBitmap(await fetchShareImage(url,640))}catch(e){return null}   // 못 불러온 사진은 회색 칸으로 둔다
}
function pdfRoundRect(x,left,top,w,h,r){x.beginPath();x.moveTo(left+r,top);x.arcTo(left+w,top,left+w,top+h,r);x.arcTo(left+w,top+h,left,top+h,r);x.arcTo(left,top+h,left,top,r);x.arcTo(left,top,left+w,top,r);x.closePath()}
function pdfLines(x,text,maxW,maxLines){
 const lines=[];let line='';
 for(const ch of String(text||'')){if(line&&x.measureText(line+ch).width>maxW){lines.push(line);line=ch.trim()?ch:''}else line+=ch}
 if(line)lines.push(line);
 if(lines.length<=maxLines)return lines;
 const out=lines.slice(0,maxLines);let last=out[maxLines-1];while(last&&x.measureText(last+'…').width>maxW)last=last.slice(0,-1);out[maxLines-1]=last+'…';return out;
}
async function renderPdfPage(rows,type,pageNo,pages,total,logo,font){
 const mm=PDF_PX_PER_MM,W=Math.round(210*mm),H=Math.round(297*mm),pt=n=>n*.3528*mm;
 const images=new Array(rows.length);let next=0;
 await Promise.all(Array.from({length:Math.min(6,rows.length)},async()=>{while(next<rows.length){const i=next++;images[i]=await pdfImage(pdfCardText(rows[i],type).image)}}));
 const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
 x.fillStyle='#fff';x.fillRect(0,0,W,H);
 const left=10*mm,top=10*mm,inner=190*mm;
 if(logo)x.drawImage(logo,left,top,32*mm,4.2*mm);
 x.fillStyle='#151515';x.textBaseline='middle';x.font='700 '+pt(18)+'px '+font;
 x.fillText(catalogHeading(type),left+(logo?37*mm:0),top+2.1*mm);
 const gridTop=top+9.2*mm,gap=3*mm,cw=(inner-3*gap)/4,ch=58*mm;
 rows.forEach((item,i)=>{
  const t=pdfCardText(item,type),cx=left+(i%4)*(cw+gap),cy=gridTop+Math.floor(i/4)*(ch+gap),img=images[i];
  x.save();pdfRoundRect(x,cx,cy,cw,ch,2*mm);x.clip();x.fillStyle='#eee';x.fillRect(cx,cy,cw,cw);
  if(img){const iw=img.width,ih=img.height,s=Math.max(cw/iw,cw/ih),sw=cw/s,sh=cw/s;x.drawImage(img,(iw-sw)/2,(ih-sh)/2,sw,sh,cx,cy,cw,cw)}
  x.restore();
  x.strokeStyle='#ccc';x.lineWidth=Math.max(1,.26*mm);pdfRoundRect(x,cx,cy,cw,ch,2*mm);x.stroke();
  const tx=cx+2*mm,tw=cw-4*mm;let ty=cy+cw+1.5*mm;x.textBaseline='top';
  x.fillStyle='#151515';x.font='700 '+pt(10)+'px '+font;
  for(const line of pdfLines(x,t.title,tw,2)){x.fillText(line,tx,ty);ty+=pt(10)*1.25}
  x.fillStyle='#666';x.font=pt(6.5)+'px '+font;ty+=.6*mm;
  for(const sub of [t.sub,t.extra].filter(Boolean)){x.fillText(pdfLines(x,sub,tw,1)[0]||'',tx,ty);ty+=pt(6.5)*1.3}
 });
 images.forEach(img=>img&&img.close&&img.close());
 x.fillStyle='#666';x.font=pt(8)+'px '+font;x.textAlign='right';x.textBaseline='alphabetic';
 x.fillText('HYOSAN '+catalogFooterLabel(type)+' · '+total+'개 · '+(pageNo+1)+' / '+pages,left+inner,gridTop+4*ch+3*gap+4*mm+pt(8));
 const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.88));c.width=c.height=0;
 if(!blob)throw new Error('페이지 이미지를 만들 수 없습니다.');
 return {bytes:new Uint8Array(await blob.arrayBuffer()),w:W,h:H};
}
async function downloadCatalogPdf(rows,type){
 if(!rows.length)throw new Error('선택한 항목이 없습니다.');
 await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,2000))]);
 const font=getComputedStyle(document.body).fontFamily||'sans-serif';
 const logo=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src='assets/hyosan-lpl-logo-full.svg'});
 const pages=Math.ceil(rows.length/PDF_PAGE_SIZE),out=[];
 for(let p=0;p<pages;p++){
  actionStatus('PDF 만드는 중… '+(p+1)+' / '+pages+'쪽');
  out.push(await renderPdfPage(rows.slice(p*PDF_PAGE_SIZE,(p+1)*PDF_PAGE_SIZE),type,p,pages,rows.length,logo,font));
 }
 const d=new Date(),name='HYOSAN-'+({emboss:'EMBOSS',site:'SITE',pattern:'PATTERN',special:'SPECIAL'}[type]||'LPM')+'-'+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'.pdf';
 const url=URL.createObjectURL(pdfFromJpegs(out)),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);
 return 'PDF를 저장했습니다: '+name+' ('+rows.length+'개 · '+pages+'쪽)';
}
