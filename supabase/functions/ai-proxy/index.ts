// ai-proxy — Proxy unificado de IA por usuario.
// Recibe { user_id, prompt, provider?, model?, system?, max_tokens? }
// Recupera las keys del usuario (cifradas) vía RPC get_ai_keys (service_role),
// llama al proveedor preferido y, si falla, reintenta con los demás (fallback silencioso).
// Desplegar con:  supabase functions deploy ai-proxy --no-verify-jwt
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret } from '../_shared/crypto.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface KeyRow {
  provider: 'anthropic' | 'openai' | 'gemini'
  api_key: string
  preferred_model: string | null
  is_preferred: boolean
}

// Imagen en base64 (sin el prefijo data:)
interface ImagePart { mime: string; data: string }

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
}

// Normaliza IDs de modelo antiguos/retirados a IDs válidos actuales.
// Así las keys ya guardadas siguen funcionando sin reintroducir nada.
const MODEL_ALIASES: Record<string, Record<string, string>> = {
  anthropic: {
    'claude-opus-4': 'claude-opus-4-8',
    'claude-sonnet-4': 'claude-sonnet-4-6',
    'claude-haiku-4': 'claude-haiku-4-5',
  },
  gemini: {
    'gemini-2.0-flash': 'gemini-2.5-flash',
    'gemini-1.5-flash': 'gemini-2.5-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro',
  },
}
function normalizeModel(provider: string, model: string): string {
  return MODEL_ALIASES[provider]?.[model] ?? model
}

async function callAnthropic(key: string, model: string, prompt: string, system: string | undefined, maxTokens: number, webSearch: boolean, images: ImagePart[]): Promise<string> {
  const content: unknown[] = [{ type: 'text', text: prompt }]
  for (const img of images) content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } })
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(webSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] } : {}),
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  // Concatenar todos los bloques de texto (con web_search hay varios bloques)
  const text = (data?.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n').trim()
  if (!text) throw new Error('anthropic: respuesta vacía')
  return text
}

async function callOpenAI(key: string, model: string, prompt: string, system: string | undefined, maxTokens: number, images: ImagePart[]): Promise<string> {
  const messages: { role: string; content: unknown }[] = []
  if (system) messages.push({ role: 'system', content: system })
  if (images.length) {
    const userContent: unknown[] = [{ type: 'text', text: prompt }]
    for (const img of images) userContent.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })
    messages.push({ role: 'user', content: userContent })
  } else {
    messages.push({ role: 'user', content: prompt })
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('openai: respuesta vacía')
  return text
}

async function callGemini(key: string, model: string, prompt: string, system: string | undefined, maxTokens: number, webSearch: boolean, images: ImagePart[]): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
  // gemini-2.5-pro OBLIGA a usar "thinking" (thinkingBudget 0 da error 400).
  // flash / flash-lite sí permiten desactivarlo (0) para que no trunque el JSON.
  const thinkingOnly = /pro/i.test(model)
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: Math.max(maxTokens, thinkingOnly ? 8000 : 4000),
    temperature: 0.4,
    // pro → presupuesto dinámico (-1); flash → desactivado (0)
    thinkingConfig: { thinkingBudget: thinkingOnly ? -1 : 0 },
  }
  const parts: unknown[] = [{ text: prompt }]
  for (const img of images) parts.push({ inlineData: { mimeType: img.mime, data: img.data } })
  const body: Record<string, unknown> = {
    contents: [{ parts }],
    generationConfig,
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  if (webSearch) {
    // Búsqueda en Google integrada (incompatible con responseMimeType JSON)
    body.tools = [{ google_search: {} }]
  } else {
    // Sin búsqueda → forzar JSON válido garantizado
    generationConfig.responseMimeType = 'application/json'
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  // Unir TODAS las partes de texto del candidato (grounding puede devolver varias)
  const outParts = data?.candidates?.[0]?.content?.parts ?? []
  const text = outParts.map((p: { text?: string }) => p.text ?? '').join('').trim()
  if (!text) throw new Error('gemini: respuesta vacía o sin texto (posible límite de tokens)')
  return text
}

async function callProvider(row: KeyRow, prompt: string, system: string | undefined, model: string | undefined, maxTokens: number, webSearch: boolean, images: ImagePart[]): Promise<string> {
  const m = normalizeModel(row.provider, model || row.preferred_model || DEFAULT_MODEL[row.provider])
  if (row.provider === 'anthropic') return callAnthropic(row.api_key, m, prompt, system, maxTokens, webSearch, images)
  if (row.provider === 'openai')    return callOpenAI(row.api_key, m, prompt, system, maxTokens, images)
  if (row.provider === 'gemini')    return callGemini(row.api_key, m, prompt, system, maxTokens, webSearch, images)
  throw new Error(`Proveedor desconocido: ${row.provider}`)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user_id, prompt, provider, model, system, max_tokens, web_search, images } = await req.json()
    if (!user_id) return json({ error: 'user_id requerido' }, 400)
    if (!prompt)  return json({ error: 'prompt requerido' }, 400)
    const maxTokens = Number(max_tokens) || 1500
    const webSearch = !!web_search
    const imgParts: ImagePart[] = Array.isArray(images)
      ? images.filter((i: ImagePart) => i?.mime && i?.data).slice(0, 6)
      : []

    const kek = Deno.env.get('AI_KEYS_KEK')
    if (!kek) return json({ error: 'AI_KEYS_KEK no configurado en los secrets de la Edge Function' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Leer keys cifradas (service_role ignora RLS). Preferido primero.
    const { data: rowsRaw, error } = await supabase
      .from('user_api_keys')
      .select('provider, api_key, preferred_model, is_preferred')
      .eq('user_id', user_id)
      .order('is_preferred', { ascending: false })
      .order('updated_at', { ascending: false })
    if (error) return json({ error: `No se pudieron leer las keys: ${error.message}` }, 500)

    // Descifrar cada key (AES-GCM). Si alguna no se puede descifrar, se omite.
    const rows: KeyRow[] = []
    for (const r of rowsRaw ?? []) {
      if (!r.api_key) continue
      try {
        rows.push({
          provider: r.provider,
          api_key: await decryptSecret(r.api_key, kek),
          preferred_model: r.preferred_model,
          is_preferred: r.is_preferred,
        })
      } catch {
        // key ilegible (KEK cambiada o dato corrupto) → omitir
      }
    }
    if (rows.length === 0) return json({ error: 'El usuario no tiene ninguna API key de IA válida configurada' }, 400)

    // Orden de intento: proveedor pedido → preferido → resto (get_ai_keys ya ordena por preferido)
    let ordered = rows
    if (provider) {
      const first = rows.filter(r => r.provider === provider)
      const rest = rows.filter(r => r.provider !== provider)
      ordered = [...first, ...rest]
    }

    const errors: string[] = []
    for (const row of ordered) {
      try {
        // Solo respetar el override de modelo para el primer proveedor solicitado
        const useModel = provider && row.provider === provider ? model : undefined
        const text = await callProvider(row, prompt, system, useModel, maxTokens, webSearch, imgParts)
        return json({ text, provider: row.provider, model: useModel || row.preferred_model || DEFAULT_MODEL[row.provider] })
      } catch (e) {
        errors.push(String(e))
        // fallback silencioso al siguiente proveedor
      }
    }

    return json({ error: 'Todos los proveedores fallaron', details: errors }, 502)
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
