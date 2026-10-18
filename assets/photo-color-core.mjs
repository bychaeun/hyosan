// Local pixel analysis only. No model, upload, or network requests.
export function lab({r,g,b}) {
 const [R,G,B]=[r,g,b].map(v=>{v/=255;return v>.04045?((v+.055)/1.055)**2.4:v/12.92});
 const f=v=>v>.008856?Math.cbrt(v):7.787*v+16/116;
 const x=f((R*.4124+G*.3576+B*.1805)/.95047),y=f(R*.2126+G*.7152+B*.0722),z=f((R*.0193+G*.1192+B*.9505)/1.08883);
 return {L:116*y-16,a:500*(x-y),b:200*(y-z)};
}
export const distance=(a,b)=>Math.hypot(a.L-b.L,a.a-b.a,a.b-b.b);
export const hex=rgb=>'#'+[rgb.r,rgb.g,rgb.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase();
export function extractPalette(pixels) {
 const buckets=new Map();let total=0;
 for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<128)continue;const r=pixels[i],g=pixels[i+1],b=pixels[i+2],key=(r>>4)*256+(g>>4)*16+(b>>4);let v=buckets.get(key);if(!v)buckets.set(key,v={r:0,g:0,b:0,n:0});v.r+=r;v.g+=g;v.b+=b;v.n++;total++}
 if(!total)throw new Error('사진에서 색상을 읽을 수 없습니다. 다른 사진을 선택해 주세요.');
 const bins=[...buckets.values()].map(v=>({r:v.r/v.n,g:v.g/v.n,b:v.b/v.n,n:v.n})).sort((a,b)=>b.n-a.n);
 const centers=[];for(const v of bins){if(!centers.length||centers.every(c=>distance(lab(c),lab(v))>18))centers.push({...v});if(centers.length===5)break}
 for(let pass=0;pass<8;pass++){
  const labs=centers.map(lab),sums=centers.map(()=>({r:0,g:0,b:0,n:0}));
  for(const v of bins){const l=lab(v);let k=0,best=Infinity;labs.forEach((c,i)=>{const d=distance(l,c);if(d<best){best=d;k=i}});const s=sums[k];s.r+=v.r*v.n;s.g+=v.g*v.n;s.b+=v.b*v.n;s.n+=v.n}
  sums.forEach((s,i)=>{if(s.n)centers[i]={r:s.r/s.n,g:s.g/s.n,b:s.b/s.n,n:s.n};else centers[i].n=0});
 }
 return centers.filter(c=>c.n>0).sort((a,b)=>b.n-a.n).map(c=>({hex:hex(c),lab:lab(c),weight:c.n/total}));
}
export function category(value){const raw=String(value||'').trim();if(!raw)return {code:'UNCLASSIFIED',label:'미분류'};const s=raw.toUpperCase();for(const [re,code,label] of [[/MARBLE|대리석/,'MARBLE','대리석'],[/WOOD|우드/,'WOOD','우드'],[/FABRIC|TEXTURE|패브릭|텍스처/,'FABRIC','패브릭'],[/STONE|스톤|TILE|타일/,'STONE','스톤 · 타일'],[/SOLID|솔리드/,'SOLID','솔리드']])if(re.test(s))return {code,label};return {code:s,label:raw}}
export function rank(entries,palette,selected='ALL') {
 if(!palette?.length)return [];
 return entries.filter(x=>selected==='ALL'||category(x.item.Category).code===selected).map(x=>{
  // Weighted distance to all major colors; score is a reference, not an accuracy probability.
  const d=palette.reduce((sum,p)=>sum+distance(p.lab,x.lab)*p.weight,0);
  return {...x.item,_photoDistance:d,_photoScore:Math.round(100*Math.exp(-d/35))};
 }).sort((a,b)=>a._photoDistance-b._photoDistance||String(a.LPM_ID).localeCompare(String(b.LPM_ID))).slice(0,60);
}
