/* ================= constants ================= */
const CONDITIONS=["Availability of materials (RMC, steel, dry materials)","Issue of GFC drawings / design decisions","Monsoon and adverse weather conditions","Pandemic or force majeure events","Local disturbances / statutory restrictions","Legal stoppages / statutory permissions","Seasonal labour shortage","Site logistics and access constraints","Delays due to MEP or other agency works","Delays in statutory inspections and approvals","Holidays will be added and schedule will be revised accordingly"];
const HCATS=["Materials (RMC, steel, dry materials)","GFC drawings / design decisions","Monsoon / weather","Force majeure","Local disturbances / statutory restrictions","Legal stoppage / permissions","Labour shortage","Site logistics / access","MEP or other agency works","Statutory inspections / approvals","Holiday","Other"];
const STAGES=[{k:"shuttering",n:"Shuttering"},{k:"reinforcement",n:"Reinforcement"},{k:"mep",n:"MEP sleeves & conduits"},{k:"prepour",n:"Pre-pour checks"},{k:"concreting",n:"Concreting"},{k:"cast",n:"Cast"}];
const CHECKS=[{k:"shutter",n:"Shuttering, props & levels checked"},{k:"steel",n:"Reinforcement checked by structural consultant"},{k:"cover",n:"Cover blocks & chairs in place"},{k:"mep",n:"MEP sleeves, conduits & inserts in place"},{k:"rmc",n:"RMC order & pump confirmed"},{k:"cubes",n:"Cube moulds & slump cone ready"},{k:"card",n:"Pour card signed"}];
const ACTS=[{k:"block",n:"Blockwork"},{k:"elec",n:"Electrical conduits"},{k:"plumb",n:"Plumbing"},{k:"iplaster",n:"Internal plaster"},{k:"wproof",n:"Waterproofing"},{k:"eplaster",n:"External plaster"},{k:"floor",n:"Flooring & tiling"},{k:"doors",n:"Doors & windows"},{k:"paint",n:"Painting"}];
const MATS=[{k:"rmc",n:"RMC",u:"m³"},{k:"steel",n:"Reinforcement steel",u:"MT"},{k:"cement",n:"Cement",u:"bags"},{k:"blocks",n:"AAC blocks",u:"nos"},{k:"sand",n:"Sand",u:"brass"},{k:"agg",n:"Aggregate",u:"brass"},{k:"other",n:"Other",u:""}];
const DEFAULT_TRADES=["Carpenter","Steel fixer","Helper / labour","Mason","Welder","Excavator operator"];
const WEATHER=["Clear","Light rain","Heavy rain — work stopped"];
const VIEWS=[["overview","Overview"],["reports","Reports"],["dpr","Daily reports"],["slabs","Slab cycle"],["works","Floor-wise works"],["materials","Materials"],["issues","Hindrances"],["today","Staff view"]];
// Site Engineers and the Site Team (can update, not the Site Head) start on the simple Today page
// and see only that tab, unless they choose to open the full dashboard on this phone.
let SHOW_ALL=false;try{SHOW_ALL=localStorage.getItem("dsSiteFull")==="1";}catch(e){}
const staffMode=()=>S.canWrite!==false&&!S.canEdit&&!SHOW_ALL;
const navViews=()=>staffMode()?[["today","Today"]]:VIEWS;
const homeView=()=>staffMode()?"today":"overview";
document.getElementById("conds").innerHTML=CONDITIONS.map(c=>`<li>${c}</li>`).join("");

/* ================= helpers ================= */
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DAY=864e5, MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], WD=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const d2n=iso=>iso?Math.round(Date.parse(iso+"T00:00:00Z")/DAY):null;
const n2d=n=>new Date(n*DAY).toISOString().slice(0,10);
const todayIso=()=>{const t=new Date();return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`};
const fmt=iso=>{if(!iso)return"—";const[y,m,d]=iso.split("-");return `${d} ${MON[+m-1]} ${y}`};
const fmtS=iso=>{if(!iso)return"—";const[,m,d]=iso.split("-");return `${+d} ${MON[+m-1]}`};
const fmtN=n=>n==null?"—":fmt(n2d(n));
const wd=iso=>WD[new Date(iso+"T00:00:00Z").getUTCDay()];
const ago=ts=>{if(!ts)return"";const s=(Date.now()-Date.parse(ts))/1000;if(!isFinite(s))return"";if(s<90)return"just now";if(s<3600)return Math.round(s/60)+" min ago";if(s<86400)return Math.round(s/3600)+" h ago";const d=Math.round(s/86400);return d<30?d+(d===1?" day ago":" days ago"):fmt(ts.slice(0,10))};
const plural=(n,w)=>`${n} ${w}${n===1?"":"s"}`;
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const fmtQty=n=>(Math.round(n*100)/100).toLocaleString("en-IN");

/* ================= state ================= */
const S={towers:[],progress:{},hind:[],dpr:{},dprExtra:{},mats:{},works:{},worksPending:{},worksTimer:{},
  canWrite:null,canEdit:false,me:null,user:null,db:null,
  view:"overview",tab:null,filter:"all",dprDate:null,worksTab:null,
  loaded:{t:false,p:false}};
const tcol=k=>{const i=S.towers.findIndex(t=>t.key===k);return ["var(--t1)","var(--t2)","var(--t3)"][i]||"var(--muted)"};
const tname=k=>k==="sale"?"Sale building (A + B)":k==="site"?"Site-wide":((S.towers.find(t=>t.key===k)||{}).name||k);
const TAGS=()=>[...S.towers.map(t=>[t.key,t.name]),["sale","Sale building (A + B)"],["site","Site-wide"]];
const canW=()=>S.canWrite!==false;

/* ================= schedule maths ================= */
function stageIdx(p){if(!p)return -1;if(p.status==="cast")return STAGES.length-1;const i=STAGES.findIndex(s=>s.k===p.stage);return p.status==="progress"?Math.max(i,0):-1;}
function stageName(p){const i=stageIdx(p);return i<0?"Not started":STAGES[i].n;}
function compute(t){
  const T=d2n(todayIso());
  let cursor=null;
  const rows=[...t.slabs].sort((a,b)=>a.seq-b.seq).map(s=>{
    const p=S.progress[s.id]||{};
    const status=p.status||"pending";
    const hol=+p.holidays||0, days=s.days||0;
    const ps=d2n(s.planStart), pe=d2n(s.planEnd);
    let fs,fe;
    if(status==="cast"){fe=d2n(p.actualEnd)??pe;fs=d2n(p.actualStart)??ps??fe;}
    else if(status==="progress"){fs=d2n(p.actualStart)??(cursor!=null?cursor+1:ps)??T;fe=Math.max(fs+days+hol,T);}
    else{fs=Math.max(cursor!=null?cursor+1:(ps??T),T);fe=fs+days+hol;}
    cursor=fe;
    const variance=pe!=null?fe-pe:0;
    let flag="ok";
    if(status==="cast")flag=variance>0?"late":"ok";
    else if(status==="progress")flag=T>pe?"overdue":(variance>0?"behind":"ok");
    else flag=(ps!=null&&T>ps)?"latestart":(variance>0?"behind":"ok");
    return {...s,p,status,hol,fs,fe,ps,pe,variance,flag};
  });
  const cast=rows.filter(r=>r.status==="cast").length;
  const cur=rows.find(r=>r.status!=="cast")||null;
  const last=rows[rows.length-1];
  const planDone=rows.filter(r=>r.pe!=null&&r.pe<=T).length;
  const lastUpd=rows.map(r=>r.p.updatedAt).filter(Boolean).sort().pop()||null;
  let phase;
  if(rows[0].status!=="cast")phase="Substructure · excavation, raft & plinth";
  else if(cur&&!cur.name.startsWith("OHT"))phase=`Superstructure · ${cur.name}`;
  else if(cur)phase="Superstructure · OHT / LMR";
  else phase="Structure complete · finishing";
  return {t,rows,cast,cur,last,delay:last.fe-last.pe,planDone,lastUpd,T,phase};
}
function statusPill(r){
  if(r.status==="cast")return r.variance>0?`<span class="pill castlate">Cast · ${r.variance}d late</span>`:`<span class="pill cast">Cast</span>`;
  if(r.status==="progress")return `<span class="pill ${r.flag==="overdue"?"late":"prog"}">${r.flag==="overdue"?"Overdue · ":""}${esc(stageName(r.p))}</span>`;
  if(r.flag==="latestart")return `<span class="pill late">Start not recorded</span>`;
  return `<span class="pill sched">Scheduled</span>`;
}
function delayChip(d){
  if(d<=0)return `<span class="delay ok">${d<0?`${-d} days ahead`:"On schedule"}</span>`;
  return `<span class="delay ${d>15?"bad":"warn"}">${plural(d,"day")} behind</span>`;
}
function stepper(p){
  const i=stageIdx(p);
  return `<div class="stepper" aria-hidden="true">${STAGES.map((s,j)=>`<span class="${j<i||(j===i&&s.k==="cast")?"done":j===i?"now":""}"></span>`).join("")}</div>
  <div class="steplbl"><span>Stage <b>${esc(stageName(p))}</b></span><span>${i>=0?`${Math.min(i+1,STAGES.length)} of ${STAGES.length}`:""}</span></div>`;
}

/* ================= DPR helpers ================= */
function getDpr(date){return S.dpr[date]||S.dprExtra[date]||null;}

/* ================= drawings ================= */
function elevation(c){
  const n=c.rows.length, W=96, fh=Math.max(5,Math.min(8,340/n)), gap=1.2, bw=58, x0=18, H=n*fh+16;
  const y=i=>H-8-(i+1)*fh;
  let g="";
  c.rows.forEach((r,i)=>{
    let fill="var(--surface)",stroke="var(--line-strong)",dash="";
    if(r.status==="cast"){fill=r.variance>0?"var(--late)":tcol(c.t.key);stroke="none";}
    else if(r.status==="progress"){fill="var(--prog-fill)";stroke="none";}
    else if(r.flag==="latestart"){stroke="var(--late)";dash=' stroke-dasharray="3 2"';}
    const top=r.name.startsWith("OHT")?bw*.45:bw;
    g+=`<rect x="${x0+(bw-top)/2}" y="${y(i)+gap/2}" width="${top}" height="${fh-gap}" rx="1" fill="${fill}" stroke="${stroke}" stroke-width="1"${dash}><title>${esc(r.name)} — ${r.status==="cast"?"cast "+fmtN(r.fe):r.status==="progress"?stageName(r.p):"planned "+fmtN(r.pe)}</title></rect>`;
    if(i%10===0&&i>0)g+=`<text x="${x0-4}" y="${y(i)+fh-1}" text-anchor="end" font-size="8" font-family="Schibsted Grotesk,sans-serif" fill="var(--faint)">${i}</text>`;
  });
  g+=`<line x1="2" x2="${W}" y1="${H-8}" y2="${H-8}" stroke="var(--ink)" stroke-width="1.5"/>`;
  if(c.planDone>0){const py=y(c.planDone-1);
    g+=`<line x1="${x0-3}" x2="${x0+bw+4}" y1="${py}" y2="${py}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${x0+bw+5}" y="${py+3}" font-size="8" font-family="Schibsted Grotesk,sans-serif" fill="var(--accent)">plan</text>`;}
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.t.name)}: ${c.cast} of ${n} slabs cast">${g}</svg>`;
}
function curve(cs){
  const W=1000,H=300,L=44,R=16,Tp=14,B=34;
  const all=cs.flatMap(c=>c.rows.flatMap(r=>[r.pe,r.fe,r.ps].filter(v=>v!=null)));
  const x0=Math.min(...all)-10, x1=Math.max(...all)+10;
  const yMax=Math.ceil(Math.max(...cs.map(c=>c.rows.length))/12)*12;
  const X=n=>L+(n-x0)/(x1-x0)*(W-L-R), Y=v=>H-B-v/yMax*(H-B-Tp);
  let g="";
  for(let v=0;v<=yMax;v+=12)g+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L-8}" y="${Y(v)+4}" text-anchor="end">${v}</text>`;
  const d0=new Date(x0*DAY);let yy=d0.getUTCFullYear(),mm=d0.getUTCMonth()<6?6:12;if(mm===12){yy++;mm=0;}
  for(;;){const n=Math.round(Date.UTC(yy,mm,1)/DAY);if(n>x1)break;
    g+=`<line x1="${X(n)}" x2="${X(n)}" y1="${Tp}" y2="${H-B}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${X(n)}" y="${H-B+18}" text-anchor="middle">${MON[mm]} ${String(yy).slice(2)}</text>`;
    mm+=6;if(mm>=12){mm-=12;yy++;}}
  const step=pts=>{let d="",prev=0;pts.forEach(([x,v],i)=>{d+=(i?`L${X(x)},${Y(prev)}`:`M${X(x)},${Y(0)}`)+`L${X(x)},${Y(v)}`;prev=v;});return d;};
  cs.forEach(c=>{
    const col=tcol(c.t.key);
    g+=`<path d="${step(c.rows.filter(r=>r.pe!=null).map((r,i)=>[r.pe,i+1]))}" fill="none" stroke="${col}" stroke-width="1.5" stroke-opacity=".45" stroke-dasharray="5 4"/>`;
    const actual=c.rows.filter(r=>r.status==="cast").map((r,i)=>[r.fe,i+1]);
    const fc=c.rows.map((r,i)=>[r.fe,i+1]).slice(actual.length);
    if(actual.length)g+=`<path d="${step(actual)}" fill="none" stroke="${col}" stroke-width="2.75"/>`;
    if(fc.length){const sv=actual.length,sx=Math.max(actual.length?actual[sv-1][0]:c.T,c.T);let d=`M${X(sx)},${Y(sv)}`,prev=sv;fc.forEach(([x,v])=>{d+=`L${X(x)},${Y(prev)}L${X(x)},${Y(v)}`;prev=v;});
      g+=`<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="1.5 3" stroke-linecap="round"/>`;}
    g+=`<circle cx="${X(c.last.fe)}" cy="${Y(c.rows.length)}" r="4" fill="${col}"/>`;
  });
  const tx=X(cs[0].T);
  g+=`<line x1="${tx}" x2="${tx}" y1="${Tp}" y2="${H-B}" stroke="var(--ink)" stroke-width="1.25"/><text x="${tx+5}" y="${Tp+10}" style="fill:var(--ink)">Today</text><line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" stroke="var(--line-strong)"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative slabs cast, planned versus actual and forecast">${g}</svg>`;
}
function manpowerChart(sel){
  const T=d2n(todayIso()),N=30,W=1000,H=200,L=40,R=10,Tp=12,B=30;
  const days=[...Array(N)].map((_,i)=>n2d(T-N+1+i));
  const vals=days.map(d=>{const r=getDpr(d);return r?+r.total||0:null});
  const mx=Math.max(50,...vals.filter(v=>v!=null));const yMax=Math.ceil(mx/50)*50;
  const bw=(W-L-R)/N, Y=v=>H-B-v/yMax*(H-B-Tp);
  let g="";
  for(let v=0;v<=yMax;v+=yMax/4)g+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L-6}" y="${Y(v)+4}" text-anchor="end">${v}</text>`;
  days.forEach((d,i)=>{const x=L+i*bw,v=vals[i],on=d===S.dprDate;
    if(v!=null)g+=`<rect data-day="${d}" x="${x+bw*.15}" y="${Y(v)}" width="${bw*.7}" height="${Math.max(1,H-B-Y(v))}" rx="2" fill="${on?"var(--prog-fill)":"var(--accent)"}" style="cursor:pointer"><title>${fmt(d)}: ${v} workers</title></rect>`;
    else g+=`<rect data-day="${d}" x="${x+bw*.15}" y="${H-B-3}" width="${bw*.7}" height="3" fill="var(--late)" opacity=".5" style="cursor:pointer"><title>${fmt(d)}: no DPR</title></rect>`;
    if((N-1-i)%5===0)g+=`<text x="${x+bw/2}" y="${H-B+18}" text-anchor="middle">${fmtS(d)}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Manpower on site, last 30 days">${g}</svg>`;
}

/* ================= views ================= */
function render(){
  if(!(S.loaded.t&&S.loaded.p))return;
  const app=$("#app");
  if(!S.towers.length){app.innerHTML=`<div class="notice">No schedule has been loaded yet.</div>`;return;}
  const cs=S.towers.map(compute);
  if(!S.tab||!cs.find(c=>c.t.key===S.tab))S.tab=cs[0].t.key;
  if(!S.worksTab||!cs.find(c=>c.t.key===S.worksTab))S.worksTab=cs[0].t.key;
  if(!S.dprDate)S.dprDate=todayIso();
  const t0=S.towers[0];
  $("#meta").innerHTML=`<span>Client <b>${esc(t0.client)}</b></span><span>Contractor <b>${esc(t0.contractor)}</b></span><span>Baseline <b>${fmt(t0.baselineDate)}</b></span><span>Today <b>${wd(todayIso())} ${fmt(todayIso())}</b></span><span>Buildings <b>${S.towers.map(t=>esc(t.name)).join(", ")}</b></span>`;
  if(!navViews().some(v=>v[0]===S.view))S.view=homeView();
  const simple=S.view==="today";
  $("#meta").hidden=simple;$(".conds").hidden=simple;
  $("#nav").innerHTML=navViews().map(([k,l])=>`<a href="#${k}" data-view="${k}" ${S.view===k?'aria-current="page"':""}>${icon(k)}${l}</a>`).join("");
  $("#dprBtn").innerHTML=`${icon("dpr")}${getDpr(todayIso())?"Today's DPR":"Submit DPR"}`;
  $("#dprBtn").hidden=!canW()||simple;
  const fn={today:vToday,overview:vOverview,reports:vReports,dpr:vDpr,slabs:vSlabs,works:vWorks,materials:vMaterials,issues:vIssues}[S.view]||vOverview;
  app.innerHTML=`<div class="view">${fn(cs)}</div>`;
  if(S.view==="issues"||S.view==="overview")renderFeed();
  if(simple)renderTodayName();
}

const IC={
  overview:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  dpr:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M9 10h6M9 14h6M9 18h3"/>',
  slabs:'<path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="M2 13l10 5 10-5M2 17.5l10 5 10-5"/>',
  works:'<path d="M4 21V5l8-3v19M12 21V9l8 3v9M2 21h20M7 8h2M7 12h2M7 16h2M15 14h2M15 18h2"/>',
  materials:'<path d="M2 6h12v10H2zM14 9h4l3.5 3.5V16H14"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  issues:'<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.3v.2"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2c2.6.3 4.5 2.6 4.5 5.8"/>',
  box:'<path d="M12 2 3 7v10l9 5 9-5V7l-9-5z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
  steel:'<path d="M4 20 20 4M9 20 20 9M4 15 15 4"/>',
  mixer:'<path d="M3 17h13M5 17V9h6l3 4v4"/><circle cx="7" cy="18.5" r="1.6"/><circle cx="14" cy="18.5" r="1.6"/><path d="M15 12l5-5 1.5 1.5-5 5"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  reports:'<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>'
};
const icon=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]||""}</svg>`;
function ring(done,total,col){const r=26,C=2*Math.PI*r,p=total?done/total:0;
  return `<svg class="ring" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="${r}" fill="none" stroke="#EEF0EC" stroke-width="8"/>${p>0?`<circle cx="34" cy="34" r="${r}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${Math.max(C*p,1).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 34 34)"/>`:""}<text x="34" y="39" text-anchor="middle" font-size="15" font-weight="800" fill="#140C59">${Math.round(p*100)}%</text></svg>`;}
function vOverview(cs){
  const today=todayIso(), dt=getDpr(today);
  const lastDpr=Object.keys(S.dpr).sort().pop();
  const openH=S.hind.filter(h=>h.status!=="resolved");
  const totalCast=cs.reduce((a,c)=>a+c.cast,0), totalSlabs=cs.reduce((a,c)=>a+c.rows.length,0);
  const {st:mst}=matStats();
  const kpis=`<section class="kpis">
    <div class="kpi ${dt?"":"alert"}" style="--tone:var(--t1);--tint:#E3ECF5"><span class="ic">${icon("users")}</span><span class="eyebrow">Manpower today</span><span class="v">${dt?`${dt.total||0}<small> nos</small>`:"No DPR"}</span><span class="s">${dt?`${(dt.work||[]).length} activities · ${esc(dt.weather||"")}`:lastDpr?`Last report ${fmt(lastDpr)}`:"Waiting for today's report"}</span></div>
    <div class="kpi" style="--tone:var(--ink);--tint:#E8E7F3"><span class="ic">${icon("slabs")}</span><span class="eyebrow">Slabs cast</span><span class="v">${totalCast}<small> / ${totalSlabs}</small></span><span class="s">Across A-Wing, B-Wing and Rehab</span></div>
    <div class="kpi ${openH.length?"alert":""}" style="--tone:var(--ok);--tint:var(--ok-soft)"><span class="ic">${icon("issues")}</span><span class="eyebrow">Open hindrances</span><span class="v">${openH.length}</span><span class="s">${openH.length?esc(openH[0].category):"Nothing blocking work"}</span></div>
    <div class="kpi" style="--tone:var(--t2);--tint:#EEE8F4"><span class="ic">${icon("steel")}</span><span class="eyebrow">Steel on site</span><span class="v">${fmtQty(mst.steel.inAll-mst.steel.usedAll)}<small> MT</small></span><span class="s">${fmtQty(mst.steel.usedAll)} MT used to date</span></div>
    <div class="kpi" style="--tone:var(--t3);--tint:#DFF3F5"><span class="ic">${icon("mixer")}</span><span class="eyebrow">RMC poured</span><span class="v">${fmtQty(mst.rmc.usedAll)}<small> m³</small></span><span class="s">${fmtQty(mst.rmc.inAll)} m³ received to date</span></div>
  </section>`;
  const quick=canW()?`<section class="quick">
    <button class="qa main" data-dpr="today"><span class="ic">${icon("dpr")}</span><span class="qt"><b>${dt?"Edit today's DPR":"Submit today's DPR"}</b><span class="qs">Labour, work done and issues</span></span></button>
    <button class="qa" data-newmat="in" style="--tone:var(--t2);--tint:#EEE8F4"><span class="ic">${icon("materials")}</span><span class="qt"><b>Steel / RMC received</b><span class="qs">Log a delivery with challan</span></span></button>
    <button class="qa" data-newmat="used" style="--tone:var(--t3);--tint:#DFF3F5"><span class="ic">${icon("box")}</span><span class="qt"><b>Material used</b><span class="qs">Steel issued, RMC poured</span></span></button>
    <button class="qa" data-newh="1" style="--tone:var(--late);--tint:var(--late-soft)"><span class="ic">${icon("issues")}</span><span class="qt"><b>Log hindrance</b><span class="qs">Anything holding up work</span></span></button>
  </section>`:"";
  const cards=cs.map(c=>{
    const cur=c.cur, oh=openH.filter(h=>h.tower===c.t.key).length, col=tcol(c.t.key);
    const work=dt?(dt.work||[]).filter(w=>w.tag===c.t.key||(w.tag==="sale"&&c.t.building==="Sale Tower")):[];
    return `<article class="tower" style="--wc:${col}">
      <div class="tower-head"><div><h2>${esc(c.t.name)}</h2><div class="sub2">${c.t.building&&c.t.building!==c.t.name?esc(c.t.building)+" · ":""}${c.rows.length} slabs incl. OHT/LMR</div></div>${delayChip(c.delay)}</div>
      <div class="tower-body">
        <div class="elev">${elevation(c)}</div>
        <div class="tstats">
          <div class="ringrow">${ring(c.cast,c.rows.length,col)}<div><div class="phase">${esc(c.phase)}</div><div class="big">${c.cast}<small> of ${c.rows.length} cast</small></div></div></div>
          <dl class="kv">
            <dt>Plan by today</dt><dd>${c.planDone} cast</dd>
            <dt>Completion</dt><dd>${fmtN(c.last.fe)} <span class="muted" style="font-size:12.5px;font-weight:500">plan ${fmtN(c.last.pe)}</span></dd>
            <dt>Hindrances</dt><dd>${oh?`<span style="color:var(--late)">${oh} open</span>`:"None open"}</dd>
            <dt>Last update</dt><dd>${c.lastUpd?ago(c.lastUpd):"<span class='muted' style='font-weight:500'>No site update yet</span>"}</dd>
          </dl>
          ${cur?`<div class="cur">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between"><span class="name">${esc(cur.name)}</span>${statusPill(cur)}</div>
            ${stepper(cur.p)}
            <dl class="kv" style="font-size:13px">
              <dt>Start</dt><dd>${cur.p.actualStart?fmt(cur.p.actualStart):`<span style="color:${cur.flag==="latestart"?"var(--late)":"var(--muted)"};font-weight:500">Not recorded</span>`} <span class="muted" style="font-weight:500">· plan ${fmt(cur.planStart)}</span></dd>
              <dt>End</dt><dd>${fmtN(cur.fe)} <span class="muted" style="font-weight:500">forecast · plan ${fmt(cur.planEnd)}</span></dd>
            </dl>
            ${canW()?`<div><button class="btn primary small" data-edit="${cur.id}">${icon("check")}Update dates &amp; stage</button></div>`:""}
          </div>`:""}
        </div>
      </div>
      ${c.t.baselineNote?`<div class="tw-note">${esc(c.t.baselineNote)}</div>`:""}
      ${work.length?`<div class="today-work"><span class="eyebrow">Work today (from DPR)</span><ul>${work.slice(0,5).map(w=>`<li>${esc(w.text)}</li>`).join("")}${work.length>5?`<li class="muted">and ${work.length-5} more</li>`:""}</ul></div>`:""}
    </article>`;}).join("");
  const look=cs.flatMap(c=>c.rows.filter(r=>r.status!=="cast"&&r.fs<=c.T+21).map(r=>({c,r}))).sort((a,b)=>a.r.fe-b.r.fe);
  const lookRows=look.map(({c,r})=>`<tr ${canW()?`class="click" data-edit="${r.id}"`:""}><td><span class="swatch" style="background:${tcol(c.t.key)}"></span>${esc(c.t.name)}</td><td><b>${esc(r.name)}</b></td><td>${statusPill(r)}</td><td>${fmtN(r.fe)}</td><td class="muted">${fmtN(r.pe)}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">Nothing due in the next 3 weeks.</td></tr>`;
  return `${quick}${kpis}<section class="towers" aria-label="Buildings">${cards}</section>
    <section class="panel">
      <div class="panel-head"><div><h3>Slabs cast over time</h3><p>Baseline from the schedule dated ${fmt(S.towers[0].baselineDate)}. The forecast moves every later slab by the current slip.</p></div></div>
      <div class="legend">${cs.map(c=>`<span><svg width="26" height="8"><line x1="0" x2="26" y1="4" y2="4" stroke="${tcol(c.t.key)}" stroke-width="3"/></svg>${esc(c.t.name)}</span>`).join("")}
        <span><svg width="26" height="8"><line x1="0" x2="26" y1="4" y2="4" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4" stroke-opacity=".6"/></svg>Baseline</span><span><svg width="26" height="8"><line x1="0" x2="26" y1="4" y2="4" stroke="var(--muted)" stroke-width="2.75"/></svg>Actual</span><span><svg width="26" height="8"><line x1="1" x2="26" y1="4" y2="4" stroke="var(--muted)" stroke-width="2" stroke-dasharray="1.5 3" stroke-linecap="round"/></svg>Forecast</span></div>
      <div class="chart">${curve(cs)}</div>
    </section>
    <div class="two">
      <section class="panel"><div class="panel-head"><div><h3>3-week look-ahead</h3><p>Slabs in progress or due to start by ${fmtN(cs[0].T+21)}.</p></div></div>
        <div class="tablewrap"><table style="min-width:520px"><thead><tr><th>Building</th><th>Slab</th><th>Stage</th><th>Forecast cast</th><th>Plan cast</th></tr></thead><tbody>${lookRows}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><h3>Recent site activity</h3></div><ul class="feed" id="feed"></ul></section>
    </div>`;
}

function vDpr(){
  const T=d2n(todayIso());
  const strip=[...Array(14)].map((_,i)=>n2d(T-i)).map(d=>{const r=getDpr(d);
    return `<button class="day ${r?"":"miss"}" data-day="${d}" aria-pressed="${d===S.dprDate}"><span class="d">${d===todayIso()?"Today":wd(d)+" "+fmtS(d)}</span><span class="c">${r?(r.total||0)+" men":"no DPR"}</span></button>`}).join("");
  const d=getDpr(S.dprDate);
  let body;
  if(!d){
    body=`<div class="notice" style="display:grid;gap:12px;justify-items:start">
      <div><b style="color:var(--ink)">No DPR for ${wd(S.dprDate)} ${fmt(S.dprDate)}.</b> ${S.dprDate===todayIso()?"The site team submits it at the end of the day.":""}</div>
      ${canW()?`<button class="btn primary" data-dpr="${S.dprDate}">Add DPR for ${fmtS(S.dprDate)}</button>`:""}</div>`;
  }else{
    const mx=Math.max(1,...(d.labour||[]).map(l=>+l.count||0));
    const groups=TAGS().map(([k,name])=>{const items=(d.work||[]).filter(w=>w.tag===k);return items.length?`<div class="workgroup" style="--wc:${k==="sale"?"var(--ink)":k==="site"?"var(--muted)":tcol(k)}"><h4>${esc(name)}</h4><ol>${items.map(w=>`<li>${esc(w.text)}</li>`).join("")}</ol></div>`:""}).join("");
    body=`<div class="two">
      <section class="panel dpr-card">
        <div class="panel-head"><div><div class="eyebrow">${esc(d.contractor||"")}</div><h3>${wd(d.date)} ${fmt(d.date)}</h3></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${canW()?`<button class="btn small" data-dpr="${d.date}">Edit</button>`:""}${S.canEdit?`<button class="btn small ghost" data-deldpr="${d.date}" style="color:var(--late)">Delete</button>`:""}</div></div>
        <div class="dprhero">
          <div><div class="eyebrow">Manpower</div><div class="big">${d.total||0}<small> nos</small></div></div>
          <div><div class="eyebrow">Activities</div><div class="big">${(d.work||[]).length}</div></div>
          <div><div class="eyebrow">Weather</div><div style="font-weight:700;color:var(--ink);margin-top:6px">${esc(d.weather||"—")}</div></div>
        </div>
        <div class="tradebars">${(d.labour||[]).filter(l=>+l.count>0).map(l=>`<div class="tradebar"><span>${esc(l.trade)}</span><span class="bar"><i style="width:${(+l.count/mx*100).toFixed(1)}%"></i></span><span class="n">${+l.count}</span></div>`).join("")||`<span class="muted">No labour entered.</span>`}</div>
        ${(()=>{const its=matEntries().filter(i=>i.date===d.date);return its.length?`<div class="sect"><div class="eyebrow">Materials this day</div><ul style="margin:0;padding-left:18px;font-size:14px">${its.map(i=>{const m=MATS.find(x=>x.k===i.material)||MATS[6];return `<li>${i.type==="used"?"Used":"Received"} ${fmtQty(+i.qty||0)} ${esc(i.unit||m.u)} ${esc(i.material==="other"?i.spec:m.n)} · ${esc(tname(i.tower))}</li>`}).join("")}</ul></div>`:""})()}
        <div class="submeta" id="dprBy" data-by="${esc(d.updatedBy||d.submittedBy||"")}">Submitted ${ago(d.submittedAt)}${d.updatedAt&&d.updatedAt!==d.submittedAt?` · edited ${ago(d.updatedAt)}`:""}</div>
      </section>
      <section class="panel" style="gap:12px"><h3>Work done</h3>${groups||`<span class="muted">No work entered.</span>`}
        ${d.issues?`<div class="sect"><div class="eyebrow">Issues / hindrances</div><p class="textblock">${esc(d.issues)}</p></div>`:""}
        ${d.safety?`<div class="sect"><div class="eyebrow">Safety</div><p class="textblock">${esc(d.safety)}</p></div>`:""}
        ${d.tomorrow?`<div class="sect"><div class="eyebrow">Plan for tomorrow</div><p class="textblock">${esc(d.tomorrow)}</p></div>`:""}
      </section></div>`;
  }
  const rep=Object.keys(S.dpr).filter(k=>d2n(k)>T-30);
  const avg=rep.length?Math.round(rep.reduce((a,k)=>a+(+S.dpr[k].total||0),0)/rep.length):0;
  return `<section class="panel">
      <div class="panel-head"><div><h3>Daily progress reports</h3><p>The site head submits one report each day. Management sees it here as soon as it is saved.</p></div>
        <div style="display:flex;gap:8px;align-items:center"><label class="hint" for="dprPick">Go to date</label><input type="date" id="dprPick" max="${todayIso()}" value="${S.dprDate}" style="border:1px solid var(--line-strong);border-radius:6px;padding:6px 8px;background:var(--surface)"></div></div>
      <div class="daystrip">${strip}</div>
    </section>
    ${body}
    <section class="panel">
      <div class="panel-head"><div><h3>Manpower on site, last 30 days</h3><p>${rep.length} of 30 days reported · average ${avg} workers a day. Red ticks are days with no DPR. Click a bar to open that day.</p></div></div>
      <div class="chart">${manpowerChart()}</div>
    </section>`;
}

function vSlabs(cs){
  const c=cs.find(c=>c.t.key===S.tab), w=canW();
  let rows=c.rows;
  if(S.filter==="next"){const i=c.cur?c.cur.seq:rows.length;rows=rows.filter(r=>r.seq>=i-1&&r.seq<=i+5);}
  if(S.filter==="late")rows=rows.filter(r=>r.variance>0&&(r.status!=="pending"||r.flag==="latestart"));
  const trs=rows.map(r=>{
    const isCur=c.cur&&r.id===c.cur.id, v=r.variance;
    const vtxt=v>0?`<span class="var-pos">+${v}</span>`:v<0?`<span class="var-neg">${v}</span>`:"0";
    const ck=r.p.checklist?CHECKS.filter(x=>r.p.checklist[x.k]).length:0;
    return `<tr class="${isCur?"row-cur":""} ${w?"click":""}" ${w?`data-edit="${r.id}" tabindex="0"`:""}>
      <td class="num" style="color:var(--faint)">${r.seq}</td>
      <td style="min-width:150px"><b>${esc(r.name)}</b>${r.p.note?`<span class="sub">${esc(r.p.note)}</span>`:""}</td>
      <td class="num">${fmt(r.planStart)}</td><td class="num">${fmt(r.planEnd)}</td>
      <td class="n num">${r.days??"—"}${r.hol?`<span class="sub">+${r.hol} hol.</span>`:""}</td>
      <td>${r.p.actualStart?`<span class="num">${fmt(r.p.actualStart)}</span>`:r.status==="pending"?`<span class="num fc">${fmtN(r.fs)}</span>`:"—"}</td>
      <td>${r.status==="cast"?`<span class="num">${fmtN(r.fe)}</span>`:`<span class="num fc">${fmtN(r.fe)}</span><span class="sub">forecast</span>`}</td>
      <td class="n num">${vtxt}</td>
      <td>${statusPill(r)}</td>
      <td class="num" style="color:var(--muted)">${r.status==="pending"?"—":`${ck}/${CHECKS.length}`}</td>
      <td style="color:var(--muted);min-width:160px">${esc(r.remark)}</td></tr>`;}).join("")||`<tr><td colspan="11" class="empty">No slabs match this filter.</td></tr>`;
  return `<section class="panel">
    <div class="panel-head"><div><h3>Slab cycle</h3><p>Each slab moves through ${STAGES.map(s=>s.n.toLowerCase()).join(", ")}.</p></div>
      <div class="tabs" role="group" aria-label="Building">${cs.map(x=>`<button data-tab="${x.t.key}" aria-pressed="${x.t.key===S.tab}"><span class="swatch" style="margin:0;background:${tcol(x.t.key)}"></span>${esc(x.t.name)}</button>`).join("")}</div></div>
    <div class="panel-head">
      <div class="filters">${[["all","All slabs"],["next","Current & next 5"],["late","Behind plan"]].map(([k,l])=>`<button class="chip" data-filter="${k}" aria-pressed="${S.filter===k}">${l}</button>`).join("")}</div>
      <div class="hint">${w?"Tap a row to update its stage.":"View only."} Var. = days against the baseline cast date.</div></div>
    ${c.t.baselineNote?`<div class="tw-note">${esc(c.t.baselineNote)}</div>`:""}
    <div class="tablewrap"><table style="min-width:1020px">
      <thead><tr><th>#</th><th>Slab</th><th>Plan start</th><th>Plan cast</th><th class="n">Days</th><th>Actual start</th><th>Cast date</th><th class="n">Var.</th><th>Stage</th><th>Checks</th><th>Remarks</th></tr></thead>
      <tbody>${trs}</tbody></table></div>
  </section>`;
}

function worksCells(k){const base=(S.works[k]&&S.works[k].cells)||{},pend=S.worksPending[k]||{};const out={};for(const f of new Set([...Object.keys(base),...Object.keys(pend)]))out[f]={...(base[f]||{}),...(pend[f]||{})};return out;}
function vWorks(cs){
  const c=cs.find(c=>c.t.key===S.worksTab), w=canW();
  const floors=c.rows.filter(r=>!r.name.startsWith("OHT"));
  const cells=worksCells(c.t.key);
  const pct=ACTS.map(a=>{const done=floors.filter(f=>(cells[f.id]||{})[a.k]==="done").length,wip=floors.filter(f=>(cells[f.id]||{})[a.k]==="wip").length;
    return `<div><span><b>${a.n}</b> <span class="muted">${done}/${floors.length}${wip?` · ${wip} ongoing`:""}</span></span><span class="bar"><i style="width:${done/floors.length*100}%;background:var(--ok)"></i><i style="width:${wip/floors.length*100}%;background:var(--prog-fill)"></i></span></div>`}).join("");
  const trs=[...floors].reverse().map(f=>{
    const st=f.status==="cast"?`<span class="struct" style="color:var(--cast)">Cast</span>`:f.status==="progress"?`<span class="struct" style="color:var(--prog)">${esc(stageName(f.p))}</span>`:`<span class="struct" style="color:var(--faint)">—</span>`;
    return `<tr><td><b>${esc(f.name.replace(/ Slab/,""))}</b></td><td>${st}</td>${ACTS.map(a=>{const v=(cells[f.id]||{})[a.k]||"";const cls=v==="done"?"done":v==="wip"?"wip":"";
      return `<td><button class="cell ${cls}" data-cell="${f.id}|${a.k}" ${w?"":"disabled"} aria-label="${esc(f.name)} ${a.n}: ${v==="done"?"done":v==="wip"?"in progress":"not started"}">${v==="done"?"Done":v==="wip"?"On":"·"}</button></td>`}).join("")}</tr>`}).join("");
  return `<section class="panel">
    <div class="panel-head"><div><h3>Floor-wise works</h3><p>Finishing and services, floor by floor. ${w?"Tap a cell to cycle: not started → ongoing → done.":""}</p></div>
      <div class="tabs" role="group" aria-label="Building">${cs.map(x=>`<button data-wtab="${x.t.key}" aria-pressed="${x.t.key===S.worksTab}"><span class="swatch" style="margin:0;background:${tcol(x.t.key)}"></span>${esc(x.t.name)}</button>`).join("")}</div></div>
    <div class="pct">${pct}</div>
    <div class="tablewrap" style="max-height:70vh"><table class="matrix">
      <thead><tr><th>Floor</th><th>Structure</th>${ACTS.map(a=>`<th>${a.n}</th>`).join("")}</tr></thead>
      <tbody>${trs}</tbody></table></div>
  </section>`;
}

function matEntries(){return Object.values(S.mats).flatMap(m=>Object.entries(m.items||{}).map(([id,i])=>({...i,id,date:m.date,type:i.type||"in"}))).filter(i=>!i.void&&i.material);}
function matStats(){
  const all=matEntries(), month=todayIso().slice(0,7), st={};
  for(const m of MATS)st[m.k]={inAll:0,usedAll:0,inM:0,usedM:0,theo:0,theoUsed:0,byT:{},lastIn:null};
  for(const i of all){const s=st[i.material]||st.other, q=+i.qty||0;
    if(i.type==="used"){s.usedAll+=q;if(i.date.startsWith(month))s.usedM+=q;if(+i.theo>0){s.theo+=+i.theo;s.theoUsed+=q;}s.byT[i.tower]=(s.byT[i.tower]||0)+q;}
    else{s.inAll+=q;if(i.date.startsWith(month))s.inM+=q;if(!s.lastIn||i.date>s.lastIn)s.lastIn=i.date;}}
  return {all,st};
}
const wastage=s=>s.theo>0?((s.theoUsed-s.theo)/s.theo*100):null;
function vMaterials(){
  const {all,st}=matStats(), w=canW(), f=S.matFilter||"all", mk=S.matKind||"all";
  const steel=st.steel, rmc=st.rmc, ws=wastage(steel), wr=wastage(rmc);
  const head=`<section class="kpis">
    <div class="kpi" style="--tone:var(--t2);--tint:#EEE8F4"><span class="ic">${icon("steel")}</span><span class="eyebrow">Steel received to date</span><span class="v">${fmtQty(steel.inAll)}<small> MT</small></span><span class="s">${fmtQty(steel.inM)} MT this month${steel.lastIn?` · last ${fmtS(steel.lastIn)}`:""}</span></div>
    <div class="kpi" style="--tone:var(--t2);--tint:#EEE8F4"><span class="ic">${icon("steel")}</span><span class="eyebrow">Steel used to date</span><span class="v">${fmtQty(steel.usedAll)}<small> MT</small></span><span class="s">${fmtQty(steel.usedM)} MT this month${ws!=null?` · ${ws>=0?"+":""}${ws.toFixed(1)}% vs BBS`:""}</span></div>
    <div class="kpi ${steel.inAll-steel.usedAll<0?"alert":""}" style="--tone:var(--t2);--tint:#EEE8F4"><span class="ic">${icon("steel")}</span><span class="eyebrow">Steel balance on site</span><span class="v">${fmtQty(steel.inAll-steel.usedAll)}<small> MT</small></span><span class="s">Received minus used</span></div>
    <div class="kpi" style="--tone:var(--t3);--tint:#DFF3F5"><span class="ic">${icon("mixer")}</span><span class="eyebrow">RMC received to date</span><span class="v">${fmtQty(rmc.inAll)}<small> m³</small></span><span class="s">${fmtQty(rmc.inM)} m³ this month${rmc.lastIn?` · last ${fmtS(rmc.lastIn)}`:""}</span></div>
    <div class="kpi" style="--tone:var(--t3);--tint:#DFF3F5"><span class="ic">${icon("mixer")}</span><span class="eyebrow">RMC poured to date</span><span class="v">${fmtQty(rmc.usedAll)}<small> m³</small></span><span class="s">${fmtQty(rmc.usedM)} m³ this month${wr!=null?` · ${wr>=0?"+":""}${wr.toFixed(1)}% vs design`:""}</span></div>
    <div class="kpi" style="--tone:var(--t3);--tint:#DFF3F5"><span class="ic">${icon("mixer")}</span><span class="eyebrow">RMC unaccounted</span><span class="v">${fmtQty(rmc.inAll-rmc.usedAll)}<small> m³</small></span><span class="s">Received minus poured (returns, waste)</span></div>
  </section>`;
  const stock=MATS.filter(m=>m.k!=="other").map(m=>{const s=st[m.k];return `<tr><td><b>${m.n}</b></td><td class="n num">${fmtQty(s.inAll)}</td><td class="n num">${fmtQty(s.usedAll)}</td><td class="n num" style="font-weight:600;${s.inAll-s.usedAll<0?"color:var(--late)":""}">${m.k==="rmc"?"—":fmtQty(s.inAll-s.usedAll)}</td><td class="n num">${fmtQty(s.inM)}</td><td class="n num">${fmtQty(s.usedM)}</td><td class="num">${s.lastIn?fmt(s.lastIn):"—"}</td><td>${m.u}</td></tr>`}).join("");
  const byT=TAGS().map(([k,n])=>{const a=st.steel.byT[k]||0,b=st.rmc.byT[k]||0;return a||b||S.towers.some(t=>t.key===k)?`<tr><td><b>${esc(n)}</b></td><td class="n num">${fmtQty(a)}</td><td class="n num">${fmtQty(b)}</td></tr>`:""}).join("");
  let list=all;if(f!=="all")list=list.filter(i=>i.type===f);if(mk!=="all")list=list.filter(i=>i.material===mk);
  list.sort((a,b)=>b.date.localeCompare(a.date)||String(b.at).localeCompare(String(a.at)));
  const slabName=id=>{const x=id&&findSlab(id);return x?x.s.name:""};
  const rows=list.slice(0,150).map(i=>{const m=MATS.find(x=>x.k===i.material)||MATS[6];
    const detail=i.type==="used"?[slabName(i.slab),+i.theo>0?`design ${fmtQty(+i.theo)} ${esc(i.unit||m.u)}`:"",i.note].filter(Boolean).map(esc).join(" · "):[i.supplier,i.challan?`challan ${i.challan}`:""].filter(Boolean).map(esc).join(" · ");
    return `<tr><td class="num">${fmt(i.date)}</td><td>${i.type==="used"?`<span class="pill prog">Used</span>`:`<span class="pill okp">Received</span>`}</td><td><b>${esc(i.material==="other"?(i.spec||"Other"):m.n)}</b>${i.material!=="other"&&i.spec?`<span class="sub">${esc(i.spec)}</span>`:""}</td><td class="n num">${fmtQty(+i.qty||0)} ${esc(i.unit||m.u)}</td><td>${esc(tname(i.tower))}</td><td style="color:var(--muted)">${detail||"—"}</td>
      <td>${w&&!String(i.id).startsWith("pour-")?`<button class="btn small ghost" data-voidmat="${i.date}|${i.id}">Remove</button>`:""}</td></tr>`}).join("")||`<tr><td colspan="7" class="empty">Nothing logged yet.</td></tr>`;
  return `${head}
    ${w?`<section class="quick"><button class="qa" data-newmat="in" style="--tone:var(--t2);--tint:#EEE8F4"><span class="ic">${icon("materials")}</span><span class="qt"><b>Log receipt</b><span class="qs">Delivery with challan no.</span></span></button><button class="qa" data-newmat="used" style="--tone:var(--t3);--tint:#DFF3F5"><span class="ic">${icon("box")}</span><span class="qt"><b>Log consumption</b><span class="qs">Steel issued, RMC poured</span></span></button></section>`:""}
    <div class="two">
      <section class="panel"><div class="panel-head"><div><h3>Stock to date</h3><p>All receipts and consumption since the start.</p></div></div>
        <div class="tablewrap"><table style="min-width:620px"><thead><tr><th>Material</th><th class="n">Received</th><th class="n">Used</th><th class="n">Balance</th><th class="n">In this month</th><th class="n">Used this month</th><th>Last delivery</th><th>Unit</th></tr></thead><tbody>${stock}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><div><h3>Consumption by building</h3><p>Steel and RMC used to date.</p></div></div>
        <div class="tablewrap"><table><thead><tr><th>Building</th><th class="n">Steel (MT)</th><th class="n">RMC (m³)</th></tr></thead><tbody>${byT}</tbody></table></div></section>
    </div>
    <section class="panel">
      <div class="panel-head"><div><h3>Material register</h3><p>Every delivery and every quantity used, with dates. Pours logged on a slab appear here automatically.</p></div></div>
      <div class="panel-head"><div class="filters">${[["all","All"],["in","Receipts"],["used","Consumption"]].map(([k,l])=>`<button class="chip" data-matf="${k}" aria-pressed="${f===k}">${l}</button>`).join("")}</div>
        <div class="filters">${[["all","All materials"],...MATS.map(m=>[m.k,m.n])].map(([k,l])=>`<button class="chip" data-matk="${k}" aria-pressed="${mk===k}">${l}</button>`).join("")}</div></div>
      <div class="tablewrap"><table style="min-width:860px"><thead><tr><th>Date</th><th>Type</th><th>Material</th><th class="n">Qty</th><th>Building</th><th>Details</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
}

function vIssues(){
  const hs=[...S.hind].sort((a,b)=>(a.status==="resolved")-(b.status==="resolved")||String(b.from||"").localeCompare(String(a.from||"")));
  const slabName=(k,id)=>{const t=S.towers.find(t=>t.key===k);return t?(t.slabs.find(s=>s.id===id)||{}).name||"":""};
  const items=hs.map(h=>`<li class="hitem ${h.status==="resolved"?"resolved":""}">
      <div class="row1"><span class="cat">${esc(h.category)}</span>${h.status==="resolved"?`<span class="pill cast">Resolved ${fmt(h.resolvedOn)}</span>`:`<span class="pill late">Open</span>`}</div>
      <div class="meta">${esc(tname(h.tower))}${h.slab?" · "+esc(slabName(h.tower,h.slab)):""} · from ${fmt(h.from)}${h.daysLost?` · ${plural(+h.daysLost,"day")} lost`:""}</div>
      ${h.description?`<p>${esc(h.description)}</p>`:""}
      ${(h.status!=="resolved"&&canW())||S.canEdit?`<div style="display:flex;gap:8px">${h.status!=="resolved"&&canW()?`<button class="btn small" data-resolve="${esc(h.id)}">Mark resolved</button>`:""}${S.canEdit?`<button class="btn small ghost" data-delh="${esc(h.id)}" style="color:var(--late)">Delete</button>`:""}</div>`:""}</li>`).join("")||`<li class="empty">No hindrances logged.</li>`;
  const lost=S.hind.reduce((a,h)=>a+(+h.daysLost||0),0);
  return `<div class="two">
    <section class="panel"><div class="panel-head"><div><h3>Hindrance register</h3><p>${plural(S.hind.length,"entry")} · ${plural(lost,"day")} lost in total. Use this for delay claims against the schedule conditions.</p></div>${canW()?`<button class="btn primary" data-newh="1">Log hindrance</button>`:""}</div><ul class="hlist">${items}</ul></section>
    <section class="panel"><div class="panel-head"><h3>Recent site activity</h3></div><ul class="feed" id="feed"></ul></section></div>`;
}

async function renderFeed(){
  const items=[];
  for(const t of S.towers)for(const s of t.slabs){const p=S.progress[s.id];if(p&&p.updatedAt){
    const what=p.status==="cast"?`marked <b>${esc(s.name)}</b> cast on ${fmt(p.actualEnd)}`:p.status==="progress"?`moved <b>${esc(s.name)}</b> to ${esc(stageName(p).toLowerCase())}`:`reset <b>${esc(s.name)}</b> to not started`;
    items.push({at:p.updatedAt,by:p.updatedBy,html:`${what} <span class="muted">· ${esc(t.name)}</span>`});}}
  for(const d of Object.values(S.dpr))if(d.submittedAt)items.push({at:d.updatedAt||d.submittedAt,by:d.updatedBy||d.submittedBy,html:`submitted the DPR for ${fmt(d.date)} <span class="muted">· ${d.total||0} workers, ${(d.work||[]).length} activities</span>`});
  for(const h of S.hind){items.push({at:h.createdAt,by:h.createdBy,html:`logged a hindrance: <b>${esc(h.category)}</b> <span class="muted">· ${esc(tname(h.tower))}</span>`});
    if(h.status==="resolved"&&h.resolvedAt)items.push({at:h.resolvedAt,by:h.resolvedBy,html:`resolved hindrance: <b>${esc(h.category)}</b>`});}
  for(const m of Object.values(S.mats))for(const i of Object.values(m.items||{}))if(!i.void&&i.at){const mt=MATS.find(x=>x.k===i.material)||MATS[6];items.push({at:i.at,by:i.by,html:`${i.type==="used"?"recorded use of":"received"} ${fmtQty(+i.qty||0)} ${esc(i.unit||mt.u)} of ${esc(i.material==="other"?i.spec||"material":mt.n)} <span class="muted">· ${esc(tname(i.tower))}</span>`});}
  items.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const top=items.slice(0,12);
  const ids=[...new Set(top.map(i=>i.by).filter(Boolean))];
  let ps={};if(S.user&&ids.length){try{ps=await S.user.profiles(ids);}catch(e){}}
  const el=$("#feed");if(!el)return;
  el.innerHTML=top.map(i=>{const p=i.by&&ps[i.by];const name=p&&p.name?esc(p.name):(i.by?"Someone":"Initial schedule");
    return `<li>${p?`<img alt="" src="${esc(p.avatarUrl)}">`:`<span class="av"></span>`}<div><p><b>${name}</b> ${i.html}</p><div class="when">${ago(i.at)}</div></div></li>`}).join("")||`<li class="empty" style="display:block">No activity yet.</li>`;
}
async function renderDprBy(){const el=$("#dprBy");if(!el||!el.dataset.by||!S.user)return;const ps=await S.user.profiles([el.dataset.by]);const n=ps[el.dataset.by]&&ps[el.dataset.by].name;if(n&&$("#dprBy")===el)el.textContent=`By ${n} · `+el.textContent;}

/* ================= reports ================= */
function periodRange(){
  const T=d2n(todayIso()), dow=(new Date(T*DAY).getUTCDay()+6)%7, d=new Date(T*DAY), y=d.getUTCFullYear(), m=d.getUTCMonth();
  const r=S.rep||{p:"week"};
  const ms=Math.round(Date.UTC(y,m,1)/DAY), pms=Math.round(Date.UTC(y,m-1,1)/DAY);
  switch(r.p){
    case "lastweek":return [T-dow-7,T-dow-1,"Last week"];
    case "month":return [ms,T,"This month"];
    case "lastmonth":return [pms,ms-1,"Last month"];
    case "custom":{const a=d2n(r.from)??T-29,b=Math.min(d2n(r.to)??T,T);return [Math.min(a,b),b,"Custom"];}
    case "all":{const first=Math.min(d2n(S.towers[0].baselineDate)||T,...Object.keys(S.dpr).map(d2n));return [first,T,"Project to date"];}
    default:return [T-dow,T,"This week"];
  }
}
function buildReport(){
  const [a,b,label]=periodRange(), inR=iso=>{const n=d2n(iso);return n!=null&&n>=a&&n<=b};
  const days=[...Array(b-a+1)].map((_,i)=>n2d(a+i));
  const dprs=days.map(getDpr).filter(Boolean);
  const manDays=dprs.reduce((x,d)=>x+(+d.total||0),0), peak=dprs.reduce((x,d)=>Math.max(x,+d.total||0),0);
  const trades={};for(const d of dprs)for(const l of d.labour||[])trades[l.trade]=(trades[l.trade]||0)+(+l.count||0);
  const rain=dprs.filter(d=>/^Heavy rain/.test(d.weather||"")).length;
  const cs=S.towers.map(compute);
  const bld=cs.map(c=>{const cast=c.rows.filter(r=>r.status==="cast"&&inR(r.p.actualEnd)), plan=c.rows.filter(r=>inR(r.planEnd));
    const cells=(S.works[c.t.key]&&S.works[c.t.key].cells)||{};let fin=0;const finBy={};
    for(const f in cells)for(const k in cells[f])if(k.endsWith("_d")&&cells[f][k]&&inR(cells[f][k])&&cells[f][k.slice(0,-2)]==="done"){fin++;const an=(ACTS.find(x=>x.k===k.slice(0,-2))||{}).n||k;finBy[an]=(finBy[an]||0)+1;}
    return {c,cast,plan,fin,finBy};});
  const ents=matEntries(), mat=MATS.map(m=>{const e=ents.filter(i=>i.material===m.k);const sum=(arr)=>arr.reduce((x,i)=>x+(+i.qty||0),0);
    return {m,inP:sum(e.filter(i=>i.type!=="used"&&inR(i.date))),usedP:sum(e.filter(i=>i.type==="used"&&inR(i.date))),inAll:sum(e.filter(i=>i.type!=="used"&&d2n(i.date)<=b)),usedAll:sum(e.filter(i=>i.type==="used"&&d2n(i.date)<=b))};}).filter(x=>x.inAll||x.usedAll||["steel","rmc"].includes(x.m.k));
  const hind=S.hind.filter(h=>inR(h.from)), lost=hind.reduce((x,h)=>x+(+h.daysLost||0),0);
  const acts=[];for(const d of dprs)for(const w of d.work||[])acts.push({date:d.date,...w});
  return {a,b,label,days,dprs,manDays,peak,trades,rain,bld,mat,hind,lost,acts};
}
function rpBars(R){
  const W=1000,H=170,L=40,R0=10,Tp=10,B=28,N=R.days.length,bw=(W-L-R0)/N;
  const vals=R.days.map(d=>{const x=getDpr(d);return x?+x.total||0:null});const yMax=Math.max(50,Math.ceil(Math.max(0,...vals.filter(v=>v!=null))/50)*50);
  const Y=v=>H-B-v/yMax*(H-B-Tp);let g="";
  for(let v=0;v<=yMax;v+=yMax/2)g+=`<line x1="${L}" x2="${W-R0}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L-6}" y="${Y(v)+4}" text-anchor="end">${v}</text>`;
  const every=Math.max(1,Math.ceil(N/10));
  R.days.forEach((d,i)=>{const x=L+i*bw,v=vals[i];
    g+=v!=null?`<rect x="${x+bw*.15}" y="${Y(v)}" width="${bw*.7}" height="${Math.max(1,H-B-Y(v))}" rx="2" fill="var(--accent)"><title>${fmt(d)}: ${v}</title></rect>`:`<rect x="${x+bw*.15}" y="${H-B-3}" width="${bw*.7}" height="3" fill="var(--late)" opacity=".5"><title>${fmt(d)}: no DPR</title></rect>`;
    if(i%every===0)g+=`<text x="${x+bw/2}" y="${H-B+17}" text-anchor="middle">${fmtS(d)}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily manpower in the period">${g}</svg>`;
}
function vReports(){
  const R=buildReport(), p=(S.rep||{}).p||"week";
  const avgM=R.dprs.length?Math.round(R.manDays/R.dprs.length):0;
  const castN=R.bld.reduce((x,b)=>x+b.cast.length,0), planN=R.bld.reduce((x,b)=>x+b.plan.length,0);
  const st=R.mat.find(x=>x.m.k==="steel")||{}, rm=R.mat.find(x=>x.m.k==="rmc")||{};
  const periods=[["week","This week"],["lastweek","Last week"],["month","This month"],["lastmonth","Last month"],["all","Project to date"],["custom","Custom"]];
  const tmax=Math.max(1,...Object.values(R.trades));
  const bRows=R.bld.map(b=>`<tr><td><span class="swatch" style="background:${tcol(b.c.t.key)}"></span><b>${esc(b.c.t.name)}</b></td>
    <td>${b.cast.length?`<b>${b.cast.length}</b> · ${b.cast.map(r=>esc(r.name.replace(/ Slab/,""))).join(", ")}`:"<span class='muted'>None</span>"}</td>
    <td>${b.plan.length?`${b.plan.length} · ${b.plan.map(r=>esc(r.name.replace(/ Slab/,""))).join(", ")}`:"<span class='muted'>None</span>"}</td>
    <td>${b.c.cur?`${esc(b.c.cur.name)}<span class="sub">${esc(stageName(b.c.cur.p))}</span>`:"Structure complete"}</td>
    <td>${delayChip(b.c.delay)}</td><td>${b.fin?`<b>${b.fin}</b><span class="sub">${Object.entries(b.finBy).map(([k,v])=>`${esc(k)} ${v}`).join(", ")}</span>`:"<span class='muted'>0</span>"}</td></tr>`).join("");
  const mRows=R.mat.map(x=>`<tr><td><b>${x.m.n}</b></td><td class="n">${fmtQty(x.inP)}</td><td class="n">${fmtQty(x.usedP)}</td><td class="n">${fmtQty(x.inAll)}</td><td class="n">${fmtQty(x.usedAll)}</td><td class="n" style="font-weight:700">${x.m.k==="rmc"?"—":fmtQty(x.inAll-x.usedAll)}</td><td>${x.m.u}</td></tr>`).join("");
  const hRows=R.hind.map(h=>`<tr><td>${fmt(h.from)}</td><td>${esc(tname(h.tower))}</td><td><b>${esc(h.category)}</b><span class="sub">${esc(h.description||"")}</span></td><td class="n">${+h.daysLost||0}</td><td>${h.status==="resolved"?`<span class="pill cast">Resolved</span>`:`<span class="pill late">Open</span>`}</td></tr>`).join("");
  const actBy=TAGS().map(([k,n])=>{const a=R.acts.filter(x=>x.tag===k);if(!a.length)return"";
    return `<div class="workgroup" style="--wc:${k==="sale"?"var(--ink)":k==="site"?"var(--muted)":tcol(k)}"><h4>${esc(n)}</h4><ul style="margin:0;padding-left:18px;font-size:14px">${(()=>{const m=new Map();for(const x of a){const key=x.text.toLowerCase().replace(/\s+/g," ").trim();const o=m.get(key)||{text:x.text,dates:[]};o.dates.push(x.date);m.set(key,o);}
      return [...m.values()].map(o=>{o.dates.sort();const n=o.dates.length;return `<li>${esc(o.text)} <span class="muted">· ${n>1?`${n} days, ${fmtS(o.dates[0])} to ${fmtS(o.dates[n-1])}`:fmtS(o.dates[0])}</span></li>`}).join("")})()}</ul></div>`}).join("");
  return `<section class="panel">
      <div class="panel-head"><div><h3>Progress report</h3><p>${fmt(n2d(R.a))} to ${fmt(n2d(R.b))} · ${plural(R.days.length,"day")}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-rpcopy="1">Copy summary</button>${S.dl?`<button class="btn small primary" data-rpcsv="1">Download CSV</button>`:""}</div></div>
      <div class="filters">${periods.map(([k,l])=>`<button class="chip" data-rp="${k}" aria-pressed="${p===k}">${l}</button>`).join("")}</div>
      ${p==="custom"?`<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><label class="hint" for="rp-from">From</label><input type="date" id="rp-from" max="${todayIso()}" value="${n2d(R.a)}" class="dateinp"><label class="hint" for="rp-to">To</label><input type="date" id="rp-to" max="${todayIso()}" value="${n2d(R.b)}" class="dateinp"></div>`:""}
    </section>
    <section class="kpis">
      <div class="kpi ${R.dprs.length<R.days.length?"alert":""}" style="--tone:var(--t1);--tint:#E3ECF5"><span class="ic">${icon("dpr")}</span><span class="eyebrow">DPRs received</span><span class="v">${R.dprs.length}<small> / ${R.days.length} days</small></span><span class="s">${R.days.length-R.dprs.length?`${plural(R.days.length-R.dprs.length,"day")} missing`:"Every day reported"}</span></div>
      <div class="kpi" style="--tone:var(--t1);--tint:#E3ECF5"><span class="ic">${icon("users")}</span><span class="eyebrow">Man-days</span><span class="v">${R.manDays.toLocaleString("en-IN")}</span><span class="s">Average ${avgM} a day · peak ${R.peak}</span></div>
      <div class="kpi" style="--tone:var(--ink);--tint:#E8E7F3"><span class="ic">${icon("slabs")}</span><span class="eyebrow">Slabs cast</span><span class="v">${castN}<small> / ${planN} planned</small></span><span class="s">All buildings, this period</span></div>
      <div class="kpi" style="--tone:var(--t2);--tint:#EEE8F4"><span class="ic">${icon("steel")}</span><span class="eyebrow">Steel</span><span class="v">${fmtQty(st.usedP||0)}<small> MT used</small></span><span class="s">${fmtQty(st.inP||0)} MT received</span></div>
      <div class="kpi" style="--tone:var(--t3);--tint:#DFF3F5"><span class="ic">${icon("mixer")}</span><span class="eyebrow">RMC</span><span class="v">${fmtQty(rm.usedP||0)}<small> m³ poured</small></span><span class="s">${fmtQty(rm.inP||0)} m³ received</span></div>
      <div class="kpi ${R.hind.length?"alert":""}" style="--tone:var(--ok);--tint:var(--ok-soft)"><span class="ic">${icon("issues")}</span><span class="eyebrow">Hindrances</span><span class="v">${R.hind.length}</span><span class="s">${plural(R.lost,"day")} lost · ${plural(R.rain,"rain day")}</span></div>
    </section>
    <section class="panel"><div class="panel-head"><div><h3>Work progress by building</h3><p>Slabs cast against the baseline for this period, current stage, and finishing items completed.</p></div></div>
      <div class="tablewrap"><table style="min-width:880px"><thead><tr><th>Building</th><th>Slabs cast</th><th>Planned to cast</th><th>Now on</th><th>Programme</th><th>Finishing items done</th></tr></thead><tbody>${bRows}</tbody></table></div></section>
    <div class="two">
      <section class="panel"><div class="panel-head"><div><h3>Manpower</h3><p>Workers on site each day. Red ticks are days with no DPR.</p></div></div><div class="chart">${rpBars(R)}</div>
        <div class="tradebars">${Object.entries(R.trades).sort((x,y)=>y[1]-x[1]).map(([t,v])=>`<div class="tradebar"><span>${esc(t)}</span><span class="bar"><i style="width:${(v/tmax*100).toFixed(1)}%"></i></span><span class="n">${v}</span></div>`).join("")||`<span class="muted">No DPRs in this period.</span>`}</div>
        ${Object.keys(R.trades).length?`<p class="hint" style="margin:0">Man-days by trade.</p>`:""}</section>
      <section class="panel"><div class="panel-head"><div><h3>Quantities</h3><p>This period, and totals up to ${fmt(n2d(R.b))}.</p></div></div>
        <div class="tablewrap"><table style="min-width:560px"><thead><tr><th>Material</th><th class="n">Received</th><th class="n">Used</th><th class="n">Received to date</th><th class="n">Used to date</th><th class="n">Balance</th><th>Unit</th></tr></thead><tbody>${mRows}</tbody></table></div></section>
    </div>
    <section class="panel"><div class="panel-head"><h3>Hindrances this period</h3></div>
      <div class="tablewrap"><table style="min-width:520px"><thead><tr><th>From</th><th>Building</th><th>Cause</th><th class="n">Days lost</th><th>Status</th></tr></thead><tbody>${hRows||`<tr><td colspan="5" class="empty">None logged.</td></tr>`}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><div><h3>Activities carried out</h3><p>Every work item reported in the DPRs, by building.</p></div></div>${actBy||`<span class="muted">No work reported in this period.</span>`}</section>`;
}
function reportText(R){
  const L=[`*Dream Signature · Progress report*`,`${fmt(n2d(R.a))} to ${fmt(n2d(R.b))} (${R.label})`,""];
  L.push(`DPRs: ${R.dprs.length}/${R.days.length} days · Man-days ${R.manDays} (avg ${R.dprs.length?Math.round(R.manDays/R.dprs.length):0}/day)`);
  for(const b of R.bld)L.push(`${b.c.t.name}: ${b.cast.length} slab(s) cast${b.cast.length?` (${b.cast.map(r=>r.name.replace(/ Slab/,"")).join(", ")})`:""}, ${b.plan.length} planned · now ${b.c.cur?b.c.cur.name+" – "+stageName(b.c.cur.p):"complete"} · ${b.c.delay>0?b.c.delay+" days behind":b.c.delay<0?-b.c.delay+" days ahead":"on schedule"}${b.fin?` · ${b.fin} finishing items done`:""}`);
  L.push("");for(const x of R.mat)L.push(`${x.m.n}: received ${fmtQty(x.inP)} ${x.m.u}, used ${fmtQty(x.usedP)} ${x.m.u} (to date ${fmtQty(x.inAll)} in / ${fmtQty(x.usedAll)} used)`);
  L.push("",`Hindrances: ${R.hind.length} (${R.lost} days lost) · Rain days: ${R.rain}`);
  return L.join("\n");
}
function reportCsv(R){
  const q=v=>{const s=String(v??"");return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
  const rows=[["Dream Signature progress report",n2d(R.a),n2d(R.b)],[],["Summary"],["DPRs received",R.dprs.length,"of",R.days.length],["Man-days",R.manDays],["Peak manpower",R.peak],["Hindrances",R.hind.length,"days lost",R.lost],["Rain days",R.rain],[],
    ["Building","Slabs cast","Slabs cast (names)","Planned to cast","Now on","Stage","Days behind(+)/ahead(-)","Finishing items done"],
    ...R.bld.map(b=>[b.c.t.name,b.cast.length,b.cast.map(r=>r.name).join("; "),b.plan.length,b.c.cur?b.c.cur.name:"Complete",b.c.cur?stageName(b.c.cur.p):"",b.c.delay,b.fin]),[],
    ["Material","Unit","Received in period","Used in period","Received to date","Used to date","Balance"],...R.mat.map(x=>[x.m.n,x.m.u,x.inP,x.usedP,x.inAll,x.usedAll,x.m.k==="rmc"?"":x.inAll-x.usedAll]),[],
    ["Daily manpower"],["Date","Workers","Weather","Activities"],...R.days.map(d=>{const x=getDpr(d);return [d,x?x.total||0:"no DPR",x?x.weather||"":"",x?(x.work||[]).length:""]}),[],
    ["Trade","Man-days"],...Object.entries(R.trades),[],
    ["Hindrance from","Building","Cause","Description","Days lost","Status"],...R.hind.map(h=>[h.from,tname(h.tower),h.category,h.description,h.daysLost||0,h.status]),[],
    ["Date","Building","Activity"],...R.acts.map(a=>[a.date,tname(a.tag),a.text])];
  return rows.map(r=>r.map(q).join(",")).join("\r\n");
}


/* ================= Today (simple page for site staff) ================= */
function todayItems(){
  const T=todayIso(),out=[],isT=ts=>ts&&ts.slice(0,10)===T;
  for(const t of S.towers)for(const s of t.slabs){const p=S.progress[s.id];if(p&&isT(p.updatedAt))out.push(`${esc(t.name)}: ${esc(s.name)} ${p.status==="cast"?"marked cast":"moved to "+esc(stageName(p).toLowerCase())}`);}
  const d=getDpr(T);if(d)out.push(`Daily report sent · ${d.total||0} workers`);
  for(const h of S.hind)if(isT(h.createdAt))out.push(`Problem reported: ${esc(h.category)}`);
  const m=S.mats[T];if(m)for(const i of Object.values(m.items||{}))if(!i.void){const mt=MATS.find(x=>x.k===i.material)||MATS[6];out.push(`${i.type==="used"?"Used":"Received"} ${fmtQty(+i.qty||0)} ${esc(i.unit||mt.u)} ${esc(i.material==="other"?(i.spec||"material"):mt.n)}`);}
  return out;
}
function vToday(cs){
  const T=todayIso(),d=getDpr(T),w=canW();
  const tick=icon("check");
  const blds=cs.filter(c=>c.cur).map(c=>{const cur=c.cur,i=stageIdx(cur.p);
    const chips=STAGES.map((st,j)=>{const cls=j<i?"past":j===i?"now":"";
      return `<button type="button" class="chip2 ${cls}" ${w&&j>i?`data-qstage="${cur.id}:${st.k}"`:"disabled"}>${j<i?tick:""}${esc(({reinforcement:"Steel fixing",mep:"MEP sleeves",cast:"Cast"})[st.k]||st.n)}</button>`}).join("");
    return `<div class="bld" style="--wc:${tcol(c.t.key)}"><div class="bh"><b>${esc(c.t.name)} · ${esc(cur.name)}</b><span>Now: ${esc(stageName(cur.p))}</span></div><div class="chips">${chips}</div></div>`}).join("");
  const done=todayItems();
  return `<section class="st-hello"><h1 id="stHello">Hello</h1><p>${wd(T)} ${fmt(T)} · ${d?"Daily report done. Keep updating as work moves.":"Three things to fill in today."}</p></section>
  <ol class="steps">
    <li class="step ${d?"done":""}"><span class="num">${d?tick:"1"}</span><div><h2>Daily report</h2><div class="sub">${d?`Sent · ${d.total||0} workers · ${(d.work||[]).length} work items`:"Workers on site, work done, any problem"}</div></div>
      ${w?`<div class="body"><button class="bigbtn ${d?"soft":""}" data-qdpr="1">${icon("dpr")}${d?"Change today's report":"Fill today's report"}</button></div>`:""}</li>
    <li class="step"><span class="num">2</span><div><h2>Slab work</h2><div class="sub">Tap the stage each slab has reached today.</div></div>
      <div class="body">${blds||`<p class="muted" style="margin:0">All slabs are cast.</p>`}</div></li>
    <li class="step"><span class="num">3</span><div><h2>Material and problems</h2><div class="sub">Log it when it happens.</div></div>
      ${w?`<div class="body bigrow">
        <button class="bigbtn soft" data-newmat="in">${icon("materials")}Material came in</button>
        <button class="bigbtn soft" data-newmat="used">${icon("box")}Material used</button>
        <button class="bigbtn warn" data-newh="1">${icon("issues")}Report a problem</button></div>`:""}</li>
  </ol>
  <section class="panel"><div class="panel-head"><h3>Done today</h3></div>
    ${done.length?`<ul class="tlist">${done.map(x=>`<li>${tick}<span>${x}</span></li>`).join("")}</ul>`:`<p class="muted" style="margin:0">Nothing entered yet today.</p>`}</section>
  ${S.canEdit?`<p class="st-foot">This is the page Site Engineers and the Site Team see when they open Construction.</p>`:`<p class="st-foot"><a href="#" data-showall="1">Open the full dashboard</a></p>`}`;
}
async function renderTodayName(){
  const el=$("#stHello");if(!el||!S.user||!S.me)return;
  let n="";try{const ps=await S.user.profiles([S.me]);n=(ps[S.me]&&ps[S.me].name)||"";}catch(e){}
  const h=new Date().getHours(),g=h<12?"Good morning":h<17?"Good afternoon":"Good evening";
  if($("#stHello")===el)el.textContent=n?`${g}, ${n.split(/\s+/)[0]}`:g;
}

/* ---- quick DPR (Today page) ---- */
function openQuickDpr(){
  const date=todayIso(),d=getDpr(date);
  // An existing report, or one with a trade-wise breakdown, opens in the full form so nothing is lost.
  if(d)return openDpr(date);
  const tags=TAGS();
  sheet(`<div><div class="eyebrow">${wd(date)} ${fmt(date)}</div><h2>Today's report</h2></div>
    <div class="field"><span class="lbl">Weather</span><div class="seg big" id="q-w">${WEATHER.map((x,i)=>`<button type="button" data-w="${esc(x)}" aria-pressed="${i===0}">${esc(x.replace(" — work stopped",""))}</button>`).join("")}</div></div>
    <div class="field"><label for="q-n">How many workers are on site?</label><input id="q-n" class="bignum" type="number" min="0" inputmode="numeric" placeholder="0"></div>
    <div class="field"><label for="q-work">What work was done today?</label><textarea id="q-work" rows="4" placeholder="One item per line, e.g.&#10;Raft shuttering&#10;Column steel binding"></textarea></div>
    <div class="field"><label for="q-tag">Where?</label><select id="q-tag">${tags.map(([k,n])=>`<option value="${k}" ${k==="site"?"selected":""}>${esc(n)}</option>`).join("")}</select></div>
    <div class="field"><label for="q-iss">Any problem today? (optional)</label><textarea id="q-iss" rows="2" placeholder="e.g. RMC came 3 hours late"></textarea></div>
    <div class="err" id="q-err" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" id="q-full">Detailed form</button><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="q-save">Send report</button></div>`);
  $$("#q-w [data-w]").forEach(b=>b.onclick=()=>$$("#q-w [data-w]").forEach(x=>x.setAttribute("aria-pressed",x===b)));
  $("#q-full").onclick=()=>{closeOverlay();openDpr(date);};
  $("#sheetForm").onsubmit=async e=>{
    e.preventDefault();const err=$("#q-err");err.textContent="";
    const n=parseInt($("#q-n").value,10)||0,tag=$("#q-tag").value;
    const wk=$("#q-work").value.split("\n").map(x=>x.trim()).filter(Boolean).map(text=>({text,tag}));
    if(!n&&!wk.length){err.textContent="Enter the number of workers or at least one line of work.";return;}
    if(getDpr(date)){err.textContent="Someone has already sent today's report. Close this and tap Change today's report.";return;}
    const now=new Date().toISOString();
    const doc={date,contractor:S.towers[0].contractor,weather:($("#q-w [aria-pressed=true]")||{}).dataset?.w||"",labour:[{trade:"All workers",count:n}],total:n,work:wk,
      issues:$("#q-iss").value.trim(),safety:"",tomorrow:"",submittedBy:S.me,submittedAt:now,updatedBy:S.me,updatedAt:now};
    const btn=$("#q-save");btn.disabled=true;btn.textContent="Sending…";
    try{await S.db.doc("dpr/"+date).set(doc);closeOverlay();toast("Today's report sent");}
    catch(e2){if(denied(e2))return;btn.disabled=false;btn.textContent="Send report";err.textContent=saveErr(e2);}
  };
}

/* ---- quick slab stage (Today page) ---- */
function openQuickStage(id,stage){
  const f=findSlab(id);if(!f)return;const {t,s}=f;
  const p=S.progress[id]||{},si=STAGES.findIndex(x=>x.k===stage),cast=stage==="cast",started=!!p.actualStart||stageIdx(p)>=0;
  const T=todayIso();
  sheet(`<div><div class="eyebrow">${esc(t.name)} · ${esc(s.name)}</div><h2>${cast?"Slab cast":esc(STAGES[si].n)}</h2></div>
    ${started?"":`<div class="field"><label for="qs-start">When did work on this slab start?</label><input type="date" id="qs-start" max="${T}" value="${esc(s.planStart&&s.planStart<T?s.planStart:T)}"><span class="hint">Planned start ${fmt(s.planStart)}</span></div>`}
    <div class="field"><label for="qs-date">${cast?"Date the slab was cast":"Date this stage was reached"}</label><input type="date" id="qs-date" max="${T}" value="${T}"></div>
    ${cast?`<p class="hint" style="margin:0">Log the RMC and steel for this pour with Material used.</p>`:""}
    <div class="err" id="qs-err" role="alert"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="qs-save">Save</button></div>`);
  $("#sheetForm").onsubmit=async e=>{
    e.preventDefault();const err=$("#qs-err");err.textContent="";
    const dt=$("#qs-date").value,st=started?p.actualStart:($("#qs-start").value||dt);
    if(!dt||dt>T||(st&&st>T)){err.textContent="Dates can't be in the future.";return;}
    if(st&&dt<st){err.textContent="This date is before the start date.";return;}
    const now=new Date().toISOString();
    const doc={...p,status:cast?"cast":"progress",stage,actualStart:st||dt,actualEnd:cast?dt:null,
      stageLog:[...(p.stageLog||[]),{stage,date:dt,by:S.me}].slice(-20),updatedBy:S.me,updatedAt:now};
    const btn=$("#qs-save");btn.disabled=true;btn.textContent="Saving…";
    try{await S.db.doc("progress/"+id).set(doc);closeOverlay();toast(`${s.name}: ${cast?"cast":STAGES[si].n}`);}
    catch(e2){if(denied(e2))return;btn.disabled=false;btn.textContent="Save";err.textContent=saveErr(e2);}
  };
}

/* ================= overlays ================= */
function closeOverlay(){$("#overlay").innerHTML="";}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2800);}
function findSlab(id){for(const t of S.towers){const s=t.slabs.find(s=>s.id===id);if(s)return{t,s};}return null;}
function denied(e){if(e&&e.code==="invalid_argument"){S.canWrite=false;setRole();render();closeOverlay();toast("Your login can't make this change. Ask the Admin if you need it.");return true;}return false;}
function confirmDelete(title,body,run){
  sheet(`<div><div class="eyebrow">Delete</div><h2>${esc(title)}</h2></div><p style="margin:0">${esc(body)}</p><div class="err" id="del-err" role="alert"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="del-yes" style="background:var(--late);border-color:var(--late)">Delete</button></div>`);
  $("#sheetForm").onsubmit=async e=>{e.preventDefault();const b=$("#del-yes");b.disabled=true;
    try{await run();closeOverlay();}catch(e2){b.disabled=false;$("#del-err").textContent=e2&&e2.code==="invalid_argument"?"Only the Site Head or Management can delete.":saveErr(e2);}};
}
function saveErr(e){return e&&e.code==="unavailable"?"Couldn't reach the server. Your entries are still in the form; try Save again when the signal is back.":e&&e.code==="quota_exceeded"?"Storage is full. Ask the owner to archive old entries.":"Couldn't save: "+(e&&e.message||"unknown error");}
function sheet(html,wide){$("#overlay").innerHTML=`<div class="scrim" id="scrim"><form class="sheet ${wide?"wide":""}" id="sheetForm" novalidate>${html}</form></div>`;
  $("#scrim").addEventListener("mousedown",e=>{if(e.target.id==="scrim")closeOverlay();});$$("[data-close]").forEach(b=>b.onclick=closeOverlay);}

/* ---- slab stage sheet ---- */
function openSlab(id){
  const f=findSlab(id);if(!f)return;const {t,s}=f;
  const p=S.progress[id]||{};
  let si=stageIdx(p); // -1 not started
  const log=p.stageLog||[];
  const whenOf=k=>{const e=[...log].reverse().find(x=>x.stage===k);return e?fmtS(e.date):""};
  const chk={...(p.checklist||{})};
  const admin=S.canEdit;
  sheet(`<div><div class="eyebrow">${esc(t.name)}</div><h2>${esc(s.name)}</h2>
      <div class="planref" style="margin-top:10px">Plan ${s.planStart?fmt(s.planStart)+" → ":""}${fmt(s.planEnd)}${s.days?` · ${s.days} days`:""}${s.remark?` · ${esc(s.remark)}`:""}</div></div>
    <div class="sect" style="border-top:0;padding-top:0">
      <div class="grid2">
        <div class="field"><label for="ed-start">Start date (actual)</label><input type="date" id="ed-start" max="${todayIso()}" value="${esc(p.actualStart||"")}"><span class="hint">Planned ${fmt(s.planStart)}</span></div>
        <div class="field"><label for="ed-end">End date / cast date (actual)</label><input type="date" id="ed-end" max="${todayIso()}" value="${esc(p.actualEnd||"")}"><span class="hint">Planned ${fmt(s.planEnd)}</span></div>
      </div>
      <p class="hint" style="margin:0">Entering the end date marks this slab as cast.</p>
      ${admin?`<div class="planref" style="display:grid;gap:10px"><b style="color:var(--ink)">Planned dates (Site Head and Management)</b>
        <div class="grid2">
          <div class="field"><label for="bl-start">Planned start</label><input type="date" id="bl-start" value="${esc(s.planStart||"")}"></div>
          <div class="field"><label for="bl-end">Planned end</label><input type="date" id="bl-end" value="${esc(s.planEnd||"")}"></div></div>
        <input type="hidden" id="bl-rem" value="${esc(s.remark||"")}">
        <label class="checks" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="bl-shift" checked> Move every later slab by the same number of days</label>
        <div><button type="button" class="btn small" id="bl-save">Save planned dates</button></div></div>`:""}
    </div>
    <div class="field"><span class="lbl">Current stage</span>
      <div class="stages" id="stages">${[{k:"none",n:"Not started"},...STAGES].map((x,j)=>`<button type="button" data-si="${j-1}"><i></i>${x.n}<span class="when">${x.k==="none"?"":whenOf(x.k)}</span></button>`).join("")}</div></div>
    <div class="grid2">
      <div class="field"><label for="ed-date">Date of this stage</label><input type="date" id="ed-date" max="${todayIso()}" value="${todayIso()}"></div>
      <div class="field"><label for="ed-hol">Holidays in this cycle (days)</label><input type="number" id="ed-hol" min="0" max="60" inputmode="numeric" value="${esc(p.holidays||0)}"></div>
    </div>
    <div class="grid2" id="pourF">
      <div class="field"><label for="po-rmc">RMC poured (m³)</label><input type="number" id="po-rmc" min="0" step="any" inputmode="decimal" value="${esc((p.pour||{}).rmc||"")}"></div>
      <div class="field"><label for="po-grade">Concrete grade</label><input id="po-grade" placeholder="e.g. M40" value="${esc((p.pour||{}).grade||"")}"></div>
      <div class="field"><label for="po-steel">Steel used (MT)</label><input type="number" id="po-steel" min="0" step="any" inputmode="decimal" value="${esc((p.pour||{}).steel||"")}"></div>
    </div>
    <div class="field" id="chkF"><span class="lbl">Pre-pour checklist</span><div class="checks">${CHECKS.map(c=>`<label><input type="checkbox" data-chk="${c.k}" ${chk[c.k]?"checked":""}>${c.n}</label>`).join("")}</div></div>
    <div class="field"><label for="ed-note">Site note</label><textarea id="ed-note" maxlength="400" placeholder="e.g. Reinforcement 70% done, pour planned Friday">${esc(p.note||"")}</textarea></div>
    <div class="err" id="ed-err" role="alert"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="ed-save">Save update</button></div>`);
  const sync=()=>{$$("#stages [data-si]").forEach(b=>{const j=+b.dataset.si;b.setAttribute("aria-pressed",j===si);b.classList.toggle("past",j<si&&j>=0);});
    $("#pourF").hidden=si!==STAGES.length-1;$("#chkF").hidden=si<3;};
  sync();
  $$("#stages [data-si]").forEach(b=>b.onclick=()=>{si=+b.dataset.si;const dt=$("#ed-date").value||todayIso();
    if(si>=0&&!$("#ed-start").value)$("#ed-start").value=dt;
    if(si===STAGES.length-1&&!$("#ed-end").value)$("#ed-end").value=dt;
    if(si<STAGES.length-1)$("#ed-end").value="";if(si<0)$("#ed-start").value="";sync();});
  $("#ed-date").onchange=e=>{if(si===STAGES.length-1)$("#ed-end").value=e.target.value;};
  $("#ed-start").onchange=e=>{if(e.target.value&&si<0){si=0;sync();}};
  $("#ed-end").onchange=e=>{if(e.target.value){si=STAGES.length-1;}else if(si===STAGES.length-1){si=$("#ed-start").value?STAGES.length-2:-1;}sync();};
  $("#sheetForm").onsubmit=async e=>{
    e.preventDefault();const err=$("#ed-err");err.textContent="";
    const today=todayIso(),date=$("#ed-date").value||today,st=$("#ed-start").value||null,en=$("#ed-end").value||null;
    if(en)si=STAGES.length-1;else if(st&&si<0)si=0;
    const status=si<0?"pending":si===STAGES.length-1?"cast":"progress";
    if(date>today||(st&&st>today)||(en&&en>today)){err.textContent="Dates can't be in the future.";return;}
    if(status==="cast"&&!en){err.textContent="Enter the date the slab was cast.";return;}
    if(status==="cast"&&st&&en<st){err.textContent="The cast date is before the start date.";return;}
    $$("[data-chk]").forEach(x=>chk[x.dataset.chk]=x.checked);
    const stage=si<0?null:STAGES[si].k;
    const newLog=[...log];if(stage&&stage!==(p.status==="cast"?"cast":p.stage))newLog.push({stage,date:status==="cast"?en:date,by:S.me});
    const doc={status,stage,stageLog:newLog.slice(-20),actualStart:status==="pending"?null:st,actualEnd:status==="cast"?en:null,holidays:Math.max(0,Math.min(60,parseInt($("#ed-hol").value,10)||0)),checklist:chk,note:$("#ed-note").value.trim(),updatedBy:S.me,updatedAt:new Date().toISOString()};
    const btn=$("#ed-save");btn.disabled=true;btn.textContent="Saving…";
    let pour=null;
    if(status==="cast"){const r=parseFloat($("#po-rmc").value)||0,sq=parseFloat($("#po-steel").value)||0;if(r||sq)pour={rmc:r,steel:sq,grade:$("#po-grade").value.trim(),date:en};}
    if(pour)doc.pour=pour;
    try{await S.db.doc("progress/"+id).set(doc);
      const old=p.pour, now2=new Date().toISOString();
      if(old&&old.date){for(const k of ["rmc","steel"])if(old[k]&&(!pour||!pour[k]||old.date!==pour.date))await upsertMat(old.date,`pour-${id}-${k}`,{void:true});}
      if(pour){if(pour.rmc)await upsertMat(pour.date,`pour-${id}-rmc`,{type:"used",material:"rmc",qty:pour.rmc,unit:"m³",spec:pour.grade,tower:t.key,slab:id,note:"Slab pour",by:S.me,at:now2,void:false});
        if(pour.steel)await upsertMat(pour.date,`pour-${id}-steel`,{type:"used",material:"steel",qty:pour.steel,unit:"MT",spec:"",tower:t.key,slab:id,note:"Slab pour",by:S.me,at:now2,void:false});}
      closeOverlay();const miss=CHECKS.filter(c=>!chk[c.k]).length;toast(status==="cast"&&miss?`${s.name} marked cast · ${miss} pre-pour checks not ticked`:`${s.name} updated`);}
    catch(e2){if(denied(e2))return;btn.disabled=false;btn.textContent="Save update";err.textContent=saveErr(e2);}
  };
  if(admin)$("#bl-save").onclick=async()=>{
    const err=$("#ed-err");err.textContent="";
    const ns=$("#bl-start").value||null,ne=$("#bl-end").value;if(!ne){err.textContent="Enter a planned cast date.";return;}
    if(ns&&ne<ns){err.textContent="Planned cast is before planned start.";return;}
    const delta=d2n(ne)-d2n(s.planEnd||ne);
    const doc=JSON.parse(JSON.stringify(t));
    for(const x of doc.slabs){
      if(x.id===s.id){x.planStart=ns;x.planEnd=ne;x.days=ns?d2n(ne)-d2n(ns):x.days;x.remark=$("#bl-rem").value.trim();}
      else if($("#bl-shift").checked&&delta&&x.seq>s.seq){if(x.planStart)x.planStart=n2d(d2n(x.planStart)+delta);if(x.planEnd)x.planEnd=n2d(d2n(x.planEnd)+delta);}
    }
    doc.revisedAt=new Date().toISOString();doc.revisedBy=S.me;
    try{await S.db.doc("data/plan/towers/"+t.key).set(doc);closeOverlay();toast(delta&&$("#bl-shift")?`Baseline revised · later slabs moved ${delta>0?"+":""}${delta} days`:"Baseline revised");}
    catch(e2){err.textContent=e2&&e2.code==="invalid_argument"?"Only the Site Head or Management can change planned dates.":saveErr(e2);}
  };
}

/* ---- DPR sheet ---- */
async function openDpr(date){
  date=date==="today"?todayIso():date;
  let d=getDpr(date);
  if(!d){try{const snap=await S.db.doc("dpr/"+date).get();if(snap.exists)d=S.dprExtra[date]=snap.data();}catch(e){}}
  const prevKey=Object.keys(S.dpr).filter(k=>k<date).sort().pop(), prev=prevKey?S.dpr[prevKey]:null;
  const labour=d&&d.labour&&d.labour.length?d.labour:(prev&&prev.labour&&prev.labour.length?prev.labour.map(l=>({trade:l.trade,count:"",ph:l.count})):DEFAULT_TRADES.map(t=>({trade:t,count:""})));
  const work=d&&d.work&&d.work.length?d.work:[{text:"",tag:"site"}];
  const cs=S.towers.map(compute);
  const tagOpts=sel=>TAGS().map(([k,n])=>`<option value="${k}" ${k===sel?"selected":""}>${esc(n)}</option>`).join("");
  const lRow=l=>`<div class="line"><input aria-label="Trade" value="${esc(l.trade)}" data-trade><input aria-label="Count" type="number" min="0" inputmode="numeric" value="${esc(l.count)}" ${l.ph!=null?`placeholder="${esc(l.ph)}"`:""} data-count><button type="button" class="x" aria-label="Remove" data-rm>×</button></div>`;
  const wRow=w=>`<div class="line work"><input aria-label="Work item" value="${esc(w.text)}" data-wtext placeholder="e.g. Beam bottom & slab shuttering"><select aria-label="Building" data-wtag>${tagOpts(w.tag)}</select><button type="button" class="x" aria-label="Remove" data-rm>×</button></div>`;
  const slabSel=cs.filter(c=>c.cur).map(c=>{const i=stageIdx(c.cur.p);
    return `<div class="field"><label for="ss-${c.t.key}">${esc(c.t.name)} · ${esc(c.cur.name)}</label><select id="ss-${c.t.key}" data-ss="${c.cur.id}"><option value="">No change (${esc(stageName(c.cur.p))})</option>${STAGES.map((s,j)=>j>i?`<option value="${s.k}">${s.k==="cast"?"Cast on this date":s.n}</option>`:"").join("")}</select></div>`}).join("");
  sheet(`<div><div class="eyebrow">Daily progress report</div><h2>${d?"Edit":"New"} DPR</h2></div>
    <p class="hint" id="dp-draft" style="margin:0" hidden></p>
    <div class="grid2">
      <div class="field"><label for="dp-date">Date</label><input type="date" id="dp-date" max="${todayIso()}" value="${date}" ${d?"disabled":""}></div>
      <div class="field"><label for="dp-con">Contractor</label><input id="dp-con" value="${esc(d?d.contractor:(prev&&prev.contractor)||S.towers[0].contractor)}"></div>
    </div>
    <div class="field"><span class="lbl">Weather</span><div class="seg" id="weather">${WEATHER.map(w=>`<button type="button" data-w="${esc(w)}" aria-pressed="${(d?d.weather:"Clear")===w}">${esc(w)}</button>`).join("")}</div></div>
    <div class="sect"><div class="panel-head"><span class="lbl" style="font:600 13px var(--display);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">Department labour</span>${!d&&prev?`<span class="hint">Grey numbers are from ${fmtS(prevKey)}</span>`:""}</div>
      <div class="lines" id="labour">${labour.map(lRow).join("")}</div>
      <div><button type="button" class="btn small" id="addTrade">Add trade</button></div>
      <div class="total"><span>Total</span><span id="dp-total" class="num">0 nos</span></div></div>
    <div class="sect"><span class="lbl" style="font:600 13px var(--display);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">Work done</span>
      <div class="lines" id="work">${work.map(wRow).join("")}</div>
      <div><button type="button" class="btn small" id="addWork">Add work item</button></div></div>
    ${slabSel&&!d?`<div class="sect"><span class="lbl" style="font:600 13px var(--display);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">Slab stage reached today (optional)</span><div class="grid2">${slabSel}</div></div>`:""}
    <div class="sect">
      <div class="field"><label for="dp-issues">Issues / hindrances</label><textarea id="dp-issues" placeholder="e.g. RMC delayed 3 hours, pour shifted">${esc(d?d.issues:"")}</textarea></div>
      <div class="field"><label for="dp-safety">Safety</label><textarea id="dp-safety" placeholder="Toolbox talk, PPE, incidents or near misses">${esc(d?d.safety:"")}</textarea></div>
      <div class="field"><label for="dp-tom">Plan for tomorrow</label><textarea id="dp-tom">${esc(d?d.tomorrow:"")}</textarea></div>
    </div>
    <div class="err" id="dp-err" role="alert"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="dp-save">${d?"Save changes":"Submit DPR"}</button></div>`,true);
  const tot=()=>{const n=$$("#labour [data-count]").reduce((a,x)=>a+(parseInt(x.value,10)||0),0);$("#dp-total").textContent=n+" nos";return n;};
  tot();
  const bindRm=()=>$$("[data-rm]").forEach(b=>b.onclick=()=>{b.parentElement.remove();tot();saveDraft();});bindRm();
  const dkey="dsDraft:"+date;
  const collect=()=>({contractor:$("#dp-con").value,weather:($("#weather [aria-pressed=true]")||{}).dataset?.w||"",
    labour:$$("#labour .line").map(l=>({trade:l.querySelector("[data-trade]").value,count:l.querySelector("[data-count]").value})),
    work:$$("#work .line").map(l=>({text:l.querySelector("[data-wtext]").value,tag:l.querySelector("[data-wtag]").value})),
    issues:$("#dp-issues").value,safety:$("#dp-safety").value,tomorrow:$("#dp-tom").value,at:Date.now()});
  let dt2;const saveDraft=()=>{if(d)return;clearTimeout(dt2);dt2=setTimeout(()=>{try{localStorage.setItem(dkey,JSON.stringify(collect()));}catch(e){}},400);};
  if(!d){let dr=null;try{dr=JSON.parse(localStorage.getItem(dkey)||"null");}catch(e){}
    if(dr){$("#dp-con").value=dr.contractor||$("#dp-con").value;
      if(dr.weather)$$("#weather [data-w]").forEach(x=>x.setAttribute("aria-pressed",x.dataset.w===dr.weather));
      if(dr.labour&&dr.labour.length)$("#labour").innerHTML=dr.labour.map(lRow).join("");
      if(dr.work&&dr.work.length)$("#work").innerHTML=dr.work.map(wRow).join("");
      $("#dp-issues").value=dr.issues||"";$("#dp-safety").value=dr.safety||"";$("#dp-tom").value=dr.tomorrow||"";
      bindRm();tot();const el=$("#dp-draft");el.hidden=false;el.textContent=`Restored the draft you started at ${new Date(dr.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}. Nothing was lost.`;}}
  $("#sheetForm").addEventListener("input",saveDraft);$("#sheetForm").addEventListener("click",saveDraft);
  $("#labour").addEventListener("input",tot);
  $("#addTrade").onclick=()=>{$("#labour").insertAdjacentHTML("beforeend",lRow({trade:"",count:""}));bindRm();$("#labour .line:last-child input").focus();};
  $("#addWork").onclick=()=>{$("#work").insertAdjacentHTML("beforeend",wRow({text:"",tag:"site"}));bindRm();$("#work .line:last-child input").focus();};
  $$("#weather [data-w]").forEach(b=>b.onclick=()=>$$("#weather [data-w]").forEach(x=>x.setAttribute("aria-pressed",x===b)));
  $("#sheetForm").onsubmit=async e=>{
    e.preventDefault();const err=$("#dp-err");err.textContent="";
    const dt=$("#dp-date").value;if(!dt||dt>todayIso()){err.textContent="Pick a date that isn't in the future.";return;}
    if(!d&&getDpr(dt)){err.textContent=`A DPR for ${fmt(dt)} already exists. Open it from the list to edit.`;return;}
    const lab=$$("#labour .line").map(l=>({trade:l.querySelector("[data-trade]").value.trim(),count:parseInt(l.querySelector("[data-count]").value,10)||0})).filter(l=>l.trade);
    const wk=$$("#work .line").map(l=>({text:l.querySelector("[data-wtext]").value.trim(),tag:l.querySelector("[data-wtag]").value})).filter(w=>w.text);
    if(!wk.length&&!lab.some(l=>l.count)){err.textContent="Add the labour count or at least one work item.";return;}
    const now=new Date().toISOString();
    const doc={date:dt,contractor:$("#dp-con").value.trim(),weather:($("#weather [aria-pressed=true]")||{}).dataset?.w||"",labour:lab,total:lab.reduce((a,l)=>a+l.count,0),work:wk,
      issues:$("#dp-issues").value.trim(),safety:$("#dp-safety").value.trim(),tomorrow:$("#dp-tom").value.trim(),
      submittedBy:d?d.submittedBy||S.me:S.me,submittedAt:d?d.submittedAt||now:now,updatedBy:S.me,updatedAt:now};
    const btn=$("#dp-save");btn.disabled=true;btn.textContent="Saving…";
    try{
      await S.db.doc("dpr/"+dt).set(doc);
      for(const sel of $$("[data-ss]")){if(!sel.value)continue;const id=sel.dataset.ss,p=S.progress[id]||{},stage=sel.value,cast=stage==="cast";
        const upd={...p,status:cast?"cast":"progress",stage,actualStart:p.actualStart||dt,actualEnd:cast?dt:null,stageLog:[...(p.stageLog||[]),{stage,date:dt,by:S.me}].slice(-20),updatedBy:S.me,updatedAt:now};
        await S.db.doc("progress/"+id).set(upd);}
      try{localStorage.removeItem(dkey);}catch(e){}
      closeOverlay();S.dprDate=dt;if(S.view!=="dpr")location.hash="dpr";else render();toast(`DPR for ${fmtS(dt)} saved`);
    }catch(e2){if(denied(e2))return;btn.disabled=false;btn.textContent=d?"Save changes":"Submit DPR";err.textContent=saveErr(e2);}
  };
}

/* ---- hindrance sheet ---- */
function openHindrance(){
  const cs=S.towers.map(compute), tk=S.tab||cs[0].t.key;
  const opts=k=>{const c=cs.find(c=>c.t.key===k);return c.rows.map(r=>`<option value="${r.id}" ${c.cur&&c.cur.id===r.id?"selected":""}>${esc(r.name)}</option>`).join("")};
  sheet(`<div><div class="eyebrow">Hindrance register</div><h2>Log a hindrance</h2></div>
    <div class="grid2">
      <div class="field"><label for="h-tower">Building</label><select id="h-tower">${S.towers.map(t=>`<option value="${t.key}" ${t.key===tk?"selected":""}>${esc(t.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="h-slab">Slab affected</label><select id="h-slab">${opts(tk)}</select></div></div>
    <div class="field"><label for="h-cat">Cause</label><select id="h-cat">${HCATS.map(c=>`<option>${c}</option>`).join("")}</select></div>
    <div class="grid2">
      <div class="field"><label for="h-from">From</label><input type="date" id="h-from" max="${todayIso()}" value="${todayIso()}"></div>
      <div class="field"><label for="h-days">Days lost (estimate)</label><input type="number" id="h-days" min="0" max="365" inputmode="numeric" value="0"></div></div>
    <div class="field"><label for="h-desc">What happened</label><textarea id="h-desc" maxlength="600" placeholder="e.g. RMC plant shut, pour moved from Tue to Thu"></textarea></div>
    <div class="err" id="h-err" role="alert"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="h-save">Log hindrance</button></div>`);
  $("#h-tower").onchange=e=>{$("#h-slab").innerHTML=opts(e.target.value);};
  $("#sheetForm").onsubmit=async e=>{
    e.preventDefault();const err=$("#h-err");err.textContent="";
    const desc=$("#h-desc").value.trim(),from=$("#h-from").value;
    if(!from){err.textContent="Enter the date the hindrance started.";return;}
    if(!desc){err.textContent="Add a short description so management knows what happened.";return;}
    const now=new Date().toISOString();
    const doc={tower:$("#h-tower").value,slab:$("#h-slab").value,category:$("#h-cat").value,from,daysLost:Math.max(0,parseInt($("#h-days").value,10)||0),description:desc,status:"open",createdBy:S.me,createdAt:now,updatedAt:now};
    const btn=$("#h-save");btn.disabled=true;btn.textContent="Saving…";
    try{await S.db.collection("hindrances").add(doc);closeOverlay();toast("Hindrance logged");}
    catch(e2){if(denied(e2))return;btn.disabled=false;btn.textContent="Log hindrance";err.textContent=saveErr(e2);}
  };
}
async function resolveH(id,btn){
  btn.disabled=true;const now=new Date().toISOString();
  try{await S.db.doc("hindrances/"+id).update({status:"resolved",resolvedOn:todayIso(),resolvedAt:now,resolvedBy:S.me,updatedAt:now});toast("Marked resolved");}
  catch(e){if(!denied(e)){btn.disabled=false;toast("Couldn't update. Try again.");}}
}

/* ---- material sheet ---- */
async function upsertMat(date,id,item){const ref=S.db.doc("materials/"+date);const snap=await ref.get();
  if(snap.exists)await ref.update({items:{[id]:item}});else await ref.set({date,items:{[id]:item}});}
function openMaterial(type){
  const used=type==="used";
  const tagOpts=TAGS().map(([k,n])=>`<option value="${k}" ${k===S.tab?"selected":""}>${esc(n)}</option>`).join("");
  const slabOpts=k=>{const t=S.towers.find(t=>t.key===k);if(!t)return`<option value="">—</option>`;const c=compute(t);return `<option value="">Not for a specific slab</option>`+c.rows.map(r=>`<option value="${r.id}" ${c.cur&&c.cur.id===r.id?"selected":""}>${esc(r.name)}</option>`).join("")};
  sheet(`<div><div class="eyebrow">Materials</div><h2>${used?"Log consumption":"Log receipt"}</h2><p class="hint" style="margin:4px 0 0">${used?"Quantity used or issued to a building, e.g. steel issued for a slab or RMC poured.":"A delivery received on site, with its challan."}</p></div>
    <div class="grid2">
      <div class="field"><label for="m-date">Date</label><input type="date" id="m-date" max="${todayIso()}" value="${todayIso()}"></div>
      <div class="field"><label for="m-mat">Material</label><select id="m-mat">${MATS.map(m=>`<option value="${m.k}" ${m.k==="steel"?"selected":""}>${m.n}${m.u?` (${m.u})`:""}</option>`).join("")}</select></div></div>
    <div class="grid2">
      <div class="field"><label for="m-qty">Quantity ${used?"used":"received"}</label><input type="number" id="m-qty" min="0" step="any" inputmode="decimal"></div>
      <div class="field"><label for="m-unit">Unit</label><input id="m-unit" value="MT"></div></div>
    <div class="field"><label for="m-spec" id="m-spec-l">Grade / spec</label><input id="m-spec" placeholder="e.g. Fe550D 16mm, M40, OPC 53"></div>
    <div class="grid2">
      <div class="field"><label for="m-for">${used?"Used in":"For"}</label><select id="m-for">${tagOpts}</select></div>
      ${used?`<div class="field"><label for="m-slab">Slab</label><select id="m-slab">${slabOpts(S.tab)}</select></div>`:`<div class="field"><label for="m-sup">Supplier</label><input id="m-sup"></div>`}</div>
    ${used?`<div class="grid2"><div class="field"><label for="m-theo">Design / BBS qty (optional)</label><input type="number" id="m-theo" min="0" step="any" inputmode="decimal"></div><div class="field"><label for="m-note">Note</label><input id="m-note"></div></div><p class="hint" style="margin:0">Add the BBS or drawing quantity to track wastage.</p>`
      :`<div class="field"><label for="m-ch">Challan / docket no.</label><input id="m-ch"></div>`}
    <div class="err" id="m-err" role="alert"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="m-save">${used?"Log consumption":"Log receipt"}</button></div>`);
  $("#m-mat").onchange=e=>{const m=MATS.find(x=>x.k===e.target.value);$("#m-unit").value=m.u;$("#m-spec-l").textContent=m.k==="other"?"Material name":"Grade / spec";};
  if(used)$("#m-for").onchange=e=>{$("#m-slab").innerHTML=slabOpts(e.target.value);};
  $("#sheetForm").onsubmit=async e=>{
    e.preventDefault();const err=$("#m-err");err.textContent="";
    const date=$("#m-date").value,qty=parseFloat($("#m-qty").value),mat=$("#m-mat").value;
    if(!date||date>todayIso()){err.textContent="Pick a date that isn't in the future.";return;}
    if(!(qty>0)){err.textContent=`Enter the quantity ${used?"used":"received"}.`;return;}
    if(mat==="other"&&!$("#m-spec").value.trim()){err.textContent="Name the material.";return;}
    const item={type:used?"used":"in",material:mat,qty,unit:$("#m-unit").value.trim(),spec:$("#m-spec").value.trim(),tower:$("#m-for").value,by:S.me,at:new Date().toISOString()};
    if(used){item.slab=$("#m-slab").value||null;const th=parseFloat($("#m-theo").value);if(th>0)item.theo=th;item.note=$("#m-note").value.trim();}
    else{item.supplier=$("#m-sup").value.trim();item.challan=$("#m-ch").value.trim();}
    const btn=$("#m-save");btn.disabled=true;btn.textContent="Saving…";
    try{await upsertMat(date,uid(),item);closeOverlay();toast(used?"Consumption logged":"Receipt logged");}
    catch(e2){if(denied(e2))return;btn.disabled=false;btn.textContent=used?"Log consumption":"Log receipt";err.textContent=saveErr(e2);}
  };
}

async function voidMat(key,btn){const [date,id]=key.split("|");btn.disabled=true;
  try{await S.db.doc("materials/"+date).update({items:{[id]:{void:true,voidBy:S.me,voidAt:new Date().toISOString()}}});toast("Removed");}
  catch(e){if(!denied(e)){btn.disabled=false;toast("Couldn't remove. Try again.");}}}

/* ---- works cell ---- */
function cycleCell(key){
  const [fid,act]=key.split("|");const k=S.worksTab;
  const cur=(worksCells(k)[fid]||{})[act]||"";
  const next=cur===""||cur==="none"?"wip":cur==="wip"?"done":"none";
  S.worksPending[k]=S.worksPending[k]||{};S.worksPending[k][fid]={...(S.worksPending[k][fid]||{}),[act]:next,[act+"_d"]:next==="done"?todayIso():""};
  const b=document.querySelector(`[data-cell="${key}"]`);if(b){b.className="cell "+(next==="done"?"done":next==="wip"?"wip":"");b.textContent=next==="done"?"Done":next==="wip"?"On":"·";}
  clearTimeout(S.worksTimer[k]);S.worksTimer[k]=setTimeout(()=>flushWorks(k),700);
}
async function flushWorks(k){
  const pend=S.worksPending[k];if(!pend||S.worksBusy)return;S.worksBusy=true;
  const body={cells:pend,updatedBy:S.me,updatedAt:new Date().toISOString()};
  try{if(S.works[k])await S.db.doc("works/"+k).update(body);else await S.db.doc("works/"+k).set(body);
    if(S.worksPending[k]===pend)delete S.worksPending[k];}
  catch(e){if(!denied(e))toast("Couldn't save floor updates. They'll retry.");setTimeout(()=>flushWorks(k),4000);}
  finally{S.worksBusy=false;render();}
}

/* ================= events ================= */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-edit],[data-tab],[data-wtab],[data-filter],[data-newh],[data-resolve],[data-dpr],[data-day],[data-deldpr],[data-delh],[data-newmat],[data-voidmat],[data-cell],[data-matf],[data-matk],[data-rp],[data-rpcopy],[data-rpcsv],[data-qdpr],[data-qstage],[data-showall]");if(!t)return;
  const ds=t.dataset;
  if(ds.qdpr)openQuickDpr();
  else if(ds.qstage){const [id,st]=ds.qstage.split(":");openQuickStage(id,st);}
  else if(ds.showall){e.preventDefault();SHOW_ALL=true;try{localStorage.setItem("dsSiteFull","1");}catch(x){}location.hash="overview";render();}
  else if(ds.edit)openSlab(ds.edit);
  else if(ds.tab){S.tab=ds.tab;render();}
  else if(ds.wtab){S.worksTab=ds.wtab;render();}
  else if(ds.filter){S.filter=ds.filter;render();}
  else if(ds.newh)openHindrance();
  else if(ds.resolve)resolveH(ds.resolve,t);
  else if(ds.dpr)openDpr(ds.dpr);
  else if(ds.day){S.dprDate=ds.day;if(!getDpr(ds.day))loadDpr(ds.day);render();renderDprBy();}
  else if(ds.deldpr)confirmDelete(`Delete the DPR for ${fmt(ds.deldpr)}?`,"The report is removed for everyone and can't be recovered.",async()=>{await S.db.doc("dpr/"+ds.deldpr).delete();delete S.dprExtra[ds.deldpr];toast("DPR deleted");});
  else if(ds.delh){const h=S.hind.find(x=>x.id===ds.delh);confirmDelete("Delete this hindrance?",`${h?h.category:"This entry"} is removed from the register and reports for everyone.`,async()=>{await S.db.doc("hindrances/"+ds.delh).delete();toast("Hindrance deleted");});}
  else if(ds.newmat)openMaterial(ds.newmat);
  else if(ds.matf){S.matFilter=ds.matf;render();}
  else if(ds.matk){S.matKind=ds.matk;render();}
  else if(ds.rp){S.rep={...(S.rep||{}),p:ds.rp};render();}
  else if(ds.rpcopy){const txt=reportText(buildReport());navigator.clipboard.writeText(txt).then(()=>toast("Report copied. Paste it into an email or message."),()=>{sheet(`<div><h2>Copy report</h2></div><textarea style="min-height:300px;width:100%" id="cp">${esc(txt)}</textarea><div class="actions"><button type="button" class="btn primary" data-close>Done</button></div>`,true);$("#cp").select();});}
  else if(ds.rpcsv){const R=buildReport();S.dl.save({filename:`Dream Signature report ${n2d(R.a)} to ${n2d(R.b)}.csv`,data:"\ufeff"+reportCsv(R)}).then(()=>toast("Report downloaded"),e=>{if(e&&e.code!=="declined")toast("Download isn't available here. Use Copy summary instead.");});}
  else if(ds.voidmat)voidMat(ds.voidmat,t);
  else if(ds.cell)cycleCell(ds.cell);
});
document.addEventListener("change",e=>{if(e.target.id==="rp-from"||e.target.id==="rp-to"){S.rep={p:"custom",from:$("#rp-from").value,to:$("#rp-to").value};render();return;}if(e.target.id==="dprPick"&&e.target.value){S.dprDate=e.target.value;loadDpr(S.dprDate);render();}});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape")closeOverlay();
  if(e.key==="Enter"&&e.target.matches("tr[data-edit]"))openSlab(e.target.dataset.edit);
});
async function loadDpr(date){if(getDpr(date)||!S.db)return;try{const s=await S.db.doc("dpr/"+date).get();if(s.exists){S.dprExtra[date]=s.data();render();renderDprBy();}}catch(e){}}
function route(){const h=location.hash.replace("#","");S.view=navViews().some(v=>v[0]===h)?h:homeView();render();if(S.view==="dpr")renderDprBy();}
window.addEventListener("hashchange",()=>{route();window.scrollTo(0,0);});
function setRole(){
  const r=$("#role");
  if(S.canWrite===false){r.className="role";r.innerHTML="<i></i><span>View only</span>";}
  else{r.className="role edit";r.innerHTML=`<i></i><span>${S.canEdit?"Full access":"Can update"}</span>`;}
}

/* ================= boot ================= */
(async()=>{
  const db=window.claude&&window.claude.use?await window.claude.use("db"):null;
  if(!db){$("#app").innerHTML=`<div class="notice">Loading…</div>`;$("#role").innerHTML="<i></i><span>Offline</span>";return;}
  S.db=db;
  const user=await window.claude.use("user");S.user=user;
  if(user){S.me=await user.id();S.canWrite=await user.can("data.write");S.canEdit=await user.canEdit();}
  try{S.dl=await window.claude.use("downloads");}catch(e){S.dl=null;}
  setRole();
  const h=location.hash.replace("#","");S.view=navViews().some(v=>v[0]===h)?h:homeView();
  const fail=()=>{$("#app").innerHTML=`<div class="notice">Lost the connection to the project data. Reload the page to reconnect.</div>`;};
  db.collection("data/plan/towers").onSnapshot(s=>{S.towers=s.docs.map(d=>d.data()).sort((a,b)=>(a.order||0)-(b.order||0));S.loaded.t=true;render();},fail);
  db.collection("progress").onSnapshot(s=>{S.progress=Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));S.loaded.p=true;render();},fail);
  db.collection("hindrances").onSnapshot(s=>{S.hind=s.docs.map(d=>({id:d.id,...d.data()}));render();},()=>{});
  db.collection("dpr").orderBy("date","desc").limit(1000).onSnapshot(s=>{S.dpr=Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));render();if(S.view==="dpr")renderDprBy();},()=>{});
  db.collection("materials").orderBy("date","desc").limit(1000).onSnapshot(s=>{S.mats=Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));render();},()=>{});
  db.collection("works").onSnapshot(s=>{S.works=Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));render();},()=>{});
  const net=()=>{$("#offline").hidden=navigator.onLine;};window.addEventListener("online",net);window.addEventListener("offline",net);net();
  let day=todayIso();setInterval(()=>{if(todayIso()!==day){day=todayIso();render();}},60000);
})();
