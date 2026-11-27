// The approval journey of a new project, step by step (Rafi Sir, 28 Nov 2026, for Dream Legacy Goregaon): the 11 steps
// of an open-plot development in Mumbai, from land and title to OC. Each step holds
//  - its approvals (project_approvals, lib/approvals.js: status, dates, reference, the letter),
//  - its document checklist (project_checklist): who gives each paper (us, the architect, the advocate, a consultant,
//    MCGM), where it stands (needed → ready → sent to the architect → accepted), its file from Project documents,
//  - an owner and a due date for the step (project_steps), and for every document, so "waiting on" can be shown and the
//    Monday email can list what is pending with each person. Owners are ERP logins: a new employee who takes over the
//    process is given a login with the Approvals role and picked from the list; "hand over" moves all open items.
//  - money (project_step_money): the fees and premiums expected at the step and what has been paid (Management only).
// A project uses this layout when projects.approval_flow is set ('open' for an open plot, 'sra' for a future SRA
// scheme). Dream Signature keeps its plain list (approved and nearly done, 28 Nov 2026).
const db = require('./db');

const fail = (status, message) => Object.assign(new Error(message), { status });
const WHO = { us: 'Us (owner)', architect: 'Architect', advocate: 'Advocate', consultant: 'Consultant', mcgm: 'MCGM / authority' };
const STATUS = { needed: 'Needed', ready: 'Ready with us', sent: 'Sent to architect', accepted: 'Accepted', not_needed: 'Not needed' };

// [key, title, what it is for, approval keys (catalog keys, or titles of approvals added by hand), checklist [title, who, note?]]
const FLOWS = {
  open: [
    ['land', 'Land & title', 'Make the land ours on paper: conveyance registered, PR card in our name, clean title.',
      ['title', 'na', "Architect's area certificate (for conveyance)"],
      [['Conveyance deed registered', 'us'], ['Stamp duty and registration paid', 'us'], ['PR card mutated in Dream India Builders\' name', 'us'],
        ['Title certificate from an advocate with 10 years\' experience', 'advocate', 'Also needed for the MCGM concessions'], ['30-year search report', 'advocate'],
        ["Architect's area certificate", 'architect', 'Also needed for the MCGM concessions'], ['Collector NA order (copy)', 'us', 'Order SR-8052 dated 24.02.2006'],
        ['Owner\'s identity (applicant and company)', 'us', 'Also needed for the MCGM concessions']]],
    ['know', 'Know the land', 'What the land allows: DP remarks, survey, road lines, services and trees, so the architect can work out the plot area and FSI.',
      ['zone', 'DP 2034 remarks (MCGM)'],
      [['Latest DP 2034 remarks', 'us', 'Needed again for file generation'], ['Latest CTS plan', 'us'], ['Latest PR card', 'us'], ['Total station / site survey plan', 'architect'],
        ['A.E. Survey remark (road lines on site)', 'architect'], ['Road status', 'us'], ['Storm water, sewerage and water remarks', 'architect'], ['Tree survey', 'architect'],
        ['Neighbourhood plan', 'architect']]],
    ['reserve', 'Reservation & roads', 'Settle the DP roads and the RSA 2.1 reservation: what is handed over to MCGM, what FSI or TDR we get, and the real buildable area.',
      ['Reservation RSA2.1: development under Reg. 17 (to confirm)'],
      [['DP road area statement (9.15 m roads)', 'architect'], ['Reg. 17 proposal for RSA 2.1: amenity to build and hand over', 'architect'],
        ['FSI and buildable area confirmed (net plot, road and reservation credits)', 'architect'], ['Scheme decided (open plot or 33(11))', 'us']]],
    ['team', 'Team & MCGM portal', 'Appoint the licensed team and register the owner on MCGM\'s online building approval system.',
      ['MCGM owner portal registration'],
      [['Architect appointment letter', 'us'], ['Structural engineer appointment and acceptance, with valid licence', 'us'], ['Plumber appointment and acceptance, with valid licence', 'us'],
        ['Site supervisor appointment', 'us'], ['Aadhaar card of the applicant', 'us'], ['PAN card of the applicant and the company', 'us'], ['Passport photo of the applicant', 'us'],
        ['Signature specimen (box sign)', 'us'], ['Email ID of the applicant', 'us'], ['Company / firm certificate', 'us']]],
    ['file', 'File & concessions', 'The architect generates the proposal file online and applies for concessions; premiums are paid here (the biggest cash outflow before construction).',
      ['MCGM file generation (proposal)', 'MCGM concessions'],
      [['Owner\'s affidavit', 'us'], ['Conveyance deed / ownership document', 'us'], ['DA / POA', 'us'], ['Parking remark from consultants', 'consultant'],
        ['CFO (fire) NOC plans and report', 'architect'], ['44/69 application (digital sign)', 'architect'], ['337 (digital sign)', 'architect'],
        ['Existing approved layout / building plan', 'us', 'Mark Not needed if there is none'], ['Old assessment bill', 'us'], ['Society registration certificate', 'us', 'Mark Not needed for an open plot']]],
    ['noc', 'NOCs', 'The NOCs applied for alongside the file: fire, civil aviation height, trees, water and sewerage, environment (over about 20,000 sq m).',
      ['fire', 'height', 'tree', 'water', 'ec'], []],
    ['iod', 'IOD (plan approval)', 'MCGM approves the plans and lists the conditions to meet before CC.', ['iod'], [['IOD conditions list, with who meets each', 'architect']]],
    ['cc', 'CC up to plinth', 'Meet the pre-CC conditions; MCGM issues CC up to plinth and construction starts.', ['cc_plinth'],
      [['Premiums and fees paid', 'us'], ['Debris deposit', 'us'], ['Insurance', 'us'], ['Undertakings and indemnities (registered)', 'us'], ['Site board', 'us']]],
    ['rera', 'RERA', 'Register on MahaRERA after the plinth CC, before any advertising, booking or sale.', ['rera'],
      [['Separate RERA bank account (70% of buyer money)', 'us'], ['Architect, engineer and CA certificates (Forms 1, 2, 3)', 'consultant'], ['Promoter documents', 'us']]],
    ['fullcc', 'Further CC', 'Plinth built and certified, MCGM checks it, and grants CC for the floors above (sometimes in stages).', ['cc_full'],
      [['Plinth completion certificate', 'architect'], ['MCGM plinth inspection', 'mcgm']]],
    ['done', 'Completion', 'Hand over the roads and the amenity, completion NOCs, then OC and BCC; water connection, tax assessment and the society\'s conveyance.', ['oc', 'bcc'],
      [['DP road land handed over to MCGM', 'us'], ['RSA 2.1 amenity built and handed over', 'us'], ['Fire completion NOC', 'architect'], ['Storm water completion certificate', 'architect'],
        ['Lift licence', 'consultant'], ['Tree plantation compliance', 'architect'], ['Water connection and property tax assessment', 'us'], ['Society formed and conveyance', 'us']]],
  ],
  sra: [
    ['society', 'Slum & society', 'Slum declaration, the slum dwellers\' society and the developer\'s appointment.', ['slum_decl', 'society', 'dev_appoint'],
      [['Slum declaration notification', 'us'], ['Society registration certificate', 'us'], ['General body resolution appointing the developer', 'us'], ['Development agreement', 'us']]],
    ['annex', 'Annexure II', 'The certified list of eligible slum dwellers, with every tenement\'s papers (the slum register).', ['annex2'],
      [['Survey of every tenement', 'consultant'], ['Eligibility papers of each tenement', 'us'], ['Consents (51% and the commercial tenements)', 'us']]],
    ['loi', 'LOI', 'SRA\'s Letter of Intent: the scheme parameters and FSI.', ['loi', 'loi_rev'], [['LOI proposal', 'architect']]],
    ['ioa', 'IOA (plan approval)', 'Plans of the rehab and sale buildings approved.', ['ioa_rehab', 'ioa_sale'], [['IOA conditions list', 'architect']]],
    ['noc', 'NOCs', 'Fire, height, trees, water and drainage, environment.', ['fire', 'height', 'tree', 'water', 'ec'], []],
    ['cc', 'CC up to plinth', 'CC for the rehab and sale buildings up to plinth.', ['cc_rehab_plinth', 'cc_sale_plinth'], [['Pre-CC undertakings and deposits', 'us']]],
    ['rera', 'RERA', 'Register the sale building on MahaRERA.', ['rera'], [['Separate RERA bank account', 'us']]],
    ['fullcc', 'Further CC', 'CC for the floors above plinth.', ['cc_rehab_full', 'cc_sale_full'], [['Plinth completion certificate', 'architect']]],
    ['done', 'Rehab handover & OC', 'Rehab building handed over to the slum dwellers, then OC for the rehab and sale buildings.', ['oc_rehab', 'oc_sale'],
      [['Rehab allotment (lottery)', 'us'], ['Rehab building handed over', 'us']]],
  ],
};
const steps = (flow) => (FLOWS[flow] || []).map(([key, title, what, approvals, list], i) => ({ n: i + 1, key, title, what, approvals, list }));
const d10 = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const ints = (v) => (Array.isArray(v) ? v.map(Number) : String(v || '').replace(/[{}]/g, '').split(',').filter(Boolean).map(Number));

// Puts a project on the step layout: its checklist from the template, once (items already there are kept)
async function start(t, p, flow, userId) {
  if (!FLOWS[flow]) throw fail(400, 'Unknown approval journey.');
  await t.q('update projects set approval_flow = $2 where id = $1', [p.id, flow]);
  const have = new Set((await t.q('select step_key, lower(title) as t from project_checklist where project_id = $1', [p.id])).map((r) => r.step_key + '|' + r.t));
  let seq = 0, added = 0;
  for (const s of steps(flow)) for (const [title, who, note] of s.list) {
    seq++;
    if (have.has(s.key + '|' + title.toLowerCase())) continue;
    await t.q('insert into project_checklist (project_id, step_key, title, who, note, seq, created_by) values ($1, $2, $3, $4, $5, $6, $7)', [p.id, s.key, title, who, note || null, seq * 10, userId]);
    added++;
  }
  return added;
}

// The journey: steps with their approvals, checklist, owner, due date and money, the step the project is on, and who it waits on
async function view(p, approvals, { money = false } = {}) {
  const flow = p.approval_flow; if (!FLOWS[flow]) return null;
  const S = steps(flow);
  const [items, own, cash, users] = await Promise.all([
    db.q('select * from project_checklist where project_id = $1 order by step_key, seq, id', [p.id]),
    db.q('select * from project_steps where project_id = $1', [p.id]),
    money ? db.q('select * from project_step_money where project_id = $1 order by id', [p.id]) : [],
    db.q("select id, name from users where not coalesce(disabled, false) order by name"),
  ]);
  const U = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const ids = [...new Set(items.flatMap((x) => ints(x.doc_ids)))];
  const docs = ids.length ? await db.q("select id, file_name, size from customer_docs where id = any($1::int[]) and project_id = $2 and status = 'ready'", [ids, p.id]) : [];
  const D = Object.fromEntries(docs.map((x) => [x.id, { id: x.id, name: x.file_name, size: +x.size || 0 }]));
  const t = today();
  const placed = new Set();
  const out = S.map((s) => {
    const ap = approvals.filter((a) => s.approvals.includes(a.key) || s.approvals.includes(a.title) || (a.step_key && a.step_key === s.key));
    ap.forEach((a) => placed.add(a.key));
    const list = items.filter((x) => x.step_key === s.key).map((x) => ({
      id: x.id, title: x.title, who: x.who, status: x.status, note: x.note || '', owner_id: x.owner_id, owner: U[x.owner_id] || '', due_on: d10(x.due_on), sent_on: d10(x.sent_on),
      docs: ints(x.doc_ids).map((i) => D[i]).filter(Boolean), overdue: !!(x.due_on && d10(x.due_on) < t && !['accepted', 'not_needed'].includes(x.status)),
    }));
    const o = own.find((r) => r.step_key === s.key) || {};
    const needA = ap.filter((a) => a.status !== 'not_needed'), needL = list.filter((x) => x.status !== 'not_needed');
    const doneA = needA.filter((a) => a.status === 'received').length, doneL = needL.filter((x) => x.status === 'accepted').length;
    const total = needA.length + needL.length, done = doneA + doneL;
    const m = cash.filter((c) => c.step_key === s.key).map((c) => ({ id: c.id, item: c.item, expected: Number(c.expected) || 0, paid: Number(c.paid) || 0, paid_on: d10(c.paid_on), ref: c.ref || '' }));
    return { ...s, list, approvals: ap, owner_id: o.owner_id || null, owner: U[o.owner_id] || '', due_on: d10(o.due_on), note: o.note || '',
      total, done, complete: total > 0 && done === total, started: done > 0 || list.some((x) => ['ready', 'sent'].includes(x.status)) || ap.some((a) => ['applied', 'query'].includes(a.status)),
      overdue: !!(o.due_on && d10(o.due_on) < t && !(total > 0 && done === total)), money: money ? m : undefined };
  });
  // approvals no step claims (added by hand without a step) go in the step they were added to, else the last open one
  const loose = approvals.filter((a) => !placed.has(a.key));
  const cur = out.find((s) => !s.complete) || out[out.length - 1];
  for (const a of loose) { cur.approvals.push(a); }
  const at = out.find((s) => !s.complete) || null;
  // what is waiting, and on whom
  const open = out.flatMap((s) => s.list.filter((x) => !['accepted', 'not_needed'].includes(x.status)).map((x) => ({ ...x, step: s.key, stepTitle: s.title, n: s.n })));
  const waiting = Object.fromEntries(Object.keys(WHO).map((w) => [w, open.filter((x) => (x.status === 'sent' ? 'architect' : x.who) === w).length]));
  return { flow, steps: out, at: at ? { n: at.n, key: at.key, title: at.title, done: at.done, total: at.total } : null, waiting, who: WHO, labels: STATUS,
    people: users.map((u) => ({ id: u.id, name: u.name })), overdue: open.filter((x) => x.overdue).length };
}

const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
function date(v, label) {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw fail(400, `${label}: give the date as day, month and year.`);
  return s;
}
async function person(t, id) {
  if (id == null || id === '') return null;
  const u = await t.one('select id from users where id = $1 and not coalesce(disabled, false)', [+id || 0]);
  if (!u) throw fail(400, 'Choose the owner from the list of ERP logins.');
  return u.id;
}
const stepOf = (p, key) => { const s = steps(p.approval_flow).find((x) => x.key === key); if (!s) throw fail(400, 'That step is not in this project\'s journey.'); return s; };

// one checklist item: new ({ step, title, who }) or changed ({ id, ... })
async function saveItem(t, u, p, x) {
  const old = x.id ? await t.one('select * from project_checklist where id = $1 and project_id = $2', [+x.id || 0, p.id]) : null;
  if (x.id && !old) throw fail(404, 'That document is not on this project\'s checklist.');
  const step = old ? old.step_key : stepOf(p, x.step).key;
  const title = x.title !== undefined ? str(x.title, 200) : old.title; if (!title) throw fail(400, 'Name the document.');
  const who = x.who !== undefined ? str(x.who, 20) : old ? old.who : 'us'; if (!WHO[who]) throw fail(400, 'Choose who gives the document.');
  const status = x.status !== undefined ? str(x.status, 20) : old ? old.status : 'needed'; if (!STATUS[status]) throw fail(400, 'Choose where the document stands.');
  const owner = x.owner_id !== undefined ? await person(t, x.owner_id) : old ? old.owner_id : null;
  const due = x.due_on !== undefined ? date(x.due_on, 'Due date') : old ? d10(old.due_on) : null;
  let sent = x.sent_on !== undefined ? date(x.sent_on, 'Sent on') : old ? d10(old.sent_on) : null;
  if (status === 'sent' && !sent) sent = today();
  const note = x.note !== undefined ? str(x.note, 500) || null : old ? old.note : null;
  let docs = old ? ints(old.doc_ids) : [];
  if (x.docIds !== undefined) {
    docs = [...new Set((Array.isArray(x.docIds) ? x.docIds : []).map(Number).filter((n) => n > 0))].slice(0, 20);
    if (docs.length) { const ok = await t.q("select id from customer_docs where id = any($1::int[]) and owner_kind = 'project' and project_id = $2", [docs, p.id]); if (ok.length !== docs.length) throw fail(400, 'Some of those files are not in this project\'s documents.'); }
  }
  const after = old
    ? await t.one(`update project_checklist set title = $2, who = $3, status = $4, owner_id = $5, due_on = $6, sent_on = $7, note = $8, doc_ids = $9::int[], updated_by = $10, updated_at = now() where id = $1 returning *`,
      [old.id, title, who, status, owner, due, sent, note, docs, u.id])
    : await t.one(`insert into project_checklist (project_id, step_key, title, who, status, owner_id, due_on, sent_on, note, doc_ids, seq, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::int[], (select coalesce(max(seq), 0) + 10 from project_checklist where project_id = $1 and step_key = $2), $11) returning *`,
      [p.id, step, title, who, status, owner, due, sent, note, docs, u.id]);
  return { before: old, after };
}
async function removeItem(t, p, id) {
  const r = await t.one('delete from project_checklist where id = $1 and project_id = $2 returning *', [+id || 0, p.id]);
  if (!r) throw fail(404, 'That document is not on this project\'s checklist.');
  return r;
}
// a step's owner, due date and note
async function saveStep(t, p, x) {
  const s = stepOf(p, x.step);
  const owner = await person(t, x.owner_id), due = date(x.due_on, 'Due date'), note = str(x.note, 500) || null;
  return t.one(`insert into project_steps (project_id, step_key, owner_id, due_on, note) values ($1, $2, $3, $4, $5)
    on conflict (project_id, step_key) do update set owner_id = excluded.owner_id, due_on = excluded.due_on, note = excluded.note, updated_at = now() returning *`, [p.id, s.key, owner, due, note]);
}
// a fee or premium of a step (Management)
async function saveMoney(t, u, p, x) {
  const s = x.id ? null : stepOf(p, x.step);
  const item = str(x.item, 120); if (!item) throw fail(400, 'Name the fee or premium.');
  const n = (v, l) => { if (v == null || v === '') return 0; const k = Number(String(v).replace(/[₹,\s]/g, '')); if (!Number.isFinite(k) || k < 0) throw fail(400, `${l}: enter an amount.`); return Math.round(k * 100) / 100; };
  const v = [item, n(x.expected, 'Expected'), n(x.paid, 'Paid'), date(x.paid_on, 'Paid on'), str(x.ref, 80) || null];
  if (x.id) { const r = await t.one('update project_step_money set item = $3, expected = $4, paid = $5, paid_on = $6, ref = $7, updated_at = now() where id = $1 and project_id = $2 returning *', [+x.id, p.id, ...v]); if (!r) throw fail(404, 'That fee is not on this project.'); return r; }
  return t.one('insert into project_step_money (project_id, step_key, item, expected, paid, paid_on, ref, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *', [p.id, s.key, ...v, u.id]);
}
async function removeMoney(t, p, id) { const r = await t.one('delete from project_step_money where id = $1 and project_id = $2 returning *', [+id || 0, p.id]); if (!r) throw fail(404, 'That fee is not on this project.'); return r; }
// someone hands over: every open step and document of theirs goes to another login (on every project, or one)
async function handOver(t, fromId, toId, projectId = null) {
  const to = await person(t, toId); if (!to) throw fail(400, 'Choose who takes over.');
  const a = await t.q(`update project_checklist set owner_id = $2, updated_at = now() where owner_id = $1 and status not in ('accepted', 'not_needed') ${projectId ? 'and project_id = $3' : ''} returning id`, projectId ? [+fromId, to, projectId] : [+fromId, to]);
  const b = await t.q(`update project_steps set owner_id = $2, updated_at = now() where owner_id = $1 ${projectId ? 'and project_id = $3' : ''} returning step_key`, projectId ? [+fromId, to, projectId] : [+fromId, to]);
  return { documents: a.length, steps: b.length };
}

// The Monday email: for each owner, what is open with them (overdue first), on every project
async function pending() {
  const rows = await db.q(`select c.*, p.name as project, p.approval_flow, u.name as owner, u.email from project_checklist c join projects p on p.id = c.project_id join users u on u.id = c.owner_id
    where p.active and p.approval_flow is not null and c.status not in ('accepted', 'not_needed') and not coalesce(u.disabled, false) order by u.id, c.due_on nulls last, c.project_id, c.seq`);
  const steps_ = await db.q(`select s.*, p.name as project, p.approval_flow, u.name as owner, u.email from project_steps s join projects p on p.id = s.project_id join users u on u.id = s.owner_id where p.active and p.approval_flow is not null and not coalesce(u.disabled, false)`);
  const t = today(), by = new Map();
  const get = (r) => { if (!by.has(r.owner_id)) by.set(r.owner_id, { id: r.owner_id, name: r.owner, email: r.email, items: [], steps: [] }); return by.get(r.owner_id); };
  for (const r of rows) { const s = steps(r.approval_flow).find((x) => x.key === r.step_key); get(r).items.push({ project: r.project, step: s ? `Step ${s.n}: ${s.title}` : r.step_key, title: r.title, status: STATUS[r.status], who: WHO[r.who], due: d10(r.due_on), overdue: !!(r.due_on && d10(r.due_on) < t) }); }
  for (const r of steps_) { const s = steps(r.approval_flow).find((x) => x.key === r.step_key); get(r).steps.push({ project: r.project, step: s ? `Step ${s.n}: ${s.title}` : r.step_key, due: d10(r.due_on) }); }
  return [...by.values()];
}

// Monday morning (IST): each owner gets what is pending with them; Management gets the summary of every project
async function monday({ force = false } = {}) {
  const t = new Date(Date.now() + 5.5 * 3600e3);
  if (!force && t.getUTCDay() !== 1) return { skipped: 'not Monday' };
  if (!force && !(await db.one("insert into job_marks (key) values ($1) on conflict (key) do nothing returning key", ['approvals-monday:' + today()]))) return { skipped: 'already sent' };
  const flow = require('./mkt-flow'), e = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const people = await pending(), sent = [];
  for (const p of people) {
    if (!p.email || (!p.items.length && !p.steps.length)) continue;
    const od = p.items.filter((x) => x.overdue).length;
    const html = `<p>${e(p.name)}, the approval work pending with you this week:</p>${p.steps.length ? `<p><b>Steps you own:</b> ${p.steps.map((s) => `${e(s.project)}, ${e(s.step)}${s.due ? ' (due ' + fmt(s.due) + ')' : ''}`).join('; ')}</p>` : ''}
      <table style="border-collapse:collapse;font-size:14px">${p.items.map((x) => `<tr><td style="padding:5px 10px 5px 0;${x.overdue ? 'color:#B42318;font-weight:600' : ''}">${x.overdue ? 'Overdue' : x.due ? fmt(x.due) : ''}</td><td style="padding:5px 10px 5px 0">${e(x.project)} · ${e(x.step)}</td><td style="padding:5px 10px 5px 0"><b>${e(x.title)}</b></td><td style="padding:5px 0;color:#667085">${e(x.status)} · ${e(x.who)}</td></tr>`).join('')}</table>
      <p><a href="${flow.host()}/">Open the ERP</a> → the project → Approvals.</p>`;
    sent.push({ to: p.name, r: await flow.send([p.email], `Approvals this week: ${p.items.length} document${p.items.length === 1 ? '' : 's'} pending${od ? `, ${od} overdue` : ''}`, html).catch((x) => ({ error: x.message })) });
  }
  // the summary: every project on the step layout, the step it is on and who it waits on
  const ps = await db.q("select id, code, name, kind, state, scheme, rera_no, active, approval_flow from projects where active and approval_flow is not null order by id");
  const A = require('./approvals'), rows = [];
  for (const p of ps) {
    const v = await view(p, (await A.view(p)).list);
    const w = Object.entries(v.waiting).filter(([, n]) => n).map(([k, n]) => `${WHO[k].replace(' (owner)', '')} ${n}`).join(', ');
    rows.push(`<tr><td style="padding:6px 12px 6px 0"><b>${e(p.name)}</b></td><td style="padding:6px 12px 6px 0">${v.at ? `Step ${v.at.n} of ${v.steps.length}: ${e(v.at.title)} (${v.at.done} of ${v.at.total})` : 'All steps done'}</td><td style="padding:6px 12px 6px 0">Waiting on: ${e(w || 'nobody')}</td><td style="padding:6px 0;${v.overdue ? 'color:#B42318;font-weight:600' : ''}">${v.overdue ? v.overdue + ' overdue' : ''}</td></tr>`);
  }
  let summary = null;
  if (rows.length) {
    const mg = await db.q("select email from users where not coalesce(disabled, false) and role in ('admin', 'management') and coalesce(email, '') <> ''");
    summary = await flow.send(mg.map((x) => x.email), 'Approvals this week', `<p>Where each project's approvals stand:</p><table style="border-collapse:collapse;font-size:14px">${rows.join('')}</table><p><a href="${flow.host()}/">Open the ERP</a></p>`).catch((x) => ({ error: x.message }));
  }
  return { owners: sent, summary };
}

module.exports = { monday, FLOWS, WHO, STATUS, steps, start, view, saveItem, removeItem, saveStep, saveMoney, removeMoney, handOver, pending };
