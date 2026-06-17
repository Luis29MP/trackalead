-- Integraciones por organización (WhatsApp Meta/Evolution, Google Calendar).
-- config JSONB: campos no sensibles en claro; los secretos (tokens/keys) se guardan
-- cifrados (AES-GCM) por la Edge Function save-integration, misma lógica que user_api_keys.
CREATE TABLE IF NOT EXISTS org_integrations (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('meta_whatsapp','evolution_api','google_calendar')),
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (org_id, provider)
);

ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_integrations_all_org_members ON org_integrations;
CREATE POLICY org_integrations_all_org_members ON org_integrations FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS org_integrations_super_admin ON org_integrations;
CREATE POLICY org_integrations_super_admin ON org_integrations FOR SELECT USING (is_super_admin());

GRANT ALL ON org_integrations TO authenticated, service_role;
