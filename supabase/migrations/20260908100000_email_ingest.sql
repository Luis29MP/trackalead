-- Procesamiento automático de emails de formulario → lead.
-- Rutas web/alias → tablero, y registro de cada email procesado. Ver Edge Function ingest-email.
create table if not exists email_ingest_routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  key text not null,
  board_id uuid not null references boards(id) on delete cascade,
  label text,
  created_at timestamptz default now(),
  unique (org_id, key)
);
alter table email_ingest_routes enable row level security;
drop policy if exists email_routes_org_members on email_ingest_routes;
create policy email_routes_org_members on email_ingest_routes for all
  using (org_id in (select my_org_ids())) with check (org_id in (select my_org_ids()));

create table if not exists email_ingest_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid, route_key text, board_id uuid,
  status text, reason text, from_addr text, subject text, raw_excerpt text, lead_id uuid,
  created_at timestamptz default now()
);
alter table email_ingest_events enable row level security;
drop policy if exists email_events_org_members on email_ingest_events;
create policy email_events_org_members on email_ingest_events for select
  using (org_id in (select my_org_ids()));
