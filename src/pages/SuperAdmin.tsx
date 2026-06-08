import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Users, Building2, Layers, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

interface OrgStats {
  id: string
  name: string
  plan: string
  created_at: string
  owner_email?: string
  boards_count: number
  leads_count: number
  members_count: number
}

interface RecentUser {
  id: string
  email: string
  full_name: string | null
  created_at: string
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
}

export function SuperAdmin() {
  const { systemRole } = useAuth()
  const navigate = useNavigate()
  const [orgs, setOrgs]         = useState<OrgStats[]>([])
  const [recent, setRecent]     = useState<RecentUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [totalOrgs, setTotalOrgs] = useState(0)
  const [totalUsers, setTotalUsers] = useState(0)

  // Redirigir si no es super_admin
  useEffect(() => {
    if (systemRole !== null && systemRole !== 'super_admin') {
      navigate('/dashboard')
    }
  }, [systemRole, navigate])

  useEffect(() => {
    if (systemRole === 'super_admin') loadData()
  }, [systemRole])

  async function loadData() {
    setLoading(true)
    try {
      const [
        { count: orgCount },
        { count: userCount },
        { data: orgsData },
        { data: recentUsers },
      ] = await Promise.all([
        supabase.from('organizations').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('organizations').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('profiles').select('id,email,full_name,created_at').order('created_at', { ascending: false }).limit(20),
      ])
      setTotalOrgs(orgCount ?? 0)
      setTotalUsers(userCount ?? 0)
      setRecent(recentUsers ?? [])

      // Enriquecer orgs con estadísticas
      const enriched: OrgStats[] = []
      for (const org of (orgsData ?? [])) {
        const [
          { count: boards },
          { count: leads },
          { count: members },
          { data: ownerProfile },
        ] = await Promise.all([
          supabase.from('boards').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
          supabase.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', org.id).eq('is_archived', false),
          supabase.from('org_members').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
          org.owner_id
            ? supabase.from('profiles').select('email').eq('id', org.owner_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ])
        enriched.push({
          ...org,
          owner_email: (ownerProfile as { email?: string } | null)?.email,
          boards_count: boards ?? 0,
          leads_count: leads ?? 0,
          members_count: members ?? 0,
        })
      }
      setOrgs(enriched)
    } catch (err) {
      console.error('SuperAdmin loadData:', err)
    } finally {
      setLoading(false)
    }
  }

  async function changePlan(orgId: string, plan: string) {
    const { error } = await supabase.from('organizations').update({ plan }).eq('id', orgId)
    if (error) { toast.error('Error al cambiar plan'); return }
    toast.success(`Plan actualizado a ${plan.toUpperCase()}`)
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, plan } : o))
  }

  if (systemRole !== 'super_admin') return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 rounded-lg">
          <Shield className="h-5 w-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
          <p className="text-gray-400 text-sm">Panel de control global de TrackALead</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Organizaciones', value: totalOrgs, icon: Building2, color: 'bg-blue-500' },
          { label: 'Usuarios totales', value: totalUsers, icon: Users, color: 'bg-green-500' },
          { label: 'Orgs activas', value: orgs.filter(o => o.leads_count > 0).length, icon: TrendingUp, color: 'bg-amber-500' },
          { label: 'Plan PRO+', value: orgs.filter(o => o.plan !== 'free').length, icon: Shield, color: 'bg-purple-500' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-0.5">{loading ? '…' : s.value}</p>
                </div>
                <div className={`p-2 rounded-lg ${s.color}`}>
                  <s.icon className="h-4 w-4 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Organizaciones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />Organizaciones ({orgs.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Organización</th>
                    <th className="text-left px-4 py-3">Owner</th>
                    <th className="text-center px-4 py-3">Tableros</th>
                    <th className="text-center px-4 py-3">Leads</th>
                    <th className="text-center px-4 py-3">Miembros</th>
                    <th className="text-left px-4 py-3">Fecha</th>
                    <th className="text-left px-4 py-3">Plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {orgs.map(org => (
                    <tr key={org.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{org.owner_email ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="flex items-center justify-center gap-1">
                          <Layers className="h-3.5 w-3.5 text-gray-400" />{org.boards_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-primary-600">{org.leads_count}</td>
                      <td className="px-4 py-3 text-center">{org.members_count}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(org.created_at)}</td>
                      <td className="px-4 py-3">
                        <Select value={org.plan ?? 'free'} onValueChange={v => changePlan(org.id, v)}>
                          <SelectTrigger className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free">FREE</SelectItem>
                            <SelectItem value="pro">PRO</SelectItem>
                            <SelectItem value="enterprise">ENTERPRISE</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Últimos registros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />Últimos 20 registros
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-50">
            {recent.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.full_name ?? 'Sin nombre'}</p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0">{formatDate(u.created_at)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
