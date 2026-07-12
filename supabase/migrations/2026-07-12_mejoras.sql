-- ============================================================
-- Tanda de mejoras: papelera, versiones de documentos y compartir
-- Ejecutar UNA VEZ en Supabase → SQL Editor → Run.
-- ============================================================

-- Papelera: borrado suave de proyectos (timestamp de borrado; null = activo)
alter table public.proyectos add column if not exists deleted bigint;

-- Historial de versiones de documentos (instantáneas restaurables)
create table if not exists public.doc_versiones (
  id text primary key,
  project_id text not null,
  app text default 'venta',          -- 'venta' | 'planos'
  nombre text default '',
  autor text default '',
  payload jsonb,
  created bigint,
  updated_at timestamptz default now()
);
alter table public.doc_versiones enable row level security;
drop policy if exists doc_versiones_members on public.doc_versiones;
create policy doc_versiones_members on public.doc_versiones for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on public.doc_versiones to authenticated;

-- Bucket para los PDF compartidos con clientes (acceso por URL firmada)
insert into storage.buckets (id, name, public) values ('compartidos','compartidos', false)
on conflict (id) do nothing;
drop policy if exists "compartidos_miembros" on storage.objects;
create policy "compartidos_miembros" on storage.objects for all to authenticated
  using (bucket_id = 'compartidos' and public.is_member())
  with check (bucket_id = 'compartidos' and public.is_member());
