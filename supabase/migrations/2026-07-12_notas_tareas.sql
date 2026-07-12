-- ============================================================
-- Notas de proyecto + tareas de equipo (sistema de colaboración)
-- Ejecutar UNA VEZ en Supabase → SQL Editor → Run.
-- ============================================================

create table if not exists public.notas (
  id text primary key,
  project_id text not null,
  autor text default '',
  texto text default '',
  created bigint,
  edited bigint,
  updated_at timestamptz default now()
);

create table if not exists public.tareas (
  id text primary key,
  titulo text default '',
  detalle text default '',
  project_id text,
  asignada text default '',
  autor text default '',
  estado text default 'pendiente',
  prioridad text default 'normal',
  vence text,
  created bigint,
  done_at bigint,
  updated_at timestamptz default now()
);

-- RLS: sólo miembros de la allowlist (igual que el resto de tablas)
alter table public.notas enable row level security;
alter table public.tareas enable row level security;
drop policy if exists notas_members on public.notas;
create policy notas_members on public.notas for all to authenticated
  using (public.is_member()) with check (public.is_member());
drop policy if exists tareas_members on public.tareas;
create policy tareas_members on public.tareas for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on public.notas to authenticated;
grant select, insert, update, delete on public.tareas to authenticated;

-- Realtime: los cambios llegan al instante a la app del compañero
do $$ begin
  alter publication supabase_realtime add table public.notas;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tareas;
exception when duplicate_object then null; end $$;
