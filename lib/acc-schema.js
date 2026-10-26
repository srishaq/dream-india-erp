// Accounts registers, column for column as on the "Dream Signature Master Accounts - FINAL" sheet.
// Each register is one tab staff type into; labels are the sheet's own column headings so the team sees the
// same thing. Columns marked calc are worked out by the ERP (the sheet's green columns) and are not stored.
//
// type: text | long | date | money | num | pct | yesno | list   (list: name of the dropdown, see LISTS)

const LISTS = {
  paymentHead: ['AV', 'GST', 'SDR', 'Unclassified'],
  payerType: ['Current buyer', 'Other / earlier buyer'],
  chequeStatus: ['Cleared', 'Bounced', 'Not found on statement'],
  itemStatus: ['Open', 'Resolved'],
  yesNo: ['Yes', 'No', 'Yes (other bank)'],
  reconCategory: ['Timing', 'Adjustment required', 'Investigation'],
  complianceStatus: ['Pending', 'Complied', 'Not applicable'],
  tenantStatus: ['Active', 'Vacated', 'On hold'],
  linkStatus: ['Linked', 'To confirm'],
  // filled from the database: bank (Receipts / Payments Out bank accounts), dailyBank (Daily Bank Balance banks),
  // receiptHead and paymentHead2 (cash flow heads on the CA Settings HEAD MAP), payee (names already used)
};

const C = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

const REGISTERS = {
  receipts: {
    table: 'acc_receipts', title: 'Receipts', prefix: 'BL', idLabel: 'Receipt ID', dateKey: 'txn_date',
    help: 'One row for every credit on the bank statement. Pick Cash Flow Head, Payment Head, Unit (A-1001 format), Payer Type and Cheque Status. If one cheque covers AV and GST (or SDR), enter one row per head with the split amounts and the same Reference. When a cheque bounces, change its Cheque Status to Bounced: never delete the row.',
    cols: [
      C('txn_date', 'Date', 'date', { required: true }), C('bank', 'Bank Account', 'list', { list: 'bank', required: true }), C('description', 'Description', 'long'),
      C('reference', 'Reference'), C('amount', 'Amount', 'money', { required: true }), C('head', 'Cash Flow Head', 'list', { list: 'receiptHead' }),
      C('payment_head', 'Payment Head', 'list', { list: 'paymentHead' }), C('ledger_head', 'Head in Cash Flow Ledger'), C('unit_no', 'Unit', 'text', { unit: true }),
      C('unit_tag', 'Unit Tag in Bank Ledger'), C('payer_name', 'Payer Name'), C('payer_type', 'Payer Type', 'list', { list: 'payerType' }),
      C('on_statement', 'On Bank Statement', 'list', { list: 'yesNo' }), C('cheque_status', 'Cheque Status', 'list', { list: 'chequeStatus' }),
      C('mapped_ids', 'Mapped CRM Payment IDs'), C('source', 'Source'), C('remark', 'Remark', 'long'),
    ],
  },
  payments: {
    table: 'acc_payments', title: 'Payments Out', prefix: 'PO', idLabel: 'Payment ID', dateKey: 'txn_date',
    help: 'One row for every debit on the bank statement, with its Cash Flow Head, Payee and the Unit when it is for a flat. When the head needs a bill, fill the bill columns on the same row.',
    cols: [
      C('txn_date', 'Date', 'date', { required: true }), C('bank', 'Bank Account', 'list', { list: 'bank', required: true }), C('description', 'Description', 'long'),
      C('reference', 'Reference'), C('amount', 'Amount', 'money', { required: true }), C('head', 'Cash Flow Head', 'list', { list: 'paymentHead2' }),
      C('unit_no', 'Unit', 'text', { unit: true }), C('on_statement', 'On Bank Statement', 'list', { list: 'yesNo' }), C('remark', 'Remark', 'long'), C('source', 'Source'),
      C('payee', 'Payee', 'list', { list: 'payee', free: true }), C('bill_ids', 'Bill ID(s)', 'text', { bill: true }), C('bill_date', 'Bill Date', 'date', { bill: true }),
      C('vendor_pan', 'Vendor PAN', 'text', { bill: true }), C('bill_no', 'Bill No.', 'text', { bill: true }), C('taxable_value', 'Taxable Value', 'money', { bill: true }),
      C('gst_on_bill', 'GST on Bill', 'money', { bill: true }), C('total_bill', 'Total Bill', 'money', { bill: true }), C('tds_section', 'TDS Section', 'text', { bill: true }),
      C('tds_rate', 'TDS Rate', 'pct', { bill: true }), C('tds_deducted', 'TDS Deducted', 'money', { bill: true }), C('net_payable', 'Net Payable', 'money', { bill: true }),
      C('tds_challan', 'TDS Challan No.', 'text', { bill: true }), C('tds_deposited_on', 'TDS Deposited On', 'date', { bill: true }), C('bill_note', 'Bill Note', 'long', { bill: true }),
      C('needs', 'Bill details still needed', 'text', { calc: true }), C('vendor_gstin', 'Vendor GSTIN', 'text', { bill: true }),
    ],
  },
  daily: {
    table: 'acc_daily_entries', title: 'Daily Bank Balance – daily entries', dateKey: 'entry_date',
    help: 'Every day, add one row per bank: date, bank, receipts, payments.',
    cols: [C('entry_date', 'Date', 'date', { required: true }), C('bank', 'Bank', 'list', { list: 'dailyBank', required: true }), C('receipts', 'Receipts', 'money'), C('payments', 'Payments', 'money'),
      C('remarks', 'Remarks', 'long'), C('entered_by', 'Entered by')],
  },
  pdc: {
    table: 'acc_pdc', title: 'PDC', dateKey: 'issued_on',
    help: 'Add one row for every post-dated cheque the moment it is given.',
    cols: [C('issued_on', 'Date', 'date', { required: true }), C('issued_to', 'Cheque issued to', 'text', { required: true }), C('amount', 'Amount', 'money', { required: true }),
      C('bank', 'Bank', 'list', { list: 'bank' }), C('due_date', 'PDC due date', 'date', { required: true }), C('cheque_no', 'Cheque No. (optional)'),
      C('days', 'Days to due date', 'num', { calc: true }), C('state', 'Status', 'text', { calc: true }), C('reminder48_on', '48-hour reminder sent', 'date'), C('reminder24_on', '24-hour reminder sent', 'date')],
  },
  tds: {
    table: 'acc_tds_entries', title: 'TDS Tracker – TDS entries', prefix: 'TDS', idLabel: 'Entry ID', idWidth: 4, dateKey: 'paid_on',
    help: 'One row for every TDS challan or Form 16B a customer gives us. Over the whole project the TDS due is 1% of the agreement value.',
    cols: [C('paid_on', 'TDS Paid On', 'date', { required: true }), C('unit_no', 'Unit', 'text', { unit: true, required: true }), C('customer', 'Customer'),
      C('demand', 'Demand / Instalment'), C('demand_amount', 'Demand Amount', 'money'), C('tds_amount', 'TDS Amount', 'money', { required: true }),
      C('challan_no', 'Challan / Acknowledgement No.'), C('paid_from', 'Paid From (Bank)'), C('form16b', 'Form 16B Received?', 'list', { list: 'yesNo' }),
      C('source', 'Source'), C('remark', 'Remark', 'long'), C('cert_link', 'Form 16B Certificate (link)'), C('cert_no', 'Form 16B Certificate No.'), C('cert_date', 'Certificate Date', 'date')],
  },
  recon: {
    table: 'acc_recon_items', title: 'Reconciling Items', dateKey: 'item_date',
    help: 'Anything on the statement you cannot match goes here. Timing = clears by itself in a few days. Adjustment required = an entry must be corrected. Investigation = cause unknown. Escalate to a supervisor over ₹1 lakh or 60 days, to management over ₹5 lakh or 90 days.',
    cols: [C('item_no', 'Item #', 'num'), C('bank', 'Account', 'list', { list: 'bank' }), C('side', 'Side'), C('item_date', 'Date', 'date'), C('description', 'Description', 'long'),
      C('amount', 'Amount', 'money'), C('age', 'Age (days)', 'num', { calc: true }), C('bucket', 'Age Bucket', 'text', { calc: true }), C('category', 'Category', 'list', { list: 'reconCategory' }),
      C('what', 'What it is', 'long'), C('action', 'Suggested Action', 'long'), C('status', 'Status', 'list', { list: 'itemStatus' }), C('owner', 'Owner'),
      C('resolution', 'Resolution Note', 'long'), C('escalation', 'Escalation', 'text', { calc: true }), C('ref', 'Ref')],
  },
  compliance: {
    table: 'acc_compliance', title: 'Compliance Calendar', dateKey: 'due_date',
    help: 'When a return is filed or a payment made, set Status to Complied and type the date and acknowledgement or challan number.',
    cols: [C('compliance', 'Compliance', 'text', { required: true }), C('law', 'Law'), C('period', 'Period'), C('due_date', 'Due Date', 'date', { required: true }),
      C('status', 'Status', 'list', { list: 'complianceStatus' }), C('date_complied', 'Date Complied', 'date'), C('ack', 'Acknowledgement / Challan No.'),
      C('responsible', 'Responsible'), C('remark', 'Remark', 'long'), C('late', 'Days Late', 'num', { calc: true })],
  },
  tenants: {
    table: 'acc_sra_tenants', title: 'SRA Tenants', dateKey: null,
    help: 'Goodluck SRA (Dream Signature): one row per survey no. Rent for 2026 and 2027 grows by the yearly increase; payments are counted from Tenant Rent Links. Balance: plus = still to pay, minus = paid extra.',
    cols: [C('survey_no', 'Survey No', 'num', { required: true }), C('name', 'Tenant name (rent list)', 'text', { required: true }), C('master_name', 'Name on Goodluck master list'),
      C('area', 'Area (sq ft)', 'num'), C('monthly_rent', 'Monthly rent 2025', 'money'), C('months', 'Months per year', 'num'), C('rent_2025', 'Rent 2025', 'money', { hint: 'Leave blank to use monthly rent × months; type it only when the agreed yearly rent is different' }),
      C('yearly_increase', 'Yearly increase', 'pct'), C('rent_2026', 'Rent 2026', 'money', { calc: true }), C('rent_2027', 'Rent 2027', 'money', { calc: true }),
      C('other_amount', 'Other agreed amount', 'money'), C('other_for', 'Other agreed amount: what for'), C('status', 'Status', 'list', { list: 'tenantStatus' }), C('list_remark', 'Rent list remark', 'long'),
      C('paid_2025', 'Paid for 2025', 'money', { calc: true }), C('paid_2026', 'Paid for 2026', 'money', { calc: true }), C('paid_2027', 'Paid for 2027', 'money', { calc: true }),
      C('paid_total', 'Total paid', 'money', { calc: true }), C('due_to_date', 'Due till date', 'money', { calc: true }), C('balance', 'Balance (+ to pay, - paid extra)', 'money', { calc: true }),
      C('position', 'Position', 'text', { calc: true }), C('n_payments', 'Payments', 'num', { calc: true }), C('accounts_remark', 'Accounts remark', 'long')],
  },
  rentLinks: {
    table: 'acc_rent_links', title: 'Tenant Rent Links', dateKey: null,
    help: 'Add one row for every payment under Cash Flow Head "Tenant Rent" in Payments Out: type the Payment ID and the Survey No. One cheque for two survey nos: two rows with the same Payment ID, each with its split amount. Rent year: leave blank (Jan–Sep = that year, Oct–Dec = next year); type a year only for an advance paid early.',
    cols: [C('payment_ref', 'Payment ID', 'text', { required: true }), C('survey_no', 'Survey No', 'num', { required: true }), C('rent_year', 'Rent year (only if paid early)', 'num'),
      C('split_amount', 'Split amount (only if one cheque covers 2 survey nos)', 'money'), C('status', 'Status', 'list', { list: 'linkStatus' }), C('note', 'Note / question', 'long'),
      C('p_date', 'Date', 'date', { calc: true }), C('p_bank', 'Bank account', 'text', { calc: true }), C('p_desc', 'Bank description', 'text', { calc: true }),
      C('counted', 'Amount counted', 'money', { calc: true }), C('year_counted', 'Rent year counted', 'num', { calc: true }), C('checked', 'Accounts checked (Y/N)', 'list', { list: 'yesNo' }), C('checked_by', 'Checked by / remark')],
  },
};

module.exports = { REGISTERS, LISTS };
