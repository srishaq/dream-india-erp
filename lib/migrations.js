// Database structure, applied in order and exactly once each (recorded in schema_migrations).
// Never edit a migration that has run on the live database: add a new one instead.
module.exports = [
  {
    id: '001_foundation',
    sql: `
create table settings (
  key text primary key,
  value jsonb not null
);

create table companies (
  id serial primary key,
  code text not null unique,
  name text not null,
  pan text,
  gstin text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table projects (
  id serial primary key,
  code text not null unique,
  name text not null,
  company_id int not null references companies(id),
  location text,
  rera_no text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table buildings (
  id serial primary key,
  project_id int not null references projects(id),
  code text not null,
  name text not null,
  kind text not null default 'sale' check (kind in ('sale', 'rehab', 'commercial', 'other')),
  floors int,
  unique (project_id, code)
);

create table users (
  id serial primary key,
  username text not null unique,
  name text not null,
  role text not null,
  password_hash text not null,
  must_change boolean not null default false,
  disabled boolean not null default false,
  session_version int not null default 1,
  phone text,
  all_projects boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now()
);

create table user_projects (
  user_id int not null references users(id) on delete cascade,
  project_id int not null references projects(id) on delete cascade,
  primary key (user_id, project_id)
);

create table login_failures (
  username text not null,
  at timestamptz not null default now()
);
create index login_failures_recent on login_failures (username, at desc);

-- Every change to master data or money: who, when, what it was, what it became.
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id int references users(id),
  action text not null,
  entity text not null,
  entity_id text,
  project_id int references projects(id),
  before jsonb,
  after jsonb,
  note text
);
create index audit_log_entity on audit_log (entity, entity_id);
create index audit_log_at on audit_log (at desc);
`,
  },
  {
    id: '002_booking_to_collection',
    sql: `
-- Module 1: booking-to-collection. Amounts are numeric(14,2) rupees; nothing is ever deleted,
-- a wrong entry is reversed or cancelled with a reason.
create table units (
  id serial primary key,
  project_id int not null references projects(id),
  building_id int not null references buildings(id),
  unit_no text not null,
  floor int,
  typology text,
  carpet_sqm numeric(10,2),
  carpet_sqft numeric(10,2),
  category text not null default 'residential' check (category in ('residential', 'commercial', 'parking', 'other')),
  status text not null default 'available'
    check (status in ('available', 'blocked', 'booked', 'registered', 'held', 'refuge', 'rehab', 'society')),
  hold_note text,
  legacy_ref text,
  unique (project_id, unit_no)
);

create table payment_plans (
  id serial primary key,
  project_id int not null references projects(id),
  name text not null,
  active boolean not null default true,
  unique (project_id, name)
);

create table plan_stages (
  id serial primary key,
  plan_id int not null references payment_plans(id),
  seq int not null,
  name text not null,
  pct numeric(6,3) not null check (pct >= 0 and pct <= 100),
  construction_linked boolean not null default true,
  unique (plan_id, seq),
  unique (plan_id, name)
);

create table buyers (
  id serial primary key,
  name text not null,
  pan text,
  aadhaar text,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);

create table bookings (
  id serial primary key,
  unit_id int not null references units(id),
  plan_id int not null references payment_plans(id),
  booking_date date not null,
  agreement_value numeric(14,2) not null check (agreement_value > 0),
  gst_rate numeric(5,2) not null default 5,
  stamp_duty numeric(14,2),
  registration_fee numeric(14,2),
  agreement_date date,
  registration_date date,
  parking int not null default 0,
  funding text check (funding in ('self', 'loan')),
  loan_bank text,
  source text,
  cp_name text,
  brokerage numeric(14,2),
  rm_name text,
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'cancelled', 'transferred')),
  legacy_ref text,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  approved_by int references users(id),
  approved_at timestamptz
);
-- A unit can have only one live booking.
create unique index bookings_one_live on bookings (unit_id) where status in ('pending', 'active');

create table booking_applicants (
  booking_id int not null references bookings(id),
  seq int not null,
  buyer_id int not null references buyers(id),
  primary key (booking_id, seq)
);

-- Site records that a stage is complete for a building; CRM then raises demands for it.
create table stage_completions (
  id serial primary key,
  building_id int not null references buildings(id),
  stage_name text not null,
  completed_on date not null,
  certified_by text,
  recorded_by int references users(id),
  created_at timestamptz not null default now(),
  unique (building_id, stage_name)
);

create table demand_runs (
  id serial primary key,
  project_id int not null references projects(id),
  building_id int references buildings(id),
  stage_name text not null,
  demand_date date not null,
  due_date date not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  created_by int references users(id),
  created_at timestamptz not null default now(),
  approved_by int references users(id),
  approved_at timestamptz
);

create table demands (
  id serial primary key,
  booking_id int not null references bookings(id),
  run_id int references demand_runs(id),
  stage_name text not null,
  pct numeric(6,3) not null,
  demand_date date not null,
  due_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  gst numeric(14,2) not null default 0,
  status text not null default 'raised' check (status in ('raised', 'cancelled')),
  opening boolean not null default false,
  created_at timestamptz not null default now(),
  unique (booking_id, stage_name)
);

create table receipts (
  id serial primary key,
  project_id int not null references projects(id),
  booking_id int references bookings(id),
  received_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  mode text check (mode in ('bank', 'cheque', 'loan', 'tds', 'other')),
  bank text,
  instrument_no text,
  account_no text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'bounced', 'reversed')),
  opening boolean not null default false,
  note text,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  approved_by int references users(id),
  approved_at timestamptz
);
create index receipts_booking on receipts (booking_id);

-- How each receipt splits across heads; the parts must add up to the receipt.
create table receipt_splits (
  receipt_id int not null references receipts(id),
  head text not null check (head in ('av', 'gst', 'tds', 'stamp_duty', 'registration', 'other')),
  amount numeric(14,2) not null check (amount >= 0),
  primary key (receipt_id, head)
);
`,
  },
  {
    id: '003_seed_companies_and_signature',
    sql: `
insert into companies (code, name) values
  ('PRIME', 'Prime Realtors'),
  ('DIB', 'Dream India Builders'),
  ('APEX', 'Apex'),
  ('DIRLLP', 'Dream India Realty LLP');

insert into projects (code, name, company_id, location)
  select 'SIGNATURE', 'Dream Signature', id, 'Oshiwara, Mumbai' from companies where code = 'PRIME';

insert into buildings (project_id, code, name, kind)
  select p.id, b.code, b.name, b.kind from projects p,
  (values ('A', 'A Wing', 'sale'), ('B', 'B Wing', 'sale'), ('REHAB', 'Rehab Tower', 'rehab')) as b(code, name, kind)
  where p.code = 'SIGNATURE';

insert into payment_plans (project_id, name) select id, 'Construction linked plan' from projects where code = 'SIGNATURE';

insert into plan_stages (plan_id, seq, name, pct, construction_linked)
  select pp.id, s.seq, s.name, s.pct, s.linked from payment_plans pp join projects p on p.id = pp.project_id,
  (values
    (1, 'On Booking', 5, false),
    (2, 'On Registration', 5, false),
    (3, 'On Completion of Excavation', 10, true),
    (4, 'On Completion of Plinth', 10, true),
    (5, 'On Completion of 5th Slab', 5, true),
    (6, 'On Completion of 10th Slab', 5, true),
    (7, 'On Completion of 15th Slab', 5, true),
    (8, 'On Completion of 20th Slab', 5, true),
    (9, 'On Completion of 25th Slab', 5, true),
    (10, 'On Completion of 30th Slab', 5, true),
    (11, 'On Completion of 35th Slab', 5, true),
    (12, 'On Completion of Top Slab', 5, true),
    (13, 'On Overhead Water Tank', 10, true),
    (14, 'On Lift Meter Room', 10, true),
    (15, 'On Receipt of OC', 10, true)
  ) as s(seq, name, pct, linked)
  where p.code = 'SIGNATURE';
`,
  },
  {
    id: '004_collections_views',
    sql: `
alter table bookings
  add column cancel_reason text,
  add column cancel_requested_by int references users(id),
  add column cancel_requested_at timestamptz,
  add column cancelled_by int references users(id),
  add column cancelled_at timestamptz,
  add column sample boolean not null default false;
alter table receipts add column reverse_reason text;
alter table units add column sample boolean not null default false;

-- What each buyer owes, worked out the same way as the CRM sheet and the live portal:
-- balance due = agreement value x stage % demanded - (AV + TDS) received; GST is tracked separately.
create view booking_balances as
with d as (
  select booking_id,
         sum(amount) filter (where status = 'raised') as demanded,
         sum(gst) filter (where status = 'raised') as demanded_gst,
         sum(amount) filter (where status = 'raised' and due_date < current_date) as due_past,
         max(demand_date) filter (where status = 'raised') as last_demand
    from demands group by booking_id
), r as (
  select r.booking_id,
         sum(s.amount) filter (where s.head = 'av') as av,
         sum(s.amount) filter (where s.head = 'tds') as tds,
         sum(s.amount) filter (where s.head = 'gst') as gst,
         sum(s.amount) filter (where s.head in ('stamp_duty', 'registration')) as sdr,
         max(r.received_on) as last_receipt
    from receipts r join receipt_splits s on s.receipt_id = r.id
   where r.status = 'approved' group by r.booking_id
)
select b.id as booking_id, b.unit_id, b.agreement_value, b.status,
       coalesce(d.demanded, 0) as demanded,
       coalesce(d.demanded_gst, 0) as demanded_gst,
       coalesce(d.due_past, 0) as due_past,
       coalesce(r.av, 0) as received_av,
       coalesce(r.tds, 0) as received_tds,
       coalesce(r.gst, 0) as received_gst,
       coalesce(r.sdr, 0) as received_sdr,
       coalesce(r.av, 0) + coalesce(r.tds, 0) as credit_av,
       greatest(coalesce(d.demanded, 0) - coalesce(r.av, 0) - coalesce(r.tds, 0), 0) as outstanding,
       greatest(coalesce(d.due_past, 0) - coalesce(r.av, 0) - coalesce(r.tds, 0), 0) as overdue,
       greatest(coalesce(d.demanded_gst, 0) - coalesce(r.gst, 0), 0) as gst_outstanding,
       greatest(coalesce(r.av, 0) + coalesce(r.tds, 0) - coalesce(d.demanded, 0), 0) as advance,
       d.last_demand, r.last_receipt
  from bookings b left join d on d.booking_id = b.id left join r on r.booking_id = b.id;
`,
  },
  {
    id: '005_letters_and_followups',
    sql: `
-- Every demand letter or reminder prepared for a buyer, with the figures it showed and how it was sent.
create table demand_letters (
  id serial primary key,
  booking_id int not null references bookings(id),
  letter_type text not null check (letter_type in ('Demand Letter', 'Reminder I', 'Reminder II', 'Demand Letter with Delay Charges')),
  stage_words text not null,
  cum_pct numeric(6,3) not null,
  invoice_date date not null,
  letter_date date not null,
  due_date date not null,
  figures jsonb not null,
  sent_via text check (sent_via in ('email', 'courier', 'whatsapp')),
  sent_to text,
  sent_at timestamptz,
  sent_by int references users(id),
  send_error text,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create index demand_letters_booking on demand_letters (booking_id, created_at desc);

-- Collections follow-up log: calls, WhatsApps, visits, promises to pay, next follow-up date.
create table follow_ups (
  id serial primary key,
  booking_id int not null references bookings(id),
  kind text not null check (kind in ('Call', 'WhatsApp', 'Email', 'Visit', 'Note')),
  outcome text not null,
  note text,
  promise_date date,
  promise_amount numeric(14,2),
  next_date date,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create index follow_ups_booking on follow_ups (booking_id, created_at desc);

-- The CRM team's letters give buyers 7 days to pay.
insert into settings (key, value) values ('days_to_pay', '7') on conflict (key) do nothing;
`,
  },
  {
    id: '006_import',
    sql: `
-- One record per import from the CRM master sheet, and every item it flagged for the team to verify.
create table import_runs (
  id serial primary key,
  project_id int not null references projects(id),
  source text not null,
  summary jsonb not null,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create table import_issues (
  id serial primary key,
  run_id int references import_runs(id),
  project_id int not null references projects(id),
  unit_no text,
  booking_id int references bookings(id),
  kind text not null,
  severity text not null check (severity in ('money', 'data')),
  detail text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text,
  resolved_by int references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index import_issues_open on import_issues (project_id, status);
alter table units add column imported boolean not null default false;
alter table bookings add column imported boolean not null default false;
alter table buyers add column import_key text;
alter table receipts add column import_key text;
`,
  },
  {
    id: '007_dashboard_fields',
    sql: `
-- Fields the collections dashboard shows, carried over from the CRM master sheet.
alter table units add column sheet_status text;
alter table bookings
  add column crm_status text,              -- follow-up status the CRM team gives a buyer (Defaulter, Part Payment & PDC ...)
  add column registration_status text,     -- Done, Line up ...
  add column booking_form_date date,
  add column bank_noc_date date,
  add column sdr_paid numeric(14,2),       -- stamp duty and registration actually paid to the government
  add column brokerage_released boolean not null default false,
  add column market_value numeric(14,2),
  add column agreement_type text;

-- Lines of the RERA collection account statement: receipts, returned cheques and internal transfers.
-- The daily and monthly collection reports are worked out from these.
create table bank_entries (
  id serial primary key,
  project_id int not null references projects(id),
  value_date date not null,
  kind text not null check (kind in ('receipt', 'return', 'transfer', 'other')),
  amount numeric(14,2) not null,
  unit_no text,
  customer text,
  team text,
  mode text,
  description text,
  remarks text,
  imported boolean not null default false,
  created_at timestamptz not null default now()
);
create index bank_entries_day on bank_entries (project_id, value_date);
`,
  },
  {
    id: '008_sales_crm',
    sql: `
-- Price lists: what a unit costs, and the cost sheet worked out from it.
create table price_lists (
  id serial primary key,
  project_id int not null references projects(id),
  name text not null,
  effective_from date not null,
  base_rate numeric(12,2) not null check (base_rate > 0),         -- rupees per sq ft of carpet area
  floor_rise numeric(12,2) not null default 0,                     -- extra rupees per sq ft for each floor above floor_rise_from
  floor_rise_from int not null default 0,
  parking_price numeric(14,2) not null default 0,                  -- per parking space, part of the agreement value
  other_charges jsonb not null default '[]',                       -- [{name, amount}] collected outside the agreement value
  gst_rate numeric(5,2) not null default 5,
  stamp_duty_pct numeric(5,2) not null default 6,                  -- Mumbai: 5% + 1% metro cess
  stamp_duty_women_pct numeric(5,2) not null default 5,            -- 1% concession when a woman is the (first) buyer
  registration_fee numeric(14,2) not null default 30000,
  notes text,
  active boolean not null default true,
  created_by int references users(id),
  created_at timestamptz not null default now()
);

-- Brokerage owed to channel partners: their bill, and what Accounts has paid against it.
create table brokerage_entries (
  id serial primary key,
  booking_id int not null references bookings(id),
  kind text not null check (kind in ('bill', 'payment')),
  entry_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  note text,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create index brokerage_entries_booking on brokerage_entries (booking_id);

-- Dates the CRM team tracks per booking, and when the welcome email went out.
alter table bookings
  add column registration_appointment date,
  add column possession_date date,
  add column welcome_sent_at timestamptz,
  add column price_list_id int references price_lists(id);

insert into settings (key, value) values ('brokerage_rule', '{"afterRegistration": true, "minReceivedPct": 10}') on conflict (key) do nothing;
`,
  },
  {
    id: '009_accounts',
    sql: `
-- Accounts, the same registers and lists as the "Dream Signature Master Accounts - FINAL" sheet.
-- Bank accounts as written in the Bank Account column of Receipts and Payments Out.
create table acc_banks (
  id serial primary key,
  book text not null default 'signature',
  name text not null,
  account_no text,
  active boolean not null default true,
  unique (book, name)
);
-- Banks on the Daily Bank Balance tab, with the balance brought forward and the group they total under.
create table acc_daily_banks (
  id serial primary key,
  book text not null default 'signature',
  name text not null,
  account_no text,
  grp text not null default 'SIGNATURE',
  seq int not null default 0,
  bf_balance numeric(16,2) not null default 0,
  bf_date date,
  auto_from_statement boolean not null default false,
  ledger_bank text,               -- the matching Receipts / Payments Out bank account, when there is one
  active boolean not null default true,
  unique (book, name)
);
-- The balance the bank shows, typed in "Balance per Bank" for a date.
create table acc_bank_stated (
  id serial primary key,
  daily_bank_id int not null references acc_daily_banks(id),
  on_date date not null,
  balance numeric(16,2) not null,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  unique (daily_bank_id, on_date)
);
-- Cash flow heads: the HEAD MAP on CA Settings (and the Receipt Heads / Payment Heads lists).
create table acc_heads (
  id serial primary key,
  book text not null default 'signature',
  side text not null check (side in ('receipt', 'payment')),
  name text not null,
  section text,
  indirect_line text,
  tds_section text,
  tds_rate numeric(8,4),
  category text,
  note text,
  needs_bill boolean not null default false,
  payee_type text,
  active boolean not null default true,
  unique (book, side, name)
);
create table acc_settings (
  book text not null default 'signature',
  key text not null,
  value text,
  primary key (book, key)
);

-- Register columns the team must fill are checked when a row is entered in the ERP; the database accepts a blank,
-- because the sheet has some old rows with gaps and they are imported exactly as they are.
create table acc_receipts (
  id serial primary key,
  book text not null default 'signature',
  ref_id text,
  txn_date date,
  bank text,
  description text,
  reference text,
  amount numeric(16,2),
  head text,
  payment_head text,
  ledger_head text,
  unit_no text,
  unit_tag text,
  payer_name text,
  payer_type text,
  on_statement text,
  cheque_status text,
  mapped_ids text,
  source text,
  remark text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create unique index acc_receipts_ref on acc_receipts (book, ref_id) where ref_id is not null;
create index acc_receipts_date on acc_receipts (book, txn_date);

create table acc_payments (
  id serial primary key,
  book text not null default 'signature',
  ref_id text,
  txn_date date,
  bank text,
  description text,
  reference text,
  amount numeric(16,2),
  head text,
  unit_no text,
  on_statement text,
  remark text,
  source text,
  payee text,
  bill_ids text,
  bill_date date,
  vendor_pan text,
  bill_no text,
  taxable_value numeric(16,2),
  gst_on_bill numeric(16,2),
  total_bill numeric(16,2),
  tds_section text,
  tds_rate numeric(8,4),
  tds_deducted numeric(16,2),
  net_payable numeric(16,2),
  tds_challan text,
  tds_deposited_on date,
  bill_note text,
  vendor_gstin text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create unique index acc_payments_ref on acc_payments (book, ref_id) where ref_id is not null;
create index acc_payments_date on acc_payments (book, txn_date);

create table acc_daily_entries (
  id serial primary key,
  book text not null default 'signature',
  entry_date date,
  bank text,
  receipts numeric(16,2),
  payments numeric(16,2),
  remarks text,
  entered_by text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create index acc_daily_entries_date on acc_daily_entries (book, entry_date);

create table acc_pdc (
  id serial primary key,
  book text not null default 'signature',
  issued_on date,
  issued_to text,
  amount numeric(16,2),
  bank text,
  due_date date,
  cheque_no text,
  reminder48_on date,
  reminder24_on date,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create index acc_pdc_date on acc_pdc (book, issued_on);

create table acc_tds_entries (
  id serial primary key,
  book text not null default 'signature',
  ref_id text,
  paid_on date,
  unit_no text,
  customer text,
  demand text,
  demand_amount numeric(16,2),
  tds_amount numeric(16,2),
  challan_no text,
  paid_from text,
  form16b text,
  source text,
  remark text,
  cert_link text,
  cert_no text,
  cert_date date,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create unique index acc_tds_entries_ref on acc_tds_entries (book, ref_id) where ref_id is not null;
create index acc_tds_entries_date on acc_tds_entries (book, paid_on);

create table acc_recon_items (
  id serial primary key,
  book text not null default 'signature',
  item_no numeric(14,2),
  bank text,
  side text,
  item_date date,
  description text,
  amount numeric(16,2),
  category text,
  what text,
  action text,
  status text,
  owner text,
  resolution text,
  ref text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create index acc_recon_items_date on acc_recon_items (book, item_date);

create table acc_compliance (
  id serial primary key,
  book text not null default 'signature',
  compliance text,
  law text,
  period text,
  due_date date,
  status text,
  date_complied date,
  ack text,
  responsible text,
  remark text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create index acc_compliance_date on acc_compliance (book, due_date);

create table acc_sra_tenants (
  id serial primary key,
  book text not null default 'signature',
  survey_no numeric(14,2),
  name text,
  master_name text,
  area numeric(14,2),
  monthly_rent numeric(16,2),
  months numeric(14,2),
  rent_2025 numeric(16,2),
  yearly_increase numeric(8,4),
  other_amount numeric(16,2),
  other_for text,
  status text,
  list_remark text,
  accounts_remark text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);

create table acc_rent_links (
  id serial primary key,
  book text not null default 'signature',
  payment_ref text,
  survey_no numeric(14,2),
  rent_year numeric(14,2),
  split_amount numeric(16,2),
  status text,
  note text,
  checked text,
  checked_by text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);

`,
  },
  {
    id: '010_bank_auto_pdc_ca',
    sql: `
-- Every run of the bank statement check (3:10 pm or an upload): what was read, added and what differs.
create table acc_stmt_runs (
  id serial primary key,
  book text not null default 'signature',
  run_at timestamptz not null default now(),
  run_date date not null,
  trigger text not null check (trigger in ('schedule', 'upload', 'drive')),
  user_id int references users(id),
  ok boolean not null default true,
  error text,
  files jsonb not null default '[]',
  banks jsonb not null default '[]',
  added jsonb not null default '{}',
  added_rows jsonb not null default '[]',
  updated int not null default 0,
  daily int not null default 0,
  differences jsonb not null default '[]',
  tagging jsonb not null default '[]'
);
create index acc_stmt_runs_at on acc_stmt_runs (book, run_at desc);

-- PDC reminder emails sent (one row per cheque and reminder).
create table acc_pdc_mail (
  id serial primary key,
  pdc_id int not null references acc_pdc(id) on delete cascade,
  kind text not null check (kind in ('48h', '24h')),
  sent_at timestamptz not null default now(),
  sent_to text not null,
  test boolean not null default true,
  unique (pdc_id, kind)
);

insert into acc_settings (book, key, value) values
  ('signature', 'statement_start', '2026-10-01'),
  ('signature', 'statement_folders', '1JpF8E-vdU0Av4XoVy5CIqR_DqzcDlVEA,1U9OarXwdngsDa8ofUe8lcTbhhSyXGkCV,1PZJlDeBfl7wA6UpZEqGiYevykmURiTs5'),
  ('signature', 'pdc_to', 'accounts.prime@dreamindiagroup.com'),
  ('signature', 'pdc_cc', 'mohhammadmubeen@gmail.com'),
  ('signature', 'ca_gst_rate', '0.05'),
  ('signature', 'ca_rera_account', 'Yes RERA Collection 100% (0700)'),
  ('signature', 'ca_rera_opened', '2026-01-22'),
  ('signature', 'ca_refund_head', 'Flat - Cancelled Refunded'),
  ('signature', 'ca_customer_tds_rate', '0.01')
on conflict do nothing;
update acc_daily_banks set ledger_bank = v.l from (values
  ('PRIME HDFC', 'Prime HDFC (8650)'), ('PRIME HDFC MISC', 'Prime HDFC Misc'), ('PRIME RERA COLLECTION 100%', 'Yes RERA Collection 100% (0700)'),
  ('PRIME GST', 'Yes GST (0131)'), ('PRIME 111 SDR', 'Yes 111 / SDR (0111)'), ('PRIME RERA 30%', 'Yes RERA 30% (0501)'), ('PRIME RERA 70%', 'Yes RERA Collection 70% (0800)')
) as v(n, l) where acc_daily_banks.name = v.n and acc_daily_banks.ledger_bank is null;
`,
  },
  {
    id: '011_compare_runs',
    sql: `
alter table acc_stmt_runs drop constraint if exists acc_stmt_runs_trigger_check;
alter table acc_stmt_runs add constraint acc_stmt_runs_trigger_check check (trigger in ('schedule', 'upload', 'drive', 'compare'));
alter table acc_stmt_runs add column if not exists compare_from date;
`,
  },
  {
    id: '012_cancelled_flats',
    sql: `
-- Cancelled flats and their refunds (the accounts team's refund list).
create table acc_cancellations (
  id serial primary key,
  book text not null default 'signature',
  cancel_date date,
  booking_date date,
  unit_no text,
  client text,
  typology text,
  area numeric(10,2),
  cp text,
  closing_manager text,
  final_av numeric(16,2),
  received numeric(16,2),
  refund_rtgs numeric(16,2),
  refund_white numeric(16,2),
  refund_status text,
  remark text,
  imported boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create index acc_cancellations_unit on acc_cancellations (book, unit_no);
`,
  },
  {
    id: '013_daily_tasks_training',
    sql: `
-- Daily To-Do of the CRM and Accounts teams: what the 9 am audit found (source 'audit', one row per finding per day)
-- and tasks people add for themselves or a colleague (source 'own', carried forward until done).
create table daily_tasks (
  id serial primary key,
  dept text not null check (dept in ('crm', 'accounts')),
  task_date date not null,
  source text not null check (source in ('audit', 'own')),
  key text,
  title text not null,
  detail text,
  link text,
  count int,
  priority text not null default 'normal' check (priority in ('high', 'normal')),
  since date,
  assigned_to int references users(id),
  created_by int references users(id),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by int references users(id),
  done_note text,
  cleared boolean not null default false
);
create unique index daily_tasks_key on daily_tasks (dept, task_date, key) where key is not null;
create index daily_tasks_day on daily_tasks (dept, task_date);
create table daily_audit_runs (
  id serial primary key,
  dept text not null check (dept in ('crm', 'accounts')),
  run_date date not null,
  run_at timestamptz not null default now(),
  trigger text not null check (trigger in ('schedule', 'manual', 'open')),
  run_by int references users(id),
  found int not null default 0,
  mail jsonb,
  error text
);
create index daily_audit_runs_day on daily_audit_runs (dept, run_date);
-- Training videos each person has watched.
create table training_progress (
  user_id int not null references users(id),
  module text not null,
  watched_at timestamptz not null default now(),
  primary key (user_id, module)
);
`,
  },
  {
    id: '014_cancellation_refunds',
    sql: `
-- A cancelled booking is never deleted: it stays with its buyers, receipts and refund, and the flat can be booked again.
-- Approving the cancellation writes the flat into Accounts' Cancelled flats register (linked by booking_id),
-- where Accounts records the refund; the booking page shows the refund status from there.
alter table bookings add column if not exists cancel_date date, add column if not exists cancel_charges numeric(14,2);
alter table acc_cancellations add column if not exists booking_id int references bookings(id),
  add column if not exists deduction numeric(16,2), add column if not exists refund_due numeric(16,2);
create unique index if not exists acc_cancellations_booking on acc_cancellations (booking_id) where booking_id is not null;
`,
  },
  {
    id: '015_portal_sections',
    sql: `
-- Sections brought over from the staff portal (Purchase, Construction / Site Office, Drawings, HR & Admin).
-- Their records are kept as they were on the portal: one JSON document per key and field (the portal's hash store).
create table portal_kv (
  key text not null,
  field text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (key, field)
);
-- What each login may open in those sections, as on the portal (role, per-department access, HR level, projects).
alter table users add column if not exists portal_role text, add column if not exists portal_access jsonb,
  add column if not exists portal_hr text, add column if not exists portal_projects jsonb, add column if not exists portal_extra jsonb;
`,
  },
  {
    id: '016_pdc_clearing',
    sql: `
-- A post-dated cheque is cleared when it is debited in the bank. The TDS on that payment must not be deposited before
-- the cheque has cleared (agreed 27 Oct 2026): the PDC register records the TDS and its challan date, and the ERP flags
-- any TDS paid on a cheque that has not cleared (or cleared only later).
alter table acc_pdc add column if not exists cheque_status text, add column if not exists cleared_on date,
  add column if not exists tds_amount numeric(16,2), add column if not exists tds_paid_on date, add column if not exists tds_challan text;
`,
  },
  {
    id: '017_customer_documents',
    sql: `
-- Scanned and signed customer documents (agreement, Index II, KYC, signed letters...) and SRA tenant agreements.
-- The files are kept in the company's Google Drive (one folder per flat or tenant); the ERP keeps the list,
-- who uploaded what and when, and serves the file only to logins allowed to see buyer documents.
-- A document is never deleted: "removed" hides it from the list and keeps who removed it and why.
create table customer_docs (
  id serial primary key,
  owner_kind text not null check (owner_kind in ('booking', 'tenant')),
  booking_id int references bookings(id),
  tenant_id int references acc_sra_tenants(id),
  label text,                              -- the flat (A-1001) or the tenant's survey no. and name, as it was at upload
  kind text not null,
  title text,
  file_name text not null,
  mime text not null,
  size bigint not null check (size > 0),
  drive_file_id text,
  upload_url text,
  received bigint not null default 0,
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'removed', 'failed')),
  uploaded_by int references users(id),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  removed_by int references users(id),
  removed_at timestamptz,
  remove_reason text,
  check ((owner_kind = 'booking' and booking_id is not null) or (owner_kind = 'tenant' and tenant_id is not null))
);
create index customer_docs_booking on customer_docs (booking_id) where status = 'ready';
create index customer_docs_tenant on customer_docs (tenant_id) where status = 'ready';
-- Drive folders the ERP made (root, per project, per flat, per tenant), so each is made once.
create table doc_folders (
  key text primary key,
  drive_id text not null,
  created_at timestamptz not null default now()
);
`,
  },
  {
    id: '018_communications',
    sql: `
-- Every message to and from a buyer, in one place: emails the ERP sends, buyers' replies read from the sending
-- mailbox, WhatsApp both ways. A message that cannot be matched to a booking waits in the Communication inbox
-- (booking_id null, status 'unmatched') until CRM links it or marks it as not about a buyer.
create table communications (
  id serial primary key,
  booking_id int references bookings(id),
  tenant_id int references acc_sra_tenants(id),
  channel text not null check (channel in ('email', 'whatsapp')),
  direction text not null check (direction in ('in', 'out')),
  from_addr text,
  to_addr text,
  subject text,
  body text,
  message_id text,
  in_reply_to text,
  provider_id text,
  sent_at timestamptz not null default now(),
  status text not null default 'matched' check (status in ('matched', 'unmatched', 'dismissed')),
  matched_by text,
  delivery text,
  attachments jsonb not null default '[]',
  kind text,
  sent_by int references users(id),
  read_by int references users(id),
  read_at timestamptz,
  linked_by int references users(id),
  created_at timestamptz not null default now()
);
create unique index communications_msgid on communications (channel, message_id) where message_id is not null;
create unique index communications_provider on communications (channel, provider_id) where provider_id is not null;
create index communications_booking on communications (booking_id, sent_at desc);
create index communications_inbox on communications (status, sent_at desc) where status = 'unmatched';
`,
  },
  {
    id: '019_email_salutation_designation',
    sql: `
-- Standard emails to buyers: "Dear Mr. / Mrs. …" (remembered per buyer once chosen) and the sender's signature
-- (name, designation, company) at the bottom.
alter table buyers add column if not exists salutation text;
alter table users add column if not exists designation text;
`,
  },
  {
    id: '020_crm_allocation',
    sql: `
-- The CRM looking after each flat: told when the buyer replies by email or WhatsApp (their own Daily To-Do, the
-- badge at the top of the ERP, and an email to their own address). Flats with nobody allocated go to Head CRM.
alter table bookings add column if not exists crm_user_id int references users(id);
alter table users add column if not exists email text;
alter table communications add column if not exists notified_at timestamptz, add column if not exists notified_to int references users(id);
`,
  },
  {
    id: '021_cheque_tracking_team_messages',
    sql: `
-- Each cheque the CRM enters is followed to the bank: given to Accounts, deposited, then found on the bank statement
-- (linked to the Accounts Receipts line) or returned. A cheque number + amount match approves the receipt by itself.
alter table receipts add column if not exists handed_on date, add column if not exists handed_by int references users(id),
  add column if not exists deposited_on date, add column if not exists deposited_by int references users(id),
  add column if not exists bank_status text, add column if not exists bank_on date, add column if not exists bank_ref text,
  add column if not exists bank_acc_id int, add column if not exists bank_match text, add column if not exists approved_note text;
create index if not exists receipts_cheque_open on receipts (received_on) where bank_status is null;

-- Messages between the CRM team and Accounts (optionally about one flat or one receipt). The ERP posts here too
-- (a cheque returned, the day's cheques cleared). A message asking for something stays open until the other team marks it done.
create table if not exists team_messages (
  id serial primary key,
  to_team text not null check (to_team in ('crm', 'accounts')),
  from_user int references users(id),
  booking_id int references bookings(id),
  receipt_id int references receipts(id),
  body text not null,
  kind text not null default 'msg',
  needs_action boolean not null default false,
  done_at timestamptz, done_by int references users(id),
  created_at timestamptz not null default now()
);
create index if not exists team_messages_team on team_messages (to_team, id desc);
create index if not exists team_messages_booking on team_messages (booking_id) where booking_id is not null;
create table if not exists team_reads (user_id int primary key references users(id), last_id int not null default 0);
`,
  },
  {
    id: '022_development_charges',
    sql: `
-- Development charges (amenity and possession charges) collected outside the agreement value, from the
-- "Development C." column of the CRM sheet. Sale value = agreement value (which includes parking) + these.
alter table bookings add column if not exists dev_charges numeric(14,2);
`,
  },
  {
    id: '023_receipt_numbers_sdr_challans',
    sql: `
-- Payment receipts given to buyers: a number in order of issue (DS/2026-27/0001), when it was made and emailed.
alter table receipts add column if not exists receipt_no text, add column if not exists receipt_issued_at timestamptz,
  add column if not exists receipt_sent_at timestamptz;
create unique index if not exists receipts_receipt_no on receipts (receipt_no) where receipt_no is not null;

-- Stamp duty and registration challans, one per flat: a second one for the same flat is refused unless the reason is
-- given (a re-registration, a challan that failed), so the same duty is not paid twice.
create table if not exists sdr_challans (
  id serial primary key,
  project_id int not null references projects(id),
  booking_id int references bookings(id),
  unit_no text not null,
  kind text not null default 'stamp_duty' check (kind in ('stamp_duty', 'registration', 'both')),
  challan_no text,
  grn text,
  challan_date date,
  amount numeric(14,2) not null,
  paid_from text,
  status text not null default 'generated' check (status in ('generated', 'paid', 'used', 'cancelled', 'refund_claimed')),
  duplicate_reason text,
  note text,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create unique index if not exists sdr_challans_grn on sdr_challans (upper(grn)) where grn is not null and grn <> '';
create index if not exists sdr_challans_unit on sdr_challans (project_id, unit_no);
`,
  },
  {
    id: '024_channel_partner_ledger',
    sql: `
-- Channel partners as firms (one row per firm), chosen from a list at booking; brokerage as a % of the agreement value.
create table if not exists channel_partners (
  id serial primary key,
  name text not null,
  name_key text not null unique,
  contact_person text, phone text, email text, pan text, gstin text, rera_no text,
  default_pct numeric(6,3),
  active boolean not null default true,
  note text,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
alter table bookings add column if not exists cp_id int references channel_partners(id), add column if not exists brokerage_pct numeric(6,3);
-- The firm's ledger: bills received, pass-backs, payments (RTGS: they reduce the brokerage still owed). A payment
-- counts once someone other than the person who entered it has verified it against the bill and the ledger.
alter table brokerage_entries alter column booking_id drop not null;
alter table brokerage_entries add column if not exists cp_id int references channel_partners(id),
  add column if not exists verified_by int references users(id), add column if not exists verified_at timestamptz,
  add column if not exists cancelled_at timestamptz, add column if not exists cancelled_by int references users(id), add column if not exists cancel_reason text;
alter table brokerage_entries drop constraint if exists brokerage_entries_kind_check;
alter table brokerage_entries add constraint brokerage_entries_kind_check check (kind in ('bill', 'payment', 'pass_back'));
-- payments already on record (before this check existed) count as verified
update brokerage_entries set verified_at = created_at where kind = 'payment' and verified_at is null;
-- firms from the names already on the bookings (House Of Inani and House of Inani are one firm)
insert into channel_partners (name, name_key)
  select distinct on (k) n, k from (select regexp_replace(trim(cp_name), '\\s+', ' ', 'g') as n, lower(regexp_replace(regexp_replace(trim(cp_name), '\\s+', ' ', 'g'), '[.,]+$', '')) as k
    from bookings where coalesce(trim(cp_name), '') <> '' and lower(trim(cp_name)) not in ('na', 'n/a', '-', 'nil')) x
  order by k, n on conflict (name_key) do nothing;
update bookings b set cp_id = c.id from channel_partners c
  where b.cp_id is null and c.name_key = lower(regexp_replace(regexp_replace(trim(b.cp_name), '\\s+', ' ', 'g'), '[.,]+$', ''));
update bookings set brokerage_pct = round(brokerage / agreement_value * 100, 3) where brokerage_pct is null and brokerage > 0 and agreement_value > 0;
update brokerage_entries e set cp_id = b.cp_id from bookings b where b.id = e.booking_id and e.cp_id is null;
-- CP bills and papers in Google Drive, like customer documents
alter table customer_docs add column if not exists cp_id int references channel_partners(id);
alter table customer_docs drop constraint if exists customer_docs_owner_kind_check;
alter table customer_docs add constraint customer_docs_owner_kind_check check (owner_kind in ('booking', 'tenant', 'cp'));
alter table customer_docs drop constraint if exists customer_docs_check;
alter table customer_docs add constraint customer_docs_check check ((owner_kind = 'booking' and booking_id is not null) or (owner_kind = 'tenant' and tenant_id is not null) or (owner_kind = 'cp' and cp_id is not null));
`,
  },
  {
    id: '025_unit_transfers',
    sql: `
-- A buyer moving to another flat: CRM requests it, Head CRM approves. The old booking stays on record as
-- Transferred (linked to the new one); the new booking has the same buyers; the receipts move across.
alter table bookings add column if not exists transfer_to_unit_id int references units(id), add column if not exists transfer_av numeric(14,2),
  add column if not exists transfer_reason text, add column if not exists transfer_date date,
  add column if not exists transfer_requested_by int references users(id), add column if not exists transfer_requested_at timestamptz,
  add column if not exists transfer_move_receipts boolean not null default true,
  add column if not exists transferred_to int references bookings(id), add column if not exists transferred_from int references bookings(id);
alter table receipts add column if not exists moved_from_booking int references bookings(id);
`,
  },
  {
    id: '026_replies_waiting',
    sql: `
-- A buyer's email or WhatsApp that needs no answer (a thank-you, a receipt of a letter): closed by the CRM, so it is
-- not counted as waiting for our reply.
alter table communications add column if not exists reply_closed_at timestamptz, add column if not exists reply_closed_by int references users(id);
`,
  },
  {
    id: '027_cheque_desk',
    sql: `
-- Accounts' side of a cheque: received from the CRM (who has it), and which bank account it was deposited in.
alter table receipts add column if not exists acc_received_at timestamptz, add column if not exists acc_received_by int references users(id),
  add column if not exists deposit_bank text;
`,
  },
  {
    id: '028_process_steps',
    sql: `
-- Letters the ERP sent by itself: on demand-run approval ('run') and the payment reminders ('before' / 'after').
alter table demand_letters add column if not exists auto text;
-- One reminder of each kind per demand, so the morning job never sends the same reminder twice.
create table if not exists demand_reminders (
  demand_id int not null references demands(id),
  kind text not null check (kind in ('before', 'after')),
  letter_id int references demand_letters(id),
  result text,
  created_at timestamptz not null default now(),
  primary key (demand_id, kind)
);
-- Registration checklist: the CRM ticks "papers ready" (agreement draft, ID copies, photos) by hand.
alter table bookings add column if not exists reg_papers_at timestamptz, add column if not exists reg_papers_by int references users(id);
-- Once-a-period jobs (the CA's monthly pack): the key is e.g. 'ca-pack:2026-10'.
create table if not exists job_marks (key text primary key, done_at timestamptz not null default now(), info jsonb);
`,
  },
  {
    id: '029_tally_link',
    sql: `
-- The Tally link: when Tally's server confirmed it imported each receipt and payment (and under which voucher), so the
-- feed offers only what is new or changed since.
alter table acc_receipts add column if not exists tally_at timestamptz, add column if not exists tally_note text;
alter table acc_payments add column if not exists tally_at timestamptz, add column if not exists tally_note text;
`,
  },
  {
    id: '030_tally_pulled',
    sql: `
-- When Tally last fetched each entry: Tally's confirmation marks the entry as of that moment, so an edit made between
-- the fetch and the confirmation is sent again.
alter table acc_receipts add column if not exists tally_pulled_at timestamptz;
alter table acc_payments add column if not exists tally_pulled_at timestamptz;
`,
  },
  {
    id: '031_marketing',
    sql: `
-- Marketing & social media, company-wide or by project (project_id null = the company as a whole).
create table if not exists mkt_posts (
  id serial primary key,
  project_id int references projects(id),
  title text not null,
  kind text not null default 'post',
  channels text[] not null default '{}',
  publish_at timestamptz,
  status text not null default 'draft' check (status in ('idea', 'draft', 'review', 'approved', 'scheduled', 'published')),
  caption text, canva_url text, asset_url text, post_url text, note text,
  campaign_id int,
  created_by int references users(id), created_at timestamptz not null default now(),
  updated_by int references users(id), updated_at timestamptz,
  approved_by int references users(id), approved_at timestamptz
);
create index if not exists mkt_posts_when on mkt_posts (publish_at);
create table if not exists mkt_campaigns (
  id serial primary key,
  project_id int references projects(id),
  name text not null, channel text, start_on date, end_on date,
  budget numeric(14,2), spent numeric(14,2), visits int, note text,
  status text not null default 'active' check (status in ('planned', 'active', 'done')),
  created_by int references users(id), created_at timestamptz not null default now(), updated_at timestamptz
);
create table if not exists mkt_leads (
  id serial primary key,
  project_id int references projects(id),
  name text, phone text, email text,
  source text not null default 'other',
  campaign_id int references mkt_campaigns(id),
  status text not null default 'new' check (status in ('new', 'contacted', 'visit', 'booked', 'lost')),
  assigned_to int references users(id), next_date date, note text, ext_id text,
  created_by int references users(id), created_at timestamptz not null default now(), updated_at timestamptz
);
create unique index if not exists mkt_leads_ext on mkt_leads (ext_id) where ext_id is not null;
create index if not exists mkt_leads_phone on mkt_leads (phone);
-- daily figures per social network (followers, views, reach, posts, interactions, gained), from Metricool or typed in
create table if not exists mkt_stats (
  network text not null, day date not null,
  metrics jsonb not null default '{}', source text not null default 'metricool', updated_at timestamptz not null default now(),
  primary key (network, day)
);
create table if not exists mkt_tasks (
  id serial primary key,
  project_id int references projects(id),
  title text not null, due date, assigned_to int references users(id),
  done_at timestamptz, done_by int references users(id),
  created_by int references users(id), created_at timestamptz not null default now()
);
`,
  },
  {
    id: '032_social_direct',
    sql: `
-- Instagram, Facebook, Meta Ads and YouTube connected to the ERP directly (no Metricool).
alter table mkt_campaigns add column if not exists ext_id text;
alter table mkt_campaigns add column if not exists source text not null default 'manual';
alter table mkt_campaigns add column if not exists objective text;
alter table mkt_campaigns add column if not exists ext_status text;
alter table mkt_campaigns add column if not exists account text;
alter table mkt_campaigns add column if not exists impressions bigint;
alter table mkt_campaigns add column if not exists reach bigint;
alter table mkt_campaigns add column if not exists clicks bigint;
alter table mkt_campaigns add column if not exists ad_leads int;
alter table mkt_campaigns add column if not exists messages int;
alter table mkt_campaigns add column if not exists video_views bigint;
alter table mkt_campaigns add column if not exists synced_at timestamptz;
create unique index if not exists mkt_campaigns_ext on mkt_campaigns (ext_id) where ext_id is not null;
-- each ad campaign month by month
create table if not exists mkt_campaign_months (
  campaign_id int not null references mkt_campaigns(id) on delete cascade, month date not null,
  spend numeric(14,2) not null default 0, impressions bigint not null default 0, reach bigint not null default 0, clicks bigint not null default 0,
  leads int not null default 0, messages int not null default 0, video_views bigint not null default 0,
  primary key (campaign_id, month)
);
-- every post, reel and video with its figures (for top posts and the reports)
create table if not exists mkt_media (
  network text not null, ext_id text not null, account text,
  posted_at timestamptz, kind text, caption text, permalink text, thumb text,
  likes int, comments int, shares int, saves int, views bigint, reach bigint,
  updated_at timestamptz not null default now(),
  primary key (network, ext_id)
);
create index if not exists mkt_media_when on mkt_media (posted_at);
-- each network's figures month by month (12 months and more)
create table if not exists mkt_stats_month (
  network text not null, month date not null, metrics jsonb not null default '{}', updated_at timestamptz not null default now(),
  primary key (network, month)
);
alter table mkt_stats alter column source set default 'direct';
`,
  },
  {
    id: '033_rupali_marketing',
    sql: `
-- Rupali Gadkar runs social media: her staff login (made from the HR upload) opens Marketing & social media.
-- Only if exactly one login is hers and it is a plain staff login; her HR "My details" stays as it is (portal role).
update users set role = 'marketing', portal_role = coalesce(portal_role, 'staff'), session_version = session_version + 1
 where name ilike 'rupali%' and role in ('staff', 'viewer') and not disabled
   and (select count(*) from users where name ilike 'rupali%' and not disabled) = 1;
`,
  },
  {
    id: '034_telemarketing',
    sql: `
-- Partner & Telemarketing. Channel partner firms sign up on the partner portal (/partner) with a username and
-- password, verify their mobile by OTP and get a CP ID (DI-CP-0001). The firm row is the same one the bookings and
-- the brokerage ledger use, so a booking credited to a firm is credited to its CP ID.
alter table channel_partners add column if not exists cp_code text unique,
  add column if not exists username text unique, add column if not exists pw_hash text,
  add column if not exists office_address text, add column if not exists office_area text,
  add column if not exists designation text, add column if not exists alt_phone text,
  add column if not exists callers_in_team int, add column if not exists portal_status text,
  add column if not exists mobile_verified_at timestamptz, add column if not exists registered_at timestamptz,
  add column if not exists reviewed_by int references users(id), add column if not exists reviewed_at timestamptz,
  add column if not exists failed_logins int not null default 0, add column if not exists locked_until timestamptz;
alter table channel_partners drop constraint if exists channel_partners_portal_status_check;
alter table channel_partners add constraint channel_partners_portal_status_check check (portal_status is null or portal_status in ('pending', 'approved', 'rejected', 'blocked'));
create sequence if not exists cp_code_seq;

-- Launches partners upload client lists for (a project may not be in the ERP yet).
create table if not exists tm_projects (
  id serial primary key,
  name text not null, location text, rera_no text,
  project_id int references projects(id),
  status text not null default 'open' check (status in ('open', 'calling', 'closed')),
  history boolean not null default false,
  upload_until date, notes text,
  created_by int references users(id), created_at timestamptz not null default now()
);
insert into tm_projects (name, location, status, history, notes)
  select 'Dream Signature, Jogeshwari (telecalling)', 'Jogeshwari', 'closed', true, 'Numbers called for Dream Signature, 2025-26'
  where not exists (select 1 from tm_projects where history);

create table if not exists tm_callers (
  id serial primary key, name text not null, mobile text,
  daily_rate numeric(10,2) not null default 0, active boolean not null default true,
  joined_on date not null default current_date, created_at timestamptz not null default now()
);

-- Call sheets: printed for a caller, outcomes written on paper, then typed in.
create table if not exists tm_sheets (
  id serial primary key, sheet_date date not null, caller_id int not null references tm_callers(id),
  tm_project_id int not null references tm_projects(id), leads int not null default 0,
  status text not null default 'out' check (status in ('out', 'entered', 'cancelled')),
  created_by int references users(id), created_at timestamptz not null default now(),
  entered_by int references users(id), entered_at timestamptz
);

-- Every number: uploaded by a partner (owned until owner_until), or from an earlier project.
create table if not exists tm_leads (
  id bigserial primary key,
  mobile text not null, name text, config text, locality text, budget text, purpose text,
  tm_project_id int not null references tm_projects(id),
  cp_id int references channel_partners(id),
  source text not null check (source in ('partner', 'history')),
  uploaded_on date not null default current_date, owner_until date,
  status text not null default 'fresh',
  attempts int not null default 0, last_outcome int, last_called_on date, next_call_on date,
  caller_id int references tm_callers(id), sheet_id int references tm_sheets(id),
  remarks text, created_at timestamptz not null default now()
);
create index if not exists tm_leads_mobile on tm_leads (mobile);
create index if not exists tm_leads_project on tm_leads (tm_project_id, status);
create index if not exists tm_leads_cp on tm_leads (cp_id);
create index if not exists tm_leads_sheet on tm_leads (sheet_id);

create table if not exists tm_uploads (
  id serial primary key, cp_id int not null references channel_partners(id), tm_project_id int not null references tm_projects(id),
  file_name text, received int not null, accepted int not null, counts jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists tm_upload_issues (
  upload_id int not null references tm_uploads(id) on delete cascade, row_no int, name text, mobile text, reason text not null
);
create index if not exists tm_upload_issues_upload on tm_upload_issues (upload_id);

create table if not exists tm_outcomes (
  id bigserial primary key, lead_id bigint not null references tm_leads(id), sheet_id int references tm_sheets(id),
  caller_id int references tm_callers(id), tm_project_id int not null references tm_projects(id), cp_id int references channel_partners(id),
  call_date date not null, code int not null check (code between 1 and 8), remark text,
  entered_by int references users(id), entered_at timestamptz not null default now()
);
create index if not exists tm_outcomes_project on tm_outcomes (tm_project_id, call_date);

-- People who asked not to be called: no partner can upload them again.
create table if not exists tm_dnc (mobile text primary key, reason text, created_at timestamptz not null default now());

-- Partner portal sign-ins (separate from staff logins) and one-time codes.
create table if not exists cp_sessions (
  token_hash text primary key, cp_id int not null references channel_partners(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists cp_otps (
  id text primary key, purpose text not null, mobile text, payload jsonb not null default '{}',
  otp_hash text not null, tries int not null default 0, sent_to text,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index if not exists cp_otps_mobile on cp_otps (mobile, created_at);

insert into settings (key, value) values ('tm', '{"ownershipDays":90,"historyPolicy":"reject","autoApprove":false,"maxAttempts":3,"gapDays":2,"waOtpTemplate":"","waWelcomeTemplate":""}')
  on conflict (key) do nothing;
`,
  },
  {
    id: '035_tm_results',
    sql: `
-- A finished campaign's own telecalling sheet (e.g. Dream Signature 2025-26), kept row by row so every figure in
-- Reports can be opened to the rows behind it. Projects called through the ERP need none of this: their reports
-- come from the call sheets.
create table if not exists tm_sheet_rows (
  id bigserial primary key, tm_project_id int not null references tm_projects(id), row_no int not null,
  day date, caller text, caller_place text, cp_firm text, cp_phone text, sm text,
  client text, mobile text, last4 text, phone_kind text not null default 'invalid' check (phone_kind in ('full', 'masked', 'invalid')),
  config text, status text, remark text, visit_on date
);
create index if not exists tm_sheet_rows_project on tm_sheet_rows (tm_project_id, row_no);
create index if not exists tm_sheet_rows_mobile on tm_sheet_rows (mobile);
`,
  },
  {
    id: '036_mkt_designs',
    sql: `
-- The finished design of a post (exported from Canva: image, PDF or short video), kept with the post for approval.
create table if not exists mkt_post_files (
  id serial primary key, post_id int not null references mkt_posts(id) on delete cascade,
  name text not null, mime text not null, size int not null, data bytea not null,
  created_by int references users(id), created_at timestamptz not null default now()
);
create index if not exists mkt_post_files_post on mkt_post_files (post_id);
alter table mkt_posts add column if not exists review_note text, add column if not exists sent_at timestamptz, add column if not exists sent_by int references users(id);
`,
  },
  {
    id: '037_mkt_ivr',
    sql: `
-- Calls to the IVR number (Exotel and others), sent to the ERP by the IVR itself; each caller becomes a lead (source ivr).
create table if not exists mkt_ivr_calls (
  id serial primary key, sid text unique, caller text, ivr_number text, called_at timestamptz not null default now(),
  status text, duration int, recording_url text, digits text, project_id int references projects(id), lead_id int references mkt_leads(id),
  raw jsonb, created_at timestamptz not null default now()
);
create index if not exists mkt_ivr_calls_when on mkt_ivr_calls (called_at);
create index if not exists mkt_ivr_calls_caller on mkt_ivr_calls (caller);
`,
  },
];
