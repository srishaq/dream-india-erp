// How long each request spends in the database, for finding slow screens. Every API answer carries a
// Server-Timing header (total, database time, number of queries; the browser's developer tools show it), and a
// request slower than SLOW_MS writes one line to the Vercel logs with its slowest queries.
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
const SLOW_MS = +process.env.ERP_SLOW_MS || 1500;
let warm = false; // the first request a function instance answers includes its start-up

function track(req, res, fn) {
  const t = { start: Date.now(), q: 0, db: 0, wait: 0, top: [], cold: !warm };
  warm = true;
  const send = res.json && res.json.bind(res);
  if (send) res.json = (body) => {
    try { if (!res.headersSent) res.setHeader('Server-Timing', `total;dur=${Date.now() - t.start}, db;dur=${t.db};desc="${t.q} queries", pool;dur=${t.wait}${t.cold ? ', cold;desc="new instance"' : ''}`); } catch {}
    return send(body);
  };
  return als.run(t, async () => {
    try { return await fn(); } finally {
      const ms = Date.now() - t.start;
      if (ms >= SLOW_MS) console.log(`[slow] ${req.method} ${String(req.url || '').split('?')[0]} ${ms} ms: ${t.q} queries ${t.db} ms, waited ${t.wait} ms for a connection${t.cold ? ', new instance' : ''}; slowest: ${t.top.map((x) => `${x.ms} ms ${x.sql}`).join(' | ')}`);
    }
  });
}
// lib/db.js reports each query here: waited = time until a connection was free, ms = time in the database.
function query(sql, waited, ms) {
  const t = als.getStore(); if (!t) return;
  t.q++; t.db += ms; t.wait += waited;
  if (ms >= 50) { t.top.push({ ms, sql: String(sql).replace(/\s+/g, ' ').slice(0, 120) }); t.top.sort((a, b) => b.ms - a.ms); t.top.length = Math.min(t.top.length, 3); }
}
module.exports = { track, query };
