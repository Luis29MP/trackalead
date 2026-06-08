-- ─────────────────────────────────────────────────────────────────────────────
-- Logs de errores globales (capturados en main.tsx con window.onerror /
-- window.onunhandledrejection). Solo el super_admin los consulta en su panel.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS error_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message    text,
  stack      text,
  url        text,
  user_id    uuid REFERENCES profiles(id)      ON DELETE SET NULL,
  org_id     uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at DESC);

-- Permisos (RLS desactivado en el proyecto, se usa GRANT como el resto de tablas)
ALTER TABLE error_logs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON error_logs TO authenticated;
GRANT ALL ON error_logs TO anon;
