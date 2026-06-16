-- ─────────────────────────────────────────────────────────────────────────────
-- Papelera de organizaciones (soft delete) para el panel SAT.
--   deleted_at NULL  → activa
--   deleted_at set   → en papelera (el owner/miembros pierden acceso; el SAT la
--                      sigue viendo y puede restaurar o borrar definitivamente).
-- El borrado definitivo es un DELETE normal (las FK ON DELETE CASCADE limpian todo).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS organizations_deleted_at_idx ON organizations (deleted_at);

-- my_org_ids() pasa a excluir orgs en papelera → revoca el acceso de los miembros
-- a TODOS los datos de la org (leads, tableros, etc.) en cuanto se manda a papelera.
CREATE OR REPLACE FUNCTION my_org_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT om.org_id
  FROM org_members om
  JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = auth.uid() AND o.deleted_at IS NULL
$$;

-- El owner tampoco ve su org si está en papelera (el SAT sí, vía organizations_super_admin)
DROP POLICY IF EXISTS orgs_select_members ON organizations;
CREATE POLICY orgs_select_members ON organizations FOR SELECT
  USING (deleted_at IS NULL AND (owner_id = auth.uid() OR id IN (SELECT my_org_ids())));
