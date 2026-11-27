// Which set of accounts books a request works on. Each company keeps its own books: Prime Realtors (Dream Signature)
// is 'signature', Dream India Builders (Dream Aspire) is 'aspire' (22 Nov 2026). The page sends the project it is on
// (X-Book header, from the project picker); everything without one, and every scheduled job, works on 'signature'
// unless it runs inside book.run('aspire', …).
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
const BOOKS = {
  signature: { project: 'SIGNATURE', company: 'Prime Realtors', label: 'Dream Signature' },
  aspire: { project: 'ASPIRE', company: 'Dream India Builders', label: 'Dream Aspire' },
  // Dream Legacy Goregaon (27 Nov 2026): its own books from the land payments on, kept apart from Dream Aspire's
  legacy: { project: 'LEGACY', company: 'Dream India Builders', label: 'Dream Legacy Goregaon' },
};
const valid = (b) => (Object.prototype.hasOwnProperty.call(BOOKS, b) ? b : 'signature');
const cur = () => { const s = als.getStore(); return (s && s.book) || 'signature'; };
const run = (book, fn, project = null) => als.run({ book: valid(book), project }, fn);
// The project the page is on (X-Project header, from the project picker), checked against the login in auth.guard.
// Every request that shows project data should use it (or an explicit ?project=); null when none was sent.
const project = () => { const s = als.getStore(); return (s && s.project) || null; };
const setProject = (id, book) => { const s = als.getStore(); if (s) { s.project = id; if (book) s.book = valid(book); } };
const bookOfCode = (code) => (Object.entries(BOOKS).find(([, v]) => v.project === code) || ['signature'])[0];
const info = (b = cur()) => ({ book: valid(b), ...BOOKS[valid(b)] });
// The project on the picker comes with each request: the X-Book / X-Project headers the app sends, else the erp_book /
// erp_proj cookies the app keeps (24 Nov 2026: pages with their own scripts, and file downloads, sent no header, so the
// server fell back to Dream Signature on Aspire: the RERA panel showed Signature's flats).
const cookie = (req, name) => { const m = String((req && req.headers && req.headers.cookie) || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
const fromReq = (req) => valid(String((req && req.headers && req.headers['x-book']) || cookie(req, 'erp_book') || '').toLowerCase().trim());
const projectFromReq = (req) => { const v = parseInt(String((req && req.headers && req.headers['x-project']) || cookie(req, 'erp_proj') || ''), 10); return Number.isInteger(v) && v > 0 ? v : null; };
// the project id of a book (for access checks and CRM joins)
let ids = null;
async function projectId(b = cur()) {
  const want = BOOKS[valid(b)].project;
  // read again when the project is not there yet (a project added since, e.g. Dream Legacy Goregaon)
  if (!ids || !ids[want]) { const db = require('./db'); ids = Object.fromEntries((await db.q('select id, code from projects')).map((r) => [r.code, r.id])); setTimeout(() => { ids = null; }, 600000).unref?.(); }
  return ids[want] || null;
}
// the project code of the request's books ('SIGNATURE' or 'ASPIRE')
const code = () => BOOKS[cur()].project;
module.exports = { BOOKS, cur, code, run, info, fromReq, projectFromReq, projectId, valid, project, setProject, bookOfCode };
