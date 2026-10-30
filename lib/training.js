// Training videos: short screen recordings of the ERP (made on sample data, no real buyers), one per task.
// The files are in public/training/<id>.mp4; scripts/make-training.js records them again after the screens change.
// soon: true until the voiced recording is made (the module stays off the Training page until then).
const SOON = false;
const MODULES = [
  { id: 'crm-full', team: 'Sales & CRM', title: 'The complete CRM course', sub: 'Flats and the flat file, Today and calls, receipts, demands and letters, buyer messages, booking and cancellation.', soon: SOON },
  { id: 'site-full', team: 'Construction', title: 'The complete Construction course', sub: 'For site engineers: Today, requesting and receiving material, the daily report, slabs, pours and cube tests, and problems.' },
  { id: 'purchase-full', team: 'Purchase', title: 'The complete Purchase course', sub: 'Management approval, placing orders, Accounts approving bills, and contractor work orders and RA bills.' },
  { id: 'acc-full', team: 'Accounts', title: 'The complete Accounts course', sub: 'Today and the 9 am audit, receipts, payments and bills, the bank every day, approvals and refunds, month end, the CA and Tally.', soon: SOON },
];
// soon: the video is not recorded yet, so the module is left off the Training page
module.exports = { MODULES: MODULES.filter((m) => !m.soon), ALL: MODULES };
