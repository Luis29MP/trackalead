import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, CheckCircle, Clock, TrendingUp, Filter, ExternalLink, Check, X, Pencil, Trash2, AlertTriangle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useBoards } from '@/hooks/useBoards'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatCurrency, formatDate } from '@/lib/utils'

const COMM_RATE = 0.15
const r2 = (n: number) => Math.round(n * 100) / 100

// Detección flexible de columnas destino según el tablero
const isAcceptedCol = (name: string) => /^acept/i.test(name.trim())
const isRejectedCol = (name: string) => /rechazad|no cerrad|no acept/i.test(name)

type BudgetStatus = 'draft' | 'sent' | 'accepted' | 'rejected'

interface FinBudget {
  id: string
  lead_id: string | null
  client_name: string | null
  concept: string | null
  subtotal: number
  total: number
  status: BudgetStatus
  commission_amount: number | null
  commission_paid: boolean
  accepted_at: string | null
  rejected_at: string | null
  created_at: string
  lead?: { name: string | null; phone: string | null; board_id: string | null } | null
}

interface LegacyLead {
  id: string
  name: string
  phone: string | null
  budget_amount: number
  commission_amount: number | null
  commission_paid: boolean
  board_id: string | null
  created_at: string
  board?: { name: string } | null
}

// Días transcurridos desde una fecha ISO
function daysSince(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export function Finances() {
  const [budgets, setBudgets] = useState<FinBudget[]>([])
  const [legacy, setLegacy] = useState<LegacyLead[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBoard, setFilterBoard] = useState('all')
  const [filterState, setFilterState] = useState<'all' | 'prevision' | 'confirmado' | 'cobrado' | 'rechazado'>('all')
  const [editId, setEditId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const { organization } = useAuth()
  const { boards } = useBoards()
  const navigate = useNavigate()

  useEffect(() => { if (organization) loadData() /* eslint-disable-next-line */ }, [organization?.id])

  async function loadData() {
    setLoading(true)
    const [{ data: bdata }, { data: ldata }] = await Promise.all([
      supabase.from('budgets')
        .select('id, lead_id, client_name, concept, subtotal, total, status, commission_amount, commission_paid, accepted_at, rejected_at, created_at, lead:leads(name, phone, board_id)')
        .eq('org_id', organization!.id).order('created_at', { ascending: false }),
      supabase.from('leads')
        .select('id, name, phone, budget_amount, commission_amount, commission_paid, board_id, created_at, board:boards(name)')
        .eq('org_id', organization!.id).eq('is_archived', false).not('budget_amount', 'is', null).order('created_at', { ascending: false }),
    ])
    const b = ((bdata ?? []) as unknown as FinBudget[]).map(x => ({ ...x, lead: Array.isArray(x.lead) ? x.lead[0] : x.lead }))
    setBudgets(b)
    // Leads manuales que NO tienen ya un presupuesto (para no duplicar)
    const withBudget = new Set(b.map(x => x.lead_id).filter(Boolean))
    const leg = ((ldata ?? []) as unknown as LegacyLead[])
      .map(x => ({ ...x, board: Array.isArray(x.board) ? x.board[0] : x.board }))
      .filter(l => !withBudget.has(l.id))
    setLegacy(leg)
    setLoading(false)
  }

  const commissionOf = (b: FinBudget) => b.commission_amount ?? r2((b.subtotal || 0) * COMM_RATE)

  // Mueve el lead a la columna que cumpla el matcher (Aceptados / Rechazados)
  async function moveLead(leadId: string, match: (n: string) => boolean) {
    const { data: lead } = await supabase.from('leads').select('board_id').eq('id', leadId).maybeSingle()
    if (!lead?.board_id) return
    const { data: cols } = await supabase.from('board_columns').select('id, name').eq('board_id', lead.board_id)
    const col = (cols ?? []).find(c => match(c.name))
    if (col) await supabase.from('leads').update({ column_id: col.id, updated_at: new Date().toISOString() }).eq('id', leadId)
  }

  async function accept(b: FinBudget) {
    await supabase.from('budgets').update({ status: 'accepted', accepted_at: new Date().toISOString(), rejected_at: null, updated_at: new Date().toISOString() }).eq('id', b.id)
    if (b.lead_id) await moveLead(b.lead_id, isAcceptedCol)
    toast.success('Presupuesto aceptado · el lead pasa a Aceptados')
    loadData()
  }

  async function reject(b: FinBudget) {
    await supabase.from('budgets').update({ status: 'rejected', rejected_at: new Date().toISOString(), accepted_at: null, updated_at: new Date().toISOString() }).eq('id', b.id)
    if (b.lead_id) await moveLead(b.lead_id, isRejectedCol)
    toast.success('Presupuesto rechazado · el lead pasa a Rechazados')
    loadData()
  }

  async function reopen(b: FinBudget) {
    await supabase.from('budgets').update({ status: 'draft', accepted_at: null, rejected_at: null, updated_at: new Date().toISOString() }).eq('id', b.id)
    toast.success('Presupuesto reactivado (previsión)')
    loadData()
  }

  async function toggleCobrada(b: FinBudget, paid: boolean) {
    await supabase.from('budgets').update({ commission_paid: paid }).eq('id', b.id)
    setBudgets(prev => prev.map(x => x.id === b.id ? { ...x, commission_paid: paid } : x))
    toast.success(paid ? 'Comisión cobrada' : 'Comisión pendiente')
  }

  async function saveCommission(b: FinBudget) {
    const val = r2(parseFloat(editVal.replace(',', '.')) || 0)
    await supabase.from('budgets').update({ commission_amount: val }).eq('id', b.id)
    setBudgets(prev => prev.map(x => x.id === b.id ? { ...x, commission_amount: val } : x))
    setEditId(null); setEditVal('')
    toast.success('Comisión actualizada')
  }

  async function deleteBudget(b: FinBudget) {
    if (!confirm('¿Borrar definitivamente este presupuesto rechazado?')) return
    await supabase.from('budgets').delete().eq('id', b.id)
    setBudgets(prev => prev.filter(x => x.id !== b.id))
    toast.success('Presupuesto borrado')
  }

  async function toggleLegacyPaid(leadId: string, paid: boolean) {
    await supabase.from('leads').update({ commission_paid: paid }).eq('id', leadId)
    setLegacy(prev => prev.map(l => l.id === leadId ? { ...l, commission_paid: paid } : l))
    toast.success(paid ? 'Comisión cobrada' : 'Comisión pendiente')
  }

  // ── Filtros ────────────────────────────────────────────────────────────────
  const bucketOf = (b: FinBudget): 'prevision' | 'confirmado' | 'cobrado' | 'rechazado' => {
    if (b.status === 'rejected') return 'rechazado'
    if (b.status === 'accepted') return b.commission_paid ? 'cobrado' : 'confirmado'
    return 'prevision'
  }
  const fBudgets = budgets.filter(b => {
    if (filterBoard !== 'all' && b.lead?.board_id !== filterBoard) return false
    if (filterState !== 'all' && bucketOf(b) !== filterState) return false
    return true
  })
  const fLegacy = legacy.filter(l => {
    if (filterBoard !== 'all' && l.board_id !== filterBoard) return false
    if (filterState === 'rechazado' || filterState === 'prevision') return false
    const bucket = l.commission_paid ? 'cobrado' : 'confirmado'
    if (filterState !== 'all' && bucket !== filterState) return false
    return true
  })

  // ── Totales (presupuestos + leads manuales) ──────────────────────────────────
  const prevision = budgets.filter(b => bucketOf(b) === 'prevision').reduce((s, b) => s + commissionOf(b), 0)
  const pendiente = budgets.filter(b => bucketOf(b) === 'confirmado').reduce((s, b) => s + commissionOf(b), 0)
    + legacy.filter(l => !l.commission_paid).reduce((s, l) => s + (l.commission_amount ?? 0), 0)
  const cobrado = budgets.filter(b => bucketOf(b) === 'cobrado').reduce((s, b) => s + commissionOf(b), 0)
    + legacy.filter(l => l.commission_paid).reduce((s, l) => s + (l.commission_amount ?? 0), 0)
  const firme = pendiente + cobrado

  const cards = [
    { label: 'Previsión', hint: 'Sin aceptar', value: prevision, icon: TrendingUp, color: 'bg-amber-500' },
    { label: 'Pendiente de cobro', hint: 'Aceptado, sin cobrar', value: pendiente, icon: Clock, color: 'bg-blue-500' },
    { label: 'Cobrado', hint: 'Comisión ingresada', value: cobrado, icon: CheckCircle, color: 'bg-green-500' },
    { label: 'Total firme', hint: 'Pendiente + cobrado', value: firme, icon: DollarSign, color: 'bg-slate-700' },
  ]

  // Aviso de caducados a borrar (>15 días rechazados)
  const caducados = budgets.filter(b => b.status === 'rejected' && daysSince(b.rejected_at) >= 15)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Finanzas</h1>
        <p className="text-gray-500 text-sm mt-1">Comisiones por presupuesto: previsión, confirmadas y cobradas</p>
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 truncate">{s.label}</p>
                  <p className="text-lg sm:text-xl font-bold text-gray-900 mt-1">{formatCurrency(s.value)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{s.hint}</p>
                </div>
                <div className={`p-2 rounded-lg ${s.color} shrink-0`}><s.icon className="h-4 w-4 text-white" /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {caducados.length > 0 && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Tienes <strong>{caducados.length}</strong> presupuesto(s) rechazado(s) hace más de 15 días. Puedes borrarlos con la papelera 🗑️ en su fila.</span>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-gray-400" />
        <Select value={filterBoard} onValueChange={setFilterBoard}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tableros</SelectItem>
            {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterState} onValueChange={(v) => setFilterState(v as typeof filterState)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="prevision">Previsión</SelectItem>
            <SelectItem value="confirmado">Pendiente de cobro</SelectItem>
            <SelectItem value="cobrado">Cobrado</SelectItem>
            <SelectItem value="rechazado">Rechazado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla de presupuestos */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Cliente / Lead</th>
                <th className="text-left px-3 py-3">Concepto</th>
                <th className="text-right px-3 py-3">Total cliente</th>
                <th className="text-right px-3 py-3">Tu comisión</th>
                <th className="text-left px-3 py-3">Estado</th>
                <th className="text-center px-3 py-3">Cobrada</th>
                <th className="text-center px-3 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Cargando…</td></tr>
              ) : (fBudgets.length === 0 && fLegacy.length === 0) ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Sin presupuestos. Genera o importa uno desde <strong>Presupuestos</strong>.</td></tr>
              ) : (
                <>
                  {fBudgets.map((b) => {
                    const bucket = bucketOf(b)
                    const rowBg = bucket === 'rechazado' ? 'bg-gray-50/60 opacity-70'
                      : bucket === 'cobrado' ? 'bg-green-50/40'
                      : bucket === 'confirmado' ? 'bg-blue-50/30'
                      : 'bg-amber-50/20'
                    const badge = bucket === 'rechazado' ? { t: 'Rechazado', c: 'bg-gray-100 text-gray-500' }
                      : bucket === 'cobrado' ? { t: 'Cobrada', c: 'bg-green-100 text-green-700' }
                      : bucket === 'confirmado' ? { t: 'Confirmado', c: 'bg-blue-100 text-blue-700' }
                      : { t: 'Previsión', c: 'bg-amber-100 text-amber-700' }
                    const caducado = b.status === 'rejected' && daysSince(b.rejected_at) >= 15
                    return (
                      <tr key={b.id} className={`${rowBg} border-l-4 ${bucket === 'cobrado' ? 'border-green-400' : bucket === 'confirmado' ? 'border-blue-400' : bucket === 'rechazado' ? 'border-gray-300' : 'border-amber-300 border-dashed'}`}>
                        <td className="px-4 py-3">
                          {b.lead_id ? (
                            <button onClick={() => navigate(`/leads/${b.lead_id}`)} className="text-left group">
                              <p className={`font-medium text-primary-600 group-hover:underline flex items-center gap-1 ${bucket === 'rechazado' ? 'line-through' : ''}`}>{b.client_name || b.lead?.name || '—'}<ExternalLink className="h-3 w-3 opacity-50" /></p>
                              {b.lead?.phone && <p className="text-xs text-gray-400">{b.lead.phone}</p>}
                            </button>
                          ) : (
                            <span className={`font-medium text-gray-900 ${bucket === 'rechazado' ? 'line-through' : ''}`}>{b.client_name || '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-gray-500 max-w-[200px] truncate">{b.concept || '—'}</td>
                        <td className="px-3 py-3 text-right text-gray-700">{formatCurrency(b.total)}</td>
                        <td className="px-3 py-3 text-right">
                          {editId === b.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus className="h-8 w-24 text-right text-xs" onKeyDown={e => { if (e.key === 'Enter') saveCommission(b); if (e.key === 'Escape') setEditId(null) }} />
                              <button onClick={() => saveCommission(b)} className="text-green-600 p-1"><Check className="h-4 w-4" /></button>
                              <button onClick={() => setEditId(null)} className="text-gray-400 p-1"><X className="h-4 w-4" /></button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditId(b.id); setEditVal(String(commissionOf(b))) }} className="inline-flex items-center gap-1 font-semibold text-amber-600 hover:underline" title="Editar comisión">
                              {formatCurrency(commissionOf(b))}<Pencil className="h-3 w-3 opacity-50" />
                              {b.commission_amount == null && <span className="text-[9px] text-gray-400">(est.)</span>}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.c}`}>{badge.t}</span>
                          {caducado && <p className="text-[10px] text-red-500 mt-0.5">Caducado hace {daysSince(b.rejected_at)} d</p>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {bucket === 'confirmado' || bucket === 'cobrado'
                            ? <Switch checked={b.commission_paid} onCheckedChange={(v) => toggleCobrada(b, v)} />
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {(b.status === 'draft' || b.status === 'sent') && (
                              <>
                                <Button size="sm" className="h-7 gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => accept(b)} title="Cliente lo acepta"><Check className="h-3.5 w-3.5" />Aceptar</Button>
                                <button onClick={() => reject(b)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Rechazar / caducar"><X className="h-4 w-4" /></button>
                              </>
                            )}
                            {b.status === 'accepted' && (
                              <button onClick={() => reject(b)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Marcar como rechazado"><X className="h-4 w-4" /></button>
                            )}
                            {b.status === 'rejected' && (
                              <>
                                <button onClick={() => reopen(b)} className="p-1.5 rounded hover:bg-amber-50 text-amber-500" title="Reactivar (previsión)"><RotateCcw className="h-4 w-4" /></button>
                                <button onClick={() => deleteBudget(b)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Borrar definitivamente"><Trash2 className="h-4 w-4" /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Leads con importe manual (sin presupuesto) */}
                  {fLegacy.map((l) => (
                    <tr key={`leg-${l.id}`} className="bg-slate-50/40 border-l-4 border-slate-200">
                      <td className="px-4 py-3">
                        <button onClick={() => navigate(`/leads/${l.id}`)} className="text-left group">
                          <p className="font-medium text-primary-600 group-hover:underline flex items-center gap-1">{l.name}<ExternalLink className="h-3 w-3 opacity-50" /></p>
                          {l.phone && <p className="text-xs text-gray-400">{l.phone}</p>}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-gray-400 italic">Importe manual{l.board?.name ? ` · ${l.board.name}` : ''}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{formatCurrency(l.budget_amount)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-amber-600">{l.commission_amount ? formatCurrency(l.commission_amount) : '—'}</td>
                      <td className="px-3 py-3"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Manual</span></td>
                      <td className="px-3 py-3 text-center"><Switch checked={l.commission_paid} onCheckedChange={(v) => toggleLegacyPaid(l.id, v)} /></td>
                      <td className="px-3 py-3 text-center text-gray-300 text-xs">—</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">La comisión de los presupuestos importados es exacta (precio final − precio del profesional). En los generados con IA se estima al 15% del subtotal y puedes editarla pulsando sobre la cifra.</p>
    </div>
  )
}
