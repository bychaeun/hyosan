/* 수주현황판 — 원본 ERP(수주현황판.scx, libs.vcx ctnsujustate)의 계산·배치·색을 그대로 옮긴 화면.
   데이터는 사무실 PC 동기화(automation/order-sync)가 30분마다 올린 ERP 조회 결과(orderBoard). */
var OrderBoard=(()=>{
 const OTOP=4,OLEFT=10,OHEIGHT=65,OGAP=5,WEEK='일월화수목금토',HOUR=3600e3;
 const txt=v=>String(v??'').trim();
 const num=v=>Number(v)||0;
 const vfpColor=n=>{n=num(n);return '#'+[n&255,(n>>8)&255,(n>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('')};
 const fmt=n=>Number(n||0).toLocaleString('en-US');
 const kst=ms=>{const d=new Date(ms+9*HOUR);return{y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),dow:d.getUTCDay()}};
 const ymd=p=>p.y+'-'+String(p.m).padStart(2,'0')+'-'+String(p.d).padStart(2,'0');

 /* ───── 계산 (um_loadstate / um_loadstate_comp / um_loadcomp / um_addwk / um_loadsum) ───── */
 /* ERP 프로시저(sp_LoadOrderstate2)처럼 방치된 옛날 수주는 뺀다:
    "오더접수·생산지시"에 멈춘 채 180일이 지났고 생산·출고 수량이 전혀 없는 건.
    실제 ERP 화면 대조: 101일 된 수주는 보이고(한솔홈데코 12844/12845) 249일 된 수주는 숨김(효산LPL G.T8분) */
 const STALE_DAYS=180,IDLE_STATES=['오더접수','생산지시'];
 function computeRegion(data,locate,now){
  now=now??Date.now();
  const ws=data.worksheet||[],ow=data.outwait||[],sd=new Set(data.sdrequest||[]);
  const active=new Set(ow.filter(r=>num(r.qnty)!==0).map(r=>r.sj_code));
  const isStale=o=>IDLE_STATES.includes(txt(o.state))&&o.ord_date&&Date.parse(o.ord_date)<now-STALE_DAYS*24*HOUR&&!active.has(o.sj_code);
  const orders=(data.orders||[]).filter(o=>o.locate_code===locate&&!isStale(o));
  const wkRemark=data.wkRemark||{},specColor=data.specColor||{},stColor=data.stColor||{};
  const todayKey=ymd(kst(now-6*HOUR));
  const items=[];

  const nounpaid=sj=>{let qnty=0,wait=0;for(const r of ow)if(r.sj_code===sj){if(r.out_code!=null&&r.up_code==null)qnty+=num(r.qnty);if(r.out_code==null)wait+=num(r.qnty)}return{qnty,wait}};
  const chipRuns=(qs,bg)=>{const out=[];let last=0;for(const q of qs){if(q!==last){out.push({q,n:1,bg});last=q}else out[out.length-1].n++}return out};

  function addwk(sj,mode){
   const chips=[];let sum=0,req=0,mach=0;
   if(mode===3){
    const qs=(data.icc||[]).filter(r=>r.sj_code===sj&&!r.up_code).map(r=>num(r.out_qnty));
    chips.push(...chipRuns(qs,'#00f0f0'));qs.forEach(q=>sum+=q);
    return{chips,sum,req:0,mach:0};
   }
   /* 송장발행 · 미불증 미등록: 청록칸 */
   const unpaid=ow.filter(r=>r.sj_code===sj&&r.mode===mode&&num(r.qnty)!==0&&r.out_code!=null&&r.up_code==null).map(r=>num(r.qnty)).sort((a,b)=>a-b);
   chips.push(...chipRuns(unpaid,'#00f0f0'));unpaid.forEach(q=>sum+=q);
   /* 출고대기: 노랑칸 (생산 지시가 아직 진행 중인 생산분은 제외) */
   const wait=ow.filter(r=>{
    if(r.sj_code!==sj||r.mode!==mode||num(r.qnty)===0||r.out_code!=null)return false;
    if(mode===1&&r.mode===1){const w=ws.find(x=>x.wk_code===r.wk_code);if(w&&w.end_time==null&&num(w.pd_req)<100)return false}
    return true;
   }).map(r=>num(r.qnty)).sort((a,b)=>a-b);
   chips.push(...chipRuns(wait,'#ffff00'));wait.forEach(q=>sum+=q);
   /* 지시수량: 파란 글씨 */
   for(const w of ws){
    if(w.sj_code!==sj||!(mode===2||num(w.mach_no)!==0))continue;
    if(mode===2)req+=w.stock_done==null?num(w.stock_req):num(w.stock_wk);
    else if(w.end_time==null)req+=num(w.pd_req);
    if(!mach&&mode===1&&num(w.mach_no)!==0&&w.end_time==null&&w.cancel_time==null)mach=num(w.mach_no);
    for(const r of ow)if(r.wk_code===w.wk_code&&r.mode===mode&&(mode===2||w.end_time!=null||num(w.pd_req)>=100))req-=num(r.qnty);
   }
   return{chips,sum,req,mach};
  }

  function orderCard(o,split){
   const sj=o.sj_code,isSd=sd.has(sj),nu=nounpaid(sj);
   const remain=isSd?num(o.ord_qnty)-num((data.sdOut||{})[sj]):num(o.ord_qnty)-num(o.out_qnty)+nu.qnty;
   let bg='#ffffff';
   if(o.order_time&&Date.parse(o.order_time)>now-HOUR)bg='#80ffff';      /* 수주입력 1시간 이내 */
   if(isSd)bg='#ff80ff';                                                    /* 사급요청 */
   let item=txt(o.item);if(txt(o.item)!==txt(o.pattern))item+='('+txt(o.pattern)+')';
   const outqnty='('+(o.comp_code!==o.tocomp_code&&!split?txt(o.comp_short)+',':'')+remain+')';
   let remark=txt(o.remark1)||null;
   if(Object.prototype.hasOwnProperty.call(wkRemark,sj))remark=txt(wkRemark[sj]);   /* 마지막 작업지시 비고 */
   const stock=isSd?addwk(sj,3):addwk(sj,2),pd=isSd?{chips:[],sum:0,req:0,mach:0}:addwk(sj,1);
   let state=null;
   if(o.cancel_time!=null){state={text:'취  소',color:'#ff0000'};bg='#c0c0c0'}
   else if(num(o.express)===1){state={text:'초긴급',color:'#ff8080'};bg='#80ff80'}
   else if(num(o.express)===2){state={text:'금  일',color:'#00ff00'};bg='#ffff00'}
   else if(num(o.express)===3){state={text:'보  류',color:'#80ffff'};bg='#acacff'}
   const specCode=txt(o.spec_code)||'100',stCode=txt(o.st_code)||'100';
   return{type:'order',sj,item,outqnty,bg,remark,state,
    spec:txt(o.spec),specB:specColor[specCode]!=null?vfpColor(specColor[specCode]):'#ffffff',specF:specCode==='100'?'#808080':'#000000',
    std:txt(o.standard),stF:stColor[stCode]!=null?vfpColor(stColor[stCode]):'#000000',
    stock,pd,producible:stock.sum+pd.sum>=remain,stockWk:stock.sum+stock.req,pdWk:pd.sum+pd.req};
  }

  function companyCard(t,comp,compName){
   const row=(data.todaylist||[]).find(r=>r.tocomp_code===t.code&&(comp?r.comp_code===comp:r.comp_code==null)&&((r.today&&txt(r.today).slice(0,10)>=todayKey)||(!r.today&&r.towhere!=null)));
   let today=null;
   if(row&&row.today){
    const day=txt(row.today).slice(0,10);
    if(day===todayKey)today='금일';
    else{const d=new Date(day+'T00:00:00Z');today=d.getUTCDate()+'일('+WEEK[d.getUTCDay()]+')'}
   }
   return{type:'comp',name:t.short+(compName?'('+compName+')':''),locatesub:t.locatesub,today,towhere:row&&txt(row.towhere)?txt(row.towhere):null};
  }

  function group(t,comp,compName){
   const excl=compName==='제외';
   const list=orders.filter(o=>o.tocomp_code===t.code&&(comp==null||(excl?!comp.includes(o.comp_code):o.comp_code===comp)));
   if(!list.length)return;
   const split=comp!=null&&!excl;
   items.push(companyCard(t,split?comp:null,split?compName:''));
   let remain=0,stock=0,pd=0;
   for(const o of list){
    const nu=nounpaid(o.sj_code);
    if(!(num(o.ord_qnty)-num(o.out_qnty)>0||nu.qnty!==0||nu.wait!==0))continue;   /* 출고 끝났어도 미불증 전이면 표시 */
    const card=orderCard(o,split);
    if(o.cancel_time==null)remain+=num(o.ord_qnty)-num(o.out_qnty);
    stock+=card.stockWk;pd+=card.pdWk;
    items.push(card);
   }
   if(remain>0)items.push({type:'sum',remain,stock,pd});
  }

  const tocomps=[],seen=new Set();
  for(const o of orders)if(!seen.has(o.tocomp_code)){seen.add(o.tocomp_code);tocomps.push({code:o.tocomp_code,short:txt(o.tocomp_short),locatesub:txt((data.locatesub||{})[o.tocomp_code])})}
  tocomps.sort((a,b)=>a.short<b.short?-1:a.short>b.short?1:a.code<b.code?-1:a.code>b.code?1:0);
  for(const t of tocomps){
   const sc=(data.statecomp||[]).filter(r=>r.tocomp_code===t.code).sort((a,b)=>num(a.id)-num(b.id));
   if(!sc.length)group(t,null,null);
   else{const listed=[];for(const r of sc){listed.push(r.comp_code);group(t,r.comp_code,txt(r.comp_short))}group(t,listed,'제외')}
  }
  return items;
 }

 /* ───── 그리기 (원본 좌표·크기·색) ───── */
 /* 글자 폭은 캔버스로 계산 — 라벨마다 화면 배치를 다시 하지 않아 휴대폰에서도 탭 전환이 바로 된다 */
 let measureCtx=null;const widthCache=new Map();
 function textWidth(text,size,weight){
  const key=weight+'|'+size+'|'+text;let w=widthCache.get(key);if(w!=null)return w;
  measureCtx??=document.createElement('canvas').getContext('2d');
  measureCtx.font=weight+' '+size+'px "Noto Sans KR","Malgun Gothic",sans-serif';
  w=Math.ceil(measureCtx.measureText(text).width*1.015)+1;widthCache.set(key,w);return w;   /* 화면 글자가 캔버스보다 약 1% 넓게 그려져 여유를 둠 */
 }
 function div(p,cls,z){const e=document.createElement('div');e.className=cls;if(z!=null)e.style.zIndex=z;p.appendChild(e);return e}
 function place(e,l,w){e._l=l;e.style.left=l+'px';if(w!=null){e._w=w;e.style.width=w+'px'}}
 function lbl(p,o){
  const e=div(p,'ob-lbl'+(o.w!=null?' ob-fix':''),o.z),t=o.txt??'';
  e.textContent=t;e.style.top=o.t+'px';e.style.color=o.c||'#000000';
  if(o.size)e.style.fontSize=o.size+'px';if(o.weight)e.style.fontWeight=o.weight;if(o.lh)e.style.lineHeight=o.lh+'px';
  if(o.w!=null){place(e,o.l,o.w);e.style.textAlign=o.align||'left'}
  else{place(e,o.l);e._w=textWidth(t,o.size||12,o.weight||700)}
  return e;
 }
 function shp(p,o){
  const e=div(p,'ob-shp',o.z);
  place(e,o.l,o.w);e.style.top=o.t+'px';e.style.height=o.h+'px';e.style.background=o.bg;
  if(o.bc)e.style.borderColor=o.bc;if(o.bw)e.style.borderWidth=o.bw+'px';if(o.r!=null)e.style.borderRadius=o.r+'px';
  return e;
 }
 const W=e=>e._w;
 function setWidth(c,bg){let w=0;for(const e of c.children){if(e===bg)continue;const r=e._l+e._w+5;if(r>w)w=r}c.style.width=w+'px';place(bg,0,w);return w}
 const card=(parent)=>{const c=document.createElement('div');c.className='ob-ctn';parent.appendChild(c);return c};

 function drawChips(c,T,wk){
  const top=T==='Stock'?16:31,ltop=T==='Stock'?18:33;let N=0,prevL=111,prevW=36;
  const slot=()=>{N++;return N===1?111:prevL+prevW+2};
  for(const x of wk.chips){
   const sl=slot(),s=shp(c,{l:sl,t:top,w:36,h:15,bg:x.bg,r:1,z:N<=2?14:30+N*2});
   const t=lbl(c,{l:sl+1,t:ltop,txt:x.q+(x.n>1?'×'+x.n:''),c:'#ff0000',z:N<=2?18:31+N*2});
   const w=W(t)+2;place(s,sl,w);prevL=sl;prevW=w;
  }
  if(wk.req>0){const sl=slot();lbl(c,{l:sl+1,t:ltop,txt:wk.req+(T==='Pd'&&wk.mach?' ('+wk.mach+'호기)':''),c:'#0000ff',z:31+N*2})}
 }
 function drawOrder(board,m){
  const c=card(board);
  const bg=shp(c,{l:0,t:0,w:190,h:50,bg:m.bg,bc:m.producible?'#ff0000':'#000000',bw:m.producible?2:1,r:3,z:1});
  const li=lbl(c,{l:6,t:4,txt:m.item,z:2});
  lbl(c,{l:6+W(li),t:4,txt:m.outqnty,c:'#8000ff',z:3});
  shp(c,{l:7,t:31,w:66,h:15,bg:'#eaeaf4',r:1,z:4});
  shp(c,{l:7,t:16,w:66,h:15,bg:m.specB,r:1,z:5});
  const st=m.state?lbl(c,{l:47,t:16,txt:m.state.text,c:m.state.color,size:30.67,weight:900,lh:38,z:7}):null;
  lbl(c,{l:8,t:33,w:64,align:'center',txt:m.std,c:m.stF,z:8});
  lbl(c,{l:8,t:18,w:64,align:'center',txt:m.spec,c:m.specF,z:9});
  lbl(c,{l:76,t:33,txt:'생산:',z:10});
  lbl(c,{l:76,t:18,txt:'재고:',z:11});
  if(m.remark)lbl(c,{l:4,t:51,txt:m.remark,c:'#ffff00',z:13});
  drawChips(c,'Stock',m.stock);drawChips(c,'Pd',m.pd);
  const w=setWidth(c,bg);if(st)place(st,(w-W(st))/2);
  return{el:c,w};
 }
 function drawComp(board,m){
  const c=card(board),isToday=m.today==='금일';
  const bg=shp(c,{l:0,t:0,w:190,h:50,bg:isToday?'#ff0000':'#000000',bc:'#000000',bw:1,r:3,z:1});
  const top=m.today?16:8;
  const nm=lbl(c,{l:5,t:top,txt:m.name,c:'#ffff00',size:26.67,weight:800,lh:34,z:6});
  if(m.today)lbl(c,{l:6,t:1,txt:m.today,c:isToday?'#000000':'#ff00ff',size:16,lh:20,z:12});
  if(m.towhere)lbl(c,{l:4,t:51,txt:m.towhere,c:'#00ff00',z:13});
  if(m.locatesub){
   const x=5+W(nm)+2,s=shp(c,{l:x,t:top,w:54,h:34,bg:'#80ffff',bc:'#ffff00',r:4,z:22});
   const t=lbl(c,{l:x+4,t:top+4,txt:m.locatesub,size:17.33,lh:25,z:23});
   place(s,x,W(t)+8);
  }
  return{el:c,w:setWidth(c,bg),comp:true};
 }
 function drawSum(board,m){
  const c=card(board);
  const bg=shp(c,{l:0,t:0,w:104,h:50,bg:'#e1c0ff',bc:'#0000ff',bw:2,r:3,z:1});
  lbl(c,{l:-9,t:4,w:64,align:'center',txt:'수주:',c:'#ff0000',z:9});
  lbl(c,{l:6,t:35,txt:'생산:',z:10});
  lbl(c,{l:6,t:20,txt:'재고:',z:11});
  for(const [stp,ltp,v,col] of [[2,4,fmt(m.remain),'#ff0000'],[18,20,m.stock?fmt(m.stock):'','#000000'],[33,35,m.pd?fmt(m.pd):'','#000000']]){
   shp(c,{l:41,t:stp,w:58,h:15,bg:'#ffff00',r:1,z:14});
   const t=lbl(c,{l:41,t:ltp,txt:v,c:col,z:18});
   place(t,41+Math.floor((58-W(t))/2));
  }
  return{el:c,w:setWidth(c,bg)};
 }
 /* um_arrangestate: 거래처마다 새 줄, 넘치면 들여쓰기 50으로 다음 줄 */
 function arrange(board,placed){
  const width=board.clientWidth;let line=0,pre=0;
  for(const it of placed){
   let left;
   if(it.comp){line++;left=OLEFT}
   else if(pre+it.w+OGAP<width)left=pre+OGAP;
   else{line++;left=OLEFT+50}
   it.el.style.left=left+'px';it.el.style.top=(OTOP+(line-1)*OHEIGHT)+'px';pre=left+it.w;
  }
  board.style.height=(OTOP+line*OHEIGHT+17)+'px';
 }

 function mount(root){
  root.classList.add('ob-root');root.replaceChildren();
  const band=div(root,'ob-band');band.setAttribute('role','tablist');band.setAttribute('aria-label','지역');
  const scroll=div(root,'ob-scroll'),board=div(scroll,'ob-board'),foot=div(root,'ob-foot');
  let data=null,dataKey=null,updatedAt=null,active=null,placed=[],pending=false,lastWidth=0;
  try{active=localStorage.getItem('hyosan-order-locate')}catch{}
  const visible=()=>board.offsetParent!==null&&board.clientWidth>0;
  function drawTabs(){
   band.replaceChildren();
   for(const loc of data.locates||[]){
    const b=document.createElement('button');b.type='button';b.className='ob-opt';b.textContent=txt(loc.name);
    b.setAttribute('role','tab');b.setAttribute('aria-selected',String(loc.code===active));
    b.onclick=()=>{active=loc.code;try{localStorage.setItem('hyosan-order-locate',active)}catch{}drawTabs();draw()};
    band.appendChild(b);
   }
  }
  function draw(){
   if(!data){board.replaceChildren();return}
   if(!visible()){pending=true;return}
   pending=false;placed=[];
   const frag=document.createDocumentFragment();   /* 화면 밖에서 다 만든 뒤 한 번에 붙임 */
   for(const m of computeRegion(data,active))placed.push(m.type==='comp'?drawComp(frag,m):m.type==='sum'?drawSum(frag,m):drawOrder(frag,m));
   board.replaceChildren(frag);arrange(board,placed);lastWidth=board.clientWidth;
   if(!placed.length)setStatus('이 지역은 현재 표시할 수주가 없습니다.');else setStatus();
  }
  function setStatus(message,isError){
   if(message){foot.textContent=message;foot.classList.toggle('ob-err',!!isError);return}
   foot.classList.remove('ob-err');
   if(!updatedAt){foot.textContent='';return}
   const t=new Date(updatedAt),mins=Math.round((Date.now()-t)/60000);
   foot.textContent='마지막 갱신 '+t.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})+(mins>=1?' ('+mins+'분 전)':'')+' · 10분마다 갱신';
   foot.classList.toggle('ob-stale',mins>30);
  }
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(!data)return;if(pending)draw();else if(board.clientWidth!==lastWidth&&board.clientWidth>0){lastWidth=board.clientWidth;arrange(board,placed)}}).observe(board);
  /* 한글 글꼴은 글자 묶음별로 늦게 내려받아진다 — 새로 받아지면 폭을 다시 재서 맞춘다 */
  let fontTimer=0;const refit=()=>{clearTimeout(fontTimer);fontTimer=setTimeout(()=>{widthCache.clear();if(data&&!pending)draw()},80)};
  document.fonts?.ready?.then(refit);document.fonts?.addEventListener?.('loadingdone',refit);
  return{
   /* key가 같으면(서버 데이터 그대로) 다시 그리지 않고 갱신 시각만 바꾼다 */
   setData(next,at,key){
    updatedAt=at||updatedAt;
    if(key&&key===dataKey&&data){setStatus();return}
    data=next;dataKey=key||null;
    const codes=(data.locates||[]).map(l=>l.code);
    if(!codes.includes(active))active=codes[0]||null;
    drawTabs();draw();
   },
   setStatus,
   redraw(){if(pending||!placed.length)draw();else setStatus()}
  };
 }

 return{computeRegion,mount,vfpColor};
})();
