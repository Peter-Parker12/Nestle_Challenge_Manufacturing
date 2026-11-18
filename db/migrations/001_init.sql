-- Market Move Radar (SALES-2). Schemas: cfg (setup), mkt (market data and decisions), ai (call log), audit.
-- Price and sales history is append-only. Decisions and briefs cannot be edited. Rules live in the database as well as in code.

create extension if not exists pgcrypto;
create schema if not exists cfg;
create schema if not exists mkt;
create schema if not exists core;
create schema if not exists ai;
create schema if not exists audit;

create or replace function core.block_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (no % allowed)', tg_table_schema || '.' || tg_table_name, tg_op;
end $$;

create table audit.event (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text
);
create index on audit.event (entity, entity_id, at);

create or replace function audit.log_change() returns trigger language plpgsql as $$
declare
  uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  why text := nullif(current_setting('app.reason', true), '');
  rid text;
  j jsonb;
begin
  j := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  rid := coalesce(j->>'id', j->>'code', j->>'key');
  insert into audit.event(user_id, action, entity, entity_id, before, after, reason)
  values (uid, tg_op, tg_table_schema || '.' || tg_table_name, rid,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) - 'bytes' end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) - 'bytes' end, why);
  return coalesce(new, old);
end $$;

-- ------------------------------------------------------------------ setup
create table cfg.app_user (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  role text not null check (role in ('sales_lead','category_manager','field_rep','analyst','admin','viewer')),
  active boolean not null default true
);

-- engine thresholds and business assumptions, editable by a person with a reason (audited)
create table cfg.setting (
  key text primary key,
  value numeric not null,
  min_value numeric not null,
  max_value numeric not null,
  unit text,
  label text not null,
  help text,
  updated_by uuid references cfg.app_user(id),
  updated_at timestamptz not null default now(),
  check (value >= min_value and value <= max_value)
);
create trigger aud_setting after insert or update on cfg.setting for each row execute function audit.log_change();

create table cfg.channel (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

-- ------------------------------------------------------------------ master data
create table mkt.sku (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  brand text not null,
  is_nestle boolean not null,
  category text not null,
  pack_ml int not null check (pack_ml > 0),
  pack_count int not null default 1 check (pack_count > 0),
  competes_with uuid references mkt.sku(id),             -- a competitor SKU points at the Nestlé SKU it competes with
  status text not null default 'Active' check (status in ('Active','Retired')),
  check (is_nestle or competes_with is not null)
);
create table mkt.retailer (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  channel_id uuid not null references cfg.channel(id)
);

-- ------------------------------------------------------------------ history (append-only)
-- One row per price seen. price = shelf price per pack. promo_price = the price a shopper actually pays after a promo or voucher.
create table mkt.observation (
  id bigserial primary key,
  sku_id uuid not null references mkt.sku(id),
  retailer_id uuid not null references mkt.retailer(id),
  channel_id uuid not null references cfg.channel(id),
  observed_on date not null,
  price numeric not null check (price > 0),
  promo_price numeric check (promo_price is null or (promo_price > 0 and promo_price <= price)),
  promo_text text,
  pack_ml int,
  in_stock boolean not null default true,
  facings int check (facings is null or facings >= 0),
  source text not null check (source in ('feed','price_list','shelf_photo','import')),
  source_ref text,
  created_at timestamptz not null default now(),
  unique (sku_id, retailer_id, observed_on, source)
);
create index on mkt.observation (sku_id, channel_id, observed_on);
create index on mkt.observation (observed_on);
create trigger trg_obs_immutable before update or delete on mkt.observation for each row execute function core.block_change();

-- Nestlé sales only (units and revenue), weekly per SKU and channel
create table mkt.sales_weekly (
  id bigserial primary key,
  sku_id uuid not null references mkt.sku(id),
  channel_id uuid not null references cfg.channel(id),
  week_start date not null,
  units numeric not null check (units >= 0),
  revenue_vnd numeric not null check (revenue_vnd >= 0),
  unique (sku_id, channel_id, week_start)
);
create trigger trg_sales_immutable before update or delete on mkt.sales_weekly for each row execute function core.block_change();

create table mkt.feed_status (
  name text primary key,
  kind text not null,
  last_run timestamptz,
  rows_added int not null default 0,
  note text
);

-- ------------------------------------------------------------------ moves, elasticity, scenarios
create sequence mkt.move_seq start 2001;
create table mkt.move (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('M-' || nextval('mkt.move_seq')),
  detected_on date not null,
  kind text not null check (kind in ('price_cut','price_rise','promo','pack_change','shelf_gap','out_of_stock')),
  sku_id uuid not null references mkt.sku(id),             -- the SKU that moved
  nestle_sku_id uuid not null references mkt.sku(id),      -- the Nestlé SKU exposed to it
  channel_id uuid not null references cfg.channel(id),
  title text not null,
  baseline numeric,
  observed numeric,
  change_pct numeric,
  z numeric,
  coverage numeric,                                         -- share of retailers in the channel that show it
  exposure_vnd numeric not null,                            -- estimated Nestlé revenue at risk per week
  exposure_low numeric not null,
  exposure_high numeric not null,
  level text not null check (level in ('High','Medium','Low')),
  evidence jsonb not null default '[]',                     -- observation ids and facts behind the flag
  engine_version text not null,
  created_at timestamptz not null default now(),
  unique (kind, sku_id, channel_id, detected_on)
);
create trigger aud_move after insert on mkt.move for each row execute function audit.log_change();
create trigger trg_move_immutable before update or delete on mkt.move for each row execute function core.block_change();

create table mkt.elasticity (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references mkt.sku(id),
  channel_id uuid not null references cfg.channel(id),
  value numeric not null,
  low numeric not null,
  high numeric not null,
  n_points int not null,
  r2 numeric,
  method text not null check (method in ('log-log','default')),
  computed_on date not null,
  unique (sku_id, channel_id, computed_on)
);

create table mkt.scenario (
  id uuid primary key default gen_random_uuid(),
  move_id uuid not null references mkt.move(id),
  label text not null,                                      -- A, B, C, D
  kind text not null check (kind in ('hold','promo','match_price','shelf_action','restock')),
  title text not null,
  volume_pct numeric not null,
  volume_low numeric not null,
  volume_high numeric not null,
  margin_vnd_wk numeric not null,
  cost_text text not null,
  risk_text text not null,
  confidence text not null check (confidence in ('High','Medium','Low')),
  needs_category_manager boolean not null default false,
  assumptions jsonb not null,
  engine_version text not null,
  unique (move_id, label)
);
create trigger trg_scenario_immutable before update or delete on mkt.scenario for each row execute function core.block_change();

-- Decisions: a person accepts, rejects or defers one scenario of a move. Cannot be edited; the latest decision stands.
create table mkt.decision (
  id uuid primary key default gen_random_uuid(),
  move_id uuid not null references mkt.move(id),
  scenario_id uuid not null references mkt.scenario(id),
  action text not null check (action in ('Accepted','Rejected','Deferred')),
  reason text,
  defer_until date,
  decided_by uuid not null references cfg.app_user(id),
  decided_at timestamptz not null default now()
);
create index on mkt.decision (move_id, decided_at);
create or replace function mkt.guard_decision() returns trigger language plpgsql as $$
declare sc record; role_ text;
begin
  select move_id, needs_category_manager, kind into sc from mkt.scenario where id = new.scenario_id;
  if sc.move_id <> new.move_id then raise exception 'The scenario does not belong to this move'; end if;
  if new.action in ('Rejected','Deferred') and length(trim(coalesce(new.reason, ''))) < 5 then
    raise exception 'A % decision needs a reason of at least 5 characters', lower(new.action);
  end if;
  if new.action = 'Deferred' and (new.defer_until is null or new.defer_until <= current_date) then
    raise exception 'A deferred decision needs a date in the future';
  end if;
  if new.action <> 'Deferred' and new.defer_until is not null then raise exception 'Only a deferred decision has a date'; end if;
  select role into role_ from cfg.app_user where id = new.decided_by;
  if new.action = 'Accepted' and sc.needs_category_manager and role_ <> 'category_manager' then
    raise exception 'A price-match scenario can only be accepted by a category manager';
  end if;
  return new;
end $$;
create trigger trg_decision_guard before insert on mkt.decision for each row execute function mkt.guard_decision();
create trigger trg_decision_immutable before update or delete on mkt.decision for each row execute function core.block_change();
create trigger aud_decision after insert on mkt.decision for each row execute function audit.log_change();

-- ------------------------------------------------------------------ shelf photos
create table mkt.photo (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique,
  mime text not null check (mime in ('image/png','image/jpeg')),
  bytes bytea not null check (length(bytes) <= 5242880),
  retailer_id uuid not null references mkt.retailer(id),
  taken_on date not null check (taken_on <= current_date),
  is_mock boolean not null default false,
  uploaded_by uuid references cfg.app_user(id),
  created_at timestamptz not null default now()
);
create trigger trg_photo_immutable before update or delete on mkt.photo for each row execute function core.block_change();
create trigger aud_photo after insert on mkt.photo for each row execute function audit.log_change();

-- What the AI read, one row per tag. The AI value is never overwritten; the person's value sits beside it.
create table mkt.photo_item (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references mkt.photo(id),
  idx int not null,
  label text not null,
  sku_id uuid references mkt.sku(id),
  ai_price numeric,
  ai_facings int,
  ai_conf numeric not null check (ai_conf between 0 and 1),
  ai_note text,
  needs_check boolean not null,
  status text not null default 'Pending' check (status in ('Pending','Confirmed','Corrected','Unreadable')),
  human_price numeric,
  human_facings int,
  reason text,
  checked_by uuid references cfg.app_user(id),
  checked_at timestamptz,
  observation_id bigint references mkt.observation(id),
  unique (photo_id, idx)
);
create or replace function mkt.guard_photo_item() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Photo readings are never deleted'; end if;
  if tg_op = 'INSERT' then return new; end if;
  if old.status <> 'Pending' then raise exception 'This reading was already checked'; end if;
  if new.photo_id <> old.photo_id or new.idx <> old.idx or new.label <> old.label or new.ai_price is distinct from old.ai_price
     or new.ai_facings is distinct from old.ai_facings or new.ai_conf <> old.ai_conf then
    raise exception 'The AI reading cannot be changed';
  end if;
  if new.status = 'Pending' then raise exception 'Nothing to change'; end if;
  if new.checked_by is null then raise exception 'Say who checked this reading'; end if;
  if new.status = 'Confirmed' and old.ai_price is null then raise exception 'There is no price to confirm. Correct it or mark it unreadable'; end if;
  if new.status = 'Corrected' then
    if new.human_price is null or new.human_price <= 0 then raise exception 'A correction needs a price'; end if;
    if new.human_price is not distinct from old.ai_price and new.human_facings is not distinct from old.ai_facings then raise exception 'The corrected value equals the AI value. Confirm it instead'; end if;
    if length(trim(coalesce(new.reason, ''))) < 5 then raise exception 'Say why the price was corrected (at least 5 characters)'; end if;
  end if;
  return new;
end $$;
create trigger trg_photo_item_guard before insert or update or delete on mkt.photo_item for each row execute function mkt.guard_photo_item();
create trigger aud_photo_item after insert or update on mkt.photo_item for each row execute function audit.log_change();

-- ------------------------------------------------------------------ briefs
create table mkt.brief (
  id uuid primary key default gen_random_uuid(),
  brief_date date not null,
  language text not null check (language in ('en','vi')),
  headline text not null,
  sections jsonb not null,
  citations jsonb not null default '[]',
  invalid jsonb not null default '[]',
  source text not null check (source in ('claude','template')),
  created_by uuid references cfg.app_user(id),
  created_at timestamptz not null default now()
);
create index on mkt.brief (brief_date desc, created_at desc);
create trigger trg_brief_immutable before update or delete on mkt.brief for each row execute function core.block_change();

-- ------------------------------------------------------------------ synthetic ground truth (seed only, used by the backtest)
create table mkt.truth_event (
  id serial primary key,
  kind text not null,
  sku_id uuid not null references mkt.sku(id),
  channel_id uuid not null references cfg.channel(id),
  started_on date not null,
  note text
);

-- ------------------------------------------------------------------ AI call log
create table ai.call_log (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  model text not null,
  prompt_hash text,
  input_refs jsonb,
  request jsonb,
  response jsonb,
  output_valid boolean,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  user_id uuid references cfg.app_user(id),
  created_at timestamptz not null default now(),
  error text
);
create index on ai.call_log (created_at desc);
