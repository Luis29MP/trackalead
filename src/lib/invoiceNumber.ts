import { supabase } from './supabase'

// Siguiente número de factura siguiendo el patrón del último de la misma serie.
// Si el último fue "A-2026-007" → "A-2026-008" (conserva prefijo y ancho).
// Si no hay ninguno en la serie → "<serie>-<año>-001".
export async function nextInvoiceNumber(orgId: string, series: string): Promise<string> {
  const { data } = await supabase.from('invoices')
    .select('invoice_number')
    .eq('org_id', orgId).eq('invoice_series', series)
    .order('created_at', { ascending: false }).limit(1)
  const last = data?.[0]?.invoice_number as string | undefined
  if (last) {
    const m = last.match(/^(.*?)(\d+)(\D*)$/)
    if (m) {
      const n = String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0')
      return `${m[1]}${n}${m[3]}`
    }
  }
  const year = new Date().getFullYear()
  return `${series}-${year}-001`
}
