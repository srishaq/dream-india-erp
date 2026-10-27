// A new release may bring the portal tables: make sure they exist before the first request uses them.
const { migrate, status } = require('../migrate');
let done = false;
async function migrateIfNeeded() {
  if (done) return;
  const st = await status();
  if (st.pending.length && st.applied.length) await migrate();
  done = true;
}
module.exports = { migrateIfNeeded };
