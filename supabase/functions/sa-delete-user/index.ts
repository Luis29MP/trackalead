// sa-delete-user — Borra por completo una cuenta de usuario y las organizaciones
// que posee. SOLO ejecutable por un super_admin (se verifica su JWT).
// Body: { target_user_id }
// Orden: 1) borrar orgs propias (cascada de todos sus datos)
//        2) limpiar referencias FK NO ACTION (budgets/invitations/professionals)
//        3) borrar la cuenta de auth (cascada: profiles, org_members, etc.)
// Desplegar:  supabase functions deploy sa-delete-user --no-verify-jwt
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1) Verificar que QUIEN LLAMA es super_admin (vía su propio JWT)
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    if (!token) return json({ error: 'No autorizado' }, 401)
    const { data: { user: caller }, error: cErr } = await admin.auth.getUser(token)
    if (cErr || !caller) return json({ error: 'No autorizado' }, 401)
    const { data: prof } = await admin.from('profiles').select('system_role').eq('id', caller.id).single()
    if (prof?.system_role !== 'super_admin') {
      return json({ error: 'Solo el super admin puede eliminar usuarios' }, 403)
    }

    // 2) Entrada
    const { target_user_id } = await req.json()
    if (!target_user_id) return json({ error: 'target_user_id requerido' }, 400)
    if (target_user_id === caller.id) return json({ error: 'No puedes eliminar tu propia cuenta' }, 400)

    // 3) Borrar las organizaciones que posee (las FK ON DELETE CASCADE limpian todo)
    const { error: oErr } = await admin.from('organizations').delete().eq('owner_id', target_user_id)
    if (oErr) return json({ error: `Error al borrar organizaciones: ${oErr.message}` }, 500)

    // 4) Limpiar referencias cross-org con FK NO ACTION (no bloquear el borrado)
    await admin.from('budgets').update({ created_by: null }).eq('created_by', target_user_id)
    await admin.from('invitations').update({ created_by: null }).eq('created_by', target_user_id)
    await admin.from('professionals').update({ user_id: null }).eq('user_id', target_user_id)

    // 5) Borrar la cuenta de auth → cascada: profiles, org_members, comentarios, eventos, notificaciones
    const { error: dErr } = await admin.auth.admin.deleteUser(target_user_id)
    if (dErr) return json({ error: `Error al borrar el usuario: ${dErr.message}` }, 500)

    return json({ ok: true })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
