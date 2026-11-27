// Campaign approvals and automatic posting for Marketing & social media.
//   1. The marketing team plans a campaign: brief, channels, dates, daily / monthly budget, and its designs (posts of the
//      campaign, each with its Canva export, caption, channels and date). "Send for approval" emails Management.
//   2. Management approves the designs and the budget, separately, in the ERP or with the buttons in the email (a signed
//      link that opens a confirm page; nothing happens on just opening it). Or sends it back with a comment.
//   3. When both are approved, the designs go to the calendar as Scheduled, and the marketing team is told.
//   4. Every 5 minutes (cron job=mail) scheduled posts that are due are posted to Instagram and Facebook; other channels
//      (YouTube, LinkedIn, WhatsApp…) are flagged "post by hand" with the design ready.
const crypto = require('crypto');
const db = require('./db');

const e = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = () => (process.env.ERP_URL || 'https://erp.dreamindiarealty.com').replace(/\/+$/, '');
const live = () => process.env.ERP_LIVE === '1';
const okMail = (x) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(x);
const inr = (n) => (n == null || n === '' ? '–' : '₹' + Math.round(+n).toLocaleString('en-IN'));

// ---------- signed links (approval emails, public design files for Instagram / Facebook) ----------
let secretCache = null, secretAt = 0;
async function secret() {
  if (secretCache && Date.now() - secretAt < 60000) return secretCache;
  secretAt = Date.now();
  const r = await db.one("select value from settings where key = 'session_secret'");
  secretCache = crypto.createHash('sha256').update('mkt-links:' + String(r ? r.value : '')).digest();
  return secretCache;
}
async function sign(obj) { const b = Buffer.from(JSON.stringify(obj)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', await secret()).update(b).digest('base64url'); }
async function verify(tok) {
  const [b, sig] = String(tok || '').split('.'); if (!b || !sig) return null;
  const want = crypto.createHmac('sha256', await secret()).update(b).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o.e && Date.now() > o.e ? null : o; } catch { return null; }
}
// For Instagram / Facebook to fetch when posting: served only while the post is approved, scheduled or published.
// preview: for the approval email (the post is still in review), and only for 14 days.
async function fileUrl(fileId, { preview = false } = {}) { return `${host()}/api/marketing?pub=${encodeURIComponent(await sign(preview ? { f: fileId, v: 1, e: Date.now() + 14 * 864e5 } : { f: fileId }))}`; }

// ---------- people ----------
async function approvers({ withPhone = false } = {}) {
  const { ROLES } = require('./roles');
  const roles = Object.entries(ROLES).filter(([, r]) => (r.perms || []).includes('marketing.approve')).map(([k]) => k);
  return db.q(`select id, name, email, phone from users where not disabled and role = any($1) and ${withPhone ? "(coalesce(email, '') <> '' or coalesce(phone, '') <> '')" : "coalesce(email, '') <> ''"}`, [roles]);
}
// The one rule for every marketing email: to the real people once the ERP is live (ERP_LIVE=1), until then only to the
// test address in Letter settings, marked [TEST].
async function testTo() { const l = (await db.one("select value from settings where key = 'letters'"))?.value || {}; return String(l.testEmail || '').split(/[\/,;\s]+/).filter(okMail).slice(0, 1); }
async function recipients(to) { return live() ? [...new Set((to || []).filter((x) => okMail(String(x || ''))))] : testTo(); }
async function send(to, subject, html, { text, skipped } = {}) {
  const mailer = require('./mailer');
  if (!mailer.configured()) return { skipped: 'The sending email account is not connected.' };
  to = (to || []).filter(Boolean);
  const list = await recipients(to);
  if (!list.length) return { skipped: live() ? skipped || 'No email address.' : 'No test email address in Letter settings.' };
  const note = live() ? '' : `<p style="font-size:12px;color:#B54708">Test version: once the ERP is live this goes to ${e(to.join(', ') || 'Management')}.</p>`;
  const conn = await mailer.connect();
  try { await conn.send({ to: list, subject: (live() ? '' : '[TEST] ') + subject, html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#10114e;max-width:640px">${note}${html}</div>`, text: text || subject + ' — open ' + host() + '/#/marketing', fromName: 'Dream India ERP' }); }
  finally { await conn.close().catch(() => {}); }
  return { to: list, test: !live() };
}

// ---------- the campaign and its designs ----------
async function campaign(id) {
  const c = await db.one(`select c.*, array_to_json(c.channels) as channels, p.name as project, s.name as submitted_name, s.email as submitted_email,
       dz.name as designs_ok_name, bz.name as budget_ok_name from mkt_campaigns c left join projects p on p.id = c.project_id left join users s on s.id = c.submitted_by
       left join users dz on dz.id = c.designs_ok_by left join users bz on bz.id = c.budget_ok_by where c.id = $1`, [id]);
  if (!c) return null;
  c.designs = await db.q(`select p.id, p.title, p.kind, array_to_json(p.channels) as channels, p.publish_at, p.status, p.caption,
      (select coalesce(json_agg(json_build_object('id', f.id, 'mime', f.mime, 'name', f.name) order by f.id), '[]') from mkt_post_files f where f.post_id = p.id) as files
     from mkt_posts p where p.campaign_id = $1 order by p.publish_at nulls last, p.id`, [id]);
  return c;
}
const btn = (href, label, bg) => `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">${label}</a>`;
async function approvalMail(c, by) {
  const ppl = await approvers(), out = {};
  const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'no date yet');
  const designs = await Promise.all(c.designs.map(async (d) => { const img = d.files.find((f) => /^image\//.test(f.mime)); return `<tr><td style="padding:6px;vertical-align:top;width:130px">${img ? `<img src="${await fileUrl(img.id, { preview: true })}" width="120" style="border-radius:8px;display:block">` : `<div style="width:120px;height:120px;background:#F7F7FB;border-radius:8px;text-align:center;line-height:120px;color:#667085;font-size:12px">${d.files.length ? 'Video / PDF' : 'No file'}</div>`}</td><td style="padding:6px;vertical-align:top"><b>${e(d.title)}</b><br><span style="color:#667085">${e((d.channels || []).join(', '))} · ${e(when(d.publish_at))}</span>${d.caption ? `<br><span style="font-size:13px">${e(String(d.caption).slice(0, 220))}</span>` : ''}</td></tr>`; }));
  for (const p of ppl.length ? ppl : [{ id: null, name: 'Management', email: '' }]) {
    const t = async (k) => `${host()}/api/marketing?approve=${encodeURIComponent(await sign({ c: c.id, k, u: p.id, e: Date.now() + 14 * 864e5 }))}`;
    const html = `<p>${e(by.name)} has sent a campaign for your approval.</p>
      <h2 style="margin:6px 0">${e(c.name)}</h2><p style="color:#667085;margin:0 0 10px">${e(c.project || 'Company')} · ${e((c.channels || []).join(', ') || 'channels not set')} · ${c.start_on ? e(String(c.start_on).slice(0, 10)) : ''}${c.end_on ? ' to ' + e(String(c.end_on).slice(0, 10)) : ''}</p>
      ${c.brief ? `<p style="white-space:pre-wrap;background:#F7F7FB;padding:10px;border-radius:8px">${e(c.brief)}</p>` : ''}
      <h3 style="margin:14px 0 4px">Designs (${c.designs.length})</h3><table style="border-collapse:collapse">${designs.join('')}</table>
      <h3 style="margin:14px 0 4px">Budget</h3><p>Daily ${inr(c.daily_budget)} · Monthly ${inr(c.monthly_budget)}${c.budget ? ' · Total ' + inr(c.budget) : ''}</p>
      <p style="margin-top:16px">${btn(await t('designs'), 'Approve designs', '#12B76A')}${btn(await t('budget'), 'Approve budget', '#12B76A')}${btn(await t('both'), 'Approve both', '#140C59')}${btn(await t('back'), 'Send back', '#B42318')}</p>
      <p style="font-size:12px;color:#667085">Each button opens a page in the ERP where you confirm. Or <a href="${host()}/#/marketing">open Marketing</a>.</p>`;
    out[p.email || 'management'] = await send(p.email ? [p.email] : [], `For your approval: ${c.name}`, html).catch((x) => ({ error: x.message }));
  }
  return out;
}
async function tellTeam(c, subject, html) {
  const to = c.submitted_email ? [c.submitted_email] : (await db.q("select email from users where not disabled and role = 'marketing' and coalesce(email, '') <> ''")).map((x) => x.email);
  return send(to, subject, html).catch((x) => ({ error: x.message }));
}

// ---------- the steps ----------
async function submit(id, user) {
  const c = await campaign(id); if (!c) throw Object.assign(new Error('That campaign is not there any more.'), { status: 404 });
  if (!c.designs.length) throw Object.assign(new Error('Add at least one design before sending the campaign for approval.'), { status: 400 });
  if (c.daily_budget == null && c.monthly_budget == null && c.budget == null) throw Object.assign(new Error('Enter the daily or monthly budget before sending for approval.'), { status: 400 });
  await db.q("update mkt_campaigns set plan_status = 'submitted', submitted_at = now(), submitted_by = $2, designs_ok_at = null, designs_ok_by = null, budget_ok_at = null, budget_ok_by = null, review_note = null, updated_at = now() where id = $1", [id, user.id]);
  await db.q("update mkt_posts set status = 'review', sent_at = now(), sent_by = $2, review_note = null, updated_at = now() where campaign_id = $1 and status in ('idea', 'draft', 'review', 'approved')", [id, user.id]);
  return { ok: true, mail: await approvalMail(await campaign(id), user).catch((x) => ({ error: x.message })) };
}
async function approve(id, kind, user) {
  const c = await campaign(id); if (!c) throw Object.assign(new Error('That campaign is not there any more.'), { status: 404 });
  if (kind === 'designs' || kind === 'both') await db.q('update mkt_campaigns set designs_ok_at = now(), designs_ok_by = $2 where id = $1', [id, user.id]);
  if (kind === 'budget' || kind === 'both') await db.q('update mkt_campaigns set budget_ok_at = now(), budget_ok_by = $2 where id = $1', [id, user.id]);
  const n = await db.one('select designs_ok_at, budget_ok_at from mkt_campaigns where id = $1', [id]);
  let scheduled = 0;
  if (n.designs_ok_at) {
    // approved designs: to the calendar, Scheduled where they have a date
    const r = await db.q("update mkt_posts set status = case when publish_at is not null then 'scheduled' else 'approved' end, approved_by = $2, approved_at = now(), review_note = null, updated_at = now() where campaign_id = $1 and status in ('idea', 'draft', 'review', 'approved') returning id", [id, user.id]);
    scheduled = r.length;
  }
  const both = !!(n.designs_ok_at && n.budget_ok_at);
  await db.q('update mkt_campaigns set plan_status = $2, status = case when $3 then \'active\' else status end, updated_at = now() where id = $1', [id, both ? 'approved' : 'partly', both]);
  const what = kind === 'both' ? 'the designs and the budget' : kind === 'designs' ? 'the designs' : 'the budget';
  await tellTeam(c, `Approved: ${c.name} (${what})`, `<p>${e(user.name)} has approved ${what} of <b>${e(c.name)}</b>.</p>${both ? '<p>The designs are in the Content calendar as Scheduled and will be posted on their dates.</p>' : `<p>Still waiting for approval: ${n.designs_ok_at ? 'the budget' : 'the designs'}.</p>`}<p><a href="${host()}/#/marketing">Open Marketing</a></p>`);
  return { ok: true, designs: !!n.designs_ok_at, budget: !!n.budget_ok_at, scheduled };
}
async function sendBack(id, note, user) {
  const c = await campaign(id); if (!c) throw Object.assign(new Error('That campaign is not there any more.'), { status: 404 });
  const msg = `${user.name}: ${String(note || '').slice(0, 1000)}`;
  await db.q("update mkt_campaigns set plan_status = 'sent_back', review_note = $2, designs_ok_at = null, designs_ok_by = null, budget_ok_at = null, budget_ok_by = null, updated_at = now() where id = $1", [id, msg]);
  await db.q("update mkt_posts set status = 'draft', review_note = $2, approved_by = null, approved_at = null, updated_at = now() where campaign_id = $1 and status in ('review', 'approved', 'scheduled')", [id, msg]);
  await tellTeam(c, `Sent back: ${c.name}`, `<p>${e(user.name)} has sent <b>${e(c.name)}</b> back:</p><p style="background:#FEF3F2;padding:10px;border-radius:8px">${e(note)}</p><p><a href="${host()}/#/marketing">Open Marketing</a></p>`);
  return { ok: true };
}

// ---------- one post: approve or send back (from the ERP, the email or the WhatsApp link) ----------
const whenTxt = (d) => (d ? new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'no date yet');
async function approvePost(id, user) {
  const r = await db.one("update mkt_posts set status = 'approved', approved_by = $2, approved_at = now(), review_note = null, updated_at = now() where id = $1 returning title, publish_at, array_to_json(channels) as channels, (select count(*)::int from mkt_post_files f where f.post_id = mkt_posts.id) as files", [id, user.id]);
  if (!r) throw Object.assign(new Error('That post is not there any more.'), { status: 404 });
  // say plainly when (or whether) it will go out by itself
  const auto = (r.channels || []).filter((c) => AUTO.includes(c));
  const when = r.publish_at ? new Date(r.publish_at) : null;
  let note;
  if (!auto.length) note = 'Approved. This post is not for Instagram or Facebook, so it is posted by hand.';
  else if (!when) note = 'Approved, but it has no date and time: set one and it posts itself then.';
  else if (when < new Date(Date.now() - 3 * 864e5)) note = 'Approved, but its date has passed: set a new date and time and it posts itself then.';
  else if (auto.includes('instagram') && !r.files) note = 'Approved, but Instagram needs the design attached: attach it and it posts itself.';
  else note = when <= new Date() ? 'Approved: it posts within 5 minutes.' : `Approved: it posts itself on ${whenTxt(when)}.`;
  await require('./audit').record(db.q, { user, action: 'approve', entity: 'mkt-post', entityId: id, after: { via: user.via || 'ERP' } }).catch(() => {});
  return { ok: true, title: r.title, note };
}
async function sendBackPost(id, note, user) {
  const p = await db.one("update mkt_posts set status = 'draft', review_note = $2, approved_by = null, approved_at = null, updated_at = now() where id = $1 returning id, title, sent_by", [id, `${user.name}: ${String(note || '').slice(0, 1000)}`]);
  if (!p) throw Object.assign(new Error('That post is not there any more.'), { status: 404 });
  const to = p.sent_by ? (await db.q("select email from users where id = $1 and coalesce(email, '') <> ''", [p.sent_by])).map((x) => x.email) : (await db.q("select email from users where not disabled and role = 'marketing' and coalesce(email, '') <> ''")).map((x) => x.email);
  await send(to, `Sent back: ${p.title}`, `<p>${e(user.name)} has sent <b>${e(p.title)}</b> back:</p><p style="background:#FEF3F2;padding:10px;border-radius:8px">${e(note)}</p><p><a href="${host()}/#/marketing">Open Marketing</a></p>`).catch(() => null);
  return { ok: true };
}
// A post sent for approval: each approver gets an email with the design and one-tap Approve / Send back buttons, and a
// WhatsApp with the link (once the WhatsApp template for post approvals is set; Management dashboard → 10 am message).
// Rafi Sir, 23 Nov 2026: approve from the phone without signing in.
async function postApprovalSend(p, by) {
  const files = await db.q('select id, name, mime from mkt_post_files where post_id = $1 order by id', [p.id]);
  const imgs = files.filter((f) => /^image\//.test(f.mime)), vids = files.filter((f) => /^video\//.test(f.mime));
  const ch = (Array.isArray(p.channels) ? p.channels : String(p.channels || '').replace(/[{}"]/g, '').split(',')).filter(Boolean).join(', ');
  const out = { email: {}, whatsapp: null };
  const people = await approvers({ withPhone: true });
  const pics = (await Promise.all(imgs.slice(0, 10).map(async (f) => `<img src="${await fileUrl(f.id, { preview: true })}" width="300" style="border-radius:10px;display:block;margin:0 0 8px;max-width:100%">`))).join('');
  const links = {};
  for (const u of people) {
    const t = async (k) => `${host()}/api/marketing?approve=${encodeURIComponent(await sign({ p: p.id, k, u: u.id, e: Date.now() + 7 * 864e5 }))}`;
    links[u.id] = { open: await t('post'), back: await t('postback') };
    if (!u.email) continue;
    const html = `<p>${e(by.name)} has sent a post for your approval.</p><h2 style="margin:6px 0">${e(p.title)}</h2><p style="color:#667085;margin:0 0 10px">${e(ch || 'channels not set')} · goes out ${e(whenTxt(p.publish_at))}</p>
      ${pics || (vids.length ? '<p>A video is attached: open the approval page to play it.</p>' : '<p style="color:#B42318">No design attached yet.</p>')}
      ${p.caption ? `<p style="white-space:pre-wrap;background:#F7F7FB;padding:10px;border-radius:8px">${e(String(p.caption).slice(0, 1500))}</p>` : ''}
      <p style="margin-top:16px">${btn(links[u.id].open, 'Approve', '#12B76A')}${btn(links[u.id].back, 'Send back', '#B42318')}</p>
      <p style="font-size:12px;color:#667085">Each button opens a page where you confirm; no sign-in needed. The link works for 7 days and only for you.</p>`;
    out.email[u.email] = await send([u.email], `For your approval: ${p.title}`, html, { text: `${by.name} has sent "${p.title}" for your approval: ${links[u.id].open}` }).catch((x) => ({ error: x.message }));
    if (!live()) break; // test version: one email to the test address is enough
  }
  // WhatsApp: the template's {{1}} title, {{2}} when it goes out, {{3}} the approval link
  try {
    const SA = require('./staff-alerts'), set = await SA.settings();
    const withPh = people.filter((u) => u.phone);
    out.whatsapp = withPh.length ? await SA.whatsapp(withPh, set.postTemplate, async (u) => [p.title, whenTxt(p.publish_at), links[u.id].open]) : { sent: 0, reason: 'No approver has a mobile number in Users.' };
  } catch (x) { out.whatsapp = { sent: 0, reason: x.message }; }
  await db.q('update mkt_posts set approval_sent_at = now() where id = $1', [p.id]).catch(() => {});
  return out;
}
// Every 5 minutes: a post in review whose approvers were not sent the one-tap message yet.
async function approvalsDue() {
  const rows = await db.q("select p.*, array_to_json(p.channels) as channels, coalesce(u.name, 'The marketing team') as by_name from mkt_posts p left join users u on u.id = p.sent_by where p.status = 'review' and p.approval_sent_at is null and p.campaign_id is null order by p.id limit 5");
  for (const p of rows) await postApprovalSend(p, { name: p.by_name }).catch((x) => console.error('post approval', x.message));
  return { sent: rows.length };
}
async function postPage(req, res, t, page) {
  const user = t.u ? await db.one('select id, name, role from users where id = $1 and not disabled', [t.u]) : null;
  if (!user || !require('./roles').has(user, 'marketing.approve')) return page('<h2>Not allowed</h2><p>This approval link is not for an approver.</p>');
  user.via = 'one-tap link';
  const p = await db.one('select id, title, caption, status, publish_at, array_to_json(channels) as channels, review_note from mkt_posts where id = $1', [t.p]);
  if (!p) return page('<h2>This post is not there any more.</h2>');
  if (req.method === 'POST') {
    if (!sameSite(req)) return page('<h2>Not allowed</h2><p>Open the link again.</p>');
    let b = req.body; if (Buffer.isBuffer(b)) b = b.toString('utf8'); if (typeof b === 'string') b = Object.fromEntries(new URLSearchParams(b)); b = b || {};
    if (b.do === 'back' || t.k === 'postback') {
      if (!String(b.note || '').trim()) return page('<h2>Write what should change</h2><p><a href="javascript:history.back()">Back</a></p>');
      await sendBackPost(p.id, b.note, user); return page(`<h2>Sent back</h2><p>${e(p.title)} has gone back to the marketing team with your comment.</p>`);
    }
    if (!['review', 'draft', 'idea'].includes(p.status)) return page(`<h2>Already ${e(p.status)}</h2><p>${e(p.title)}</p>`);
    const r = await approvePost(p.id, user);
    return page(`<h2>Approved ✓</h2><p><b>${e(p.title)}</b></p><p>${e(r.note)}</p>`);
  }
  const files = await db.q('select id, name, mime from mkt_post_files where post_id = $1 order by id', [p.id]);
  const media = (await Promise.all(files.slice(0, 10).map(async (f) => { const u = await fileUrl(f.id, { preview: true }); return /^image\//.test(f.mime) ? `<img src="${u}" style="width:100%;border-radius:12px;margin:0 0 10px">` : /^video\//.test(f.mime) ? `<video src="${u}" controls playsinline style="width:100%;border-radius:12px;margin:0 0 10px"></video>` : `<p><a href="${u}">${e(f.name)}</a></p>`; }))).join('');
  const done = !['review', 'draft', 'idea'].includes(p.status);
  return page(`<p style="color:#667085;margin:0">Hello ${e(user.name)}</p><h2 style="margin:4px 0 4px">${e(p.title)}</h2><p style="color:#667085;margin:0 0 12px">${e((p.channels || []).join(', '))} · goes out ${e(whenTxt(p.publish_at))}${p.publish_at && new Date(p.publish_at) < new Date() ? ' <b style="color:#B42318">(this time has passed: it goes out as soon as you approve)</b>' : ''}</p>
    ${media || '<p style="color:#B42318">No design attached yet.</p>'}
    ${p.caption ? `<p style="white-space:pre-wrap;background:#F7F7FB;padding:10px;border-radius:8px;font-size:14px">${e(p.caption)}</p>` : ''}
    ${done ? `<p><b>Already ${e(p.status)}.</b></p>` : `<form method="post">${t.k === 'postback' ? '' : '<button name="do" value="approve" style="background:#12B76A;color:#fff;border:0;border-radius:10px;padding:14px 22px;font-size:16px;font-weight:bold;width:100%;margin:0 0 14px">Approve</button>'}
      <label style="font-size:14px">${t.k === 'postback' ? 'What should change?' : 'Or send it back with a comment'}<br><textarea name="note" rows="3" style="width:100%;margin:6px 0 8px;box-sizing:border-box"></textarea></label>
      <button name="do" value="back" style="background:#fff;color:#B42318;border:1px solid #B42318;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:bold;width:100%">Send back</button></form>`}
    <p style="font-size:12px;color:#667085;margin-top:14px"><a href="${host()}/api/marketing?canvaopen=${p.id}">Open the design in Canva</a> · <a href="${host()}/#/marketing">Open Marketing</a></p>`);
}

// The page an email button opens: says what will happen, and does it only when "Confirm" is pressed.
async function linkPage(req, res) {
  const q = req.query || {}, t = await verify(q.approve);
  const page = (body) => { res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dream India ERP</title><body style="font-family:Arial,sans-serif;background:#F7F7FB;margin:0;padding:24px;color:#10114e"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 20px #10182814">${body}</div></body>`); };
  if (t && t.k === 'change' && t.r) return changePage(req, res, t, page);
  if (t && t.p && ['post', 'postback'].includes(t.k)) return postPage(req, res, t, page);
  if (!t || !t.c || !['designs', 'budget', 'both', 'back'].includes(t.k)) return page('<h2>This link has expired</h2><p>Open Marketing in the ERP to approve.</p>');
  const user = t.u ? await db.one('select id, name, role from users where id = $1 and not disabled', [t.u]) : null;
  const { has } = require('./roles');
  if (!user || !has(user, 'marketing.approve')) return page('<h2>Not allowed</h2><p>This approval link is not for an approver.</p>');
  const c = await campaign(t.c); if (!c) return page('<h2>This campaign is not there any more.</h2>');
  if (req.method === 'POST') {
    // the signed link is the key; a page posted from another site is still refused. Mail apps and app windows send "Origin: null".
    if (!sameSite(req)) return page('<h2>Not allowed</h2><p>Open the link from your email again.</p>');
    let b = req.body; if (Buffer.isBuffer(b)) b = b.toString('utf8'); if (typeof b === 'string') b = Object.fromEntries(new URLSearchParams(b)); b = b || {};
    if (t.k === 'back') { if (!String(b.note || '').trim()) return page('<h2>Write what should change</h2><p><a href="javascript:history.back()">Back</a></p>'); await sendBack(c.id, b.note, user); return page(`<h2>Sent back</h2><p>${e(c.name)} has gone back to the marketing team with your comment.</p>`); }
    const r = await approve(c.id, t.k, user);
    return page(`<h2>Approved</h2><p>${e(c.name)}: designs ${r.designs ? 'approved ✓' : 'still waiting'} · budget ${r.budget ? 'approved ✓' : 'still waiting'}.</p>${r.designs && r.budget ? `<p>${r.scheduled} design${r.scheduled === 1 ? '' : 's'} are now in the calendar and will be posted on their dates.</p>` : ''}<p><a href="${host()}/#/marketing">Open Marketing</a></p>`);
  }
  const what = { designs: 'Approve the designs', budget: 'Approve the budget', both: 'Approve the designs and the budget', back: 'Send it back' }[t.k];
  return page(`<p style="color:#667085;margin:0">Hello ${e(user.name)}</p><h2 style="margin:4px 0 8px">${e(c.name)}</h2><p style="color:#667085">${c.designs.length} design${c.designs.length === 1 ? '' : 's'} · daily ${inr(c.daily_budget)} · monthly ${inr(c.monthly_budget)}</p>
    <form method="post">${t.k === 'back' ? '<label>What should change?<br><textarea name="note" rows="4" style="width:100%;margin:6px 0 12px" required></textarea></label>' : ''}<button style="background:${t.k === 'back' ? '#B42318' : '#140C59'};color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:bold">${what}</button></form>`);
}

function sameSite(req) {
  const origin = String(req.headers.origin || ''); let oh = null; try { oh = origin && origin !== 'null' ? new URL(origin).host : null; } catch { oh = null; }
  const hosts = [req.headers.host, req.headers['x-forwarded-host'], (() => { try { return new URL(host()).host; } catch { return null; } })()].filter(Boolean);
  return !oh || hosts.includes(oh);
}
// A Meta campaign change (pause, start again, new daily budget) approved from the email.
async function changePage(req, res, t, page) {
  const user = t.u ? await db.one('select id, name, role from users where id = $1 and not disabled', [t.u]) : null;
  if (!user || !require('./roles').has(user, 'marketing.approve')) return page('<h2>Not allowed</h2><p>This approval link is not for an approver.</p>');
  const r = await db.one('select x.kind, x.value, x.status, x.result, c.name, c.ext_daily_budget from mkt_changes x join mkt_campaigns c on c.id = x.campaign_id where x.id = $1', [t.r]);
  if (!r) return page('<h2>This request is not there any more.</h2>');
  const what = `${r.kind === 'pause' ? 'Pause' : r.kind === 'resume' ? 'Start again' : 'Change the daily budget to ' + inr(r.value) + ' for'} ${e(r.name)}`;
  if (r.status !== 'pending') return page(`<h2>Already ${r.status === 'done' ? 'done' : r.status}</h2><p>${what}${r.result ? ': ' + e(r.result) : ''}.</p>`);
  if (req.method === 'POST') {
    if (!sameSite(req)) return page('<h2>Not allowed</h2><p>Open the link from your email again.</p>');
    const x = await require('./mkt-money').decide(t.r, true, user);
    return page(x.ok ? `<h2>Done</h2><p>${what}: changed on Meta.</p>` : `<h2>Meta did not take it</h2><p>${e(x.error)}</p><p>Change it in Ads Manager instead.</p>`);
  }
  return page(`<p style="color:#667085;margin:0">Hello ${e(user.name)}</p><h2 style="margin:4px 0 12px">${what}</h2>${r.kind === 'budget' && r.ext_daily_budget ? `<p style="color:#667085">Now ${inr(r.ext_daily_budget)} a day.</p>` : ''}<form method="post"><button style="background:#140C59;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:bold">Approve</button></form>`);
}

// ---------- posting what is due ----------
// A post goes out at its date and time once it is scheduled or approved (Rafi Sir, 20 Nov 2026: approving a post
// with a date and a design is enough). A date more than 3 days gone is never posted late.
const AUTO = ['instagram', 'facebook'];
// the Instagram account tagged and invited as a Collab on every automatic Instagram post (Marketing → Set-up; empty = none)
async function igTag() {
  const r = await db.one("select value from settings where key = 'marketing'").catch(() => null);
  const v = r && r.value && r.value.igTag;
  return v === undefined ? 'rafidreamindia' : String(v || '');
}
async function publishDue({ limit = 5 } = {}) {
  const social = require('./social');
  // with approvals on, only a post Management approved is posted
  const needApproval = !!(((await db.one("select value from settings where key = 'marketing'")) || {}).value || {}).needApproval;
  const due = await db.q(`select p.id from mkt_posts p left join mkt_campaigns c on c.id = p.campaign_id
     where p.status in ('scheduled', 'approved') and p.publish_at <= now() and p.publish_at > now() - interval '3 days' and (p.campaign_id is null or c.plan_status = 'approved')
       and ($2::boolean is false or p.approved_at is not null)
       and coalesce(p.publish_log->>'_done', '') <> 'true' and (p.publishing_at is null or p.publishing_at < now() - interval '10 minutes')
     order by p.publish_at limit $1`, [limit, needApproval]);
  const out = [];
  for (const { id } of due) {
    // taken by this run, or skipped: another run (the 5-minute job, or "Post now") is posting it
    const p = await db.one(`update mkt_posts set publishing_at = now() where id = $1 and status in ('scheduled', 'approved') and coalesce(publish_log->>'_done', '') <> 'true'
        and (publishing_at is null or publishing_at < now() - interval '10 minutes')
      returning id, title, caption, array_to_json(channels) as channels, publish_log, project_id, rera_on_design`, [id]);
    if (!p) continue;
    try {
      const files = await db.q('select id, mime from mkt_post_files where post_id = $1 order by id', [p.id]);
      const media = await Promise.all(files.map(async (f) => ({ url: await fileUrl(f.id), mime: f.mime })));
      const log = p.publish_log || {}; let url = null;
      const saveLog = () => db.q('update mkt_posts set publish_log = $2, publishing_at = now() where id = $1', [p.id, log]);
      const rera = await require('./mkt-tools').reraMissing({ id: p.id, title: p.title, caption: p.caption, project_id: p.project_id, rera_on_design: p.rera_on_design });
      if (rera) { for (const n of p.channels || []) if (!(log[n] && log[n].id)) log[n] = { error: rera, at: new Date().toISOString(), tries: 3 }; await db.q('update mkt_posts set publish_log = $2, publishing_at = null where id = $1', [p.id, log]); out.push({ id: p.id, error: rera }); continue; }
      for (const n of p.channels || []) {
        if (log[n] && (log[n].id || log[n].manual)) continue;
        if (!AUTO.includes(n)) { log[n] = { manual: true, note: 'Post by hand: the design is ready in the ERP.' }; continue; }
        try { const r = await social.publishMeta(n, { caption: require('./post-links').tagCaption(p.caption || p.title, n, p.id), media, pending: log[n] && log[n].pending, igTag: await igTag() }); log[n] = { ...r, at: new Date().toISOString() }; if (r.url && !url) url = r.url; }
        catch (x) { log[n] = { error: x.message, at: new Date().toISOString(), tries: ((log[n] && log[n].tries) || 0) + 1 }; }
        await saveLog(); // kept at once: a post that went out is never posted again, even if this run stops here
      }
      const auto = (p.channels || []).filter((n) => AUTO.includes(n));
      const done = auto.length > 0 && auto.every((n) => log[n] && log[n].id), left = auto.some((n) => !(log[n] && (log[n].id || (log[n].error && log[n].tries >= 3))));
      if (!left) log._done = true; // nothing more to try (posted, given up after 3 tries, or by hand only)
      await db.q(`update mkt_posts set publish_log = $2, post_url = coalesce(post_url, $3), status = case when $4 then 'published' else status end, published_at = case when $4 then now() else published_at end, publishing_at = null, updated_at = now() where id = $1`, [p.id, log, url, done]);
      out.push({ id: p.id, log });
    } catch (x) { await db.q('update mkt_posts set publishing_at = null where id = $1', [p.id]).catch(() => {}); throw x; }
  }
  return { posted: out.length, out };
}

module.exports = { approvePost, sendBackPost, postApprovalSend, approvalsDue, send, recipients, live, approvers, host, sign, verify, fileUrl, campaign, submit, approve, sendBack, linkPage, publishDue, approvalMail };
