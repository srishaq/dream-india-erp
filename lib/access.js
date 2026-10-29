// Project checks shared by Module 1 routes.
const db = require('./db');
const { fail } = require('./http');

function needProject(u, projectId) {
  if (!projectId || !u.projects.includes(+projectId)) throw fail(403, 'You do not have access to this project.');
  return +projectId;
}
async function bookingFor(u, bookingId, t = db) {
  const b = await t.one(`select b.*, u.project_id, u.building_id, u.unit_no from bookings b join units u on u.id = b.unit_id where b.id = $1`, [bookingId]);
  if (!b) throw fail(404, 'Booking not found.');
  needProject(u, b.project_id);
  return b;
}
// Maker and checker: whoever entered it may not approve it. The Admin is the exception (asked for on 29 Oct 2026,
// so the owner can run the whole process himself); the audit log still shows the Admin both entered and approved it.
function notOwn(u, createdBy) {
  if (createdBy && createdBy === u.id && u.role !== 'admin') throw fail(403, 'You entered this yourself, so someone else must approve it.');
}
module.exports = { needProject, bookingFor, notOwn };
