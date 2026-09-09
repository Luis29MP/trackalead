-- Biblioteca de presupuestos reales (org) para alimentar la IA + RPCs para profesionales.
create table if not exists budget_library (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  title text, gremio text, content_text text, file_url text,
  source text default 'org', professional_id uuid, created_by uuid,
  created_at timestamptz default now()
);
alter table budget_library enable row level security;
drop policy if exists budget_library_org_members on budget_library;
create policy budget_library_org_members on budget_library for all
  using (org_id in (select my_org_ids())) with check (org_id in (select my_org_ids()));
-- RPCs pro_budget_library_list / _add: ver 20260909* aplicada por MCP.
