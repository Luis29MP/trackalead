// whatsapp-webhook — Webhook único para Meta Cloud API y Evolution API.
//   GET  → verificación de Meta (hub.mode / hub.verify_token / hub.challenge)
//   POST → recibe mensajes entrantes, identifica la org y los registra en whatsapp_messages
// Responde 200 siempre en POST (Meta lo exige). Desplegar con --no-verify-jwt.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

serve(async (req) => {
  const db = admin()

  // ── Verificación del webhook de Meta ──────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const verifyToken = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && verifyToken) {
      // Acepta si algún proveedor de alguna org tiene ese verify_token
      const { data } = await db.from('org_integrations')
        .select('id')
        .in('provider', ['meta_whatsapp', 'evolution_api'])
        .eq('config->>verify_token', verifyToken)
        .limit(1)
      if (data && data.length) return new Response(challenge ?? '', { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  // ── Mensajes entrantes ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = await req.json()

      // Meta Cloud API
      if (body?.object === 'whatsapp_business_account' || Array.isArray(body?.entry)) {
        for (const entry of body.entry ?? []) {
          for (const ch of entry.changes ?? []) {
            const value = ch.value ?? {}
            const phoneNumberId = value.metadata?.phone_number_id
            const displayPhone = value.metadata?.display_phone_number
            let orgId: string | null = null
            if (phoneNumberId) {
              const { data: integ } = await db.from('org_integrations')
                .select('org_id').eq('provider', 'meta_whatsapp')
                .eq('config->>phone_number_id', String(phoneNumberId)).maybeSingle()
              orgId = integ?.org_id ?? null
            }
            for (const m of value.messages ?? []) {
              const text = m.text?.body ?? m.button?.text ?? m.interactive?.list_reply?.title ?? m.interactive?.button_reply?.title ?? ''
              await db.from('whatsapp_messages').insert({
                org_id: orgId, from_number: m.from, to_number: displayPhone ?? String(phoneNumberId ?? ''),
                message: text, direction: 'inbound', processed: false,
              })
            }
          }
        }
      }
      // Evolution API
      else if (body?.instance || body?.event) {
        const instance = body.instance ?? body.instanceName
        let orgId: string | null = null
        if (instance) {
          const { data: integ } = await db.from('org_integrations')
            .select('org_id').eq('provider', 'evolution_api')
            .eq('config->>instance_name', String(instance)).maybeSingle()
          orgId = integ?.org_id ?? null
        }
        const d = body.data ?? {}
        const from = String(d.key?.remoteJid ?? '').split('@')[0]
        const text = d.message?.conversation ?? d.message?.extendedTextMessage?.text ?? ''
        if (from || text) {
          await db.from('whatsapp_messages').insert({
            org_id: orgId, from_number: from || null, to_number: String(instance ?? ''),
            message: text, direction: 'inbound', processed: false,
          })
        }
      }
    } catch (err) {
      console.error('[whatsapp-webhook] error procesando POST:', err)
    }
    // SIEMPRE 200 (Meta reintenta si recibe otra cosa)
    return new Response('OK', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
})
