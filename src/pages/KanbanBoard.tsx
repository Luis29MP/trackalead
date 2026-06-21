import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext, DragOverlay, closestCenter,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, ArrowLeft, Wrench, MapPin, ChevronLeft, ChevronRight,
  ClipboardPaste, Calendar, Settings2, Trash2, ArrowUp, ArrowDown, Save, Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { useBoardColumns } from '@/hooks/useBoards'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatRelativeTime, sourceLabel } from '@/lib/utils'
import { ImportTrello } from '@/components/ImportTrello'
import { DeleteBoardDialog } from '@/components/DeleteBoardDialog'
import { BUDGET_STATE_META } from '@/lib/budgetState'
import type { Board, Lead, BoardColumn } from '@/types'

// ── Smart paste ───────────────────────────────────────────────────────────────────
function parsePastedText(text: string): Partial<NewLeadForm> {
  const r: Partial<NewLeadForm> = {}
  const phone = text.match(/(?:(?:tlf|tel|teléfono|móvil|celular)\s*:?\s*)?(\+?[\d]{3}[\s\-]?[\d]{3}[\s\-]?[\d]{3,4})/i)
  if (phone) r.phone = phone[1].replace(/[\s\-]/g, '')
  const email = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  if (email) r.email = email[0]
  const zone = text.match(/(?:zona|ciudad|localidad|población|municipio)\s*:?\s*([A-Za-záéíóúÁÉÍÓÚñÑ\s,]+?)(?:\n|$|,)/i)
  if (zone) r.zone = zone[1].trim()
  const concept = text.match(/(?:trabajo|concepto|servicio|tipo|obra|reforma|selecciona\s+servicio)\s*:?\s*([^\n,]+)/i)
  if (concept) r.concept = concept[1].trim()
  // Mensaje / descripción → trabajo a realizar
  const msg = text.match(/(?:mensaje|descripci[oó]n|detalle|comentario)\s*:?\s*([^\n]{10,})/i)
  if (msg) r.notes = msg[1].trim()
  // Nombre: primera línea sin teléfono ni email
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const nameLine = lines.find(l => !l.match(/\d{9}/) && !l.includes('@') && l.length > 2 && l.length < 70)
  if (nameLine) r.name = nameLine.replace(/^(?:nombre|cliente|contacto|name)\s*:\s*/i, '').trim()
  return r
}

// ── Lead Card ─────────────────────────────────────────────────────────────────────
function LeadCard({ lead, columns, onClick, onMove }: {
  lead: Lead
  columns: BoardColumn[]
  onClick: () => void
  onMove: (leadId: string, toColumnId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }

  const currentColIdx = columns.findIndex(c => c.id === lead.column_id)
  const prevCol = columns[currentColIdx - 1]
  const nextCol = columns[currentColIdx + 1]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group bg-white rounded-lg border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow select-none relative"
    >
      {/* Drag handle area — all except the move buttons */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
        onClick={(e) => { e.stopPropagation(); onClick() }}
      >
        {/* Row 1: name + NUEVO badge */}
        <div className="flex items-start justify-between gap-1 mb-1">
          <p className="font-semibold text-[13px] text-gray-900 leading-tight line-clamp-2">{lead.name}</p>
          {lead.is_read === false && (
            <span className="shrink-0 text-[9px] font-black bg-red-500 text-white rounded px-1 py-0.5 leading-none mt-0.5">NUEVO</span>
          )}
        </div>

        {/* Concepto */}
        {lead.concept && (
          <div className="flex items-center gap-1 mb-1">
            <Wrench className="h-3 w-3 text-primary-500 shrink-0" />
            <span className="text-xs text-primary-600 font-medium truncate">{lead.concept}</span>
          </div>
        )}

        {/* Zona */}
        {(lead.zone || lead.address) && (
          <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.zone || lead.address}</span>
          </div>
        )}

        {/* Footer: estado presupuesto + importe + fecha */}
        <div className="flex items-center justify-between gap-1 mt-1.5 pt-1.5 border-t border-gray-100">
          <div className="flex items-center gap-1.5 min-w-0">
            {lead.budget_state && (
              <span title={BUDGET_STATE_META[lead.budget_state].label}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${BUDGET_STATE_META[lead.budget_state].color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${BUDGET_STATE_META[lead.budget_state].dot}`} />
                {BUDGET_STATE_META[lead.budget_state].label.split(' ')[0]}
              </span>
            )}
            {lead.budget_amount ? <span className="text-xs font-bold text-amber-600 shrink-0">{formatCurrency(lead.budget_amount)}</span> : null}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
            <Calendar className="h-3 w-3" />
            {formatRelativeTime(lead.created_at)}
          </div>
        </div>
      </div>

      {/* Botones mover columna (visibles siempre en mobile, al hover en desktop) */}
      <div className="absolute bottom-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 sm:opacity-100 sm:static sm:hidden transition-opacity">
        {prevCol && (
          <button
            onClick={(e) => { e.stopPropagation(); onMove(lead.id, prevCol.id) }}
            className="p-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
            title={`Mover a: ${prevCol.name}`}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
        {nextCol && (
          <button
            onClick={(e) => { e.stopPropagation(); onMove(lead.id, nextCol.id) }}
            className="p-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
            title={`Mover a: ${nextCol.name}`}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Kanban Column ────────────────────────────────────────────────────────────────
// - Ancho fijo 272px (flex-shrink:0)
// - Altura = 100% del contenedor padre (que ocupa toda la altura disponible)
// - Scroll vertical sólo en el área de tarjetas
function KanbanColumn({ column, columns, onLeadClick, onMove }: {
  column: BoardColumn
  columns: BoardColumn[]
  onLeadClick: (l: Lead) => void
  onMove: (leadId: string, toColumnId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div
      className="kanban-col flex flex-col rounded-xl border border-gray-200 bg-gray-50"
      style={{ flexShrink: 0, height: '100%' }}
    >
      {/* Cabecera fija */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 rounded-t-xl shrink-0"
        style={{ borderTopColor: column.color, borderTopWidth: 3 }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">{column.name}</span>
          <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-1.5 py-0.5 font-semibold leading-none">
            {column.leads?.length ?? 0}
          </span>
        </div>
      </div>

      {/* Zona de drop: ocupa el resto de la altura, scroll vertical */}
      <SortableContext
        items={(column.leads ?? []).map(l => l.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={`flex-1 overflow-y-auto p-2 space-y-2 rounded-b-xl transition-colors ${isOver ? 'bg-primary-50' : ''}`}
          style={{ minHeight: 80 }}
        >
          {(column.leads ?? []).map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              columns={columns}
              onClick={() => onLeadClick(lead)}
              onMove={onMove}
            />
          ))}
          {(column.leads ?? []).length === 0 && !isOver && (
            <div className="text-center py-8 text-gray-300 text-xs">Arrastra aquí</div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────────
interface NewLeadForm {
  name: string; company: string; concept: string; zone: string
  phone: string; email: string; source: string; notes: string
}
const EMPTY: NewLeadForm = { name: '', company: '', concept: '', zone: '', phone: '', email: '', source: 'form', notes: '' }

// "Trabajo a realizar" con el formato estándar a partir del análisis de la IA
function formatLeadSummary(a: import('@/lib/ai').LeadAnalysis): string {
  const t = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const fecha = `${p(t.getDate())}/${p(t.getMonth() + 1)}/${String(t.getFullYear()).slice(-2)}`
  return [
    `🔖 Referencia: ${a.phone}`,
    `FECHA: ${fecha}`,
    `🧑‍💼 Nombre del cliente: ${a.name}`,
    `📞 Teléfono: ${a.phone}`,
    `📍 Zona: ${a.zone}`,
    `🛠 Tipo de trabajo: ${a.work_type || a.concept}`,
    `📐 Medidas: ${a.measures || 'Pendiente de facilitar'}`,
    `📝 Descripción rápida: ${a.description}`,
    `📸 Fotos: ${a.photos ? 'Sí' : 'No'}`,
    `📌 Nota: ${a.note}`,
  ].join('\n')
}

// ── Gestionar listas ────────────────────────────────────────────────────────────────
const COLUMN_PALETTE = ['#6B7280', '#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#059669', '#0EA5E9', '#EC4899', '#84CC16']

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-6 h-6 rounded-full border border-gray-300"
        style={{ backgroundColor: value }}
        title="Cambiar color"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-7 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1.5 w-max">
            {COLUMN_PALETTE.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false) }}
                className="w-5 h-5 rounded-full hover:scale-110 transition-transform"
                style={{ backgroundColor: c, outline: value === c ? `2px solid ${c}` : undefined, outlineOffset: 1 }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface EditCol { id: string; name: string; color: string; leadCount: number; isNew?: boolean }

function ManageColumnsDialog({ open, onOpenChange, boardId, columns, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  boardId: string
  columns: BoardColumn[]
  onSaved: () => Promise<void> | void
}) {
  const [cols, setCols] = useState<EditCol[]>([])
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setCols(columns.map(c => ({ id: c.id, name: c.name, color: c.color, leadCount: c.leads?.length ?? 0 })))
      setDeletedIds([])
    }
  }, [open, columns])

  function update(id: string, patch: Partial<EditCol>) {
    setCols(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }
  function move(idx: number, dir: -1 | 1) {
    setCols(prev => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }
  function addCol() {
    setCols(prev => [...prev, {
      id: `new-${Date.now()}`, name: 'Nueva lista',
      color: COLUMN_PALETTE[prev.length % COLUMN_PALETTE.length], leadCount: 0, isNew: true,
    }])
  }
  function removeCol(col: EditCol) {
    if (col.leadCount > 0) return
    if (!col.isNew) setDeletedIds(prev => [...prev, col.id])
    setCols(prev => prev.filter(c => c.id !== col.id))
  }

  async function save() {
    if (cols.length === 0) { toast.error('Debe haber al menos una lista'); return }
    if (cols.some(c => !c.name.trim())) { toast.error('Las listas no pueden tener nombre vacío'); return }
    setSaving(true)
    try {
      for (const id of deletedIds) {
        await supabase.from('board_columns').delete().eq('id', id)
      }
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i]
        if (c.isNew) {
          await supabase.from('board_columns').insert({ board_id: boardId, name: c.name.trim(), color: c.color, position: i })
        } else {
          await supabase.from('board_columns').update({ name: c.name.trim(), color: c.color, position: i }).eq('id', c.id)
        }
      }
      toast.success('Listas actualizadas')
      await onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error('Error al guardar las listas')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Gestionar listas</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {cols.map((col, idx) => (
            <div key={col.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
              <div className="flex flex-col">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Subir">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => move(idx, 1)} disabled={idx === cols.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Bajar">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <ColorPicker value={col.color} onChange={c => update(col.id, { color: c })} />
              <Input value={col.name} onChange={e => update(col.id, { name: e.target.value })} className="h-8 text-sm flex-1" />
              <span className="text-[11px] text-gray-400 w-14 text-center shrink-0">{col.leadCount} lead{col.leadCount !== 1 ? 's' : ''}</span>
              <button
                onClick={() => removeCol(col)}
                disabled={col.leadCount > 0}
                title={col.leadCount > 0 ? 'Mueve los leads antes de eliminar' : 'Eliminar lista'}
                className="text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={addCol}>
            <Plus className="h-3.5 w-3.5" /> Añadir lista
          </Button>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              <Save className="h-4 w-4" />{saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────────
export function KanbanBoard() {
  const { id: boardId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organization, user } = useAuth()
  const { columns, loading, refetch } = useBoardColumns(boardId!)
  const [board, setBoard] = useState<Board | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [targetColumnId, setTargetColumnId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<NewLeadForm>(EMPTY)
  const [pasteText, setPasteText] = useState('')
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    if (!boardId) return
    supabase.from('boards').select('*').eq('id', boardId).maybeSingle().then(({ data }) => setBoard(data))
  }, [boardId])

  const allLeads = columns.flatMap(c => c.leads ?? [])
  const activeLead = activeId ? allLeads.find(l => l.id === activeId) : null

  function handleDragStart(e: DragStartEvent) { setActiveId(e.active.id as string) }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setActiveId(null)
    if (!over) return

    const activeLeadId = active.id as string
    const overId = over.id as string

    // Destino: puede ser una columna directamente o un lead (en cuya columna cae)
    const destCol =
      columns.find(c => c.id === overId) ??
      columns.find(c => c.leads?.some(l => l.id === overId))

    const srcCol = columns.find(c => c.leads?.some(l => l.id === activeLeadId))

    if (!destCol || !srcCol || srcCol.id === destCol.id) return

    await supabase.from('leads')
      .update({ column_id: destCol.id, updated_at: new Date().toISOString() })
      .eq('id', activeLeadId)

    toast.success(`Movido a "${destCol.name}"`)
    await refetch()
  }

  async function moveLeadToColumn(leadId: string, toColumnId: string) {
    const col = columns.find(c => c.id === toColumnId)
    await supabase.from('leads')
      .update({ column_id: toColumnId, updated_at: new Date().toISOString() })
      .eq('id', leadId)
    toast.success(`Movido a "${col?.name}"`)
    await refetch()
  }

  function openAdd(columnId: string) {
    setTargetColumnId(columnId)
    setForm(EMPTY)
    setPasteText('')
    setGeoStatus('idle')
    setLatLng(null)
    setAiStatus('idle')
    setDialog(true)
  }

  // Siempre crea en la primera columna (position 0, normalmente "Nuevo lead")
  function handleNewLead() {
    const first = columns[0]
    if (!first) { toast.error('Crea una lista primero'); return }
    openAdd(first.id)
  }

  async function saveName() {
    setEditingName(false)
    const name = nameInput.trim()
    if (!board || !name || name === board.name) return
    await supabase.from('boards').update({ name }).eq('id', board.id)
    setBoard({ ...board, name })
    toast.success('Tablero renombrado')
  }

  async function handleZoneBlur() {
    const text = (form.zone || '').trim()
    if (!text || geoStatus === 'loading') return
    setGeoStatus('loading')
    try {
      const { geocode } = await import('@/lib/geocode')
      const result = await geocode(text)
      if (result) {
        setLatLng({ lat: result.lat, lng: result.lng })
        setGeoStatus('ok')
      } else {
        setGeoStatus('fail')
      }
    } catch {
      setGeoStatus('fail')
    }
  }

  function handleSmartPaste() {
    const parsed = parsePastedText(pasteText)
    setForm(f => ({ ...f, ...parsed }))
    toast.success('Datos extraídos')
  }

  async function handleAISummary() {
    const rawText = pasteText.trim() ? pasteText : form.notes
    if (!rawText.trim()) { toast.error('Pega o escribe el mensaje del cliente primero'); return }
    setAiStatus('loading')
    try {
      const { analyzeLeadMessage } = await import('@/lib/ai')
      const a = await analyzeLeadMessage(rawText)
      // Rellenar campos (sin pisar lo ya escrito si la IA devuelve vacío)
      setForm(f => ({
        ...f,
        name:    a.name    || f.name,
        phone:   a.phone   || f.phone,
        email:   a.email   || f.email,
        zone:    a.zone    || f.zone,
        concept: a.concept || f.concept,
        notes:   formatLeadSummary(a),
      }))
      setAiStatus('done')
      toast.success('Campos rellenados con IA')
    } catch (err) {
      setAiStatus('idle')
      toast.error(err instanceof Error ? err.message : 'Error al analizar el mensaje')
      console.error(err)
    }
  }

  async function handleCreate() {
    if (!form.name.trim() || !targetColumnId || !boardId) return
    setSaving(true)
    try {
      // El nuevo lead va ARRIBA de su columna: posición = (mínima actual) - 1
      const { data: topLead } = await supabase.from('leads')
        .select('position').eq('column_id', targetColumnId).eq('is_archived', false)
        .not('position', 'is', null).order('position', { ascending: true }).limit(1).maybeSingle()
      const newPosition = topLead?.position != null ? topLead.position - 1 : 0

      const { data: newLead } = await supabase.from('leads').insert({
        board_id: boardId,
        org_id: organization!.id,
        column_id: targetColumnId,
        title: form.name,
        name: form.name,
        company: form.company || null,
        concept: form.concept || null,
        zone: form.zone || null,
        phone: form.phone || null,
        email: form.email || null,
        source: form.source,
        notes: form.notes || null,
        is_read: false,
        position: newPosition,
        lat: latLng?.lat ?? null,
        lng: latLng?.lng ?? null,
      }).select().single()

      // Registrar actividad de creación
      if (newLead) {
        await supabase.from('lead_activity').insert({
          lead_id: newLead.id,
          user_id: user!.id,
          action: 'created',
          metadata: { source: form.source },
        })
      }

      toast.success('Lead creado')
      setDialog(false)
      await refetch()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al crear lead')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    // Ocupa toda la altura de main (main tiene overflow:hidden + height:0 flex-1)
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Cabecera del tablero ─────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 shrink-0 bg-white border-b border-gray-200"
        style={{ padding: '12px 24px' }}
      >
        <Button variant="ghost" size="icon" onClick={() => navigate('/boards')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setEditingName(false)
              }}
              className="text-base font-bold text-gray-900 border-b-2 border-primary-400 outline-none bg-transparent w-full max-w-sm"
            />
          ) : (
            <h1
              className="text-base font-bold text-gray-900 truncate cursor-pointer hover:text-primary-600 transition-colors inline-block max-w-full"
              title="Click para renombrar"
              onClick={() => { setNameInput(board?.name ?? ''); setEditingName(true) }}
            >
              {board?.name ?? 'Tablero'}
            </h1>
          )}
          <p className="text-xs text-gray-400">
            {allLeads.length} lead{allLeads.length !== 1 ? 's' : ''} · {columns.length} columnas
          </p>
        </div>

        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setImportOpen(true)}>
          <Download className="h-4 w-4" /> Importar de Trello
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setManageOpen(true)}>
          <Settings2 className="h-4 w-4" /> Gestionar listas
        </Button>
        <Button size="sm" className="gap-1.5 shrink-0 bg-primary-600 hover:bg-primary-700" onClick={handleNewLead}>
          <Plus className="h-4 w-4" /> Nuevo lead
        </Button>
        <Button variant="ghost" size="icon" className="shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50" title="Eliminar tablero" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Área Kanban: scroll horizontal, columnas con scroll vertical ─── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/*
          overflow-x: auto → scroll horizontal del tablero (como Trello)
          overflow-y: hidden → sin scroll vertical aquí (cada columna tiene el suyo)
          flex: 1 → ocupa toda la altura restante
          Se añade padding para dejar margen visual
        */}
        <div
          style={{
            flex: '1 1 0%',
            overflowX: 'auto',
            overflowY: 'hidden',
            display: 'flex',
            alignItems: 'stretch',   // columnas estiran a la altura completa
            gap: 12,
            padding: '16px 24px 16px 24px',
            scrollBehavior: 'smooth',
            WebkitOverflowScrolling: 'touch',  // scroll suave en iOS
          }}
        >
          {columns.map(col => (
            <KanbanColumn
              key={col.id}
              column={col}
              columns={columns}
              onLeadClick={lead => navigate(`/leads/${lead.id}`)}
              onMove={moveLeadToColumn}
            />
          ))}
          {/* Espacio final para que la última columna no quede pegada al borde */}
          <div style={{ width: 8, flexShrink: 0 }} />
        </div>

        <DragOverlay>
          {activeLead && (
            <div className="bg-white rounded-lg border border-primary-300 shadow-2xl p-3 rotate-1" style={{ width: 272 }}>
              <p className="font-semibold text-sm text-gray-900">{activeLead.name}</p>
              {activeLead.concept && (
                <p className="text-xs text-primary-600 mt-0.5">{activeLead.concept}</p>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Dialog gestionar listas */}
      <ManageColumnsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        boardId={boardId!}
        columns={columns}
        onSaved={refetch}
      />

      {/* Dialog importar de Trello */}
      <ImportTrello
        open={importOpen}
        onOpenChange={setImportOpen}
        boardId={boardId!}
        existingColumnsCount={columns.length}
        onImported={refetch}
      />

      {/* Dialog eliminar tablero */}
      <DeleteBoardDialog
        board={board ? { id: board.id, name: board.name } : null}
        leadCount={allLeads.length}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => navigate('/boards')}
      />

      {/* Dialog nuevo lead */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuevo Lead</DialogTitle></DialogHeader>

          <div className="space-y-4">
            {/* Smart paste */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                <ClipboardPaste className="h-3.5 w-3.5" />
                Pegar mensaje del cliente
              </p>
              <Textarea
                rows={3}
                placeholder="Pega aquí un WhatsApp, email… y pulsa Extraer"
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                className="text-xs resize-none"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleSmartPaste} disabled={!pasteText.trim()} className="flex-1">
                  Extraer campos
                </Button>
                <Button size="sm" variant="outline" onClick={handleAISummary} disabled={aiStatus === 'loading'} className="flex-1">
                  {aiStatus === 'loading' ? 'Analizando…' : aiStatus === 'done' ? '✅ Campos rellenados' : '✨ Resumir con IA'}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input placeholder="Juan García" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Empresa</Label>
                <Input placeholder="Reformas S.L." value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Concepto del trabajo</Label>
              <Input placeholder="Reforma baño, Cargador eléctrico…" value={form.concept} onChange={e => setForm(f => ({ ...f, concept: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input placeholder="600 000 000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Zona / Ciudad</Label>
                <Input
                  placeholder="Madrid, León…"
                  value={form.zone}
                  onChange={e => { setForm(f => ({ ...f, zone: e.target.value })); setGeoStatus('idle'); setLatLng(null) }}
                  onBlur={handleZoneBlur}
                />
                {geoStatus === 'loading' && (
                  <p className="text-[11px] text-gray-400 flex items-center gap-1">
                    <span className="animate-spin inline-block">⏳</span> Geolocalizando…
                  </p>
                )}
                {geoStatus === 'ok' && (
                  <p className="text-[11px] text-green-600 flex items-center gap-1">📍 Ubicación detectada</p>
                )}
                {geoStatus === 'fail' && (
                  <p className="text-[11px] text-amber-500 flex items-center gap-1">⚠️ No se pudo geolocalizar</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="juan@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Origen</Label>
                <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="form">Formulario</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="call">Llamada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Trabajo a realizar</Label>
              <Textarea
                rows={3}
                placeholder="Descripción del trabajo: qué quiere el cliente, dimensiones, urgencia…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving || !form.name.trim()}>
                {saving ? 'Guardando…' : 'Crear lead'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
