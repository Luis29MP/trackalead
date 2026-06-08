import { useEffect, useState } from 'react'
import { DollarSign, AlertTriangle, Calendar, Gift, XCircle, Building2, Layers, Database, Star, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatDate } from '@/lib/utils'

interface OwnerSub {
  user_id: string
  email: string | null
  full_name: string | null
  plan: string
  plan_status: string
  next_billing_at: string | null
  trial_ends_at: string | null
  lifetime_since: string | null
  orgs_count: number
  boards_count: number
  leads_count: number
  price: number
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo', suspended: 'Suspendido', trial: 'Prueba', cancelled: 'Cancelado', lifetime: '⭐ LIFETIME',
}
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  trial: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
  lifetime: 'bg-gradient-to-r from-amber-400 to-yellow-500 text-white shadow-sm',
}

// Nombre a mostrar: full_name si existe y no está vacío, si no el email, nunca "(sin nombre)"
function ownerLabel(o: { full_name: string | null; email: string | null }): string {
  if (o.full_name && o.full_name.trim()) return o.full_name.trim()
  if (o.email && o.email.trim()) return o.email.trim()
  return 'Usuario sin datos'
}

export function SABilling() {
  const [owners, setOwners]   = useState<OwnerSub[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction]   = useState<OwnerSub | null>(null)
  const [trialDays, setTrialDays] = useState('14')
  const [lifetimePlan, setLifetimePlan] = useState('pro')
  const [prices, setPrices]   = useState<Record<string, number>>({})
  const [search, setSearch]   = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)

    // 1) Precios de planes + owners (org_members con role='owner')
    const [{ data: planCfg }, { data: ownerMembers, error: membersError }] = await Promise.all([
      supabase.from('plan_config').select('plan, price_monthly'),
      supabase.from('org_members').select('org_id, user_id').eq('role', 'owner'),
    ])

    const priceMap: Record<string, number> = {}
    for (const p of planCfg ?? []) priceMap[p.plan] = p.price_monthly ?? 0
    setPrices(priceMap)

    // 2) Agrupar org_ids por usuario owner
    const byOwner: Record<string, string[]> = {}
    for (const m of ownerMembers ?? []) {
      if (!m.user_id) continue
      ;(byOwner[m.user_id] ??= []).push(m.org_id)
    }
    const ownerIds = Object.keys(byOwner)
    if (membersError) console.error('[SABilling] org_members query error →', membersError)
    if (ownerIds.length === 0) { setOwners([]); setLoading(false); return }

    // 3) Query DIRECTA a profiles (mismo patrón que SAOrganizations).
    //    Solo columnas que existen seguro — NO incluir trial_ends_at/lifetime_since
    //    porque si alguna columna no existe, Supabase falla TODA la query.
    interface OwnerProfile {
      id: string; email: string | null; full_name: string | null
      plan: string | null; plan_status: string | null; next_billing_at: string | null
    }
    const { data: profs, error: profsError } = await supabase
      .from('profiles')
      .select('id, full_name, email, plan, plan_status, next_billing_at')
      .in('id', ownerIds)

    // 🔍 Debug: ver exactamente qué devuelve Supabase para los owners
    console.log('[SABilling] ownerIds:', ownerIds)
    console.log('[SABilling] profiles query →', profs)
    if (profsError) console.error('[SABilling] profiles query error →', profsError)

    const profMap: Record<string, OwnerProfile> = {}
    for (const p of (profs ?? []) as OwnerProfile[]) profMap[p.id] = p

    const result: OwnerSub[] = []
    for (const ownerId of ownerIds) {
      const orgIds = byOwner[ownerId]
      const [{ count: boards }, { count: leads }] = await Promise.all([
        supabase.from('boards').select('*', { count: 'exact', head: true }).in('org_id', orgIds),
        supabase.from('leads').select('*', { count: 'exact', head: true }).in('org_id', orgIds).eq('is_archived', false),
      ])
      const p = profMap[ownerId]
      const plan = p?.plan ?? 'free'
      result.push({
        user_id: ownerId,
        email: p?.email ?? null,
        full_name: p?.full_name ?? null,
        plan,
        plan_status: p?.plan_status ?? 'active',
        next_billing_at: p?.next_billing_at ?? null,
        trial_ends_at: null,
        lifetime_since: null,
        orgs_count: orgIds.length,
        boards_count: boards ?? 0,
        leads_count: leads ?? 0,
        price: priceMap[plan] ?? 0,
      })
    }
    // Suspendidos primero, luego por precio descendente
    result.sort((a, b) => {
      const ord = (s: string) => s === 'suspended' ? 0 : 1
      return ord(a.plan_status) - ord(b.plan_status) || b.price - a.price
    })
    setOwners(result)
    setLoading(false)
  }

  // MRR = suma del plan de cada owner activo (o en prueba)
  const mrr     = owners.filter(o => o.plan !== 'free' && (o.plan_status === 'active' || o.plan_status === 'trial')).reduce((s, o) => s + o.price, 0)
  const overdue = owners.filter(o => o.plan_status === 'suspended' && o.plan !== 'free')
  const pending = overdue.reduce((s, o) => s + o.price, 0)
  const payingCount = owners.filter(o => o.plan !== 'free').length

  // Filtro en tiempo real por nombre o email (sin llamada a BD)
  const visibleOwners = owners.filter(o => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (o.full_name?.toLowerCase().includes(q) ?? false) || (o.email?.toLowerCase().includes(q) ?? false)
  })

  async function changePlan(owner: OwnerSub, plan: string) {
    await supabase.from('profiles').update({ plan }).eq('id', owner.user_id)
    toast.success(`Plan de ${owner.email ?? 'usuario'} → ${plan.toUpperCase()}`)
    setOwners(prev => prev.map(o => o.user_id === owner.user_id ? { ...o, plan, price: prices[plan] ?? 0 } : o))
    setAction(prev => prev && prev.user_id === owner.user_id ? { ...prev, plan, price: prices[plan] ?? 0 } : prev)
  }

  async function setStatus(owner: OwnerSub, plan_status: string, extra: Record<string, unknown> = {}) {
    await supabase.from('profiles').update({ plan_status, ...extra }).eq('id', owner.user_id)
    setOwners(prev => prev.map(o => o.user_id === owner.user_id ? { ...o, plan_status, ...extra } : o))
  }

  async function applyTrial(owner: OwnerSub) {
    const ends = new Date(Date.now() + parseInt(trialDays) * 86400_000).toISOString()
    await setStatus(owner, 'trial', { trial_ends_at: ends })
    toast.success(`Prueba de ${trialDays} días aplicada`)
    setAction(null)
  }

  async function suspend(owner: OwnerSub) {
    await setStatus(owner, 'suspended')
    toast.success('Usuario suspendido')
    setAction(null)
  }

  async function reactivate(owner: OwnerSub) {
    await setStatus(owner, 'active', { next_billing_at: new Date(Date.now() + 30 * 86400_000).toISOString() })
    toast.success('Suscripción reactivada')
    setAction(null)
  }

  async function grantLifetime(owner: OwnerSub) {
    const since = new Date().toISOString()
    // Cambio principal: plan + estado lifetime + sin próximo pago.
    const { error } = await supabase.from('profiles').update({
      plan: lifetimePlan,
      plan_status: 'lifetime',
      next_billing_at: null,
    }).eq('id', owner.user_id)
    if (error) { toast.error('Error al conceder lifetime'); console.error('[SABilling] grantLifetime error →', error); return }

    // Best-effort: guardar la fecha. Si la columna lifetime_since aún no existe
    // (migración add_lifetime.sql sin ejecutar) NO rompemos el cambio principal.
    const { error: sinceError } = await supabase.from('profiles').update({ lifetime_since: since }).eq('id', owner.user_id)
    if (sinceError) console.warn('[SABilling] lifetime_since no guardado (¿falta la columna?) →', sinceError)

    setOwners(prev => prev.map(o => o.user_id === owner.user_id
      ? { ...o, plan: lifetimePlan, plan_status: 'lifetime', next_billing_at: null, lifetime_since: since, price: prices[lifetimePlan] ?? 0 }
      : o))
    toast.success(`🎁 Lifetime ${lifetimePlan.toUpperCase()} concedido`)
    setAction(null)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Suscripciones</h1>
        <p className="text-gray-400 text-sm">Planes por usuario — {payingCount} de pago</p>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'MRR total',         value: formatCurrency(mrr),            icon: DollarSign,   color: 'bg-green-500' },
          { label: 'Cobrado este mes',  value: formatCurrency(mrr - pending),  icon: Calendar,     color: 'bg-blue-500' },
          { label: 'Pendiente de cobro',value: formatCurrency(pending),        icon: AlertTriangle, color: pending > 0 ? 'bg-red-500' : 'bg-gray-400' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-400">{s.label}</p>
                  <p className="text-xl font-bold text-gray-900 mt-0.5">{loading ? '…' : s.value}</p>
                </div>
                <div className={`p-2 rounded-lg ${s.color}`}><s.icon className="h-4 w-4 text-white" /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Suspendidos / vencidos destacados */}
      {overdue.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4" />{overdue.length} usuario(s) suspendido(s) con plan de pago
            </p>
            <div className="space-y-1.5">
              {overdue.map(o => (
                <div key={o.user_id} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2">
                  <span className="font-medium text-gray-800">{ownerLabel(o)}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-red-600 font-semibold">{formatCurrency(o.price)}</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => reactivate(o)}>Reactivar</Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Buscador */}
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre o email..."
          className="h-9 pl-9 pr-9 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            title="Limpiar búsqueda"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabla de usuarios suscriptores */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : owners.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">Sin usuarios owner registrados</div>
        ) : visibleOwners.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No se encontraron usuarios con ese criterio</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-3">Usuario</th>
                  <th className="text-left px-3 py-3">Plan</th>
                  <th className="text-center px-3 py-3">Orgs</th>
                  <th className="text-center px-3 py-3">Tableros</th>
                  <th className="text-center px-3 py-3">Leads</th>
                  <th className="text-right px-3 py-3">Importe</th>
                  <th className="text-left px-3 py-3">Próximo pago</th>
                  <th className="text-left px-3 py-3">Estado</th>
                  <th className="text-center px-3 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleOwners.map(o => {
                  const hasName = !!(o.full_name && o.full_name.trim())
                  return (
                  <tr key={o.user_id} className={`hover:bg-gray-50 ${o.plan_status === 'suspended' ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 truncate max-w-[180px]">{ownerLabel(o)}</p>
                      {hasName && <p className="text-xs text-gray-400 truncate max-w-[180px]">{o.email}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-700">{o.plan}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-gray-600">
                      <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{o.orgs_count}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-gray-600">
                      <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{o.boards_count}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs font-semibold text-primary-600">
                      <span className="inline-flex items-center gap-1"><Database className="h-3 w-3" />{o.leads_count}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-900">
                      {o.plan_status === 'lifetime' ? <span className="text-amber-600 text-xs">de por vida</span> : o.price > 0 ? `${formatCurrency(o.price)}/mes` : '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">{o.next_billing_at ? formatDate(o.next_billing_at) : '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[o.plan_status] ?? STATUS_COLOR.active}`}>
                        {STATUS_LABEL[o.plan_status] ?? o.plan_status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction(o)}>Gestionar</Button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog gestionar */}
      <Dialog open={!!action} onOpenChange={() => setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Gestionar suscripción</DialogTitle></DialogHeader>
          {action && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="font-medium text-gray-900">{ownerLabel(action)}</p>
                <p className="text-xs text-gray-400">{action.email} · {action.orgs_count} org(s) · {formatCurrency(action.price)}/mes</p>
              </div>

              {/* Cambiar plan */}
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-gray-700">Plan</p>
                <Select value={action.plan} onValueChange={v => changePlan(action, v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">FREE — gratis</SelectItem>
                    <SelectItem value="pro">PRO — {formatCurrency(prices.pro ?? 0)}/mes</SelectItem>
                    <SelectItem value="enterprise">ENTERPRISE — {formatCurrency(prices.enterprise ?? 0)}/mes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Periodo de prueba */}
              <div className="space-y-2 border border-gray-100 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Gift className="h-3.5 w-3.5 text-amber-500" />Periodo de prueba gratis</p>
                <div className="flex gap-2">
                  <Input type="number" min="1" value={trialDays} onChange={e => setTrialDays(e.target.value)} className="h-8 text-sm w-24" />
                  <span className="text-sm text-gray-500 self-center">días</span>
                  <Button size="sm" className="ml-auto" onClick={() => applyTrial(action)}>Aplicar prueba</Button>
                </div>
              </div>

              {/* Lifetime */}
              <div className="space-y-2 border-2 border-amber-200 bg-amber-50/60 rounded-lg p-3">
                <p className="text-sm font-semibold text-amber-700 flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-amber-500 fill-amber-400" />Acceso de por vida</p>
                {action.plan_status === 'lifetime' ? (
                  <p className="text-xs text-amber-700">Este usuario ya tiene <strong>Lifetime {action.plan.toUpperCase()}</strong>. Cambiar el plan arriba lo quita.</p>
                ) : (
                  <div className="flex gap-2">
                    <Select value={lifetimePlan} onValueChange={setLifetimePlan}>
                      <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pro">PRO</SelectItem>
                        <SelectItem value="enterprise">ENTERPRISE</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="ml-auto bg-amber-500 hover:bg-amber-600 text-white gap-1.5" onClick={() => grantLifetime(action)}>
                      <Gift className="h-3.5 w-3.5" />Dar Lifetime
                    </Button>
                  </div>
                )}
              </div>

              {/* Suspender / reactivar */}
              <div className="flex gap-2">
                {action.plan_status === 'suspended' ? (
                  <Button variant="outline" className="flex-1 text-green-700 border-green-300" onClick={() => reactivate(action)}>Reactivar</Button>
                ) : (
                  <Button variant="outline" className="flex-1 text-red-600 border-red-300 gap-1.5" onClick={() => suspend(action)}>
                    <XCircle className="h-4 w-4" />Suspender usuario
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
