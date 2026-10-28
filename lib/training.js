// Training videos: short screen recordings of the ERP (made on sample data, no real buyers), one per task.
// The files are in public/training/<id>.mp4; scripts/make-training.js records them again after the screens change.
const MODULES = [
  { id: 'start', team: 'Everyone', title: 'Getting started', sub: 'Signing in, the home page, a project’s departments and the side menu.' },
  { id: 'crm-new', team: 'Sales & CRM', title: 'The new CRM in five minutes', sub: 'One window for every flat: Flats & buyers, the flat file and its tabs.' },
  { id: 'crm-calls', team: 'Sales & CRM', title: 'Today and follow-up calls', sub: 'The 9 am list, who to call, logging a call and promises to pay.' },
  { id: 'crm-receipts', team: 'Sales & CRM', title: 'Receipts and cheques', sub: 'Entering a receipt, where each cheque is, the payment receipt PDF.' },
  { id: 'crm-messages', team: 'Sales & CRM', title: 'Buyer emails, Dream Chat and documents', sub: 'The email bell, the Inbox, writing to the buyer and to Accounts, the papers.' },
  { id: 'crm-booking', team: 'Sales & CRM', title: 'Booking, approval and cancellation', sub: 'Booking a flat, Head CRM’s approval, More actions, cancelling and rebooking.' },
  { id: 'crm-letters', team: 'Sales & CRM', title: 'Demands and demand letters', sub: 'Construction stages, demand runs, one letter or many.' },
  { id: 'crm-full', team: 'Sales & CRM', title: 'The complete CRM course', sub: 'All six CRM videos in one, start to finish.' },
  { id: 'acc-full', team: 'Accounts', title: 'The complete Accounts course', sub: 'Receipts, payments with bills and TDS, daily bank balance, Bank Auto Check, PDC, reconciling, compliance, refunds, dashboard, reports, Tally and the CA page.' },
  { id: 'acc-todo', team: 'Accounts', title: 'The 9 am audit and your Daily To-Do', sub: 'What the audit checks, urgent lines, notes and the morning email.' },
  { id: 'bank', team: 'Accounts', title: 'Daily Bank Balance and Bank Auto Check', sub: 'Balances per bank, the difference column and the 3:10 pm statement check.' },
  { id: 'registers', team: 'Accounts', title: 'Receipts, Payments Out and PDC', sub: 'Working in the registers: filters, heads, payees and post-dated cheques.' },
  { id: 'audit', team: 'Accounts', title: 'Tally vs CRM and cancelled flats', sub: 'Flat by flat against the CRM, and refunds still to pay.' },
];
// soon: the video is not recorded yet, so the module is left off the Training page
module.exports = { MODULES: MODULES.filter((m) => !m.soon), ALL: MODULES };
