// The AI marketing agent team (/agents), company-wide or by project (lib/agents.js does the work).
// GET  ?scope=company|<projectId>  → everything the command centre shows, and the project list for the drop-down
// POST {action}:
//   run                 run the Orchestrator now for this scope                         (marketing.edit / approve)
//   draft               a brief straight to the Content Engine: n drafts on an angle      (marketing.edit / approve)
//   scope.save          owner input: voice, positioning, budget cap, approval bar, posts a week; agents on/off, pause
//                                                                                        (marketing.approve: the owner)
//   kill                the kill switch for every agent in every project                  (marketing.approve)
//   kb.save / kb.reset  a knowledge file for this scope / back to the company's copy      (marketing.edit)
//   funnel.save / funnel.toggle / funnel.delete   comment-to-DM funnels                    (marketing.edit)
//   funnel.live         from test accounts only to everyone                               (marketing.approve)
//   post.approve / post.sendback   check & approve a draft                                 (marketing.approve)
//   owner.done          an item for the owner is dealt with                               (marketing.approve)
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { route, fail, str, intOr } = require('../lib/http');
const A = require('../lib/agents');

const canView = (u) => has(u, 'marketing.view');
const canEdit = (u) => has(u, 'marketing.edit') || has(u, 'marketing.approve') || u.role === 'admin';
const canOwn = (u) => has(u, 'marketing.approve') || u.role === 'admin';
const scopeOk = (u, s) => s === 'company' || (A.okScope(s) && u.projects.includes(+s));

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canView(u)) throw fail(403, 'Your login does not open the agent team.');
    const scope = String((req.query || {}).scope || 'company');
    if (!scopeOk(u, scope)) throw fail(403, 'That project is not on your login.');
    const projects = (await db.q("select p.id, p.name, p.location, p.rera_no, s.enabled from projects p left join ag_scope s on s.scope = p.id::text where p.active order by p.name"))
      .filter((p) => u.projects.includes(p.id));
    const st = await A.state(scope);
    return res.json({ ...st, projects, me: { name: u.name, edit: canEdit(u), own: canOwn(u) } });
  },
  POST: async (req, res, d) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canView(u)) throw fail(403, 'Your login does not open the agent team.');
    const a = d.action, scope = String(d.scope || 'company');
    const log = (action, entity, id, after) => audit.record(db.q, { user: u, action, entity, entityId: id, after });
    const edit = () => { if (!canEdit(u)) throw fail(403, 'Only the marketing team changes this.'); };
    const own = () => { if (!canOwn(u)) throw fail(403, 'Only Management (the owner) sets this.'); };
    const inScope = () => { if (!scopeOk(u, scope)) throw fail(403, 'That project is not on your login.'); };

    if (a === 'run') { edit(); inScope(); const r = await A.run(scope, { trigger: 'run now by ' + u.name, user: u }); await log('run', 'agents', scope, r); return res.json({ ok: true, ...r }); }
    if (a === 'draft') {
      edit(); inScope();
      const n = Math.max(1, Math.min(5, intOr(d.n, 3))), angle = str(d.angle, 600);
      if (!angle) throw fail(400, 'Write the brief: what the drafts should be about.');
      await A.say(scope, 'owner', 'content-engine', `Brief from ${u.name}: ${n} draft${n === 1 ? '' : 's'}: ${angle}`, 'brief');
      const ids = await A.draftPosts(scope, n, angle, u);
      await A.say(scope, 'content-engine', 'owner', `Drafts ready: ${ids.map((x) => '"' + x.title + '"').join(', ')}.`, 'draft', { posts: ids.map((x) => x.id) });
      await log('draft', 'agents', scope, { posts: ids.map((x) => x.id) });
      return res.json({ ok: true, posts: ids });
    }
    if (a === 'scope.save') {
      own(); inScope();
      const cur = await A.settingsOf(scope), o = d.owner || {};
      const owner = {
        voice: str(o.voice ?? cur.owner.voice, 1000), positioning: str(o.positioning ?? cur.owner.positioning, 1000),
        budgetCap: o.budgetCap === undefined ? (cur.owner.budgetCap ?? null) : o.budgetCap === '' || o.budgetCap == null ? null : Math.max(0, Math.round(+String(o.budgetCap).replace(/[,₹\s]/g, '')) || 0),
        templates: cur.owner.templates || {},
        approvalBar: ['all', 'routine'].includes(o.approvalBar) ? o.approvalBar : cur.owner.approvalBar,
        postsPerWeek: Math.max(1, Math.min(14, intOr(o.postsPerWeek, cur.owner.postsPerWeek))),
      };
      const enabled = d.enabled == null ? cur.enabled : !!d.enabled, paused = d.paused == null ? cur.paused : !!d.paused;
      await db.q(`insert into ag_scope (scope, enabled, paused, owner, updated_by, updated_at) values ($1, $2, $3, $4, $5, now())
          on conflict (scope) do update set enabled = excluded.enabled, paused = excluded.paused, owner = excluded.owner, updated_by = excluded.updated_by, updated_at = now()`, [scope, enabled, paused, owner, u.id]);
      if (enabled !== cur.enabled) await A.say(scope, 'owner', 'orchestrator', enabled ? `${u.name} switched the agents on for this ${scope === 'company' ? 'company' : 'project'}.` : `${u.name} switched the agents off here.`);
      if (paused !== cur.paused) await A.say(scope, 'owner', 'orchestrator', paused ? `${u.name} paused every agent here.` : `${u.name} let the agents run again.`);
      await log('owner-input', 'agents', scope, { enabled, paused, owner });
      return res.json({ ok: true });
    }
    if (a === 'kill') {
      own(); const on = !!d.on;
      await db.q("insert into ag_scope (scope, paused, updated_by, updated_at) values ('all', $1, $2, now()) on conflict (scope) do update set paused = excluded.paused, updated_by = excluded.updated_by, updated_at = now()", [on, u.id]);
      await A.say('company', 'owner', 'orchestrator', on ? `KILL SWITCH ON by ${u.name}: every agent in every project stopped.` : `Kill switch off (${u.name}): agents back to work.`, 'owner');
      await log(on ? 'kill-on' : 'kill-off', 'agents', 'all', {});
      return res.json({ ok: true });
    }
    if (a === 'kb.save' || a === 'kb.reset') {
      edit(); inScope();
      const path = str(d.path, 120); if (!A.KB.some((k) => k.path === path)) throw fail(400, 'Unknown knowledge file.');
      if (a === 'kb.reset') { await db.q('delete from ag_knowledge where scope = $1 and path = $2', [scope, path]); await log('kb-reset', 'agents', scope, { path }); return res.json({ ok: true }); }
      const body = str(d.body, 20000); if (!body) throw fail(400, 'The file is empty.');
      await db.q(`insert into ag_knowledge (scope, path, body, updated_by, updated_at) values ($1, $2, $3, $4, now())
          on conflict (scope, path) do update set body = excluded.body, updated_by = excluded.updated_by, updated_at = now()`, [scope, path, body, u.id]);
      await A.say(scope, 'brain', null, `${u.name} updated ${path}. Every agent reads the new version from now on.`);
      await log('kb-save', 'agents', scope, { path });
      return res.json({ ok: true });
    }
    if (a === 'funnel.save') {
      edit(); inScope();
      const id = intOr(d.id), network = d.network === 'facebook' ? 'facebook' : 'instagram';
      const keyword = str(d.keyword, 30).replace(/^#/, ''); if (!/^[\p{L}\p{N}_-]{2,30}$/u.test(keyword)) throw fail(400, 'The keyword is one word (letters or numbers), like PRICE or GOREGAON.');
      const dm = str(d.dmText, 900); if (dm.length < 20) throw fail(400, 'Write the DM the person gets.');
      const handles = String(d.testHandles || '').split(/[\s,]+/).map((h) => h.replace(/^@/, '').trim()).filter(Boolean).slice(0, 10);
      const vals = [network, keyword.toUpperCase(), str(d.mediaExt, 60) || null, dm, str(d.publicReply, 300) || null, str(d.thanksText, 600) || null, handles];
      let fid = id;
      if (id) { const r = await db.one('update ag_funnels set network = $2, keyword = $3, media_ext = $4, dm_text = $5, public_reply = $6, thanks_text = $7, test_handles = $8, updated_at = now() where id = $1 and scope = $9 returning id', [id, ...vals, scope]); if (!r) throw fail(404, 'That funnel is not there any more.'); }
      else fid = (await db.one('insert into ag_funnels (scope, network, keyword, media_ext, dm_text, public_reply, thanks_text, test_handles, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id', [scope, ...vals, u.id])).id;
      await log(id ? 'funnel-edit' : 'funnel-add', 'agents', fid, { scope, keyword: vals[1] });
      return res.json({ ok: true, id: fid });
    }
    if (a === 'funnel.toggle' || a === 'funnel.live' || a === 'funnel.delete') {
      a === 'funnel.live' ? own() : edit();
      const f = await db.one('select * from ag_funnels where id = $1', [intOr(d.id)]); if (!f || !scopeOk(u, f.scope)) throw fail(404, 'That funnel is not there any more.');
      if (a === 'funnel.delete') { await db.q('delete from ag_funnels where id = $1', [f.id]); await log('funnel-delete', 'agents', f.id, { keyword: f.keyword }); return res.json({ ok: true }); }
      // switching on (or to live) counts only comments made from now on: nobody old is messaged
      if (a === 'funnel.toggle') await db.q('update ag_funnels set active = $2, updated_at = case when $2 then now() else updated_at end where id = $1', [f.id, !!d.on]);
      else await db.q('update ag_funnels set live = $2, updated_at = now() where id = $1', [f.id, !!d.on]);
      await A.say(f.scope, 'leads', 'owner', a === 'funnel.toggle' ? `Funnel "${f.keyword}" ${d.on ? 'switched on' : 'switched off'} by ${u.name}.` : `Funnel "${f.keyword}" ${d.on ? 'is LIVE: everyone who comments gets the DM' : 'back to test accounts only'} (${u.name}).`);
      await log(a, 'agents', f.id, { on: !!d.on });
      return res.json({ ok: true });
    }
    if (a === 'post.approve' || a === 'post.sendback') {
      own();
      const p = await db.one('select id, title, caption, project_id, rera_on_design, created_by from mkt_posts where id = $1', [intOr(d.id)]);
      if (!p || (p.project_id && !u.projects.includes(p.project_id))) throw fail(404, 'That post is not there any more.');
      const sc = p.project_id ? String(p.project_id) : 'company';
      if (a === 'post.approve') {
        if (p.created_by === u.id) throw fail(403, 'Someone other than the person who asked for it approves it.');
        const m = await require('../lib/mkt-tools').reraMissing(p); if (m) throw fail(400, m);
        await db.q("update mkt_posts set status = 'approved', approved_by = $2, approved_at = now(), review_note = null, updated_at = now() where id = $1", [p.id, u.id]);
        await A.say(sc, 'owner', 'publishing', `${u.name} approved "${p.title}". It goes out once the design is attached and it is scheduled.`);
      } else {
        const note = str(d.note, 1000); if (!note) throw fail(400, 'Write what should change.');
        await db.q("update mkt_posts set status = 'draft', review_note = $2, approved_by = null, approved_at = null, updated_at = now() where id = $1", [p.id, `${u.name}: ${note}`]);
        await A.say(sc, 'owner', 'content-engine', `${u.name} sent back "${p.title}": ${note}`);
      }
      await audit.record(db.q, { user: u, action: a === 'post.approve' ? 'approve' : 'send-back', entity: 'mkt-post', entityId: p.id, after: { from: 'agents' } });
      return res.json({ ok: true });
    }
    // ---------- Creative Studio: Canva brand templates for each kind of post, and designing a post now ----------
    if (a === 'canva.templates') {
      edit(); inScope();
      const T = require('../lib/mkt-tools'), st = await T.canvaStatus();
      if (!st.connected) throw fail(409, 'Connect Canva first: Sales & Marketing → Set-up → Connect Canva.');
      const set = await A.settingsOf(scope);
      return res.json({ ok: true, templates: await T.canvaTemplates(), chosen: (set.owner && set.owner.templates) || {} });
    }
    if (a === 'templates.save') {
      edit(); inScope();
      const cur = await A.settingsOf(scope), t = d.templates || {}, templates = {};
      for (const k of ['default', 'post', 'carousel', 'reel', 'story']) if (t[k]) templates[k] = str(t[k], 80);
      await db.q(`insert into ag_scope (scope, enabled, paused, owner, updated_by, updated_at) values ($1, $2, $3, $4, $5, now())
          on conflict (scope) do update set owner = excluded.owner, updated_by = excluded.updated_by, updated_at = now()`, [scope, cur.enabled, cur.paused, { ...cur.owner, templates }, u.id]);
      await A.say(scope, 'creative', null, `${u.name} chose the Canva templates: every new draft is designed from them.`);
      await log('templates', 'agents', scope, { templates });
      return res.json({ ok: true });
    }
    if (a === 'post.design') {
      edit();
      const p = await db.one('select id, project_id from mkt_posts where id = $1', [intOr(d.id)]);
      if (!p || (p.project_id && !u.projects.includes(p.project_id))) throw fail(404, 'That post is not there any more.');
      const r = await A.design(p.id, u);
      if (r.skipped) throw fail(409, r.skipped);
      await log('design', 'mkt-post', p.id, { added: r.added });
      return res.json({ ok: true, ...r });
    }
    if (a === 'owner.done') {
      own();
      const r = await db.one("update ag_interrupts set status = 'handled', handled_at = now(), handled_by = $2 where id = $1 and status = 'owner' returning scope, kind", [intOr(d.id), u.id]);
      if (!r) throw fail(404, 'Already dealt with.');
      await A.say(r.scope, 'owner', 'orchestrator', `${u.name} dealt with: ${r.kind.replace(/_/g, ' ')}.`);
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
