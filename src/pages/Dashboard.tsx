import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Layers, TrendingUp, DollarSign, CheckCircle, Clock, LayoutGrid, Home, PhoneCall, RefreshCw, ClipboardList } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatCurrency, formatRelativeTime, sourceLabel } from '@/lib/utils'
import { isToday, isTomorrow, addDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Lead, CalendarEvent } from '@/types'

interface Metrics {
  totalBoards: number
  totalLeads: number
  leadsThisWeek: number
  totalBudget: number
  totalCommissions: number
  paidCommissions: number
}

const ZERO: Metrics = {
  totalBoards: 0, totalLeads: 0, leadsThisWeek: 0,
  totalBudget: 0, totalCommissions: 0, paidCommissions: 0,
}

function StatCard({
  label, value, icon: Icon, color, sub,
}: { label: string; value: string; icon: React.ElementType; color: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500 truncate">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5 leading-tight">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg shrink-0 ${color}`}>
            <Icon className="h-4 w-4 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>(ZERO)
  const [recent, setRecent] = useState<Lead[]>([])
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const { organization } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!organization?.id) return
    load()
  }, [organization?.id])

  async function load() {
    setLoading(true)
    const orgId = organization!.id
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()

    try {
      const [
        { count: boards },
        { count: leads },
        { count: leadsWeek },
        { data: fin },
        { data: recentLeads },
        { data: upcomingEvs },
      ] = await Promise.all([
        supabase.from('boards').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_archived', false),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', weekAgo),
        supabase.from('leads').select('budget_amount,commission_amount,commission_paid').eq('org_id', orgId).eq('is_archived', false),
        supabase.from('leads').select('*').eq('org_id', orgId).eq('is_archived', false).order('created_at', { ascending: false }).limit(6),
        supabase.from('calendar_events')
          .select('*, lead:leads(id,name,concept,zone)')
          .eq('org_id', orgId)
          .gte('start_at', new Date().toISOString())
          .lte('start_at', addDays(new Date(), 7).toISOString())
          .order('start_at')
          .limit(8),
      ])

      const finData = fin ?? []
      setMetrics({
        totalBoards: boards ?? 0,
        totalLeads: leads ?? 0,
        leadsThisWeek: leadsWeek ?? 0,
        totalBudget: finData.reduce((s, l) => s + (l.budget_amount ?? 0), 0),
        totalCommissions: finData.reduce((s, l) => s + (l.commission_amount ?? 0), 0),
        paidCommissions: finData.filter((l) => l.commission_paid).reduce((s, l) => s + (l.commission_amount ?? 0), 0),
      })
      setRecent(recentLeads ?? [])
      setUpcoming((upcomingEvs as unknown as CalendarEvent[]) ?? [])
    } catch (err) {
      console.error('Dashboard error:', err)
      // Mantiene ZERO, no rompe la UI
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Saludo */}
      <div>
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Panel de Control</h1>
        <p className="text-gray-400 text-sm mt-0.5">{organization?.name}</p>
      </div>

      {/* Stats: 2×2 en móvil, 6 columnas en xl */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Tableros"         value={String(metrics.totalBoards)}             icon={Layers}      color="bg-slate-600"  />
        <StatCard label="Leads totales"    value={String(metrics.totalLeads)}              icon={Users}       color="bg-primary-600"/>
        <StatCard label="Esta semana"      value={String(metrics.leadsThisWeek)}           icon={TrendingUp}  color="bg-indigo-500" sub="nuevos" />
        <StatCard label="Presupuestado"    value={formatCurrency(metrics.totalBudget)}     icon={DollarSign}  color="bg-amber-500"  />
        <StatCard label="Com. cobradas"    value={formatCurrency(metrics.paidCommissions)} icon={CheckCircle} color="bg-green-500"  />
        <StatCard label="Com. pendientes"  value={formatCurrency(metrics.totalCommissions - metrics.paidCommissions)} icon={Clock} color="bg-orange-500" />
      </div>

      {/* Botón ir al tablero — móvil prominente */}
      <button
        className="md:hidden w-full bg-primary-600 text-white font-semibold py-3.5 rounded-xl text-sm flex items-center justify-center gap-2 active:bg-primary-700 transition-colors"
        onClick={() => navigate('/boards')}
      >
        <LayoutGrid className="h-4 w-4" />
        IR AL TABLERO
      </button>

      {/* Próximas visitas */}
      {upcoming.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              📅 Próximas visitas
              <span className="text-xs font-normal text-gray-400">(7 días)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {upcoming.map(ev => {
                const lead = ev.lead as unknown as { id?: string; name?: string; concept?: string } | null
                const evDate = new Date(ev.start_at)
                const todayEv = isToday(evDate)
                const tomorrowEv = isTomorrow(evDate)
                const typeIcons: Record<string, React.ElementType> = {
                  visita_presencial: Home, llamada: PhoneCall,
                  seguimiento: RefreshCw, presupuesto_insitu: ClipboardList,
                }
                const Icon = typeIcons[ev.type] ?? Home
                const typeColors: Record<string, string> = {
                  visita_presencial: '#2563EB', llamada: '#10B981',
                  seguimiento: '#8B5CF6', presupuesto_insitu: '#F59E0B',
                  reunion: '#EC4899', otro: '#6B7280',
                }
                const color = typeColors[ev.type] ?? '#6B7280'
                // Título: si tiene lead → nombre del lead; si no → título del evento
                const displayTitle = lead?.name
                  ? lead.name.replace(/^nombre:\s*/i, '')
                  : ev.title
                const displaySub = lead?.name
                  ? (lead.concept ?? null)
                  : (ev.description ?? null)
                return (
                  <div
                    key={ev.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => lead?.id ? navigate(`/leads/${lead.id}`) : undefined}
                  >
                    <div className="p-1.5 rounded-lg shrink-0" style={{ backgroundColor: color + '20' }}>
                      <Icon className="h-3.5 w-3.5" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{displayTitle}</p>
                      {displaySub && <p className="text-xs text-gray-400 truncate">{displaySub}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-xs font-bold text-gray-700">
                        {format(evDate, 'HH:mm')}
                      </p>
                      {todayEv
                        ? <Badge className="bg-red-500 text-white text-[10px] py-0 px-1.5">HOY</Badge>
                        : tomorrowEv
                          ? <Badge className="bg-amber-500 text-white text-[10px] py-0 px-1.5">MAÑANA</Badge>
                          : <span className="text-[10px] text-gray-400 capitalize">
                              {format(evDate, 'EEE d MMM', { locale: es })}
                            </span>
                      }
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leads recientes */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-700">Leads recientes</CardTitle>
            <button
              className="text-xs text-primary-600 font-medium md:hidden"
              onClick={() => navigate('/boards')}
            >
              Ver todos →
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
            </div>
          ) : recent.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No hay leads todavía</p>
              <button className="mt-3 text-sm text-primary-600" onClick={() => navigate('/boards')}>
                Crear primer tablero →
              </button>
            </div>
          ) : (
            /* Móvil: cards apiladas. Desktop: filas de tabla */
            <div className="divide-y divide-gray-100">
              {recent.map((lead) => (
                <div
                  key={lead.id}
                  className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/leads/${lead.id}`)}
                >
                  {/* Móvil: layout vertical */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{lead.name}</p>
                      {(lead as unknown as { concept?: string }).concept && (
                        <p className="text-xs text-primary-600 truncate mt-0.5">
                          {(lead as unknown as { concept: string }).concept}
                        </p>
                      )}
                      {lead.phone && <p className="text-xs text-gray-400 mt-0.5">{lead.phone}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {lead.budget_amount != null && (
                        <span className="text-xs font-bold text-amber-600">
                          {formatCurrency(lead.budget_amount)}
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400">{formatRelativeTime(lead.created_at)}</span>
                    </div>
                  </div>
                  {/* Badge fuente */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <Badge variant="secondary" className="text-[10px] py-0">{sourceLabel(lead.source)}</Badge>
                    {lead.commission_paid
                      ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      : <Clock className="h-3.5 w-3.5 text-gray-300" />
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
