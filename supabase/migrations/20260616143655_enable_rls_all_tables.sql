-- ─────────────────────────────────────────────────────────────────────────────
-- Activar RLS en todas las tablas públicas con aislamiento por organización.
-- Los flujos sin sesión ya van por RPCs SECURITY DEFINER (saltan RLS controladamente).
-- El SuperAdmin (SAT) y el modo fantasma necesitan lectura cross-org → políticas is_super_admin().
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: ¿el usuario actual es super admin? (SECURITY DEFINER → lee profiles sin recursión RLS)
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND system_role = 'super_admin')
$$;
REVOKE ALL ON FUNCTION is_super_admin() FROM public;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated;

-- ── Políticas faltantes (patrón org-member) para las 6 tablas sin políticas ──────
DROP POLICY IF EXISTS budgets_all_org_members ON budgets;
CREATE POLICY budgets_all_org_members ON budgets FOR ALL
  USING (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = budgets.org_id AND om.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = budgets.org_id AND om.user_id = auth.uid()));

DROP POLICY IF EXISTS budget_partidas_all_org_members ON budget_partidas;
CREATE POLICY budget_partidas_all_org_members ON budget_partidas FOR ALL
  USING (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = budget_partidas.org_id AND om.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = budget_partidas.org_id AND om.user_id = auth.uid()));

DROP POLICY IF EXISTS pro_knowledge_all_org_members ON pro_knowledge;
CREATE POLICY pro_knowledge_all_org_members ON pro_knowledge FOR ALL
  USING (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = pro_knowledge.org_id AND om.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = pro_knowledge.org_id AND om.user_id = auth.uid()));

DROP POLICY IF EXISTS invitations_all_org_members ON invitations;
CREATE POLICY invitations_all_org_members ON invitations FOR ALL
  USING (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = invitations.org_id AND om.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = invitations.org_id AND om.user_id = auth.uid()));

DROP POLICY IF EXISTS plan_config_select_auth ON plan_config;
CREATE POLICY plan_config_select_auth ON plan_config FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS error_logs_insert ON error_logs;
CREATE POLICY error_logs_insert ON error_logs FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ── SuperAdmin (SAT) + modo fantasma: acceso cross-org ──────────────────────────
DROP POLICY IF EXISTS organizations_super_admin ON organizations;
CREATE POLICY organizations_super_admin ON organizations FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS profiles_super_admin ON profiles;
CREATE POLICY profiles_super_admin ON profiles FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS plan_config_super_admin ON plan_config;
CREATE POLICY plan_config_super_admin ON plan_config FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS error_logs_super_admin ON error_logs;
CREATE POLICY error_logs_super_admin ON error_logs FOR SELECT USING (is_super_admin());

-- Lectura cross-org (SAT/dashboard + modo fantasma de visualización)
DROP POLICY IF EXISTS org_members_super_admin ON org_members;
CREATE POLICY org_members_super_admin ON org_members FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS boards_super_admin ON boards;
CREATE POLICY boards_super_admin ON boards FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS board_columns_super_admin ON board_columns;
CREATE POLICY board_columns_super_admin ON board_columns FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS leads_super_admin ON leads;
CREATE POLICY leads_super_admin ON leads FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS lead_files_super_admin ON lead_files;
CREATE POLICY lead_files_super_admin ON lead_files FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS lead_comments_super_admin ON lead_comments;
CREATE POLICY lead_comments_super_admin ON lead_comments FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS lead_activity_super_admin ON lead_activity;
CREATE POLICY lead_activity_super_admin ON lead_activity FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS calendar_events_super_admin ON calendar_events;
CREATE POLICY calendar_events_super_admin ON calendar_events FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS budgets_super_admin ON budgets;
CREATE POLICY budgets_super_admin ON budgets FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS budget_partidas_super_admin ON budget_partidas;
CREATE POLICY budget_partidas_super_admin ON budget_partidas FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS professionals_super_admin ON professionals;
CREATE POLICY professionals_super_admin ON professionals FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS pro_knowledge_super_admin ON pro_knowledge;
CREATE POLICY pro_knowledge_super_admin ON pro_knowledge FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS invitations_super_admin ON invitations;
CREATE POLICY invitations_super_admin ON invitations FOR SELECT USING (is_super_admin());

-- ── Storage: el panel del profesional (anon) sube archivos a lead-files ──────────
DROP POLICY IF EXISTS lead_files_anon_insert ON storage.objects;
CREATE POLICY lead_files_anon_insert ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'lead-files');

-- ── ACTIVAR RLS en las 18 tablas ────────────────────────────────────────────────
ALTER TABLE boards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_columns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_files      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_comments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activity   ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_partidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pro_knowledge   ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs      ENABLE ROW LEVEL SECURITY;

-- Endurecimiento: fijar search_path del trigger de alta de usuario
ALTER FUNCTION public.handle_new_user() SET search_path = public;
