import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { text, concept, zone } = await req.json()
    if (!text) return new Response(JSON.stringify({ error: 'text requerido' }), { status: 400, headers: corsHeaders })

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada en Supabase Secrets')

    const context = [
      concept && `Servicio/concepto: ${concept}`,
      zone && `Zona: ${zone}`,
    ].filter(Boolean).join('. ')

    const prompt = `Eres un asistente de un CRM de reformas y servicios del hogar en España.
Resume en 2-3 frases claras y concisas el siguiente mensaje de un cliente potencial.
${context ? `Contexto adicional: ${context}.` : ''}
Extrae: qué trabajo quiere, dónde, cualquier detalle relevante (dimensiones, urgencia, materiales).
Responde SOLO con el resumen, sin saludos ni explicaciones.

Mensaje del cliente:
${text}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const summary = data.content?.[0]?.text ?? ''

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
