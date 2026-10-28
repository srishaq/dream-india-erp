// Roles and what each may do. Approvals follow maker and checker: the person who enters
// something can never approve it (checked in the API, see canApprove in lib/auth.js).
// Approvers agreed with Rafi Sir (25 Oct 2026): Head CRM approves bookings and demands,
// Head Accounts approves receipts, Management approves cancellations and contractor bills.
const PERMS = {
  'users.manage':        'Add and manage logins',
  'masters.edit':        'Edit companies, projects, buildings and payment plans',
  'audit.view':          'See the audit log',
  'inventory.view':      'See units and their status',
  'inventory.edit':      'Add units and change unit status',
  'booking.create':      'Enter bookings',
  'booking.approve':     'Approve bookings',
  'stage.record':        'Record a construction stage as complete',
  'demand.raise':        'Prepare demand runs',
  'demand.approve':      'Approve demand runs',
  'receipt.enter':       'Enter receipts',
  'receipt.approve':     'Approve receipts',
  'cancellation.approve':'Approve cancellations and transfers',
  'ledger.view':         'See customer ledgers and dues',
  'buyer.kyc':           'See buyer PAN, Aadhaar and contact details in full',
  'price.manage':        'Set the price list',
  'brokerage.bill':      'Record channel partner brokerage bills',
  'brokerage.pay':       'Record brokerage paid to channel partners',
  'accounts.view':       'See the accounts registers and reports',
  'accounts.enter':      'Enter bank receipts, payments, daily balances, PDC, TDS and reconciling items',
  'accounts.manage':     'Set up banks and cash flow heads, import and correct the accounts',
  'ca.view':             'See the CA page: GST, TDS, RERA quarterly, cash flow statement and compliance',
  'mgmt.view':           'See the Management dashboard: key figures of every department',
};

const ROLES = {
  admin:         { label: 'Admin', perms: Object.keys(PERMS) },
  management:    { label: 'Management', perms: ['audit.view', 'inventory.view', 'ledger.view', 'cancellation.approve', 'booking.approve', 'demand.approve', 'receipt.approve', 'buyer.kyc', 'price.manage', 'accounts.view', 'ca.view', 'mgmt.view'] },
  head_crm:      { label: 'Head CRM', perms: ['inventory.view', 'inventory.edit', 'booking.create', 'receipt.enter', 'booking.approve', 'demand.raise', 'demand.approve', 'ledger.view', 'buyer.kyc', 'price.manage', 'brokerage.bill'] },
  crm:           { label: 'CRM Team', perms: ['inventory.view', 'booking.create', 'receipt.enter', 'demand.raise', 'ledger.view', 'buyer.kyc', 'brokerage.bill'] },
  sales:         { label: 'Sales', perms: ['inventory.view', 'booking.create'] },
  head_accounts: { label: 'Head Accounts', perms: ['inventory.view', 'receipt.enter', 'receipt.approve', 'ledger.view', 'audit.view', 'buyer.kyc', 'brokerage.pay', 'accounts.view', 'accounts.enter', 'accounts.manage', 'ca.view'] },
  accounts:      { label: 'Accounts Team', perms: ['inventory.view', 'receipt.enter', 'ledger.view', 'accounts.view', 'accounts.enter'] },
  ca:            { label: 'CA (auditor)', perms: ['accounts.view', 'ca.view'] },
  site_head:     { label: 'Site Head', perms: ['stage.record'] },
  site_engineer: { label: 'Site Engineer', perms: ['stage.record'] },
  site_team:     { label: 'Site Team', perms: ['stage.record'] },
  purchase_team: { label: 'Purchase Team', perms: [] },
  staff:         { label: 'Staff', perms: [] },
  consultant:    { label: 'Consultant (drawings only)', perms: [] },
  viewer:        { label: 'View only', perms: ['inventory.view', 'ledger.view'] },
};

const has = (u, perm) => !!u && !!ROLES[u.role] && ROLES[u.role].perms.includes(perm);

module.exports = { PERMS, ROLES, has };
