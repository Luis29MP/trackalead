// whatsapp-send — Envía un mensaje de WhatsApp usando la integración activa de la
// org (Meta Cloud API o Evolution API), descifrando el secreto correspondiente.
// Body: { org_id, to, message }
// Auth: JWT de un miembro de la org, o la service_role key (llamadas internas).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// AES-GCM descifrado (inverso de save-integration)
const dec = new TextDecoder()
async function deriveKey(p: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p))
  return crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
function fromB64(b64: string) { const bin = atob(b64); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o }
async function decryptSecret(payload: string, pass: string) {
  const k = await deriveKey(pass)
  const data = fromB64(payload)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, k, data.slice(12))
  return dec.decode(pt)
}

// Normaliza a E.164 sin "+": 9 dígitos → añade 34 (España)
function normNumber(to: string): string {
  const d = String(to).replace(/\D/g, '')
  return d.length === 9 ? '34' + d : d
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)
    const kek = Deno.env.get('AI_KEYS_KEK')
    if (!kek) return json({ error: 'AI_KEYS_KEK no configurado' }, 500)

    const { org_id, to, message } = await req.json()
    if (!org_id || !to || !message) return json({ error: 'org_id, to y message requeridos' }, 400)

    // Autorización: service_role (interno) o miembro de la org
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    if (token !== SERVICE_KEY) {
      const { data: { user } } = await admin.auth.getUser(token)
      if (!user) return json({ error: 'No autorizado' }, 401)
      const { data: member } = await admin.from('org_members').select('id').eq('org_id', org_id).eq('user_id', user.id).maybeSingle()
      if (!member) return json({ error: 'No perteneces a esta organización' }, 403)
    }

    // Integración activa: Meta tiene prioridad
    const { data: integs } = await admin.from('org_integrations')
      .select('provider, config, is_active')
      .eq('org_id', org_id).in('provider', ['meta_whatsapp', 'evolution_api']).eq('is_active', true)
    const meta = integs?.find(i => i.provider === 'meta_whatsapp')
    const evo = integs?.find(i => i.provider === 'evolution_api')
    const integ = meta ?? evo
    if (!integ) return json({ error: 'No hay ninguna integración de WhatsApp activa' }, 400)

    const cfg = integ.config as Record<string, string>
    const number = normNumber(to)
    let ok = false
    let detail = ''

    if (integ.provider === 'meta_whatsapp') {
      const accessToken = cfg.access_token ? await decryptSecret(cfg.access_token, kek) : ''
      if (!cfg.phone_number_id || !accessToken) return json({ error: 'Faltan phone_number_id o access_token' }, 400)
      const res = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'text', text: { body: message } }),
      })
      detail = await res.text()
      ok = res.ok
    } else {
      const apiKey = cfg.api_key ? await decryptSecret(cfg.api_key, kek) : ''
      if (!cfg.server_url || !cfg.instance_name || !apiKey) return json({ error: 'Faltan server_url, instance_name o api_key' }, 400)
      const base = String(cfg.server_url).replace(/\/$/, '')
      const res = await fetch(`${base}/message/sendText/${cfg.instance_name}`, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, text: message }),
      })
      detail = await res.text()
      ok = res.ok
    }

    // Registrar el saliente
    await admin.from('whatsapp_messages').insert({
      org_id, from_number: integ.provider === 'meta_whatsapp' ? cfg.phone_number_id ?? null : cfg.instance_name ?? null,
      to_number: number, message, direction: 'outbound', processed: ok,
    })

    if (!ok) return json({ error: `Fallo al enviar (${integ.provider}): ${detail}` }, 502)
    return json({ ok: true, provider: integ.provider })
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500)
  }
})

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}
