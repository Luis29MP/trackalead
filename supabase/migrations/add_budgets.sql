-- ─────────────────────────────────────────────────────────────────────────────
-- Presupuestos generados con IA + tarifas de profesionales
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budgets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES profiles(id),
  client_name    text,
  client_phone   text,
  client_address text,
  concept        text,
  lines          jsonb DEFAULT '[]',
  subtotal       numeric DEFAULT 0,
  vat_percent    numeric DEFAULT 21,
  vat_amount     numeric DEFAULT 0,
  total          numeric DEFAULT 0,
  margin_percent numeric DEFAULT 20,
  validity_days  int DEFAULT 30,
  notes          text,
  status         text DEFAULT 'draft',   -- draft, sent, accepted, rejected
  ai_generated   boolean DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS budgets_org_idx ON budgets (org_id, created_at DESC);

ALTER TABLE budgets DISABLE ROW LEVEL SECURITY;
GRANT ALL ON budgets TO authenticated, anon;

-- Tarifas del profesional: [{ work_type, min_price, rec_price, unit }]
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS rates jsonb DEFAULT '[]';
