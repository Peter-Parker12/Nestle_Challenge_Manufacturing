-- Line Intelligence, phase 2: exposure ledger, seal risk (weights, snapshots, alerts), photo inspection.

-- what each seal type is rated for (null = not rated, the factor is then left out and said so)
alter table ast.part_type
  add column nominal_run_hours int check (nominal_run_hours > 0),
  add column nominal_cip_cycles int check (nominal_cip_cycles > 0),
  add column max_temp_c numeric,
  add column max_pressure_bar numeric;

-- exposure ledger: one row per equipment per week (aggregates, not raw sensor streams)
create table ast.exposure (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references ast.equipment(id),
  week_start date not null check (extract(isodow from week_start) = 1),   -- a Monday
  run_hours numeric not null check (run_hours between 0 and 168),
  cip_cycles int not null default 0 check (cip_cycles >= 0),
  avg_temp_c numeric,
  max_temp_c numeric,
  avg_pressure_bar numeric,
  max_pressure_bar numeric,
  source text not null default 'import',
  unique (equipment_id, week_start)
);
create trigger aud_exposure after insert or update on ast.exposure for each row execute function audit.log_change();

-- engineers' factor weights (0 to 5), one row, every change audited
create table ast.risk_config (
  id int primary key default 1 check (id = 1),
  weights jsonb not null,
  updated_by uuid references cfg.app_user(id),
  updated_at timestamptz not null default now()
);
create trigger aud_risk_config after insert or update on ast.risk_config for each row execute function audit.log_change();

-- one score per position per day, with the factor breakdown that produced it
create table ast.risk_snapshot (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references ast.position(id),
  installation_id uuid not null references ast.installation(id),
  computed_on date not null,
  score numeric not null,
  level text not null check (level in ('Low','Medium','High')),
  projected_high_on date,
  factors jsonb not null,
  engine_version text not null,
  unique (position_id, computed_on)
);

-- alerts: raised by the engine, handled by people
create table ast.alert (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references ast.position(id),
  installation_id uuid not null references ast.installation(id),
  level text not null check (level in ('Low','Medium','High')),
  score numeric not null,
  projected_high_on date,
  summary text not null,
  state text not null default 'New' check (state in ('New','Acknowledged','Planned','Done','Deferred','Dismissed')),
  planned_stop_id uuid references ast.planned_stop(id),
  state_reason text,
  defer_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index alert_one_open_per_position on ast.alert (position_id) where state in ('New','Acknowledged','Planned','Deferred');
create index on ast.alert (state, level);

-- BR-S1: only listed state changes. BR-S2: Planned needs a stop, Deferred a reason and a date, Dismissed a reason.
-- BR-S3: Done only once the seal has been replaced. BR-S4: a seal rated damaged or failed, or a foreign body found in the last 30 days, cannot be dismissed.
create or replace function ast.guard_alert() returns trigger language plpgsql as $$
declare ok boolean; cur uuid; lastr int;
begin
  if tg_op = 'DELETE' then raise exception 'Alerts are closed, never deleted'; end if;
  if tg_op = 'INSERT' then
    if new.state <> 'New' then raise exception 'An alert starts as New'; end if;
    return new;
  end if;
  if new.position_id <> old.position_id or new.installation_id <> old.installation_id then raise exception 'An alert stays with its seal'; end if;
  new.updated_at := now();
  if new.state = old.state then
    if old.state in ('Done','Dismissed') then raise exception 'A % alert cannot be changed', lower(old.state); end if;
    return new;   -- the engine refreshing score and summary
  end if;
  ok := case old.state
    when 'New' then new.state in ('Acknowledged','Planned','Deferred','Dismissed','Done')
    when 'Acknowledged' then new.state in ('Planned','Deferred','Dismissed','Done')
    when 'Planned' then new.state in ('Acknowledged','Deferred','Done')
    when 'Deferred' then new.state in ('New','Acknowledged','Planned','Dismissed','Done')
    else false end;
  if not ok then raise exception 'An alert cannot go from % to %', old.state, new.state; end if;
  if new.state = 'Planned' and new.planned_stop_id is null then raise exception 'Choose the planned stop for this seal change'; end if;
  if new.state = 'Deferred' and (coalesce(length(trim(new.state_reason)),0) < 5 or new.defer_until is null) then raise exception 'Deferring needs a reason and a date to look again'; end if;
  if new.state = 'Dismissed' then
    if coalesce(length(trim(new.state_reason)),0) < 5 then raise exception 'Dismissing needs a reason'; end if;
    select rating into lastr from ast.inspection where installation_id = old.installation_id order by inspected_on desc, created_at desc limit 1;
    if coalesce(lastr,0) >= 4 or exists (select 1 from ast.incident where position_id = old.position_id and kind = 'foreign_body' and occurred_on >= current_date - 30) then
      raise exception 'This alert cannot be dismissed: the seal is rated damaged or failed, or a foreign body was found in the last 30 days. Replace the seal or record a better inspection first';
    end if;
  end if;
  if new.state = 'Done' then
    select installation_id into cur from ast.v_position where position_id = old.position_id;
    if cur is not distinct from old.installation_id then raise exception 'Mark an alert done after the seal has been replaced'; end if;
    new.closed_at := now();
  end if;
  if new.state in ('Dismissed') then new.closed_at := now(); end if;
  return new;
end $$;
create trigger trg_alert_guard before insert or update or delete on ast.alert for each row execute function ast.guard_alert();
create trigger aud_alert after insert or update on ast.alert for each row execute function audit.log_change();

-- photo inspection. The AI assessment is stored server-side; the inspection copies its rating.
create table ast.photo_analysis (
  id uuid primary key default gen_random_uuid(),
  photo_sha text not null,
  rating int not null check (rating between 1 and 5),
  findings text not null,
  confidence text not null check (confidence in ('low','medium','high')),
  model text not null,
  created_by uuid references cfg.app_user(id),
  created_at timestamptz not null default now()
);
create trigger trg_photo_analysis_immutable before update or delete on ast.photo_analysis for each row execute function core.block_change();

alter table ast.inspection
  add column ai_analysis_id uuid references ast.photo_analysis(id),
  add column ai_rating int check (ai_rating between 1 and 5),
  add column override_reason text;

create table ast.inspection_photo (
  inspection_id uuid primary key references ast.inspection(id),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  data bytea not null check (octet_length(data) <= 5242880)
);
create trigger trg_photo_immutable before update or delete on ast.inspection_photo for each row execute function core.block_change();

-- BR-S5 (one way): the assessment can raise concern, only a person can lower it, and must say why.
create or replace function ast.guard_ai_inspection() returns trigger language plpgsql as $$
begin
  if new.ai_rating is not null and new.rating < new.ai_rating and coalesce(length(trim(new.override_reason)),0) < 5 then
    raise exception 'The photo assessment rated this % (%). To record a lower rating, explain why', new.ai_rating, 'higher';
  end if;
  return new;
end $$;
create trigger trg_inspection_ai before insert on ast.inspection for each row execute function ast.guard_ai_inspection();
