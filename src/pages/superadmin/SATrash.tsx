import { useEffect, useState } from 'react'
import { Trash2, RotateCcw, AlertTriangle, Building2, Layers, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'

interface TrashedOrg {
  id: string
  name: string
  owner_email: string | null
  owner_name: string | null
  deleted_at: string | null
  boards_count: number
  leads_count: number
}

export function SATrash() {
  const [orgs, setOrgs] = useState<TrashedOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: orgsData } = await supabase.from('organizations')
      .select('id, name, owner_id, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (!orgsData) { setOrgs([]); setLoading(false); return }

    const ownerIds = [...new Set(orgsData.map(o => o.owner_id).filter(Boolean))] as string[]
    const { data: profs } = ownerIds.length
      ? await supabase.from('profiles').select('id, email, full_name').in('id', ownerIds)
      : { data: [] }
    const profMap: Record<string, { email: string | null; full_name: string | null }> = {}
    for (const p of profs ?? []) profMap[p.id] = p

    const items: TrashedOrg[] = await Promise.all(orgsData.map(async (org) => {
      const [{ count: boards }, { count: leads }] = await Promise.all([
        supabase.from('boards').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      ])
      const p = org.owner_id ? profMap[org.owner_id] : null
      return {
        id: org.id,
        name: org.name,
        owner_email: p?.email ?? null,
        owner_name: p?.full_name ?? null,
        deleted_at: org.deleted_at,
        boards_count: boards ?? 0,
        leads_count: leads ?? 0,
      }
    }))
    setOrgs(items)
    setLoading(false)
  }

  async function restore(org: TrashedOrg) {
    setBusy(org.id)
    const { error } = await supabase.from('organizations')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', org.id)
    setBusy(null)
    if (error) { toast.error('No se pudo restaurar'); return }
    toast.success(`"${org.name}" restaurada`)
    setOrgs(prev => prev.filter(o => o.id !== org.id))
  }

  async function purge(org: TrashedOrg) {
    const typed = window.prompt(
      `⚠️ BORRADO DEFINITIVO E IRREVERSIBLE\n\nSe eliminará "${org.name}" y TODOS sus datos: ${org.boards_count} tablero(s), ${org.leads_count} lead(s), presupuestos, profesionales, comentarios, archivos y eventos.\n\nEscribe el nombre exacto de la organización para confirmar:`
    )
    if (typed === null) return
    if (typed.trim() !== org.name) { toast.error('El nombre no coincide. Cancelado.'); return }
    setBusy(org.id)
    const { error } = await supabase.from('organizations').delete().eq('id', org.id)
    setBusy(null)
    if (error) { toast.error(`No se pudo eliminar: ${error.message}`); return }
    toast.success(`"${org.name}" eliminada definitivamente`)
    setOrgs(prev => prev.filter(o => o.id !== org.id))
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-red-500" />Papelera
        </h1>
        <p className="text-gray-400 text-sm">
          {orgs.length} organización(es) en la papelera · sin acceso para sus propietarios
        </p>
      </div>

      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-800 text-xs">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          Una organización en la papelera queda <strong>inaccesible</strong> para su propietario y colaboradores, pero sus datos
          siguen existiendo hasta el borrado definitivo. <strong>Restaurar</strong> devuelve el acceso;{' '}
          <strong>Eliminar definitivamente</strong> borra la organización y todos sus datos en cascada (irreversible).
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <Trash2 className="h-10 w-10 mx-auto mb-3 text-gray-200" />
          La papelera está vacía.
        </div>
      ) : (
        <div className="space-y-2.5">
          {orgs.map(org => (
            <div key={org.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                {org.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-800 text-sm truncate flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-gray-400" />{org.name}
                </p>
                <p className="text-xs text-gray-400 truncate flex items-center gap-1.5">
                  <UserCog className="h-3 w-3" />{org.owner_name || org.owner_email || '(sin owner)'}
                  <span className="text-gray-300">·</span>
                  <Layers className="h-3 w-3" />{org.boards_count} tableros · {org.leads_count} leads
                </p>
              </div>
              <span className="text-[11px] text-gray-400 whitespace-nowrap shrink-0 hidden sm:block">
                {org.deleted_at ? `En papelera ${formatDateTime(org.deleted_at)}` : ''}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm" variant="outline" className="gap-1.5 text-xs"
                  disabled={busy === org.id}
                  onClick={() => restore(org)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />Restaurar
                </Button>
                <Button
                  size="sm" variant="outline" className="gap-1.5 text-xs text-red-600 border-red-300 hover:bg-red-50"
                  disabled={busy === org.id}
                  onClick={() => purge(org)}
                >
                  <Trash2 className="h-3.5 w-3.5" />Eliminar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
