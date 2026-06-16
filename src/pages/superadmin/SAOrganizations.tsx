import { useEffect, useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Filter, Layers, Users, ChevronDown, ChevronRight, UserCog, Building2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, formatDateTime } from '@/lib/utils'

interface OrgUser {
  user_id: string
  role: string
  email: string | null
  full_name: string | null
}

interface OrgItem {
  id: string
  name: string
  created_at: string
  boards_count: number
  leads_count: number
  last_activity: string | null
  members: OrgUser[]
}

interface OwnerGroup {
  owner_id: string
  owner_email: string | null
  owner_name: string | null
  plan: string
  plan_status: string
  orgs: OrgItem[]
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
}
const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario', admin: 'Administrador', manager: 'Colaborador', installer: 'Instalador',
}

export function SAOrganizations() {
  const [groups, setGroups]     = useState<OwnerGroup[]>([])
  const [filtered, setFiltered] = useState<OwnerGroup[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [filterPlan, setFilterPlan] = useState('all')
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null)
  const { enterGhostMode, user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => { loadOrgs() }, [])

  useEffect(() => {
    let list = groups
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(g =>
        g.owner_email?.toLowerCase().includes(q) ||
        g.owner_name?.toLowerCase().includes(q) ||
        g.orgs.some(o => o.name.toLowerCase().includes(q))
      )
    }
    if (filterPlan !== 'all') list = list.filter(g => g.plan === filterPlan)
    setFiltered(list)
  }, [groups, search, filterPlan])

  async function loadOrgs() {
    setLoading(true)
    const { data: orgsData } = await supabase.from('organizations')
      .select('id, name, owner_id, created_at')
      .is('deleted_at', null)   // solo organizaciones activas (las de la papelera van en /superadmin/trash)
      .order('created_at', { ascending: false })
    if (!orgsData) { setLoading(false); return }

    // Perfiles de los owners
    const ownerIds = [...new Set(orgsData.map(o => o.owner_id).filter(Boolean))] as string[]
    const { data: profs } = ownerIds.length
      ? await supabase.from('profiles').select('id, email, full_name, plan, plan_status').in('id', ownerIds)
      : { data: [] }
    const profMap: Record<string, { email: string | null; full_name: string | null; plan: string | null; plan_status: string | null }> = {}
    for (const p of profs ?? []) profMap[p.id] = p

    // Enriquecer cada org y agrupar por owner
    const groupMap: Record<string, OwnerGroup> = {}
    for (const org of orgsData) {
      const [
        { count: boards },
        { count: leads },
        { data: membersData },
        { data: lastLead },
      ] = await Promise.all([
        supabase.from('boards').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', org.id).eq('is_archived', false),
        supabase.from('org_members').select('role, user_id, profile:profiles(email, full_name)').eq('org_id', org.id),
        supabase.from('leads').select('updated_at').eq('org_id', org.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ])

      const members: OrgUser[] = (membersData ?? []).map((m) => {
        const prof = m.profile as { email?: string; full_name?: string } | null
        return { user_id: m.user_id, role: m.role, email: prof?.email ?? null, full_name: prof?.full_name ?? null }
      })
      members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0))

      const orgItem: OrgItem = {
        id: org.id,
        name: org.name,
        created_at: org.created_at,
        boards_count: boards ?? 0,
        leads_count: leads ?? 0,
        last_activity: (lastLead as { updated_at?: string } | null)?.updated_at ?? null,
        members,
      }

      const ownerId = org.owner_id ?? 'sin-owner'
      if (!groupMap[ownerId]) {
        const p = profMap[ownerId]
        groupMap[ownerId] = {
          owner_id: ownerId,
          owner_email: p?.email ?? null,
          owner_name: p?.full_name ?? null,
          plan: p?.plan ?? 'free',
          plan_status: p?.plan_status ?? 'active',
          orgs: [],
        }
      }
      groupMap[ownerId].orgs.push(orgItem)
    }

    setGroups(Object.values(groupMap))
    setLoading(false)
  }

  function handleGhostMode(org: OrgItem, ownerId: string) {
    enterGhostMode({ id: org.id, name: org.name, owner_id: ownerId, plan: '', created_at: org.created_at })
    navigate('/dashboard')
  }

  async function moveToTrash(org: OrgItem) {
    if (!window.confirm(`¿Mover "${org.name}" a la papelera?\n\nEl propietario y sus colaboradores perderán el acceso de inmediato. Podrás restaurarla o eliminarla definitivamente desde la Papelera.`)) return
    const { error } = await supabase.from('organizations')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
      .eq('id', org.id)
    if (error) { toast.error('No se pudo mover a la papelera'); return }
    toast.success(`"${org.name}" movida a la papelera`)
    // Quitar de la vista (y eliminar grupos de owner que se queden vacíos)
    setGroups(prev => prev
      .map(g => ({ ...g, orgs: g.orgs.filter(o => o.id !== org.id) }))
      .filter(g => g.orgs.length > 0))
  }

  const totalOrgs = groups.reduce((s, g) => s + g.orgs.length, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Organizaciones</h1>
        <p className="text-gray-400 text-sm">{totalOrgs} organizaciones · {groups.length} propietarios</p>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Buscar por usuario u organización…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 w-64 text-sm"
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
        <span className="text-xs text-gray-400">{filtered.length} propietarios</span>
      </div>

      {/* Grupos por owner */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">Sin resultados</div>
      ) : (
        <div className="space-y-4">
          {filtered.map(group => (
            <div key={group.owner_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Cabecera owner */}
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-gray-100">
                <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                  <UserCog className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 text-sm truncate">{group.owner_name || group.owner_email || '(sin owner)'}</p>
                  <p className="text-xs text-gray-400 truncate">{group.owner_email}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full shrink-0 ${PLAN_COLOR[group.plan] ?? PLAN_COLOR.free}`}>
                  {group.plan}
                </span>
                <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />{group.orgs.length}
                </span>
              </div>

              {/* Orgs del owner */}
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {group.orgs.map(org => (
                    <Fragment key={org.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 w-8">
                          <button
                            onClick={() => setExpandedOrg(expandedOrg === org.id ? null : org.id)}
                            className="text-gray-400 hover:text-gray-700"
                            title="Ver colaboradores"
                          >
                            {expandedOrg === org.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                              {org.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-gray-800 truncate max-w-[200px]">{org.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600"><Layers className="h-3 w-3" />{org.boards_count} tableros</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-xs font-semibold text-primary-600">{org.leads_count} leads</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">Creada {formatDate(org.created_at)}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                          {org.last_activity ? `Activa ${formatDateTime(org.last_activity)}` : 'Sin actividad'}
                        </td>
                        <td className="px-4 py-2.5 text-center w-20">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleGhostMode(org, group.owner_id)}
                              className="p-1.5 rounded hover:bg-amber-100 text-amber-500 hover:text-amber-700 transition-colors"
                              title="Entrar en modo fantasma"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => moveToTrash(org)}
                              className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                              title="Mover a la papelera"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expandedOrg === org.id && (
                        <tr className="bg-slate-50/70">
                          <td></td>
                          <td colSpan={6} className="px-2 py-3">
                            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                              Usuarios ligados ({org.members.length})
                            </p>
                            {org.members.length === 0 ? (
                              <p className="text-xs text-gray-400">Sin usuarios registrados.</p>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                {org.members.map(m => (
                                  <div key={m.user_id} className="flex items-center gap-2.5 bg-white border border-gray-100 rounded-lg px-3 py-2">
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${m.role === 'owner' ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
                                      {m.role === 'owner' ? <UserCog className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-medium text-gray-800 truncate">{m.full_name || '(sin nombre)'}</p>
                                      <p className="text-[11px] text-gray-400 truncate">{m.email ?? '—'}</p>
                                    </div>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${m.role === 'owner' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                                      {ROLE_LABEL[m.role] ?? m.role}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
