-- Chore Board — run once in Supabase: SQL Editor → New query → paste → Run.
-- Safe to run again: tables are only created if missing, functions and
-- policies are replaced.

-- ---------------------------------------------------------------------------
-- "Today" by the house clock, not whatever time zone someone's phone is in.
-- Change the zone here if you ever need to.
-- ---------------------------------------------------------------------------
create or replace function public.today()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Zurich')::date $$;

-- ---------------------------------------------------------------------------
-- Profiles: one per login. Admins (Renata) set chores and goals.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text        not null check (length(trim(name)) between 1 and 32),
  is_admin   boolean     not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Every new login gets a profile automatically, named after their email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
                  split_part(new.email, '@', 1), 'Jemand'), 32)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Catch up on anyone who was added before this script ran.
insert into public.profiles (id, name)
select id, left(coalesce(split_part(email, '@', 1), 'Jemand'), 32)
from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Chores. "daily" can be done once per day; "special" can be done once, ever.
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id         bigint generated always as identity primary key,
  title      text        not null check (length(trim(title)) between 1 and 80),
  notes      text        not null default '' check (length(notes) <= 500),
  points     integer     not null check (points between 1 and 1000),
  kind       text        not null check (kind in ('daily', 'special')),
  due_on     date,
  archived   boolean     not null default false,
  created_by uuid        default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind = 'special' or due_on is null)
);

-- ---------------------------------------------------------------------------
-- Check-offs. Points are copied from the chore at the time, so changing a
-- chore's points later never rewrites what people already earned.
-- ---------------------------------------------------------------------------
create table if not exists public.completions (
  id         bigint generated always as identity primary key,
  task_id    bigint      not null references public.tasks (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
  done_on    date        not null default public.today(),
  points     integer     not null default 0,
  created_at timestamptz not null default now(),
  unique (task_id, done_on)
);

create index if not exists completions_done_on_idx on public.completions (done_on);

-- ---------------------------------------------------------------------------
-- Monthly goal: points each person should reach. A month without its own row
-- uses the most recent earlier goal.
-- ---------------------------------------------------------------------------
create table if not exists public.monthly_goals (
  month      date        primary key check (extract(day from month) = 1),
  points     integer     not null check (points between 0 and 100000),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The rules for checking something off live in the database, so they hold
-- no matter what the website sends.
-- ---------------------------------------------------------------------------
create or replace function public.check_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  -- Lock the chore so two people tapping "I did it" at the same moment
  -- can't both collect the points.
  select * into t from public.tasks where id = new.task_id for update;

  if not found or t.archived then
    raise exception 'Dieses Ämtli gibt es nicht mehr.';
  end if;

  -- Only admins may check a chore off for someone else or for another day.
  if not public.is_admin() then
    new.user_id := auth.uid();
    new.done_on := public.today();
  end if;

  new.points := t.points;
  new.created_at := now();

  if t.kind = 'daily' and exists (
    select 1 from public.completions where task_id = t.id and done_on = new.done_on
  ) then
    raise exception '„%“ wurde heute schon erledigt.', t.title;
  end if;

  if t.kind = 'special' and exists (
    select 1 from public.completions where task_id = t.id
  ) then
    raise exception '„%“ wurde schon erledigt.', t.title;
  end if;

  return new;
end $$;

drop trigger if exists completions_check on public.completions;
create trigger completions_check
  before insert on public.completions
  for each row execute function public.check_completion();

-- ---------------------------------------------------------------------------
-- Row Level Security. Only signed-in family members see anything.
-- Profiles (names, who is admin) are changed from the SQL editor — see README.
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.tasks         enable row level security;
alter table public.completions   enable row level security;
alter table public.monthly_goals enable row level security;

drop policy if exists "family reads profiles" on public.profiles;
create policy "family reads profiles" on public.profiles
  for select to authenticated using (true);

drop policy if exists "family reads chores" on public.tasks;
drop policy if exists "admins add chores"   on public.tasks;
drop policy if exists "admins edit chores"  on public.tasks;
drop policy if exists "admins delete chores" on public.tasks;
create policy "family reads chores" on public.tasks
  for select to authenticated using (true);
create policy "admins add chores" on public.tasks
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit chores" on public.tasks
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete chores" on public.tasks
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "family reads the log"   on public.completions;
drop policy if exists "check off chores"       on public.completions;
drop policy if exists "undo own chores today"  on public.completions;
create policy "family reads the log" on public.completions
  for select to authenticated using (true);
create policy "check off chores" on public.completions
  for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "undo own chores today" on public.completions
  for delete to authenticated
  using ((user_id = (select auth.uid()) and done_on = public.today())
         or (select public.is_admin()));

drop policy if exists "family reads goals" on public.monthly_goals;
drop policy if exists "admins add goals"   on public.monthly_goals;
drop policy if exists "admins edit goals"  on public.monthly_goals;
drop policy if exists "admins delete goals" on public.monthly_goals;
create policy "family reads goals" on public.monthly_goals
  for select to authenticated using (true);
create policy "admins add goals" on public.monthly_goals
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit goals" on public.monthly_goals
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete goals" on public.monthly_goals
  for delete to authenticated using ((select public.is_admin()));
