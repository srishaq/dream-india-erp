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
];
