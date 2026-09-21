-- Rabotec fleet tracker schema. Apply in a new Supabase project.
create type public.fleet_role as enum ('Admin', 'Editor', 'Viewer');
create type public.vehicle_category as enum ('LV', 'DT', 'ADT', 'Service Truck', 'Lowbed');
create type public.vehicle_site as enum ('Abore Pit', 'Esaase Pit', 'Other');
create type public.vehicle_operating_status as enum ('Active', 'Grounded', 'Under Maintenance');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.fleet_role not null default 'Viewer',
  site public.vehicle_site,
  created_at timestamptz not null default now()
);

create function public.create_fleet_profile() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger create_fleet_profile after insert on auth.users
for each row execute function public.create_fleet_profile();

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  category public.vehicle_category not null,
  make_model text not null default '',
  site public.vehicle_site not null,
  status public.vehicle_operating_status not null default 'Active',
  roadworthy_cert_no text not null default '',
  roadworthy_issue_date date,
  roadworthy_expiry_date date,
  insurance_provider text not null default '',
  insurance_policy_no text not null default '',
  insurance_expiry_date date,
  document_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint plate_number_not_blank check (length(trim(plate_number)) > 0),
  constraint roadworthy_dates_ordered check (roadworthy_issue_date is null or roadworthy_expiry_date is null or roadworthy_issue_date <= roadworthy_expiry_date)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  changed_by uuid references auth.users(id),
  change_summary text not null,
  before_state jsonb,
  after_state jsonb,
  changed_at timestamptz not null default now()
);

create table public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  document_kind text not null check (document_kind in ('roadworthy', 'insurance')),
  expiry_date date not null,
  days_before integer not null check (days_before in (30, 14, 7)),
  sent_at timestamptz not null default now(),
  unique (vehicle_id, document_kind, expiry_date, days_before)
);

create index vehicles_site_status_idx on public.vehicles (site, status);
create index vehicles_roadworthy_expiry_idx on public.vehicles (roadworthy_expiry_date);
create index vehicles_insurance_expiry_idx on public.vehicles (insurance_expiry_date);
create index audit_vehicle_changed_idx on public.audit_log (vehicle_id, changed_at desc);

create function public.fleet_role_for_current_user() returns public.fleet_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = (select auth.uid()) $$;

create function public.fleet_site_for_current_user() returns public.vehicle_site
language sql stable security definer set search_path = public
as $$ select site from public.profiles where id = (select auth.uid()) $$;

create function public.can_access_fleet_site(target_site public.vehicle_site) returns boolean
language sql stable security definer set search_path = public
as $$ select public.fleet_role_for_current_user() is not null and (public.fleet_site_for_current_user() is null or public.fleet_site_for_current_user() = target_site) $$;

create function public.stamp_vehicle_change() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.plate_number := upper(trim(new.plate_number));
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create function public.record_vehicle_change() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  changed_fields text;
begin
  if tg_op = 'UPDATE' then
    select string_agg(field.key, ', ' order by field.key) into changed_fields
    from jsonb_each(to_jsonb(new)) field
    where field.value is distinct from (to_jsonb(old) -> field.key)
      and field.key not in ('updated_at', 'updated_by');
  end if;
  insert into public.audit_log (vehicle_id, changed_by, change_summary, before_state, after_state)
  values (new.id, auth.uid(), case when tg_op = 'INSERT' then 'Vehicle added' else 'Updated: ' || coalesce(changed_fields, 'no data fields') end,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;

create trigger stamp_vehicle_change before insert or update on public.vehicles
for each row execute function public.stamp_vehicle_change();
create trigger record_vehicle_change after insert or update on public.vehicles
for each row execute function public.record_vehicle_change();

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.audit_log enable row level security;
alter table public.alert_deliveries enable row level security;

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.fleet_role_for_current_user() = 'Admin');
create policy profiles_admin_write on public.profiles for all to authenticated
using (public.fleet_role_for_current_user() = 'Admin')
with check (public.fleet_role_for_current_user() = 'Admin');

create policy vehicles_read on public.vehicles for select to authenticated
using (public.can_access_fleet_site(site));
create policy vehicles_insert on public.vehicles for insert to authenticated
with check (public.fleet_role_for_current_user() in ('Admin', 'Editor') and public.can_access_fleet_site(site));
create policy vehicles_update on public.vehicles for update to authenticated
using (public.fleet_role_for_current_user() in ('Admin', 'Editor') and public.can_access_fleet_site(site))
with check (public.fleet_role_for_current_user() in ('Admin', 'Editor') and public.can_access_fleet_site(site));

create policy audit_read on public.audit_log for select to authenticated
using (exists (select 1 from public.vehicles v where v.id = vehicle_id and public.can_access_fleet_site(v.site)));
create policy alerts_admin_read on public.alert_deliveries for select to authenticated
using (public.fleet_role_for_current_user() = 'Admin');

insert into storage.buckets (id, name, public) values ('fleet-documents', 'fleet-documents', false);
create policy fleet_documents_read on storage.objects for select to authenticated
using (bucket_id = 'fleet-documents' and exists (
  select 1 from public.vehicles v
  where v.id::text = split_part(name, '/', 1) and public.can_access_fleet_site(v.site)
));
create policy fleet_documents_write on storage.objects for insert to authenticated
with check (bucket_id = 'fleet-documents' and public.fleet_role_for_current_user() in ('Admin', 'Editor') and exists (
  select 1 from public.vehicles v
  where v.id::text = split_part(name, '/', 1) and public.can_access_fleet_site(v.site)
));
create policy fleet_documents_delete on storage.objects for delete to authenticated
using (bucket_id = 'fleet-documents' and public.fleet_role_for_current_user() in ('Admin', 'Editor') and exists (
  select 1 from public.vehicles v
  where v.id::text = split_part(name, '/', 1) and public.can_access_fleet_site(v.site)
));

-- RLS limits which rows can be changed; these grants also limit which
-- columns an authenticated API caller may change.
revoke all on public.profiles from anon, authenticated;
revoke all on public.vehicles from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;
revoke all on public.alert_deliveries from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, role, site) on public.profiles to authenticated;
grant select on public.vehicles to authenticated;
grant insert (plate_number, category, make_model, site, status,
  roadworthy_cert_no, roadworthy_issue_date, roadworthy_expiry_date,
  insurance_provider, insurance_policy_no, insurance_expiry_date,
  document_urls) on public.vehicles to authenticated;
grant update (plate_number, category, make_model, site, status,
  roadworthy_cert_no, roadworthy_issue_date, roadworthy_expiry_date,
  insurance_provider, insurance_policy_no, insurance_expiry_date,
  document_urls) on public.vehicles to authenticated;
grant select on public.audit_log to authenticated;
grant select on public.alert_deliveries to authenticated;

-- Create staff through Supabase Auth with public signup disabled. Promote the
-- first account to Admin in the SQL editor; later role changes use Admin access.
