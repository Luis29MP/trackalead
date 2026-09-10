-- Importar presupuesto de profesional: histórico/auditoría de comisión.
alter table professionals add column if not exists logo_url text;
create table if not exists professional_imported_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid references professionals(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  budget_id uuid references budgets(id) on delete set null,
  source_file_url text, extracted_json jsonb,
  commission_type text check (commission_type in ('percent','fixed')), commission_value numeric,
  original_subtotal numeric, final_subtotal numeric,
  created_at timestamptz default now()
);
alter table professional_imported_budgets enable row level security;
drop policy if exists pib_org_members on professional_imported_budgets;
create policy pib_org_members on professional_imported_budgets for all
  using (org_id in (select my_org_ids())) with check (org_id in (select my_org_ids()));
