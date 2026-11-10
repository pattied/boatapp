// Database schema. Every statement is idempotent; migrate() runs them all on first use.
// Statements are separated by a line containing only "--;".
export const SCHEMA = `
create table if not exists app_meta (
  key text primary key,
  value text not null
)
--;
create table if not exists marinas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
)
--;
create table if not exists gates (
  id uuid primary key default gen_random_uuid(),
  marina_id uuid not null references marinas(id) on delete cascade,
  name text not null,
  code text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
)
--;
create table if not exists docks (
  id uuid primary key default gen_random_uuid(),
  marina_id uuid not null references marinas(id) on delete cascade,
  gate_id uuid references gates(id) on delete set null,
  name text not null
)
--;
create table if not exists crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
)
--;
create table if not exists technicians (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid references crews(id) on delete set null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
)
--;
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  is_add_on boolean not null default false,
  price_text text not null default '',
  shot_list text[] not null default '{Bow,Stern,Cockpit,"Port side"}',
  sort int not null default 0,
  active boolean not null default true
)
--;
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  email text not null default '',
  status text not null default 'active'
    check (status in ('pending', 'active', 'paused', 'inactive', 'declined')),
  notes text not null default '',
  portal_token text not null unique,
  source text not null default 'manager',
  sms_consent boolean not null default false,
  marketing_consent boolean not null default false,
  consent_text text not null default '',
  consent_at timestamptz,
  requested_plan text not null default '',
  created_at timestamptz not null default now()
)
--;
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  role text not null default 'owner',
  phone text not null default '',
  email text not null default ''
)
--;
create table if not exists boats (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  make_model text not null default '',
  length_ft int,
  hull_color text not null default '',
  marina_id uuid references marinas(id) on delete set null,
  gate_id uuid references gates(id) on delete set null,
  dock_id uuid references docks(id) on delete set null,
  slip text not null default '',
  berth_type text not null default 'slip',
  gate_code_override text not null default '',
  access_notes text not null default '',
  liveaboard boolean not null default false,
  knock_first boolean not null default false,
  status text not null default 'active' check (status in ('active', 'paused', 'sold')),
  paused_until date,
  pause_reason text not null default '',
  created_at timestamptz not null default now()
)
--;
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  crew_id uuid references crews(id) on delete set null,
  anchor_date date not null,
  interval_weeks int not null check (interval_weeks between 1 and 52),
  off_interval_weeks int check (off_interval_weeks between 1 and 52),
  season_start text not null default '',
  season_end text not null default '',
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
)
--;
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  boat_id uuid not null references boats(id) on delete cascade,
  plan_id uuid references plans(id) on delete set null,
  occurrence_date date,
  service_id uuid references services(id) on delete set null,
  crew_id uuid references crews(id) on delete set null,
  scheduled_date date not null,
  route_order int,
  origin text not null default 'manual' check (origin in ('plan', 'request', 'manual')),
  is_override boolean not null default false,
  status text not null default 'scheduled' check (status in
    ('scheduled', 'in_progress', 'completed', 'partial', 'skipped', 'cancelled', 'needs_reschedule')),
  started_at timestamptz,
  completed_at timestamptz,
  started_by text not null default '',
  completed_by text not null default '',
  completion_message text not null default '',
  partial_reason text not null default '',
  skip_reason text not null default '',
  cancel_reason text not null default '',
  manager_notes text not null default '',
  rescheduled_from date,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, occurrence_date)
)
--;
create index if not exists jobs_scheduled_date on jobs (scheduled_date)
--;
create index if not exists jobs_boat on jobs (boat_id)
--;
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  kind text not null check (kind in ('before', 'after', 'issue', 'skip', 'share')),
  slot text not null default '',
  pathname text not null,
  client_id text unique,
  taken_at timestamptz,
  received_at timestamptz not null default now(),
  replaced boolean not null default false,
  taken_by text not null default ''
)
--;
create index if not exists photos_job on photos (job_id)
--;
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  photo_client_id text,
  category text not null,
  severity text not null default 'normal' check (severity in ('normal', 'urgent')),
  found text not null default 'before' check (found in ('before', 'after')),
  visibility text not null default 'portal' check (visibility in ('portal', 'internal')),
  status text not null default 'open' check (status in ('open', 'quoted', 'resolved', 'dismissed')),
  note text not null default '',
  manager_note text not null default '',
  quote_text text not null default '',
  reported_by text not null default '',
  client_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
--;
create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  boat_id uuid references boats(id) on delete cascade,
  kind text not null check (kind in ('service', 'pause')),
  service_ids uuid[] not null default '{}',
  preferred_date date,
  until_date date,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decline_reason text not null default '',
  job_id uuid references jobs(id) on delete set null,
  created_at timestamptz not null default now()
)
--;
create table if not exists crew_events (
  client_id text primary key,
  job_id uuid references jobs(id) on delete cascade,
  type text not null,
  at timestamptz not null,
  by_name text not null default '',
  received_at timestamptz not null default now()
)
--;
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'
)
--;
create index if not exists audit_entity on audit_log (entity, entity_id)
--;
create table if not exists signin_attempts (
  id bigserial primary key,
  who text not null,
  at timestamptz not null default now()
)
--;
create index if not exists signin_attempts_who on signin_attempts (who, at)
--;
create index if not exists jobs_crew_date on jobs (crew_id, scheduled_date)
--;
create index if not exists jobs_status on jobs (status)
--;
create index if not exists boats_customer on boats (customer_id)
--;
create index if not exists boats_marina on boats (marina_id)
--;
create index if not exists plans_boat on plans (boat_id)
--;
create index if not exists contacts_customer on contacts (customer_id)
--;
create index if not exists issues_boat on issues (boat_id)
--;
create index if not exists issues_status on issues (status)
--;
create index if not exists requests_customer on requests (customer_id)
--;
create index if not exists requests_status on requests (status)
--;
create index if not exists crew_events_job on crew_events (job_id)
`;

// Starting catalog, inserted once when the services table is empty.
// Detail services added November 2026. They replace "Full detail", "Interior clean" and "Teak work".
export const ADDED_SERVICES_2026_11 = [
  { name: "Exterior Detail", description: "Wash, polish and wax", addOn: true, price: "", sort: 20 },
  { name: "Interior Detail", description: "Cabin, head and galley", addOn: true, price: "", sort: 21 },
  { name: "Full Detail", description: "Exterior and interior detail", addOn: true, price: "", sort: 22 },
  { name: "Rail and Metal Polishing", description: "Stainless rails, cleats and hardware", addOn: true, price: "", sort: 23 },
  { name: "Teak Sanding and Restoration", description: "Sand, clean and restore teak", addOn: true, price: "", sort: 24 },
  { name: "Gelcoat Repair", description: "Repair chips, cracks and gouges in gelcoat", addOn: true, price: "", sort: 25 },
  { name: "Stain Removal + Wash", description: "Remove hull and deck stains, then a full wash", addOn: true, price: "", sort: 26 },
];
export const RETIRED_SERVICES_2026_11 = ["Full detail", "Interior clean", "Teak work"];

export const DEFAULT_SERVICES: { name: string; description: string; addOn: boolean; price: string; sort: number }[] = [
  { name: "Exterior wash", description: "Wash and rinse hull, deck and canvas exterior", addOn: false, price: "", sort: 1 },
  { name: "Wash and wax", description: "Exterior wash plus a coat of wax", addOn: false, price: "", sort: 2 },
  { name: "Extra wash", description: "One-off exterior wash, for example before an outing", addOn: true, price: "", sort: 10 },
  ...ADDED_SERVICES_2026_11,
  { name: "Canvas and cushion clean", description: "Bimini, dodger and cushions", addOn: true, price: "", sort: 30 },
];
