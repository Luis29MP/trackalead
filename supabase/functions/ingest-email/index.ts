// ingest-email — Recibe un email (desde un servicio de correo entrante / reenvío),
// decide si es un LEAD real o basura, y si lo es lo crea en el tablero que toca.
// Seguridad: ?token=EMAIL_INGEST_SECRET (o cabecera x-ingest-token).
// Desplegar con verify_jwt=false (lo llama un webhook externo, sin JWT).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })
}

function domainOf(addr: string): string {
  const m = String(addr || '').toLowerCase().match(/@([a-z0-9.-]+)/)
  return m ? m[1].replace(/^www\./, '') : ''
}
function localPart(addr: string): string {
  const m = String(addr || '').toLowerCase().match(/([^<@\s]+)@/)
  return m ? m[1] : ''
}
function plusTag(addr: string): string {
  const lp = localPart(addr); const i = lp.indexOf('+')
  return i >= 0 ? lp.slice(i + 1) : ''
}
function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
// Teléfono español: 9 dígitos empezando por 6/7/8/9, con o sin prefijo +34
function spanishPhone(text: string): string {
  const m = String(text || '').match(/(?:\+?34[\s.\-]?)?([6789](?:[\s.\-]?\d){8})/)
  if (!m) return ''
  const digits = m[1].replace(/\D/g, '')
  return digits.length === 9 ? digits : ''
}

const AI_TRIAGE_SYSTEM = `Eres un filtro de leads de un CRM de servicios del hogar en España (reformas, pintura, electricidad, fontanería, carpintería, carpintería metálica, placas solares).
Te doy el contenido de un email recibido desde el formulario de contacto de una web. Decide si es un LEAD REAL (una persona pidiendo presupuesto o información sobre un trabajo) o BASURA (spam, publicidad, SEO, notificaciones automáticas, pruebas o texto incoherente).
Un lead real normalmente tiene: nombre de persona, un teléfono español o email, y un texto coherente describiendo una necesidad.
Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin markdown) con esta forma:
{
  "is_lead": true o false,
  "reason": "motivo breve de la decisión",
  "name": "nombre de la persona o ''",
  "phone": "teléfono o ''",
  "email": "email o ''",
  "zone": "ciudad o zona o ''",
  "concept": "resumen corto del trabajo con terminología del gremio, o ''",
  "description": "resumen en 2-3 frases, nunca literal, o ''"
}`

function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s >= 0 && e > s) t = t.slice(s, e + 1)
  try { return JSON.parse(t) } catch { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const SECRET = Deno.env.get('EMAIL_INGEST_SECRET')
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Auth por token
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || req.headers.get('x-ingest-token') || ''
  if (SECRET && token !== SECRET) return json({ error: 'No autorizado' }, 401)

  async function log(row: Record<string, unknown>) {
    try { await admin.from('email_ingest_events').insert(row) } catch { /* no romper por el log */ }
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    // Campos tolerantes a varios proveedores (Postmark, CloudMailin, genérico)
    const from = String(body.FromFull && (body.FromFull as { Email?: string }).Email || body.From || body.from || (body.envelope as { from?: string })?.from || '')
    const subject = String(body.Subject || body.subject || (body.headers as { subject?: string })?.subject || '')
    const textBody = String(body.TextBody || body.text || body.plain || '')
    const htmlBody = String(body.HtmlBody || body.html || '')
    const mailboxHash = String(body.MailboxHash || '').toLowerCase().trim()
    const toAddr = String(
      body.OriginalRecipient ||
      (Array.isArray(body.ToFull) && (body.ToFull as { Email?: string }[])[0]?.Email) ||
      body.To || body.to || (body.envelope as { to?: string })?.to || '')

    const text = (textBody && textBody.trim()) ? textBody : stripHtml(htmlBody)
    const excerpt = `${subject}\n${text}`.slice(0, 500)

    // 1) Ruta → tablero. Candidatos, por fiabilidad: alias +hash, +tag o parte local del
    //    destinatario (carpinteria@…, hash+carpinteria@…), y dominio del destinatario/remitente.
    const candidates = [mailboxHash, plusTag(toAddr), localPart(toAddr), domainOf(toAddr), domainOf(from)].filter(Boolean)
    let route: { org_id: string; board_id: string; key: string } | null = null
    if (candidates.length) {
      const { data } = await admin.from('email_ingest_routes').select('org_id, board_id, key').in('key', candidates).limit(1).maybeSingle()
      if (data) route = data
    }
    if (!route) {
      await log({ status: 'no_route', reason: `sin ruta para: ${candidates.join(', ') || '—'}`, from_addr: from, subject, raw_excerpt: excerpt })
      return json({ ok: true, skipped: 'no_route' })
    }

    // 2) Filtro heurístico barato: debe haber teléfono español o email, y algo de texto
    const heurPhone = spanishPhone(`${subject}\n${text}`)
    const emailMatch = `${subject}\n${text}`.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)
    if (!heurPhone && !emailMatch) {
      await log({ org_id: route.org_id, board_id: route.board_id, route_key: route.key, status: 'discarded_no_contact', reason: 'sin teléfono ni email', from_addr: from, subject, raw_excerpt: excerpt })
      return json({ ok: true, discarded: 'no_contact' })
    }
    if (text.replace(/\s/g, '').length < 12) {
      await log({ org_id: route.org_id, board_id: route.board_id, route_key: route.key, status: 'discarded_no_contact', reason: 'texto demasiado corto', from_addr: from, subject, raw_excerpt: excerpt })
      return json({ ok: true, discarded: 'too_short' })
    }

    // 3) IA: propietario de la org para usar sus keys de IA
    const { data: owner } = await admin.from('org_members').select('user_id').eq('org_id', route.org_id).eq('role', 'owner').maybeSingle()
    let ai: Record<string, unknown> | null = null
    if (owner?.user_id) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({ user_id: owner.user_id, system: AI_TRIAGE_SYSTEM, prompt: `Asunto: ${subject}\n\n${text}`.slice(0, 8000), max_tokens: 900, web_search: false, images: [] }),
        })
        const d = await r.json()
        ai = extractJson(d?.text ?? '')
      } catch { /* si la IA falla, decidimos por heurística */ }
    }

    // Decisión: la IA manda; si no hubo IA, vale la heurística (tiene contacto y texto)
    const isLead = ai ? ai.is_lead === true : true
    if (!isLead) {
      await log({ org_id: route.org_id, board_id: route.board_id, route_key: route.key, status: 'discarded_ai', reason: String(ai?.reason ?? 'IA: no es lead'), from_addr: from, subject, raw_excerpt: excerpt })
      return json({ ok: true, discarded: 'ai' })
    }

    const name = String(ai?.name || '').trim() || (from.split('@')[0] || 'Nuevo lead')
    const phone = String(ai?.phone || '').trim() || heurPhone
    const email = String(ai?.email || '').trim() || (emailMatch ? emailMatch[0] : '')
    const zone = String(ai?.zone || '').trim()
    const concept = String(ai?.concept || '').trim()
    const desc = String(ai?.description || '').trim()
    const notes = [
      desc,
      '',
      `📧 Recibido por email del formulario (${route.key})`,
      `— — —`,
      `Asunto: ${subject}`,
      text.slice(0, 1500),
    ].filter(v => v !== undefined).join('\n')

    // 4) Crear el lead arriba de la primera columna del tablero
    const { data: col } = await admin.from('board_columns').select('id').eq('board_id', route.board_id).order('position', { ascending: true }).limit(1).maybeSingle()
    if (!col) {
      await log({ org_id: route.org_id, board_id: route.board_id, route_key: route.key, status: 'error', reason: 'el tablero no tiene columnas', from_addr: from, subject, raw_excerpt: excerpt })
      return json({ ok: false, error: 'sin columnas' })
    }
    const { data: top } = await admin.from('leads').select('position').eq('column_id', col.id).eq('is_archived', false).not('position', 'is', null).order('position', { ascending: true }).limit(1).maybeSingle()
    const position = top?.position != null ? top.position - 1 : 0

    const { data: lead, error: insErr } = await admin.from('leads').insert({
      board_id: route.board_id, org_id: route.org_id, column_id: col.id,
      title: name, name, phone: phone || null, email: email || null,
      zone: zone || null, concept: concept || null, notes,
      source: 'form', is_read: false, position,
    }).select('id').single()
    if (insErr || !lead) {
      await log({ org_id: route.org_id, board_id: route.board_id, route_key: route.key, status: 'error', reason: insErr?.message ?? 'insert falló', from_addr: from, subject, raw_excerpt: excerpt })
      return json({ ok: false, error: 'no se pudo crear el lead' })
    }

    await log({ org_id: route.org_id, board_id: route.board_id, route_key: route.key, status: 'created', from_addr: from, subject, raw_excerpt: excerpt, lead_id: lead.id })
    return json({ ok: true, created: true, lead_id: lead.id })
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'error' }, 500)
  }
})
