import { useEffect, useState } from 'react'
import { Building2, UserCog, Users, Database, CalendarPlus, AlertCircle, DollarSign } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { subWeeks } from 'date-fns'

interface ErrorLog {
  id: string
  message: string | null
  url: string | null
  created_at: string
  user_email?: string | null
}

export function SADashboard() {
  const [stats, setStats] = useState({
    totalOrgs: 0, owners: 0, collaborators: 0, totalLeads: 0, orgsThisWeek: 0, mrr: 0,
  })
  const [logs, setLogs] = useState<ErrorLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    setLoading(true)
    const weekAgo = subWeeks(new Date(), 1).toISOString()

    const [
      { count: orgs },
      { count: owners },
      { count: collaborators },
      { count: leads },
      { count: orgsWeek },
      { data: logData },
      { data: ownerMembers },
      { data: planCfg },
    ] = await Promise.all([
      supabase.from('organizations').select('*', { count: 'exact', head: true }),
      supabase.from('org_members').select('*', { count: 'exact', head: true }).eq('role', 'owner'),
      supabase.from('org_members').select('*', { count: 'exact', head: true }).neq('role', 'owner'),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('organizations').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
      supabase.from('error_logs').select('id, message, url, created_at, user_id').order('created_at', { ascending: false }).limit(20),
      supabase.from('org_members').select('user_id').eq('role', 'owner'),
      supabase.from('plan_config').select('plan, price_monthly'),
    ])

    // MRR: sumar el plan de cada usuario owner (distinto), no de orgs
    const priceMap: Record<string, number> = {}
    for (const p of planCfg ?? []) priceMap[p.plan] = p.price_monthly ?? 0
    const ownerUserIds = [...new Set((ownerMembers ?? []).map(m => m.user_id))]
    let mrr = 0
    if (ownerUserIds.length) {
      const { data: ownerProfs } = await supabase
        .from('profiles')
        .select('plan, plan_status')
        .in('id', ownerUserIds)
      mrr = (ownerProfs ?? [])
        .filter(p => (p.plan_status ?? 'active') === 'active' || p.plan_status === 'trial')
        .reduce((s, p) => s + (priceMap[p.plan ?? 'free'] ?? 0), 0)
    }

    setStats({
      totalOrgs: orgs ?? 0,
      owners: owners ?? 0,
      collaborators: collaborators ?? 0,
      totalLeads: leads ?? 0,
      orgsThisWeek: orgsWeek ?? 0,
      mrr,
    })

    // Resolver emails de los usuarios de los logs
    const rows = logData ?? []
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))] as string[]
    const emailMap: Record<string, string> = {}
    if (userIds.length) {
      const { data: profs } = await supabase.from('profiles').select('id, email').in('id', userIds)
      for (const p of profs ?? []) emailMap[p.id] = p.email
    }
    setLogs(rows.map(r => ({
      id: r.id, message: r.message, url: r.url, created_at: r.created_at,
      user_email: r.user_id ? emailMap[r.user_id] ?? null : null,
    })))

    setLoading(false)
  }

  const STATS = [
    { label: 'Organizaciones',          value: stats.totalOrgs,      icon: Building2,    color: 'bg-blue-500' },
    { label: 'Usuarios padre (owners)', value: stats.owners,         icon: UserCog,      color: 'bg-indigo-500' },
    { label: 'Colaboradores (hijos)',   value: stats.collaborators,  icon: Users,        color: 'bg-teal-500' },
    { label: 'Leads en la plataforma',  value: stats.totalLeads,     icon: Database,     color: 'bg-purple-500' },
    { label: 'Orgs creadas esta semana',value: stats.orgsThisWeek,   icon: CalendarPlus, color: 'bg-amber-500' },
    { label: 'MRR estimado',            value: formatCurrency(stats.mrr), icon: DollarSign, color: 'bg-green-500' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard Global</h1>
        <p className="text-gray-400 text-sm">Métricas de toda la plataforma TrackALead</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {STATS.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-400 leading-tight">{s.label}</p>
                  <p className="font-bold mt-0.5 text-xl text-gray-900">
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

      {/* Logs de errores */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            Últimos errores capturados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-24 flex items-center justify-center">
              <div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Sin errores registrados 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                    <th className="text-left py-2 pr-3 font-medium">Fecha</th>
                    <th className="text-left py-2 pr-3 font-medium">Mensaje</th>
                    <th className="text-left py-2 pr-3 font-medium">URL</th>
                    <th className="text-left py-2 font-medium">Usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map(l => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="py-2 pr-3 text-xs text-gray-400 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                      <td className="py-2 pr-3 text-xs text-red-600 max-w-[360px] truncate" title={l.message ?? ''}>{l.message ?? '—'}</td>
                      <td className="py-2 pr-3 text-xs text-gray-500 max-w-[200px] truncate" title={l.url ?? ''}>{l.url ?? '—'}</td>
                      <td className="py-2 text-xs text-gray-500 truncate max-w-[160px]">{l.user_email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
