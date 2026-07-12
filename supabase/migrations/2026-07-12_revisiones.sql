-- ============================================================
-- Modo Revisión: post-its y marcas sobre las láminas (Venta y Planos)
-- Ejecutar UNA VEZ en Supabase → SQL Editor → Run.
-- ============================================================

create table if not exists public.revisiones (
  id text primary key,
  project_id text not null,
  app text default 'venta',          -- 'venta' | 'planos'
  page_id text default '',           -- id de la lámina
  kind text default 'postit',        -- 'postit' | 'stroke'
  tarea_id text,                     -- tarea vinculada (los post-its siempre)
  autor text default '',
  data jsonb default '{}'::jsonb,    -- x,y,color,texto,tool,pts,postitId…
  created bigint,
  updated_at timestamptz default now()
);

alter table public.revisiones enable row level security;
drop policy if exists revisiones_members on public.revisiones;
create policy revisiones_members on public.revisiones for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on public.revisiones to authenticated;

-- Enlace de una tarea con su post-it/lámina (chip «📌» en el panel de tareas)
alter table public.tareas add column if not exists review jsonb;

-- Realtime: las marcas del compañero aparecen al instante
do $$ begin
  alter publication supabase_realtime add table public.revisiones;
exception when duplicate_object then null; end $$;
