-- Registro de mensajes de WhatsApp (entrantes/salientes). La Edge Function
-- whatsapp-webhook inserta los entrantes; whatsapp-send registra los salientes.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  from_number text,
  to_number   text,
  message     text,
  direction   text CHECK (direction IN ('inbound','outbound')),
  "timestamp" timestamptz DEFAULT now(),
  processed   boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_org_idx ON whatsapp_messages (org_id, "timestamp" DESC);

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_messages_all_org_members ON whatsapp_messages;
CREATE POLICY whatsapp_messages_all_org_members ON whatsapp_messages FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS whatsapp_messages_super_admin ON whatsapp_messages;
CREATE POLICY whatsapp_messages_super_admin ON whatsapp_messages FOR SELECT USING (is_super_admin());

GRANT ALL ON whatsapp_messages TO authenticated, service_role;
