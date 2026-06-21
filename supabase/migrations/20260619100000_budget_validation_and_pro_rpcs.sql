-- Validación de presupuestos por el profesional + RPCs del panel /pro/:token
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS validated_by uuid;

CREATE OR REPLACE FUNCTION pro_budgets(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', b.id, 'group_id', b.group_id, 'lead_id', b.lead_id, 'concept', b.concept,
      'client_name', b.client_name, 'lines', b.lines, 'subtotal', b.subtotal,
      'vat_percent', b.vat_percent, 'vat_amount', b.vat_amount, 'total', b.total,
      'status', b.status, 'validated_at', b.validated_at, 'notes', b.notes, 'created_at', b.created_at,
      'lead_name', (SELECT le.name FROM leads le WHERE le.id = b.lead_id)
    ) ORDER BY b.created_at DESC)
    FROM budgets b
    JOIN leads l ON l.id = b.lead_id
    WHERE l.assigned_to = v_pro AND l.is_archived = false
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION pro_budgets(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION pro_budget_save(p_token text, p_budget_id uuid, p_lines jsonb, p_subtotal numeric, p_vat_amount numeric, p_total numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid; v_org uuid;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token invalido'; END IF;
  SELECT b.org_id INTO v_org FROM budgets b JOIN leads l ON l.id = b.lead_id
    WHERE b.id = p_budget_id AND l.assigned_to = v_pro;
  IF v_org IS NULL THEN RAISE EXCEPTION 'presupuesto no encontrado'; END IF;
  UPDATE budgets SET lines = p_lines, subtotal = p_subtotal, vat_amount = p_vat_amount, total = p_total, updated_at = now()
    WHERE id = p_budget_id;
END $$;
GRANT EXECUTE ON FUNCTION pro_budget_save(text, uuid, jsonb, numeric, numeric, numeric) TO anon, authenticated;

CREATE OR REPLACE FUNCTION pro_budget_validate(p_token text, p_budget_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro uuid; v_org uuid; v_name text; v_concept text; v_total numeric;
BEGIN
  v_pro := _pro_id(p_token);
  IF v_pro IS NULL THEN RAISE EXCEPTION 'token invalido'; END IF;
  SELECT b.org_id, b.concept, b.total INTO v_org, v_concept, v_total
    FROM budgets b JOIN leads l ON l.id = b.lead_id
    WHERE b.id = p_budget_id AND l.assigned_to = v_pro;
  IF v_org IS NULL THEN RAISE EXCEPTION 'presupuesto no encontrado'; END IF;
  UPDATE budgets SET validated_at = now(), validated_by = v_pro, updated_at = now() WHERE id = p_budget_id;
  SELECT name INTO v_name FROM professionals WHERE id = v_pro;
  PERFORM _notify_org(v_org, 'Presupuesto validado por ' || coalesce(v_name,'profesional'),
    coalesce(v_concept,'') || ' (' || round(coalesce(v_total,0))::text || ' EUR)');
END $$;
GRANT EXECUTE ON FUNCTION pro_budget_validate(text, uuid) TO anon, authenticated;
