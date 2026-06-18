// whatsapp-webhook — Webhook único para Meta Cloud API y Evolution API.
//   GET  → verificación de Meta (hub.mode / hub.verify_token / hub.challenge)
//   POST → registra mensajes entrantes, mantiene whatsapp_conversations y, si el
//          bot está activo para ese contacto, responde (vía whatsapp-send).
// Responde 200 siempre en POST (Meta lo exige). Desplegar con --no-verify-jwt.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_REPLY = 'Gracias por tu mensaje, en breve te atendemos.'

function admin() { return createClient(SUPABASE_URL, SERVICE_KEY) }

// Procesa un mensaje entrante: lo registra, mantiene la conversación y responde si procede
async function handleInbound(db: SupabaseClient, orgId: string | null, from: string, to: string, text: string, contactName: string | null) {
  await db.from('whatsapp_messages').insert({
    org_id: orgId, from_number: from || null, to_number: to || null,
    message: text, direction: 'inbound', processed: false,
  })
  if (!orgId || !from) return

  // Crear/actualizar la conversación
  const { data: convs } = await db.from('whatsapp_conversations')
    .select('id, bot_paused, contact_name')
    .eq('org_id', orgId).eq('contact_number', from).limit(1)
  const conv = convs?.[0]
  if (conv) {
    await db.from('whatsapp_conversations').update({
      last_message_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      contact_name: conv.contact_name ?? contactName ?? null,
    }).eq('id', conv.id)
  } else {
    await db.from('whatsapp_conversations').insert({
      org_id: orgId, contact_number: from, contact_name: contactName ?? null,
      bot_paused: false, last_message_at: new Date().toISOString(),
    })
  }

  // Bot activo y hay texto → responder (eco por ahora)
  const botPaused = conv?.bot_paused ?? false
  if (!botPaused && text.trim()) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, to: from, message: BOT_REPLY }),
      })
    } catch (err) { console.error('[whatsapp-webhook] fallo al responder con el bot:', err) }
  }
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
      const { data } = await db.from('org_integrations')
        .select('id').in('provider', ['meta_whatsapp', 'evolution_api'])
        .eq('config->>verify_token', verifyToken).limit(1)
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
            const contactName = value.contacts?.[0]?.profile?.name ?? null
            let orgId: string | null = null
            if (phoneNumberId) {
              const { data: integ } = await db.from('org_integrations')
                .select('org_id').eq('provider', 'meta_whatsapp')
                .eq('config->>phone_number_id', String(phoneNumberId)).maybeSingle()
              orgId = integ?.org_id ?? null
            }
            for (const m of value.messages ?? []) {
              const text = m.text?.body ?? m.button?.text ?? m.interactive?.list_reply?.title ?? m.interactive?.button_reply?.title ?? ''
              await handleInbound(db, orgId, m.from, displayPhone ?? String(phoneNumberId ?? ''), text, contactName)
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
        const contactName = d.pushName ?? null
        const text = d.message?.conversation ?? d.message?.extendedTextMessage?.text ?? ''
        if (from || text) await handleInbound(db, orgId, from, String(instance ?? ''), text, contactName)
      }
    } catch (err) {
      console.error('[whatsapp-webhook] error procesando POST:', err)
    }
    return new Response('OK', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
})
