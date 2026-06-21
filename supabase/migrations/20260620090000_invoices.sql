-- Facturas (de presupuesto o manuales)
CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  budget_id       uuid REFERENCES budgets(id) ON DELETE SET NULL,
  professional_id uuid REFERENCES professionals(id) ON DELETE SET NULL,
  invoice_number  text NOT NULL,
  invoice_series  text,
  auto_number     boolean DEFAULT true,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','cancelled')),
  client_name     text,
  client_nif      text,
  client_address  text,
  client_email    text,
  client_phone    text,
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal        numeric DEFAULT 0,
  tax_rate        numeric DEFAULT 21,
  tax_amount      numeric DEFAULT 0,
  total           numeric DEFAULT 0,
  issue_date      date DEFAULT current_date,
  due_date        date,
  paid_at         date,
  notes           text,
  payment_method  text,
  created_by      uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_org_idx  ON invoices (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_lead_idx ON invoices (lead_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_all_org_members ON invoices;
CREATE POLICY invoices_all_org_members ON invoices FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS invoices_super_admin ON invoices;
CREATE POLICY invoices_super_admin ON invoices FOR SELECT USING (is_super_admin());

GRANT ALL ON invoices TO authenticated, service_role;
