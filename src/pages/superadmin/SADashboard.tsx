import { useEffect, useState } from 'react'
import { Building2, Users, TrendingUp, DollarSign, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { subWeeks, startOfWeek, endOfWeek, format } from 'date-fns'
import { es } from 'date-fns/locale'

interface WeekBar { label: string; count: number }

function BarChart({ data }: { data: WeekBar[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-2 h-32 pt-4">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold text-gray-500">{d.count || ''}</span>
          <div
            className="w-full rounded-t-sm bg-primary-500 transition-all"
            style={{ height: d.count ? `${Math.max(8, (d.count / max) * 88)}px` : '4px', opacity: d.count ? 1 : 0.2 }}
          />
          <span className="text-[9px] text-gray-400 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

export function SADashboard() {
  const [stats, setStats] = useState({
    totalOrgs: 0, totalUsers: 0, newThisWeek: 0,
    totalLeads: 0, mrr: 0, proOrgs: 0, suspended: 0,
  })
  const [weekBars, setWeekBars] = useState<WeekBar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    setLoading(true)
    const weekAgo = subWeeks(new Date(), 1).toISOString()

    const [
      { count: orgs },
      { count: users },
      { count: newUsers },
      { count: leads },
      { data: planData },
      { data: planCfg },
    ] = await Promise.all([
      supabase.from('organizations').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('organizations').select('plan, plan_status').neq('plan', 'free'),
      supabase.from('plan_config').select('plan, price_monthly'),
    ])

    const priceMap: Record<string, number> = {}
    for (const p of planCfg ?? []) priceMap[p.plan] = p.price_monthly ?? 0
    const mrr = (planData ?? []).reduce((s, o) => s + (priceMap[o.plan] ?? 0), 0)
    const suspended = (planData ?? []).filter(o => o.plan_status === 'suspended').length

    setStats({
      totalOrgs: orgs ?? 0,
      totalUsers: users ?? 0,
      newThisWeek: newUsers ?? 0,
      totalLeads: leads ?? 0,
      mrr,
      proOrgs: (planData ?? []).length,
      suspended,
    })

    // Barras de las últimas 8 semanas
    const bars: WeekBar[] = []
    for (let i = 7; i >= 0; i--) {
      const weekStart = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      const weekEnd   = endOfWeek(weekStart, { weekStartsOn: 1 })
      const { count } = await supabase.from('profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString())
        .lte('created_at', weekEnd.toISOString())
      bars.push({ label: format(weekStart, 'd MMM', { locale: es }), count: count ?? 0 })
    }
    setWeekBars(bars)
    setLoading(false)
  }

  const STATS = [
    { label: 'Organizaciones', value: stats.totalOrgs, icon: Building2, color: 'bg-blue-500' },
    { label: 'Usuarios totales', value: stats.totalUsers, icon: Users, color: 'bg-green-500' },
    { label: 'MRR estimado', value: formatCurrency(stats.mrr), icon: DollarSign, color: 'bg-amber-500', isCurrency: true },
    { label: 'Total leads', value: stats.totalLeads, icon: TrendingUp, color: 'bg-indigo-500' },
    { label: 'Nuevos esta semana', value: stats.newThisWeek, icon: Users, color: 'bg-teal-500' },
    { label: 'Orgs de pago', value: stats.proOrgs, icon: DollarSign, color: 'bg-purple-500' },
    { label: 'Suspendidas', value: stats.suspended, icon: AlertTriangle, color: stats.suspended > 0 ? 'bg-red-500' : 'bg-gray-400' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard Global</h1>
        <p className="text-gray-400 text-sm">Métricas de toda la plataforma TrackALead</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        {STATS.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-400 leading-tight">{s.label}</p>
                  <p className={`font-bold mt-0.5 ${s.isCurrency ? 'text-base' : 'text-xl'} text-gray-900`}>
                    {loading ? '…' : s.value}
                  </p>
                </div>
                <div className={`p-1.5 rounded-lg shrink-0 ${s.color}`}>
                  <s.icon className="h-3.5 w-3.5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gráfico registros por semana */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Nuevos usuarios — últimas 8 semanas</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 flex items-center justify-center">
              <div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <BarChart data={weekBars} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
