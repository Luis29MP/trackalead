-- ─────────────────────────────────────────────────────────────────────────────
-- Cambio de modelo: la suscripción es POR USUARIO (owner), no por organización.
-- La fuente de verdad pasa a ser profiles.plan / profiles.plan_status.
-- organizations.plan queda solo como referencia histórica.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan            text DEFAULT 'free';   -- free, pro, enterprise
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_status     text DEFAULT 'active'; -- active, suspended, trial, cancelled
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at   timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS next_billing_at timestamptz;

-- Límite de organizaciones por plan (los demás límites ya existían en plan_config)
ALTER TABLE plan_config ADD COLUMN IF NOT EXISTS max_orgs int DEFAULT 1;

-- Límites por plan aplicados AL USUARIO:
--   FREE:       1 org · 2 tableros/org · 50 leads totales · 1 colaborador
--   PRO:        5 orgs · 10 tableros/org · 500 leads totales · 5 colaboradores
--   ENTERPRISE: ilimitado
UPDATE plan_config SET max_orgs = 1,   max_boards = 2,   max_leads = 50,   max_members = 1   WHERE plan = 'free';
UPDATE plan_config SET max_orgs = 5,   max_boards = 10,  max_leads = 500,  max_members = 5   WHERE plan = 'pro';
UPDATE plan_config SET max_orgs = 999, max_boards = 999, max_leads = 99999, max_members = 999 WHERE plan = 'enterprise';

-- Asegurar que los planes existen (por si la migración previa no se ejecutó)
INSERT INTO plan_config (plan, max_orgs, max_boards, max_leads, max_members, price_monthly) VALUES
('free',       1,   2,   50,    1,   0),
('pro',        5,   10,  500,   5,   29),
('enterprise', 999, 999, 99999, 999, 99)
ON CONFLICT (plan) DO NOTHING;
