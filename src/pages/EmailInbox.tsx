import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, CheckCircle2, XCircle, AlertTriangle, Inbox, ArrowRight, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/utils'

interface EmailEvent {
  id: string
  status: string
  reason: string | null
  route_key: string | null
  board_id: string | null
  from_addr: string | null
  subject: string | null
  raw_excerpt: string | null
  lead_id: string | null
  created_at: string
}

const STATUS_META: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  created:              { label: 'Creado',                 color: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  discarded_ai:         { label: 'Descartado (basura)',    color: 'bg-gray-100 text-gray-600',    icon: XCircle },
  discarded_no_contact: { label: 'Descartado (sin datos)', color: 'bg-gray-100 text-gray-600',    icon: XCircle },
  discarded_manual:     { label: 'Descartado (manual)',    color: 'bg-gray-100 text-gray-600',    icon: XCircle },
  appended:             { label: 'Añadido a lead',         color: 'bg-blue-100 text-blue-700',    icon: CheckCircle2 },
  no_route:             { label: 'Sin tablero',            color: 'bg-amber-100 text-amber-700',  icon: AlertTriangle },
  error:                { label: 'Error',                  color: 'bg-red-100 text-red-700',      icon: AlertTriangle },
}

type Filter = 'all' | 'created' | 'discarded'

export function EmailInbox() {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const [events, setEvents] = useState<EmailEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [rescuing, setRescuing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isLeadStatus = (s: string) => s === 'created' || s === 'appended'

  useEffect(() => { if (organization) load() }, [organization?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('email_ingest_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setEvents((data ?? []) as EmailEvent[])
    setLoading(false)
  }

  async function rescue(ev: EmailEvent) {
    if (!organization) return
    setRescuing(ev.id)
    try {
      // Tablero destino: el del evento, o por su clave de ruta
      let boardId = ev.board_id
      if (!boardId && ev.route_key) {
        const { data } = await supabase.from('email_ingest_routes').select('board_id').eq('key', ev.route_key).maybeSingle()
        boardId = data?.board_id ?? null
      }
      if (!boardId) { toast.error('Este email no tiene un tablero asignado'); return }

      // Extraer datos con IA del texto guardado
      const rawText = ev.raw_excerpt || ev.subject || ''
      let a: { name?: string; phone?: string; email?: string; zone?: string; concept?: string; description?: string } | null = null
      try { const { analyzeLeadMessage } = await import('@/lib/ai'); a = await analyzeLeadMessage(rawText) } catch { a = null }

      const name = (a?.name || '').trim() || (ev.from_addr?.split('@')[0] || 'Nuevo lead')
      const { data: col } = await supabase.from('board_columns').select('id').eq('board_id', boardId).order('position', { ascending: true }).limit(1).maybeSingle()
      if (!col) { toast.error('El tablero no tiene columnas'); return }
      const { data: top } = await supabase.from('leads').select('position').eq('column_id', col.id).eq('is_archived', false).not('position', 'is', null).order('position', { ascending: true }).limit(1).maybeSingle()
      const position = top?.position != null ? top.position - 1 : 0

      const { data: lead, error } = await supabase.from('leads').insert({
        board_id: boardId, org_id: organization.id, column_id: col.id,
        title: name, name,
        phone: (a?.phone || '').trim() || null,
        email: (a?.email || '').trim() || null,
        zone: (a?.zone || '').trim() || null,
        concept: (a?.concept || '').trim() || null,
        notes: [a?.description || '', '', `📧 Rescatado de un email (${ev.route_key ?? ''})`, ev.raw_excerpt || ''].join('\n'),
        source: 'form', is_read: false, position,
      }).select('id').single()
      if (error || !lead) { toast.error('No se pudo crear el lead'); return }

      await supabase.from('email_ingest_events').update({ status: 'created', lead_id: lead.id, reason: 'Rescatado manualmente' }).eq('id', ev.id)
      toast.success('Lead creado desde el email')
      load()
    } catch {
      toast.error('No se pudo rescatar el email')
    } finally {
      setRescuing(null)
    }
  }

  // Descartar un email (pasa a "Descartados"; no borra ningún lead ya creado)
  async function discardOne(ev: EmailEvent) {
    const prev = events
    setEvents(list => list.map(e => e.id === ev.id ? { ...e, status: 'discarded_manual', reason: 'Descartado manualmente' } : e))
    const { error } = await supabase.from('email_ingest_events').update({ status: 'discarded_manual', reason: 'Descartado manualmente' }).eq('id', ev.id)
    if (error) { setEvents(prev); toast.error('No se pudo descartar') }
  }

  // Eliminar definitivamente todos los descartados
  async function deleteDiscarded() {
    if (!organization) return
    const ids = events.filter(e => !isLeadStatus(e.status)).map(e => e.id)
    if (ids.length === 0) { toast.info('No hay descartados que eliminar'); return }
    if (!window.confirm(`¿Eliminar definitivamente ${ids.length} email(s) descartado(s)? No afecta a los leads ya creados.`)) return
    setDeleting(true)
    const { error } = await supabase.from('email_ingest_events').delete().in('id', ids)
    setDeleting(false)
    if (error) { toast.error('No se pudieron eliminar'); return }
    setEvents(list => list.filter(e => isLeadStatus(e.status)))
    toast.success(`${ids.length} descartado(s) eliminado(s)`)
  }

  const filtered = events.filter(e =>
    filter === 'all' ? true : filter === 'created' ? isLeadStatus(e.status) : !isLeadStatus(e.status))

  const counts = {
    all: events.length,
    created: events.filter(e => isLeadStatus(e.status)).length,
    discarded: events.filter(e => !isLeadStatus(e.status)).length,
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Mail className="h-6 w-6 text-primary-600" />Bandeja de emails</h1>
        <p className="text-gray-500 text-sm mt-1">Emails de los formularios web: cuáles se convirtieron en lead y cuáles se descartaron (y por qué). Puedes rescatar cualquiera.</p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {([['all', `Todos (${counts.all})`], ['created', `Leads (${counts.created})`], ['discarded', `Descartados (${counts.discarded})`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${filter === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
        {counts.discarded > 0 && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50" disabled={deleting} onClick={deleteDiscarded}>
            <Trash2 className="h-3.5 w-3.5" />{deleting ? 'Eliminando…' : `Eliminar descartados (${counts.discarded})`}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Inbox className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">Aún no hay emails procesados. Cuando lleguen leads por los formularios, aparecerán aquí.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(ev => {
            const meta = STATUS_META[ev.status] ?? STATUS_META.error
            const Icon = meta.icon
            return (
              <Card key={ev.id}>
                <CardContent className="p-3.5">
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${meta.color}`}>
                      <Icon className="h-3.5 w-3.5" />{meta.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{ev.subject || '(sin asunto)'}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {ev.route_key ? `${ev.route_key} · ` : ''}{ev.from_addr || ''}
                      </p>
                      {ev.reason && ev.status !== 'created' && (
                        <p className="text-xs text-gray-500 mt-1 italic">“{ev.reason}”</p>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-400 shrink-0">{formatRelativeTime(ev.created_at)}</span>
                  </div>
                  <div className="flex justify-end items-center gap-2 mt-2">
                    {ev.status !== 'discarded_manual' && (
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-gray-400 hover:text-red-500" onClick={() => discardOne(ev)}>
                        <X className="h-3.5 w-3.5" />Descartar
                      </Button>
                    )}
                    {isLeadStatus(ev.status) && ev.lead_id ? (
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate(`/leads/${ev.lead_id}`)}>
                        Ver lead <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : !isLeadStatus(ev.status) ? (
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs" disabled={rescuing === ev.id} onClick={() => rescue(ev)}>
                        <Sparkles className="h-3.5 w-3.5" />{rescuing === ev.id ? 'Creando…' : 'Convertir en lead'}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
