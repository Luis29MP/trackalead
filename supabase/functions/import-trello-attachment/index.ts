// import-trello-attachment — descarga UN adjunto de Trello (que requiere auth) y lo
// guarda como archivo del lead. Recibe { attachmentUrl, attachmentName, attachmentId, leadId }.
// Las credenciales de Trello se leen de los secrets de la función (NUNCA del cliente).
// Idempotente: si el adjunto ya está subido a ese lead, no lo duplica.
// Desplegar con verify-jwt (solo usuarios autenticados pueden invocarla).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } })
}

const BUCKET = 'lead-files'

// Nombre de archivo seguro para la ruta de Storage
function safeName(name: string): string {
  return (name || 'archivo')
    .normalize('NFKD').replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_').slice(0, 80) || 'archivo'
}

// Descarga el adjunto de Trello. Primero con cabecera OAuth (fiable para URLs de
// descarga), y si da 401/403 reintenta con key+token en la query.
async function downloadFromTrello(url: string, key: string, token: string): Promise<Response> {
  const authHeader = { Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"` }
  let res = await fetch(url, { headers: authHeader, redirect: 'follow' })
  if (res.status === 401 || res.status === 403) {
    const sep = url.includes('?') ? '&' : '?'
    res = await fetch(`${url}${sep}key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`, { redirect: 'follow' })
  }
  return res
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const TRELLO_API_KEY = Deno.env.get('TRELLO_API_KEY')
    const TRELLO_API_TOKEN = Deno.env.get('TRELLO_API_TOKEN')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!TRELLO_API_KEY || !TRELLO_API_TOKEN) {
      return json({ ok: false, error: 'Faltan TRELLO_API_KEY / TRELLO_API_TOKEN en los secrets de la función' }, 500)
    }
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ ok: false, error: 'Configuración de Supabase incompleta en la función' }, 500)
    }

    const { attachmentUrl, attachmentName, attachmentId, leadId } = await req.json()
    if (!attachmentUrl || !leadId) {
      return json({ ok: false, error: 'attachmentUrl y leadId son obligatorios' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // El lead da la organización (para la ruta) y valida que existe
    const { data: lead, error: leadErr } = await admin
      .from('leads').select('org_id').eq('id', leadId).single()
    if (leadErr || !lead) return json({ ok: false, error: 'Lead no encontrado' }, 404)

    const name = attachmentName || 'archivo'
    const attId = attachmentId || crypto.randomUUID()
    const path = `${lead.org_id}/${leadId}/trello-${attId}-${safeName(name)}`
    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path)
    const publicUrl = urlData.publicUrl

    // Idempotencia: si ya existe ese archivo en el lead, no lo repetimos
    const { data: existing } = await admin
      .from('lead_files').select('id').eq('lead_id', leadId).eq('url', publicUrl).maybeSingle()
    if (existing) return json({ ok: true, skipped: true, url: publicUrl, name })

    // 1) Descargar de Trello
    const res = await downloadFromTrello(String(attachmentUrl), TRELLO_API_KEY, TRELLO_API_TOKEN)
    if (res.status === 401 || res.status === 403) {
      return json({ ok: false, expired: true, error: 'Token de Trello caducado o sin permiso, vuelve a generarlo' })
    }
    if (!res.ok) {
      return json({ ok: false, error: `No se pudo descargar de Trello (HTTP ${res.status})` })
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) return json({ ok: false, error: 'El adjunto llegó vacío desde Trello' })

    // 2) Subir a Storage (lead-files)
    const { error: upErr } = await admin.storage.from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true })
    if (upErr) return json({ ok: false, error: `Error subiendo a Storage: ${upErr.message}` })

    // 3) Guardar en la tabla de archivos del lead
    const { error: insErr } = await admin.from('lead_files').insert({
      lead_id: leadId, name, url: publicUrl, type: contentType, size: bytes.byteLength,
    })
    if (insErr) return json({ ok: false, error: `Error guardando el archivo: ${insErr.message}` })

    return json({ ok: true, url: publicUrl, name, size: bytes.byteLength })
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }, 500)
  }
})
