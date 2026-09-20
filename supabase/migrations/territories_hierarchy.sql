-- TrackALead · Jerarquía territorio → tableros por vertical (Fase 1)
-- Idempotente. Rollback al final del archivo (comentado).

-- 1) Tabla de territorios (zona / provincia)
create table if not exists public.territories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text,
  created_at timestamptz not null default now()
);
create index if not exists territories_org_idx on public.territories(org_id);
create unique index if not exists territories_org_slug_uidx
  on public.territories(org_id, slug) where slug is not null;
grant all on public.territories to anon, authenticated, service_role;

alter table public.territories enable row level security;
drop policy if exists territories_all_org_members on public.territories;
create policy territories_all_org_members on public.territories
  for all using (org_id in (select public.my_org_ids()))
  with check (org_id in (select public.my_org_ids()));

-- 2) boards: territorio + vertical
alter table public.boards add column if not exists territory_id uuid references public.territories(id) on delete restrict;
alter table public.boards add column if not exists vertical_key text;
create index if not exists boards_territory_idx on public.boards(territory_id);
create index if not exists boards_org_vertical_idx on public.boards(org_id, vertical_key);

-- 3) Backfill: territorio "León" + asignación de los tableros actuales (sin tocar IDs)
insert into public.territories (org_id, name, slug)
select 'a1025510-497c-4487-905c-d5e43cf14df0', 'León', 'leon'
where not exists (select 1 from public.territories
  where org_id = 'a1025510-497c-4487-905c-d5e43cf14df0' and slug = 'leon');

update public.boards b set
  territory_id = (select id from public.territories where org_id = b.org_id and slug = 'leon'),
  vertical_key = case
    when b.name ilike '%met%'       then 'carpinteria_metalica'
    when b.name ilike '%carpinter%' then 'carpinteria'
    when b.name ilike '%electric%'  then 'electricidad'
    when b.name ilike '%fontan%'    then 'fontaneria'
    when b.name ilike '%pintur%'    then 'pintura'
    when b.name ilike '%placa%'     then 'placas_solares'
    when b.name ilike '%reforma%'   then 'reformas'
    else b.vertical_key
  end
where b.org_id = 'a1025510-497c-4487-905c-d5e43cf14df0' and b.territory_id is null;

-- 4) Funciones
create or replace function public.get_territory_board_ids(p_territory uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.boards where territory_id = p_territory
$$;

create or replace function public.create_territory(p_org uuid, p_name text, p_slug text, p_verticals text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_terr uuid; v_vert text; v_board uuid; v_tmpl uuid;
begin
  insert into public.territories(org_id, name, slug) values (p_org, p_name, p_slug) returning id into v_terr;
  foreach v_vert in array coalesce(p_verticals, '{}') loop
    insert into public.boards(org_id, name, color, territory_id, vertical_key)
      values (p_org, initcap(replace(v_vert,'_',' ')), '#3B82F6', v_terr, v_vert) returning id into v_board;
    select id into v_tmpl from public.boards
      where org_id = p_org and vertical_key = v_vert and id <> v_board
      order by (territory_id is not null) desc, created_at asc limit 1;
    if v_tmpl is not null then
      insert into public.board_columns(board_id, name, position, color)
        select v_board, name, position, color from public.board_columns where board_id = v_tmpl order by position;
    else
      insert into public.board_columns(board_id, name, position, color) values
        (v_board,'Nuevo lead',0,'#6B7280'),(v_board,'Gestionado',1,'#3B82F6'),
        (v_board,'Visitado',2,'#8B5CF6'),(v_board,'Presupuestado',3,'#F59E0B'),
        (v_board,'Aceptado',4,'#10B981'),(v_board,'Rechazado',5,'#EF4444'),
        (v_board,'Finalizado',6,'#059669');
    end if;
  end loop;
  return v_terr;
end $$;

create or replace function public.add_vertical_to_territory(p_territory uuid, p_vertical text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_board uuid; v_tmpl uuid;
begin
  select org_id into v_org from public.territories where id = p_territory;
  if v_org is null then raise exception 'territorio no encontrado'; end if;
  insert into public.boards(org_id, name, color, territory_id, vertical_key)
    values (v_org, initcap(replace(p_vertical,'_',' ')), '#3B82F6', p_territory, p_vertical) returning id into v_board;
  select id into v_tmpl from public.boards
    where org_id = v_org and vertical_key = p_vertical and id <> v_board
    order by (territory_id is not null) desc, created_at asc limit 1;
  if v_tmpl is not null then
    insert into public.board_columns(board_id, name, position, color)
      select v_board, name, position, color from public.board_columns where board_id = v_tmpl order by position;
  else
    insert into public.board_columns(board_id, name, position, color) values
      (v_board,'Nuevo lead',0,'#6B7280'),(v_board,'Gestionado',1,'#3B82F6'),
      (v_board,'Visitado',2,'#8B5CF6'),(v_board,'Presupuestado',3,'#F59E0B'),
      (v_board,'Aceptado',4,'#10B981'),(v_board,'Rechazado',5,'#EF4444'),
      (v_board,'Finalizado',6,'#059669');
  end if;
  return v_board;
end $$;

-- ============ ROLLBACK (ejecutar solo para deshacer) ============
-- drop function if exists public.add_vertical_to_territory(uuid, text);
-- drop function if exists public.create_territory(uuid, text, text, text[]);
-- drop function if exists public.get_territory_board_ids(uuid);
-- alter table public.boards drop column if exists vertical_key;
-- alter table public.boards drop column if exists territory_id;
-- drop table if exists public.territories;
