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
  {
    id: '038_mkt_campaign_days',
    sql: `
-- Each ad campaign day by day for the last weeks, so "last 30 days" spend and leads are exact (months are kept as before).
create table if not exists mkt_campaign_days (
  campaign_id int not null references mkt_campaigns(id) on delete cascade, day date not null,
  spend numeric(14,2) not null default 0, impressions bigint not null default 0, clicks bigint not null default 0,
  leads int not null default 0, messages int not null default 0,
  primary key (campaign_id, day)
);
create index if not exists mkt_campaign_days_day on mkt_campaign_days (day);
`,
  },
  {
    id: '039_mkt_campaign_plans',
    sql: `
-- A campaign planned by the marketing team: its brief, its designs (posts of the campaign) and its budget, each approved
-- by Management (in the ERP or from the email); approved designs go to the calendar and are posted on their dates.
alter table mkt_campaigns add column if not exists brief text, add column if not exists channels text[] not null default '{}',
  add column if not exists daily_budget numeric(14,2), add column if not exists monthly_budget numeric(14,2),
  add column if not exists plan_status text not null default 'draft',
  add column if not exists submitted_at timestamptz, add column if not exists submitted_by int references users(id),
  add column if not exists designs_ok_at timestamptz, add column if not exists designs_ok_by int references users(id),
  add column if not exists budget_ok_at timestamptz, add column if not exists budget_ok_by int references users(id),
  add column if not exists review_note text;
alter table mkt_posts add column if not exists publish_log jsonb not null default '{}', add column if not exists published_at timestamptz;
`,
  },
  {
    id: '040_mkt_results',
    sql: `
-- From rupees to bookings: every lead's way through (first call, site visit, booking), every rupee of marketing spend
-- (hoardings, newspaper, portals, events, agency… as well as Meta), Meta ads one by one, budget changes asked for and
-- approved, lead stages sent back to Meta, and the comments on our posts.
alter table mkt_leads add column if not exists sources text[] not null default '{}',
  add column if not exists utm jsonb, add column if not exists first_contact_at timestamptz,
  add column if not exists visit_at timestamptz, add column if not exists booked_at timestamptz,
  add column if not exists booking_id int references bookings(id), add column if not exists alerted_at timestamptz,
  add column if not exists welcomed_at timestamptz, add column if not exists lost_reason text, add column if not exists ad_name text;
update mkt_leads set sources = array[source] where sources = '{}';
update mkt_leads set first_contact_at = coalesce(updated_at, created_at) where first_contact_at is null and status <> 'new';
update mkt_leads set visit_at = coalesce(updated_at, created_at) where visit_at is null and status in ('visit', 'booked');
create table if not exists mkt_spend (
  id serial primary key, project_id int references projects(id), campaign_id int references mkt_campaigns(id) on delete set null,
  kind text not null default 'other', source text, vendor text, amount numeric(14,2) not null check (amount >= 0),
  spent_on date not null, until date, note text, file_name text, file_mime text, file_data bytea,
  created_by int references users(id), created_at timestamptz not null default now(), updated_at timestamptz
);
create index if not exists mkt_spend_on on mkt_spend (spent_on);
create table if not exists mkt_ads (
  id serial primary key, ext_id text not null unique, campaign_id int references mkt_campaigns(id) on delete cascade,
  name text, adset text, status text, thumb text, body text, created_time timestamptz, updated_at timestamptz not null default now()
);
create table if not exists mkt_ad_days (
  ad_id int not null references mkt_ads(id) on delete cascade, day date not null,
  spend numeric(14,2) not null default 0, impressions bigint not null default 0, reach bigint not null default 0, frequency numeric(8,3),
  clicks bigint not null default 0, leads int not null default 0, messages int not null default 0,
  primary key (ad_id, day)
);
create table if not exists mkt_changes (
  id serial primary key, campaign_id int not null references mkt_campaigns(id) on delete cascade,
  kind text not null check (kind in ('pause', 'resume', 'budget')), value numeric(14,2), reason text,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'rejected')),
  requested_by int references users(id), requested_at timestamptz not null default now(),
  decided_by int references users(id), decided_at timestamptz, result text
);
create table if not exists mkt_capi (
  id serial primary key, lead_id int not null references mkt_leads(id) on delete cascade, stage text not null,
  created_at timestamptz not null default now(), sent_at timestamptz, tries int not null default 0, error text,
  unique (lead_id, stage)
);
create table if not exists mkt_comments (
  network text not null, ext_id text not null, media_ext text, permalink text, author text, text text, at timestamptz,
  reply text, replied_at timestamptz, replied_by int references users(id), lead_id int references mkt_leads(id) on delete set null,
  done boolean not null default false, primary key (network, ext_id)
);
create index if not exists mkt_comments_at on mkt_comments (at);
alter table mkt_campaigns add column if not exists ext_daily_budget numeric(14,2), add column if not exists ext_lifetime_budget numeric(14,2);
alter table mkt_posts add column if not exists rera_on_design boolean not null default false;
`,
  },
  {
    id: '041_mkt_web',
    sql: `
-- The website's visits, sent by a small script on dreamindiarealty.com (no Google Analytics): each page view and each
-- click on call / WhatsApp, with where the visitor came from. No IP address or cookie is kept: a random visitor id
-- that the website keeps in the browser.
create table if not exists mkt_web_hits (
  id bigserial primary key, at timestamptz not null default now(), visitor text, session text, kind text not null default 'view',
  host text, path text, title text, referrer text, source text, medium text, campaign text, content text, term text,
  channel text, device text, label text
);
create index if not exists mkt_web_hits_at on mkt_web_hits (at);
create index if not exists mkt_web_hits_visitor on mkt_web_hits (visitor);
`,
  },
  {
    id: '042_mkt_plans',
    sql: `
-- Each project's marketing plan: which channels it uses (Meta ads, portals, newspaper, hoardings, telemarketing, partners…),
-- the budget of each, the phases (pre-launch, launch, sustenance), and Management's approval of the plan.
create table if not exists mkt_plans (
  scope text primary key, channels jsonb not null default '[]', phases jsonb not null default '[]', total_budget numeric(14,2), note text,
  status text not null default 'draft' check (status in ('draft', 'approved')), approved_by int references users(id), approved_at timestamptz,
  updated_by int references users(id), updated_at timestamptz not null default now()
);
-- Whose buyer it is, decided at the site visit: brought by a partner = the partner's; came on their own = Dream India's.
alter table mkt_leads add column if not exists owner_cp_id int references channel_partners(id), add column if not exists visit_via text, add column if not exists owner_set_at timestamptz;
-- A partner's papers for approval: PAN, GST, MahaRERA certificate, and the partner agreement (signed online, uploaded, or
-- brought to the office signed).
create table if not exists cp_docs (
  id serial primary key, cp_id int not null references channel_partners(id) on delete cascade, kind text not null check (kind in ('pan', 'gst', 'rera', 'agreement')),
  number text, file_name text, mime text, data bytea, how text, signed_name text, signed_at timestamptz, signed_from text, agreement_hash text,
  uploaded_at timestamptz not null default now(), received_by int references users(id)
);
create index if not exists cp_docs_cp on cp_docs (cp_id, kind);
`,
  },
  {
    id: '043_dream_chat',
    sql: `
-- Dream Chat for the whole company (WhatsApp-style, on phones): one-to-one chats, groups, department and project
-- channels kept in step with each login's role and projects, and an announcements channel only Management posts in.
-- Everything stays in our own database. A login that is switched off loses every chat at once.
create table if not exists chat_rooms (
  id serial primary key,
  kind text not null check (kind in ('dm', 'group', 'channel', 'announce')),
  name text, about text,
  auto_key text unique,                      -- 'announce', 'dept:crm', 'project:3' for the rooms the ERP keeps in step
  project_id int references projects(id),
  dm_key text unique,                        -- 'dm:<low id>:<high id>' so two people have one chat only
  created_by int references users(id),
  created_at timestamptz not null default now(),
  last_msg_id int not null default 0, last_at timestamptz not null default now(),
  archived boolean not null default false
);
create table if not exists chat_members (
  room_id int not null references chat_rooms(id) on delete cascade,
  user_id int not null references users(id),
  role text not null default 'member' check (role in ('admin', 'member')),
  auto boolean not null default false,       -- added by the ERP (role or project), removed by it when that changes
  joined_at timestamptz not null default now(),
  last_read int not null default 0, last_delivered int not null default 0,
  muted_until timestamptz, pinned boolean not null default false, hidden boolean not null default false,
  primary key (room_id, user_id)
);
create index if not exists chat_members_user on chat_members (user_id);
create table if not exists chat_files (
  id serial primary key,
  room_id int not null references chat_rooms(id) on delete cascade,
  user_id int references users(id),
  name text not null, mime text not null, size int not null, data bytea not null,
  width int, height int, seconds numeric(8,1),
  created_at timestamptz not null default now()
);
create table if not exists chat_messages (
  id serial primary key,
  room_id int not null references chat_rooms(id) on delete cascade,
  user_id int references users(id),           -- null: posted by the ERP itself
  kind text not null default 'text' check (kind in ('text', 'image', 'video', 'voice', 'file', 'system', 'card', 'poll')),
  body text not null default '',
  file_id int references chat_files(id),
  reply_to int references chat_messages(id), -- quoting a message (WhatsApp reply)
  thread_root int references chat_messages(id), -- a reply inside a thread (Slack), not shown in the main stream
  forwarded boolean not null default false,
  mentions int[] not null default '{}', mention_all boolean not null default false,
  card jsonb, booking_id int references bookings(id),
  edited_at timestamptz, deleted_at timestamptz, deleted_by int references users(id),
  created_at timestamptz not null default now(),
  touched_at timestamptz not null default now() -- moved on every edit, delete, reaction or pin, so open chats pick it up
);
create index if not exists chat_messages_room on chat_messages (room_id, id desc);
create index if not exists chat_messages_touched on chat_messages (room_id, touched_at);
create index if not exists chat_messages_thread on chat_messages (thread_root, id) where thread_root is not null;
create index if not exists chat_messages_search on chat_messages using gin (to_tsvector('simple', body));
create table if not exists chat_reactions (
  message_id int not null references chat_messages(id) on delete cascade,
  user_id int not null references users(id), emoji text not null,
  at timestamptz not null default now(), primary key (message_id, user_id)
);
-- A simple poll: the question and options are in card ({poll: true, options: [...], multi}); one row per vote.
create table if not exists chat_votes (
  message_id int not null references chat_messages(id) on delete cascade, user_id int not null references users(id),
  opt int not null, at timestamptz not null default now(), primary key (message_id, user_id, opt)
);
-- Voice notes written out in English (when ANTHROPIC_API_KEY is set).
alter table chat_files add column if not exists transcript text;
create table if not exists chat_stars (
  user_id int not null references users(id), message_id int not null references chat_messages(id) on delete cascade,
  at timestamptz not null default now(), primary key (user_id, message_id)
);
create table if not exists chat_pins (
  room_id int not null references chat_rooms(id) on delete cascade, message_id int not null references chat_messages(id) on delete cascade,
  by_user int references users(id), at timestamptz not null default now(), primary key (room_id, message_id)
);
-- Phones and computers that receive Dream Chat notifications (Web Push).
create table if not exists chat_push (
  id serial primary key, user_id int not null references users(id) on delete cascade,
  endpoint text not null unique, p256dh text not null, auth text not null, device text,
  created_at timestamptz not null default now(), last_ok timestamptz, fails int not null default 0
);
-- Status ("On site", "In a meeting", "On leave"), Do Not Disturb hours, last seen.
alter table users add column if not exists chat_status text, add column if not exists chat_status_until timestamptz,
  add column if not exists chat_dnd jsonb, add column if not exists chat_seen timestamptz;
`,
  },
  {
    id: '044_fix_stored_files',
    sql: `
-- Repair: until 31 Oct 2026 uploaded files (partner papers, marketing designs, ad invoices) were saved as JSON text
-- ({"type":"Buffer","data":[…]}) instead of the file itself, so they downloaded as unreadable text. The bytes are all
-- there: turn each one back into the real file.
create function pg_temp.unjson_buf(b bytea) returns bytea language sql immutable as $f$
  select case when b is null or substring(b from 1 for 17) <> convert_to('{"type":"Buffer",', 'UTF8') then b
    else (select coalesce(decode(string_agg(lpad(to_hex(x::int), 2, '0'), '' order by n), 'hex'), ''::bytea)
          from jsonb_array_elements_text(convert_from(b, 'UTF8')::jsonb -> 'data') with ordinality t(x, n)) end
$f$;
update cp_docs set data = pg_temp.unjson_buf(data) where substring(data from 1 for 17) = convert_to('{"type":"Buffer",', 'UTF8');
update mkt_post_files set data = pg_temp.unjson_buf(data), size = length(pg_temp.unjson_buf(data)) where substring(data from 1 for 17) = convert_to('{"type":"Buffer",', 'UTF8');
update mkt_spend set file_data = pg_temp.unjson_buf(file_data) where substring(file_data from 1 for 17) = convert_to('{"type":"Buffer",', 'UTF8');
`,
  },
  {
    id: '045_mkt_one_lead_per_phone',
    sql: `
-- Counters for the rate limits on the public links (website leads and visits, partner portal codes).
create table if not exists mkt_rate (key text not null, win timestamptz not null, n int not null default 0, primary key (key, win));
-- A post being posted right now (so two runs never post it twice).
alter table mkt_posts add column if not exists publishing_at timestamptz;
-- One phone number = one lead: leads that share a number are merged into the oldest one (sources joined, the furthest
-- stage kept, otherwise the latest status; the others' notes kept below), and from now on the database refuses a second.
create temp table mk_g as select phone, min(id) as keep from mkt_leads where phone is not null group by phone having count(*) > 1;
create temp table mk_d as select l.id, g.keep from mkt_leads l join mk_g g on g.phone = l.phone where l.id <> g.keep;
update mkt_ivr_calls c set lead_id = d.keep from mk_d d where c.lead_id = d.id;
update mkt_comments c set lead_id = d.keep from mk_d d where c.lead_id = d.id;
insert into mkt_capi (lead_id, stage, created_at, sent_at, tries, error)
  select d.keep, q.stage, q.created_at, q.sent_at, q.tries, q.error from mkt_capi q join mk_d d on d.id = q.lead_id
  on conflict (lead_id, stage) do nothing;
create temp table mk_m as
  select g.keep,
    array(select z.s from (select u.s, min(l2.id::numeric * 1000 + u.ord) as o from mkt_leads l2 cross join lateral unnest(array_append(l2.sources, l2.source)) with ordinality u(s, ord)
                            where l2.phone = g.phone group by u.s) z order by z.o) as sources,
    case when bool_or(l.status = 'booked') then 'booked' when bool_or(l.status = 'visit') then 'visit'
         else (array_agg(l.status order by coalesce(l.updated_at, l.created_at) desc, l.id desc))[1] end as status,
    (array_agg(l.name order by l.id) filter (where l.name is not null))[1] as name,
    (array_agg(l.email order by l.id) filter (where l.email is not null))[1] as email,
    (array_agg(l.project_id order by l.id) filter (where l.project_id is not null))[1] as project_id,
    (array_agg(l.campaign_id order by l.id) filter (where l.campaign_id is not null))[1] as campaign_id,
    (array_agg(l.assigned_to order by l.id) filter (where l.assigned_to is not null))[1] as assigned_to,
    (array_agg(l.booking_id order by l.id) filter (where l.booking_id is not null))[1] as booking_id,
    (array_agg(l.owner_cp_id order by l.owner_set_at desc nulls last, l.id) filter (where l.visit_via is not null))[1] as owner_cp_id,
    (array_agg(l.visit_via order by l.owner_set_at desc nulls last, l.id) filter (where l.visit_via is not null))[1] as visit_via,
    max(l.owner_set_at) as owner_set_at,
    (array_agg(l.ad_name order by l.id) filter (where l.ad_name is not null))[1] as ad_name,
    (array_agg(l.utm order by l.id) filter (where l.utm is not null))[1] as utm,
    (array_agg(l.lost_reason order by l.id desc) filter (where l.lost_reason is not null))[1] as lost_reason,
    (array_agg(l.ext_id order by l.id) filter (where l.ext_id is not null))[1] as ext_id,
    max(l.next_date) as next_date, min(l.created_at) as created_at, min(l.first_contact_at) as first_contact_at, min(l.visit_at) as visit_at,
    min(l.booked_at) as booked_at, min(l.welcomed_at) as welcomed_at, min(l.alerted_at) as alerted_at,
    string_agg(case when l.id = g.keep then l.note else concat('Merged in from lead #', l.id, ' (', l.source, ', came in ', to_char(l.created_at + interval '330 minutes', 'DD Mon YYYY'), ')',
      case when l.ext_id is not null then ' [' || l.ext_id || ']' end, case when l.note is not null then ': ' || l.note end) end, E'\\n' order by l.id) as note
  from mk_g g join mkt_leads l on l.phone = g.phone group by g.keep, g.phone;
delete from mkt_leads where id in (select id from mk_d);
update mkt_leads l set sources = m.sources, status = m.status, name = m.name, email = m.email, project_id = m.project_id, campaign_id = m.campaign_id, assigned_to = m.assigned_to,
    booking_id = m.booking_id, owner_cp_id = m.owner_cp_id, visit_via = m.visit_via, owner_set_at = m.owner_set_at, ad_name = m.ad_name, utm = m.utm, lost_reason = m.lost_reason,
    ext_id = m.ext_id, next_date = m.next_date, created_at = m.created_at, first_contact_at = m.first_contact_at, visit_at = m.visit_at, booked_at = m.booked_at,
    welcomed_at = m.welcomed_at, alerted_at = m.alerted_at, note = m.note, updated_at = now()
  from mk_m m where l.id = m.keep;
drop table mk_g, mk_d, mk_m;
create unique index if not exists mkt_leads_phone_one on mkt_leads (phone) where phone is not null;
`,
  },
  {
    id: '046_cp_invites_bills',
    sql: `
-- Firms already in the ERP (from the accounts sheet) are invited to the partner portal: a one-time link (only its
-- hash kept), valid 14 days. A duplicate firm can be merged into another: the merged row stays (inactive, merged_into)
-- and its spellings go on mapping to the kept firm (cp_name_aliases), so a later import does not split it again.
alter table channel_partners add column if not exists merged_into int references channel_partners(id),
  add column if not exists merged_at timestamptz, add column if not exists merged_by int references users(id),
  -- a reference or direct sale written in the partner column, not a channel partner: never merged or invited
  add column if not exists is_reference boolean not null default false;
create table if not exists cp_name_aliases (
  name_key text primary key, cp_id int not null references channel_partners(id), created_at timestamptz not null default now()
);
create table if not exists cp_invites (
  id serial primary key, cp_id int not null references channel_partners(id) on delete cascade,
  token_hash text not null unique, mobile text, email text, sent_to text,
  expires_at timestamptz not null, used_at timestamptz, revoked_at timestamptz,
  created_by int references users(id), created_at timestamptz not null default now()
);
create index if not exists cp_invites_cp on cp_invites (cp_id);
-- Merges are asked for by Accounts (the firms that are one, and the name to keep) and approved by the partner
-- approvers (Mubeen); only an approved request moves anything. result keeps what was moved. A request with no
-- from_ids only renames a firm and/or corrects its contacts (from the clean-up sheet); a batch is one uploaded sheet.
create table if not exists cp_merge_requests (
  id serial primary key, into_id int not null references channel_partners(id), from_ids int[] not null, keep_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  contacts jsonb not null default '{}', set_reference boolean not null default false, batch text,
  note text, requested_by int references users(id), requested_at timestamptz not null default now(),
  decided_by int references users(id), decided_at timestamptz, reason text, result jsonb
);
-- Tax invoices for brokerage, sent by approved partners on the portal (the file kept in the database, sent in parts
-- because of the 4.5 MB request limit). Accounts checks each one; a checked bill becomes a 'bill' entry in the ledger.
create table if not exists cp_bills (
  id serial primary key, cp_id int not null references channel_partners(id),
  bill_no text not null, bill_date date not null,
  amount numeric(14,2) not null check (amount > 0), gst numeric(14,2) not null default 0 check (gst >= 0),
  booking_ids int[] not null default '{}',
  file_name text, mime text, size int, data bytea,
  status text not null default 'uploading' check (status in ('uploading', 'submitted', 'checked', 'rejected')),
  reason text, entry_id int references brokerage_entries(id),
  checked_by int references users(id), checked_at timestamptz, submitted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists cp_bills_no on cp_bills (cp_id, lower(bill_no)) where status in ('submitted', 'checked');
create index if not exists cp_bills_status on cp_bills (status, cp_id);
create table if not exists cp_bill_parts (
  bill_id int not null references cp_bills(id) on delete cascade, i int not null, data bytea not null, primary key (bill_id, i)
);
`,
  },
  {
    id: '047_staff_login_codes',
    sql: `
-- Two-step sign-in for staff (lib/staff-otp.js): one row per code sent. token_hash is the hash of the pending sign-in
-- token the browser holds between the password and the code (a resend adds a row with the same token); only hashes of
-- the code and of the internet address are kept. used_at is set when the right code is typed.
create table if not exists staff_otps (
  id serial primary key, token_hash text not null, user_id int not null references users(id) on delete cascade,
  via text not null default 'erp' check (via in ('erp', 'chat')), session_version int not null,
  code_hash text not null, sent_to text, attempts int not null default 0,
  expires_at timestamptz not null, used_at timestamptz, ip_hash text, created_at timestamptz not null default now()
);
create index if not exists staff_otps_token on staff_otps (token_hash);
create index if not exists staff_otps_user on staff_otps (user_id, created_at);
create index if not exists staff_otps_ip on staff_otps (ip_hash, created_at);
-- "Remember this device for 30 days": only the hash of the browser's random cookie is kept.
create table if not exists staff_devices (
  id serial primary key, user_id int not null references users(id) on delete cascade,
  token_hash text not null unique, label text,
  created_at timestamptz not null default now(), last_used_at timestamptz,
  expires_at timestamptz not null, revoked_at timestamptz
);
create index if not exists staff_devices_user on staff_devices (user_id) where revoked_at is null;
`,
  },
  {
    id: '048_signin_app_email',
    sql: `
-- Sign-in app (authenticator, TOTP): the secret sealed (lib/staff-otp.js), a set-up in progress, and the last 30-second
-- step used (a code works once). email_verified_at: the email took a sign-in code (added at sign-in, or used).
alter table users add column if not exists totp_secret text, add column if not exists totp_pending text,
  add column if not exists totp_enabled_at timestamptz, add column if not exists totp_last_step bigint,
  add column if not exists email_verified_at timestamptz;
-- a row per sign-in step: 'code' (a code sent by WhatsApp or email; email = a new address being added), 'app' (the
-- code from the sign-in app, nothing sent) or 'add-email' (no email or app yet: the person types their email first)
alter table staff_otps alter column code_hash drop not null,
  add column if not exists method text not null default 'code', add column if not exists email text;
alter table staff_otps drop constraint if exists staff_otps_via_check;
alter table staff_otps add constraint staff_otps_via_check check (via in ('erp', 'chat', 'self'));
`,
  },
  {
    id: '049_staff_nda',
    sql: `
-- Staff NDA (lib/nda.js): each text is a version; a login signs each version once, at sign-in.
create table if not exists nda_versions (
  version int primary key, title text not null, body text not null,
  created_by int references users (id), created_at timestamptz not null default now()
);
create table if not exists nda_signatures (
  id bigserial primary key, user_id int not null references users (id), version int not null references nda_versions (version),
  name text not null, username text not null, initials text not null, ip text, user_agent text, text_sha text not null,
  signed_at timestamptz not null default now(), unique (user_id, version)
);
insert into settings (key, value) values ('nda', '{"on": false}') on conflict (key) do nothing;
`,
  },
  {
    id: '050_predemand_notices',
    sql: `
-- Pre-demand notices (lib/predemand.js): advance word to a building's buyers that a stage's demand is coming, so they
-- arrange funds (and their bank's disbursement). No money is charged. CRM prepares, Head CRM approves and it is sent.
create table if not exists predemand_notices (
  id serial primary key,
  project_id int not null references projects (id),
  building_id int not null references buildings (id),
  stage_name text not null,
  expected_date date not null,
  note text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  created_by int references users (id), created_at timestamptz not null default now(),
  approved_by int references users (id), approved_at timestamptz
);
create table if not exists predemand_items (
  id serial primary key,
  notice_id int not null references predemand_notices (id),
  booking_id int not null references bookings (id),
  figures jsonb not null,
  sent_via text, sent_to text, sent_at timestamptz, send_error text,
  unique (notice_id, booking_id)
);
`,
  },
  {
    id: '051_receipt_provisional_mail',
    sql: `
-- lib/receipt-mail.js: when the provisional receipt ("subject to clearance") was emailed by itself
alter table receipts add column if not exists provisional_sent_at timestamptz;
`,
  },
  {
    id: '052_old_split_cheques',
    sql: `
-- lib/one-cheque.js: cheques from before go-live may pay two or three flats. The "same payment on two units" queries
-- the sheet import raised for them are closed (all were from before go-live); the bank match takes the total of the parts.
update import_issues set status = 'resolved', resolved_at = now(),
  resolution = 'One cheque split across flats, from before the one-cheque-per-flat rule (5 Nov 2026). Allowed; the bank statement is matched on the total of the parts.'
 where kind = 'shared-instrument' and status = 'open';
`,
  },
  {
    id: '053_customer_docs_unlinked',
    sql: `
-- lib/sample.js wipe(): a fresh CRM import keeps a flat's documents; between the clear and the import they wait
-- unlinked (booking_id empty, the flat in label) and relink() puts them back on the flat's new booking.
alter table customer_docs drop constraint if exists customer_docs_check;
alter table customer_docs add constraint customer_docs_check check ((owner_kind = 'booking' and (booking_id is not null or label is not null)) or (owner_kind = 'tenant' and tenant_id is not null) or (owner_kind = 'cp' and cp_id is not null));
`,
  },
  {
    id: '054_query_notes',
    sql: `
-- Open queries: items explained in an uploaded sheet (a note where the correction is not made in the ERP).
create table if not exists query_notes (
  key text primary key,
  note text not null,
  user_id int references users(id),
  at timestamptz not null default now()
);
`,
  },
  {
    id: '055_cancel_payments',
    sql: `
-- Every payment a cancelled buyer made (the Developer Tracker's "Cancellation Payment" tab): which receipts on a flat
-- were the old buyer's, so they are not counted for the present buyer, in the books or in the CRM.
create table if not exists acc_cancel_payments (
  id serial primary key,
  book text not null default 'signature',
  unit_no text not null,
  old_unit text,
  name text,
  amount numeric(14,2) not null,
  pay_date date,
  deposit_date date,
  txn text,
  mode text,
  status text,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create index if not exists acc_cancel_payments_unit on acc_cancel_payments (book, unit_no);
`,
  },
  {
    id: '056_user_extra_perms',
    sql: `
-- A permission given to one person on top of their role (5 Nov 2026: Reports for Mrunali and Hussain).
alter table users add column if not exists extra_perms text[] not null default '{}';
update users set extra_perms = array_append(extra_perms, 'reports.view') where username in ('mrunali', 'hussain') and not ('reports.view' = any(extra_perms));
`,
  },
  {
    id: '057_change_requests',
    sql: `
-- Changes that wait for the Chairman's or Sameer's approval: a receipt's amount, date or split, a booking's agreement
-- value, a buyer's name (lib/changes.js).
create table if not exists change_requests (
  id serial primary key,
  kind text not null,
  entity_id int not null,
  project_id int,
  booking_id int,
  title text not null,
  summary text,
  before jsonb,
  after jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by int references users(id),
  requested_at timestamptz not null default now(),
  decided_by int references users(id),
  decided_at timestamptz,
  decision_note text
);
create index if not exists change_requests_open on change_requests (status, requested_at);
`,
  },
  {
    id: '058_name_aliases',
    sql: `
-- Two spellings of one person's name (a Tally ledger and the CRM buyer): matching treats them as the same person.
create table if not exists name_aliases (
  id serial primary key,
  book text not null default 'signature',
  unit_no text,
  name text not null,
  same_as text not null,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
`,
  },
  {
    id: '059_chat_cleared',
    sql: `
-- DreamComm "Delete chat" (the Chairman only): the chat and its messages up to here are gone from his own list; others keep theirs.
alter table chat_members add column if not exists cleared_upto bigint not null default 0;
`,
  },
  {
    id: '060_agents',
    sql: `
-- The AI marketing agent team (/agents): one system for the company, used project by project.
-- scope = 'company' or a project id (as text). Owner input, the knowledge layer, what the agents said to each other,
-- what interrupted the loop, and the comment-to-DM lead funnels.
create table if not exists ag_scope (
  scope text primary key, enabled boolean not null default false, paused boolean not null default false,
  owner jsonb not null default '{}', last_run_at timestamptz, updated_by int references users(id), updated_at timestamptz
);
create table if not exists ag_knowledge (
  scope text not null, path text not null, body text not null default '',
  updated_by int references users(id), updated_at timestamptz not null default now(),
  primary key (scope, path)
);
create table if not exists ag_events (
  id bigserial primary key, scope text not null, at timestamptz not null default now(),
  agent text not null, to_agent text, kind text not null default 'say', text text not null, ref jsonb
);
create index if not exists ag_events_scope on ag_events (scope, id desc);
create table if not exists ag_interrupts (
  id serial primary key, scope text not null, kind text not null, key text not null unique,
  detail jsonb, status text not null default 'open' check (status in ('open', 'handled', 'owner', 'dismissed')),
  at timestamptz not null default now(), handled_at timestamptz, handled_by int references users(id)
);
create index if not exists ag_interrupts_scope on ag_interrupts (scope, at desc);
create table if not exists ag_funnels (
  id serial primary key, scope text not null, network text not null default 'instagram' check (network in ('instagram', 'facebook')),
  keyword text not null, media_ext text, dm_text text not null, public_reply text, thanks_text text,
  active boolean not null default false, live boolean not null default false, test_handles text[] not null default '{}',
  created_by int references users(id), created_at timestamptz not null default now(), updated_at timestamptz
);
create table if not exists ag_funnel_hits (
  id serial primary key, funnel_id int not null references ag_funnels(id) on delete cascade, network text not null,
  comment_id text not null, media_ext text, handle text, user_ext text, text text, at timestamptz,
  dm_at timestamptz, dm_error text, lead_id int references mkt_leads(id) on delete set null, thanked_at timestamptz,
  created_at timestamptz not null default now(), unique (network, comment_id)
);
create table if not exists ag_comment_notes (
  network text not null, ext_id text not null, kind text, suggestion text, at timestamptz not null default now(),
  primary key (network, ext_id)
);
alter table mkt_posts add column if not exists agent text;
`,
  },
  {
    id: '061_mrunali_audit_run',
    sql: `
-- Mrunali (Accounts) may press "Run the audit again" on the Accounts To-Do (6 Nov 2026). Nothing else changes for her.
update users set extra_perms = array_append(extra_perms, 'accounts.audit.run') where username = 'mrunali' and not ('accounts.audit.run' = any(extra_perms));
`,
  },
  {
    id: '062_password_forgot',
    sql: `
-- "Forgot password?" on the sign-in page (6 Nov 2026): a code to the person's own email, then a new password.
alter table staff_otps drop constraint if exists staff_otps_via_check;
alter table staff_otps add constraint staff_otps_via_check check (via in ('erp', 'chat', 'self', 'reset'));
`,
  },
  {
    id: '063_tm_campaigns',
    sql: `
-- Telemarketing, 6 Nov 2026: the partner's consent declaration kept with every upload; SMS and AI-call campaigns to the
-- numbers partners uploaded; telecallers from agencies.
alter table tm_uploads add column if not exists consent jsonb;
update tm_uploads set consent = jsonb_build_object('legacy', true, 'text', 'I confirm these clients have agreed to be contacted about Dream India projects.', 'at', created_at) where consent is null;
alter table tm_leads add column if not exists upload_id int references tm_uploads(id);
update tm_leads l set upload_id = (select u.id from tm_uploads u where u.cp_id = l.cp_id and u.tm_project_id = l.tm_project_id
    and (u.created_at + interval '330 minutes')::date = l.uploaded_on order by u.id limit 1)
  where l.upload_id is null and l.source = 'partner';

alter table tm_callers add column if not exists agency text;
alter table tm_callers add column if not exists roster_on date; -- the day the agency's list said this caller comes to work
update tm_callers c set mobile = null where mobile is not null and exists (select 1 from tm_callers d where d.mobile = c.mobile and d.id < c.id);
create unique index if not exists tm_callers_mobile on tm_callers (mobile) where mobile is not null;

create table if not exists tm_campaigns (
  id serial primary key, tm_project_id int not null references tm_projects(id),
  kind text not null check (kind in ('sms', 'call')), name text not null,
  message text, template_id text, script text,
  filters jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'running', 'paused', 'done', 'cancelled')),
  daily_cap int not null default 500, targets int not null default 0, counts jsonb not null default '{}',
  created_by int references users(id), created_at timestamptz not null default now(),
  approved_by int references users(id), approved_at timestamptz, started_at timestamptz, finished_at timestamptz, note text
);
create table if not exists tm_campaign_targets (
  id bigserial primary key, campaign_id int not null references tm_campaigns(id) on delete cascade,
  lead_id bigint not null references tm_leads(id), mobile text not null,
  status text not null default 'queued', sent_on date, provider_id text, detail text, digits text,
  updated_at timestamptz not null default now(),
  unique (campaign_id, mobile)
);
create index if not exists tm_ct_status on tm_campaign_targets (campaign_id, status);
create index if not exists tm_ct_provider on tm_campaign_targets (provider_id);
create index if not exists tm_ct_mobile on tm_campaign_targets (mobile);

update settings set value = value || jsonb_build_object('hookKey', md5(random()::text || clock_timestamp()::text))
  where key = 'tm' and not (value ? 'hookKey');
`,
  },
  {
    id: '064_ai_agents',
    sql: `
-- 7 Nov 2026: the website chat assistant, AI Meta ad plans, and conversational AI calls (Bolna).
create table if not exists bot_sessions (
  id text primary key, project_id int references projects(id), ip_hash text, page text,
  messages jsonb not null default '[]', captured jsonb not null default '{}', lead_id int references mkt_leads(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists bot_sessions_ip on bot_sessions (ip_hash, updated_at);
create index if not exists bot_sessions_upd on bot_sessions (updated_at desc);

create table if not exists ad_plans (
  id serial primary key, project_id int references projects(id),
  status text not null default 'draft' check (status in ('draft', 'approved', 'launched', 'live', 'failed', 'rejected')),
  brief jsonb not null default '{}', plan jsonb not null default '{}', meta jsonb not null default '{}', error text,
  created_by int references users(id), created_at timestamptz not null default now(),
  approved_by int references users(id), approved_at timestamptz, launched_at timestamptz, decision_note text
);

create table if not exists ad_plan_files (
  id serial primary key, plan_id int not null references ad_plans(id) on delete cascade, name text, mime text not null, data bytea not null,
  created_at timestamptz not null default now()
);

alter table tm_campaigns drop constraint if exists tm_campaigns_kind_check;
alter table tm_campaigns add constraint tm_campaigns_kind_check check (kind in ('sms', 'call', 'agent'));
alter table tm_campaign_targets add column if not exists result jsonb;
`,
  },
  {
    id: '065_agents_design',
    sql: `
-- The words for the post's design (headline, subline, call to action), written by the Content Engine and filled into the
-- Canva brand template by the Creative Studio.
alter table mkt_posts add column if not exists design_text jsonb;
`,
  },
  {
    id: '066_agents_library',
    sql: `
-- Our past Instagram photos and videos, copied into the Canva library (Uploads) so new designs can reuse them.
create table if not exists ag_canva_assets (
  network text not null, ext_id text not null, asset_ids text[] not null default '{}', tries int not null default 0,
  error text, at timestamptz not null default now(), primary key (network, ext_id)
);
`,
  },
  {
    id: '067_agents_photos',
    sql: `
-- Real photos for the designs (our renders from dreamindiarealty.com and any the team adds), copied into Canva.
create table if not exists ag_photos (
  id serial primary key, project_id int references projects(id), url text not null unique, tags text not null default '',
  asset_id text, used int not null default 0, tries int not null default 0, error text, created_at timestamptz not null default now()
);
`,
  },
  {
    id: '068_agents_rera_qr',
    sql: `
-- The project's official MahaRERA QR code (uploaded once per project), kept here and in Canva for every ad's design.
alter table ag_photos add column if not exists data bytea, add column if not exists mime text;
`,
  },
  {
    id: '069_leads_desk',
    sql: `
-- Pre-sales & Sales (/leads): the caller qualifies each lead and hands it to a sales person; every call is kept.
alter table mkt_leads add column if not exists qualify jsonb not null default '{}',
  add column if not exists handed_to int references users(id), add column if not exists handed_at timestamptz,
  add column if not exists handed_by int references users(id), add column if not exists visit_date date;
create table if not exists mkt_lead_events (
  id bigserial primary key, lead_id int not null references mkt_leads(id) on delete cascade,
  at timestamptz not null default now(), user_id int references users(id),
  kind text not null, outcome text, note text, data jsonb
);
create index if not exists mkt_lead_events_lead on mkt_lead_events (lead_id, at);
create index if not exists mkt_leads_handed on mkt_leads (handed_to) where handed_to is not null;
`,
  },
  {
    id: '070_sales_desk',
    sql: `
-- Sales (/leads): offers on a flat from the live price list (a discount above the limit waits for the approver),
-- a 72-hour hold on the flat for the customer, and the booking the lead turned into.
create table if not exists mkt_offers (
  id serial primary key,
  lead_id int not null references mkt_leads(id) on delete cascade,
  unit_id int not null references units(id),
  price_list_id int references price_lists(id),
  carpet numeric(10,2), rate numeric(12,2), parking int not null default 0, parking_amt numeric(14,2) not null default 0,
  list_av numeric(14,2) not null, discount numeric(14,2) not null default 0, discount_pct numeric(7,3) not null default 0,
  av numeric(14,2) not null, gst numeric(14,2), stamp_duty numeric(14,2), registration numeric(14,2), other_total numeric(14,2), total numeric(14,2), list_total numeric(14,2),
  others jsonb, floor_rate numeric(12,2), client_ask text, note text,
  status text not null default 'given' check (status in ('given', 'pending', 'approved', 'rejected', 'booked', 'void')),
  created_by int references users(id), created_at timestamptz not null default now(),
  decided_by int references users(id), decided_at timestamptz, decision_note text, notified jsonb
);
create index if not exists mkt_offers_lead on mkt_offers (lead_id, id);
create index if not exists mkt_offers_pending on mkt_offers (status) where status = 'pending';
alter table mkt_leads add column if not exists booking_id int references bookings(id),
  add column if not exists hold_unit_id int references units(id), add column if not exists hold_until timestamptz;
alter table units add column if not exists held_until timestamptz, add column if not exists held_lead_id int references mkt_leads(id) on delete set null;
`,
  },
  {
    id: '071_price_list_by_type',
    sql: `
-- A price list can quote a rate per flat type ({"1BHK": 28500, "2BHK": 30000}; base_rate for any other type), keep the
-- lowest selling rate per type (shown to the discount approver), charge other charges per sq ft
-- ([{name, amount} or {name, per_sqft}, gst: false when no GST]) and add GST on the other charges.
alter table price_lists add column if not exists rates jsonb not null default '{}',
  add column if not exists floor_rates jsonb not null default '{}',
  add column if not exists other_gst_pct numeric(5,2) not null default 0;
`,
  },
  {
    id: '072_aspire_inventory',
    sql: `
-- Dream Aspire for Sales (Rafi Sir, 7 Nov 2026): the tower, the 13 unsold flats, the ready-to-move plan (70% on booking)
-- and the price list from "Dream Aspire - Selling and quoting price cost sheet". The 77 sold flats and their buyers come
-- with the Aspire CRM import (units are matched by number, so nothing is entered twice).
insert into buildings (project_id, code, name, kind, floors)
  select id, 'A', 'Dream Aspire', 'sale', 22 from projects where code = 'ASPIRE'
  and not exists (select 1 from buildings b join projects p on p.id = b.project_id where p.code = 'ASPIRE' and b.code = 'A');
insert into units (project_id, building_id, unit_no, floor, typology, carpet_sqft, carpet_sqm, status)
  select p.id, b.id, 'A-' || x.no, x.floor, x.typ, x.sqft, round(x.sqft / 10.7639, 2), 'available'
  from projects p join buildings b on b.project_id = p.id and b.code = 'A',
  (values (206, 2, '1BHK', 459), (301, 3, '1BHK', 459), (303, 3, '2BHK', 713), (304, 3, '2BHK', 713), (306, 3, '1BHK', 459),
          (406, 4, '1BHK', 459), (501, 5, '1BHK', 459), (605, 6, '1BHK', 459), (606, 6, '1BHK', 459), (706, 7, '1BHK', 459),
          (2105, 21, '1BHK', 459), (2106, 21, '1BHK', 459), (2206, 22, '1BHK', 459)) as x(no, floor, typ, sqft)
  where p.code = 'ASPIRE'
on conflict (project_id, unit_no) do nothing;
insert into payment_plans (project_id, name)
  select id, 'Ready to move: 70% on booking' from projects where code = 'ASPIRE'
  and not exists (select 1 from payment_plans pp join projects p on p.id = pp.project_id where p.code = 'ASPIRE');
insert into plan_stages (plan_id, seq, name, pct, construction_linked)
  select pp.id, x.seq, x.name, x.pct, x.seq > 1 from payment_plans pp join projects p on p.id = pp.project_id,
  (values (1, 'On booking', 70), (2, 'Commencement of sanitary fittings, staircases, lift walls, lobbies up to the floor of the unit', 9),
          (3, 'Commencement of external plumbing and external plaster, elevation, terraces with waterproofing', 5),
          (4, 'On completion of lifts, electrical fittings, entrance lobby', 11), (5, 'Rest: on completion of the project', 5)) as x(seq, name, pct)
  where p.code = 'ASPIRE' and not exists (select 1 from plan_stages s where s.plan_id = pp.id);
insert into price_lists (project_id, name, effective_from, base_rate, parking_price, other_charges, gst_rate, stamp_duty_pct, stamp_duty_women_pct, registration_fee, notes, rates, floor_rates, other_gst_pct)
  select id, 'Quoting price, November 2026', date '2026-11-07', 28500, 1000000,
    '[{"name": "Legal & documentation at registration", "amount": 35000, "gst": false},
      {"name": "Share money, application and entrance fee of the society", "amount": 450},
      {"name": "Society registration", "amount": 10000},
      {"name": "Society maintenance, 12 months (₹12 per sq ft a month)", "per_sqft": 144},
      {"name": "Legal charges", "amount": 20000},
      {"name": "Deposit towards water, electricity and other utility connections", "amount": 27000},
      {"name": "Facility charges (₹150 per sq ft)", "per_sqft": 150},
      {"name": "Development charges (₹180 per sq ft)", "per_sqft": 180}]'::jsonb,
    5, 6, 5, 30000, 'From "Dream Aspire - Selling and quoting price cost sheet". Other charges are payable at possession, with 18% GST.',
    '{"1BHK": 28500, "2BHK": 30000}'::jsonb, '{"1BHK": 27500, "2BHK": 28000}'::jsonb, 18
  from projects where code = 'ASPIRE' and not exists (select 1 from price_lists pl join projects p on p.id = pl.project_id where p.code = 'ASPIRE');
`,
  },
  {
    id: '073_launch_social_presales',
    sql: `
-- Launch (8 Nov 2026): Rupali (Marketing) checks and approves the AI Agent Team's posts; the team learns only from
-- Dream India Realty's own Instagram and Facebook (not Dream India Group).
update users set extra_perms = array_append(coalesce(extra_perms, '{}'), 'marketing.approve') where username = '8142252990' and not ('marketing.approve' = any(coalesce(extra_perms, '{}')));
update ag_scope set owner = jsonb_set(owner, '{learnFrom}', '["dreamindiarealty", "Dream India Realty"]'::jsonb) where scope = 'company' and owner ? 'learnFrom';
`,
  },
  {
    id: '074_marketing_manager_full_team',
    sql: `
-- 10 Nov 2026: the marketing manager (Rupali) runs the whole AI Agent Team, not only the approvals: every project in the
-- project picker, and the owner controls (owner input, knowledge, funnels, kill switch) through marketing.approve.
update users set all_projects = true where username = '8142252990';
update users set extra_perms = array_append(coalesce(extra_perms, '{}'), 'marketing.approve') where username = '8142252990' and not ('marketing.approve' = any(coalesce(extra_perms, '{}')));
`,
  },
  {
    id: '075_redo_ai_designs',
    sql: `
-- 10 Nov 2026: Rafi Sir — the slides' photos did not match their words. Every upcoming AI post (not reels: those are
-- filmed) gets new design words from its caption, each slide naming its photo, and a new design; two per agents run.
insert into settings (key, value) select 'ag_redo', jsonb_build_object('ids', coalesce(jsonb_agg(id order by publish_at), '[]'::jsonb))
  from mkt_posts where agent is not null and kind <> 'reel' and status in ('review', 'approved', 'scheduled') and publish_at > now()
on conflict (key) do update set value = excluded.value;
`,
  },
  {
    id: '076_two_step_required',
    sql: `
-- 12 Nov 2026 (ERP review, Risks): a code is now required at every staff sign-in (WhatsApp, email or a sign-in app).
-- A login with no email is asked to add one at the next sign-in.
insert into settings (key, value) values ('security', '{"enforce": true}'::jsonb)
on conflict (key) do update set value = settings.value || '{"enforce": true}'::jsonb;
`,
  },
  {
    id: '077_tally_journals',
    sql: `
-- 13 Nov 2026: Tally's journal vouchers (and payment/receipt vouchers with no bank line) come into the ERP too,
-- one row per ledger line, so every ledger's total can match Tally.
create table if not exists acc_journals (
  id serial primary key,
  book text not null default 'signature',
  ref_id text,
  txn_date date,
  vch_type text,
  vch_no text,
  ledger text,
  debit numeric(16,2),
  credit numeric(16,2),
  amount numeric(16,2),
  narration text,
  source text,
  imported boolean not null default true,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_by int references users(id),
  updated_at timestamptz
);
create index if not exists acc_journals_date on acc_journals (book, txn_date);
create index if not exists acc_journals_ledger on acc_journals (book, ledger);
`,
  },
  {
    id: '078_stay_signed_in',
    sql: `
-- 13 Nov 2026: a login can stay signed in for 30 days on its own phone and iPad (set by Admin on the login).
-- The Chairman asked for it for Mr Syed Sameer, director.
alter table users add column if not exists stay_signed_in boolean not null default false;
update users set stay_signed_in = true where not disabled and (name ~* '(syed|sayed|saiyed)\\s+(sameer|samir)' or name ~* '(sameer|samir)\\s+ishaq' or username ~* '^(syed\\.?)?(sameer|samir)');
`,
  },
  {
    id: '079_jv_payment_links',
    sql: `
-- 16 Nov 2026 (Accounts): a journal voucher (expenses booked to "Mubeen Sir – Reimbursement") linked to the payment
-- out that settles it, so the payment shows what it paid for. Kept by Payment ID and Tally voucher, not row ids,
-- so a Sync with Tally does not lose the link.
create table if not exists acc_jv_links (
  id serial primary key,
  book text not null default 'signature',
  payment_ref text not null,
  journal_ref text not null,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  unique (book, payment_ref, journal_ref)
);
`,
  },
  {
    id: '080_split_parts_own_ledger',
    sql: `
-- 16 Nov 2026 (Accounts): every part of a split Tally voucher kept the voucher's whole description, listing every
-- flat's ledger. Searching one flat's ledger then matched all the parts of a day's PhonePe voucher, and the flat's
-- total showed ₹84.6 L instead of ₹28.9 L. Each part now names only its own ledger.
update acc_receipts set description = concat_ws(' · ', payer_name, 'one of ' || (length(split_part(description, ' · ', 1)) - length(replace(split_part(description, ' · ', 1), '; ', '')) ) / 2 + 1 || ' ledgers in the Tally voucher',
    case when position(' · ' in description) > 0 then trim(substring(description from position(' · ' in description) + 3)) end)
  where ref_id ~ '/[0-9]+$' and payer_name is not null and split_part(description, ' · ', 1) like '%; %' and split_part(description, ' · ', 1) like '%' || payer_name || '%';
update acc_payments set description = concat_ws(' · ', payee, 'one of ' || (length(split_part(description, ' · ', 1)) - length(replace(split_part(description, ' · ', 1), '; ', '')) ) / 2 + 1 || ' ledgers in the Tally voucher',
    case when position(' · ' in description) > 0 then trim(substring(description from position(' · ' in description) + 3)) end)
  where ref_id ~ '/[0-9]+$' and payee is not null and split_part(description, ' · ', 1) like '%; %' and split_part(description, ' · ', 1) like '%' || payee || '%';
`,
  },
  {
    id: '081_tally_bounce_pairs',
    sql: `
-- 18 Nov 2026 (Head Accounts): a cheque that bounced is a receipt plus a "cheque return" payment in Tally. The two are
-- paired (lib/tally-bounce.js) and kept by their IDs, so the bounced receipt drops out of the flat's total.
alter table acc_receipts add column if not exists bounced_by text;
alter table acc_payments add column if not exists bounce_of text;
`,
  },
  {
    id: '082_demand_run_certificate',
    sql: `
-- 19 Nov 2026: the architect's certificate for a stage, uploaded on the demand run (as page images, made in the browser),
-- goes with every demand letter of that run: attached to the email, added after the letter on WhatsApp and in print.
alter table demand_runs add column if not exists attach_name text;
create table if not exists demand_run_pages (run_id int not null references demand_runs(id) on delete cascade, i int not null, data bytea not null, primary key (run_id, i));
alter table demand_letters add column if not exists run_id int references demand_runs(id);
alter table demand_letters add column if not exists wa_sent_at timestamptz;
alter table demand_letters add column if not exists wa_error text;
-- receipts: the buyer's WhatsApp is sent once, when the receipt is entered (or by hand from the receipt)
alter table receipts add column if not exists wa_sent_at timestamptz;
`,
  },
  {
    id: '083_wa_templates_fixed',
    sql: `
-- 19 Nov 2026: Click Connect's first template set has broken blanks ("{{1))"): saved settings pointing at it move to the
-- corrected "_…" set; the PDF template is cleared (none with a document header is approved yet).
update settings set value = value
  || case when value->>'waEmailTemplate' = 'demand_letter_emailed_akaz55aw1ius78iv' then '{"waEmailTemplate":"_demand_letter_emailed_e0vu760cts5iyhr5"}'::jsonb else '{}'::jsonb end
  || case when value->>'waPdfTemplate' = 'demand_letter_pdf_kaj43dtm2mij2hvc' then '{"waPdfTemplate":""}'::jsonb else '{}'::jsonb end
  || case when value->>'waReceivedTemplate' = 'payment_received_4x8bvz5zkou6bw24' then '{"waReceivedTemplate":"_payment_received_j1gk3xffcf4uinut"}'::jsonb else '{}'::jsonb end
  || case when value->>'waReminderTemplate' = 'payment_reminder_6prw9zc5qo0nh4od' then '{"waReminderTemplate":"_payment_reminder_ez5id4srp9imksxn"}'::jsonb else '{}'::jsonb end
  || case when value->>'waRegTemplate' = 'registration_appointment_rdlybalong295uct' then '{"waRegTemplate":"_registration_appointment_blpcy1tv8jipqfnb"}'::jsonb else '{}'::jsonb end
where key = 'letters';
`,
  },
  {
    id: '084_wa_pdf_templates',
    sql: `
-- 19 Nov 2026: Meta approved the templates with a PDF attached; saved settings that are blank take them.
update settings set value = value
  || case when coalesce(value->>'waPdfTemplate', '') = '' then '{"waPdfTemplate":"demand_letter_with_pdf_te8kcpza2kv8bpr4"}'::jsonb else '{}'::jsonb end
  || case when coalesce(value->>'waReceiptPdfTemplate', '') = '' then '{"waReceiptPdfTemplate":"payment_receipt_with_pdf_32f7zqf7uvoqryhu"}'::jsonb else '{}'::jsonb end
where key = 'letters';
`,
  },
  {
    id: '085_wa_pdf_templates_media',
    sql: `
-- 19 Nov 2026: the letter "PDF" templates chosen earlier (dsig_demand_letter_pdf…, _demand_letter_pdf…) are text-only, so
-- the PDF never reached the buyer; they move to the approved templates that carry the PDF.
update settings set value = value || '{"waPdfTemplate":"demand_letter_with_pdf_te8kcpza2kv8bpr4"}'::jsonb
where key = 'letters' and (value->>'waPdfTemplate' like 'dsig_demand_letter_pdf%' or value->>'waPdfTemplate' like '\\_demand_letter_pdf%' or value->>'waPdfTemplate' like 'demand_letter_pdf_%');
update settings set value = value || '{"waReceiptPdfTemplate":"payment_receipt_with_pdf_32f7zqf7uvoqryhu"}'::jsonb
where key = 'letters' and coalesce(value->>'waReceiptPdfTemplate', '') = '';
`,
  },
  {
    id: '086_contractor_bookings',
    sql: `
-- Rafi Sir, 20 Nov 2026: flats given to the contractor at a flat rate, adjusted against the construction bills, are kept
-- apart from the developer's own sales (their own tile, totals and list). They are never demanded from the buyer.
alter table bookings add column if not exists sale_type text not null default 'developer';
alter table bookings drop constraint if exists bookings_sale_type_check;
alter table bookings add constraint bookings_sale_type_check check (sale_type in ('developer', 'contractor'));
alter table bookings add column if not exists contractor_name text, add column if not exists contractor_rate numeric(12,2);
-- Dream Aspire import (19 Nov): registered flats carry the status the dashboard reads ('Done'), and the few rupees of
-- rounding left on fully paid flats are taken as received on their opening receipt.
update bookings b set registration_status = 'Done' from units u join projects p on p.id = u.project_id
  where u.id = b.unit_id and p.code = 'ASPIRE' and b.imported and b.registration_status = 'Registered';
with x as (select r.id as rid, bb.overdue from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id join projects p on p.id = u.project_id
             join booking_balances bb on bb.booking_id = b.id
            where p.code = 'ASPIRE' and r.import_key like 'aspire-open:%' and bb.overdue > 0 and bb.overdue < 100),
     s as (update receipt_splits s set amount = s.amount + x.overdue from x where s.receipt_id = x.rid and s.head = 'av' returning s.receipt_id, x.overdue)
update receipts r set amount = r.amount + s.overdue from s where r.id = s.receipt_id;
`,
  },
  {
    id: '087_aspire_fixed_deposit',
    sql: `
-- Jahangir, 20 Nov 2026: Dream India Builders' (Aspire) fixed deposit, Rs 94,22,944, was missing from Cash in bank.
-- A hand-kept row under ASPIRE (no statement is read for it): Accounts change the balance on the Daily Bank Balance tab.
insert into acc_daily_banks (book, name, account_no, grp, seq, bf_balance, bf_date, auto_from_statement, active)
values ('signature', 'ASPIRE HDFC FIXED DEPOSIT', 'FD', 'ASPIRE', 950, 9422944, '2026-11-20', false, true)
on conflict (book, name) do update set bf_balance = excluded.bf_balance, bf_date = excluded.bf_date, grp = 'ASPIRE', active = true, auto_from_statement = false;
`,
  },
  {
    id: '088_remove_aspire_lines_from_signature',
    sql: `
-- Rafi Sir, 20 Nov 2026: the lines of two Dream Aspire statements read on 16 Nov as Prime's Yes 0700 / 0131
-- ("Dream Aspire HDFC 100% - 6462", "Dream Aspire HDFC GST - 2044") do not belong to Signature: removed, each row kept
-- in the audit log. Only rows still exactly as the statement run made them are touched.
with r as (
  select * from acc_receipts where book = 'signature' and source = 'Bank statement auto 16-Nov-2026' and updated_by is null and tally_at is null
     and ref_id in ('BS00068','BS00069','BS00070','BS00071','BS00072','BS00073','BS00074','BS00075','BS00076','BS00077','BS00078','BS00079','BS00080','BS00081','BS00082','BS00083',
                    'BS00084','BS00085','BS00086','BS00087','BS00088','BS00089','BS00090','BS00091','BS00092','BS00093','BS00094','BS00095','BS00096','BS00097','BS00098','BS00099')
), a as (
  insert into audit_log (action, entity, entity_id, before, note)
  select 'delete', 'acc-receipt', r.ref_id, to_jsonb(r), 'Dream Aspire statement line read as Signature on 16 Nov; removed on Rafi Sir''s instruction' from r returning 1
)
delete from acc_receipts x using r where x.id = r.id;
with p as (
  select * from acc_payments where book = 'signature' and source = 'Bank statement auto 16-Nov-2026' and updated_by is null and tally_at is null
     and ref_id in ('PO00049','PO00050','PO00051','PO00052','PO00053','PO00054','PO00055','PO00056','PO00057','PO00058','PO00059','PO00060','PO00061','PO00062','PO00063','PO00064',
                    'PO00065','PO00066','PO00067','PO00068','PO00069','PO00070','PO00071','PO00072','PO00073','PO00074','PO00075','PO00076','PO00077','PO00078','PO00079','PO00080',
                    'PO00081','PO00082','PO00083','PO00084','PO00085')
), a as (
  insert into audit_log (action, entity, entity_id, before, note)
  select 'delete', 'acc-payment', p.ref_id, to_jsonb(p), 'Dream Aspire statement line read as Signature on 16 Nov; removed on Rafi Sir''s instruction' from p returning 1
)
delete from acc_payments x using p where x.id = p.id;
`,
  },
  {
    id: '089_remove_duplicate_b4007_receipts',
    sql: `
-- Rafi Sir, 21 Nov 2026: BL00001 (Rs. 7,03,800, Yes 0700, 11 Nov) and BL00002 (Rs. 34,500, Yes 0131, 6 Nov) for B-4007 were
-- typed by hand on 11 Nov; the statement had already brought in the same money on 5 Nov (BS00007, BS00003). Removed, each
-- row kept in the audit log. Only touched if still exactly as entered (never edited, never sent to Tally).
with r as (
  select * from acc_receipts where book = 'signature' and ref_id in ('BL00001', 'BL00002') and unit_no = 'B-4007'
     and amount in (703800, 34500) and updated_by is null and tally_at is null
), a as (
  insert into audit_log (action, entity, entity_id, before, note)
  select 'delete', 'acc-receipt', r.ref_id, to_jsonb(r), 'Duplicate of the statement line of 5 Nov (BS00007 / BS00003), typed by hand on 11 Nov; removed on Rafi Sir''s instruction' from r returning 1
)
delete from acc_receipts x using r where x.id = r.id;
`,
  },
  {
    id: '090_aspire_books',
    sql: `
-- Dream Aspire's own accounts books (Dream India Builders), 22 Nov 2026: banks, Daily Bank Balance rows, the same
-- cash flow heads as Prime's, and where its statements come from. Prime's books ('signature') are not touched.
insert into acc_banks (book, name, account_no) values
  ('aspire', 'Aspire HDFC 100% (6462)', '50200091626462'), ('aspire', 'Aspire HDFC 70% (6459)', '50200091626459'),
  ('aspire', 'Aspire HDFC 30% (7044)', '99909000777044'), ('aspire', 'Aspire HDFC GST (2044)', '50200092382044'),
  ('aspire', 'Aspire Axis (2736)', '2736'), ('aspire', 'Aspire HDFC Fixed Deposit', null), ('aspire', 'Cash', null)
on conflict (book, name) do nothing;
insert into acc_daily_banks (book, name, account_no, grp, seq, bf_balance, bf_date, auto_from_statement, ledger_bank, active) values
  ('aspire', 'ASPIRE HDFC 100% (6462)', '50200091626462', 'ASPIRE', 10, 0, null, true, 'Aspire HDFC 100% (6462)', true),
  ('aspire', 'ASPIRE HDFC 70% (6459)', '50200091626459', 'ASPIRE', 20, 0, null, true, 'Aspire HDFC 70% (6459)', true),
  ('aspire', 'ASPIRE HDFC 30% (7044)', '99909000777044', 'ASPIRE', 30, 0, null, true, 'Aspire HDFC 30% (7044)', true),
  ('aspire', 'ASPIRE HDFC GST (2044)', '50200092382044', 'ASPIRE', 40, 0, null, true, 'Aspire HDFC GST (2044)', true),
  ('aspire', 'ASPIRE AXIS (2736)', '2736', 'ASPIRE', 50, 0, null, true, 'Aspire Axis (2736)', true),
  ('aspire', 'ASPIRE HDFC FIXED DEPOSIT', 'FD', 'ASPIRE', 90, 9422944, '2026-11-20', false, 'Aspire HDFC Fixed Deposit', true),
  ('aspire', 'CASH', null, 'ASPIRE', 99, 0, null, false, 'Cash', true)
on conflict (book, name) do nothing;
insert into acc_heads (book, side, name, section, indirect_line, tds_section, tds_rate, category, note, needs_bill, payee_type, active)
  select 'aspire', side, name, section, indirect_line, tds_section, tds_rate, category, note, needs_bill, payee_type, active from acc_heads where book = 'signature'
  on conflict (book, side, name) do nothing;
insert into acc_settings (book, key, value) values
  ('aspire', 'statement_start', '2021-04-01'),
  ('aspire', 'statement_folders', '1-MW0QH8ubCwK38Ku_m5VfqklwqLr1pth,1dgVDLIXbfAndPB1h0wMYZZoqvIglbBF5')
on conflict (book, key) do nothing;
`,
  },
  {
    id: '091_daily_tasks_per_project',
    sql: `
-- The Daily To-Do is per project (23 Nov 2026: Dream Aspire showed Signature's call list). Earlier lists were Signature's.
alter table daily_tasks add column if not exists project_id int references projects(id);
update daily_tasks set project_id = (select id from projects where code = 'SIGNATURE') where project_id is null;
drop index if exists daily_tasks_key;
create unique index if not exists daily_tasks_key2 on daily_tasks (dept, project_id, task_date, key) where key is not null;
create index if not exists daily_tasks_proj_day on daily_tasks (dept, project_id, task_date);
alter table daily_audit_runs add column if not exists project_id int references projects(id);
update daily_audit_runs set project_id = (select id from projects where code = 'SIGNATURE') where project_id is null;
`,
  },
  {
    id: '092_payments_bill_totals',
    sql: `
-- Payments Out with TDS but no bill total (23 Nov 2026): the bank paid the bill less TDS, so the bill is amount paid +
-- TDS; with the TDS rate the taxable value is TDS / rate and the GST the rest. Typed figures are kept.
update acc_payments set total_bill = amount + tds_deducted where tds_deducted > 0 and total_bill is null and amount is not null;
update acc_payments set taxable_value = round(tds_deducted / tds_rate, 2)
  where tds_deducted > 0 and taxable_value is null and tds_rate > 0 and total_bill is not null and round(tds_deducted / tds_rate, 2) <= total_bill;
update acc_payments set gst_on_bill = total_bill - taxable_value where gst_on_bill is null and total_bill is not null and taxable_value is not null and total_bill >= taxable_value and tds_deducted > 0;
update acc_payments set net_payable = total_bill - tds_deducted where net_payable is null and total_bill is not null and tds_deducted is not null and tds_deducted > 0;
`,
  },
  {
    id: '093_vendor_bills',
    sql: `
-- Vendor bills as booked in Tally (Purchase and Journal Registers): the bill, its GST and TDS, one row per voucher.
create table if not exists acc_vendor_bills (
  id serial primary key, book text not null default 'signature', tally_key text not null,
  party text not null, bill_date date, vch_type text, vch_no text, inv_no text, inv_date date, expense text,
  taxable numeric, gst numeric, total numeric, tds_section text, tds_rate numeric, tds numeric, net numeric, pan text,
  narration text, source text, created_at timestamptz not null default now(), updated_at timestamptz
);
create unique index if not exists acc_vendor_bills_key on acc_vendor_bills (book, tally_key);
create index if not exists acc_vendor_bills_party on acc_vendor_bills (book, party);
`,
  },
  {
    id: '094_heads_tds_sections',
    sql: `
-- Standard TDS section and rate on the payment heads that have none (Rafi Sir, 23 Nov 2026; for the CA to confirm).
-- 194C at 2% (firms and companies; individuals are 1%, typed on the payment). Heads that already have a section keep it.
update acc_heads h set tds_section = x.sec, tds_rate = x.rate, needs_bill = x.bill
  from (values
    ('(contract|labou?r|pill?ing|civil|plumb|fabricat|paint|security|housekeep|manpower|transport|printing|advert|marketing|event|sample flat|site exp|jcb|hydra|repair)', '194C', 0.02, true),
    ('(commission|brokerage|mandate)', '194H', 0.02, true),
    ('(architect|consult|professional|legal|structural|\\ymep\\y|\\yca\\y|audit fee|valuation|engineer)', '194J', 0.10, true),
    ('(^| )rent', '194-I', 0.10, true),
    ('(material|steel|\\yrmc\\y|cement|tmt|aggregate|sand|blocks?)', '194Q', 0.001, true),
    ('(investment return|interest paid)', '194A', 0.10, true),
    ('buy ?back', '194-IA', 0.01, false),
    ('(salary|salaries)', '192', null, false)
  ) as x(re, sec, rate, bill)
 where h.side = 'payment' and coalesce(h.tds_section, '') = '' and lower(h.name) ~ x.re
   and lower(h.name) !~ '(deposit|refund|receivable|loan|tds|gst|withdrawal|transfer|cancel)';
`,
  },
  {
    id: '095_tds_deposits_head',
    sql: `
-- TDS challans paid from the bank go under the head TDS (its line is "TDS deposited"), so the CA page counts what was
-- deposited (23 Nov 2026). Only payments with no head: the Tally ledger "TDS on …" as payee, or a tax-challan narration.
update acc_payments set head = 'TDS', remark = concat_ws(' · ', nullif(remark, ''), 'Head TDS: a TDS challan')
 where coalesce(head, '') in ('', 'Not given in Tally') and amount > 0
   and (payee ~* '^tds\\y' or description ~* '(itns\\s*-?\\s*281|challan\\s*(no\\.?\\s*)?281|tds\\s*(payment|challan|deposit|paid))')
   and exists (select 1 from acc_heads h where h.book = acc_payments.book and h.side = 'payment' and h.name = 'TDS');
-- the Tally bill details filled on 23 Nov 2026 (about 8:28 pm) changed nothing Tally holds: not sent to Tally again
update acc_payments set updated_at = tally_at
 where bill_note like '%Bill details from Tally%' and tally_at is not null and updated_at > tally_at
   and updated_at between '2026-11-23 14:50:00+00' and '2026-11-23 15:10:00+00';
`,
  },
  {
    id: '096_tds_ledger_heads',
    sql: `
-- Payments Out rows from Tally carry the TDS ledger as their head ("TDS on Commission 194 H", "TDS 194Q @0.10%" …):
-- each such head is a TDS deposit (line "TDS deposited"), so the CA page counts what was paid to the government.
insert into acc_heads (book, side, name, section, indirect_line, active)
  select distinct book, 'payment', head, 'Operating', 'TDS deposited', true from acc_payments
   where head ~* '^tds\\s+(on\\s|19[2-9])' and head !~* 'receivable'
on conflict (book, side, name) do update set indirect_line = 'TDS deposited', section = coalesce(acc_heads.section, 'Operating')
  where coalesce(acc_heads.indirect_line, '') = '';
`,
  },
  {
    id: '097_post_approval_sent',
    sql: `
-- Posts sent for approval get a one-tap approval email and WhatsApp (23 Nov 2026). Posts waiting now are sent it by the
-- 5-minute job (approval_sent_at empty); older ones are left.
alter table mkt_posts add column if not exists approval_sent_at timestamptz;
update mkt_posts set approval_sent_at = coalesce(sent_at, now()) where status <> 'review' or coalesce(sent_at, created_at) < now() - interval '10 days';
`,
  },
  {
    id: '098_aspire_heads_no_signature_buyers',
    sql: `
-- Dream Aspire's head list was started from Dream Signature's, which has heads named after Signature buyers (24 Nov 2026:
-- "Aspire still shows Signature data"). Those heads are switched off in Aspire's books where no Aspire entry uses them.
update acc_heads h set active = false
 where h.book = 'aspire' and h.active
   and lower(trim(h.name)) in (select lower(trim(y.name)) from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id
                                 join units u on u.id = b.unit_id join projects p on p.id = u.project_id where p.code = 'SIGNATURE')
   and lower(trim(h.name)) not in (select lower(trim(y.name)) from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id
                                 join units u on u.id = b.unit_id join projects p on p.id = u.project_id where p.code = 'ASPIRE')
   and not exists (select 1 from acc_receipts r where r.book = 'aspire' and lower(trim(r.head)) = lower(trim(h.name)))
   and not exists (select 1 from acc_payments r where r.book = 'aspire' and lower(trim(r.head)) = lower(trim(h.name)));
`,
  },
  {
    id: '099_aspire_heads_no_signature_ledgers',
    sql: `
-- The same for heads that hold a Signature buyer's or SRA tenant's name inside a longer ledger name ("A-1007 -Naved Rashid
-- Khan/Yasmin R. Khan", "126 Amir Hamza Jamil Ahmed Khan"), where no Aspire entry uses the head and the name is no Aspire buyer's.
with sig as (
  select distinct lower(trim(y.name)) as n from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id
    join units u on u.id = b.unit_id join projects p on p.id = u.project_id where p.code = 'SIGNATURE' and length(trim(y.name)) >= 8
  union select distinct lower(trim(t.name)) from acc_sra_tenants t where t.book = 'signature' and length(trim(t.name)) >= 8
), asp as (
  select distinct lower(trim(y.name)) as n from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id
    join units u on u.id = b.unit_id join projects p on p.id = u.project_id where p.code = 'ASPIRE'
)
update acc_heads h set active = false
 where h.book = 'aspire' and h.active
   and exists (select 1 from sig where position(sig.n in lower(h.name)) > 0 and not exists (select 1 from asp where position(sig.n in asp.n) > 0))
   and not exists (select 1 from acc_receipts r where r.book = 'aspire' and lower(trim(r.head)) = lower(trim(h.name)))
   and not exists (select 1 from acc_payments r where r.book = 'aspire' and lower(trim(r.head)) = lower(trim(h.name)));
`,
  },
  {
    id: '100_investment_return_no_bill',
    sql: `
-- An investor's return has no vendor bill (24 Nov 2026): the head stops asking for one; its TDS section (194A on the
-- interest part) stays on the head.
update acc_heads set needs_bill = false where needs_bill and name ~* '^investment return';
`,
  },
  {
    id: '101_mubeen_admin',
    sql: `
-- Rafi Sir, 24 Nov 2026: "Mubeen should be given admin access to the entire ERP, and he should be able to do the logins,
-- reset passwords and give access to staff when they cannot sign in." His other sessions end, so the new role applies at
-- his next sign-in.
insert into audit_log (user_id, action, entity, entity_id, before, after, note)
  select null, 'update', 'user', id::text, jsonb_build_object('role', role, 'allProjects', all_projects), jsonb_build_object('role', 'admin', 'allProjects', true),
         'Made Admin on Rafi Sir''s instruction (24 Nov 2026): all of the ERP, and Logins to reset passwords and give staff access'
    from users where username = 'mubeen' and role <> 'admin';
update users set role = 'admin', all_projects = true, session_version = session_version + 1 where username = 'mubeen' and role <> 'admin';
`,
  },
  {
    id: '102_crm_logins_per_project',
    sql: `
-- Rafi Sir, 24 Nov 2026: Savita sees Dream Aspire only; Signature's CRM team sees Dream Signature only: Tejaswini (Head
-- CRM), wing A Hussain and Neha, wing B Manisha and Arish.
with who(username, code) as (values ('savita', 'ASPIRE'), ('teju', 'SIGNATURE'), ('hussain', 'SIGNATURE'), ('neha', 'SIGNATURE'), ('manisha', 'SIGNATURE'), ('arish', 'SIGNATURE'))
insert into audit_log (user_id, action, entity, entity_id, before, after, note)
  select null, 'update', 'user', u.id::text, jsonb_build_object('allProjects', u.all_projects), jsonb_build_object('allProjects', false, 'projects', jsonb_build_array(p.id)),
         'Project access on Rafi Sir''s instruction (24 Nov 2026): ' || p.name || ' only'
    from who join users u on u.username = who.username join projects p on p.code = who.code;
with who(username, code) as (values ('savita', 'ASPIRE'), ('teju', 'SIGNATURE'), ('hussain', 'SIGNATURE'), ('neha', 'SIGNATURE'), ('manisha', 'SIGNATURE'), ('arish', 'SIGNATURE'))
delete from user_projects up using users u, who where up.user_id = u.id and u.username = who.username;
with who(username, code) as (values ('savita', 'ASPIRE'), ('teju', 'SIGNATURE'), ('hussain', 'SIGNATURE'), ('neha', 'SIGNATURE'), ('manisha', 'SIGNATURE'), ('arish', 'SIGNATURE'))
insert into user_projects (user_id, project_id) select u.id, p.id from who join users u on u.username = who.username join projects p on p.code = who.code on conflict do nothing;
update users set all_projects = false where username in ('savita', 'teju', 'hussain', 'neha', 'manisha', 'arish');
-- the Signature CRM teams by wing (a wing's team only gets flats of projects they can open)
insert into settings (key, value)
  select 'crm_wings', jsonb_build_object('A', coalesce((select jsonb_agg(id order by id) from users where username in ('hussain', 'neha')), '[]'::jsonb),
                                         'B', coalesce((select jsonb_agg(id order by id) from users where username in ('manisha', 'arish')), '[]'::jsonb))
on conflict (key) do update set value = excluded.value;
`,
  },
  {
    id: '103_presales_sales_sourcing',
    sql: `
-- Rafi Sir, 24 Nov 2026: Pre-sales & Sales becomes three tabs, Pre-sales, Sales and Sourcing.
-- Why pre-sales passed a lead to sales (site visit / more information / a cost sheet), and who it came back from.
alter table mkt_leads add column if not exists handover_reason text, add column if not exists sent_back_at timestamptz;
-- Sourcing: the channel partner's office, saved on the first visit; later visits are checked against it.
alter table channel_partners add column if not exists office_lat numeric(9,6), add column if not exists office_lng numeric(9,6),
  add column if not exists office_set_at timestamptz, add column if not exists office_set_by int references users(id);
create table if not exists cp_visits (
  id serial primary key,
  user_id int not null references users(id),
  cp_id int not null references channel_partners(id),
  at timestamptz not null default now(),
  lat numeric(9,6), lng numeric(9,6), accuracy int,
  distance_m int,              -- from the saved office; null on the visit that saved it or when no location was given
  verified boolean not null default false,
  first_visit boolean not null default false,
  photo text,                  -- office board or visiting card (data URL, made small on the phone)
  person_name text, person_phone text, person_role text,
  purpose text not null,
  notes text,
  next_date date,
  project_id int references projects(id)
);
create index if not exists cp_visits_user_at on cp_visits (user_id, at desc);
create index if not exists cp_visits_cp on cp_visits (cp_id, at desc);
`,
  },
  {
    id: '104_sales_team_roles',
    sql: `
-- Rafi Sir, 24 Nov 2026 (Aspire Sales Data.xlsx, "Sales Team"): one sales team for Dream Aspire and Dream Signature.
--   Amaan Khan, Sales Head: Sales, and every lead (Pre-sales and Sales tabs)
--   Arbaaz Khan, Sourcing Head: Sourcing, and the whole team's visits
--   Asma Shaikh, GRE / Pre-sales: Pre-sales
--   Saniya Sayyed, Closing Manager: Sales
--   Anas Shaikh and Fahad Shaikh, Sourcing Managers: Sourcing
-- A login is changed only when exactly one active login matches the name (Anas Shaikh never matches Anas Afghan Khan),
-- and a login that is Admin, Management, Head CRM or Accounts keeps its role (it only gets the extra access). Both projects
-- are added to each; nothing is taken away. Anyone without a login is left for Logins.
drop table if exists team_plan, team_hit;
create temporary table team_plan (who text, re text, unames text[], role text, extra text[]);
insert into team_plan values
  ('Amaan Khan',    '^[[:space:]]*a+ma+n[[:space:]]+khan[[:space:]]*$',            array['amaan', 'aman', 'amaankhan'],   'sales',    array['leads.all']),
  ('Arbaaz Khan',   '^[[:space:]]*arba+z[[:space:]]+khan[[:space:]]*$',            array['arbaaz', 'arbaz', 'arbaazkhan'], 'sourcing', array['sourcing.all']),
  ('Asma Shaikh',   '^[[:space:]]*asma([[:space:]]+sh?aikh)?[[:space:]]*$',        array['asma', 'asmashaikh'],           'presales', array[]::text[]),
  ('Saniya Sayyed', '^[[:space:]]*saniya([[:space:]]+say+[ie]d)?[[:space:]]*$',    array['saniya', 'saniyasayyed'],       'sales',    array[]::text[]),
  ('Anas Shaikh',   '^[[:space:]]*anas[[:space:]]+sh?aikh[[:space:]]*$',           array['anasshaikh', 'anas.shaikh'],    'sourcing', array[]::text[]),
  ('Fahad Shaikh',  '^[[:space:]]*fahad([[:space:]]+sh?aikh)?[[:space:]]*$',       array['fahad', 'fahadshaikh'],         'sourcing', array[]::text[]);
create temporary table team_hit as
  select t.*, u.id as user_id, u.role as old_role, u.extra_perms as old_extra
    from team_plan t join users u on not u.disabled and (u.name ~* t.re or lower(u.username) = any(t.unames))
   where (select count(*) from users v where not v.disabled and (v.name ~* t.re or lower(v.username) = any(t.unames))) = 1;
insert into audit_log (user_id, action, entity, entity_id, before, after, note)
  select null, 'update', 'user', h.user_id::text, jsonb_build_object('role', h.old_role, 'extra', h.old_extra),
         jsonb_build_object('role', case when h.old_role in ('admin', 'management', 'head_crm', 'head_accounts', 'accounts') then h.old_role else h.role end, 'extraAdded', h.extra),
         'Sales team set up on Rafi Sir''s instruction (24 Nov 2026): ' || h.who
    from team_hit h;
update users u set role = case when u.role in ('admin', 'management', 'head_crm', 'head_accounts', 'accounts') then u.role else h.role end,
       extra_perms = (select coalesce(array_agg(distinct x), '{}') from unnest(u.extra_perms || h.extra) x),
       session_version = session_version + 1
  from team_hit h where u.id = h.user_id;
insert into user_projects (user_id, project_id)
  select h.user_id, p.id from team_hit h join projects p on p.code in ('ASPIRE', 'SIGNATURE') on conflict do nothing;
insert into settings (key, value) select 'sales_team_setup', jsonb_build_object('at', now(),
    'set', coalesce((select jsonb_agg(jsonb_build_object('who', who, 'login', user_id)) from team_hit), '[]'::jsonb),
    'notFound', coalesce((select jsonb_agg(who) from team_plan t where not exists (select 1 from team_hit h where h.who = t.who)), '[]'::jsonb))
on conflict (key) do update set value = excluded.value;
drop table team_plan, team_hit;
`,
  },
  {
    id: '105_sales_heads_full_access',
    sql: `
-- Rafi Sir, 24 Nov 2026: "Give Amaan Khan and Arbaaz Khan full access to entire pre sales and sales dashboard": every
-- lead in Pre-sales and Sales (call, transfer, offers, holds, walk-ins, booking) and all of Sourcing. Same name match as 104.
drop table if exists head_plan, head_hit;
create temporary table head_plan (who text, re text, unames text[]);
insert into head_plan values
  ('Amaan Khan',  '^[[:space:]]*a+ma+n[[:space:]]+khan[[:space:]]*$', array['amaan', 'aman', 'amaankhan']),
  ('Arbaaz Khan', '^[[:space:]]*arba+z[[:space:]]+khan[[:space:]]*$', array['arbaaz', 'arbaz', 'arbaazkhan']);
create temporary table head_hit as
  select t.who, u.id as user_id, u.extra_perms as old_extra from head_plan t join users u on not u.disabled and (u.name ~* t.re or lower(u.username) = any(t.unames))
   where (select count(*) from users v where not v.disabled and (v.name ~* t.re or lower(v.username) = any(t.unames))) = 1;
insert into audit_log (user_id, action, entity, entity_id, before, after, note)
  select null, 'update', 'user', h.user_id::text, jsonb_build_object('extra', h.old_extra),
         jsonb_build_object('extraAdded', array['leads.work', 'leads.all', 'booking.create', 'inventory.view', 'sourcing.work', 'sourcing.all', 'tm.view']),
         'Full Pre-sales, Sales and Sourcing access on Rafi Sir''s instruction (24 Nov 2026): ' || h.who
    from head_hit h;
update users u set extra_perms = (select coalesce(array_agg(distinct x), '{}') from unnest(u.extra_perms || array['leads.work', 'leads.all', 'booking.create', 'inventory.view', 'sourcing.work', 'sourcing.all', 'tm.view']) x),
       session_version = session_version + 1
  from head_hit h where u.id = h.user_id;
insert into user_projects (user_id, project_id) select h.user_id, p.id from head_hit h join projects p on p.code in ('ASPIRE', 'SIGNATURE') on conflict do nothing;
drop table head_plan, head_hit;
`,
  },
  {
    id: '106_customer_docs_source',
    sql: `
-- Files copied in from the Signature CRM's shared Drive folder (lib/custdocs-import.js): the Drive file they came from,
-- so the same file is never brought in twice.
alter table customer_docs add column if not exists source_id text;
create unique index if not exists customer_docs_source on customer_docs (source_id) where source_id is not null;
`,
  },
  {
    id: '107_post_design_reapproval',
    sql: `
-- Marketing (from Zuri, 27 Nov 2026): what is approved goes out exactly as approved. A design added to a post after it
-- was approved (by anyone other than the approver) sends the post back for approval, and the WhatsApp approval link
-- goes out again. New wording after approval does the same (api/marketing.js post.save).
create or replace function mkt_design_reapprove() returns trigger language plpgsql as $f$
begin
  update mkt_posts set status = 'review', approved_by = null, approved_at = null, approval_sent_at = null,
         review_note = 'A new design was added after approval: approve the design.', updated_at = now()
   where id = new.post_id and status in ('approved', 'scheduled') and approved_at is not null and campaign_id is null
     and new.mime like 'image/%' and coalesce(new.created_by, -1) <> coalesce(approved_by, -2);
  return new;
end $f$;
drop trigger if exists mkt_post_files_reapprove on mkt_post_files;
create trigger mkt_post_files_reapprove after insert on mkt_post_files for each row execute function mkt_design_reapprove();
`,
  },
  {
    id: '108_sales_targets',
    sql: `
-- Sales targets (from Zuri, 27 Nov 2026): what each project means to sell each month, in flats and agreement value,
-- for the whole project (person '') and for each salesperson, beside what was booked (lib/targets.js).
create table if not exists sales_targets (
  id serial primary key,
  project_id int not null references projects (id),
  month date not null check (extract(day from month) = 1),
  person text not null default '',
  units int not null default 0 check (units >= 0 and units <= 100000),
  value numeric(16, 2) not null default 0 check (value >= 0),
  updated_by int references users (id),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_targets_one on sales_targets (project_id, month, lower(person));
`,
  },
];
