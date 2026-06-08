import type { BudgetLine, ProRate } from '@/types'

// ── Generación de presupuestos con IA ──────────────────────────────────────────
export interface GeneratedBudget {
  lines: BudgetLine[]
  subtotal: number
  notes: string
  estimated_days: number
}

export async function generateBudget(params: {
  clientName: string
  concept: string
  notes?: string
  zone?: string
  marginPercent: number
  proRates?: ProRate[]
  extraInstructions?: string
}): Promise<GeneratedBudget> {
  const { clientName, concept, notes, zone, marginPercent, proRates, extraInstructions } = params

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('No hay clave de IA configurada (VITE_ANTHROPIC_API_KEY)')

  const ratesText = proRates && proRates.length > 0
    ? `\nEl profesional asignado tiene estas tarifas (úsalas como referencia): ${proRates.map(r => `${r.work_type}: ${r.rec_price}€/${r.unit} (mín ${r.min_price}€)`).join('; ')}.`
    : ''
  const extraText = extraInstructions?.trim() ? `\nNotas adicionales del usuario: ${extraInstructions.trim()}` : ''

  const system = 'Eres un experto en presupuestos de reformas y servicios del hogar en España. Genera presupuestos detallados con precios de mercado actuales en España, tirando siempre un 15-20% por encima del precio mínimo de mercado para asegurar margen.'

  const userPrompt = `Genera un presupuesto detallado para el siguiente trabajo:
Cliente: ${clientName}
Trabajo: ${concept}${notes ? ` — ${notes}` : ''}
Zona: ${zone || 'España'}
Margen adicional solicitado: ${marginPercent}%${ratesText}${extraText}

Responde SOLO en JSON con este formato (sin texto adicional, sin markdown):
{
  "lines": [{ "concept": string, "units": number, "unit_price": number, "total": number }],
  "subtotal": number,
  "notes": string,
  "estimated_days": number
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Error de la IA (${res.status}). ${errText.slice(0, 120)}`)
  }

  const data = await res.json()
  const raw: string = data.content?.[0]?.text ?? ''
  const parsed = parseBudgetJson(raw)
  if (!parsed) throw new Error('La IA no devolvió un presupuesto válido')

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

function parseBudgetJson(raw: string): { lines?: BudgetLine[]; subtotal?: number; notes?: string; estimated_days?: number } | null {
  if (!raw) return null
  // Quitar fences de markdown si los hubiera
  let txt = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  // Extraer el primer objeto { ... }
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start >= 0 && end > start) txt = txt.slice(start, end + 1)
  try {
    return JSON.parse(txt)
  } catch {
    return null
  }
}

// Genera un resumen del trabajo a realizar.
// 1. Intenta Claude via VITE_ANTHROPIC_API_KEY (CORS puede bloquearlo en browser)
// 2. Si falla → resumen estructurado local sin IA

export async function summarizeLeadText(params: {
  text: string
  concept?: string
  zone?: string
}): Promise<string> {
  const { text, concept, zone } = params

  // Intentar con Anthropic API si hay key configurada
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (apiKey) {
    try {
      const ctx = [concept && `Servicio: ${concept}`, zone && `Zona: ${zone}`].filter(Boolean).join('. ')
      const prompt = `Eres asistente de un CRM de reformas en España. Resume en 2-3 frases el siguiente mensaje de cliente. ${ctx ? `Contexto: ${ctx}.` : ''} Extrae: qué trabajo quiere, dónde, detalles relevantes. Solo el resumen, sin saludos.\n\nMensaje:\n${text}`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 250,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const summary = data.content?.[0]?.text
        if (summary) return summary.trim()
      }
    } catch { /* CORS o error de red — caemos al resumen local */ }
  }

  // Intentar via Edge Function de Supabase
  try {
    const { supabase } = await import('./supabase')
    const { data, error } = await supabase.functions.invoke('summarize-lead', {
      body: { text, concept, zone },
    })
    if (!error && data?.summary) return data.summary
  } catch { /* función no desplegada */ }

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
