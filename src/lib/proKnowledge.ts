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

// Tarifas de TODOS los profesionales activos de la org, como texto para el prompt.
// Así la IA usa vuestros precios reales aunque no se seleccione un profesional.
export async function fetchProfessionalsRatesText(orgId: string): Promise<string> {
  const { data } = await supabase
    .from('professionals')
    .select('name, specialty, rates')
    .eq('org_id', orgId)
    .eq('is_active', true)
  if (!data?.length) return ''
  const blocks: string[] = []
  for (const p of data as { name: string; specialty: string | null; rates: { work_type: string; rec_price: number; min_price: number; unit: string }[] | null }[]) {
    const rates = p.rates ?? []
    if (!rates.length) continue
    blocks.push(`${p.name}${p.specialty ? ` (${p.specialty})` : ''}: ` +
      rates.map(r => `${r.work_type} → ${r.rec_price}€/${r.unit} (mín ${r.min_price}€)`).join('; '))
  }
  if (!blocks.length) return ''
  return `TARIFAS REALES DE LOS PROFESIONALES (precio de referencia PRIORITARIO: cuando el trabajo coincida con una tarifa, usa ese precio unitario, no inventes uno más bajo):\n${blocks.join('\n')}`
}

// Conocimiento combinado para generar: tarifas + biblioteca de la org + conocimiento del profesional.
export async function fetchGenerationKnowledge(orgId: string, professionalId?: string | null): Promise<string> {
  const [rates, lib, pro] = await Promise.all([
    fetchProfessionalsRatesText(orgId),
    fetchBudgetLibraryText(orgId),
    professionalId ? fetchProKnowledgeText(professionalId) : Promise.resolve(''),
  ])
  return [
    rates,
    lib ? `BIBLIOTECA DE PRESUPUESTOS REALES DE LA EMPRESA (úsala como referencia principal de formato, partidas y precios):${lib}` : '',
    pro,
  ].filter(Boolean).join('\n\n')
}
