-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: "new row violates row-level security policy for table organizations" al
-- crear una organización.
--
-- El cliente hace .insert().select(), que en Postgres es INSERT ... RETURNING y
-- aplica la política SELECT a la fila devuelta. La política era
-- id IN (SELECT my_org_ids()), pero la org recién creada aún no está ahí (la fila
-- de org_members del owner se inserta DESPUÉS, en el paso 3 de createOrganization),
-- así que el creador no puede releer su propia org → error de RLS.
--
-- Solución: el owner ve y crea su organización por owner_id, sin depender de la
-- membresía. Además endurece el INSERT: solo puedes crear orgs de las que eres owner.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS orgs_insert_authenticated ON organizations;
CREATE POLICY orgs_insert_owner ON organizations FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS orgs_select_members ON organizations;
CREATE POLICY orgs_select_members ON organizations FOR SELECT
  USING (owner_id = auth.uid() OR id IN (SELECT my_org_ids()));
