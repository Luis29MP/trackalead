// summarize-lead — Resume el mensaje de un cliente.
// Ya NO usa ANTHROPIC_API_KEY del entorno: delega en ai-proxy, que usa las
// API keys que el propio usuario tiene configuradas (user_api_keys).
// Body: { user_id, text, concept?, zone? }
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user_id, text, concept, zone } = await req.json()
    if (!text)    return resp({ error: 'text requerido' }, 400)
    if (!user_id) return resp({ error: 'user_id requerido' }, 400)

    const context = [
      concept && `Servicio/concepto: ${concept}`,
      zone && `Zona: ${zone}`,
    ].filter(Boolean).join('. ')

    const system = 'Eres un asistente de un CRM de reformas y servicios del hogar en España.'
    const prompt = `Resume en 2-3 frases claras y concisas el siguiente mensaje de un cliente potencial.
${context ? `Contexto adicional: ${context}.` : ''}
Extrae: qué trabajo quiere, dónde, cualquier detalle relevante (dimensiones, urgencia, materiales).
Responde SOLO con el resumen, sin saludos ni explicaciones.

Mensaje del cliente:
${text}`

    // Llamar a ai-proxy (misma instancia de funciones)
    const baseUrl = Deno.env.get('SUPABASE_URL')!
    const res = await fetch(`${baseUrl}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      },
      body: JSON.stringify({ user_id, prompt, system, max_tokens: 300 }),
    })
    const data = await res.json()
    if (!res.ok) return resp({ error: data?.error ?? 'ai-proxy falló' }, 502)

    return resp({ summary: (data.text ?? '').trim() })
  } catch (err) {
    return resp({ error: String(err) }, 500)
  }
})

function resp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
