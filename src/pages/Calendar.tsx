import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, addMonths, subMonths, addDays, isToday, isTomorrow,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ChevronLeft, ChevronRight, Plus, Home, PhoneCall,
  RefreshCw, ClipboardList, CalendarDays, List, Users,
  CalendarCheck, Search, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toLocalInput, toUTCIso } from '@/lib/utils'
import type { CalendarEvent, EventType, Lead } from '@/types'

// ── Constantes de tipos ───────────────────────────────────────────────────────
const EVENT_ICONS: Record<string, React.ElementType> = {
  visita_presencial:  Home,
  llamada:            PhoneCall,
  seguimiento:        RefreshCw,
  presupuesto_insitu: ClipboardList,
  reunion:            Users,
  otro:               CalendarCheck,
}
const EVENT_COLORS: Record<string, string> = {
  visita_presencial:  '#2563EB',
  llamada:            '#10B981',
  seguimiento:        '#8B5CF6',
  presupuesto_insitu: '#F59E0B',
  reunion:            '#EC4899',
  otro:               '#6B7280',
}
const EVENT_LABELS: Record<string, string> = {
  visita_presencial:  'Visita',
  llamada:            'Llamada',
  seguimiento:        'Seguimiento',
  presupuesto_insitu: 'Presupuesto',
  reunion:            'Reunión',
  otro:               'Otro',
}

type FilterType = 'all' | EventType

// ── Combobox de lead ──────────────────────────────────────────────────────────
function LeadSearch({
  leads,
  selected,
  onSelect,
}: {
  leads: Lead[]
  selected: Lead | null
  onSelect: (lead: Lead | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = leads
    .filter(l => {
      const name = (l.name ?? '').toLowerCase()
      const concept = (l.concept ?? '').toLowerCase()
      const q = query.toLowerCase()
      return name.includes(q) || concept.includes(q)
    })
    .slice(0, 8)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (selected) {
    return (
      <div className="flex items-center gap-2 p-2 bg-primary-50 border border-primary-200 rounded-lg">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-primary-700 truncate">
            {selected.name.replace(/^nombre:\s*/i, '')}
          </p>
          {selected.concept && <p className="text-xs text-primary-500 truncate">{selected.concept}</p>}
        </div>
        <button onClick={() => onSelect(null)} className="shrink-0 text-primary-400 hover:text-primary-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <Input
          placeholder="Buscar lead por nombre o concepto…"
          value={query}
          className="pl-8 text-sm"
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">Sin resultados</p>
          ) : (
            filtered.map(l => (
              <button
                key={l.id}
                className="w-full text-left px-3 py-2 hover:bg-primary-50 text-sm flex flex-col transition-colors"
                onMouseDown={() => { onSelect(l); setQuery(''); setOpen(false) }}
              >
                <span className="font-medium text-gray-900 truncate">
                  {l.name.replace(/^nombre:\s*/i, '')}
                </span>
                {l.concept && <span className="text-xs text-gray-400 truncate">{l.concept}</span>}
                {l.zone && <span className="text-xs text-gray-300 truncate">{l.zone}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showDialog, setShowDialog] = useState(false)
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null)
  const [detailMode, setDetailMode] = useState<'view' | 'edit'>('view')
  const [editForm, setEditForm] = useState({
    title: '', type: 'visita_presencial' as EventType,
    description: '', start_at: '', end_at: '',
  })
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [view, setView] = useState<'month' | 'list'>('month')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [saving, setSaving] = useState(false)
  const { user, organization } = useAuth()
  const navigate = useNavigate()

  const EMPTY_FORM = {
    title: '',
    type: 'visita_presencial' as EventType,
    description: '',
    start_at: '',
    end_at: '',
    lead_id: null as string | null,
  }
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  useEffect(() => {
    if (!organization) return
    loadEvents()
    // Cargar leads de la org para el combobox
    supabase
      .from('leads')
      .select('id,name,concept,zone,phone,column_id')
      .eq('org_id', organization.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => setLeads((data ?? []) as unknown as Lead[]))
  }, [organization?.id, currentMonth])

  async function loadEvents() {
    const start = startOfMonth(currentMonth).toISOString()
    const end = endOfMonth(currentMonth).toISOString()
    const { data } = await supabase
      .from('calendar_events')
      .select('*, lead:leads(id,name,concept,zone)')
      .eq('org_id', organization!.id)
      .gte('start_at', start)
      .lte('start_at', end)
      .order('start_at')
    setEvents(data ?? [])
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.start_at) return
    setSaving(true)
    try {
      await supabase.from('calendar_events').insert({
        org_id: organization!.id,
        user_id: user!.id,
        title: form.title.trim(),
        type: form.type,
        description: form.description || null,
        lead_id: selectedLead?.id ?? null,
        start_at: toUTCIso(form.start_at),
        end_at: toUTCIso(form.end_at || form.start_at),
        notify_before_minutes: 30,
      })
      toast.success('Evento creado')
      setShowDialog(false)
      setForm(EMPTY_FORM)
      setSelectedLead(null)
      loadEvents()
    } catch { toast.error('Error al crear evento') }
    finally { setSaving(false) }
  }

  async function handleDeleteEvent(id: string) {
    await supabase.from('calendar_events').delete().eq('id', id)
    setDetailEvent(null)
    loadEvents()
    toast.success('Evento eliminado')
  }

  const filtered = events.filter(e => filterType === 'all' || e.type === filterType)
  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })
  const startPadding = startOfMonth(currentMonth).getDay()
  const upcomingDays = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i))

  function openCreateForDay(day: Date) {
    setForm(f => ({
      ...f,
      start_at: format(day, "yyyy-MM-dd'T'09:00"),
      end_at:   format(day, "yyyy-MM-dd'T'10:00"),
    }))
    setSelectedLead(null)
    setShowDialog(true)
  }

  function handleEventClick(ev: CalendarEvent, e: React.MouseEvent) {
    e.stopPropagation()
    setDetailEvent(ev)
    setDetailMode('view')
  }

  function openEditMode(ev: CalendarEvent) {
    const evLead = ev.lead as unknown as Lead | null
    setEditForm({
      title: ev.title,
      type: ev.type,
      description: ev.description ?? '',
      start_at: toLocalInput(ev.start_at),
      end_at:   toLocalInput(ev.end_at),
    })
    setEditLead(evLead?.id ? evLead : null)
    setDetailMode('edit')
  }

  async function handleUpdateEvent() {
    if (!detailEvent || !editForm.title.trim() || !editForm.start_at) return
    setSavingEdit(true)
    try {
      await supabase.from('calendar_events').update({
        title: editForm.title.trim(),
        type: editForm.type,
        description: editForm.description || null,
        lead_id: editLead?.id ?? null,
        start_at: toUTCIso(editForm.start_at),
        end_at: toUTCIso(editForm.end_at || editForm.start_at),
      }).eq('id', detailEvent.id)
      toast.success('Evento actualizado')
      setDetailEvent(null)
      setDetailMode('view')
      loadEvents()
    } catch { toast.error('Error al guardar') }
    finally { setSavingEdit(false) }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Calendario</h1>
          <p className="text-gray-400 text-sm">Visitas, llamadas y seguimientos</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterType} onValueChange={v => setFilterType(v as FilterType)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="visita_presencial">🏠 Visitas</SelectItem>
              <SelectItem value="llamada">📞 Llamadas</SelectItem>
              <SelectItem value="seguimiento">🔄 Seguimientos</SelectItem>
              <SelectItem value="presupuesto_insitu">📋 Presupuestos</SelectItem>
              <SelectItem value="reunion">👥 Reuniones</SelectItem>
              <SelectItem value="otro">📌 Otros</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            <button onClick={() => setView('month')} className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1 ${view === 'month' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              <CalendarDays className="h-3.5 w-3.5" />Mes
            </button>
            <button onClick={() => setView('list')} className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1 border-l border-gray-200 ${view === 'list' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              <List className="h-3.5 w-3.5" />Lista
            </button>
          </div>
          <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setSelectedLead(null); setShowDialog(true) }}>
            <Plus className="h-4 w-4" />Nuevo
          </Button>
        </div>
      </div>

      {view === 'month' ? (
        <>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-base font-semibold text-gray-900 capitalize">
              {format(currentMonth, 'MMMM yyyy', { locale: es })}
            </h2>
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {['D', 'L', 'M', 'X', 'J', 'V', 'S'].map(d => (
                <div key={d} className="py-2 text-center text-xs font-bold text-gray-400 uppercase">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: startPadding }).map((_, i) => (
                <div key={`p${i}`} className="min-h-[90px] md:min-h-[110px] border-b border-r border-gray-100 bg-gray-50/50" />
              ))}
              {days.map(day => {
                const dayEvents = filtered.filter(e => isSameDay(new Date(e.start_at), day))
                const isSelected = selectedDay && isSameDay(day, selectedDay)
                const todayDay = isToday(day)
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[90px] md:min-h-[110px] border-b border-r border-gray-100 p-1 cursor-pointer transition-colors ${isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                    onClick={() => setSelectedDay(isSameDay(day, selectedDay ?? new Date('x')) ? null : day)}
                  >
                    <div className="flex items-center justify-between">
                      <div className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${todayDay ? 'bg-primary-600 text-white' : 'text-gray-700'}`}>
                        {format(day, 'd')}
                      </div>
                    </div>
                    {/* Puntos de color */}
                    {dayEvents.length > 0 && (
                      <div className="flex gap-0.5 mt-1 flex-wrap">
                        {dayEvents.slice(0, 5).map(ev => (
                          <span key={ev.id} className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: EVENT_COLORS[ev.type] ?? '#6B7280' }} />
                        ))}
                      </div>
                    )}
                    {/* Etiquetas desktop */}
                    <div className="mt-0.5 space-y-0.5 hidden md:block">
                      {dayEvents.slice(0, 2).map(ev => {
                        const lead = ev.lead as unknown as { name?: string } | null
                        const label = lead?.name
                          ? lead.name.replace(/^nombre:\s*/i, '')
                          : ev.title
                        return (
                          <div
                            key={ev.id}
                            className="text-[10px] rounded px-1 py-0.5 truncate font-medium cursor-pointer"
                            style={{ backgroundColor: (EVENT_COLORS[ev.type] ?? '#6B7280') + '20', color: EVENT_COLORS[ev.type] ?? '#6B7280' }}
                            onClick={e => handleEventClick(ev, e)}
                          >
                            {format(new Date(ev.start_at), 'HH:mm')} {label}
                          </div>
                        )
                      })}
                      {dayEvents.length > 2 && (
                        <p className="text-[10px] text-gray-400 px-1">+{dayEvents.length - 2} más</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Panel día seleccionado */}
          {selectedDay && (() => {
            const dayEvents = filtered.filter(e => isSameDay(new Date(e.start_at), selectedDay))
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-900 capitalize">
                    {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
                  </h3>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => openCreateForDay(selectedDay)}>
                    <Plus className="h-3.5 w-3.5" />Añadir
                  </Button>
                </div>
                {dayEvents.length === 0
                  ? <p className="text-sm text-gray-400">Sin eventos este día</p>
                  : dayEvents.map(ev => (
                      <EventRow key={ev.id} event={ev} onClick={e => handleEventClick(ev, e)} />
                    ))
                }
              </div>
            )
          })()}
        </>
      ) : (
        <div className="space-y-4">
          {upcomingDays.map(day => {
            const dayEvents = filtered.filter(e => isSameDay(new Date(e.start_at), day))
            if (dayEvents.length === 0) return null
            return (
              <div key={day.toISOString()}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-gray-500">
                    {isToday(day) ? <Badge className="bg-red-500 text-white text-[10px] py-0">HOY</Badge>
                      : isTomorrow(day) ? <Badge className="bg-amber-500 text-white text-[10px] py-0">MAÑANA</Badge>
                      : format(day, 'EEE d MMM', { locale: es })
                    }
                  </span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                <div className="space-y-2">
                  {dayEvents.map(ev => (
                    <EventRow key={ev.id} event={ev} onClick={e => handleEventClick(ev, e)} />
                  ))}
                </div>
              </div>
            )
          })}
          {upcomingDays.every(day => filtered.filter(e => isSameDay(new Date(e.start_at), day)).length === 0) && (
            <div className="text-center py-12 text-gray-400">
              <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin eventos en los próximos 7 días</p>
            </div>
          )}
        </div>
      )}

      {/* ── Dialog crear evento ─────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuevo evento</DialogTitle></DialogHeader>
          <div className="space-y-4">

            {/* Título */}
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                placeholder="Visita Juan García, Reunión con arquitecto…"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                autoFocus
              />
            </div>

            {/* Tipo */}
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as EventType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="visita_presencial">🏠 Visita presencial</SelectItem>
                  <SelectItem value="llamada">📞 Llamada</SelectItem>
                  <SelectItem value="seguimiento">🔄 Seguimiento</SelectItem>
                  <SelectItem value="presupuesto_insitu">📋 Presupuesto in-situ</SelectItem>
                  <SelectItem value="reunion">👥 Reunión</SelectItem>
                  <SelectItem value="otro">📌 Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Fechas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Inicio *</Label>
                <Input type="datetime-local" value={form.start_at} onChange={e => setForm(f => ({ ...f, start_at: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Fin</Label>
                <Input type="datetime-local" value={form.end_at} onChange={e => setForm(f => ({ ...f, end_at: e.target.value }))} />
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea rows={2} placeholder="Observaciones…" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            {/* Vincular a lead */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Vincular a lead <span className="text-gray-400 font-normal text-xs">(opcional)</span>
              </Label>
              <LeadSearch leads={leads} selected={selectedLead} onSelect={setSelectedLead} />
              {!selectedLead && (
                <p className="text-xs text-gray-400">Si se deja vacío, es un evento genérico no vinculado a ningún cliente</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving || !form.title.trim() || !form.start_at}>
                {saving ? 'Creando…' : 'Crear evento'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog detalle/edición de evento ──────────────────────── */}
      {detailEvent && (
        <Dialog open={!!detailEvent} onOpenChange={() => { setDetailEvent(null); setDetailMode('view') }}>
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {(() => {
                  const Icon = EVENT_ICONS[detailMode === 'edit' ? editForm.type : detailEvent.type] ?? CalendarDays
                  const color = EVENT_COLORS[detailMode === 'edit' ? editForm.type : detailEvent.type] ?? '#6B7280'
                  return <Icon className="h-4 w-4" style={{ color }} />
                })()}
                {detailMode === 'view' ? detailEvent.title : 'Editar evento'}
              </DialogTitle>
            </DialogHeader>

            {detailMode === 'view' ? (
              /* ── Modo VER ── */
              <div className="space-y-3 text-sm">
                {/* Tipo */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: (EVENT_COLORS[detailEvent.type] ?? '#6B7280') + '20', color: EVENT_COLORS[detailEvent.type] ?? '#6B7280' }}>
                    {EVENT_LABELS[detailEvent.type] ?? detailEvent.type}
                  </span>
                </div>
                {/* Fecha */}
                <p className="text-gray-600">
                  📅 {format(new Date(detailEvent.start_at), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}
                  {detailEvent.end_at !== detailEvent.start_at && (
                    <span className="text-gray-400"> → {format(new Date(detailEvent.end_at), 'HH:mm')}</span>
                  )}
                </p>
                {/* Lead vinculado */}
                {(() => {
                  const lead = detailEvent.lead as unknown as { id?: string; name?: string; concept?: string } | null
                  if (!lead?.id) return null
                  return (
                    <div className="bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
                      <p className="text-xs text-primary-500 font-medium">Lead vinculado</p>
                      <p className="text-sm font-semibold text-primary-700">
                        {lead.name?.replace(/^nombre:\s*/i, '')}
                      </p>
                      {lead.concept && <p className="text-xs text-primary-400">{lead.concept}</p>}
                    </div>
                  )
                })()}
                {/* Notas */}
                {detailEvent.description && (
                  <p className="text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{detailEvent.description}</p>
                )}
                {/* Acciones */}
                <div className="flex gap-2 pt-2 flex-wrap">
                  {(() => {
                    const lead = detailEvent.lead as unknown as { id?: string } | null
                    if (!lead?.id) return null
                    return (
                      <Button size="sm" variant="outline" className="gap-1.5 text-primary-600 border-primary-200" onClick={() => navigate(`/leads/${lead.id}`)}>
                        Ver lead →
                      </Button>
                    )
                  })()}
                  <Button size="sm" variant="outline" onClick={() => openEditMode(detailEvent)}>
                    ✏️ Editar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDeleteEvent(detailEvent.id)}>
                    🗑 Eliminar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setDetailEvent(null); setDetailMode('view') }} className="ml-auto">
                    Cerrar
                  </Button>
                </div>
              </div>
            ) : (
              /* ── Modo EDITAR ── */
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Título *</Label>
                  <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={editForm.type} onValueChange={v => setEditForm(f => ({ ...f, type: v as EventType }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visita_presencial">🏠 Visita presencial</SelectItem>
                      <SelectItem value="llamada">📞 Llamada</SelectItem>
                      <SelectItem value="seguimiento">🔄 Seguimiento</SelectItem>
                      <SelectItem value="presupuesto_insitu">📋 Presupuesto in-situ</SelectItem>
                      <SelectItem value="reunion">👥 Reunión</SelectItem>
                      <SelectItem value="otro">📌 Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Inicio *</Label>
                    <Input type="datetime-local" value={editForm.start_at} onChange={e => setEditForm(f => ({ ...f, start_at: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Fin</Label>
                    <Input type="datetime-local" value={editForm.end_at} onChange={e => setEditForm(f => ({ ...f, end_at: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notas</Label>
                  <Textarea rows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1">
                    Vincular a lead <span className="text-gray-400 text-xs font-normal">(opcional)</span>
                  </Label>
                  <LeadSearch leads={leads} selected={editLead} onSelect={setEditLead} />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => setDetailMode('view')}>Cancelar</Button>
                  <Button onClick={handleUpdateEvent} disabled={savingEdit || !editForm.title.trim() || !editForm.start_at}>
                    {savingEdit ? 'Guardando…' : 'Guardar cambios'}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ── Fila de evento reutilizable ───────────────────────────────────────────────
function EventRow({ event, onClick }: {
  event: CalendarEvent
  onClick: (e: React.MouseEvent) => void
}) {
  const Icon = EVENT_ICONS[event.type] ?? CalendarDays
  const color = EVENT_COLORS[event.type] ?? '#6B7280'
  const lead = event.lead as unknown as { id?: string; name?: string; concept?: string; zone?: string } | null

  // Display: evento con lead vs evento genérico
  const title = lead?.name ? lead.name.replace(/^nombre:\s*/i, '') : event.title
  const subtitle = lead?.name ? (event.title + (lead.concept ? ` — ${lead.concept}` : '')) : (event.description ?? '')

  return (
    <div
      className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100 hover:border-gray-200 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: color + '20' }}>
        <Icon className="h-3.5 w-3.5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
        {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
        {lead?.zone && <p className="text-xs text-gray-400 truncate">{lead.zone}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-bold text-gray-700">{format(new Date(event.start_at), 'HH:mm')}</p>
        <p className="text-[10px] font-medium" style={{ color }}>{EVENT_LABELS[event.type]}</p>
      </div>
    </div>
  )
}
