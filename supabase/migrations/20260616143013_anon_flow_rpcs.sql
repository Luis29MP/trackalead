-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs SECURITY DEFINER para los flujos SIN sesión (panel profesional, lead público,
-- invitaciones, unirse a org). Validan el token/scope en servidor y saltan RLS de
-- forma controlada, de modo que se puede activar RLS estricto sin romper estos flujos.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: id del profesional para un magic_token válido (o NULL)
CREATE OR REPLACE FUNCTION _pro_id(p_token text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM professionals WHERE magic_token = p_token AND app_access = true LIMIT 1
$$;
REVOKE ALL ON FUNCTION _pro_id(text) FROM public;

-- Notifica a los miembros de una org
CREATE OR REPLACE FUNCTION _notify_org(p_org uuid, p_title text, p_body text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notifications (user_id, title, body, is_read)
  SELECT user_id, p_title, p_body, false FROM org_members WHERE org_id = p_org
$$;
REVOKE ALL ON FUNCTION _notify_org(uuid, text, text) FROM public;

-- ── ProPanel: carga (profesional + leads + partidas + owner) ────────────────────
CREATE OR REPLACE FUNCTION pro_load(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro professionals; v_owner uuid;
BEGIN
  SELECT * INTO v_pro FROM professionals WHERE magic_token = p_token AND app_access = true;
  IF v_pro.id IS NULL THEN RETURN NULL; END IF;
  UPDATE professionals SET last_access = now() WHERE id = v_pro.id;
  SELECT owner_id INTO v_owner FROM organizations WHERE id = v_pro.org_id;

  RETURN jsonb_build_object(
    'professional', jsonb_build_object(
      'id', v_pro.id, 'org_id', v_pro.org_id, 'name', v_pro.name, 'phone', v_pro.phone,
      'email', v_pro.email, 'specialty', v_pro.specialty, 'rates', v_pro.rates,
      'company_name', v_pro.company_name, 'last_access', v_pro.last_access
    ),
    'owner_id', v_owner,
    'leads', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', le.id, 'org_id', le.org_id, 'name', le.name, 'concept', le.concept,
        'zone', le.zone, 'address', le.address, 'phone', le.phone, 'notes', le.notes,
        'created_at', le.created_at,
        'column', (SELECT jsonb_build_object('name', bc.name, 'color', bc.color) FROM board_columns bc WHERE bc.id = le.column_id),
        'board', (SELECT jsonb_build_object('name', b.name, 'color', b.color) FROM boards b WHERE b.id = le.board_id)
      ) ORDER BY le.created_at DESC)
      FROM leads le WHERE le.assigned_to = v_pro.id AND le.is_archived = false
    ), '[]'::jsonb),
    'partidas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', bp.id, 'budget_id', bp.budget_id, 'org_id', bp.org_id, 'trade', bp.trade,
        'professional_id', bp.professional_id, 'lines', bp.lines, 'subtotal', bp.subtotal,
        'status', bp.status, 'notes', bp.notes, 'position', bp.position,
        'created_at', bp.created_at, 'updated_at', bp.updated_at,
        'budget', (SELECT jsonb_build_object('client_name', b.client_name, 'concept', b.concept, 'lead_id', b.lead_id, 'vat_percent', b.vat_percent) FROM budgets b WHERE b.id = bp.budget_id)
      ) ORDER BY bp.created_at DESC)
      FROM budget_partidas bp WHERE bp.professional_id = v_pro.id
    ), '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION pro_load(text) TO anon, authenticated;

-- ── ProPanel: guardar partida (líneas + estado) ─────────────────────────────────
CREATE OR REPLACE FUNCTION pro_partida_save(p_token text, p_partida_id uuid, p_lines jsonb, p_subtotal numeric, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid; v_part budget_partidas; v_client text;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token inválido'; END IF;
  SELECT * INTO v_part FROM budget_partidas WHERE id = p_partida_id AND professional_id = v_pro;
  IF v_part.id IS NULL THEN RAISE EXCEPTION 'partida no encontrada'; END IF;
  UPDATE budget_partidas SET lines = p_lines, subtotal = p_subtotal, status = p_status, updated_at = now() WHERE id = p_partida_id;
  SELECT client_name INTO v_client FROM budgets WHERE id = v_part.budget_id;
  PERFORM _notify_org(v_part.org_id,
    '🧾 Partida ' || coalesce(p_status,'actualizada'),
    v_part.trade || ' · ' || coalesce(v_client,'') || ' (' || p_subtotal || ' €)');
END $$;
GRANT EXECUTE ON FUNCTION pro_partida_save(text, uuid, jsonb, numeric, text) TO anon, authenticated;

-- ── ProPanel: comentario en lead ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pro_lead_comment(p_token text, p_lead_id uuid, p_content text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid; v_org uuid; v_name text;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token inválido'; END IF;
  SELECT org_id INTO v_org FROM leads WHERE id = p_lead_id AND assigned_to = v_pro;
  IF v_org IS NULL THEN RAISE EXCEPTION 'lead no asignado'; END IF;
  INSERT INTO lead_comments (lead_id, user_id, content, is_professional) VALUES (p_lead_id, NULL, p_content, true);
  SELECT name INTO v_name FROM professionals WHERE id = v_pro;
  PERFORM _notify_org(v_org, '📝 ' || coalesce(v_name,'Profesional') || ' dejó una nota', left(p_content, 80));
END $$;
GRANT EXECUTE ON FUNCTION pro_lead_comment(text, uuid, text) TO anon, authenticated;

-- ── ProPanel: archivo en lead ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pro_lead_file(p_token text, p_lead_id uuid, p_name text, p_url text, p_type text, p_size int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid; v_org uuid; v_name text;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token inválido'; END IF;
  SELECT org_id INTO v_org FROM leads WHERE id = p_lead_id AND assigned_to = v_pro;
  IF v_org IS NULL THEN RAISE EXCEPTION 'lead no asignado'; END IF;
  INSERT INTO lead_files (lead_id, name, url, type, size) VALUES (p_lead_id, p_name, p_url, p_type, p_size);
  SELECT name INTO v_name FROM professionals WHERE id = v_pro;
  PERFORM _notify_org(v_org, '📎 ' || coalesce(v_name,'Profesional') || ' subió un archivo', p_name);
END $$;
GRANT EXECUTE ON FUNCTION pro_lead_file(text, uuid, text, text, text, int) TO anon, authenticated;

-- ── ProPanel: comentarios del profesional de un lead ────────────────────────────
CREATE OR REPLACE FUNCTION pro_lead_comments(p_token text, p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'content', content, 'created_at', created_at) ORDER BY created_at)
    FROM lead_comments WHERE lead_id = p_lead_id AND is_professional = true), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION pro_lead_comments(text, uuid) TO anon, authenticated;

-- ── ProPanel: crear presupuesto (budget + partida) ──────────────────────────────
CREATE OR REPLACE FUNCTION pro_budget_create(
  p_token text, p_lead_id uuid, p_client_name text, p_client_phone text, p_client_address text,
  p_concept text, p_lines jsonb, p_subtotal numeric, p_vat_percent numeric, p_vat_amount numeric,
  p_total numeric, p_notes text, p_trade text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid; v_org uuid; v_budget uuid; v_name text;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token inválido'; END IF;
  SELECT org_id INTO v_org FROM leads WHERE id = p_lead_id AND assigned_to = v_pro;
  IF v_org IS NULL THEN RAISE EXCEPTION 'lead no asignado'; END IF;
  INSERT INTO budgets (org_id, lead_id, professional_id, client_name, client_phone, client_address,
    concept, lines, subtotal, vat_percent, vat_amount, total, margin_percent, validity_days, notes, status, ai_generated)
  VALUES (v_org, p_lead_id, v_pro, p_client_name, p_client_phone, p_client_address,
    p_concept, p_lines, p_subtotal, p_vat_percent, p_vat_amount, p_total, 20, 30, p_notes, 'draft', true)
  RETURNING id INTO v_budget;
  INSERT INTO budget_partidas (budget_id, org_id, trade, professional_id, lines, subtotal, status)
  VALUES (v_budget, v_org, coalesce(p_trade,'General'), v_pro, p_lines, p_subtotal, 'pending');
  SELECT name INTO v_name FROM professionals WHERE id = v_pro;
  PERFORM _notify_org(v_org, '🧾 ' || coalesce(v_name,'Profesional') || ' generó un presupuesto',
    coalesce(p_concept,'') || ' · ' || coalesce(p_client_name,'') || ' (' || p_total || ' €)');
  RETURN v_budget;
END $$;
GRANT EXECUTE ON FUNCTION pro_budget_create(text, uuid, text, text, text, text, jsonb, numeric, numeric, numeric, numeric, text, text) TO anon, authenticated;

-- ── ProPanel: guardar tarifas ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pro_rates_save(p_token text, p_rates jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token inválido'; END IF;
  UPDATE professionals SET rates = p_rates WHERE id = v_pro;
END $$;
GRANT EXECUTE ON FUNCTION pro_rates_save(text, jsonb) TO anon, authenticated;

-- ── ProPanel: base de conocimiento ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pro_knowledge_list(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.created_at DESC) FROM pro_knowledge k WHERE k.professional_id = v_pro), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION pro_knowledge_list(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION pro_knowledge_add(p_token text, p_type text, p_title text, p_content_text text, p_file_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid; v_org uuid;
BEGIN
  SELECT id, org_id INTO v_pro, v_org FROM professionals WHERE magic_token = p_token AND app_access = true;
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token inválido'; END IF;
  INSERT INTO pro_knowledge (professional_id, org_id, type, title, content_text, file_url)
  VALUES (v_pro, v_org, p_type, p_title, p_content_text, p_file_url);
END $$;
GRANT EXECUTE ON FUNCTION pro_knowledge_add(text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION pro_knowledge_delete(p_token text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token inválido'; END IF;
  DELETE FROM pro_knowledge WHERE id = p_id AND professional_id = v_pro;
END $$;
GRANT EXECUTE ON FUNCTION pro_knowledge_delete(text, uuid) TO anon, authenticated;

-- ── Lead público ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public_lead_by_token(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('name', name, 'zone', zone, 'address', address, 'concept', concept,
    'notes', notes, 'phone', phone, 'lat', lat, 'lng', lng)
  FROM leads WHERE public_token = p_token AND is_archived = false LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public_lead_by_token(text) TO anon, authenticated;

-- ── Invitación: leer por token ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION invitation_by_token(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'org_id', i.org_id, 'email', i.email, 'name', i.name, 'role', i.role,
    'permissions', i.permissions, 'accepted_at', i.accepted_at,
    'org_name', (SELECT name FROM organizations WHERE id = i.org_id)
  ) FROM invitations i WHERE i.token = p_token LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION invitation_by_token(text) TO anon, authenticated;

-- ── Invitación: aceptar (crear membresía + marcar aceptada) ──────────────────────
CREATE OR REPLACE FUNCTION accept_invitation(p_token text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv invitations;
BEGIN
  SELECT * INTO v_inv FROM invitations WHERE token = p_token;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'invitación no encontrada'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'invitación ya usada'; END IF;
  INSERT INTO org_members (org_id, user_id, role, permissions, status)
  VALUES (v_inv.org_id, p_user_id, v_inv.role, v_inv.permissions, 'active')
  ON CONFLICT (org_id, user_id) DO NOTHING;
  UPDATE invitations SET accepted_at = now() WHERE id = v_inv.id;
END $$;
GRANT EXECUTE ON FUNCTION accept_invitation(text, uuid) TO anon, authenticated;

-- ── Unirse a org: nombre de la org por id (para no-miembros) ─────────────────────
CREATE OR REPLACE FUNCTION org_name_by_id(p_org_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name FROM organizations WHERE id = p_org_id LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION org_name_by_id(uuid) TO anon, authenticated;
