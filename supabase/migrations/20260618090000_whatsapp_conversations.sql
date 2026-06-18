-- Estado de cada conversación de WhatsApp (1 por número de contacto y org).
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_number  text NOT NULL,
  contact_name    text,
  bot_paused      boolean NOT NULL DEFAULT false,
  last_message_at timestamptz DEFAULT now(),
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (org_id, contact_number)
);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_org_idx ON whatsapp_conversations (org_id, last_message_at DESC);

ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_conversations_all_org_members ON whatsapp_conversations;
CREATE POLICY whatsapp_conversations_all_org_members ON whatsapp_conversations FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS whatsapp_conversations_super_admin ON whatsapp_conversations;
CREATE POLICY whatsapp_conversations_super_admin ON whatsapp_conversations FOR SELECT USING (is_super_admin());

GRANT ALL ON whatsapp_conversations TO authenticated, service_role;
