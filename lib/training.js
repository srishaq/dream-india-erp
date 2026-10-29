// Training videos: short screen recordings of the ERP (made on sample data, no real buyers), one per task.
// The files are in public/training/<id>.mp4; scripts/make-training.js records them again after the screens change.
// soon: true until the voiced recording is made (the module stays off the Training page until then).
const SOON = true;
const MODULES = [
  { id: 'start', team: 'Everyone', title: 'Getting started', sub: 'Signing in, the home page and your department.', soon: SOON },
  { id: 'crm-full', team: 'Sales & CRM', title: 'The complete CRM course', sub: 'All six CRM videos in one, start to finish.', soon: SOON },
  { id: 'crm-flats', team: 'Sales & CRM', title: 'Flats and the flat file', sub: 'Flats & buyers, the flat file, contact buttons and the registration checklist.', soon: SOON },
  { id: 'crm-today', team: 'Sales & CRM', title: 'Today and follow-up calls', sub: 'Your own call list, logging a call and promises to pay.', soon: SOON },
  { id: 'crm-receipts', team: 'Sales & CRM', title: 'Receipts and cheques', sub: 'Entering a receipt, provisional receipts, where each cheque is.', soon: SOON },
  { id: 'crm-demands', team: 'Sales & CRM', title: 'Demands, letters and reminders', sub: 'Demand runs, automatic letters and WhatsApp, print and courier, reminders.', soon: SOON },
  { id: 'crm-messages', team: 'Sales & CRM', title: 'Buyer messages, Dream Chat and documents', sub: 'Emails and WhatsApps with each flat, the Inbox, Dream Chat, documents.', soon: SOON },
  { id: 'crm-booking', team: 'Sales & CRM', title: 'Booking, approval and cancellation', sub: 'Booking a flat, approval, cancelling and rebooking.', soon: SOON },
  { id: 'acc-full', team: 'Accounts', title: 'The complete Accounts course', sub: 'All five Accounts videos in one, start to finish.', soon: SOON },
  { id: 'acc-today', team: 'Accounts', title: 'Today and the 9 am audit', sub: 'The morning audit, TDS to deposit, balances to confirm, bills to pay.', soon: SOON },
  { id: 'acc-registers', team: 'Accounts', title: 'Receipts, payments and bills', sub: 'The bank registers, paying approved purchase bills, TDS from the head, PDC.', soon: SOON },
  { id: 'acc-bank', team: 'Accounts', title: 'The bank, every day', sub: 'The 3:10 pm check, Daily Bank Balance and confirming it, reconciling, compliance.', soon: SOON },
  { id: 'acc-approvals', team: 'Accounts', title: 'Approvals, corrections and refunds', sub: 'Approving CRM receipts, correcting a split, Not bounced, refunds, Tally vs CRM.', soon: SOON },
  { id: 'acc-month', team: 'Accounts', title: 'Month end, the CA and Tally', sub: 'Checks, closing the month, the CA pack, the Tally link, the dashboard.', soon: SOON },
];
// soon: the video is not recorded yet, so the module is left off the Training page
module.exports = { MODULES: MODULES.filter((m) => !m.soon), ALL: MODULES };
