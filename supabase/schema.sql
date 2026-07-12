-- ============================================================
-- Ready Eventos CAD — esquema de Supabase (referencia versionada)
-- Aplicado al proyecto jvjhqdwlhaggoqsnenfw vía migraciones MCP.
-- Modelo: login de equipo compartido con lista de miembros autorizados (RLS).
-- ============================================================

-- Allowlist de miembros. El registro es abierto, pero sólo estos correos acceden.
create table if not exists public.miembros (
  email text primary key,
  created_at timestamptz default now()
);
alter table public.miembros enable row level security;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros where email = lower(auth.jwt() ->> 'email'));
$$;
grant execute on function public.is_member() to authenticated;

create policy miembros_select on public.miembros for select to authenticated using (public.is_member());
create policy miembros_insert on public.miembros for insert to authenticated with check (public.is_member());
create policy miembros_delete on public.miembros for delete to authenticated using (public.is_member());

insert into public.miembros(email) values ('baquetasjgt@gmail.com') on conflict do nothing;

-- ---- Entidades del CRM ----
create table if not exists public.clientes (
  id text primary key, nombre text default '', web text default '',
  contacto text default '', email text default '', telefono text default '',
  contactos jsonb default '[]'::jsonb, notas text default '', created bigint,
  updated_at timestamptz default now()
);
create table if not exists public.ferias (
  id text primary key, nombre text default '', recinto text default '', fechas text default '',
  web text default '', contactos jsonb default '[]'::jsonb, created bigint,
  updated_at timestamptz default now()
);
create table if not exists public.proveedores (
  id text primary key, nombre text default '', especialidad text default '', web text default '',
  notas text default '', contactos jsonb default '[]'::jsonb, created bigint,
  updated_at timestamptz default now()
);
create table if not exists public.proyectos (
  id text primary key, name text default '', estado text default 'Concepto presentado',
  cliente_id text, feria_id text, prov_ids jsonb default '[]'::jsonb,
  hist jsonb default '[]'::jsonb, created bigint, updated_at timestamptz default now()
);
-- Payloads opacos de cada documento (venta / planos) por proyecto. Sin FK estricta:
-- la app escribe el documento antes de crear la fila del proyecto.
create table if not exists public.documentos (
  project_id text primary key, venta jsonb, planos jsonb, updated timestamptz default now()
);
-- Metadatos de PDFs de normativa (binario en Storage; texto extraído aquí).
create table if not exists public.feria_docs (
  id text primary key, feria_id text references public.ferias(id) on delete cascade,
  name text default '', chars int default 0, storage_path text, text_content text, created bigint
);

-- RLS: sólo miembros de la allowlist
do $$
declare t text;
begin
  foreach t in array array['clientes','ferias','proveedores','proyectos','documentos','feria_docs'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$create policy %I on public.%I for all to authenticated using (public.is_member()) with check (public.is_member());$f$, t||'_members', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;
grant select, insert, delete on public.miembros to authenticated;

-- Notas de proyecto + tareas de equipo (ver migrations/2026-07-12_notas_tareas.sql,
-- que incluye RLS de miembros y alta en la publicación realtime).
create table if not exists public.notas (
  id text primary key, project_id text not null, autor text default '',
  texto text default '', created bigint, edited bigint, updated_at timestamptz default now()
);
create table if not exists public.tareas (
  id text primary key, titulo text default '', detalle text default '',
  project_id text, asignada text default '', autor text default '',
  estado text default 'pendiente', prioridad text default 'normal', vence text,
  created bigint, done_at bigint, updated_at timestamptz default now()
);

-- Secreto de la IA como respaldo de la variable de entorno de la Edge Function.
-- RLS activo SIN políticas: ningún rol de PostgREST puede leerla; sólo la
-- función edge con service_role.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;

-- NOTA de seguridad (aplicada en el proyecto vía dashboard, documentada aquí):
-- la autenticación exige confirmación de email ("Confirm email" activado).
-- Si se desactivara, cualquiera podría registrarse con un correo de la
-- allowlist sin poseerlo y pasar is_member().

-- ---- Storage (buckets privados, sólo miembros) ----
insert into storage.buckets (id, name, public) values
  ('normativa','normativa', false), ('imagenes','imagenes', false), ('dxf','dxf', false)
on conflict (id) do nothing;

create policy "objetos_miembros" on storage.objects for all to authenticated
  using (bucket_id in ('normativa','imagenes','dxf') and public.is_member())
  with check (bucket_id in ('normativa','imagenes','dxf') and public.is_member());
