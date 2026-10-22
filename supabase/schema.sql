-- =====================================================================
-- CampusFix — Supabase setup. Paste this whole file into
-- Supabase Dashboard > SQL Editor > New query, then click Run.
-- Safe to run more than once (also safe if you ran an older version).
-- =====================================================================

-- ---------- tables ----------
create sequence if not exists public.issue_ref_seq start 1001;

create table if not exists public.issues (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('CF-' || nextval('public.issue_ref_seq')),
  title          text not null check (char_length(title) between 4 and 80),
  category       text not null check (category in ('Water','Electrical','Facilities','Sanitation','Building','Network / IT','Other')),
  priority       text not null default 'Normal' check (priority in ('Low','Normal','Urgent')),
  location       text not null check (char_length(location) between 2 and 80),
  description    text not null check (char_length(description) between 10 and 800),
  reporter       text check (char_length(reporter) <= 50),
  reporter_email text check (char_length(reporter_email) <= 254),
  user_id        uuid references auth.users(id) on delete set null,
  image_path     text check (image_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  status         text not null default 'Pending' check (status in ('Pending','In Progress','Resolved')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- for projects created from an older version of this file
alter table public.issues add column if not exists reporter_email text;
alter table public.issues add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists issues_created_idx on public.issues (created_at desc);
create index if not exists issues_user_idx on public.issues (user_id);

create table if not exists public.issue_events (
  id         bigint generated always as identity primary key,
  issue_id   uuid not null references public.issues(id) on delete cascade,
  event      text not null,
  note       text not null default '' check (char_length(note) <= 400),
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists issue_events_issue_idx on public.issue_events (issue_id);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.rate_hits (
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_idx on public.rate_hits (ip, at);

-- ---------- helper: is the signed-in user staff? ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------- lock everything down, then open only what is needed ----------
alter table public.issues       enable row level security;
alter table public.issue_events enable row level security;
alter table public.admins       enable row level security;
alter table public.rate_hits    enable row level security;

revoke all on public.issues, public.issue_events, public.admins, public.rate_hits from anon, authenticated;
grant select, delete on public.issues       to authenticated;   -- narrowed to staff by the policies below
grant select         on public.issue_events to authenticated;

drop policy if exists "staff read issues"   on public.issues;
drop policy if exists "staff delete issues" on public.issues;
drop policy if exists "staff read events"   on public.issue_events;
create policy "staff read issues"   on public.issues       for select to authenticated using (public.is_admin());
create policy "staff delete issues" on public.issues       for delete to authenticated using (public.is_admin());
create policy "staff read events"   on public.issue_events for select to authenticated using (public.is_admin());

-- ---------- public view: what everyone may see (no names, no emails) ----------
-- Intentionally runs with the owner's rights so visitors can read it without table access.
-- Supabase's Security Advisor may flag "Security Definer View" for this; that is expected.
create or replace view public.public_issues as
select i.id, i.ref, i.title, i.category, i.location, i.description, i.priority, i.status,
       i.image_path, i.created_at, i.updated_at,
       coalesce((select json_agg(json_build_object('at', e.created_at, 'event', e.event, 'note', e.note) order by e.created_at)
                 from public.issue_events e where e.issue_id = i.id), '[]'::json) as history
from public.issues i;
revoke all on public.public_issues from public;
grant select on public.public_issues to anon, authenticated;

-- ---------- "My reports": ids of the signed-in student's own reports ----------
create or replace view public.my_issue_ids as
select i.id from public.issues i where i.user_id = auth.uid();
revoke all on public.my_issue_ids from public, anon;
grant select on public.my_issue_ids to authenticated;

-- ---------- signed-in students submit through this function only ----------
drop function if exists public.submit_issue(text,text,text,text,text,text,text,text);  -- older version
create or replace function public.submit_issue(
  p_title text, p_category text, p_priority text, p_location text,
  p_description text, p_image_path text, p_website text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ip text; v_ref text; v_id uuid; v_key text; v_keys text[];
  v_name  text := left(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')), 50);
  v_email text := left(btrim(coalesce(auth.jwt() ->> 'email', '')), 254);
  v_title text := left(btrim(coalesce(p_title, '')), 80);
  v_loc   text := left(btrim(coalesce(p_location, '')), 80);
  v_desc  text := left(btrim(coalesce(p_description, '')), 800);
  v_prio  text := case when p_priority in ('Low','Normal','Urgent') then p_priority else 'Normal' end;
begin
  if v_uid is null then raise exception 'Please sign in to report an issue.'; end if;
  if coalesce(p_website, '') <> '' then return 'CF-0000'; end if;            -- spam trap
  if char_length(v_title) < 4  then raise exception 'Title must be at least 4 characters.'; end if;
  if char_length(v_loc)   < 2  then raise exception 'Enter the location.'; end if;
  if char_length(v_desc)  < 10 then raise exception 'Description must be at least 10 characters.'; end if;
  if p_category not in ('Water','Electrical','Facilities','Sanitation','Building','Network / IT','Other') then
    raise exception 'Choose a category.';
  end if;

  -- limit: 8 reports per hour per account and per IP address
  v_ip := split_part(coalesce((nullif(current_setting('request.headers', true), '')::json) ->> 'x-forwarded-for', ''), ',', 1);
  v_keys := array['u:' || v_uid::text];
  if v_ip <> '' then v_keys := v_keys || ('ip:' || v_ip); end if;
  foreach v_key in array v_keys loop
    if (select count(*) from public.rate_hits where ip = v_key and at > now() - interval '1 hour') >= 8 then
      raise exception 'Too many reports in a short time. Please try again later.';
    end if;
  end loop;
  foreach v_key in array v_keys loop insert into public.rate_hits (ip) values (v_key); end loop;
  delete from public.rate_hits where at < now() - interval '1 day';

  insert into public.issues (title, category, priority, location, description, reporter, reporter_email, user_id, image_path)
  values (v_title, p_category, v_prio, v_loc, v_desc, nullif(v_name, ''), nullif(v_email, ''), v_uid, nullif(p_image_path, ''))
  returning id, ref into v_id, v_ref;

  insert into public.issue_events (issue_id, event, by_name)
  values (v_id, 'Issue reported', coalesce(nullif(v_name, ''), 'Student'));
  return v_ref;
end $$;
revoke execute on function public.submit_issue(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.submit_issue(text,text,text,text,text,text,text) to authenticated;

-- ---------- staff update status / add a note ----------
create or replace function public.admin_update_issue(p_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text; v_note text := left(btrim(coalesce(p_note, '')), 400);
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if p_status not in ('Pending','In Progress','Resolved') then raise exception 'Invalid status.'; end if;
  select status into v_old from public.issues where id = p_id for update;
  if not found then raise exception 'Report not found.'; end if;
  if p_status <> v_old then
    update public.issues set status = p_status, updated_at = now() where id = p_id;
    insert into public.issue_events (issue_id, event, note, by_name) values (p_id, 'Status changed to ' || p_status, v_note, 'Maintenance');
  elsif v_note <> '' then
    update public.issues set updated_at = now() where id = p_id;
    insert into public.issue_events (issue_id, event, note, by_name) values (p_id, 'Note added', v_note, 'Maintenance');
  else
    raise exception 'Change the status or add a note.';
  end if;
end $$;
revoke execute on function public.admin_update_issue(uuid,text,text) from public;
grant execute on function public.admin_update_issue(uuid,text,text) to authenticated;

-- ---------- photo storage (signed-in students only) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-photos', 'issue-photos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "anyone can upload issue photos"        on storage.objects;
drop policy if exists "signed-in users can upload issue photos" on storage.objects;
drop policy if exists "staff can delete issue photos"         on storage.objects;
create policy "signed-in users can upload issue photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-photos');
create policy "staff can delete issue photos" on storage.objects for delete to authenticated
  using (bucket_id = 'issue-photos' and public.is_admin());

-- =====================================================================
-- LAST STEP: make your staff accounts staff. First create the account
-- (staff can use "Create account" on the website like anyone else), then run:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'staff@yourschool.edu';
-- =====================================================================
