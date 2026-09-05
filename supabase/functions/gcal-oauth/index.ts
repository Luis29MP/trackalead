// gcal-oauth — Conecta Google Calendar a nivel de organización (OAuth).
// - GET  ?code&state  → callback de Google: canjea el code, guarda el refresh_token
//                        CIFRADO en org_integrations y redirige a la app.
// - POST { action }   → 'start' (URL de consentimiento), 'status', 'set_calendar',
//                        'disconnect'. Autenticado manualmente por el JWT del usuario.
// Desplegar con verify_jwt=false (el callback de Google llega sin JWT).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })
}

const enc = new TextEncoder()
async function deriveAes(p: string) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(p))
  return crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
function toB64(b: Uint8Array) { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s) }
function fromB64(b64: string) { const bin = atob(b64); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o }
async function encryptSecret(plain: string, pass: string) {
  const k = await deriveAes(pass)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(plain)))
  const c = new Uint8Array(iv.length + ct.length); c.set(iv, 0); c.set(ct, iv.length); return toB64(c)
}
async function decryptSecret(payload: string, pass: string) {
  const k = await deriveAes(pass)
  const d = fromB64(payload)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.slice(0, 12) }, k, d.slice(12))
  return new TextDecoder().decode(pt)
}
async function getAccessToken(refresh: string, id: string, secret: string): Promise<string | null> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const t = await r.json()
  return r.ok ? t.access_token : null
}

// state firmado (HMAC) para no poder falsificar la organización en el callback
async function hmac(msg: string, keyStr: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
  return toB64(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function makeState(orgId: string, kek: string) {
  const payload = `${orgId}.${Date.now() + 10 * 60 * 1000}`
  return `${btoa(payload).replace(/=+$/, '')}.${await hmac(payload, kek)}`
}
async function verifyState(state: string, kek: string): Promise<string | null> {
  const [p, sig] = (state || '').split('.')
  if (!p || !sig) return null
  const payload = atob(p.replace(/-/g, '+').replace(/_/g, '/'))
  if ((await hmac(payload, kek)) !== sig) return null
  const [orgId, expStr] = payload.split('.')
  if (Date.now() > Number(expStr)) return null
  return orgId
}

const REDIRECT_URI = 'https://qplznujisnpwyhrjjuyp.supabase.co/functions/v1/gcal-oauth'
const APP_RETURN = 'https://panel.trackalead.app/settings?gcal='
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const CLIENT_ID = Deno.env.get('GCAL_CLIENT_ID')
  const CLIENT_SECRET = Deno.env.get('GCAL_CLIENT_SECRET')
  const KEK = Deno.env.get('AI_KEYS_KEK')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!CLIENT_ID || !CLIENT_SECRET || !KEK) return json({ error: 'Faltan secrets GCAL_CLIENT_ID / GCAL_CLIENT_SECRET / AI_KEYS_KEK' }, 500)

  const url = new URL(req.url)

  // ── Callback de Google ──────────────────────────────────────────────────────
  if (req.method === 'GET' && (url.searchParams.get('code') || url.searchParams.get('error'))) {
    if (url.searchParams.get('error')) return Response.redirect(`${APP_RETURN}error`, 302)
    const code = url.searchParams.get('code')!
    const orgId = await verifyState(url.searchParams.get('state') || '', KEK)
    if (!orgId) return Response.redirect(`${APP_RETURN}error`, 302)

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
    })
    const tok = await tokenRes.json()
    if (!tokenRes.ok || !tok.refresh_token) return Response.redirect(`${APP_RETURN}error`, 302)

    let email = ''
    try {
      const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', { headers: { Authorization: `Bearer ${tok.access_token}` } })
      const cal = await calRes.json(); email = cal.id || ''
    } catch { /* opcional */ }

    const { data: existing } = await admin.from('org_integrations').select('config').eq('org_id', orgId).eq('provider', 'google_calendar').maybeSingle()
    const prev = (existing?.config ?? {}) as Record<string, unknown>
    const config = { ...prev, refresh_token_enc: await encryptSecret(tok.refresh_token, KEK), connected_email: email, calendar_id: prev.calendar_id || 'primary' }
    await admin.from('org_integrations').upsert({ org_id: orgId, provider: 'google_calendar', config, is_active: true, updated_at: new Date().toISOString() }, { onConflict: 'org_id,provider' })
    return Response.redirect(`${APP_RETURN}connected`, 302)
  }

  // ── Acciones POST (autenticadas) ────────────────────────────────────────────
  try {
    const authToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    if (!authToken) return json({ error: 'No autorizado' }, 401)
    const { data: { user } } = await admin.auth.getUser(authToken)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const body = await req.json()
    const orgId = body.org_id
    if (!orgId) return json({ error: 'org_id requerido' }, 400)
    const { data: member } = await admin.from('org_members').select('id').eq('org_id', orgId).eq('user_id', user.id).maybeSingle()
    if (!member) return json({ error: 'No perteneces a esta organización' }, 403)

    if (body.action === 'start') {
      const consent = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
        scope: SCOPE, access_type: 'offline', prompt: 'select_account consent', state: await makeState(orgId, KEK),
      }).toString()
      return json({ url: consent })
    }

    if (body.action === 'status') {
      const { data } = await admin.from('org_integrations').select('config').eq('org_id', orgId).eq('provider', 'google_calendar').maybeSingle()
      const cfg = (data?.config ?? {}) as Record<string, unknown>
      return json({ connected: !!cfg.refresh_token_enc, email: cfg.connected_email || '', calendar_id: cfg.calendar_id || 'primary' })
    }

    if (body.action === 'list_calendars') {
      const { data } = await admin.from('org_integrations').select('config').eq('org_id', orgId).eq('provider', 'google_calendar').maybeSingle()
      const cfg = (data?.config ?? {}) as Record<string, string>
      if (!cfg.refresh_token_enc) return json({ calendars: [] })
      const at = await getAccessToken(await decryptSecret(cfg.refresh_token_enc, KEK), CLIENT_ID, CLIENT_SECRET)
      if (!at) return json({ calendars: [], error: 'reauth' })
      const r = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer', { headers: { Authorization: `Bearer ${at}` } })
      const d = await r.json()
      const calendars = (d.items ?? []).map((c: { id: string; summary: string; primary?: boolean }) => ({ id: c.id, summary: c.summary, primary: !!c.primary }))
      return json({ calendars })
    }

    if (body.action === 'set_calendar') {
      const { data } = await admin.from('org_integrations').select('config').eq('org_id', orgId).eq('provider', 'google_calendar').maybeSingle()
      const cfg = (data?.config ?? {}) as Record<string, unknown>
      cfg.calendar_id = String(body.calendar_id || 'primary').trim() || 'primary'
      await admin.from('org_integrations').upsert({ org_id: orgId, provider: 'google_calendar', config: cfg, is_active: true, updated_at: new Date().toISOString() }, { onConflict: 'org_id,provider' })
      return json({ ok: true, calendar_id: cfg.calendar_id })
    }

    if (body.action === 'disconnect') {
      const { data } = await admin.from('org_integrations').select('config').eq('org_id', orgId).eq('provider', 'google_calendar').maybeSingle()
      const cfg = (data?.config ?? {}) as Record<string, unknown>
      delete cfg.refresh_token_enc; delete cfg.connected_email  // conserva notify_jose/recipients/etc.
      await admin.from('org_integrations').upsert({ org_id: orgId, provider: 'google_calendar', config: cfg, is_active: false, updated_at: new Date().toISOString() }, { onConflict: 'org_id,provider' })
      return json({ ok: true })
    }

    return json({ error: 'acción desconocida' }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'error' }, 500)
  }
})
