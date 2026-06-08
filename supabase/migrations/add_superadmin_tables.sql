-- Anuncios globales (banners para usuarios)
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  type text DEFAULT 'info',       -- info, warning, maintenance
  target text DEFAULT 'all',      -- all, pro, free, <org_id>
  created_by uuid REFERENCES profiles(id),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

GRANT ALL ON TABLE announcements TO authenticated, anon;

-- Configuración de planes
CREATE TABLE IF NOT EXISTS plan_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan text UNIQUE NOT NULL,
  max_boards int DEFAULT 2,
  max_leads int DEFAULT 50,
  max_members int DEFAULT 2,
  price_monthly numeric DEFAULT 0,
  features jsonb DEFAULT '[]',
  updated_at timestamptz DEFAULT now()
);

GRANT ALL ON TABLE plan_config TO authenticated, anon;

INSERT INTO plan_config (plan, max_boards, max_leads, max_members, price_monthly) VALUES
('free', 2, 50, 2, 0),
('pro', 20, 500, 10, 29),
('enterprise', 999, 9999, 999, 99)
ON CONFLICT (plan) DO NOTHING;

-- Estado de suscripción en organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_status text DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS next_billing_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
