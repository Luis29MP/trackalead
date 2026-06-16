-- ─────────────────────────────────────────────────────────────────────────────
-- Datos de empresa + logo del profesional (para emitir presupuestos a su nombre)
-- y vínculo del presupuesto con el profesional asignado (reasignable).
-- El logo se guarda como data URL (base64) en logo_url para evitar Storage.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE professionals ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS address      text;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS cif          text;   -- NIF/CIF
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS logo_url     text;   -- data URL (base64) o URL pública

-- Profesional que ejecuta/emite el presupuesto (reasignable: Carlos → Juan)
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS professional_id uuid REFERENCES professionals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS budgets_professional_idx ON budgets (professional_id);
