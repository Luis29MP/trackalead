// save-api-key — Cifra (AES-GCM) y guarda la API key de IA de un usuario.
// Body: { user_id, provider, api_key, preferred_model?, is_preferred? }
// Si api_key llega vacío, solo actualiza modelo / preferido (no pisa la key).
// Desplegar:  supabase functions deploy save-api-key --no-verify-jwt
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret } from '../_shared/crypto.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PROVIDERS = ['anthropic', 'openai', 'gemini']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user_id, provider, api_key, preferred_model, is_preferred } = await req.json()
    if (!user_id) return json({ error: 'user_id requerido' }, 400)
    if (!PROVIDERS.includes(provider)) return json({ error: 'provider inválido' }, 400)

    const kek = Deno.env.get('AI_KEYS_KEK')
    if (!kek) return json({ error: 'AI_KEYS_KEK no configurado en los secrets de la Edge Function' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const now = new Date().toISOString()

    if (api_key && String(api_key).trim()) {
      const encrypted = await encryptSecret(String(api_key).trim(), kek)
      const { error } = await supabase.from('user_api_keys').upsert({
        user_id,
        provider,
        api_key: encrypted,
        preferred_model: preferred_model ?? null,
        is_preferred: !!is_preferred,
        updated_at: now,
      }, { onConflict: 'user_id,provider' })
      if (error) return json({ error: error.message }, 500)
    } else {
      // Sin key nueva: solo actualizar modelo / preferido del registro existente
      const { error } = await supabase.from('user_api_keys').update({
        preferred_model: preferred_model ?? null,
        is_preferred: !!is_preferred,
        updated_at: now,
      }).eq('user_id', user_id).eq('provider', provider)
      if (error) return json({ error: error.message }, 500)
    }

    // Si este pasa a ser el preferido, desmarcar los demás del usuario
    if (is_preferred) {
      await supabase.from('user_api_keys')
        .update({ is_preferred: false })
        .eq('user_id', user_id)
        .neq('provider', provider)
    }

    return json({ ok: true })
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
