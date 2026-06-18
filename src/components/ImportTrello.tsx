import { useState, type ElementType } from 'react'
import { Upload, FileJson, CheckCircle2, AlertCircle, Loader2, Columns3, CreditCard, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// ── Estructura del export JSON de Trello (solo lo que usamos) ───────────────────
interface TrelloLabel { id: string; name: string; color: string }
interface TrelloList { id: string; name: string; closed: boolean; pos: number }
interface TrelloCard {
  id: string; name: string; desc: string; idList: string
  pos?: number               // orden vertical de la tarjeta dentro de su lista
  due: string | null; closed: boolean; labels?: TrelloLabel[]
}
interface TrelloCheckItem { name: string; state: string }
interface TrelloChecklist { id: string; idCard: string; name: string; checkItems: TrelloCheckItem[] }
interface TrelloExport {
  name?: string
  lists?: TrelloList[]
  cards?: TrelloCard[]
  checklists?: TrelloChecklist[]
}

interface Parsed {
  boardName: string
  lists: TrelloList[]            // ordenadas, sin archivadas
  cards: TrelloCard[]           // sin archivadas y con lista válida
  checklistsByCard: Record<string, TrelloChecklist[]>
  checklistTotal: number
}

const COLUMN_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']

function parseTrello(raw: unknown): Parsed {
  const data = raw as TrelloExport
  const lists = (data.lists ?? [])
    .filter(l => !l.closed)
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
  const listIds = new Set(lists.map(l => l.id))
  const cards = (data.cards ?? []).filter(c => !c.closed && listIds.has(c.idList))

  const checklistsByCard: Record<string, TrelloChecklist[]> = {}
  let checklistTotal = 0
  for (const cl of data.checklists ?? []) {
    if (!cl.idCard) continue
    ;(checklistsByCard[cl.idCard] ??= []).push(cl)
    checklistTotal++
  }
  return { boardName: data.name ?? 'Tablero de Trello', lists, cards, checklistsByCard, checklistTotal }
}

// Extrae el valor de un campo etiquetado de la descripción (p. ej. "Teléfono: ...")
function field(desc: string, label: RegExp): string | null {
  const m = desc.match(label)
  return m ? m[1].trim() : null
}

// Datos estructurados que intentamos sacar de la tarjeta (formato habitual de captación)
interface CardMeta {
  phone: string | null
  zone: string | null
  concept: string | null
  createdAt: string | null
}
function parseCardMeta(card: TrelloCard): CardMeta {
  const desc = card.desc ?? ''
  const hay = `${card.name}\n${desc}`

  // Teléfono: por etiqueta, y si no, primer número de teléfono que aparezca
  let phone = field(desc, /Tel[eé]fono:\s*([^\n\r]+)/i)
  if (phone) phone = phone.replace(/\(.*$/, '').trim()
  if (!phone) {
    const m = hay.match(/(\+?\d[\d\s]{7,}\d)/)
    phone = m ? m[1].trim() : null
  }

  const zoneRaw = field(desc, /Zona:\s*([^\n\r]+)/i)
  const zone = zoneRaw && zoneRaw !== '—' ? zoneRaw : null
  const concept = field(desc, /Tipo de trabajo:\s*([^\n\r]+)/i)

  // Fecha real del lead: "FECHA: dd/mm/aa" → ISO; si no, el vencimiento de Trello
  let createdAt: string | null = null
  const fm = desc.match(/FECHA:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i)
  if (fm) {
    const [, dd, mm, yy] = fm
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10)
    const d = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10), 12, 0, 0)
    if (!isNaN(d.getTime())) createdAt = d.toISOString()
  } else if (card.due) {
    const d = new Date(card.due)
    if (!isNaN(d.getTime())) createdAt = d.toISOString()
  }

  return { phone, zone, concept, createdAt }
}

// Notas del lead: descripción (sin la línea de FECHA) + etiquetas de Trello
function buildNotes(card: TrelloCard): string | null {
  const parts: string[] = []
  const desc = (card.desc ?? '').replace(/FECHA:[^\n\r]*\r?\n?/gi, '').trim()
  if (desc) parts.push(desc)
  const labels = (card.labels ?? []).map(l => l.name?.trim() || l.color).filter(Boolean)
  if (labels.length) parts.push('🏷️ Etiquetas: ' + labels.join(', '))
  return parts.length ? parts.join('\n\n') : null
}

// Comentario del lead a partir de un checklist de Trello
function formatChecklist(cl: TrelloChecklist): string {
  const header = '✅ ' + (cl.name?.trim() || 'Checklist')
  const items = (cl.checkItems ?? [])
    .map(it => (it.state === 'complete' ? '☑' : '☐') + ' ' + it.name)
    .join('\n')
  return items ? `${header}\n${items}` : header
}

interface Progress { phase: 'columns' | 'leads'; done: number; total: number }
interface Result { columns: number; leads: number; comments: number; errors: number }

export function ImportTrello({
  open, onOpenChange, boardId, existingColumnsCount, onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  boardId: string
  existingColumnsCount: number
  onImported: () => void | Promise<void>
}) {
  const { organization, user } = useAuth()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function reset() {
    setParsed(null); setFileName(''); setImporting(false); setProgress(null); setResult(null)
  }

  function handleClose(v: boolean) {
    if (importing) return            // no cerrar a mitad de importación
    if (!v) reset()
    onOpenChange(v)
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const p = parseTrello(json)
      if (p.lists.length === 0 && p.cards.length === 0) {
        toast.error('El archivo no parece un export de Trello válido (sin listas ni tarjetas).')
        return
      }
      setParsed(p)
      setFileName(file.name)
      setResult(null)
    } catch {
      toast.error('No se pudo leer el JSON. ¿Es el archivo exportado de Trello?')
    }
  }

  async function handleImport() {
    if (!parsed || !organization || !user) return
    setImporting(true)
    setResult(null)
    let errors = 0

    // 1) Listas → columnas (al final de las existentes)
    setProgress({ phase: 'columns', done: 0, total: parsed.lists.length })
    const colMap: Record<string, string> = {}
    for (let i = 0; i < parsed.lists.length; i++) {
      const list = parsed.lists[i]
      const { data, error } = await supabase.from('board_columns').insert({
        board_id: boardId,
        name: list.name?.trim() || 'Sin nombre',
        color: COLUMN_COLORS[i % COLUMN_COLORS.length],
        position: existingColumnsCount + i,
      }).select('id').single()
      if (error || !data) { errors++ } else { colMap[list.id] = data.id }
      setProgress({ phase: 'columns', done: i + 1, total: parsed.lists.length })
    }

    // 2) Tarjetas → leads (+ checklists → comentarios)
    const cards = parsed.cards.filter(c => colMap[c.idList])
    // Orden EXACTO de Trello: dentro de cada lista, ordenar por pos y numerar 0,1,2…
    const posByCard: Record<string, number> = {}
    const byList: Record<string, TrelloCard[]> = {}
    for (const c of cards) (byList[c.idList] ??= []).push(c)
    for (const lst of Object.keys(byList)) {
      byList[lst].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).forEach((c, idx) => { posByCard[c.id] = idx })
    }
    setProgress({ phase: 'leads', done: 0, total: cards.length })
    let leadsCreated = 0
    let commentsCreated = 0
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]
      const title = card.name?.trim() || '(sin título)'
      const meta = parseCardMeta(card)
      const { data: lead, error } = await supabase.from('leads').insert({
        board_id: boardId,
        org_id: organization.id,
        column_id: colMap[card.idList],
        title,
        name: title,
        phone: meta.phone,
        zone: meta.zone,
        concept: meta.concept,
        notes: buildNotes(card),
        source: 'form',
        is_read: true,
        position: posByCard[card.id] ?? i,
        ...(meta.createdAt ? { created_at: meta.createdAt } : {}),
      }).select('id').single()

      if (error || !lead) {
        errors++
      } else {
        leadsCreated++
        for (const cl of parsed.checklistsByCard[card.id] ?? []) {
          const { error: cErr } = await supabase.from('lead_comments').insert({
            lead_id: lead.id, user_id: user.id, content: formatChecklist(cl),
          })
          if (cErr) errors++; else commentsCreated++
        }
      }
      setProgress({ phase: 'leads', done: i + 1, total: cards.length })
    }

    setImporting(false)
    setProgress(null)
    setResult({ columns: Object.keys(colMap).length, leads: leadsCreated, comments: commentsCreated, errors })
    await onImported()
    toast.success('Importación de Trello completada')
  }

  // Reordena los leads YA importados según el orden exacto de Trello (pos ascendente),
  // cruzándolos por teléfono. No crea ni borra nada: solo actualiza `position`.
  async function reorderExisting() {
    if (!parsed || !organization) return
    setImporting(true)
    setResult(null)

    const { data: leads } = await supabase.from('leads')
      .select('id, phone').eq('board_id', boardId).eq('is_archived', false)
    const byPhone: Record<string, string> = {}
    for (const l of leads ?? []) {
      const d = (l.phone ?? '').replace(/\D/g, '')
      if (d.length >= 9) byPhone[d.slice(-9)] = l.id   // últimos 9 dígitos como clave
    }

    // Dentro de cada lista, orden por pos ascendente → posición 0,1,2…
    const byList: Record<string, TrelloCard[]> = {}
    for (const c of parsed.cards) (byList[c.idList] ??= []).push(c)
    const updates: { id: string; pos: number }[] = []
    let notFound = 0
    for (const lst of Object.keys(byList)) {
      byList[lst].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).forEach((card, idx) => {
        const d = (parseCardMeta(card).phone ?? '').replace(/\D/g, '')
        const leadId = d.length >= 9 ? byPhone[d.slice(-9)] : undefined
        if (leadId) updates.push({ id: leadId, pos: idx })
        else notFound++
      })
    }

    setProgress({ phase: 'leads', done: 0, total: updates.length })
    let done = 0
    for (let i = 0; i < updates.length; i++) {
      const { error } = await supabase.from('leads').update({ position: updates[i].pos }).eq('id', updates[i].id)
      if (!error) done++
      setProgress({ phase: 'leads', done: i + 1, total: updates.length })
    }

    setImporting(false)
    setProgress(null)
    setResult({ columns: 0, leads: done, comments: 0, errors: notFound })
    await onImported()
    toast.success(`${done} leads reordenados según Trello${notFound ? ` · ${notFound} sin coincidencia` : ''}`)
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-primary-600" />Importar desde Trello
          </DialogTitle>
        </DialogHeader>

        {/* Resultado final */}
        {result ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center py-2">
              <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" />
              <p className="font-semibold text-gray-800">¡Importación completada!</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <ResultStat icon={Columns3} value={result.columns} label="Columnas" />
              <ResultStat icon={CreditCard} value={result.leads} label="Leads" />
              <ResultStat icon={ListChecks} value={result.comments} label="Comentarios" />
            </div>
            {result.errors > 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5 justify-center">
                <AlertCircle className="h-3.5 w-3.5" />{result.errors} elemento(s) no se pudieron importar
              </p>
            )}
            <Button className="w-full" onClick={() => handleClose(false)}>Listo</Button>
          </div>
        ) : importing ? (
          /* Progreso */
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
              {progress?.phase === 'columns' ? 'Creando columnas…' : 'Importando leads…'}
              {progress && <span className="text-gray-400">({progress.done}/{progress.total})</span>}
            </p>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-gray-400 text-center">No cierres esta ventana hasta que termine.</p>
          </div>
        ) : parsed ? (
          /* Preview */
          <div className="space-y-4">
            <p className="text-xs text-gray-500 truncate">Archivo: <span className="font-medium text-gray-700">{fileName}</span></p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <ResultStat icon={Columns3} value={parsed.lists.length} label="Listas" />
              <ResultStat icon={CreditCard} value={parsed.cards.length} label="Tarjetas" />
              <ResultStat icon={ListChecks} value={parsed.checklistTotal} label="Checklists" />
            </div>
            <p className="text-xs text-gray-500 bg-slate-50 rounded-lg p-3 leading-relaxed">
              Se crearán <strong>{parsed.lists.length}</strong> columnas nuevas en este tablero y se añadirán{' '}
              <strong>{parsed.cards.length}</strong> leads. Las descripciones, etiquetas y vencimientos van en las notas;
              los checklists se añaden como comentarios. <span className="text-gray-400">No se modifica nada de lo ya existente.</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>Otro archivo</Button>
              <Button className="flex-1 gap-1.5" onClick={handleImport}>
                <Upload className="h-4 w-4" />Importar
              </Button>
            </div>
            <div className="border-t border-gray-100 pt-3">
              <Button variant="outline" className="w-full gap-1.5 text-xs" onClick={reorderExisting}>
                <ListChecks className="h-3.5 w-3.5" />Solo reordenar leads existentes (por teléfono)
              </Button>
              <p className="text-[11px] text-gray-400 mt-1 text-center">
                Si ya los importaste antes: ordena los leads de este tablero con el orden exacto de Trello, sin crear duplicados.
              </p>
            </div>
          </div>
        ) : (
          /* Selector de archivo */
          <div className="space-y-3">
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 cursor-pointer hover:border-primary-400 text-gray-500 hover:text-primary-600 transition-colors">
              <input
                type="file" accept=".json,application/json" className="hidden"
                onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }}
              />
              <Upload className="h-7 w-7" />
              <span className="text-sm font-medium">Selecciona tu archivo trello-export.json</span>
              <span className="text-xs text-gray-400">Trello → Menú → Más opciones → Imprimir y exportar → JSON</span>
            </label>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResultStat({ icon: Icon, value, label }: { icon: ElementType; value: number; label: string }) {
  return (
    <div className="bg-slate-50 rounded-lg py-3">
      <Icon className="h-4 w-4 text-primary-600 mx-auto mb-1" />
      <p className="text-lg font-bold text-gray-900 leading-none">{value}</p>
      <p className="text-[11px] text-gray-400 mt-1">{label}</p>
    </div>
  )
}
