-- Line Intelligence, phase 1: shared asset model (Line > Equipment > Position > Seal/part), inspections, incidents, planned stops.
-- Lines are cfg.line (already used by BAF-1). Everything here is audited; history is append-only.

create schema if not exists ast;

-- a maintenance role joins the existing roles
alter table cfg.app_user drop constraint app_user_role_check;
alter table cfg.app_user add constraint app_user_role_check check (role in
  ('rd_engineer','process_engineer','qa','category_owner','supply_chain','plant_admin','viewer','maintenance'));

-- ---------------------------------------------------------------- structure
create table ast.equipment (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references cfg.line(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('filler','homogeniser','uht','valve_cluster','pump','tank','other')),
  status text not null default 'Active' check (status in ('Active','Retired')),
  unique (line_id, code)
);

-- a position is a place where a seal or gasket sits, for example "Filling valve 3, plug seal"
create table ast.position (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references ast.equipment(id),
  code text not null,
  name text not null,
  assembly text not null,                       -- the group it belongs to, for example "Filling valve 3"
  seal_function text,
  criticality int not null default 3 check (criticality between 1 and 5),  -- consequence of a failure here (5 = product contact, foreign-body route)
  notes text,
  status text not null default 'Active' check (status in ('Active','Retired')),
  unique (equipment_id, code)
);

create table ast.part_type (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  material text not null,
  supplier text,
  nominal_life_days int not null check (nominal_life_days > 0),  -- the planning life, not a prediction
  spec_note text,
  status text not null default 'Active' check (status in ('Active','Retired'))
);

-- a physical seal or gasket (one row per item, with its own passport)
create table ast.part (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  part_type_id uuid not null references ast.part_type(id),
  lot text,
  received_on date,
  status text not null default 'Available' check (status in ('Available','Installed','Removed','Scrapped'))
);

-- where a part sat and for how long
create table ast.installation (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references ast.part(id),
  position_id uuid not null references ast.position(id),
  installed_on date not null,
  removed_on date,
  removal_reason text check (removal_reason in ('planned_replacement','failure','inspection_finding','upgrade','other')),
  installed_by uuid references cfg.app_user(id),
  note text,
  check (removed_on is null or removed_on >= installed_on),
  check ((removed_on is null) = (removal_reason is null))
);
create unique index installation_one_open_per_position on ast.installation (position_id) where removed_on is null;
create unique index installation_one_open_per_part on ast.installation (part_id) where removed_on is null;
create index on ast.installation (position_id, installed_on);

create table ast.inspection (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references ast.installation(id),
  inspected_on date not null,
  rating int not null check (rating between 1 and 5),   -- 1 like new, 2 light wear, 3 visible wear, 4 damaged, 5 failed
  finding text,
  inspector_id uuid references cfg.app_user(id),
  created_at timestamptz not null default now()
);
create index on ast.inspection (installation_id, inspected_on);

create table ast.incident (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references ast.position(id),
  installation_id uuid references ast.installation(id),
  occurred_on date not null,
  kind text not null check (kind in ('foreign_body','leak','seal_failure','contamination_risk')),
  severity text not null check (severity in ('Minor','Major','Critical')),
  description text,
  reported_by uuid references cfg.app_user(id),
  created_at timestamptz not null default now()
);
create index on ast.incident (position_id, occurred_on);

-- one calendar for seal replacement, maintenance windows and trial scheduling
create table ast.planned_stop (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references cfg.line(id),
  start_on date not null,
  end_on date not null,
  kind text not null check (kind in ('CIP','changeover','maintenance','shutdown')),
  note text,
  status text not null default 'Planned' check (status in ('Planned','Done','Cancelled')),
  created_by uuid references cfg.app_user(id),
  check (end_on >= start_on)
);
create index on ast.planned_stop (line_id, start_on);

-- ---------------------------------------------------------------- rules in the database
-- BR-A1/A2: one open installation per position and per part (unique indexes above).
-- BR-A3: a new installation cannot start before the previous one at that position ended; the part must be available.
create or replace function ast.guard_install() returns trigger language plpgsql as $$
declare last_end date; pstatus text; pos_status text;
begin
  if tg_op = 'INSERT' then
    select max(removed_on) into last_end from ast.installation where position_id = new.position_id;
    if last_end is not null and new.installed_on < last_end then
      raise exception 'A seal cannot be installed on % because the previous seal at this position was removed on %', new.installed_on, last_end;
    end if;
    select status into pos_status from ast.position where id = new.position_id;
    if pos_status <> 'Active' then raise exception 'This position is retired'; end if;
    select status into pstatus from ast.part where id = new.part_id;
    if pstatus <> 'Available' then raise exception 'Part is % and cannot be installed', pstatus; end if;
    if new.removed_on is not null and new.installed_on > new.removed_on then raise exception 'Removed date is before installed date'; end if;
    update ast.part set status = case when new.removed_on is null then 'Installed' when new.removal_reason = 'failure' then 'Scrapped' else 'Removed' end where id = new.part_id;
    return new;
  end if;
  -- UPDATE: the only allowed change is closing an open installation, once
  if old.removed_on is not null then raise exception 'This installation is closed and cannot be changed'; end if;
  if new.part_id <> old.part_id or new.position_id <> old.position_id or new.installed_on <> old.installed_on or new.installed_by is distinct from old.installed_by then
    raise exception 'Only the removal can be recorded on an installation';
  end if;
  if new.removed_on is null then raise exception 'Nothing to change'; end if;
  update ast.part set status = case when new.removal_reason = 'failure' then 'Scrapped' else 'Removed' end where id = new.part_id;
  return new;
end $$;
create trigger trg_install before insert or update on ast.installation for each row execute function ast.guard_install();
create trigger trg_install_nodelete before delete on ast.installation for each row execute function core.block_change();

-- BR-A4: inspections must fall inside the time the part was installed; they cannot be changed or deleted.
create or replace function ast.guard_inspection() returns trigger language plpgsql as $$
declare i record;
begin
  select installed_on, removed_on into i from ast.installation where id = new.installation_id;
  if new.inspected_on < i.installed_on then raise exception 'Inspection date is before the seal was installed'; end if;
  if i.removed_on is not null and new.inspected_on > i.removed_on then raise exception 'Inspection date is after the seal was removed'; end if;
  if new.inspected_on > current_date then raise exception 'Inspection date is in the future'; end if;
  return new;
end $$;
create trigger trg_inspection_check before insert on ast.inspection for each row execute function ast.guard_inspection();
create trigger trg_inspection_immutable before update or delete on ast.inspection for each row execute function core.block_change();
create trigger trg_incident_immutable before update or delete on ast.incident for each row execute function core.block_change();

-- BR-A5: codes never change; nothing in the structure is deleted (retire instead); a position with a seal in it cannot be retired.
create or replace function ast.guard_structure() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception '% rows are retired, never deleted', tg_table_schema || '.' || tg_table_name; end if;
  if new.code <> old.code then raise exception 'Code cannot be changed once created'; end if;
  if tg_table_name = 'position' and new.status = 'Retired' and old.status <> 'Retired'
     and exists (select 1 from ast.installation where position_id = old.id and removed_on is null) then
    raise exception 'Remove the seal from this position before retiring it';
  end if;
  return new;
end $$;
create trigger trg_equipment_guard before update or delete on ast.equipment for each row execute function ast.guard_structure();
create trigger trg_position_guard before update or delete on ast.position for each row execute function ast.guard_structure();
create trigger trg_part_type_guard before update or delete on ast.part_type for each row execute function ast.guard_structure();
create trigger trg_part_guard before update or delete on ast.part for each row execute function ast.guard_structure();

-- BR-A6: planned stops are cancelled, not deleted
create or replace function ast.guard_stop() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Planned stops are cancelled, never deleted'; end if;
  if old.status <> 'Planned' then raise exception 'A % stop cannot be changed', lower(old.status); end if;
  return new;
end $$;
create trigger trg_stop_guard before update or delete on ast.planned_stop for each row execute function ast.guard_stop();

-- audit
create trigger aud_equipment after insert or update on ast.equipment for each row execute function audit.log_change();
create trigger aud_position after insert or update on ast.position for each row execute function audit.log_change();
create trigger aud_part_type after insert or update on ast.part_type for each row execute function audit.log_change();
create trigger aud_part after insert on ast.part for each row execute function audit.log_change();
create trigger aud_installation after insert or update on ast.installation for each row execute function audit.log_change();
create trigger aud_inspection after insert on ast.inspection for each row execute function audit.log_change();
create trigger aud_incident after insert on ast.incident for each row execute function audit.log_change();
create trigger aud_stop after insert or update on ast.planned_stop for each row execute function audit.log_change();

-- ---------------------------------------------------------------- read model: every position with its current seal
create or replace view ast.v_position as
select p.id as position_id, p.code as position_code, p.name as position_name, p.assembly, p.seal_function, p.criticality, p.status as position_status,
       e.id as equipment_id, e.code as equipment_code, e.name as equipment_name, e.kind as equipment_kind,
       l.id as line_id, l.code as line_code, l.name as line_name,
       i.id as installation_id, i.installed_on,
       pt.id as part_id, pt.code as part_code, t.id as part_type_id, t.code as part_type_code, t.name as part_type_name, t.material, t.nominal_life_days,
       case when i.id is not null then (current_date - i.installed_on) end as age_days,
       (select r.rating from ast.inspection r where r.installation_id = i.id order by r.inspected_on desc, r.created_at desc limit 1) as last_rating,
       (select r.inspected_on from ast.inspection r where r.installation_id = i.id order by r.inspected_on desc, r.created_at desc limit 1) as last_inspected_on,
       (select count(*)::int from ast.incident n where n.position_id = p.id and n.occurred_on >= current_date - 365) as incidents_12m
from ast.position p
join ast.equipment e on e.id = p.equipment_id
join cfg.line l on l.id = e.line_id
left join ast.installation i on i.position_id = p.id and i.removed_on is null
left join ast.part pt on pt.id = i.part_id
left join ast.part_type t on t.id = pt.part_type_id;
