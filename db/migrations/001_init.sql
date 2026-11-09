-- BAF-1 Launch Accelerator: initial schema
-- Schemas: stg (raw imports), cfg (configuration), core (operational), rec (recommendations), ai (AI artefacts), audit.

create schema if not exists stg;
create schema if not exists cfg;
create schema if not exists core;
create schema if not exists rec;
create schema if not exists ai;
create schema if not exists audit;

-- ---------------------------------------------------------------- users (demo auth stub; replace with SSO claims)
create table cfg.app_user (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  role text not null check (role in
    ('rd_engineer','process_engineer','qa','category_owner','supply_chain','plant_admin','viewer')),
  active boolean not null default true
);

-- ---------------------------------------------------------------- configuration
create table cfg.category (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  owner_user_id uuid references cfg.app_user(id),
  active boolean not null default true
);

create table cfg.process_step (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cfg.category(id),
  name text not null,
  seq int not null,
  unique (category_id, seq)
);

create table cfg.parameter_def (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references cfg.process_step(id),
  code text not null,
  name text not null,
  unit text not null,
  abs_min numeric not null,
  abs_max numeric not null,
  is_critical boolean not null default false,
  is_locked boolean not null default false,     -- locked limits are never weighted down (BR-02)
  version int not null default 1,
  valid_from date not null default current_date,
  valid_to date,
  unique (step_id, code, version),
  check (abs_min < abs_max)
);

create table cfg.attribute_def (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cfg.category(id),
  code text not null,
  name text not null,
  unit text,
  data_type text not null check (data_type in ('numeric','choice')),
  choices jsonb,
  required boolean not null default false,
  abs_min numeric,
  abs_max numeric,
  unique (category_id, code),
  check (data_type <> 'choice' or choices is not null)
);

create table cfg.quality_test_def (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cfg.category(id),
  code text not null,
  name text not null,
  unit text,
  is_critical boolean not null default false,
  unique (category_id, code)
);

create table cfg.reason_code (
  code text primary key,
  label text not null,
  active boolean not null default true
);

create table cfg.line (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  plant text not null
);

create table cfg.line_capability (
  line_id uuid not null references cfg.line(id),
  parameter_def_id uuid not null references cfg.parameter_def(id),
  cap_min numeric not null,
  cap_max numeric not null,
  primary key (line_id, parameter_def_id),
  check (cap_min <= cap_max)
);

create table cfg.sme_rule (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cfg.category(id),
  condition jsonb not null,           -- {"attr":"fat_pct","op":">","value":2.5}
  risk_effect jsonb not null,         -- {"severity":"Medium"}
  message text not null,
  owner_user_id uuid references cfg.app_user(id),
  status text not null default 'Active' check (status in ('Draft','Active','Retired')),
  version int not null default 1,
  approved_by uuid references cfg.app_user(id),
  effective_from date not null default current_date
);

-- ---------------------------------------------------------------- core: products, launches, runs
create table core.product (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cfg.category(id),
  code text not null,
  name text not null,
  format text,
  status text not null default 'Active',
  external_ref text,                   -- PLM / ERP id, source system left open
  unique (category_id, code)
);

create table core.product_attribute_value (
  product_id uuid not null references core.product(id) on delete cascade,
  attribute_def_id uuid not null references cfg.attribute_def(id),
  value_num numeric,
  value_choice text,
  primary key (product_id, attribute_def_id),
  check (value_num is not null or value_choice is not null)
);

create table core.product_spec (
  product_id uuid not null references core.product(id) on delete cascade,
  quality_test_def_id uuid not null references cfg.quality_test_def(id),
  spec_min numeric,
  spec_max numeric,
  primary key (product_id, quality_test_def_id),
  check (spec_min is null or spec_max is null or spec_min <= spec_max)
);

create table core.recipe_version (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references core.product(id) on delete cascade,
  version int not null,
  created_at timestamptz not null default now(),
  unique (product_id, version)
);

create table core.recipe_item (
  recipe_version_id uuid not null references core.recipe_version(id) on delete cascade,
  ingredient_code text not null,
  amount numeric not null,
  unit text not null,
  primary key (recipe_version_id, ingredient_code)
);

create sequence core.launch_code_seq start 1000;

create table core.launch_project (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('L-' || nextval('core.launch_code_seq')),
  product_id uuid not null references core.product(id),
  recipe_version_id uuid references core.recipe_version(id),
  line_id uuid not null references cfg.line(id),
  objective text,
  status text not null default 'Draft' check (status in
    ('Draft','Recommended','In review','Approved','Trial running','Results entered','Closed','Cancelled')),
  created_by uuid references cfg.app_user(id),
  created_at timestamptz not null default now(),
  ta_decision text check (ta_decision in ('Accepted','Accepted with conditions','Rejected')),
  ta_date date,
  ta_by uuid references cfg.app_user(id),
  closed_at timestamptz,
  cancel_reason text
);
create index on core.launch_project (product_id, status);

create table core.trial_run (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references core.launch_project(id),
  run_no int not null,
  started_at timestamptz,
  ended_at timestamptz,
  plan_rec_id uuid,                                -- recommendation followed, if any (FK added below)
  status text not null default 'Planned' check (status in ('Planned','Running','Results entered','Closed')),
  result text check (result in ('Pass','Marginal','Fail')),
  result_notes jsonb,                              -- why the engine chose the result
  result_overridden boolean not null default false,
  result_override_reason text,
  result_override_by uuid references cfg.app_user(id),
  aborted boolean not null default false,
  loss_kg numeric check (loss_kg is null or loss_kg >= 0),
  loss_note text,
  next_step text check (next_step in ('TA','Repeat','Stop')),
  notes text,
  unique (launch_id, run_no),
  check (not result_overridden or coalesce(length(result_override_reason),0) > 0)
);
create index on core.trial_run (launch_id, run_no);

create table core.run_parameter (
  run_id uuid not null references core.trial_run(id) on delete cascade,
  parameter_def_id uuid not null references cfg.parameter_def(id),
  planned numeric,
  actual numeric,
  primary key (run_id, parameter_def_id)
);
create index on core.run_parameter (parameter_def_id);

create table core.run_quality (
  run_id uuid not null references core.trial_run(id) on delete cascade,
  quality_test_def_id uuid not null references cfg.quality_test_def(id),
  value numeric not null,
  spec_min numeric,
  spec_max numeric,
  pass boolean not null,                           -- computed by trigger
  primary key (run_id, quality_test_def_id)
);

create table core.run_reason (
  run_id uuid not null references core.trial_run(id) on delete cascade,
  reason_code text not null references cfg.reason_code(code),
  comment text,
  primary key (run_id, reason_code)
);

create table core.run_material (
  run_id uuid not null references core.trial_run(id) on delete cascade,
  material_code text not null,
  lot text,
  condition jsonb,
  primary key (run_id, material_code)
);

-- ---------------------------------------------------------------- rec: weights, recommendations
create table rec.weight_set (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('platform','category','recipe')),
  category_id uuid references cfg.category(id),
  launch_id uuid references core.launch_project(id),
  status text not null default 'Active' check (status in ('Draft','Pending approval','Active','Retired')),
  created_by uuid references cfg.app_user(id),
  approved_by uuid references cfg.app_user(id),
  reason text,
  effective_from timestamptz not null default now(),
  supersedes_id uuid references rec.weight_set(id),
  check (level <> 'category' or category_id is not null),
  check (level <> 'recipe' or launch_id is not null)
);

create table rec.weight_item (
  weight_set_id uuid not null references rec.weight_set(id),
  kind text not null check (kind in ('attribute','parameter')),
  item_id uuid not null,
  weight smallint not null check (weight between 0 and 5),
  primary key (weight_set_id, kind, item_id)
);

create table rec.recommendation (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references core.launch_project(id),
  run_no_target int not null,
  weight_set_id uuid references rec.weight_set(id),
  weights_snapshot jsonb not null,                 -- exact normalised weights used (BR-09)
  engine_version text not null,
  history_as_of timestamptz not null,
  n_matched int not null,
  confidence text not null check (confidence in ('High','Medium','Low')),
  overall_risk text not null check (overall_risk in ('Low','Medium','High')),
  created_at timestamptz not null default now(),
  created_by uuid references cfg.app_user(id)
);
create index on rec.recommendation (launch_id, created_at);

alter table core.trial_run add constraint trial_run_plan_rec_fk
  foreign key (plan_rec_id) references rec.recommendation(id);

create table rec.recommendation_line (
  recommendation_id uuid not null references rec.recommendation(id),
  parameter_def_id uuid not null references cfg.parameter_def(id),
  start_value numeric not null,
  window_low numeric not null,
  window_high numeric not null,
  clipped boolean not null default false,
  clip_reason text,
  primary key (recommendation_id, parameter_def_id),
  check (window_low <= window_high)
);

create table rec.recommendation_evidence (
  recommendation_id uuid not null references rec.recommendation(id),
  evidence_launch_id uuid not null references core.launch_project(id),
  similarity numeric not null,
  rank int not null,
  was_good boolean not null,
  primary key (recommendation_id, evidence_launch_id)
);

create table rec.risk_flag (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references rec.recommendation(id),
  flag_type text not null,
  severity text not null check (severity in ('Low','Medium','High')),
  message text not null,
  detail jsonb,
  sme_rule_id uuid references cfg.sme_rule(id)
);

create table rec.decision (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references rec.recommendation(id),
  action text not null check (action in ('approved','edited','rejected')),
  final_values jsonb,
  reason text,
  decided_by uuid references cfg.app_user(id),
  decided_at timestamptz not null default now(),
  second_approver uuid references cfg.app_user(id)
);

-- ---------------------------------------------------------------- ai
create table ai.document (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  mime text not null,
  sha256 text not null,
  size_bytes int not null,
  content bytea,                                   -- demo stores bytes in DB; use blob storage in production
  uploaded_by uuid references cfg.app_user(id),
  uploaded_at timestamptz not null default now(),
  source text
);

create table ai.extraction (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references ai.document(id),
  launch_id uuid references core.launch_project(id),
  model text not null,
  schema_version text not null,
  output jsonb,
  validation_errors jsonb,
  status text not null default 'Pending review' check (status in ('Pending review','Approved','Rejected')),
  reviewed_by uuid references cfg.app_user(id),
  reviewed_at timestamptz,
  mapped_run_id uuid references core.trial_run(id)
);

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

create table ai.rule_suggestion (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cfg.category(id),
  draft_condition jsonb not null,
  rationale text not null,
  evidence_launch_ids uuid[] not null default '{}',
  status text not null default 'Proposed' check (status in ('Proposed','Accepted','Rejected')),
  decided_by uuid references cfg.app_user(id),
  sme_rule_id uuid references cfg.sme_rule(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- staging for open data sources
create table stg.load (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_ref text,
  loaded_at timestamptz not null default now(),
  loaded_by uuid references cfg.app_user(id),
  status text not null default 'Loaded',
  row_count int
);
create table stg.raw_row (
  load_id uuid not null references stg.load(id),
  row_no int not null,
  payload jsonb not null,
  mapped boolean not null default false,
  error text,
  primary key (load_id, row_no)
);

-- ---------------------------------------------------------------- audit (insert-only)
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

-- ================================================================ functions and triggers
create or replace function audit.log_change() returns trigger language plpgsql as $$
declare
  uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  why text := nullif(current_setting('app.reason', true), '');
  rid text;
begin
  if (tg_op = 'DELETE') then rid := coalesce((to_jsonb(old)->>'id'), (to_jsonb(old)->>'code'));
  else rid := coalesce((to_jsonb(new)->>'id'), (to_jsonb(new)->>'code')); end if;
  insert into audit.event(user_id, action, entity, entity_id, before, after, reason)
  values (uid, tg_op, tg_table_schema || '.' || tg_table_name, rid,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end, why);
  return coalesce(new, old);
end $$;

create or replace function core.block_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (no % allowed)', tg_table_schema || '.' || tg_table_name, tg_op;
end $$;

-- run_quality.pass is derived, never typed (BR-13)
create or replace function core.compute_quality_pass() returns trigger language plpgsql as $$
begin
  new.pass := (new.spec_min is null or new.value >= new.spec_min)
          and (new.spec_max is null or new.value <= new.spec_max);
  return new;
end $$;
create trigger trg_quality_pass before insert or update on core.run_quality
  for each row execute function core.compute_quality_pass();

-- closed launches are read-only unless an audited admin override is set (BR-15)
create or replace function core.guard_closed_launch() returns trigger language plpgsql as $$
declare lid uuid; st text;
begin
  if tg_table_name = 'trial_run' then lid := coalesce(new.launch_id, old.launch_id);
  else select launch_id into lid from core.trial_run where id = coalesce(new.run_id, old.run_id); end if;
  select status into st from core.launch_project where id = lid;
  if st = 'Closed' and coalesce(current_setting('app.admin_override', true), 'off') <> 'on' then
    raise exception 'launch is Closed and read-only (BR-15)';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_run before update or delete on core.trial_run
  for each row execute function core.guard_closed_launch();
create trigger trg_guard_param before insert or update or delete on core.run_parameter
  for each row execute function core.guard_closed_launch();
create trigger trg_guard_quality before insert or update or delete on core.run_quality
  for each row execute function core.guard_closed_launch();
create trigger trg_guard_reason before insert or update or delete on core.run_reason
  for each row execute function core.guard_closed_launch();

-- run numbering and the "reason before next run" rule (BR-12, BR-14)
create or replace function core.guard_new_run() returns trigger language plpgsql as $$
declare prev_no int; prev_res text; prev_id uuid; st text;
begin
  select status into st from core.launch_project where id = new.launch_id;
  if st in ('Closed','Cancelled') and coalesce(current_setting('app.admin_override', true), 'off') <> 'on' then
    raise exception 'cannot add a run to a % launch', st;
  end if;
  select run_no, result, id into prev_no, prev_res, prev_id
    from core.trial_run where launch_id = new.launch_id order by run_no desc limit 1;
  if prev_no is null then
    if new.run_no <> 1 then raise exception 'first run must be run_no 1 (BR-12)'; end if;
  else
    if new.run_no <> prev_no + 1 then raise exception 'run_no must be % (BR-12)', prev_no + 1; end if;
    if prev_res is null then raise exception 'enter results for run % before adding the next run', prev_no; end if;
    if prev_res in ('Marginal','Fail') and not exists (select 1 from core.run_reason where run_id = prev_id) then
      raise exception 'run % was % and needs at least one reason code (BR-14)', prev_no, prev_res;
    end if;
  end if;
  return new;
end $$;
create trigger trg_new_run before insert on core.trial_run
  for each row execute function core.guard_new_run();

-- immutability of recommendation artefacts, decisions, evidence and audit
create trigger trg_rec_lines_immutable before update or delete on rec.recommendation_line
  for each row execute function core.block_change();
create trigger trg_rec_evidence_immutable before update or delete on rec.recommendation_evidence
  for each row execute function core.block_change();
create trigger trg_rec_immutable before update or delete on rec.recommendation
  for each row execute function core.block_change();
create trigger trg_decision_immutable before update or delete on rec.decision
  for each row execute function core.block_change();
create trigger trg_weight_item_immutable before update or delete on rec.weight_item
  for each row execute function core.block_change();
create trigger trg_audit_immutable before update or delete on audit.event
  for each row execute function core.block_change();

-- audit hooks on business tables
create trigger aud_launch after insert or update or delete on core.launch_project
  for each row execute function audit.log_change();
create trigger aud_run after insert or update or delete on core.trial_run
  for each row execute function audit.log_change();
create trigger aud_weight_set after insert or update on rec.weight_set
  for each row execute function audit.log_change();
create trigger aud_recommendation after insert on rec.recommendation
  for each row execute function audit.log_change();
create trigger aud_decision after insert on rec.decision
  for each row execute function audit.log_change();
create trigger aud_sme_rule after insert or update or delete on cfg.sme_rule
  for each row execute function audit.log_change();
create trigger aud_extraction after insert or update on ai.extraction
  for each row execute function audit.log_change();
create trigger aud_rule_suggestion after insert or update on ai.rule_suggestion
  for each row execute function audit.log_change();

-- ================================================================ views
-- One row per launch with the KPIs used on the dashboard (first pass, iterations, loss, days to TA).
create view core.launch_kpi_v as
select
  l.id as launch_id, l.code, l.status, l.product_id, p.category_id, l.line_id,
  l.created_at, l.ta_decision, l.ta_date,
  count(r.id) as runs,
  coalesce(sum(r.loss_kg), 0) as total_loss_kg,
  (l.ta_decision in ('Accepted','Accepted with conditions')
     and (select result from core.trial_run x where x.launch_id = l.id and x.run_no = 1) = 'Pass') as first_pass,
  case when l.ta_date is not null then l.ta_date - l.created_at::date end as days_to_ta,
  exists (select 1 from core.trial_run x where x.launch_id = l.id and x.plan_rec_id is not null) as used_recommendation
from core.launch_project l
join core.product p on p.id = l.product_id
left join core.trial_run r on r.id is not null and r.launch_id = l.id
group by l.id, p.category_id;

-- Run level summary used by the history views.
create view core.run_summary_v as
select r.id as run_id, r.launch_id, l.code as launch_code, r.run_no, r.result, r.status,
       r.loss_kg, r.next_step, r.plan_rec_id, p.name as product_name, p.category_id, l.line_id
from core.trial_run r
join core.launch_project l on l.id = r.launch_id
join core.product p on p.id = l.product_id;
