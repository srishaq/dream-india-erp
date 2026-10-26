// CA / Tax page (the live portal's CA page), from the ERP's accounts. Data: /api/ca.
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const full=v=>(v<0?'−':'')+'₹'+Math.round(Math.abs(v)).toLocaleString('en-IN');
const rs=v=>{if(v==null)return '—';const a=Math.abs(v);if(a<0.5)return '—';const s=v<0?'−':'';if(a>=1e7)return s+'₹'+(a/1e7).toFixed(2)+' Cr';if(a>=1e5)return s+'₹'+(a/1e5).toFixed(2)+' L';return full(v)};
const pc=v=>(Math.round(v*1000)/10)+'%';
const nf=v=>Math.round(v).toLocaleString('en-IN');
const card=(cls,l,v,n,dk='')=>`<div class="card ${cls}" ${dk}><span class="l">${l}</span><span class="v">${v}</span>${n?`<span class="n">${n}</span>`:''}</div>`;
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const mLabel=k=>{if(k==='-')return 'No date';const[y,m]=k.split('-');return MN[+m-1]+' '+y};
const byT=a=>a.slice().sort((x,y)=>y.t-x.t);
let D=null, PER='', ASOF=0, reraShown=50, compAll=false;

// ---- period: a financial year (Apr-Mar) or till date ----
const fyRange=l=>{const y=+l.slice(3,7);return [y+'-04',(y+1)+'-03']};
const inPer=ym=>{if(PER==='td')return true;if(!ym||ym==='-')return false;const[a,b]=fyRange(PER);return ym>=a&&ym<=b};
const perLabel=()=>PER==='td'?'till date':PER;
const sumM=o=>Object.entries(o||{}).reduce((s,[k,v])=>s+(inPer(k)?v:0),0);
const monthsIn=()=>D.months.filter(inPer);

// column sets for the click-through lists (see accounts-detail.js: [label, value(row), kind])
const CT=[['Date',e=>e.d],['Entry ID',e=>e.id],['Unit',e=>e.unit],['Customer',e=>e.n],['Demand',e=>e.dem],['Challan / acknowledgement',e=>e.ch],['Form 16B received?',e=>e.f16],['Certificate',e=>e.link,'link'],['Remark',e=>e.rm,'desc'],['Amount',e=>e.amt,'amt']];
const CVB=[['Bill date',b=>b.d],['Bill ID',b=>b.id],['Vendor',b=>b.v],['PAN',b=>b.pan],['Head',b=>b.cfh],['TDS section',b=>b.tsec],['Bill no.',b=>b.no],['Taxable value',b=>b.tv,'amt'],['GST',b=>b.gst,'amt'],['Total bill',b=>b.tot,'amt'],['TDS deducted',b=>b.tds,'amt'],['Paid',b=>b.paid,'amt'],['TDS challan',b=>b.ch],['Remark',b=>b.rm,'desc']];
const CCC=[['Due date',c=>c.d],['Compliance',c=>c.c],['Law',c=>c.law],['Period',c=>c.per],['Status',c=>c.state],['Date complied',c=>c.cd],['Acknowledgement / challan',c=>c.ack],['Responsible',c=>c.who],['Days late',c=>c.late||'','n'],['Remark',c=>c.rm,'desc']];
const CU=[['Unit',u=>u.u],['Type',u=>u.typ],['Carpet (sq ft)',u=>u.area||'','n'],['Buyer',u=>u.n],['CRM status',u=>u.st],['Booking date',u=>u.bd],['Registration date',u=>u.rd],['Agreement value',u=>u.av,'amt'],['AV received (bank)',u=>u.rec,'amt'],['TDS by customer',u=>u.tds,'amt'],['Total received',u=>u.tot,'amt'],['Balance receivable',u=>u.bal,'amt'],['Received before RERA a/c opened',u=>u.pre,'amt'],['Received outside RERA a/c',u=>u.out,'amt'],['All money in RERA account?',u=>u.ok]];

function render(){
const S=D.settings, DR=Drill; DR.reset();
const RL=(t,f,extra)=>DR.reg(t,X=>({sections:[{cols:'R',rows:byT(X.R.filter(r=>inPer(r.ym)&&f(r)))}],...(extra||{})}));
const PL=(t,f,extra)=>DR.reg(t,X=>({sections:[{cols:'P',rows:byT(X.P.filter(r=>inPer(r.ym)&&f(r)))}],...(extra||{})}));
$('#asof').textContent='Entries up to '+D.latest;
$('#cashSub').textContent=perLabel();

// warnings: missing tabs and heads not on the CA Settings head map
const w=[];
const um=[...D.unmapped.Receipt.map(h=>h+' (receipt)'),...D.unmapped.Payment.map(h=>h+' (payment)')];
if(um.length)w.push('Entries with no cash flow head, or a head not set up yet: '+um.map(esc).join(', ')+'. Give them a head (set heads up in Accounts → Banks, heads & import) so they land in the right place.');
$('#warn').hidden=!w.length;$('#warn').innerHTML=w.join('<br>');

// ---------- GST ----------
const G=D.gst, R_=S.gstRate;
const av=sumM(G.av)+sumM(G.avOther), ref=sumM(G.ref), tds=sumM(G.tds), net=av-ref+tds, due=net*R_, gin=sumM(G.gstIn), gpaid=sumM(G.gstPaid);
const tdsRows=()=>byT(D.ctds.entries.filter(e=>inPer(e.ym)));
const netSecs=(f)=>X=>{const a=byT(X.R.filter(r=>r.cav&&inPer(r.ym)&&f(r.ym))),b=byT(X.P.filter(p=>p.cfh===S.refundHead&&inPer(p.ym)&&f(p.ym))),c=byT(D.ctds.entries.filter(e=>inPer(e.ym)&&f(e.ym)));
 const sa=a.reduce((s,r)=>s+r.amt,0),sb=b.reduce((s,r)=>s+r.amt,0),sc=c.reduce((s,r)=>s+r.amt,0);
 return {sub:full(sa)+' AV received − '+full(sb)+' refunded + '+full(sc)+' TDS by customers = '+full(sa-sb+sc)+' · GST at '+pc(R_)+' = '+full((sa-sb+sc)*R_),
  sections:[{h:'Agreement value received from customers',cols:'R',rows:a},{h:'Less: refunds on cancelled flats',cols:'P',rows:b,sign:-1},{h:'Add: TDS deducted by customers (not received in the bank)',cols:CT,rows:c}]}};
$('#cGst').innerHTML=[
 card('in','AV received from customers',rs(av),'Bank receipts against flats, '+perLabel(),RL('Agreement value received · '+perLabel(),r=>r.cav)),
 card('out','Less: refunds on cancelled flats',rs(ref),'Payments Out head "'+esc(S.refundHead)+'"',PL('Refunds on cancelled flats · '+perLabel(),p=>p.cfh===S.refundHead)),
 card('in','Add: TDS deducted by customers',rs(tds),'From the TDS Tracker; not received in the bank',DR.reg('TDS deducted by customers · '+perLabel(),()=>({sections:[{cols:CT,rows:tdsRows()}]}),false)),
 card('in tint','Net consideration received',rs(net),full(net),DR.reg('Net consideration received · '+perLabel(),netSecs(()=>true))),
 card('nv tint','GST due on it at '+pc(R_),rs(due),'Estimate; rate set in the ERP settings',DR.reg('GST due on consideration received · '+perLabel(),netSecs(()=>true))),
 card('in','GST collected from customers',rs(gin),'Receipts with payment head GST',RL('GST collected from customers · '+perLabel(),r=>r.ph==='GST')),
 card('out','GST paid to government',rs(gpaid),'Payments Out head GST PAID',PL('GST paid to government · '+perLabel(),p=>p.k==='GST paid to government')),
 card((due-gpaid)>0?'out':'in','GST due less GST paid',rs(due-gpaid),'Before input credit and earlier periods',DR.reg('GST due and GST paid · '+perLabel(),X=>{const v=netSecs(()=>true)(X);v.sections.push({h:'GST paid to government',cols:'P',rows:byT(X.P.filter(p=>p.k==='GST paid to government'&&inPer(p.ym))),count:false});return v})),
].join('');
$('#gstSub').textContent='Net consideration = AV received − refunds + TDS by customers. GST at '+pc(R_)+'. Tap a month for its entries.';
const ms=monthsIn();const mrow=(k)=>{const a=(G.av[k]||0)+(G.avOther[k]||0),b=G.ref[k]||0,c=G.tds[k]||0,n=a-b+c;return {a,b,c,n,g:n*R_,gi:G.gstIn[k]||0,gp:G.gstPaid[k]||0}};
let tot={a:0,b:0,c:0,n:0,g:0,gi:0,gp:0};
$('#tGst').innerHTML='<tr><th>Month</th><th class="num">AV received</th><th class="num">Refunds</th><th class="num">TDS by customers</th><th class="num">Net consideration</th><th class="num">GST at '+pc(R_)+'</th><th class="num">GST collected</th><th class="num">GST paid</th></tr>'+
 ms.map(k=>{const x=mrow(k);for(const q in tot)tot[q]+=x[q];return `<tr ${DR.reg('GST · '+mLabel(k),netSecs(m=>m===k))}><td>${mLabel(k)}</td><td class="num">${rs(x.a)}</td><td class="num">${rs(x.b)}</td><td class="num">${rs(x.c)}</td><td class="num"><b>${rs(x.n)}</b></td><td class="num">${rs(x.g)}</td><td class="num">${rs(x.gi)}</td><td class="num">${rs(x.gp)}</td></tr>`}).join('')+
 `<tr class="tot"><td>Total</td><td class="num">${rs(tot.a)}</td><td class="num">${rs(tot.b)}</td><td class="num">${rs(tot.c)}</td><td class="num">${rs(tot.n)}</td><td class="num">${rs(tot.g)}</td><td class="num">${rs(tot.gi)}</td><td class="num">${rs(tot.gp)}</td></tr>`;

// ---------- TDS payable ----------
const MAP=D.map.Payment, secOf=h=>(MAP[h]||{}).tsec||'', rateOf=h=>(MAP[h]||{}).trate||0;
const heads=Object.keys(D.payBy);
const bySec={};for(const h of heads){const s=secOf(h);if(!s)continue;const a=sumM(D.payBy[h]);if(!a)continue;const x=(bySec[s]=bySec[s]||{paid:0,exp:0,heads:[],rate:new Set()});x.paid+=a;const r=rateOf(h);x.exp+=r?a*r/(1-r):0;x.heads.push(h);if(r)x.rate.add(pc(r))}
const vb=D.vb.filter(b=>inPer(b.ym)), vbT=vb.reduce((s,b)=>s+b.tot,0), vbTds=vb.reduce((s,b)=>s+b.tds,0);
const vend=Object.entries(bySec).filter(([s])=>s!=='192').reduce((s,[,x])=>s+x.paid,0), emp=(bySec['192']||{paid:0}).paid;
const exp=Object.values(bySec).reduce((s,x)=>s+x.exp,0), dep=sumM(D.lineBy['TDS deposited'])*-1;
const tdsHeads=heads.filter(h=>secOf(h)&&secOf(h)!=='192');
const vbD=t=>DR.reg(t,()=>({sections:[{cols:CVB,rows:byT(vb),sumCol:'Total bill'}],note:vb.length?'':'No bills entered yet. Staff fill the bill columns on each payment in Payments Out.'}),false);
$('#cTdsp').innerHTML=[
 card(vb.length?'':'need','Total billings by vendors',vb.length?rs(vbT):'Needs input',vb.length?vb.length+' bills entered on payments':'Staff enter bill details on each payment',vbD('Vendor bills · '+perLabel())),
 card('out','Paid to vendors, contractors, consultants, CPs and landlords',rs(vend),tdsHeads.length+' heads that attract TDS',PL('Paid to vendors and contractors · '+perLabel(),p=>tdsHeads.includes(p.cfh))),
 card('out','Paid to employees',rs(emp),'Salary (section 192)',PL('Salary payments · '+perLabel(),p=>secOf(p.cfh)==='192')),
 card(vb.length?'':'need','TDS deducted on vendor bills',vb.length?rs(vbTds):'Needs input','From the bill details on payments',vbD('TDS deducted on vendor bills · '+perLabel())),
 card('out','TDS deposited with government',rs(dep),'Payments Out head TDS',PL('TDS deposited · '+perLabel(),p=>p.k==='TDS deposited')),
 card('nv tint','TDS expected at standard rates',rs(exp),'Estimate from the net amounts paid',PL('Payments that attract TDS · '+perLabel(),p=>!!secOf(p.cfh)&&secOf(p.cfh)!=='192')),
 card((exp-dep)>0?'out tint':'in tint','Possible shortfall in TDS',rs(Math.max(0,exp-dep)),'Expected less deposited; check against the TDS returns',PL('Payments that attract TDS · '+perLabel(),p=>!!secOf(p.cfh)&&secOf(p.cfh)!=='192')),
].join('');
const SECN={'192':'Salary','194C':'Contractors and sub-contractors','194H':'Commission and brokerage (CPs)','194-I':'Rent','194J':'Professional and technical fees','194Q':'Purchase of goods (steel, RMC, material)','194-IA':'Purchase of property (buy back)'};
const secs=Object.entries(bySec).sort((a,b)=>b[1].paid-a[1].paid);
$('#tTdsp').innerHTML='<tr><th>Section</th><th>Heads</th><th class="num">Paid</th><th class="num">Rate</th><th class="num">Expected TDS (estimate)</th><th class="num">TDS deducted (bills)</th></tr>'+
 secs.map(([s,x])=>`<tr ${PL('Section '+s+' · '+perLabel(),p=>secOf(p.cfh)===s)}><td><b>${esc(s)}</b> <span class="cnt">${esc(SECN[s]||'')}</span></td><td class="desc">${x.heads.map(esc).join(', ')}</td><td class="num">${rs(x.paid)}</td><td class="num">${[...x.rate].join(', ')||'Slab'}</td><td class="num">${s==='192'?'—':rs(x.exp)}</td><td class="num">${rs(vb.filter(b=>b.tsec===s).reduce((t,b)=>t+b.tds,0))}</td></tr>`).join('')+
 `<tr class="tot"><td>Total</td><td></td><td class="num">${rs(secs.reduce((t,[,x])=>t+x.paid,0))}</td><td></td><td class="num">${rs(exp)}</td><td class="num">${rs(vbTds)}</td></tr>`;

renderRera(); renderCash(); renderComp();

// ---------- customer TDS (194-IA) ----------
const ce=tdsRows(), ceAll=D.ctds.entries, f16=e=>/^y/i.test(e.f16), lk=e=>/^https?:/i.test(e.link||'');
const CTD=(t,rows)=>DR.reg(t,()=>({sections:[{cols:CT,rows:byT(rows)}]}),false);
$('#cCtds').innerHTML=[
 card('','TDS due over the project',rs(D.ctds.due),'1% of agreement value on '+nf(D.ctds.flats)+' booked flats'),
 card('in','TDS paid by customers till date',rs(D.ctds.paid),nf(ceAll.length)+' challans on the TDS Tracker',CTD('TDS paid by customers till date',ceAll)),
 card('in tint','TDS paid · '+perLabel(),rs(ce.reduce((s,e)=>s+e.amt,0)),nf(ce.length)+' challans',CTD('TDS paid by customers · '+perLabel(),ce)),
 card('in','Form 16B received',nf(ce.filter(f16).length),rs(ce.filter(f16).reduce((s,e)=>s+e.amt,0))+' · '+perLabel(),CTD('Form 16B received · '+perLabel(),ce.filter(f16))),
 card('out','Form 16B not received yet',nf(ce.filter(e=>!f16(e)).length),rs(ce.filter(e=>!f16(e)).reduce((s,e)=>s+e.amt,0))+' · ask the customers',CTD('Form 16B not received · '+perLabel(),ce.filter(e=>!f16(e)))),
 card('','Certificates linked',nf(ce.filter(lk).length),'Paste the Drive link in the TDS Tracker "Form 16B Certificate (link)" column',CTD('Certificates linked · '+perLabel(),ce.filter(lk))),
].join('');

// ---------- non-revenue receipts ----------
const cats=Object.entries(D.catBy).map(([c,o])=>[c,sumM(o)]).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]);
const nonTot=cats.filter(([c])=>!/^Internal transfer/.test(c)).reduce((s,[,v])=>s+v,0);
const isCust=r=>r.cat==='Customer receipts (revenue)';
$('#cNon').innerHTML=card('in tint','Non-revenue receipts',rs(nonTot),'Excluding transfers between own accounts',RL('Non-revenue receipts · '+perLabel(),r=>!isCust(r)&&!/^Internal transfer/.test(r.cat)))+
 cats.map(([c,v])=>card(/^Needs|^Not mapped/.test(c)?'need':'in',esc(c),rs(v),/^Needs|^Not mapped/.test(c)?'Give these a proper head':'',RL(c+' · '+perLabel(),r=>r.cat===c))).join('');
const RM=D.map.Receipt;const hc=h=>(RM[h]||{}).cat||'Not mapped';
$('#tNon').innerHTML='<tr><th>Category</th><th>Head</th><th class="num">Amount</th></tr>'+cats.map(([c,v])=>{
 const hs=Object.keys(D.recBy).filter(h=>hc(h)===c).map(h=>[h,sumM(D.recBy[h])]).filter(([,x])=>x).sort((a,b)=>b[1]-a[1]);
 return `<tr class="grp2" ${RL(c+' · '+perLabel(),r=>r.cat===c)}><td><b>${esc(c)}</b></td><td></td><td class="num"><b>${rs(v)}</b></td></tr>`+hs.map(([h,x])=>`<tr class="kid" ${RL(h+' · '+perLabel(),r=>r.cfh===h&&!isCust(r))}><td></td><td>${esc(h)}</td><td class="num">${rs(x)}</td></tr>`).join('')}).join('');
}

// ---------- RERA ----------
let RERA=[];
function reraUnits(){
 const S=D.settings, end=ASOF||Infinity, today=!ASOF;
 const U=D.units.map(u=>({...u,rec:0,tds:0,pre:0,out:0}));
 for(const[i,t,a,inR,pre]of D.avr){if(t>end||(!t&&!today))continue;const u=U[i];u.rec+=a;if(pre)u.pre+=a;else if(!inR)u.out+=a}
 for(const[i,t,a]of D.tdsr){if(t>end||(!t&&!today))continue;U[i].tds+=a}
 return U.filter(u=>u.av>0&&(u.bt?u.bt<=end:today||u.rec>0)).map(u=>({...u,tot:u.rec+u.tds,bal:u.av-u.rec-u.tds,ok:u.out>0.5?'No':'Yes'}));
}
function renderRera(){
 const DR=Drill;RERA=reraUnits();const S=D.settings;
 const asl=ASOF?'as of '+new Date(ASOF).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'till date';
 const sm=(a,k)=>a.reduce((s,u)=>s+u[k],0), yes=RERA.filter(u=>u.ok==='Yes'), no=RERA.filter(u=>u.ok==='No');
 const UL=(t,rows,extra)=>DR.reg(t,X=>({sections:[{cols:CU,rows:rows,sumCol:'Total received'},...(extra?extra(X):[])]}),!!extra);
 const outR=X=>[{h:'AV receipts that went into another account after the RERA account opened',cols:'R',rows:byT(X.R.filter(r=>r.cav&&r.bank!==S.reraAcct&&r.t>=S.reraStart&&(!ASOF||r.t<=ASOF))),count:false}];
 const preR=X=>[{h:'AV receipts before the RERA collection account opened on '+S.reraStartD,cols:'R',rows:byT(X.R.filter(r=>r.cav&&r.t&&r.t<S.reraStart)),count:false}];
 $('#cRera').innerHTML=[
  card('','Units booked',nf(RERA.length),nf(sm(RERA,'area'))+' sq ft carpet',UL('Units booked · '+asl,RERA)),
  card('','Agreement value',rs(sm(RERA,'av')),full(sm(RERA,'av')),UL('Agreement value · '+asl,RERA)),
  card('in','Amount received',rs(sm(RERA,'tot')),rs(sm(RERA,'rec'))+' in the bank + '+rs(sm(RERA,'tds'))+' TDS by customers',UL('Amount received · '+asl,RERA)),
  card('out tint','Balance receivable',rs(sm(RERA,'bal')),'Agreement value less amount received',UL('Balance receivable · '+asl,RERA.filter(u=>u.bal>0.5))),
  card('in','All money in RERA account: Yes',nf(yes.length)+' units','Every AV receipt since '+S.reraStartD+' went into '+esc(S.reraAcct),UL('In RERA account: Yes · '+asl,yes)),
  card(no.length?'out tint':'in','All money in RERA account: No',nf(no.length)+' units',rs(sm(no,'out'))+' went into another account',UL('In RERA account: No · '+asl,no,outR)),
  card('','Received before RERA account opened',rs(sm(RERA,'pre')),'AV received before '+S.reraStartD,UL('Received before the RERA account opened · '+asl,RERA.filter(u=>u.pre>0),preR)),
 ].join('');
 $('#reraSub').textContent=nf(RERA.length)+' booked units '+asl+'. Amount received includes TDS paid by the customer. Booking date is the booking date in the ERP.';
 drawReraTable();
}
function drawReraTable(){
 const q=$('#rq').value.trim().toLowerCase(), ok=$('#rOk').value;
 const rows=RERA.filter(u=>(!ok||u.ok===ok)&&(!q||(u.u+' '+u.n).toLowerCase().includes(q))).sort((a,b)=>a.u.localeCompare(b.u));
 $('#tRera').innerHTML='<tr><th>Unit</th><th>Type</th><th class="num">Carpet</th><th>Buyer</th><th>Booked</th><th>Registered</th><th class="num">Agreement value</th><th class="num">Received</th><th class="num">Balance</th><th>RERA a/c</th></tr>'+
  rows.slice(0,reraShown).map(u=>`<tr><td><b>${esc(u.u)}</b></td><td>${esc(u.typ)}</td><td class="num">${u.area?nf(u.area):''}</td><td>${esc(u.n)}</td><td>${esc(u.bd)}</td><td>${esc(u.rd)}</td><td class="num">${rs(u.av)}</td><td class="num">${rs(u.tot)}</td><td class="num">${rs(u.bal)}</td><td class="${u.ok==='Yes'?'g':'r'}">${u.ok}${u.out?` <span class="cnt">${rs(u.out)} outside</span>`:''}</td></tr>`).join('');
 $('#reraMore').hidden=rows.length<=reraShown;$('#reraMore').textContent='Show all '+nf(rows.length)+' units';
}
$('#rq').oninput=()=>{reraShown=50;drawReraTable()};$('#rOk').onchange=()=>{reraShown=50;drawReraTable()};
$('#reraMore').onclick=()=>{reraShown=1e9;drawReraTable()};

// ---------- cash flow ----------
function renderCash(){
 const DR=Drill, L=k=>sumM(D.lineBy[k]);
 const RL=(t,f)=>DR.reg(t,X=>({sections:[{h:'Money in',cols:'R',rows:byT(X.R.filter(r=>inPer(r.ym)&&f(r)))},{h:'Money out',cols:'P',rows:byT(X.P.filter(p=>inPer(p.ym)&&f(p))),sign:-1}]}));
 const line=(label,v,f,cls='',ind=false)=>`<tr class="${cls}" ${f?RL(label.replace(/<[^>]+>/g,'')+' · '+perLabel(),f):''}><td${ind?' class="ind"':''}>${label}</td><td class="num ${v<0?'r':''}">${v<0?'('+rs(-v).replace('−','')+')':rs(v)}</td></tr>`;
 const k=n=>r=>r.k===n;
 const exp=L('Indirect expenses (P&L)');
 const wc=[['Advances received from customers',L('Advances received from customers'),k('Advances received from customers')],['Refunds to customers (decrease in advances)',L('Refunds to customers'),k('Refunds to customers')],
  ['Increase in GST payable (collected less paid)',L('GST collected from customers')+L('GST paid to government'),r=>r.k==='GST collected from customers'||r.k==='GST paid to government'],
  ['Increase in SDR payable (collected less paid)',L('SDR collected from customers')+L('SDR paid for customers'),r=>r.k==='SDR collected from customers'||r.k==='SDR paid for customers'],
  ['TDS deposited (decrease in TDS payable)',L('TDS deposited'),k('TDS deposited')],['Increase in inventory: project cost',L('Project cost (added to inventory)'),k('Project cost (added to inventory)')],
  ['Other operating receipts',L('Other operating receipts'),k('Other operating receipts')]];
 if(D.lineBy['Not mapped'])wc.push(['No cash flow head set up',L('Not mapped'),k('Not mapped')]);
 const opT=exp+wc.reduce((s,x)=>s+x[1],0);
 const sec=(name)=>{const o={};for(const[key,v]of Object.entries(D.secIn))if(key.startsWith(name+'|'))o[key.slice(name.length+1)]=(o[key.slice(name.length+1)]||0)+sumM(v);for(const[key,v]of Object.entries(D.secOut))if(key.startsWith(name+'|'))o[key.slice(name.length+1)]=(o[key.slice(name.length+1)]||0)-sumM(v);return Object.entries(o).filter(([,v])=>Math.abs(v)>0.5).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))};
 const inv=sec('Investing'),fin=sec('Financing'),tr=sec('Internal transfer'),nm=sec('Not mapped');
 const sT=a=>a.reduce((s,[,v])=>s+v,0);
 const hl=(s)=>([h,v])=>line(esc(h),v,r=>r.sec===s&&r.cfh===h,'',true);
 const net=opT+sT(inv)+sT(fin)+sT(tr)+sT(nm);
 const hd=t=>`<tr class="hd"><td colspan="2">${t}</td></tr>`;
 $('#tInd').innerHTML='<tr><th>'+esc(perLabel())+'</th><th class="num">₹</th></tr>'+
  hd('A. Cash flow from operating activities')+line('Net loss before tax (indirect expenses; no sales booked as revenue yet)',exp,k('Indirect expenses (P&L)'))+
  `<tr class="sub2"><td colspan="2">Changes in working capital</td></tr>`+wc.map(([l,v,f])=>line(l,v,f,'',true)).join('')+
  line('<b>Net cash from operating activities</b>',opT,r=>r.sec==='Operating','tot')+
  hd('B. Cash flow from investing activities')+inv.map(hl('Investing')).join('')+line('<b>Net cash from investing activities</b>',sT(inv),r=>r.sec==='Investing','tot')+
  hd('C. Cash flow from financing activities')+fin.map(hl('Financing')).join('')+line('<b>Net cash from financing activities</b>',sT(fin),r=>r.sec==='Financing','tot')+
  (nm.length?hd('No cash flow head set up')+nm.map(hl('Not mapped')).join(''):'')+
  line('Net transfers to own accounts outside this cash flow (RERA 70% / 30% and others)',sT(tr),r=>r.sec==='Internal transfer')+
  line('<b>Net increase / (decrease) in cash</b>',net,()=>true,'tot big');
 // direct method: each section, receipts and payments by head
 const rows=[];
 for(const s of['Operating','Investing','Financing','Internal transfer','Not mapped']){
  const acc={};
  const add=(h,a,b)=>{const x=(acc[h]=acc[h]||[0,0]);x[0]+=a;x[1]+=b};
  // receipts: operating heads by indirect line for customers (AV / GST / SDR), others by head
  for(const[key,v]of Object.entries(D.secIn))if(key.startsWith(s+'|'))add(key.slice(s.length+1),sumM(v),0);
  for(const[key,v]of Object.entries(D.secOut))if(key.startsWith(s+'|'))add(key.slice(s.length+1),0,sumM(v));
  if(s==='Operating'){for(const[l,o]of Object.entries(D.lineBy)){const v=sumM(o);if(l==='Not mapped')continue;if(v>0)add(l,v,0);else add(l,0,-v)}}
  const list=Object.entries(acc).filter(([,x])=>x[0]||x[1]).sort((a,b)=>(b[1][0]+b[1][1])-(a[1][0]+a[1][1]));
  if(!list.length)continue;
  const ti=list.reduce((t,[,x])=>t+x[0],0),to=list.reduce((t,[,x])=>t+x[1],0);
  rows.push(`<tr class="hd"><td>${esc(s)}</td><td class="num">${rs(ti)}</td><td class="num">${rs(to)}</td><td class="num">${rs(ti-to)}</td></tr>`);
  for(const[h,x]of list){const f=s==='Operating'?(r=>r.sec==='Operating'&&r.k===h):(r=>r.sec===s&&r.cfh===h);rows.push(`<tr ${DR.reg(h+' · '+perLabel(),X=>({sections:[{h:'Money in',cols:'R',rows:byT(X.R.filter(r=>inPer(r.ym)&&f(r)))},{h:'Money out',cols:'P',rows:byT(X.P.filter(p=>inPer(p.ym)&&f(p))),sign:-1}]}))}><td class="ind">${esc(h)}</td><td class="num">${rs(x[0])}</td><td class="num">${rs(x[1])}</td><td class="num">${rs(x[0]-x[1])}</td></tr>`)}
 }
 $('#tDir').innerHTML='<tr><th>Section / head</th><th class="num">Money in</th><th class="num">Money out</th><th class="num">Net</th></tr>'+rows.join('');
}

// ---------- compliance ----------
function renderComp(){
 const DR=Drill, C=D.cc, by=s=>C.filter(c=>c.state===s);
 const CL=(t,rows)=>DR.reg(t,()=>({sections:[{cols:CCC,rows}]}),false);
 const od=by('Overdue'),d30=by('Due in 30 days'),done=by('Complied');
 if(!D.tabs.cc){$('#cComp').innerHTML=card('need','Compliance calendar','Needs input','Add items in Accounts → Compliance Calendar');$('#tComp').innerHTML='';$('#compMore').hidden=true;return}
 $('#cComp').innerHTML=[
  card(od.length?'out tint':'in','Overdue',nf(od.length),'Due date passed, not marked Complied',CL('Overdue compliances',od)),
  card('nv tint','Due in the next 30 days',nf(d30.length),'',CL('Due in the next 30 days',d30)),
  card('in','Complied',nf(done.length),nf(done.filter(c=>c.late>0).length)+' filed late',CL('Complied',done)),
  card('','Upcoming',nf(by('Upcoming').length),'Later this year',CL('Upcoming compliances',by('Upcoming'))),
  card('','All items',nf(C.length),'In the Compliance Calendar',CL('All compliance items',C)),
 ].join('');
 const list=[...od,...d30,...by('Upcoming')];const rows=compAll?list:list.slice(0,25);
 $('#tComp').innerHTML='<tr><th>Due date</th><th>Compliance</th><th>Law</th><th>Period</th><th>Status</th><th class="num">Days late</th><th>Remark</th></tr>'+
  rows.map(c=>`<tr class="${c.state==='Overdue'?'od':''}"><td>${esc(c.d)}</td><td>${esc(c.c)}</td><td>${esc(c.law)}</td><td>${esc(c.per)}</td><td>${esc(c.state)}</td><td class="num">${c.late||''}</td><td class="desc">${esc(c.rm)}</td></tr>`).join('');
 $('#compMore').hidden=list.length<=25||compAll;$('#compMore').textContent='Show all '+list.length+' open items';
 $('#compMore').onclick=()=>{compAll=true;renderComp()};
}

// period and RERA date pickers
function pickers(){
 const cur=D.fys[D.fys.length-1]||'td';
 $('#per').innerHTML=D.fys.slice().reverse().map(f=>`<option value="${f}">${f}</option>`).join('')+'<option value="td">Till date</option>';
 if(!PER)PER=cur;$('#per').value=PER;
 const qs=[];const now=new Date();let y=now.getFullYear(),m=now.getMonth();
 // quarter ends (Mar, Jun, Sep, Dec) back to the first booking
 const first=Math.min(...D.units.filter(u=>u.bt).map(u=>u.bt));
 let q=new Date(y,m-(m%3),0);while(q.getTime()>=first&&qs.length<12){qs.push(q.getTime()+864e5-1);q=new Date(q.getFullYear(),q.getMonth()-2,0)}
 $('#asOf').innerHTML='<option value="0">Today</option>'+qs.map(t=>`<option value="${t}">${new Date(t).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} (quarter end)</option>`).join('');
 $('#asOf').value=String(ASOF);
}
$('#per').onchange=e=>{PER=e.target.value;compAll=false;render()};
$('#asOf').onchange=e=>{ASOF=+e.target.value;reraShown=50;renderRera()};
$('#reraAll').onclick=()=>{const t=Drill.reg('RERA report: all booked units',()=>({sections:[{cols:CU,rows:RERA.slice().sort((a,b)=>a.u.localeCompare(b.u)),sumCol:'Total received'}]}),false);const el=document.createElement('span');el.innerHTML=`<i ${t}></i>`;const i=el.firstChild;document.body.appendChild(i);i.click();i.remove()};

// nav highlight
const links=[...document.querySelectorAll('nav.tabs a')];
addEventListener('scroll',()=>{let on=links[0];for(const a of links){const s=$(a.getAttribute('href'));if(s&&s.getBoundingClientRect().top<140)on=a}links.forEach(a=>a.classList.toggle('on',a===on))},{passive:true});

// numbers come from /api/ca, worked out from the ERP's accounts (CA access only)
const setLive=(t,warn)=>{const el=$('#live');el.textContent=t;el.style.color=warn?'var(--out)':'var(--in)'};
let busy=false;
Drill.src='/api/ca?detail=1';
Drill.mount();
async function loadLive(force){
  if(busy)return;busy=true;if(force)Drill.dropDetail();setLive('Working out the figures…');
  try{
    const r=await fetch('/api/ca'+(force?'?refresh=1':''),{cache:'no-store',credentials:'same-origin'});
    if(r.status===401){location.href='/';return}
    const j=await r.json().catch(()=>({}));
    if(r.status===403)throw new Error('your login does not include the CA page');
    if(!r.ok)throw new Error(j.error||('the server answered '+r.status));
    D=j;if(j.user)$('#user').textContent=j.user.name;pickers();render();
    setLive('From the ERP, worked out at '+new Date(j.readAt||Date.now()).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
  }catch(e){setLive('Could not load the figures: '+(e.message||e),true);console.error(e)}
  finally{$('#reload').hidden=false;busy=false}
}
$('#reload').onclick=()=>loadLive(true);
loadLive();
})();
