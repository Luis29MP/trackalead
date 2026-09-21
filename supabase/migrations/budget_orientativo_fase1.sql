-- FASE 1 · Presupuesto orientativo/cerrado — datos y configuración
-- No toca el flujo actual de presupuestos: solo AMPLÍA budgets y añade config.

-- 1) budgets: tipo + orientativo + snapshot legal
alter table public.budgets
  add column if not exists type text not null default 'cerrado'
    check (type in ('orientativo','cerrado')),
  add column if not exists parent_budget_id uuid references public.budgets(id) on delete set null,
  add column if not exists price_min numeric,
  add column if not exists price_max numeric,
  add column if not exists legal_text text,
  add column if not exists legal_version integer;
create index if not exists budgets_type_idx on public.budgets(org_id, type);

-- 2) Config de presupuestos por organización (defaults para todas)
create table if not exists public.org_budget_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  origin_address text default 'León',
  origin_lat double precision, origin_lng double precision,
  visit_tariffs jsonb not null default
    '[{"max_km":20,"price":80},{"max_km":60,"price":120},{"max_km":null,"price":150}]',
  visit_vat_percent numeric not null default 21,
  work_vat_percent  numeric not null default 21,
  commission_percent numeric not null default 15,
  default_validity_days integer not null default 30,
  updated_at timestamptz not null default now()
);
grant all on public.org_budget_settings to anon, authenticated, service_role;
alter table public.org_budget_settings enable row level security;
drop policy if exists obs_all_org_members on public.org_budget_settings;
create policy obs_all_org_members on public.org_budget_settings
  for all using (org_id in (select public.my_org_ids()))
  with check (org_id in (select public.my_org_ids()));

-- 3) Textos legales versionados (global = org_id null; override por org)
create table if not exists public.legal_texts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('orientativo','cerrado')),
  version integer not null,
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant all on public.legal_texts to anon, authenticated, service_role;
alter table public.legal_texts enable row level security;
drop policy if exists legal_read on public.legal_texts;
create policy legal_read on public.legal_texts for select
  using (org_id is null or org_id in (select public.my_org_ids()));
drop policy if exists legal_write on public.legal_texts;
create policy legal_write on public.legal_texts for all
  using (org_id in (select public.my_org_ids()))
  with check (org_id in (select public.my_org_ids()));

-- 4) Seeds: textos legales globales v1
insert into public.legal_texts (org_id, kind, version, content)
select null,'orientativo',1,'Presupuesto orientativo. Es una estimación elaborada a distancia, sin visita al inmueble, a partir de la información y las fotos facilitadas. No tiene valor contractual ni es vinculante: el precio definitivo solo puede fijarse tras comprobar el estado real del inmueble. Si la horquilla te encaja y quieres un precio cerrado, realizamos una visita técnica de pago. Su importe se te comunica y aceptas por escrito antes de acudir, y se descuenta íntegro de la factura final si nos contratas la obra. Tarifas de la visita (sin IVA): hasta 20 km, 80 €; hasta 60 km, 120 €; más de 60 km, 150 €. Si la obra requiere arquitecto u otro técnico, sus honorarios no están incluidos y los abonas directamente a él.'
where not exists (select 1 from public.legal_texts where org_id is null and kind='orientativo' and version=1);

insert into public.legal_texts (org_id, kind, version, content)
select null,'cerrado',1,'Presupuesto cerrado tras visita técnica. El importe de la visita técnica se descuenta íntegro de la factura final si nos contratas la obra. Los daños ocultos que puedan aparecer se te muestran con fotografías y no se ejecuta ni se factura ningún trabajo adicional sin tu aprobación previa. Este documento no es un informe pericial ni sustituye al de un técnico competente (arquitecto o arquitecto técnico). No puede facilitarse a terceros ni utilizarse para reclamaciones, para negociar con otros profesionales ni para otros trámites.'
where not exists (select 1 from public.legal_texts where org_id is null and kind='cerrado' and version=1);

-- 5) Fila de settings para la org actual (León como origen)
insert into public.org_budget_settings (org_id, origin_address)
select 'a1025510-497c-4487-905c-d5e43cf14df0','León'
where not exists (select 1 from public.org_budget_settings where org_id='a1025510-497c-4487-905c-d5e43cf14df0');

-- ============ ROLLBACK (solo para deshacer) ============
-- drop table if exists public.legal_texts;
-- drop table if exists public.org_budget_settings;
-- alter table public.budgets
--   drop column if exists legal_version, drop column if exists legal_text,
--   drop column if exists price_max, drop column if exists price_min,
--   drop column if exists parent_budget_id, drop column if exists type;
