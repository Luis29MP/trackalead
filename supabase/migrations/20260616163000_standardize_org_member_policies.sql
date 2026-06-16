-- ─────────────────────────────────────────────────────────────────────────────
-- Estandariza las políticas org-member para usar my_org_ids() (SECURITY DEFINER)
-- en lugar de EXISTS (SELECT ... FROM org_members ...). Reescrituras equivalentes
-- en semántica que eliminan toda referencia directa a org_members (sin recursión
-- posible) y mejoran el rendimiento (InitPlan de la función cacheable por query).
-- Las políticas *_super_admin se mantienen intactas (se combinan con OR).
--
-- Nota: profiles_select_org_members sigue consultando org_members a propósito,
-- porque debe comprobar la pertenencia de OTRO usuario (profiles.id). Al ser una
-- política sobre profiles (no sobre org_members) NO es recursiva.
-- ─────────────────────────────────────────────────────────────────────────────

-- my_org_ids() también ejecutable por anon (devuelve vacío sin sesión)
GRANT EXECUTE ON FUNCTION my_org_ids() TO anon;

-- ── Tablas con org_id directo ───────────────────────────────────────────────────
DROP POLICY IF EXISTS boards_all_org_members ON boards;
CREATE POLICY boards_all_org_members ON boards FOR ALL
  USING (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS leads_all_org_members ON leads;
CREATE POLICY leads_all_org_members ON leads FOR ALL
  USING (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS calendar_events_all_org_members ON calendar_events;
CREATE POLICY calendar_events_all_org_members ON calendar_events FOR ALL
  USING (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS professionals_all_org_members ON professionals;
CREATE POLICY professionals_all_org_members ON professionals FOR ALL
  USING (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS budgets_all_org_members ON budgets;
CREATE POLICY budgets_all_org_members ON budgets FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS budget_partidas_all_org_members ON budget_partidas;
CREATE POLICY budget_partidas_all_org_members ON budget_partidas FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS invitations_all_org_members ON invitations;
CREATE POLICY invitations_all_org_members ON invitations FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

DROP POLICY IF EXISTS pro_knowledge_all_org_members ON pro_knowledge;
CREATE POLICY pro_knowledge_all_org_members ON pro_knowledge FOR ALL
  USING (org_id IN (SELECT my_org_ids()))
  WITH CHECK (org_id IN (SELECT my_org_ids()));

-- ── organizations (por id) ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS orgs_select_members ON organizations;
CREATE POLICY orgs_select_members ON organizations FOR SELECT
  USING (id IN (SELECT my_org_ids()));

-- ── board_columns (vía boards) ──────────────────────────────────────────────────
DROP POLICY IF EXISTS columns_all_org_members ON board_columns;
CREATE POLICY columns_all_org_members ON board_columns FOR ALL
  USING (EXISTS (SELECT 1 FROM boards b
                 WHERE b.id = board_columns.board_id AND b.org_id IN (SELECT my_org_ids())));

-- ── lead_files / lead_comments / lead_activity (vía leads) ───────────────────────
DROP POLICY IF EXISTS lead_files_all_org_members ON lead_files;
CREATE POLICY lead_files_all_org_members ON lead_files FOR ALL
  USING (EXISTS (SELECT 1 FROM leads l
                 WHERE l.id = lead_files.lead_id AND l.org_id IN (SELECT my_org_ids())));

DROP POLICY IF EXISTS lead_comments_all_org_members ON lead_comments;
CREATE POLICY lead_comments_all_org_members ON lead_comments FOR ALL
  USING (EXISTS (SELECT 1 FROM leads l
                 WHERE l.id = lead_comments.lead_id AND l.org_id IN (SELECT my_org_ids())));

DROP POLICY IF EXISTS lead_activity_all_org_members ON lead_activity;
CREATE POLICY lead_activity_all_org_members ON lead_activity FOR ALL
  USING (EXISTS (SELECT 1 FROM leads l
                 WHERE l.id = lead_activity.lead_id AND l.org_id IN (SELECT my_org_ids())));

-- ── profiles: perfiles de usuarios que comparten org conmigo ─────────────────────
DROP POLICY IF EXISTS profiles_select_org_members ON profiles;
CREATE POLICY profiles_select_org_members ON profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM org_members om2
                 WHERE om2.user_id = profiles.id AND om2.org_id IN (SELECT my_org_ids())));
