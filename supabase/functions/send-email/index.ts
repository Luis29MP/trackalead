// send-email — Envío de correos al cliente usando el SMTP de cada web.
// Acciones:
//   { action:'save_account', account:{...con smtp_pass en claro...} }  → cifra y guarda
//   { action:'send', account_id, to, subject, body, lead_id?, budget_id?, attachment?{name,contentBase64} }
// Requiere JWT (lo llama la app autenticada). El envío usa las credenciales SMTP
// de la web, cifradas en reposo con el secreto AI_KEYS_KEK.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })

// ── AES-GCM con AI_KEYS_KEK (base64 de 32 bytes) ────────────────────────────────
function b64ToBytes(b64: string): Uint8Array { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }
function bytesToB64(bytes: Uint8Array): string { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }
async function importKey(): Promise<CryptoKey> {
  const kek = Deno.env.get('AI_KEYS_KEK') || ''
  let raw = b64ToBytes(kek)
  if (raw.length !== 32) { raw = new Uint8Array(32); const src = new TextEncoder().encode(kek); raw.set(src.slice(0, 32)) }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
async function encrypt(plain: string): Promise<string> {
  const key = await importKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  return `${bytesToB64(iv)}:${bytesToB64(ct)}`
}
async function decrypt(payload: string): Promise<string> {
  const key = await importKey()
  const [ivB64, ctB64] = payload.split(':')
  const iv = b64ToBytes(ivB64), ct = b64ToBytes(ctB64)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // Usuario autenticado (JWT) + su organización
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(jwt)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const { data: memberships } = await admin.from('org_members').select('org_id').eq('user_id', user.id)
    const myOrgs = new Set((memberships ?? []).map(m => m.org_id))

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action || 'send')

    // ── Guardar/actualizar cuenta SMTP (cifra la contraseña) ────────────────────
    if (action === 'save_account') {
      const a = (body.account ?? {}) as Record<string, unknown>
      const orgId = String(a.org_id || '')
      if (!myOrgs.has(orgId)) return json({ error: 'Org no permitida' }, 403)
      const pass = String(a.smtp_pass || '')
      const row: Record<string, unknown> = {
        org_id: orgId,
        board_id: a.board_id || null,
        label: a.label || null,
        from_email: String(a.from_email || ''),
        from_name: a.from_name || null,
        smtp_host: String(a.smtp_host || ''),
        smtp_port: Number(a.smtp_port || 465),
        smtp_secure: a.smtp_secure !== false,
        smtp_user: String(a.smtp_user || a.from_email || ''),
        is_active: a.is_active !== false,
        updated_at: new Date().toISOString(),
      }
      if (pass) row.smtp_pass_encrypted = await encrypt(pass)
      if (a.id) {
        // Al editar sin contraseña nueva, no la pisamos
        if (!pass) delete row.smtp_pass_encrypted
        const { error } = await admin.from('email_accounts').update(row).eq('id', a.id).eq('org_id', orgId)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id: a.id })
      } else {
        if (!pass) return json({ error: 'Falta la contraseña SMTP' }, 400)
        const { data, error } = await admin.from('email_accounts').insert(row).select('id').single()
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id: data.id })
      }
    }

    // ── Enviar correo ───────────────────────────────────────────────────────────
    if (action === 'send') {
      const accountId = String(body.account_id || '')
      const to = String(body.to || '').trim()
      const subject = String(body.subject || '(sin asunto)')
      body.body = String(body.body || '')
      if (!accountId || !to) return json({ error: 'Faltan destinatario o cuenta' }, 400)

      const { data: acc } = await admin.from('email_accounts').select('*').eq('id', accountId).maybeSingle()
      if (!acc || !myOrgs.has(acc.org_id)) return json({ error: 'Cuenta no encontrada' }, 404)

      let smtpPass = ''
      try { smtpPass = await decrypt(acc.smtp_pass_encrypted) } catch { return json({ error: 'No se pudo descifrar la contraseña SMTP' }, 500) }

      const bodyText = String(body.body || '')
      const att = body.attachment as { name?: string; contentBase64?: string } | undefined
      let sendError: string | null = null
      try {
        const client = new SMTPClient({
          connection: {
            hostname: acc.smtp_host,
            port: acc.smtp_port,
            tls: acc.smtp_secure,   // 465 → true; para 587 con STARTTLS, denomailer negocia
            auth: { username: acc.smtp_user, password: smtpPass },
          },
        })
        await client.send({
          from: acc.from_name ? `${acc.from_name} <${acc.from_email}>` : acc.from_email,
          to,
          subject,
          content: bodyText,
          html: bodyText.replace(/\n/g, '<br>'),
          attachments: att?.contentBase64 && att?.name
            ? [{ filename: att.name, content: att.contentBase64, encoding: 'base64', contentType: 'application/pdf' }]
            : undefined,
        })
        await client.close()
      } catch (e) {
        sendError = e instanceof Error ? e.message : 'Error SMTP'
      }

      // Registrar el envío (visible para todo el equipo)
      await admin.from('sent_emails').insert({
        org_id: acc.org_id, lead_id: body.lead_id || null, board_id: acc.board_id || null,
        budget_id: body.budget_id || null, from_email: acc.from_email, to_email: to,
        subject, body: bodyText, attachment_name: att?.name || null,
        status: sendError ? 'error' : 'sent', error: sendError, created_by: user.id,
      })

      if (sendError) return json({ ok: false, error: sendError }, 502)
      return json({ ok: true })
    }

    return json({ error: 'Acción no soportada' }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'error' }, 500)
  }
})
