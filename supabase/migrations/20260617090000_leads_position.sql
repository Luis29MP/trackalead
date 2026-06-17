-- Orden manual del lead dentro de su columna (para respetar el orden exacto de
-- Trello al importar). NULL = sin orden explícito → el tablero cae a created_at.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS position integer;
