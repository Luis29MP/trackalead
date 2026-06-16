-- ─────────────────────────────────────────────────────────────────────────────
-- API keys de IA por usuario (Anthropic / OpenAI / Gemini)
-- El cifrado lo hace la Edge Function `save-api-key` con AES-GCM (secret
-- AI_KEYS_KEK). Aquí la columna api_key guarda SOLO el texto ya cifrado.
-- Sin pgcrypto, sin RPCs.
-- ─────────────────────────────────────────────────────────────────────────────

-- Limpieza de la versión anterior basada en pgcrypto (si existía)
DROP FUNCTION IF EXISTS save_user_api_key(text, text, text);
DROP FUNCTION IF EXISTS set_preferred_ai_provider(text);
DROP FUNCTION IF EXISTS get_ai_keys(uuid);
DROP FUNCTION IF EXISTS _ai_kek();

CREATE TABLE IF NOT EXISTS user_api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'gemini')),
  api_key         text NOT NULL,              -- valor YA cifrado (AES-GCM, base64) por la Edge Function
  is_preferred    boolean DEFAULT false,      -- proveedor principal del usuario
  preferred_model text,                       -- modelo elegido dentro del proveedor
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- Por si la tabla ya existía de un intento anterior sin alguna columna:
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS api_key         text;
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS is_preferred    boolean DEFAULT false;
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS preferred_model text;
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now();
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS user_api_keys_user_idx ON user_api_keys (user_id);

-- Seguridad: cada usuario solo ve/gestiona SUS propias keys.
-- (El descifrado solo ocurre en la Edge Function con service_role, que ignora RLS.)
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_api_keys_select ON user_api_keys;
DROP POLICY IF EXISTS user_api_keys_modify ON user_api_keys;
CREATE POLICY user_api_keys_select ON user_api_keys
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_api_keys_modify ON user_api_keys
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_api_keys TO authenticated;
GRANT ALL ON user_api_keys TO service_role;
