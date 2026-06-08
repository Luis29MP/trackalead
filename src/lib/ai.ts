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
