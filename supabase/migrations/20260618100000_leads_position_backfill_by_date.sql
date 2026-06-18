-- Los leads importados de Trello antes de existir la columna `position` tenían
-- position = NULL, por lo que el Kanban caía a created_at DESC (más nuevo arriba),
-- quedando INVERTIDOS respecto a Trello. Como el `pos` de Trello no se guardó, se
-- usa created_at ASC (más antiguo = arriba) como mejor aproximación para deshacer
-- la inversión. Para el orden manual exacto, usar "Reordenar desde Trello" (cruce
-- por teléfono con el JSON) en el importador.
WITH ranked AS (
  SELECT id,
         (row_number() OVER (PARTITION BY column_id ORDER BY created_at ASC, id ASC) - 1) AS rn
  FROM leads
  WHERE is_archived = false AND position IS NULL
)
UPDATE leads l SET position = ranked.rn, updated_at = now()
FROM ranked WHERE l.id = ranked.id;
