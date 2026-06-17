// save-integration — Guarda la config de una integración de la org cifrando los
// secretos (AES-GCM, misma lógica que las AI keys). Solo miembros de la org.
// Body: { org_id, provider, config, is_active }
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// AES-GCM (idéntico a _shared/crypto.ts), inlined para un deploy autocontenido
const enc = new TextEncoder()
async function deriveKey(p: string) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(p))
  return crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
function toB64(b: Uint8Array) { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s) }
async function encryptSecret(plain: string, pass: string) {
  const k = await deriveKey(pass)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(plain)))
  const c = new Uint8Array(iv.length + ct.length); c.set(iv, 0); c.set(ct, iv.length); return toB64(c)
}

// Campos sensibles por proveedor (se cifran; el resto va en claro)
const SECRET_FIELDS: Record<string, string[]> = {
  meta_whatsapp: ['access_token', 'app_secret'],
  evolution_api: ['api_key'],
  google_calendar: [],
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const kek = Deno.env.get('AI_KEYS_KEK')
    if (!kek) return json({ error: 'AI_KEYS_KEK no configurado en los secrets de la Edge Function' }, 500)

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    if (!token) return json({ error: 'No autorizado' }, 401)
    const { data: { user }, error: uErr } = await admin.auth.getUser(token)
    if (uErr || !user) return json({ error: 'No autorizado' }, 401)

    const { org_id, provider, config, is_active } = await req.json()
    if (!org_id || !provider) return json({ error: 'org_id y provider requeridos' }, 400)
    if (!(provider in SECRET_FIELDS)) return json({ error: 'provider inválido' }, 400)

    // El usuario debe ser miembro de la organización
    const { data: member } = await admin.from('org_members').select('id').eq('org_id', org_id).eq('user_id', user.id).maybeSingle()
    if (!member) return json({ error: 'No perteneces a esta organización' }, 403)

    // Cifrar secretos nuevos; conservar los existentes si llegan vacíos
    const { data: existing } = await admin.from('org_integrations').select('config').eq('org_id', org_id).eq('provider', provider).maybeSingle()
    const prev = (existing?.config ?? {}) as Record<string, unknown>
    const incoming = (config ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = { ...incoming }
    for (const f of SECRET_FIELDS[provider]) {
      const val = incoming[f]
      if (val && String(val).trim()) out[f] = await encryptSecret(String(val), kek)
      else if (prev[f]) out[f] = prev[f]
      else delete out[f]
    }

    const { error } = await admin.from('org_integrations').upsert({
      org_id, provider, config: out, is_active: !!is_active, updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,provider' })
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true })
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500)
  }
})

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}
