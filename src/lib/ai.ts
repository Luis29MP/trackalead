import type { BudgetLine, ProRate } from '@/types'

// ── Generación de presupuestos con IA ──────────────────────────────────────────
export interface GeneratedBudget {
  lines: BudgetLine[]
  subtotal: number
  notes: string
  estimated_days: number
}

export interface AiImage { mime: string; data: string }  // data = base64 sin prefijo

export async function generateBudget(params: {
  clientName: string
  concept: string
  notes?: string
  zone?: string
  marginPercent: number
  proRates?: ProRate[]
  extraInstructions?: string
  images?: AiImage[]
  userId?: string   // si se pasa, usa las claves de IA de ese usuario (p.ej. el dueño de la org desde el panel del profesional)
  knowledge?: string  // base de conocimiento del profesional (presupuestos de ejemplo, tarifas…)
}): Promise<GeneratedBudget> {
  const { clientName, concept, notes, zone, marginPercent, proRates, extraInstructions, images, userId, knowledge } = params

  const ratesText = proRates && proRates.length > 0
    ? `\nEl profesional asignado tiene estas tarifas (úsalas como referencia prioritaria): ${proRates.map(r => `${r.work_type}: ${r.rec_price}€/${r.unit} (mín ${r.min_price}€)`).join('; ')}.`
    : ''
  const knowledgeText = knowledge?.trim()
    ? `\n\nCONOCIMIENTO DEL PROFESIONAL (presupuestos de ejemplo, tarifas y notas reales — úsalo como REFERENCIA PRINCIPAL para fijar precios realistas y coherentes con su forma de trabajar):\n${knowledge.trim()}`
    : ''
  const extraText = extraInstructions?.trim() ? `\nNotas adicionales del usuario: ${extraInstructions.trim()}` : ''

  const system = 'Eres un experto en presupuestos de reformas y servicios del hogar en España. Si tienes acceso a búsqueda web, consulta precios de mercado actuales en España para el trabajo solicitado. Genera presupuestos detallados desglosando materiales y mano de obra, tirando siempre un 15-20% por encima del precio mínimo de mercado para asegurar margen. SIEMPRE debes devolver al menos una línea con un precio realista mayor que 0; nunca devuelvas líneas vacías ni precios a 0. IMPORTANTE: el campo "notes" es un texto que verá el CLIENTE FINAL; NUNCA menciones el margen, la comisión, el sobrecoste, ni cómo calculas o incrementas los precios internamente. Aplica el margen directamente en los precios sin explicarlo.'

  const imgText = images && images.length ? `\nSe adjuntan ${images.length} foto(s) del trabajo: analízalas para estimar medidas, materiales y complejidad.` : ''

  const userPrompt = `Genera un presupuesto detallado y realista para el siguiente trabajo en España:
Cliente: ${clientName}
Trabajo: ${concept}${notes ? ` — ${notes}` : ''}
Zona: ${zone || 'España'}
Margen adicional solicitado: ${marginPercent}%${ratesText}${extraText}${imgText}${knowledgeText}

Desglosa en líneas (materiales, mano de obra, desplazamiento, tramitación si aplica) con precios de mercado actuales en España.
Tu ÚLTIMA salida debe ser SOLO un objeto JSON válido (sin texto antes ni después, sin markdown) con este formato exacto:
{
  "lines": [{ "concept": string, "units": number, "unit_price": number, "total": number }],
  "subtotal": number,
  "notes": string,
  "estimated_days": number
}`

  // Llamar a la Edge Function ai-proxy. Usa userId si se pasa (panel del profesional →
  // claves del dueño de la org); si no, el usuario autenticado.
  const { supabase } = await import('./supabase')
  let uid = userId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    uid = user?.id
  }
  if (!uid) throw new Error('No hay usuario para la IA')

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { user_id: uid, prompt: userPrompt, system, max_tokens: 4000, web_search: false, images: images ?? [] },
  })
  if (error) {
    // Extraer el mensaje real que devolvió la Edge Function (no el genérico)
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        // Mostrar el detalle por proveedor si existe (más útil que el mensaje genérico)
        if (Array.isArray(body?.details) && body.details.length) detail = body.details.join(' | ')
        else if (body?.error) detail = body.error
      }
    } catch { /* no se pudo leer el cuerpo */ }
    throw new Error(`Error de la IA: ${detail}`)
  }
  if (data?.error) throw new Error(data.error)

  const raw: string = data?.text ?? ''
  console.log('[generateBudget] proveedor:', data?.provider, '| modelo:', data?.model)
  console.log('[generateBudget] respuesta IA cruda →', raw)
  const parsed = parseBudgetJson(raw)
  if (!parsed) throw new Error('La IA no devolvió JSON válido. Empezó con: ' + (raw.slice(0, 160) || '(vacío)'))

  // Normalizar números y recalcular totales por línea por si la IA se equivoca
  const lines: BudgetLine[] = (parsed.lines ?? []).map(l => {
    const units = Number(l.units) || 0
    const unit_price = Number(l.unit_price) || 0
    return { concept: String(l.concept ?? '').trim(), units, unit_price, total: Math.round(units * unit_price * 100) / 100 }
  }).filter(l => l.concept)

  const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100
  return {
    lines,
    subtotal,
    notes: String(parsed.notes ?? '').trim(),
    estimated_days: Number(parsed.estimated_days) || 0,
  }
}

// ── Multi-gremio: un trabajo → varios presupuestos por oficio ───────────────────
export interface GeneratedBudgetSplit extends GeneratedBudget { trade: string }

export async function generateBudgetSplit(params: {
  clientName: string
  concept: string
  notes?: string
  zone?: string
  marginPercent: number
  extraInstructions?: string
  images?: AiImage[]
  userId?: string
  knowledge?: string
}): Promise<GeneratedBudgetSplit[]> {
  const { clientName, concept, notes, zone, marginPercent, extraInstructions, images, userId, knowledge } = params
  const extraText = extraInstructions?.trim() ? `\nNotas adicionales del usuario: ${extraInstructions.trim()}` : ''
  const imgText = images && images.length ? `\nSe adjuntan ${images.length} foto(s) del trabajo: analízalas para estimar.` : ''
  const knowledgeText = knowledge?.trim() ? `\n\nCONOCIMIENTO DEL PROFESIONAL (úsalo como referencia principal de precios):\n${knowledge.trim()}` : ''

  const system = 'Eres un experto en presupuestos de reformas y servicios del hogar en España. Identifica los distintos gremios/oficios que requiere un trabajo (carpintería, electricidad, fontanería, albañilería, pintura, etc.) y genera un presupuesto SEPARADO por cada gremio, con precios de mercado actuales en España y un 15-20% de margen. Nunca devuelvas precios a 0. IMPORTANTE: el campo "notes" lo verá el CLIENTE FINAL; NUNCA menciones el margen, la comisión, el sobrecoste ni cómo calculas los precios. Aplica el margen directamente en los precios sin explicarlo.'

  const userPrompt = `Analiza este trabajo y divídelo en uno o varios presupuestos SEPARADOS por gremio/oficio:
Cliente: ${clientName}
Trabajo: ${concept}${notes ? ` — ${notes}` : ''}
Zona: ${zone || 'España'}
Margen adicional: ${marginPercent}%${extraText}${imgText}${knowledgeText}

Si el trabajo solo necesita un gremio, devuelve un único presupuesto. Si necesita varios (p.ej. carpintería + electricidad), devuelve uno por cada uno.
Tu ÚLTIMA salida debe ser SOLO un objeto JSON válido (sin texto antes ni después, sin markdown):
{
  "budgets": [
    {
      "trade": string,
      "lines": [{ "concept": string, "units": number, "unit_price": number, "total": number }],
      "notes": string,
      "estimated_days": number
    }
  ]
}`

  const { supabase } = await import('./supabase')
  let uid = userId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    uid = user?.id
  }
  if (!uid) throw new Error('No hay usuario para la IA')

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { user_id: uid, prompt: userPrompt, system, max_tokens: 6000, web_search: false, images: images ?? [] },
  })
  if (error) {
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        if (Array.isArray(body?.details) && body.details.length) detail = body.details.join(' | ')
        else if (body?.error) detail = body.error
      }
    } catch { /* no se pudo leer el cuerpo */ }
    throw new Error(`Error de la IA: ${detail}`)
  }
  if (data?.error) throw new Error(data.error)

  const raw: string = data?.text ?? ''
  console.log('[generateBudgetSplit] respuesta IA cruda →', raw)
  const obj = extractJson(raw) as { budgets?: Array<{ trade?: string; lines?: BudgetLine[]; notes?: string; estimated_days?: number }> } | null
  if (!obj || !Array.isArray(obj.budgets) || obj.budgets.length === 0) {
    throw new Error('La IA no devolvió presupuestos válidos. Empezó con: ' + (raw.slice(0, 160) || '(vacío)'))
  }

  return obj.budgets.map(b => {
    const lines: BudgetLine[] = (b.lines ?? []).map(l => {
      const units = Number(l.units) || 0
      const unit_price = Number(l.unit_price) || 0
      return { concept: String(l.concept ?? '').trim(), units, unit_price, total: Math.round(units * unit_price * 100) / 100 }
    }).filter(l => l.concept)
    const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100
    return {
      trade: String(b.trade ?? 'Trabajo').trim() || 'Trabajo',
      lines, subtotal,
      notes: String(b.notes ?? '').trim(),
      estimated_days: Number(b.estimated_days) || 0,
    }
  }).filter(b => b.lines.length > 0)
}

// Extrae el primer objeto JSON { ... } de un texto (tolera fences de markdown)
function extractJson(raw: string): unknown {
  if (!raw) return null
  let txt = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start >= 0 && end > start) txt = txt.slice(start, end + 1)
  try {
    return JSON.parse(txt)
  } catch {
    return null
  }
}

function parseBudgetJson(raw: string): { lines?: BudgetLine[]; subtotal?: number; notes?: string; estimated_days?: number } | null {
  return extractJson(raw) as { lines?: BudgetLine[]; subtotal?: number; notes?: string; estimated_days?: number } | null
}

// Genera un resumen del trabajo a realizar.
// Usa la Edge Function summarize-lead → ai-proxy (API keys del propio usuario).
// Si no hay key configurada o falla → resumen estructurado local sin IA.

export async function summarizeLeadText(params: {
  text: string
  concept?: string
  zone?: string
}): Promise<string> {
  const { text, concept, zone } = params

  // Resumen vía Edge Function (usa las API keys del usuario, no variables de entorno)
  try {
    const { supabase } = await import('./supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data, error } = await supabase.functions.invoke('summarize-lead', {
        body: { user_id: user.id, text, concept, zone },
      })
      if (!error && data?.summary) return data.summary
    }
  } catch { /* función no desplegada o sin key — caemos al resumen local */ }

  // Fallback: resumen estructurado local
  return buildLocalSummary(text, concept, zone)
}

function buildLocalSummary(text: string, concept?: string, zone?: string): string {
  // Eliminar líneas de formulario (Campo: valor)
  const cleanLines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 3)
    .filter(l => {
      const isFormField = /^(nombre|teléfono|telefono|email|correo|selecciona|aceptaci[oó]n|zona|ciudad|cp|c[oó]digo postal|servicio|tipo|origen)\s*:/i.test(l)
      return !isFormField
    })

  // Extraer el mensaje real (generalmente después de "Mensaje:")
  const msgIdx = text.search(/mensaje\s*:/i)
  const rawMsg = msgIdx >= 0
    ? text.slice(msgIdx).replace(/^mensaje\s*:/i, '').trim()
    : cleanLines.join(' ')

  // Construir resumen
  const parts: string[] = []
  if (concept) parts.push(`Solicita: ${concept}`)
  if (zone)    parts.push(`Ubicación: ${zone}`)
  if (rawMsg)  parts.push(rawMsg.substring(0, 200))

  return parts.join('. ').replace(/\.\s*\./g, '.').trim()
}

// ── Análisis inteligente del mensaje del cliente → campos del formulario ─────────
export interface LeadAnalysis {
  name: string        // solo el nombre de pila
  phone: string
  email: string
  zone: string
  concept: string     // resumen corto del trabajo
  work_type: string   // tipo de trabajo con terminología del gremio
  measures: string    // medidas o ''
  description: string // 2-3 frases, no literal
  photos: boolean
  note: string        // oportunidad adicional o ''
}

const LEAD_ANALYSIS_SYSTEM = `Eres un asistente de un CRM de servicios del hogar en España (reformas, pintura, electricidad, carpintería, etc.).
Analiza el mensaje del cliente y extrae la información de forma inteligente.
NO copies el texto literal. Interpreta, resume y detecta oportunidades.
Para el tipo de trabajo usa terminología profesional del gremio.
Para la descripción rápida sé conciso y profesional.
Si detectas una oportunidad futura o trabajo adicional, indícalo en Nota.

Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto adicional ni markdown) con esta forma exacta:
{
  "name": "solo el nombre de pila, sin apellidos si no son imprescindibles",
  "phone": "teléfono o cadena vacía",
  "email": "email o cadena vacía",
  "zone": "ciudad o zona o cadena vacía",
  "concept": "resumen corto del trabajo, ej: 'Puerta corredera blanca con cristal'",
  "work_type": "tipo de trabajo con terminología profesional del gremio",
  "measures": "medidas si las menciona; si no, cadena vacía",
  "description": "resumen inteligente en 2-3 frases, NUNCA literal",
  "photos": true o false según si el cliente menciona o adjunta fotos,
  "note": "oportunidad adicional o trabajo futuro detectado; si no hay, cadena vacía"
}`

export async function analyzeLeadMessage(text: string): Promise<LeadAnalysis> {
  const { supabase } = await import('./supabase')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No hay usuario para la IA')

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { user_id: user.id, prompt: `Mensaje del cliente:\n\n${text}`, system: LEAD_ANALYSIS_SYSTEM, max_tokens: 1500, web_search: false, images: [] },
  })
  if (error) {
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const b = await ctx.json()
        if (Array.isArray(b?.details) && b.details.length) detail = b.details.join(' | ')
        else if (b?.error) detail = b.error
      }
    } catch { /* sin cuerpo */ }
    throw new Error(`Error de la IA: ${detail}`)
  }
  if (data?.error) throw new Error(data.error)

  const obj = extractJson(data?.text ?? '') as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') throw new Error('La IA no devolvió un JSON válido')
  const photosRaw = obj.photos
  return {
    name: String(obj.name ?? '').trim(),
    phone: String(obj.phone ?? '').trim(),
    email: String(obj.email ?? '').trim(),
    zone: String(obj.zone ?? '').trim(),
    concept: String(obj.concept ?? '').trim(),
    work_type: String(obj.work_type ?? '').trim(),
    measures: String(obj.measures ?? '').trim(),
    description: String(obj.description ?? '').trim(),
    photos: photosRaw === true || /^(s[ií]|true|yes)$/i.test(String(photosRaw ?? '').trim()),
    note: String(obj.note ?? '').trim(),
  }
}
