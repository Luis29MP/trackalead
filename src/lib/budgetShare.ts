import { supabase } from './supabase'
import { budgetPdfBlob, type PdfOrgInfo } from './budgetPdf'
import { formatCurrency } from './utils'
import type { Budget } from '@/types'

// Sube el PDF del presupuesto al bucket público "budgets" y devuelve su URL pública.
export async function uploadBudgetPdf(budget: Budget, issuer: PdfOrgInfo): Promise<string | null> {
  try {
    const blob = budgetPdfBlob(budget, issuer)
    const path = `${budget.org_id}/${budget.id}.pdf`
    const { error } = await supabase.storage.from('budgets').upload(path, blob, {
      upsert: true,
      contentType: 'application/pdf',
    })
    if (error) { console.error('[uploadBudgetPdf]', error); return null }
    const { data } = supabase.storage.from('budgets').getPublicUrl(path)
    return data.publicUrl
  } catch (e) {
    console.error('[uploadBudgetPdf]', e)
    return null
  }
}

// Construye el enlace de WhatsApp con el mensaje (y el link al PDF si existe).
export function buildWhatsAppUrl(budget: Budget, pdfUrl: string | null, clientName?: string, phone?: string | null): string {
  const p = (phone ?? budget.client_phone ?? '').replace(/\D/g, '')
  const link = pdfUrl ? `\n\n📄 Descarga tu presupuesto en PDF: ${pdfUrl}` : ''
  const msg = encodeURIComponent(
    `Hola ${clientName || budget.client_name || ''}, te paso el presupuesto para "${budget.concept || 'tu trabajo'}" por un total de ${formatCurrency(budget.total)} (IVA incluido), válido ${budget.validity_days} días.${link}\n\nCualquier duda, me dices. ¡Gracias!`
  )
  return p ? `https://wa.me/34${p}?text=${msg}` : `https://wa.me/?text=${msg}`
}
