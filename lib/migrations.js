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
];
