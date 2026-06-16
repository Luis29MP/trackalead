-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: "infinite recursion detected in policy for relation org_members" (42P17).
--
-- La política org_members_select_same_org consultaba org_members DENTRO de su
-- propia definición (EXISTS (SELECT 1 FROM org_members om2 ...)), lo que provoca
-- recursión infinita. Además envenenaba el RLS de todas las tablas con patrón
-- org-member (leads, boards, budgets, etc.), porque al evaluar el RLS de
-- org_members se volvía a disparar a sí mismo.
--
-- Solución: una función SECURITY DEFINER que devuelve los org_ids del usuario
-- SIN aplicar RLS, rompiendo el ciclo. La política pasa a usar IN (SELECT ...).
-- ─────────────────────────────────────────────────────────────────────────────

-- org_ids a los que pertenece el usuario actual (SECURITY DEFINER → no aplica RLS)
CREATE OR REPLACE FUNCTION my_org_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM org_members WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION my_org_ids() FROM public;
GRANT EXECUTE ON FUNCTION my_org_ids() TO authenticated;

-- Reemplaza la política recursiva por una no recursiva
DROP POLICY IF EXISTS org_members_select_same_org ON org_members;
CREATE POLICY org_members_select_same_org ON org_members FOR SELECT
  USING (org_id IN (SELECT my_org_ids()));
