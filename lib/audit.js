// Records a change in the audit log. Pass the transaction's `q` so the log entry is saved
// (or rolled back) together with the change it describes.
async function record(q, { user, action, entity, entityId = null, projectId = null, before = null, after = null, note = null }) {
  await q(
    'insert into audit_log (user_id, action, entity, entity_id, project_id, before, after, note) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [user ? user.id : null, action, entity, entityId == null ? null : String(entityId), projectId, before, after, note],
  );
}
module.exports = { record };
