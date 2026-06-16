import { supabase } from './supabase'

// Devuelve el conocimiento del profesional (texto extraído) condensado para
// inyectarlo en el prompt de la IA y afinar los precios.
export async function fetchProKnowledgeText(professionalId: string): Promise<string> {
  const { data } = await supabase
    .from('pro_knowledge')
    .select('type, title, content_text')
    .eq('professional_id', professionalId)
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)
  if (!data?.length) return ''

  let out = ''
  for (const k of data) {
    const chunk = `\n--- ${k.type}: ${k.title ?? ''} ---\n${(k.content_text ?? '').slice(0, 2500)}`
    if (out.length + chunk.length > 8000) break   // límite para no inflar el prompt
    out += chunk
  }
  return out.trim()
}
