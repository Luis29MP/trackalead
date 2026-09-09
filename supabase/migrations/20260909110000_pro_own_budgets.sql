-- Presupuestos propios del profesional (trabajos suyos) + RPCs list/save/delete.
-- Y RPCs de biblioteca para profesionales (pro_budget_library_list/_add).
-- Ver 20260909* aplicadas por MCP (budget_library, pro_own_budgets).
create table if not exists pro_own_budgets (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null, org_id uuid not null,
  client_name text, concept text, lines jsonb default '[]'::jsonb,
  subtotal numeric default 0, vat_percent numeric default 21, total numeric default 0,
  notes text, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table pro_own_budgets enable row level security;
