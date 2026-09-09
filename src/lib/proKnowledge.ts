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

// Biblioteca de presupuestos reales de la organización (a nivel org) para que la IA
// aprenda vuestro formato y precios. Condensada y recortada para no inflar el prompt.
export async function fetchBudgetLibraryText(orgId: string): Promise<string> {
  const { data } = await supabase
    .from('budget_library')
    .select('title, gremio, content_text')
    .eq('org_id', orgId)
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30)
  if (!data?.length) return ''

  let out = ''
  for (const k of data) {
    const chunk = `\n--- Presupuesto real${k.gremio ? ` (${k.gremio})` : ''}: ${k.title ?? ''} ---\n${(k.content_text ?? '').slice(0, 3000)}`
    if (out.length + chunk.length > 12000) break
    out += chunk
  }
  return out.trim()
}

// Conocimiento combinado para generar: biblioteca de la org + conocimiento del profesional.
export async function fetchGenerationKnowledge(orgId: string, professionalId?: string | null): Promise<string> {
  const [lib, pro] = await Promise.all([
    fetchBudgetLibraryText(orgId),
    professionalId ? fetchProKnowledgeText(professionalId) : Promise.resolve(''),
  ])
  return [
    lib ? `BIBLIOTECA DE PRESUPUESTOS REALES DE LA EMPRESA (úsala como referencia principal de formato, partidas y precios):${lib}` : '',
    pro,
  ].filter(Boolean).join('\n\n')
}
