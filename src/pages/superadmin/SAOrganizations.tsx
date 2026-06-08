import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Building2, Filter, ChevronDown, Layers, Users, TrendingUp, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import type { Organization } from '@/types'

interface OrgRow extends Organization {
  owner_email?: string
  boards_count: number
  leads_count: number
  members_count: number
  plan_status: string
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
}
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  trial: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export function SAOrganizations() {
  const [orgs, setOrgs]           = useState<OrgRow[]>([])
  const [filtered, setFiltered]   = useState<OrgRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterPlan, setFilterPlan] = useState('all')
  const [detailOrg, setDetailOrg] = useState<OrgRow | null>(null)
  const { enterGhostMode } = useAuth()
  const navigate = useNavigate()

  useEffect(() => { loadOrgs() }, [])

  useEffect(() => {
    let list = orgs
    if (search)            list = list.filter(o => o.name.toLowerCase().includes(search.toLowerCase()) || o.owner_email?.toLowerCase().includes(search.toLowerCase()))
    if (filterPlan !== 'all') list = list.filter(o => o.plan === filterPlan)
    setFiltered(list)
  }, [orgs, search, filterPlan])

  async function loadOrgs() {
    setLoading(true)
    const { data: orgsData } = await supabase.from('organizations').select('*').order('created_at', { ascending: false })
    if (!orgsData) { setLoading(false); return }

    const enriched: OrgRow[] = []
    for (const org of orgsData) {
      const [
        { count: boards }, { count: leads }, { count: members }, { data: ownerP },
      ] = await Promise.all([
        supabase.from('boards').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', org.id).eq('is_archived', false),
        supabase.from('org_members').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
        org.owner_id ? supabase.from('profiles').select('email').eq('id', org.owner_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      enriched.push({
        ...org,
        owner_email: (ownerP as { email?: string } | null)?.email,
        boards_count: boards ?? 0,
        leads_count: leads ?? 0,
        members_count: members ?? 0,
        plan_status: org.plan_status ?? 'active',
      })
    }
    setOrgs(enriched)
    setLoading(false)
  }

  async function changePlan(orgId: string, plan: string) {
    await supabase.from('organizations').update({ plan }).eq('id', orgId)
    toast.success(`Plan cambiado a ${plan.toUpperCase()}`)
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, plan } : o))
  }

  async function toggleSuspend(org: OrgRow) {
    const newStatus = org.plan_status === 'suspended' ? 'active' : 'suspended'
    const suspended_at = newStatus === 'suspended' ? new Date().toISOString() : null
    await supabase.from('organizations').update({ plan_status: newStatus, suspended_at }).eq('id', org.id)
    toast.success(newStatus === 'suspended' ? 'Organización suspendida' : 'Organización reactivada')
    setOrgs(prev => prev.map(o => o.id === org.id ? { ...o, plan_status: newStatus } : o))
  }

  function handleGhostMode(org: OrgRow) {
    enterGhostMode({ id: org.id, name: org.name, owner_id: org.owner_id, plan: org.plan, created_at: org.created_at })
    navigate('/dashboard')
    toast.success(`👁️ Modo fantasma: entrando en ${org.name}`)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Organizaciones</h1>
        <p className="text-gray-400 text-sm">{orgs.length} organizaciones registradas</p>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Buscar por nombre o email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 w-60 text-sm"
        />
        <Filter className="h-4 w-4 text-gray-400" />
        <Select value={filterPlan} onValueChange={setFilterPlan}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los planes</SelectItem>
            <SelectItem value="free">FREE</SelectItem>
            <SelectItem value="pro">PRO</SelectItem>
            <SelectItem value="enterprise">ENTERPRISE</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-gray-400">{filtered.length} resultados</span>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-3">Organización</th>
                  <th className="text-left px-4 py-3">Owner</th>
                  <th className="text-center px-3 py-3">Tableros</th>
                  <th className="text-center px-3 py-3">Leads</th>
                  <th className="text-center px-3 py-3">Miembros</th>
                  <th className="text-left px-3 py-3">Registro</th>
                  <th className="text-left px-3 py-3">Plan</th>
                  <th className="text-left px-3 py-3">Estado</th>
                  <th className="text-center px-3 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(org => (
                  <tr key={org.id} className={`hover:bg-gray-50 transition-colors ${org.plan_status === 'suspended' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {org.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 truncate max-w-[160px]">{org.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px] truncate">{org.owner_email ?? '—'}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="flex items-center justify-center gap-1 text-xs text-gray-600">
                        <Layers className="h-3 w-3" />{org.boards_count}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-primary-600 text-xs">{org.leads_count}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="flex items-center justify-center gap-1 text-xs text-gray-600">
                        <Users className="h-3 w-3" />{org.members_count}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400">{formatDate(org.created_at)}</td>
                    <td className="px-3 py-3">
                      <Select value={org.plan ?? 'free'} onValueChange={v => changePlan(org.id, v)}>
                        <SelectTrigger className="h-6 w-24 text-[11px] px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="free">FREE</SelectItem>
                          <SelectItem value="pro">PRO</SelectItem>
                          <SelectItem value="enterprise">ENTERPRISE</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[org.plan_status] ?? STATUS_COLOR.active}`}>
                        {org.plan_status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 justify-center">
                        {/* Modo fantasma */}
                        <button
                          onClick={() => handleGhostMode(org)}
                          className="p-1.5 rounded hover:bg-amber-100 text-amber-500 hover:text-amber-700 transition-colors"
                          title="Modo fantasma"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {/* Suspender/Reactivar */}
                        <button
                          onClick={() => toggleSuspend(org)}
                          className={`p-1.5 rounded transition-colors ${org.plan_status === 'suspended' ? 'hover:bg-green-100 text-green-500' : 'hover:bg-red-100 text-red-400'}`}
                          title={org.plan_status === 'suspended' ? 'Reactivar' : 'Suspender'}
                        >
                          {org.plan_status === 'suspended' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                        </button>
                        {/* Ver detalle */}
                        <button
                          onClick={() => setDetailOrg(org)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                          title="Ver detalle"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Panel lateral detalle */}
      {detailOrg && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => setDetailOrg(null)}>
          <div className="bg-white w-80 h-full shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900">{detailOrg.name}</h3>
                <button onClick={() => setDetailOrg(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="space-y-2 text-sm">
                {[
                  ['ID', detailOrg.id],
                  ['Owner', detailOrg.owner_email ?? '—'],
                  ['Plan', detailOrg.plan],
                  ['Estado', detailOrg.plan_status],
                  ['Tableros', String(detailOrg.boards_count)],
                  ['Leads', String(detailOrg.leads_count)],
                  ['Miembros', String(detailOrg.members_count)],
                  ['Registro', formatDate(detailOrg.created_at)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-gray-400 shrink-0">{k}</span>
                    <span className="text-gray-800 font-medium text-right truncate">{v}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => { handleGhostMode(detailOrg); setDetailOrg(null) }}>
                <Eye className="h-4 w-4" />Entrar en modo fantasma
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
