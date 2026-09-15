-- Ämtliplan — run in Supabase: SQL Editor → New query → paste → Run.
-- Safe to run again.
--
-- No logins: people tap their name on the site. Anyone with the link can read
-- and write, the same trade-off as the hiking dashboard. Keep the link in the
-- family.

-- ---------------------------------------------------------------------------
-- Clean up the earlier password-login version. Its tables never held data,
-- and they're only dropped if they still have the old login-based ids.
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'id' and data_type = 'uuid'
  ) then
    drop table if exists public.completions, public.tasks, public.profiles cascade;
  end if;
end $$;

-- Also removes the old admin-only policies on monthly_goals that used it;
-- the open policies are created again further down.
drop function if exists public.is_admin() cascade;

-- ---------------------------------------------------------------------------
-- "Today" by the house clock, not whatever time zone someone's phone is in.
-- ---------------------------------------------------------------------------
create or replace function public.today()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Zurich')::date $$;

-- ---------------------------------------------------------------------------
-- The family. Add, rename or remove people here and run the script again.
-- The admin sets chores and goals; everyone else collects points.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id       text    primary key check (id ~ '^[a-z0-9_-]{1,32}$'),
  name     text    not null check (length(trim(name)) between 1 and 32),
  is_admin boolean not null default false
);

insert into public.profiles (id, name, is_admin) values
  ('admin',     'Admin',     true),
  ('renata',    'Renata',    false),
  ('adi',       'Adi',       false),
  ('jan',       'Jan',       false),
  ('elisabeth', 'Elisabeth', false)
on conflict (id) do update set name = excluded.name, is_admin = excluded.is_admin;

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
  user_id    text        not null references public.profiles (id) on delete cascade,
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
-- Check-off rules live in the database, so two people tapping at once can't
-- both get the points.
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
  select * into t from public.tasks where id = new.task_id for update;

  if not found or t.archived then
    raise exception 'Dieses Ämtli gibt es nicht mehr.';
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
-- Row Level Security: open to anyone with the site's key (no logins).
-- The people list can only be changed here in the SQL editor.
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.tasks         enable row level security;
alter table public.completions   enable row level security;
alter table public.monthly_goals enable row level security;

drop policy if exists "family reads goals"  on public.monthly_goals;
drop policy if exists "admins add goals"    on public.monthly_goals;
drop policy if exists "admins edit goals"   on public.monthly_goals;
drop policy if exists "admins delete goals" on public.monthly_goals;

drop policy if exists "open read" on public.profiles;
drop policy if exists "open"      on public.tasks;
drop policy if exists "open"      on public.completions;
drop policy if exists "open"      on public.monthly_goals;

create policy "open read" on public.profiles
  for select to anon, authenticated using (true);
create policy "open" on public.tasks
  for all to anon, authenticated using (true) with check (true);
create policy "open" on public.completions
  for all to anon, authenticated using (true) with check (true);
create policy "open" on public.monthly_goals
  for all to anon, authenticated using (true) with check (true);
