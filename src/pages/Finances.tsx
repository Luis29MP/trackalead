import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, CheckCircle, Clock, TrendingUp, Filter, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useBoards } from '@/hooks/useBoards'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Lead } from '@/types'

export function Finances() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBoard, setFilterBoard] = useState('all')
  const [filterPaid, setFilterPaid] = useState<'all' | 'paid' | 'pending'>('all')
  const { organization } = useAuth()
  const { boards } = useBoards()
  const navigate = useNavigate()

  useEffect(() => {
    if (!organization) return
    loadLeads()
  }, [organization])

  async function loadLeads() {
    setLoading(true)
    const { data } = await supabase
      .from('leads')
      .select('*, board:boards(name), column:board_columns(name)')
      .eq('org_id', organization!.id)
      .eq('is_archived', false)
      .not('budget_amount', 'is', null)
      .order('created_at', { ascending: false })
    setLeads(data ?? [])
    setLoading(false)
  }

  async function toggleCommissionPaid(leadId: string, paid: boolean) {
    await supabase.from('leads').update({ commission_paid: paid }).eq('id', leadId)
    toast.success(paid ? 'Comisión marcada como cobrada' : 'Comisión marcada como pendiente')
    await loadLeads()
  }

  const filtered = leads.filter((l) => {
    if (filterBoard !== 'all' && l.board_id !== filterBoard) return false
    if (filterPaid === 'paid' && !l.commission_paid) return false
    if (filterPaid === 'pending' && l.commission_paid) return false
    return true
  })

  const totalBudget = filtered.reduce((s, l) => s + (l.budget_amount ?? 0), 0)
  const totalCommissions = filtered.reduce((s, l) => s + (l.commission_amount ?? 0), 0)
  const paidCommissions = filtered.filter((l) => l.commission_paid).reduce((s, l) => s + (l.commission_amount ?? 0), 0)
  const pendingCommissions = totalCommissions - paidCommissions

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Finanzas</h1>
        <p className="text-gray-500 text-sm mt-1">Pipeline financiero y comisiones</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total presupuestado', value: formatCurrency(totalBudget), icon: DollarSign, color: 'bg-blue-500' },
          { label: 'Total comisiones', value: formatCurrency(totalCommissions), icon: TrendingUp, color: 'bg-amber-500' },
          { label: 'Cobradas', value: formatCurrency(paidCommissions), icon: CheckCircle, color: 'bg-green-500' },
          { label: 'Pendientes', value: formatCurrency(pendingCommissions), icon: Clock, color: 'bg-orange-500' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{s.value}</p>
                </div>
                <div className={`p-2 rounded-lg ${s.color}`}>
                  <s.icon className="h-4 w-4 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-gray-400" />
        <Select value={filterBoard} onValueChange={setFilterBoard}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tableros</SelectItem>
            {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPaid} onValueChange={(v) => setFilterPaid(v as 'all' | 'paid' | 'pending')}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="paid">Cobradas</SelectItem>
            <SelectItem value="pending">Pendientes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Lead</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Tablero</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Estado</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Presupuesto</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Comisión (15%)</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Cobrada</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">Cargando...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    Sin leads con presupuesto
                  </td>
                </tr>
              ) : filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      className="text-left group"
                      onClick={() => navigate(`/leads/${lead.id}`)}
                    >
                      <p className="font-medium text-primary-600 group-hover:underline flex items-center gap-1">
                        {lead.name}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </p>
                      {lead.phone && <p className="text-xs text-gray-400">{lead.phone}</p>}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-600">
                      {(lead as unknown as { board: { name: string } }).board?.name ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">
                      {(lead as unknown as { column: { name: string } }).column?.name ?? '—'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatCurrency(lead.budget_amount!)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">
                    {lead.commission_amount ? formatCurrency(lead.commission_amount) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Switch
                      checked={lead.commission_paid}
                      onCheckedChange={(v) => toggleCommissionPaid(lead.id, v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {formatDate(lead.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
