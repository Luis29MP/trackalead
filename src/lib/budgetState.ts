import type { BudgetState } from '@/types'

// Metadatos visuales de cada estado de presupuestación de un lead
export const BUDGET_STATE_META: Record<BudgetState, { label: string; color: string; dot: string; emoji: string }> = {
  pendiente: { label: 'Presupuesto pendiente', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', emoji: '📄' },
  enviado:   { label: 'Enviado a profesional', color: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500',   emoji: '📤' },
  validado:  { label: 'Validado',              color: 'bg-green-100 text-green-700',   dot: 'bg-green-500',  emoji: '✅' },
  facturado: { label: 'Facturado',             color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500', emoji: '🧾' },
}

// Estado MÁS avanzado: facturado > validado > enviado > pendiente
export function computeBudgetState(
  budgets: { status: string; validated_at?: string | null }[],
  hasInvoice: boolean,
): BudgetState | null {
  if (hasInvoice) return 'facturado'
  if (budgets.some(b => b.validated_at)) return 'validado'
  if (budgets.some(b => b.status === 'sent')) return 'enviado'
  if (budgets.some(b => b.status === 'draft')) return 'pendiente'
  return null
}
