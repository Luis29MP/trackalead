-- ─────────────────────────────────────────────────────────────────────────────
-- Plan/estado LIFETIME (acceso de por vida, sin pagos recurrentes).
-- plan_status puede valer ahora: active, suspended, trial, cancelled, lifetime.
-- Ese valor no necesita migración (es texto), pero sí guardamos la fecha en que
-- se concedió el lifetime para mostrarla en la configuración del usuario.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lifetime_since timestamptz;
