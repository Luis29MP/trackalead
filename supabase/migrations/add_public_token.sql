-- Añadir token público a leads para enlaces compartibles
ALTER TABLE leads ADD COLUMN IF NOT EXISTS public_token text UNIQUE;

-- Índice para búsqueda rápida por token
CREATE INDEX IF NOT EXISTS leads_public_token_idx ON leads(public_token);
