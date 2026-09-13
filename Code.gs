const SPREADSHEET_ID='1RC-6ibPA86zaWOGt1rzgmQf9tLpT4OcgdI6K9XcUPTI';
const SHEET_NAMES={patterns:'PATTERN_DESIGN',lpm:'HYOSAN_LPM',emboss:'EMBOSS_PLATE',categories:'CATEGORIES',config:'CONFIG'};

function doGet(e){
  try{
    const action=(e&&e.parameter&&e.parameter.action)||'data';
    if(action==='data') return jsonOutput(getAllData_());
    return jsonOutput({ok:false,error:'Unknown action'});
  }catch(err){return jsonOutput({ok:false,error:String(err)})}
}

function doPost(e){
  try{
    const body=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    if(body.action==='exportToSlides') return jsonOutput(exportToSlides_(body.lpmId));
    return jsonOutput({ok:false,error:'Unknown action'});
  }catch(err){return jsonOutput({ok:false,error:String(err)})}
}

function getAllData_(){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  const out={patterns:readSheet_(ss,SHEET_NAMES.patterns),lpm:readSheet_(ss,SHEET_NAMES.lpm),emboss:readSheet_(ss,SHEET_NAMES.emboss),categories:readSheet_(ss,SHEET_NAMES.categories),config:{}};
  readSheet_(ss,SHEET_NAMES.config).forEach(r=>{if(r.KEY)out.config[r.KEY]=r.VALUE});
  readSheet_(ss,'RELATIONS').forEach(r=>{
    const p=out.patterns.find(x=>x.ID===r.Pattern_ID),l=out.lpm.find(x=>x.LPM_ID===r.LPM_ID);
    const add=(o,key,id)=>{if(o&&id)o[key]=Array.from(new Set(String(o[key]||'').split(',').map(x=>x.trim()).filter(Boolean).concat(id))).join(',')};
    add(p,'RelatedLPM_IDs',r.LPM_ID);add(p,'RecommendedEmbossPlate_IDs',r.EmbossPlate_ID);
    add(l,'RelatedPattern_IDs',r.Pattern_ID);add(l,'EmbossPlate_IDs',r.EmbossPlate_ID);
  });
  return out;
}

function readSheet_(ss,name){
  const sh=ss.getSheetByName(name); if(!sh) return [];
  const values=sh.getDataRange().getDisplayValues(); if(values.length<2) return [];
  const headers=values[0];
  return values.slice(1).filter(r=>r.some(v=>v!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}

function exportToSlides_(lpmId){
  if(!lpmId) throw new Error('lpmId is required');
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  const rows=readSheet_(ss,SHEET_NAMES.lpm); const item=rows.find(r=>r.LPM_ID===lpmId); if(!item) throw new Error('LPM not found: '+lpmId);
  const cfg={}; readSheet_(ss,SHEET_NAMES.config).forEach(r=>{if(r.KEY)cfg[r.KEY]=r.VALUE});
  let pres;
  if(cfg.SLIDES_DESTINATION_ID){pres=SlidesApp.openById(cfg.SLIDES_DESTINATION_ID)}else{pres=SlidesApp.create('HYOSAN LPM Export - '+item.ProductName)}
  const slide=pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  const W=pres.getPageWidth(),H=pres.getPageHeight();
  slide.insertShape(SlidesApp.ShapeType.RECTANGLE,0,0,W,H).getFill().setSolidFill('#F5F3EE');
  const slideImage=firstImageUrl_(item.ImageURL||item.PreviewImageURL);
  if(slideImage){try{slide.insertImage(slideImage,0,0,W*.58,H)}catch(e){}}
  const x=W*.62,w=W*.32;
  addText_(slide,item.ProductName||'',x,H*.12,w,40,15,true);
  addText_(slide,'품번',x,H*.27,w,18,11,true); addText_(slide,item.ProductCode||'-',x,H*.32,w,28,8,false);
  addText_(slide,'분류',x,H*.41,w,18,11,true); addText_(slide,(item.Category||'')+' / '+(item.SubCategory||''),x,H*.46,w,28,8,false);
  addText_(slide,'특징',x,H*.55,w,18,11,true); addText_(slide,item.Characteristics||'-',x,H*.60,w,45,8,false);
  addText_(slide,'형태 / 용도',x,H*.72,w,18,11,true); addText_(slide,(item.PatternForm||'-')+'\n'+(item.Applications||'-'),x,H*.77,w,55,8,false);
  if(pres.getSlides().length>1 && !cfg.SLIDES_DESTINATION_ID){pres.getSlides()[0].remove()}
  return {ok:true,presentationId:pres.getId(),url:pres.getUrl()};
}

function addText_(slide,text,x,y,w,h,size,bold){
  const box=slide.insertTextBox(String(text||''),x,y,w,h); const style=box.getText().getTextStyle(); style.setFontFamily('Noto Sans KR').setFontSize(size).setBold(!!bold).setForegroundColor('#171717'); return box;
}

function firstImageUrl_(value){
  return String(value||'').split(/[\r\n,;|]+/).map(v=>v.trim()).find(v=>/^https?:\/\//i.test(v))||'';
}

function jsonOutput(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
