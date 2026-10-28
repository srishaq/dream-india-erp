// Accounts page (the live portal's Accounts page, 13 tabs), from the ERP's accounts. Data: /api/acc-dashboard.
window.Shell={me:{tenantsEdit:false}};
let drawFlow=()=>{};const $=s=>document.querySelector(s);
function render(D){const K=D.D,C=D.C;
// click-through: each box / line registers how to list the sheet rows behind it (see accounts-detail.js)
const DR=Drill;DR.reset();
const byT=a=>a.slice().sort((x,y)=>y.t-x.t);
const inP=p=>r=>p==='td'||(p==='m'?r.m:r.f), PL={m:D.monthLabel,fy:D.fyLabel,td:'till date'};
const okR=r=>r.chq!=='Bounced', cbR=r=>okR(r)&&r.ph&&r.pt==='Current buyer'&&r.unit;
const RC=(t,f)=>DR.reg(t,X=>({sections:[{cols:'R',rows:byT(X.R.filter(f))}]}));
const PC=(t,f)=>DR.reg(t,X=>({sections:[{cols:'P',rows:byT(X.P.filter(f))}]}));
const REFH='Flat - Cancelled Refunded';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const full=v=>'₹'+Math.round(v).toLocaleString('en-IN');
const rs=v=>{if(v==null)return '—';const a=Math.abs(v);if(a===0)return '—';if(a>=1e7)return '₹'+(v/1e7).toFixed(2)+' Cr';if(a>=1e5)return '₹'+(v/1e5).toFixed(2)+' L';return full(v)};
const pct=v=>(v*100).toFixed(1)+'%';
const card=(cls,l,v,n,dk='')=>`<div class="card ${cls}" ${dk}><span class="l">${l}</span><span class="v">${v}</span>${n?`<span class="n">${n}</span>`:''}</div>`;
$('#asof').textContent='Bank balance as of '+D.asof;

// bank balance
// Groups are found by their total rows ("SIGNATURE - TOTAL", "ASPIRE - TOTAL", "GRAND TOTAL"), so banks can be added above a total
const B=D.banks, iS=B.findIndex(b=>/^SIGNATURE\s*-\s*TOTAL$/i.test(b.b)), iA=B.findIndex(b=>/^ASPIRE\s*-\s*TOTAL$/i.test(b.b)),
 sig=B.slice(0,iS), asp=B.slice(iS+1,iA), Z={cl:0,rc:0,py:0}, sT=B[iS]||Z, aT=B[iA]||Z, G=B.find(b=>/^GRAND TOTAL$/i.test(b.b))||Z;
const l4=x=>(String(x||'').match(/(\d{4})\D*$/)||[])[1]||'';
const bankV=(names)=>X=>{const bs=D.banks.filter(b=>names.includes(b.b)),k4=bs.map(b=>l4(b.no)).filter(Boolean);
 const secs=[{h:'Balances as of '+D.asof,cols:'BANK',rows:bs,sumCol:'Closing'},{h:'Daily entries',cols:'DAILY',rows:D.daily.filter(d=>names.includes(d.b)),sumCol:'Receipts',count:false}];
 if(k4.length){secs.push({h:'Receipts on this account in the cash flow',cols:'R',rows:byT(X.R.filter(r=>k4.includes(l4(r.bank)))),count:false});secs.push({h:'Payments from this account in the cash flow',cols:'P',rows:byT(X.P.filter(r=>k4.includes(l4(r.bank)))),count:false})}
 return {sub:'Closing balance '+full(bs.reduce((s,b)=>s+b.cl,0))+' as of '+D.asof,sections:secs}};
const bankD=(t,names)=>DR.reg(t,bankV(names));
const allB=B.filter(b=>!/TOTAL/.test(b.b)).map(b=>b.b);
// Summary boxes (as before): Received / Paid today leave out the morning RERA sweep between Prime's own accounts
// (RERA Collection 100% pays out to 70% / 30%), so customer money is counted once, when it lands
const SWEEP_OUT=['PRIME RERA COLLECTION 100%'], SWEEP_IN=['PRIME RERA 70%','PRIME RERA 30%'];
const extDay=(d,k)=>d.d===D.asof&&d[k]&&!(k==='py'?SWEEP_OUT:SWEEP_IN).includes(d.b);
const dayT=k=>D.daily.filter(d=>extDay(d,k)).reduce((s,d)=>s+d[k],0);
const dayD=(t,k)=>DR.reg(t,()=>({sections:[{cols:'DAILY',rows:D.daily.filter(d=>extDay(d,k)),sumCol:k==='rc'?'Receipts':'Payments'}]}),false);
const bc=(l,t,rows,n)=>`<div class="bcard" ${bankD(l+' bank accounts',rows.map(r=>r.b))}><span class="l">${l}</span><span class="v">${rs(t)}</span><span class="n">${full(t)} · ${n} accounts</span>${rows.map(r=>`<div class="row" ${bankD(r.b,[r.b])}><span>${esc(r.b)}</span><b>${rs(r.cl)}</b></div>`).join('')}</div>`;
$('#balCards').innerHTML=bc('Dream Signature',sT.cl,sig,sig.length)+bc('Dream Aspire',aT.cl,asp,asp.length)+
 `<div class="bcard dark" ${bankD('All bank accounts',allB)}><span class="l">All projects</span><span class="v">${rs(G.cl)}</span><span class="n">${full(G.cl)}</span><div class="row" ${bankD('Dream Signature bank accounts',sig.map(r=>r.b))}><span>Dream Signature</span><b>${rs(sT.cl)}</b></div><div class="row" ${bankD('Dream Aspire bank accounts',asp.map(r=>r.b))}><span>Dream Aspire</span><b>${rs(aT.cl)}</b></div><div class="row" ${dayD('Received on '+D.asof,'rc')}><span>Received today</span><b>${rs(dayT('rc'))}</b></div><div class="row" ${dayD('Paid on '+D.asof,'py')}><span>Paid today</span><b>${rs(dayT('py'))}</b></div></div>`;
$('#balDate').textContent=D.asof;
$('#stmtBtn').onclick=()=>{const h=!$('#stmt').hidden;$('#stmt').hidden=h;$('#stmtBtn').textContent=h?'Show opening, receipts and payments by account':'Hide the account table'};
// Same layout as the bank's daily balance statement: one row per account, a black total row per project, grand total last
const nz=v=>v?Math.round(v).toLocaleString('en-IN'):'';
const brow=(r,cls,attr)=>`<tr class="${cls}" ${attr}><td>${esc(r.b)}</td><td>${cls==='bk'?esc(r.no??''):''}</td><td class="num">${nz(r.op)}</td><td class="num">${nz(r.rc)}</td><td class="num">${nz(r.py)}</td><td class="num cl">${nz(r.cl)}</td></tr>`;
$('#bal').innerHTML=`<table class="btab"><thead><tr><th>Bank</th><th>A/c No.</th><th class="num">Opening Balance</th><th class="num">Receipts</th><th class="num">Payments</th><th class="num">Closing Balance</th></tr></thead><tbody>`+
 sig.map(r=>brow(r,'bk',bankD(r.b,[r.b]))).join('')+brow({...sT,b:'SIGNATURE - TOTAL'},'tot',bankD('Dream Signature bank accounts',sig.map(r=>r.b)))+
 asp.map(r=>brow(r,'bk',bankD(r.b,[r.b]))).join('')+brow({...aT,b:'ASPIRE - TOTAL'},'tot',bankD('Dream Aspire bank accounts',asp.map(r=>r.b)))+
 brow({...G,b:'GRAND TOTAL'},'tot gt',bankD('All bank accounts',allB))+'</tbody></table>';

// collections cards. Refunds on cancelled flats (Payments Out head "Flat - Cancelled Refunded")
// are taken off the total, so collections are shown net of refunds.
const REF=D.PH['Flat - Cancelled Refunded']||{m:0,fy:0,td:0,n:0};
// TDS the buyers paid to the government on our behalf (TDS Tracker) counts as received from them
const TP=(D.tds&&D.tds.per)||{m:0,fy:0,td:0,n:0}, TDE=D.tds?D.tds.entries:[];
const TECOLS=[['TDS paid on',e=>e.d],['Entry ID',e=>e.id],['Unit',e=>e.unit],['Customer',e=>e.n],['Challan / ack. no.',e=>e.ch],['Form 16B',e=>e.f16],['TDS amount',e=>e.amt,'amt']];
const tdsD=p=>DR.reg('TDS paid by customers · '+PL[p],()=>({sections:[{cols:TECOLS,rows:TDE.filter(inP(p)).slice().sort((a,b)=>b.t-a.t),sumCol:'TDS amount'}]}),false);
const totTD=C.AV.td+C.GST.td+C.SDR.td+C.Unclassified.td, netTD=totTD+TP.td-REF.td;
const HEADS4=['AV','GST','SDR','Unclassified'];
const netD=p=>DR.reg('Net collections · '+PL[p],X=>{const a=byT(X.R.filter(r=>cbR(r)&&HEADS4.includes(r.ph)&&inP(p)(r))),b=byT(X.P.filter(r=>r.cfh===REFH&&inP(p)(r)));const t=TDE.filter(inP(p)).slice().sort((x,y)=>y.t-x.t);const sa=a.reduce((s,r)=>s+r.amt,0),sb=b.reduce((s,r)=>s+r.amt,0),st=t.reduce((s,e)=>s+e.amt,0);
 return {sub:full(sa)+' received in bank + '+full(st)+' TDS − '+full(sb)+' refunded = '+full(sa+st-sb),sections:[{h:'Received from current buyers (AV, GST, SDR, unclassified)',cols:'R',rows:a},{h:'Plus: TDS paid by customers (TDS Tracker)',cols:TECOLS,rows:t,sumCol:'TDS amount'},{h:'Less: refunds on cancelled flats',cols:'P',rows:b,sign:-1}]}});
const refD=p=>PC('Refunds on cancelled flats · '+PL[p],r=>r.cfh===REFH&&inP(p)(r));
$('#cColl').innerHTML=[
 card('in','Agreement value · '+D.monthLabel,rs(C.AV.m),'Cleared receipts from current buyers',RC('Agreement value receipts · '+D.monthLabel,r=>cbR(r)&&r.ph==='AV'&&r.m)),
 card('in','Agreement value till date',rs(C.AV.td),C.AV.n.toLocaleString('en-IN')+' receipts',RC('Agreement value receipts till date',r=>cbR(r)&&r.ph==='AV')),
 card('in','GST collected till date',rs(C.GST.td),C.GST.n+' receipts',RC('GST receipts till date',r=>cbR(r)&&r.ph==='GST')),
 card('in','SDR collected till date',rs(C.SDR.td),C.SDR.n+' receipts',RC('SDR receipts till date',r=>cbR(r)&&r.ph==='SDR')),
 card('in','From earlier / other buyers',rs(C.other.td),C.other.n+' receipts on units now with another buyer',RC('Receipts from earlier / other buyers',r=>okR(r)&&r.ph&&r.pt==='Other / earlier buyer'&&r.unit)),
 card('in','Not yet linked to a unit',rs(C.nounit.td),C.nounit.n+' receipts waiting for a unit',RC('Receipts not yet linked to a unit',r=>okR(r)&&r.ph&&!r.unit)),
 card('in','TDS paid by customers till date',rs(TP.td),TP.n.toLocaleString('en-IN')+' TDS challans / Form 16B, counted as received',tdsD('td')),
 card('in tint wide','Net collections till date',rs(netTD),rs(totTD)+' in bank + '+rs(TP.td)+' TDS from current buyers, less '+rs(REF.td)+' refunded',netD('td')),
].join('');


// sales
const booked=D.units.filter(u=>u.av>0);
const UD=(t,rows,sumCol,note,cols)=>DR.reg(t,()=>({note,sections:[{cols:cols||'U',rows,sumCol}]}),false);
const gstRows=D.units.map(u=>{const gd=u.av?Math.round(u.rav*u.ga/u.av):0;return {...u,gd,gs:Math.max(0,gd-u.rg)}}).filter(u=>u.gs>0).sort((a,b)=>b.gs-a.gs);
const GCOLS=[['Unit',u=>u.u],['Buyer',u=>u.n],['Status',u=>u.s],['AV received',u=>u.rav,'amt'],['GST due on AV received',u=>u.gd,'amt'],['GST received',u=>u.rg,'amt'],['GST short',u=>u.gs,'amt'],['CP',u=>u.cp]];
const sdrRows=D.units.filter(u=>u.reg==='Done'&&u.bs>0).sort((a,b)=>b.bs-a.bs);
$('#cSales').innerHTML=[
 card('nv','Units booked',booked.length,K['Units in CRM']+' units in the CRM',UD('Booked units',booked,'Agreement value')),
 card('nv','Total agreement value',rs(K['Total Agreement Value']),'All bookings',UD('Agreement value by unit',booked,'Agreement value')),
 card('nv','Agreement value collected',pct(K['% of total AV received']),rs(K['Customer receipts - AV (current buyers)'])+' received',RC('Agreement value receipts till date',r=>cbR(r)&&r.ph==='AV')),
 card('nv','GST short on AV received',rs(K['GST shortfall on AV received']),'GST due '+rs(K['GST due on AV already received'])+' · received '+rs(K['GST received']),UD('Units with GST short on AV received',gstRows,'GST short','Each unit\'s GST due is its GST share of the agreement value received so far (GST on the booking × AV received ÷ agreement value).',GCOLS)),
 card('nv','Registered, SDR short',K['Units registered but SDR short'],'units registered before SDR was fully paid',UD('Registered units with an SDR balance',sdrRows,'SDR balance','Units whose registration is Done and still show an SDR balance on the Bookings tab. The box shows the count from the sheet\'s Dashboard tab, which uses its own rule, so this list can be longer.')),
 card('nv tint','Agreement value to collect',rs(K['AV balance to collect']),'Across all booked units',UD('Agreement value to collect by unit',D.units.filter(u=>u.bav).sort((a,b)=>b.bav-a.bav),'AV balance')),
].join('');

// expenses
const PH=D.PH;const ex=(h,l)=>{const x=PH[h]||{td:0,n:0};return card('out',l,rs(x.td),x.n+' payments',PC(l+' · till date',r=>r.cfh===h))};
const sumH=hs=>hs.reduce((a,h)=>({td:a.td+(PH[h]?.td||0),n:a.n+(PH[h]?.n||0)}),{td:0,n:0});
const CONS=[['RMC','RMC'],['STEEL','Steel'],['Mandal Infrastructure','Mandal Infrastructure'],['Site Expense','Site Expenses']];
const MKT=[['Marketing','Marketing Expenses'],['CP Commission','CP Commission'],['Mandate Commission-Statesman','Mandate Expenses']];
const ct=sumH(CONS.map(c=>c[0])),mt=sumH(MKT.map(c=>c[0]));
$('#cCons').innerHTML=CONS.map(c=>ex(...c)).join('')+card('out tint','Total construction expenses',rs(ct.td),ct.n+' payments',PC('Construction expenses · till date',r=>CONS.some(c=>c[0]===r.cfh)));
const CPC=D.cpc||{rows:[],n:0,amt:0,all:0};
const CPCOLS=[['Old unit',r=>r.ou],['Current unit',r=>r.nu],['Booking date',r=>r.d],['Applicant',r=>r.n],['Typology',r=>r.t],['CP firm',r=>r.cp],['Agreement value',r=>r.av,'amt'],['Brokerage released',r=>r.br,'amt'],['Remark',r=>r.rm],['For discussion',r=>r.fd,'desc']];
const cpcBox=card('out','CP paid on cancelled bookings',rs(CPC.amt),CPC.n+' of '+CPC.all+' cancelled bookings · already inside CP Commission',
 DR.reg('CP brokerage paid on cancelled bookings',()=>({note:'From the CP Cancelled Bookings tab: cancelled bookings where brokerage was already released, marked for discussion. This amount is part of CP Commission, so it is not added to the marketing total again.',sections:[{cols:CPCOLS,rows:CPC.rows.slice().sort((a,b)=>b.br-a.br),sumCol:'Brokerage released'}]}),false));
$('#cMkt').innerHTML=MKT.map(c=>ex(...c)+(c[0]==='CP Commission'?cpcBox:'')).join('')+card('out tint','Total marketing expenses',rs(mt.td),mt.n+' payments',PC('Marketing expenses · till date',r=>MKT.some(c=>c[0]===r.cfh)));

// data check
const okN=D.checks.filter(c=>c==='OK').length,badN=D.checks.filter(c=>c==='Check').length;
const openRI=D.ri.filter(r=>r.st==='Open');
$('#check').innerHTML=`Data check: ${okN} of ${okN+badN} checks OK · ${openRI.length} open reconciling items (${rs(openRI.reduce((s,r)=>s+r.amt,0))}) · ${C.bounced.n} bounced cheques still in the cash flow (${rs(C.bounced.td)}) · ${C.nounit.n} receipts with no unit. <a href="#rec">Review</a>`;

// collections table
const rowsC=[['Agreement value (current buyers)',C.AV,r=>cbR(r)&&r.ph==='AV'],['GST',C.GST,r=>cbR(r)&&r.ph==='GST'],['SDR',C.SDR,r=>cbR(r)&&r.ph==='SDR'],['Unclassified',C.Unclassified,r=>cbR(r)&&r.ph==='Unclassified'],['From earlier / other buyers',C.other,r=>okR(r)&&r.ph&&r.pt==='Other / earlier buyer'&&r.unit],['Not yet linked to a unit',C.nounit,r=>okR(r)&&r.ph&&!r.unit]];
// amount cells open the receipts behind them; the row label still opens the bank split
const cellsR=(l,x,f,cls='')=>['m','fy','td'].map(p=>`<td class="num${p==='td'&&cls?' '+cls:''}" ${RC(l+' · '+PL[p],r=>f(r)&&inP(p)(r))}>${rs(x[p])}</td>`).join('');
let h=`<tr><th>Collection</th><th class="num">${D.monthLabel}</th><th class="num">${D.fyLabel}</th><th class="num">Till date</th></tr>`;
rowsC.forEach(([l,x,f],i)=>{const kids=x.by?Object.entries(x.by).sort((a,b)=>b[1].td-a[1].td):[];
  h+=`<tr class="grp${kids.length?'':' nokids'}" data-g="${i}" tabindex="0"><td><b>${l}</b> <span class="cnt">${x.n.toLocaleString('en-IN')} receipts</span></td>${cellsR(l,x,f,'g')}</tr>`;
  kids.forEach(([k,v])=>h+=`<tr class="kid" data-p="${i}" hidden><td ${RC(l+' into '+k,r=>f(r)&&r.bank===k)}>${esc(k)} <span class="cnt">${v.n}</span></td>${cellsR(l+' into '+k,v,r=>f(r)&&r.bank===k)}</tr>`)});
const sumC=k=>rowsC.slice(0,4).reduce((s,[,x])=>s+x[k],0)+TP[k];
h+=`<tr class="nokids"><td><b>TDS paid by customers</b> <span class="cnt">${TP.n.toLocaleString('en-IN')} challans · counted as received</span></td>${['m','fy','td'].map(p=>`<td class="num${p==='td'?' g':''}" ${tdsD(p)}>${rs(TP[p])}</td>`).join('')}</tr>`;
h+=`<tr class="nokids"><td>Less: refunds on cancelled flats <span class="cnt">${REF.n} payments</span></td>${['m','fy','td'].map(p=>`<td class="num r" ${refD(p)}>−${rs(REF[p])}</td>`).join('')}</tr>`;
h+=`<tr class="nokids"><td><b>Net collections from current buyers</b></td><td class="num" ${netD('m')}><b>${rs(sumC('m')-REF.m)}</b></td><td class="num" ${netD('fy')}><b>${rs(sumC('fy')-REF.fy)}</b></td><td class="num g" ${netD('td')}>${rs(sumC('td')-REF.td)}</td></tr>`;
h+=`<tr class="muted nokids"><td>Bounced cheques (left out of every total) <span class="cnt">${C.bounced.n}</span></td>${cellsR('Bounced cheques',C.bounced,r=>r.chq==='Bounced')}</tr>`;
$('#tColl').innerHTML=h;
document.querySelectorAll('#tColl tr.grp').forEach(tr=>{const t=()=>{tr.classList.toggle('open');document.querySelectorAll(`#tColl tr.kid[data-p="${tr.dataset.g}"]`).forEach(k=>k.hidden=!tr.classList.contains('open'))};tr.onclick=t;tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();t()}}});

// payments table
const ph=Object.entries(PH).sort((a,b)=>b[1].td-a[1].td);
const phD={};ph.forEach(([k])=>phD[k]=['m','fy','td'].map(p=>PC(k+' · '+PL[p],r=>(r.cfh==null||r.cfh===''?'(blank)':r.cfh)===k&&inP(p)(r))));
const allD=['m','fy','td'].map(p=>PC('All payments · '+PL[p],inP(p)));let showAll=false;
function drawPay(){const r=showAll?ph:ph.slice(0,12);const T=ph.reduce((a,[,x])=>({m:a.m+x.m,fy:a.fy+x.fy,td:a.td+x.td,n:a.n+x.n}),{m:0,fy:0,td:0,n:0});
 $('#tPay').innerHTML=`<tr><th>Cash flow head</th><th class="num">Payments</th><th class="num">${D.monthLabel}</th><th class="num">${D.fyLabel}</th><th class="num">Till date</th></tr>`+
 r.map(([k,x])=>`<tr ${phD[k][2]}><td>${esc(k)}</td><td class="num">${x.n}</td><td class="num" ${phD[k][0]}>${rs(x.m)}</td><td class="num" ${phD[k][1]}>${rs(x.fy)}</td><td class="num r">${rs(x.td)}</td></tr>`).join('')+
 `<tr ${allD[2]}><td><b>All heads</b></td><td class="num"><b>${T.n.toLocaleString('en-IN')}</b></td><td class="num" ${allD[0]}><b>${rs(T.m)}</b></td><td class="num" ${allD[1]}><b>${rs(T.fy)}</b></td><td class="num r">${rs(T.td)}</td></tr>`;
 $('#payMore').textContent=showAll?'Show top 12 heads':`Show all ${ph.length} heads`}
$('#payMore').onclick=()=>{showAll=!showAll;drawPay()};drawPay();

// chart
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function niceStep(x){const p=Math.pow(10,Math.floor(Math.log10(x)));const f=x/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
const MNL=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],mLab=m=>MNL[+m.split('-')[1]-1]+' '+m.split('-')[0];
const flowD=D.flow12.map(d=>({in:RC('Money in · '+mLab(d.m),r=>okR(r)&&r.ym===d.m),out:PC('Money out · '+mLab(d.m),r=>r.ym===d.m)}));
drawFlow=function(){const data=D.flow12,box=$('#chFlow');const W=Math.max(340,box.clientWidth||900),h=320,pad={l:78,r:8,t:10,b:30};
 const mx=Math.max(100000,...data.flatMap(d=>[+d.in||0,+d.out||0]));const step=niceStep(mx/7)||100000;const top=Math.ceil(mx/step)*step;const y=v=>pad.t+(h-pad.t-pad.b)*(1-v/top);
 const bw=(W-pad.l-pad.r)/data.length;let s=`<svg width="100%" viewBox="0 0 ${W} ${h}" role="img" aria-label="Money in and out by month">`;
 for(let v=0;v<=top+1;v+=step)s+=`<line x1="${pad.l}" x2="${W-pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${css('--line')}"/><text x="${pad.l-8}" y="${y(v)+4}" text-anchor="end">${v?'₹'+(v/1e7).toFixed(2)+' Cr':'₹0'}</text>`;
 const every=Math.ceil(data.length/(W/64));
 data.forEach((d,i)=>{const w=bw*.36,x0=pad.l+i*bw+bw*.12;[['in','--in'],['out','--out']].forEach(([k,c],j)=>{s+=`<rect x="${x0+j*(w+2)}" y="${y(d[k])}" width="${w}" height="${y(0)-y(d[k])}" rx="2" fill="${css(c)}" ${flowD[i][k]}><title>${k==='in'?'Money in':'Money out'} ${rs(d[k])}</title></rect>`});
  const [yy,mm]=d.m.split('-');if(i%every===0)s+=`<text x="${pad.l+i*bw+bw/2}" y="${h-8}" text-anchor="middle">${MN[+mm-1]} ${yy.slice(2)}</text>`});
 box.innerHTML=s+'</svg>'}
drawFlow();

// units
const U=D.units.map(u=>({...u,p:u.av?u.rav/u.av:0}));
const uD={};U.forEach(u=>uD[u.u]=DR.reg('Unit '+u.u+(u.n?' · '+u.n:''),X=>{const a=byT(X.R.filter(r=>r.unit===u.u)),b=byT(X.P.filter(r=>r.unit===u.u));
 return {sub:`${a.length} receipts ${full(a.reduce((s,r)=>s+r.amt,0))} · ${b.length} payments ${full(b.reduce((s,r)=>s+r.amt,0))}`,sections:[{h:'Booking',cols:'U',rows:[u],sumCol:'-',count:false},{h:'Receipts on this unit (bounced cheques included, see the Cheque column)',cols:'R',rows:a},{h:'Payments on this unit (refunds, brokerage and others)',cols:'P',rows:b}]}}));
$('#fWing').length=1;$('#fStatus').length=1;
[...new Set(U.map(u=>u.w))].sort().forEach(w=>$('#fWing').insertAdjacentHTML('beforeend',`<option>${esc(w)}</option>`));
[...new Set(U.map(u=>u.s))].forEach(s=>$('#fStatus').insertAdjacentHTML('beforeend',`<option>${esc(s)}</option>`));
const COLS=[['u','Unit'],['n','Buyer'],['s','Status'],['bdt','Booking date'],['rdt','Registration date'],['av','Agreement value',1],['bk','Received in bank',1],['tx','TDS',1],['tot','Total received',1],['crm','CRM ledger',1],['df','Diff. vs CRM',1],['p','% AV received',1],['bav','AV balance',1],['bg','GST due',1],['bs','SDR due',1],['cp','CP']];
let sk='bav',sd=-1,lim=25;
function drawUnits(){const q=$('#q').value.trim().toLowerCase(),fw=$('#fWing').value,fs=$('#fStatus').value;
 const r=U.filter(u=>(!fw||u.w===fw)&&(!fs||u.s===fs)&&(!q||(u.u+' '+u.n+' '+u.cp).toLowerCase().includes(q))).sort((a,b)=>{const x=a[sk],y=b[sk];return (typeof x==='number'?x-y:String(x).localeCompare(String(y)))*sd});
 const T=r.reduce((t,u)=>(t.av+=u.av,t.tot+=u.tot,t.tx+=u.tx,t.bav+=u.bav,t.ms+=Math.abs(u.df)>=1000?1:0,t),{av:0,tot:0,tx:0,bav:0,ms:0});
 $('#unitCount').textContent=`${r.length} units · agreement value ${rs(T.av)} · received ${rs(T.tot)} (incl. ${rs(T.tx)} TDS) · AV balance ${rs(T.bav)} · ${T.ms} differ from the CRM ledger`;
 $('#tUnits').innerHTML='<tr>'+COLS.map(([k,l,n])=>`<th class="s${n?' num':''}" data-k="${k}">${l}${sk===k?(sd<0?' ↓':' ↑'):''}</th>`).join('')+'</tr>'+
  r.slice(0,lim).map(u=>`<tr ${uD[u.u]}><td><b>${esc(u.u)}</b></td><td>${esc(u.n)}</td><td>${esc(u.s)}</td><td style="white-space:nowrap">${esc(u.bd)}</td><td style="white-space:nowrap">${esc(u.rd)}</td><td class="num">${rs(u.av)}</td><td class="num">${rs(u.bk)}</td><td class="num">${rs(u.tx)}</td><td class="num g">${rs(u.tot)}</td><td class="num">${rs(u.crm)}</td><td class="num${Math.abs(u.df)>=1000?' r':''}">${u.df?(u.df<0?'−':'')+rs(Math.abs(u.df)):'—'}</td><td class="num"><span class="prog"><i style="width:${Math.min(100,u.p*100)}%"></i></span>${u.av?pct(u.p):'—'}</td><td class="num">${rs(u.bav)}</td><td class="num">${rs(u.bg)}</td><td class="num">${rs(u.bs)}</td><td>${esc(u.cp)}</td></tr>`).join('');
 const b=$('#unitMore');b.hidden=r.length<=25;b.textContent=lim<r.length?`Show all ${r.length} units`:'Show fewer';
 document.querySelectorAll('#tUnits th.s').forEach(th=>th.onclick=()=>{const k=th.dataset.k;sd=sk===k?-sd:-1;sk=k;drawUnits()})}
$('#unitMore').onclick=()=>{lim=lim===25?100000:25;drawUnits()};
['#q','#fWing','#fStatus'].forEach(s=>$(s).addEventListener('input',()=>{lim=25;drawUnits()}));drawUnits();


}

// numbers come from /api/acc-dashboard, worked out from the ERP's accounts
const setLive=(t,warn)=>{const el=$('#live');el.textContent=t;el.style.color=warn?'var(--out)':'var(--in)'};
let busy=false;
Drill.src='/api/acc-dashboard?detail=1';
Drill.mount();
async function loadLive(force){
  if(busy)return;busy=true;if(force)Drill.dropDetail();setLive('Working out the figures…');
  try{
    const r=await fetch('/api/acc-dashboard'+(force?'?refresh=1':''),{cache:'no-store',credentials:'same-origin'});
    if(r.status===401){location.href='/';return}
    const j=await r.json().catch(()=>({}));
    if(r.status===403)throw new Error('your login does not include Accounts');
    if(!r.ok)throw new Error(j.error||('the server answered '+r.status));
    if(j.user)$('#user').textContent=j.user.name;
    render(j);
    setLive('From the ERP, worked out at '+new Date(j.readAt||Date.now()).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
  }catch(e){setLive('Could not load the figures: '+(e.message||e),true);console.error(e)}
  finally{$('#reload').hidden=false;busy=false}
}
$('#reload').onclick=()=>loadLive(true);
// Tabs: show only the sections of the tab clicked (the address keeps the tab, e.g. /accounts#tenants, so Back and links work).
const TABS=[...document.querySelectorAll('nav.tabs a')].map(a=>a.hash.slice(1));
function showTab(t){
  if(!TABS.includes(t))t='balance';
  document.querySelectorAll('main [data-tab]').forEach(el=>el.classList.toggle('v-on',el.dataset.tab.split(' ').includes(t)));
  document.querySelectorAll('nav.tabs a').forEach(a=>{const on=a.hash==='#'+t;a.classList.toggle('on',on);if(on){a.setAttribute('aria-current','page');a.scrollIntoView({block:'nearest',inline:'nearest'})}else a.removeAttribute('aria-current')});
  window.scrollTo(0,0);
  if(t==='trend')requestAnimationFrame(()=>drawFlow());
}
addEventListener('hashchange',()=>showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

loadLive();

let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>drawFlow(),150)});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>drawFlow());
new MutationObserver(()=>drawFlow()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
