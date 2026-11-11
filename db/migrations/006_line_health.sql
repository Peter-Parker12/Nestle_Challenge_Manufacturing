-- Line Intelligence, phase 3: line health for a filler (DNF-2 "Hey, Filler").
-- Stations belong to equipment from the asset model. A station's "assembly" ties it to the seal positions in that assembly (BAF-2).

create schema if not exists ops;

create table ops.station (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references ast.equipment(id),
  code text not null,
  name text not null,
  assembly text,                                   -- matches ast.position.assembly on the same equipment
  status text not null default 'Active' check (status in ('Active','Retired')),
  unique (equipment_id, code)
);

create table ops.alarm_event (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references ast.equipment(id),
  station_id uuid references ops.station(id),
  occurred_at timestamptz not null,
  code text not null,
  description text not null,
  severity text not null check (severity in ('Info','Warning','Fault')),
  duration_s int check (duration_s >= 0)
);
create index on ops.alarm_event (equipment_id, occurred_at);
create index on ops.alarm_event (station_id, occurred_at);

create table ops.kpi_daily (
  equipment_id uuid not null references ast.equipment(id),
  day date not null,
  eups numeric not null check (eups between 0 and 100),          -- efficiency, %
  speed_pct numeric not null check (speed_pct between 0 and 150),
  unplanned_downtime_min numeric not null check (unplanned_downtime_min >= 0),
  defects int not null default 0 check (defects >= 0),
  material_loss_kg numeric not null default 0 check (material_loss_kg >= 0),
  primary key (equipment_id, day)
);

create table ops.breakdown (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references ast.equipment(id),
  station_id uuid references ops.station(id),
  started_at timestamptz not null,
  minutes int not null check (minutes > 0),
  cause text not null,
  fix text
);
create index on ops.breakdown (equipment_id, started_at);

create table ops.defect (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references ast.equipment(id),
  station_id uuid references ops.station(id),
  occurred_on date not null,
  kind text not null,
  qty int not null check (qty > 0)
);
create index on ops.defect (equipment_id, occurred_on);

-- cleaning, inspection, lubrication (CIL), centerlining checks, PM03 and repairs
create table ops.maintenance_task (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references ast.equipment(id),
  station_id uuid references ops.station(id),
  kind text not null check (kind in ('CIL','centerlining','PM03','repair')),
  title text not null,
  due_on date not null,
  done_on date,
  note text
);
create index on ops.maintenance_task (equipment_id, due_on);

-- the approved window for each setting (centerline). Corrections must stay inside it, enforced here.
create table ops.setting (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references ops.station(id),
  code text not null,
  name text not null,
  unit text not null,
  target numeric not null,
  min_value numeric not null,
  max_value numeric not null,
  current_value numeric not null,
  updated_at timestamptz not null default now(),
  unique (station_id, code),
  check (min_value <= target and target <= max_value)
);

-- a person records that they changed a setting. The system never writes to the machine.
create table ops.correction (
  id uuid primary key default gen_random_uuid(),
  setting_id uuid not null references ops.setting(id),
  from_value numeric not null,
  to_value numeric not null,
  reason text not null,
  applied_by uuid references cfg.app_user(id),
  applied_at timestamptz not null default now()
);
create trigger trg_correction_immutable before update or delete on ops.correction for each row execute function core.block_change();

-- BR-H1: a correction must stay inside the approved window, must change the value, and starts from the value on record.
create or replace function ops.guard_correction() returns trigger language plpgsql as $$
declare s record;
begin
  select * into s from ops.setting where id = new.setting_id for update;
  if new.to_value < s.min_value or new.to_value > s.max_value then
    raise exception 'The value % is outside the approved range % to % for %', new.to_value, s.min_value, s.max_value, s.name;
  end if;
  if new.to_value = s.current_value then raise exception 'The setting is already at %', new.to_value; end if;
  if new.from_value <> s.current_value then raise exception 'The setting changed since you looked (now %). Reload and try again', s.current_value; end if;
  if coalesce(length(trim(new.reason)),0) < 5 then raise exception 'Say why the setting is changed'; end if;
  update ops.setting set current_value = new.to_value, updated_at = now() where id = new.setting_id;
  return new;
end $$;
create trigger trg_correction_guard before insert on ops.correction for each row execute function ops.guard_correction();

-- troubleshooting guides written by experts. The assistant may only quote steps from here.
create table ops.guide (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  alarm_codes text[] not null default '{}',
  keywords text[] not null default '{}',
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 30),
  source text,
  status text not null default 'Active' check (status in ('Active','Retired')),
  created_by uuid references cfg.app_user(id)
);
create or replace function ops.guard_guide() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Guides are retired, never deleted'; end if;
  if new.code <> old.code then raise exception 'Code cannot be changed once created'; end if;
  return new;
end $$;
create trigger trg_guide_guard before update or delete on ops.guide for each row execute function ops.guard_guide();

create trigger aud_station after insert or update on ops.station for each row execute function audit.log_change();
create trigger aud_setting after update on ops.setting for each row execute function audit.log_change();
create trigger aud_correction after insert on ops.correction for each row execute function audit.log_change();
create trigger aud_task after insert or update on ops.maintenance_task for each row execute function audit.log_change();
create trigger aud_guide after insert or update on ops.guide for each row execute function audit.log_change();
