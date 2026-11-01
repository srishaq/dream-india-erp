// GET /api/health → is the ERP up? 200 when the database answers and the 5-minute job is running; 503 otherwise.
// For an outside monitor (UptimeRobot or similar) checking every 5 minutes. Shows no business data.
const W = require('../lib/watchdog');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const h = await W.health().catch(() => ({ ok: false, status: 503, db: 'down' }));
  res.statusCode = h.status; res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: h.ok, db: h.db, fiveMinuteJobMinutesAgo: h.fiveMinuteJobMinutesAgo, lastBackupHoursAgo: h.lastBackupHoursAgo }));
};
