// gcal-sync — Crea / actualiza / borra en Google Calendar el evento de una "visita".
// Body: { org_id, op: 'upsert' | 'delete', event, google_event_id? }
//   event = { title, description?, location?, start_at, end_at, notify_before_minutes? }
// Usa el refresh_token (cifrado) de la organización. Recordatorio = alarma popup.
// Desplegar con verify_jwt=true (lo invoca la app autenticada).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })
}

const enc = new TextEncoder(), dec = new TextDecoder()
async function deriveAes(p: string) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(p))
  return crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
function fromB64(b64: string) { const bin = atob(b64); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o }
async function decryptSecret(payload: string, pass: string) {
  const k = await deriveAes(pass)
  const data = fromB64(payload)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, k, data.slice(12))
  return dec.decode(pt)
}

const TZ = 'Europe/Madrid'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const CLIENT_ID = Deno.env.get('GCAL_CLIENT_ID')
    const CLIENT_SECRET = Deno.env.get('GCAL_CLIENT_SECRET')
    const KEK = Deno.env.get('AI_KEYS_KEK')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!CLIENT_ID || !CLIENT_SECRET || !KEK) return json({ error: 'Faltan secrets de Google/KEK' }, 500)

    const authToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    if (!authToken) return json({ error: 'No autorizado' }, 401)
    const { data: { user } } = await admin.auth.getUser(authToken)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const { org_id, op, event, google_event_id } = await req.json()
    if (!org_id || !op) return json({ error: 'org_id y op requeridos' }, 400)
    const { data: member } = await admin.from('org_members').select('id').eq('org_id', org_id).eq('user_id', user.id).maybeSingle()
    if (!member) return json({ error: 'No perteneces a esta organización' }, 403)

    const { data: integ } = await admin.from('org_integrations').select('config').eq('org_id', org_id).eq('provider', 'google_calendar').maybeSingle()
    const cfg = (integ?.config ?? {}) as Record<string, string>
    if (!cfg.refresh_token_enc) return json({ ok: false, notConnected: true })
    const calendarId = encodeURIComponent(cfg.calendar_id || 'primary')

    // access_token a partir del refresh_token
    const refresh = await decryptSecret(cfg.refresh_token_enc, KEK)
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
    })
    const tok = await tokRes.json()
    if (!tokRes.ok || !tok.access_token) {
      const expired = tok?.error === 'invalid_grant'
      return json({ ok: false, error: expired ? 'La conexión con Google caducó, vuelve a conectar' : 'No se pudo renovar el acceso a Google', reauth: expired }, 200)
    }
    const authH = { Authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }
    const base = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`

    if (op === 'delete') {
      if (!google_event_id) return json({ ok: true })
      const r = await fetch(`${base}/${google_event_id}`, { method: 'DELETE', headers: authH })
      if (!r.ok && r.status !== 410 && r.status !== 404) return json({ ok: false, error: `Google ${r.status}` })
      return json({ ok: true })
    }

    // upsert
    if (!event?.start_at || !event?.end_at) return json({ error: 'Faltan fechas del evento' }, 400)
    const minutes = Number.isFinite(event.notify_before_minutes) ? Math.max(0, Math.min(40320, event.notify_before_minutes)) : 30
    const payload = {
      summary: event.title || 'Visita',
      description: event.description || undefined,
      location: event.location || undefined,
      start: { dateTime: new Date(event.start_at).toISOString(), timeZone: TZ },
      end: { dateTime: new Date(event.end_at).toISOString(), timeZone: TZ },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes }] },
    }

    const isUpdate = !!google_event_id
    const r = await fetch(isUpdate ? `${base}/${google_event_id}` : base, {
      method: isUpdate ? 'PATCH' : 'POST', headers: authH, body: JSON.stringify(payload),
    })
    if (!r.ok) {
      // Si el evento ya no existe en Google, créalo de nuevo
      if (isUpdate && (r.status === 404 || r.status === 410)) {
        const r2 = await fetch(base, { method: 'POST', headers: authH, body: JSON.stringify(payload) })
        const d2 = await r2.json()
        if (!r2.ok) return json({ ok: false, error: `Google ${r2.status}` })
        return json({ ok: true, google_event_id: d2.id })
      }
      return json({ ok: false, error: `Google ${r.status}` })
    }
    const d = await r.json()
    return json({ ok: true, google_event_id: d.id })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'error' }, 500)
  }
})
