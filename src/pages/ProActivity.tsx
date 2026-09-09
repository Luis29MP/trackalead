import { useEffect, useState } from 'react'
import { HardHat, Sparkles, FileText, ChevronDown, Eye, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { viewBudgetPdf } from '@/lib/budgetPdf'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Professional, Budget, BudgetLine } from '@/types'

interface OwnBudget {
  id: string; professional_id: string; client_name: string | null; concept: string | null
  lines: BudgetLine[]; subtotal: number; vat_percent: number; total: number; notes: string | null; created_at: string
}
interface LeadBudget { id: string; professional_id: string | null; client_name: string | null; concept: string | null; total: number; created_at: string }
interface Usage { professional_id: string | null; cost_eur: number; created_at: string }

function isThisMonth(iso: string): boolean {
  const d = new Date(iso), n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()
}
// Coste en € con precisión adaptada (son céntimos): pocas cifras → más decimales
function fmtCost(n: number): string {
  if (n === 0) return '0 €'
  if (n < 1) return `${n.toFixed(4).replace('.', ',')} €`
  return `${n.toFixed(2).replace('.', ',')} €`
}

export function ProActivity() {
  const { organization } = useAuth()
  const [pros, setPros] = useState<Professional[]>([])
  const [own, setOwn] = useState<OwnBudget[]>([])
  const [leadB, setLeadB] = useState<LeadBudget[]>([])
  const [usage, setUsage] = useState<Usage[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => { if (organization) load() }, [organization?.id])

  async function load() {
    setLoading(true)
    const [{ data: p }, { data: o }, { data: lb }, { data: u }] = await Promise.all([
      supabase.from('professionals').select('*').eq('org_id', organization!.id).order('name'),
      supabase.from('pro_own_budgets').select('*').eq('org_id', organization!.id).order('created_at', { ascending: false }),
      supabase.from('budgets').select('id, professional_id, client_name, concept, total, created_at').eq('org_id', organization!.id).not('professional_id', 'is', null),
      supabase.from('ai_usage').select('professional_id, cost_eur, created_at').eq('org_id', organization!.id),
    ])
    setPros((p ?? []) as Professional[])
    setOwn((o ?? []) as OwnBudget[])
    setLeadB((lb ?? []) as LeadBudget[])
    setUsage((u ?? []) as Usage[])
    setLoading(false)
  }

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function viewOwn(b: OwnBudget, pro: Professional) {
    const issuer = { name: pro.company_name || pro.name, phone: pro.phone, email: pro.email, address: pro.address, logoUrl: pro.logo_url }
    const like = { id: b.id, client_name: b.client_name, client_phone: null, client_address: null, concept: b.concept, lines: b.lines, subtotal: b.subtotal, vat_percent: b.vat_percent, vat_amount: Math.round(b.subtotal * (b.vat_percent || 0)) / 100, total: b.total, notes: b.notes, created_at: b.created_at, validity_days: 30 }
    viewBudgetPdf(like as unknown as Budget, issuer)
  }

  // Totales globales (base para un futuro cobro)
  const ownMonth = own.filter(b => isThisMonth(b.created_at)).length
  const leadMonth = leadB.filter(b => isThisMonth(b.created_at)).length
  const genMonth = ownMonth + leadMonth
  const genTotal = own.length + leadB.length
  const costMonth = usage.filter(u => isThisMonth(u.created_at)).reduce((s, u) => s + Number(u.cost_eur || 0), 0)
  const costTotal = usage.reduce((s, u) => s + Number(u.cost_eur || 0), 0)

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><TrendingUp className="h-6 w-6 text-primary-600" />Actividad de profesionales</h1>
        <p className="text-gray-500 text-sm mt-1">Presupuestos que generan tus profesionales con el motor de IA (lo pagáis vosotros). Base para controlar el uso y justificar un futuro cobro por el servicio.</p>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-gray-400 uppercase tracking-wide">Generados este mes</p><p className="text-2xl font-bold text-gray-900 mt-1">{genMonth}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-gray-400 uppercase tracking-wide">Coste IA (mes)</p><p className="text-2xl font-bold text-emerald-600 mt-1">{fmtCost(costMonth)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-gray-400 uppercase tracking-wide">Generados total</p><p className="text-2xl font-bold text-gray-900 mt-1">{genTotal}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-gray-400 uppercase tracking-wide">Coste IA (total)</p><p className="text-2xl font-bold text-emerald-600 mt-1">{fmtCost(costTotal)}</p></CardContent></Card>
      </div>
      <p className="text-[11px] text-gray-400 -mt-2">El coste de IA es una estimación (tokens × precio del modelo). Sirve para controlar el gasto y justificar el cobro del servicio.</p>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : pros.length === 0 ? (
        <div className="text-center py-16"><HardHat className="h-12 w-12 mx-auto text-gray-300 mb-3" /><p className="text-gray-500 text-sm">No hay profesionales todavía.</p></div>
      ) : (
        <div className="space-y-3">
          {pros.map(pro => {
            const ownList = own.filter(b => b.professional_id === pro.id)
            const leadList = leadB.filter(b => b.professional_id === pro.id)
            const ownTotal = ownList.reduce((s, b) => s + (b.total || 0), 0)
            const proCost = usage.filter(u => u.professional_id === pro.id).reduce((s, u) => s + Number(u.cost_eur || 0), 0)
            const lastDates = [...ownList, ...leadList].map(b => b.created_at).sort().reverse()
            const isOpen = expanded.has(pro.id)
            const hasActivity = ownList.length + leadList.length > 0
            return (
              <Card key={pro.id}>
                <CardContent className="p-4">
                  <button onClick={() => toggle(pro.id)} className="w-full flex items-center gap-3 text-left">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shrink-0">{pro.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 truncate">{pro.name}{pro.specialty ? ` · ${pro.specialty}` : ''}</p>
                      <p className="text-xs text-gray-400">
                        <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3 text-primary-500" />{ownList.length} propio{ownList.length !== 1 ? 's' : ''}</span>
                        {' · '}
                        <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3 text-blue-500" />{leadList.length} de leads</span>
                        {proCost > 0 && <> · <span className="text-emerald-600 font-medium">{fmtCost(proCost)} IA</span></>}
                        {lastDates[0] && <> · última: {formatDate(lastDates[0])}</>}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(ownTotal)}</span>
                    <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isOpen && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                      {!hasActivity && <p className="text-xs text-gray-400">Sin presupuestos generados todavía.</p>}
                      {ownList.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Presupuestos propios ({ownList.length})</p>
                          <div className="space-y-1.5">
                            {ownList.map(b => (
                              <div key={b.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-800 truncate">{b.client_name || 'Cliente'}</p>
                                  <p className="text-xs text-gray-400 truncate">{b.concept || ''} · {formatDate(b.created_at)}</p>
                                </div>
                                <span className="text-sm font-semibold text-gray-900 shrink-0">{formatCurrency(b.total)}</span>
                                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs shrink-0" onClick={() => viewOwn(b, pro)}><Eye className="h-3.5 w-3.5" />PDF</Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {leadList.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 mt-2">Presupuestos de leads asignados ({leadList.length})</p>
                          <div className="space-y-1.5">
                            {leadList.map(b => (
                              <div key={b.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-800 truncate">{b.client_name || 'Cliente'}</p>
                                  <p className="text-xs text-gray-400 truncate">{b.concept || ''} · {formatDate(b.created_at)}</p>
                                </div>
                                <span className="text-sm font-semibold text-gray-900 shrink-0">{formatCurrency(b.total)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
