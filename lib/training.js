// Training videos: short screen recordings of the ERP (made on sample data, no real buyers), one per task.
// The files are in public/training/<id>.mp4; scripts/make-training.js records them again after the screens change.
const MODULES = [
  { id: 'start', team: 'Everyone', title: 'Getting started', sub: 'Signing in, the home page, a project’s departments and the side menu.' },
  { id: 'crm-full', team: 'Sales & CRM', title: 'The complete CRM course', sub: 'Booking a flat, receipts and bounced cheques, cancelling a flat the new way and rebooking it, demands, letters, price list, partners and the dashboard.' },
  { id: 'crm-todo', team: 'Sales & CRM', title: 'Your Daily To-Do (CRM)', sub: 'What the 9 am list shows, ticking lines off, adding and handing over tasks.' },
  { id: 'followups', team: 'Sales & CRM', title: 'Follow-up calls', sub: 'Who to call today, logging a call or WhatsApp, promises to pay.' },
  { id: 'bookings', team: 'Sales & CRM', title: 'Units, bookings and ledgers', sub: 'Finding a flat, its booking and the buyer’s statement of account.' },
  { id: 'letters', team: 'Sales & CRM', title: 'Demands and demand letters', sub: 'Construction stages, demand runs and sending the letters.' },
  { id: 'acc-full', team: 'Accounts', title: 'The complete Accounts course', sub: 'Receipts, payments with bills and TDS, daily bank balance, Bank Auto Check, PDC, reconciling, compliance, refunds, dashboard, reports, Tally and the CA page.' },
  { id: 'acc-todo', team: 'Accounts', title: 'The 9 am audit and your Daily To-Do', sub: 'What the audit checks, urgent lines, notes and the morning email.' },
  { id: 'bank', team: 'Accounts', title: 'Daily Bank Balance and Bank Auto Check', sub: 'Balances per bank, the difference column and the 3:10 pm statement check.' },
  { id: 'registers', team: 'Accounts', title: 'Receipts, Payments Out and PDC', sub: 'Working in the registers: filters, heads, payees and post-dated cheques.' },
  { id: 'audit', team: 'Accounts', title: 'Tally vs CRM and cancelled flats', sub: 'Flat by flat against the CRM, and refunds still to pay.' },
];
module.exports = { MODULES };
