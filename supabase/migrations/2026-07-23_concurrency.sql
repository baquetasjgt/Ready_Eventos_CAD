-- Optimistic concurrency support. Every write changes the version timestamp,
-- including writes made by older clients that do not send updated_at.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clientes', 'ferias', 'proveedores', 'proyectos',
    'notas', 'tareas', 'revisiones'
  ] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', table_name);
    execute format(
      'create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      table_name
    );
  end loop;
end
$$;

create or replace function public.touch_documento_updated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated = now();
  return new;
end;
$$;

revoke all on function public.touch_documento_updated() from public;

drop trigger if exists touch_documento_updated on public.documentos;
create trigger touch_documento_updated
before update on public.documentos
for each row execute function public.touch_documento_updated();
