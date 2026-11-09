-- Custom product fields: category owners define extra fields per category.
-- Fields are retired, never deleted. Values are typed. Matching fields feed the similarity search; information fields do not.

-- ---------------------------------------------------------------- field definitions
alter table cfg.attribute_def drop constraint if exists attribute_def_data_type_check;
alter table cfg.attribute_def add constraint attribute_def_data_type_check
  check (data_type in ('numeric','choice','boolean','text','date'));

alter table cfg.attribute_def
  add column kind text not null default 'matching' check (kind in ('matching','info')),
  add column help_text text,
  add column section text,
  add column sort_order int not null default 0,
  add column status text not null default 'Active' check (status in ('Draft','Active','Retired')),
  add column ai_visible boolean not null default true,        -- false = never sent to Claude
  add column created_by uuid references cfg.app_user(id),
  add column approved_by uuid references cfg.app_user(id),
  add column created_at timestamptz not null default now();

-- Only numeric, choice and boolean fields can drive matching.
alter table cfg.attribute_def add constraint attribute_def_matching_types_check
  check (kind = 'info' or data_type in ('numeric','choice','boolean'));

-- ---------------------------------------------------------------- typed values
alter table core.product_attribute_value
  add column value_text text,
  add column value_date date,
  add column value_bool boolean;
alter table core.product_attribute_value drop constraint if exists product_attribute_value_check;
alter table core.product_attribute_value add constraint product_attribute_value_check
  check (value_num is not null or value_choice is not null or value_text is not null or value_date is not null or value_bool is not null);
alter table core.product_attribute_value add constraint product_attribute_value_text_len check (value_text is null or length(value_text) <= 500);

-- ---------------------------------------------------------------- rules in the database
create or replace function cfg.no_delete_field() returns trigger language plpgsql as $$
begin
  raise exception 'product fields are retired, not deleted (set status to Retired)';
end $$;
create trigger trg_field_no_delete before delete on cfg.attribute_def
  for each row execute function cfg.no_delete_field();

-- The code and the type of a field cannot change once products hold values for it.
create or replace function cfg.guard_field_change() returns trigger language plpgsql as $$
begin
  if (new.code <> old.code or new.data_type <> old.data_type)
     and exists (select 1 from core.product_attribute_value where attribute_def_id = old.id) then
    raise exception 'field "%" already has values: its code and type cannot change. Retire it and add a new field.', old.code;
  end if;
  return new;
end $$;
create trigger trg_field_guard before update on cfg.attribute_def
  for each row execute function cfg.guard_field_change();

-- ---------------------------------------------------------------- audit
create or replace function audit.log_change() returns trigger language plpgsql as $$
declare
  uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  why text := nullif(current_setting('app.reason', true), '');
  rid text;
begin
  if (tg_op = 'DELETE') then rid := coalesce((to_jsonb(old)->>'id'), (to_jsonb(old)->>'code'), (to_jsonb(old)->>'product_id'));
  else rid := coalesce((to_jsonb(new)->>'id'), (to_jsonb(new)->>'code'), (to_jsonb(new)->>'product_id')); end if;
  insert into audit.event(user_id, action, entity, entity_id, before, after, reason)
  values (uid, tg_op, tg_table_schema || '.' || tg_table_name, rid,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end, why);
  return coalesce(new, old);
end $$;

create trigger aud_attribute_def after insert or update on cfg.attribute_def
  for each row execute function audit.log_change();
create trigger aud_attribute_value after insert or update or delete on core.product_attribute_value
  for each row execute function audit.log_change();
