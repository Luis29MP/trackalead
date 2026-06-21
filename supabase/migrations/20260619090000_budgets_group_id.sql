-- Agrupa presupuestos que son opciones/alternativas del mismo trabajo (Opción 1/2/3).
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS budgets_group_idx ON budgets (group_id);
