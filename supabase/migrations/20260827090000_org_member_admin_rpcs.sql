-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: no se podía ELIMINAR (ni editar) un colaborador desde el apartado Equipo.
--
-- Causa: org_members tiene RLS activo pero SOLO políticas de SELECT. Sin política
-- de DELETE/UPDATE, cualquier borrado/actualización desde el cliente afecta a 0
-- filas SIN lanzar error → el toast decía "eliminado" pero no borraba nada.
--
-- Solución (patrón del proyecto): RPCs SECURITY DEFINER que saltan RLS pero
-- comprueban que quien llama es OWNER de la organización del miembro objetivo.
-- No abrimos una política DELETE amplia (dejaría que cualquier miembro borre a
-- otros); la autorización queda encapsulada aquí.
-- ─────────────────────────────────────────────────────────────────────────────

-- Elimina un colaborador de la organización. Solo el propietario; nunca a un owner.
CREATE OR REPLACE FUNCTION remove_org_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org  uuid;
  v_role text;
BEGIN
  SELECT org_id, role INTO v_org, v_role FROM org_members WHERE id = p_member_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Miembro no encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = v_org AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Solo el propietario puede eliminar colaboradores';
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'No se puede eliminar al propietario';
  END IF;

  DELETE FROM org_members WHERE id = p_member_id;
END;
$$;
REVOKE ALL ON FUNCTION remove_org_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION remove_org_member(uuid) TO authenticated;

-- Actualiza rol y permisos de un colaborador. Solo el propietario; nunca a un owner.
CREATE OR REPLACE FUNCTION update_org_member(p_member_id uuid, p_role text, p_permissions jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org  uuid;
  v_role text;
BEGIN
  SELECT org_id, role INTO v_org, v_role FROM org_members WHERE id = p_member_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Miembro no encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = v_org AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Solo el propietario puede editar colaboradores';
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'No se puede cambiar el rol del propietario';
  END IF;

  UPDATE org_members
    SET role        = p_role,
        permissions = COALESCE(p_permissions, permissions)
    WHERE id = p_member_id;
END;
$$;
REVOKE ALL ON FUNCTION update_org_member(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION update_org_member(uuid, text, jsonb) TO authenticated;
