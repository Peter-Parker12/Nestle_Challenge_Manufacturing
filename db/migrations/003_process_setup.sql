-- Process setup: category owners and plant admins manage process parameters, quality tests and line capability.
-- Items are retired, never deleted. Identity (code, unit) is fixed once runs reference them.
-- Also: each recommendation stores a snapshot of the inputs it used, so it stays reproducible if definitions change later.

-- ---------------------------------------------------------------- quality tests: retire instead of delete
alter table cfg.quality_test_def
  add column status text not null default 'Active' check (status in ('Active','Retired')),
  add column help_text text,
  add column created_by uuid references cfg.app_user(id),
  add column created_at timestamptz not null default now();

alter table cfg.parameter_def
  add column help_text text,
  add column created_by uuid references cfg.app_user(id),
  add column created_at timestamptz not null default now();

create or replace function cfg.no_delete_setup() returns trigger language plpgsql as $$
begin
  raise exception '% items are retired, not deleted', tg_table_name;
end $$;
create trigger trg_param_no_delete before delete on cfg.parameter_def for each row execute function cfg.no_delete_setup();
create trigger trg_test_no_delete before delete on cfg.quality_test_def for each row execute function cfg.no_delete_setup();

create or replace function cfg.guard_parameter_change() returns trigger language plpgsql as $$
begin
  if (new.code <> old.code or new.unit <> old.unit) and exists (select 1 from core.run_parameter where parameter_def_id = old.id) then
    raise exception 'parameter "%" already has run data: its code and unit cannot change. Retire it and add a new one.', old.code;
  end if;
  return new;
end $$;
create trigger trg_param_guard before update on cfg.parameter_def for each row execute function cfg.guard_parameter_change();

create or replace function cfg.guard_test_change() returns trigger language plpgsql as $$
begin
  if (new.code <> old.code or new.unit is distinct from old.unit) and exists (select 1 from core.run_quality where quality_test_def_id = old.id) then
    raise exception 'quality test "%" already has results: its code and unit cannot change. Retire it and add a new one.', old.code;
  end if;
  return new;
end $$;
create trigger trg_test_guard before update on cfg.quality_test_def for each row execute function cfg.guard_test_change();

-- ---------------------------------------------------------------- audit
create or replace function audit.log_change() returns trigger language plpgsql as $$
declare
  uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  why text := nullif(current_setting('app.reason', true), '');
  rid text;
begin
  if (tg_op = 'DELETE') then rid := coalesce((to_jsonb(old)->>'id'), (to_jsonb(old)->>'code'), (to_jsonb(old)->>'product_id'), (to_jsonb(old)->>'line_id'));
  else rid := coalesce((to_jsonb(new)->>'id'), (to_jsonb(new)->>'code'), (to_jsonb(new)->>'product_id'), (to_jsonb(new)->>'line_id')); end if;
  insert into audit.event(user_id, action, entity, entity_id, before, after, reason)
  values (uid, tg_op, tg_table_schema || '.' || tg_table_name, rid,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end, why);
  return coalesce(new, old);
end $$;
create trigger aud_parameter_def after insert or update on cfg.parameter_def for each row execute function audit.log_change();
create trigger aud_quality_test_def after insert or update on cfg.quality_test_def for each row execute function audit.log_change();
create trigger aud_process_step after insert or update on cfg.process_step for each row execute function audit.log_change();
create trigger aud_line_capability after insert or update on cfg.line_capability for each row execute function audit.log_change();

-- ---------------------------------------------------------------- reproducibility
alter table rec.recommendation add column inputs_snapshot jsonb;
