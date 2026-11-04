-- Omilytix: cloud-saved projects (run once in Supabase → SQL Editor → New query → Run)
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tool        text not null,
  name        text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_tool_idx
  on public.projects (user_id, tool, updated_at desc);

-- Each user can only ever see and change their own projects.
alter table public.projects enable row level security;

drop policy if exists "own projects select" on public.projects;
drop policy if exists "own projects insert" on public.projects;
drop policy if exists "own projects update" on public.projects;
drop policy if exists "own projects delete" on public.projects;

create policy "own projects select" on public.projects for select to authenticated using (auth.uid() = user_id);
create policy "own projects insert" on public.projects for insert to authenticated with check (auth.uid() = user_id);
create policy "own projects update" on public.projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own projects delete" on public.projects for delete to authenticated using (auth.uid() = user_id);
