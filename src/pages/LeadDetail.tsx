import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MapPin, Edit2, Upload, Paperclip,
  MessageSquare, Activity, User, DollarSign, CheckCircle, Clock,
  Trash2, Wrench, Building2, MessageCircle, ChevronRight, Calendar,
  AlertCircle, Share2, Link, Copy, Check, Trash,
  CalendarPlus, Home, PhoneCall, RefreshCw, ClipboardList, FileText, Download, Sparkles, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useLead } from '@/hooks/useLeads'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  formatCurrency, formatDate, formatDateTime, formatRelativeTime,
  getInitials, sourceLabel, calculateCommission, toLocalInput, toUTCIso,
} from '@/lib/utils'
import { exportBudgetPdf, exportBudgetComparison, type PdfOrgInfo } from '@/lib/budgetPdf'
import { uploadBudgetPdf, buildWhatsAppUrl } from '@/lib/budgetShare'
import { BudgetWizard, emptyDraft, type Draft } from './Budgets'
import type { BoardColumn, CalendarEvent, EventType, LeadComment, LeadActivity, LeadFile, Professional, Budget } from '@/types'

const BUDGET_STATUS: Record<string, { label: string; color: string }> = {
  draft:    { label: 'Borrador', color: 'bg-gray-100 text-gray-600' },
  sent:     { label: 'Enviado',  color: 'bg-blue-100 text-blue-700' },
  accepted: { label: 'Aceptado', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rechazado',color: 'bg-red-100 text-red-700' },
}

// Limpia prefijos "Nombre:", "Cliente:" del smart paste
function cleanName(n: string | null | undefined): string {
  if (!n) return ''
  return n.replace(/^(?:nombre|cliente|contacto|name)\s*:\s*/i, '').trim()
}

function toWhatsApp(phone: string): string {
  const d = phone.replace(/\D/g, '')
  return d.startsWith('34') ? `https://wa.me/${d}` : `https://wa.me/34${d}`
}

// Redimensiona una imagen (blob) a máx. 1024px y la devuelve como JPEG base64 para la IA
function blobToResizedImage(blob: Blob): Promise<{ dataUrl: string; mime: string; data: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const max = 1024
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); resolve(null); return }
      ctx.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      URL.revokeObjectURL(url)
      resolve({ dataUrl, mime: 'image/jpeg', data: dataUrl.split(',')[1] })
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

// ── Presupuestos en la ficha: fila simple y grupo de opciones con pestañas ──────
type BudgetRowHandlers = {
  onWhatsApp: (b: Budget) => void
  onExport: (b: Budget) => void
  onOpen: (b: Budget) => void
  onDelete: (b: Budget) => void
}

// Badge de estado: "Validado" (por el profesional) tiene prioridad sobre el estado
function BudgetStatusBadge({ b }: { b: Budget }) {
  if (b.validated_at) {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 bg-green-100 text-green-700 flex items-center gap-0.5"><Check className="h-2.5 w-2.5" />Validado</span>
  }
  const st = BUDGET_STATUS[b.status] ?? BUDGET_STATUS.draft
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
}

// Agrupa los presupuestos por group_id (conservando el orden); los sueltos van solos.
function groupLeadBudgets(budgets: Budget[]): Budget[][] {
  const seen = new Set<string>()
  const out: Budget[][] = []
  for (const b of budgets) {
    if (b.group_id) {
      if (seen.has(b.group_id)) continue
      seen.add(b.group_id)
      out.push(budgets.filter(x => x.group_id === b.group_id))
    } else out.push([b])
  }
  return out
}

function optionTabLabel(b: Budget, i: number): string {
  const m = (b.concept || '').match(/(opci[oó]n|alternativa|variante)\s*[\wáéíó]+$/i)
  return m ? m[0] : `Opción ${i + 1}`
}

function BudgetActions({ b, onWhatsApp, onExport, onOpen, onDelete }: { b: Budget } & BudgetRowHandlers) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={() => onWhatsApp(b)} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-500" title="Enviar por WhatsApp"><MessageCircle className="h-3.5 w-3.5" /></button>
      <button onClick={() => onExport(b)} className="p-1.5 rounded hover:bg-blue-50 text-blue-500" title="Exportar PDF"><Download className="h-3.5 w-3.5" /></button>
      <button onClick={() => onDelete(b)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Borrar"><Trash2 className="h-3.5 w-3.5" /></button>
      <button onClick={() => onOpen(b)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400" title="Abrir en Presupuestos"><ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  )
}

function SingleBudgetRow({ b, ...h }: { b: Budget } & BudgetRowHandlers) {
  return (
    <div className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5">
      <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0"><FileText className="h-4 w-4 text-primary-600" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{b.concept || 'Presupuesto'}</p>
        <p className="text-xs text-gray-400">{formatDate(b.created_at)} · {b.lines?.length ?? 0} líneas</p>
      </div>
      <span className="font-semibold text-gray-900 text-sm shrink-0">{formatCurrency(b.total)}</span>
      <BudgetStatusBadge b={b} />
      <BudgetActions b={b} {...h} />
    </div>
  )
}

// Grupo de opciones: pestañas Opción 1/2/3; el total mostrado es SOLO el de la activa.
function BudgetOptionsGroup({ budgets, onCompare, ...h }: { budgets: Budget[]; onCompare: () => void } & BudgetRowHandlers) {
  const [active, setActive] = useState(0)
  const b = budgets[active] ?? budgets[0]
  const base = (budgets[0].concept || 'Presupuesto').replace(/\s*[-–]\s*(opci[oó]n|alternativa|variante).*$/i, '').trim()
  return (
    <div className="border border-primary-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-primary-50/60 px-3 py-2 border-b border-primary-100">
        <p className="text-sm font-semibold text-gray-800 truncate flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-primary-600" />{base} · {budgets.length} opciones</p>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" onClick={onCompare}><Download className="h-3.5 w-3.5" />Exportar comparativa</Button>
      </div>
      <div className="flex gap-1 px-3 pt-2 flex-wrap">
        {budgets.map((opt, i) => (
          <button key={opt.id} onClick={() => setActive(i)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${i === active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {optionTabLabel(opt, i)} · {formatCurrency(opt.total)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800 truncate">{b.concept || 'Presupuesto'}</p>
          <p className="text-xs text-gray-400">{formatDate(b.created_at)} · {b.lines?.length ?? 0} líneas</p>
        </div>
        <span className="font-bold text-primary-700 text-sm shrink-0">{formatCurrency(b.total)}</span>
        <BudgetStatusBadge b={b} />
        <BudgetActions b={b} {...h} />
      </div>
    </div>
  )
}

// ── Helpers de parsing de PDF ────────────────────────────────────────────────

// Devuelve true si el string parece un teléfono español
function isPhoneNumber(s: string): boolean {
  const digits = s.replace(/[\s.\-()]/g, '')
  // 9 dígitos seguidos empezando por 6,7,8,9 (móvil/fijo España)
  if (/^[6789]\d{8}$/.test(digits)) return true
  // Más de 8 dígitos sin separadores → probablemente teléfono/código
  if (/^\d{9,}$/.test(digits)) return true
  return false
}

// Convierte string monetario a float. Solo acepta formatos CON 2 decimales.
// Acepta: "2050,00"  "4.697,00"  "4697.00"  "4,697.00"  "2050,00 €"
// Rechaza: "2050"  "614009166"  (sin decimales o teléfonos)
function parseMonetaryAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s*[€$]\s*/g, '').trim()

  // OBLIGATORIO: debe tener exactamente 2 decimales después de coma o punto
  if (!/[.,]\d{2}$/.test(s)) return null

  let n: number
  // "4.697,00" → miles con punto, decimales con coma
  if (/^\d{1,3}(\.\d{3})+(,\d{2})$/.test(s)) {
    n = parseFloat(s.replace(/\./g, '').replace(',', '.'))
  // "4,697.00" → miles con coma, decimales con punto
  } else if (/^\d{1,3}(,\d{3})+(\.\d{2})$/.test(s)) {
    n = parseFloat(s.replace(/,/g, ''))
  // "2050,00" o "2050.00" → sin separador de miles
  } else if (/^\d{1,7}[,.]\d{2}$/.test(s)) {
    n = parseFloat(s.replace(',', '.'))
  } else {
    return null
  }

  if (isNaN(n) || n <= 0 || n > 10_000_000) return null

  // Rechazar si el número sin decimales parece teléfono
  const intPart = String(Math.floor(n))
  if (isPhoneNumber(intPart)) return null

  return Math.round(n * 100) / 100
}

// Busca un importe monetario en una línea de texto.
// Requiere que "€" o "EUR" estén en la misma línea (máx 30 chars de distancia).
function extractAmountFromLine(line: string): number | null {
  // El importe debe ir seguido (o precedido en ≤30 chars) de € o EUR
  const withCurrency = [
    ...line.matchAll(/(\d[\d.,]{1,12})\s{0,5}(?:€|EUR)\b/gi),
    ...line.matchAll(/(?:€|EUR)\s{0,5}(\d[\d.,]{1,12})/gi),
  ]
  for (const m of withCurrency) {
    const v = parseMonetaryAmount(m[1])
    if (v !== null) return v
  }
  return null
}

// Extrae la base imponible (sin IVA) del texto completo de un PDF de presupuesto
function parseBudgetFromText(text: string): number | null {
  // Dividir en líneas para analizar por línea (más preciso que texto continuo)
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean)
  // También versión plana para búsquedas generales
  const flat = text.replace(/\s+/g, ' ')

  // ── PRIORIDAD 1: líneas con etiqueta explícita de base sin IVA ────────────
  const p1Labels = [
    /subtotal/i,
    /total\s+parcial/i,
    /base\s+imponible/i,
    /importe\s+(?:sin\s+iva|neto)/i,
    /total\s+sin\s+iva/i,
  ]
  for (const label of p1Labels) {
    for (const line of lines) {
      if (label.test(line)) {
        const v = extractAmountFromLine(line)
        if (v !== null) return v
      }
    }
  }

  // ── PRIORIDAD 2: "TOTAL EUR" o "TOTAL EUR X,XX €" ─────────────────────────
  for (const line of lines) {
    if (/total\s+eur\b/i.test(line)) {
      const v = extractAmountFromLine(line)
      if (v !== null) return v
    }
  }

  // ── PRIORIDAD 3: IVA 0% presente → el TOTAL es la base ───────────────────
  const hasIva0 = lines.some(l => /(?:iva|impuesto)\s*[\(:]?\s*0\s*%/i.test(l))
  if (hasIva0) {
    for (const line of lines) {
      if (/\btotal\b/i.test(line) && !/iva/i.test(line)) {
        const v = extractAmountFromLine(line)
        if (v !== null) return v
      }
    }
  }

  // ── PRIORIDAD 4: IVA con porcentaje conocido → base = TOTAL - IVA_amount ──
  const ivaLine = lines.find(l => /\biva\s+\d+\s*%/i.test(l))
  if (ivaLine) {
    const pctMatch = ivaLine.match(/iva\s+(\d+)\s*%/i)
    const ivaAmount = extractAmountFromLine(ivaLine)
    if (pctMatch && ivaAmount) {
      const pct = parseInt(pctMatch[1]) / 100
      if (pct > 0) {
        // Buscar el TOTAL en las líneas (sin IVA en la misma línea)
        const totalLine = lines.find(l => /\btotal\b/i.test(l) && !/iva/i.test(l))
        const total = totalLine ? extractAmountFromLine(totalLine) : null
        if (total) return Math.round((total - ivaAmount) * 100) / 100
        // Fallback: base = ivaAmount / pct
        return Math.round((ivaAmount / pct) * 100) / 100
      }
    }
  }

  // ── PRIORIDAD 5: línea con TOTAL (sin IVA en la misma línea) ─────────────
  for (const line of lines) {
    if (/\btotal\b/i.test(line) && !/iva/i.test(line)) {
      const v = extractAmountFromLine(line)
      if (v !== null) return v
    }
  }

  // ── FALLBACK: mayor importe con € que aparezca ≥ 2 veces ─────────────────
  const allAmounts = lines
    .flatMap(line => [...line.matchAll(/(\d[\d.,]{1,12})\s{0,5}(?:€|EUR)/gi)])
    .map(m => parseMonetaryAmount(m[1]))
    .filter((v): v is number => v !== null)

  const freq = new Map<number, number>()
  for (const n of allAmounts) freq.set(n, (freq.get(n) ?? 0) + 1)
  const candidates = [...freq.entries()].filter(([, c]) => c >= 2).map(([v]) => v)
  if (candidates.length > 0) return Math.max(...candidates)

  return null
}

// Tipos de los joins que Supabase devuelve
type JoinedBoard   = { id: string; name: string; color: string }
type JoinedColumn  = { id: string; name: string; color: string; position: number }
type JoinedPro     = { id: string; name: string; specialty: string | null; phone: string | null; email: string | null }

export function LeadDetail() {
  const { id } = useParams<{ id: string }>()
  const { lead, loading, loadError, refetch } = useLead(id ?? '')
  const { user, organization } = useAuth()
  const navigate = useNavigate()

  // Form completo (dialog edición)
  const [editOpen, setEditOpen]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [form, setForm] = useState({
    name: '', company: '', concept: '', zone: '',
    phone: '', email: '', address: '', notes: '', ai_summary: '',
    source: 'form', budget_amount: '', commission_paid: false, assigned_to: '',
  })

  // Datos relacionados
  const [comments,     setComments]     = useState<LeadComment[]>([])
  const [activities,   setActivities]   = useState<LeadActivity[]>([])
  const [files,        setFiles]        = useState<LeadFile[]>([])
  const [professionals,setProfessionals] = useState<Professional[]>([])
  const [leadBudgets,  setLeadBudgets]   = useState<Budget[]>([])
  const [budgetWizard, setBudgetWizard]  = useState<Draft | null>(null)
  const [preparingBudget, setPreparingBudget] = useState(false)
  const [columns,      setColumns]      = useState<BoardColumn[]>([])
  const [newComment,   setNewComment]   = useState('')
  const [uploading,    setUploading]    = useState(false)
  const [leadEvents,    setLeadEvents]    = useState<CalendarEvent[]>([])
  const [eventDialog,   setEventDialog]   = useState(false)
  const [savingEvent,   setSavingEvent]   = useState(false)
  const [eventForm, setEventForm] = useState({
    type: 'visita_presencial' as EventType,
    title: '',
    start_at: '',
    end_at: '',
    description: '',
  })
  const [editingEvent,  setEditingEvent]  = useState<CalendarEvent | null>(null)
  const [savingEditEv,  setSavingEditEv]  = useState(false)
  const [editEventForm, setEditEventForm] = useState({
    title: '', type: 'visita_presencial' as EventType,
    start_at: '', end_at: '', description: '',
  })
  const [confirmDeleteEvId, setConfirmDeleteEvId] = useState<string | null>(null)
  const [extracting,   setExtracting]   = useState(false)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const pdfInputRef    = useRef<HTMLInputElement>(null)

  // Enlace público
  const [publicToken,    setPublicToken]   = useState<string | null>(null)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [linkCopied,     setLinkCopied]    = useState(false)

  // Acciones rápidas
  const [qProfessional, setQProfessional] = useState('')
  const [qColumn,       setQColumn]       = useState('')
  const [qBudget,       setQBudget]       = useState('')
  const [savingQ,       setSavingQ]       = useState<string | null>(null)

  // Cuando carga el lead, inicializar todo
  useEffect(() => {
    if (!lead) return
    const name = cleanName(lead.name)
    setForm({
      name,
      company:          (lead.company         ?? ''),
      concept:          (lead.concept         ?? ''),
      zone:             (lead.zone            ?? ''),
      phone:            (lead.phone           ?? ''),
      email:            (lead.email           ?? ''),
      address:          (lead.address         ?? ''),
      notes:            (lead.notes           ?? ''),
      ai_summary:       (lead.ai_summary      ?? ''),
      source:           (lead.source          ?? 'form'),
      budget_amount:    lead.budget_amount != null ? String(lead.budget_amount) : '',
      commission_paid:  (lead.commission_paid ?? false),
      assigned_to:      (lead.assigned_to     ?? ''),
    })
    setQProfessional(lead.assigned_to ?? 'none')
    setQColumn(lead.column_id ?? '')
    setPublicToken(lead.public_token ?? null)
    setQBudget(lead.budget_amount != null ? String(lead.budget_amount) : '')

    if (lead.is_read === false) {
      supabase.from('leads').update({ is_read: true }).eq('id', lead.id).then(() => {})
    }

    loadRelated()
  }, [lead?.id])   // eslint-disable-line

  // Columnas del tablero para el selector de estado
  useEffect(() => {
    const boardId = lead?.board_id
    if (!boardId) return
    supabase.from('board_columns').select('*').eq('board_id', boardId).order('position')
      .then(({ data }) => setColumns(data ?? []))
  }, [lead?.board_id])

  // Profesionales de la org
  useEffect(() => {
    if (!organization?.id) return
    supabase.from('professionals').select('*').eq('org_id', organization.id).eq('is_active', true)
      .then(({ data }) => setProfessionals(data ?? []))
  }, [organization?.id])

  async function loadRelated() {
    if (!id) return
    try {
      const [{ data: c }, { data: a }, { data: f }, { data: ev }, { data: bg }] = await Promise.all([
        supabase.from('lead_comments').select('*, profile:profiles(id,full_name,email)').eq('lead_id', id).order('created_at'),
        supabase.from('lead_activity').select('*, profile:profiles(id,full_name)').eq('lead_id', id).order('created_at', { ascending: false }).limit(30),
        supabase.from('lead_files').select('*').eq('lead_id', id).order('created_at'),
        supabase.from('calendar_events').select('*').eq('lead_id', id).order('start_at'),
        supabase.from('budgets').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      ])
      setComments(c ?? [])
      setActivities(a ?? [])
      setFiles(f ?? [])
      setLeadEvents(ev ?? [])
      setLeadBudgets((bg ?? []) as Budget[])
    } catch (err) {
      console.error('[loadRelated]', err)
    }
  }

  // ── Presupuestos del lead ──────────────────────────────────────────────────
  function budgetIssuer(b: Budget): PdfOrgInfo {
    const pro = professionals.find(p => p.id === b.professional_id)
    if (pro && (pro.company_name || pro.logo_url)) {
      const addr = [pro.address, pro.cif ? `NIF: ${pro.cif}` : null].filter(Boolean).join('  ·  ')
      return { name: pro.company_name || pro.name, phone: pro.phone, email: pro.email, address: addr || null, logoUrl: pro.logo_url ?? null }
    }
    return { name: organization?.name }
  }
  function exportBudget(b: Budget) {
    exportBudgetPdf(b, budgetIssuer(b))
  }
  async function deleteBudget(b: Budget) {
    if (!window.confirm(`¿Borrar "${b.concept || 'este presupuesto'}"?`)) return
    const { error } = await supabase.from('budgets').delete().eq('id', b.id)
    if (error) { toast.error('No se pudo borrar'); return }
    toast.success('Presupuesto borrado'); loadRelated()
  }

  // Abre el asistente de presupuesto con los datos del lead ya rellenados.
  // Además lee los adjuntos del lead: extrae el texto de documentos (Excel,
  // PDF, CSV…) y las imágenes (planos) para que la IA los use al presupuestar.
  async function openBudgetWizard() {
    if (!lead) return
    setPreparingBudget(true)
    let workNotes = lead.notes ?? ''
    const images: { dataUrl: string; mime: string; data: string }[] = []
    try {
      const { data: files } = await supabase.from('lead_files').select('name, url, type').eq('lead_id', lead.id)
      if (files?.length) {
        const { extractKnowledgeText, pdfToImages } = await import('@/lib/extractText')
        const docTexts: string[] = []
        for (const f of files) {
          try {
            const isImage = (f.type ?? '').startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name)
            const isPdf = (f.type ?? '').includes('pdf') || /\.pdf$/i.test(f.name)
            const blob = await (await fetch(f.url)).blob()
            if (isImage) {
              if (images.length < 10) {                       // máx. 10 imágenes
                const img = await blobToResizedImage(blob)
                if (img) images.push(img)
              }
            } else {
              const file = new File([blob], f.name, { type: f.type ?? blob.type })
              const txt = await extractKnowledgeText(file)
              if (txt.trim().length >= 100) {
                docTexts.push(`# ${f.name}\n${txt.slice(0, 40000)}`)   // hasta 40.000 car/doc
              } else if (isPdf) {
                // PDF escaneado (sin capa de texto) → páginas a imagen para que las "vea" la IA
                const pageImgs = await pdfToImages(file, 8)
                for (const pi of pageImgs) {
                  if (images.length < 10) images.push({ dataUrl: `data:${pi.mime};base64,${pi.data}`, mime: pi.mime, data: pi.data })
                }
              } else if (txt.trim()) {
                docTexts.push(`# ${f.name}\n${txt.slice(0, 40000)}`)
              }
            }
          } catch { /* archivo que falla → se omite */ }
        }
        if (docTexts.length) {
          workNotes = `${workNotes}\n\n--- Documentos adjuntos (pliegos / planos / medidas) ---\n${docTexts.join('\n\n')}`.trim()
        }
        if (docTexts.length || images.length) {
          toast.success(`La IA leerá ${docTexts.length} documento(s) y ${images.length} imagen(es) del lead`)
        }
      }
    } catch { /* sin adjuntos o error de lectura → seguimos con lo que haya */ }
    setPreparingBudget(false)
    setBudgetWizard({
      ...emptyDraft(),
      lead_id: lead.id,
      client_name: lead.name ?? '',
      client_phone: lead.phone ?? '',
      client_address: lead.address || lead.zone || '',
      concept: lead.concept ?? '',
      work_notes: workNotes,
      images,
    })
  }
  async function budgetWhatsApp(b: Budget) {
    const win = window.open('', '_blank')  // abrir ya para evitar bloqueo de popup
    toast.info('Preparando PDF…')
    const url = await uploadBudgetPdf(b, budgetIssuer(b))
    const wa = buildWhatsAppUrl(b, url, b.client_name || lead?.name || '', b.client_phone || lead?.phone || null)
    if (win) win.location.href = wa
    else window.open(wa, '_blank')
  }

  // ── Guardar edición completa ───────────────────────────────────────────────
  async function handleSave() {
    if (!lead) return
    setSaving(true)
    try {
      const budget = form.budget_amount ? parseFloat(form.budget_amount) : null
      const commission = budget ? calculateCommission(budget) : null

      // Geocodificar si la zona/dirección cambió y el lead no tiene coords
      let lat = lead.lat
      let lng = lead.lng
      const locationText = form.zone || form.address
      const locationChanged = locationText !== (lead.zone || lead.address)
      if (locationText && (locationChanged || (!lead.lat && !lead.lng))) {
        try {
          const { geocode } = await import('@/lib/geocode')
          const geo = await geocode(locationText)
          if (geo) { lat = geo.lat; lng = geo.lng }
        } catch { /* no bloquear el guardado si geocoding falla */ }
      }

      const { error } = await supabase.from('leads').update({
        name: form.name || lead.name,
        company: form.company || null,
        concept: form.concept || null,
        zone: form.zone || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes || null,
        ai_summary: form.ai_summary || null,
        source: form.source,
        budget_amount: budget,
        commission_amount: commission,
        commission_paid: form.commission_paid,
        assigned_to: form.assigned_to || null,
        lat,
        lng,
        is_read: true,
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id)
      if (error) throw error
      toast.success('Guardado')
      setEditOpen(false)
      refetch()
      await supabase.from('lead_activity').insert({ lead_id: lead.id, user_id: user!.id, action: 'updated', metadata: {} })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // ── Acciones rápidas ──────────────────────────────────────────────────────
  async function quickSaveProfessional() {
    if (!lead) return
    setSavingQ('prof')
    await supabase.from('leads').update({ assigned_to: (qProfessional === 'none' || !qProfessional) ? null : qProfessional, updated_at: new Date().toISOString() }).eq('id', lead.id)
    await supabase.from('lead_activity').insert({ lead_id: lead.id, user_id: user!.id, action: 'assigned_professional', metadata: {} })
    toast.success('Profesional asignado'); refetch(); loadRelated()
    setSavingQ(null)
  }

  async function quickSaveColumn() {
    if (!lead || !qColumn) return
    setSavingQ('col')
    const col = columns.find(c => c.id === qColumn)
    await supabase.from('leads').update({ column_id: qColumn, updated_at: new Date().toISOString() }).eq('id', lead.id)
    await supabase.from('lead_activity').insert({ lead_id: lead.id, user_id: user!.id, action: `moved_to_${col?.name ?? qColumn}`, metadata: {} })
    toast.success(`Movido a "${col?.name ?? qColumn}"`); refetch(); loadRelated()
    setSavingQ(null)
  }

  async function quickSaveBudget() {
    if (!lead) return
    setSavingQ('budget')
    const budget = qBudget ? parseFloat(qBudget) : null
    const commission = budget ? calculateCommission(budget) : null
    await supabase.from('leads').update({ budget_amount: budget, commission_amount: commission, updated_at: new Date().toISOString() }).eq('id', lead.id)
    await supabase.from('lead_activity').insert({ lead_id: lead.id, user_id: user!.id, action: 'budget_updated', metadata: { budget } })
    toast.success('Presupuesto guardado'); refetch(); loadRelated()
    setSavingQ(null)
  }

  async function toggleCommission() {
    if (!lead) return
    const next = !lead.commission_paid
    await supabase.from('leads').update({ commission_paid: next, updated_at: new Date().toISOString() }).eq('id', lead.id)
    toast.success(next ? 'Comisión marcada como cobrada' : 'Comisión pendiente')
    refetch()
  }

  async function handleAddComment() {
    if (!newComment.trim() || !lead) return
    await supabase.from('lead_comments').insert({ lead_id: lead.id, user_id: user!.id, content: newComment.trim() })
    setNewComment(''); loadRelated()
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Resetear el input para permitir subir el mismo archivo dos veces
    e.target.value = ''
    if (!file || !lead) return
    setUploading(true)
    try {
      const path = `${organization!.id}/${lead.id}/${Date.now()}-${file.name}`
      const { data: up, error } = await supabase.storage.from('lead-files').upload(path, file)
      if (error) throw error
      const { data: urlData } = supabase.storage.from('lead-files').getPublicUrl(up.path)
      await supabase.from('lead_files').insert({
        lead_id: lead.id, name: file.name, url: urlData.publicUrl, type: file.type, size: file.size,
      })
      await supabase.from('lead_activity').insert({
        lead_id: lead.id, user_id: user!.id, action: 'file_uploaded', metadata: { name: file.name },
      })
      toast.success('Archivo subido')
      loadRelated()

      // Si es un PDF, intentar extraer el importe del presupuesto
      if (file.type === 'application/pdf') {
        extractBudgetFromPDF(file)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al subir archivo')
    } finally {
      setUploading(false)
    }
  }

  async function extractBudgetFromPDF(file: File) {
    setExtracting(true)
    try {
      // Importar pdfjs-dist y configurar el worker con URL local (Vite lo bundlea)
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).href

      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      let fullText = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const pageText = content.items
          .map((item: unknown) => (item as { str: string }).str)
          .join(' ')
        fullText += pageText + '\n'
      }

      // Debug: ver qué texto extrae el PDF
      console.log('[PDF extract] Texto extraído:\n', fullText)

      const base = parseBudgetFromText(fullText)

      // 1. Guardar el PDF en Storage y en lead_files con prefijo [PRESUPUESTO]
      const path = `${organization!.id}/${lead!.id}/${Date.now()}-${file.name}`
      const { data: up, error: upErr } = await supabase.storage
        .from('lead-files')
        .upload(path, file)
      if (!upErr && up) {
        const { data: urlData } = supabase.storage.from('lead-files').getPublicUrl(up.path)
        await supabase.from('lead_files').insert({
          lead_id: lead!.id,
          name: `[PRESUPUESTO] ${file.name}`,
          url: urlData.publicUrl,
          type: 'application/pdf',
          size: file.size,
        })
        loadRelated()
      }

      // 2. Actualizar presupuesto si se detectó importe
      if (base !== null) {
        const commission = calculateCommission(base)
        await supabase.from('leads').update({
          budget_amount: base,
          commission_amount: commission,
          updated_at: new Date().toISOString(),
        }).eq('id', lead!.id)
        setQBudget(String(base))
        await supabase.from('lead_activity').insert({
          lead_id: lead!.id,
          user_id: user!.id,
          action: 'budget_uploaded',
          metadata: { name: file.name, amount: base },
        })
        toast.success(`Base sin IVA detectada: ${formatCurrency(base)} → Comisión (15%): ${formatCurrency(commission)}`)
        refetch()
      } else {
        toast.warning('PDF guardado. No se detectó importe — introdúcelo manualmente.')
        refetch()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[PDF extract] Error:', msg, err)
      toast.error(`Error al leer el PDF: ${msg}`)
    } finally {
      setExtracting(false)
    }
  }

  // ── Editar / borrar eventos de la tab Visitas ────────────────────────────
  function openEditEvent(ev: CalendarEvent) {
    setEditEventForm({
      title: ev.title,
      type: ev.type,
      start_at: toLocalInput(ev.start_at),
      end_at:   toLocalInput(ev.end_at),
      description: ev.description ?? '',
    })
    setEditingEvent(ev)
  }

  async function handleUpdateEvent() {
    if (!editingEvent || !editEventForm.start_at) return
    setSavingEditEv(true)
    try {
      await supabase.from('calendar_events').update({
        title: editEventForm.title || editEventForm.type,
        type: editEventForm.type,
        start_at: toUTCIso(editEventForm.start_at),
        end_at: toUTCIso(editEventForm.end_at || editEventForm.start_at),
        description: editEventForm.description || null,
      }).eq('id', editingEvent.id)
      setEditingEvent(null)
      loadRelated()
      toast.success('Visita actualizada')
    } catch { toast.error('Error al guardar') }
    finally { setSavingEditEv(false) }
  }

  async function handleDeleteLeadEvent(id: string) {
    await supabase.from('calendar_events').delete().eq('id', id)
    setConfirmDeleteEvId(null)
    loadRelated()
    toast.success('Visita eliminada')
  }

  // ── Compartir por WhatsApp con el profesional ────────────────────────────
  function buildShareMessage(): string {
    const name  = displayName || lead!.name
    const zone  = lead!.zone || lead!.address || '—'
    const work  = lead!.concept || (lead!.notes ? lead!.notes.substring(0, 100) + (lead!.notes.length > 100 ? '…' : '') : '—')
    const phone = lead!.phone || '—'
    return (
      `📋 Nuevo trabajo asignado\n` +
      `👤 Cliente: ${name}\n` +
      `📍 Zona: ${zone}\n` +
      `🔧 Trabajo: ${work}\n` +
      `📞 Cliente TF: ${phone}\n` +
      `Asignado desde TrackALead`
    )
  }

  function handleShareWhatsApp() {
    const msg = encodeURIComponent(buildShareMessage())
    const proPhone = proData?.phone?.replace(/\D/g, '')
    const url = proPhone
      ? `https://wa.me/${proPhone.startsWith('34') ? proPhone : '34' + proPhone}?text=${msg}`
      : `https://wa.me/?text=${msg}`
    window.open(url, '_blank')
  }

  // ── Generar / revocar enlace público ─────────────────────────────────────
  async function generatePublicLink() {
    if (!lead) return
    setGeneratingLink(true)
    try {
      const token = crypto.randomUUID()
      const { error } = await supabase
        .from('leads')
        .update({ public_token: token, updated_at: new Date().toISOString() })
        .eq('id', lead.id)
      if (error) throw error
      setPublicToken(token)
      toast.success('Enlace público generado')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al generar enlace')
    } finally {
      setGeneratingLink(false)
    }
  }

  async function revokePublicLink() {
    if (!lead) return
    const { error } = await supabase
      .from('leads')
      .update({ public_token: null, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
    if (error) { toast.error('Error al revocar enlace'); return }
    setPublicToken(null)
    toast.success('Enlace revocado')
  }

  async function copyPublicLink() {
    if (!publicToken) return
    const url = `${window.location.origin}/p/${publicToken}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      toast.success('Enlace copiado')
      setTimeout(() => setLinkCopied(false), 2000)
    } catch { toast.error('No se pudo copiar') }
  }

  function sharePublicLinkWhatsApp() {
    if (!publicToken) return
    const url = `${window.location.origin}/p/${publicToken}`
    const msg = encodeURIComponent(
      `📋 *Ficha del trabajo*\n${buildShareMessage()}\n\n🔗 Ver detalles: ${url}`
    )
    const proPhone = proData?.phone?.replace(/\D/g, '')
    const wa = proPhone
      ? `https://wa.me/${proPhone.startsWith('34') ? proPhone : '34' + proPhone}?text=${msg}`
      : `https://wa.me/?text=${msg}`
    window.open(wa, '_blank')
  }

  async function handleCreateEvent() {
    if (!lead || !eventForm.start_at) return
    setSavingEvent(true)
    try {
      const typeLabels: Record<EventType, string> = {
        visita_presencial:  'Visita presencial',
        llamada:            'Llamada',
        seguimiento:        'Seguimiento',
        presupuesto_insitu: 'Presupuesto in-situ',
        reunion:            'Reunión',
        otro:               'Otro',
      }
      await supabase.from('calendar_events').insert({
        org_id: organization!.id,
        lead_id: lead.id,
        user_id: user!.id,
        title: eventForm.title.trim() || typeLabels[eventForm.type],
        type: eventForm.type,
        description: eventForm.description || null,
        start_at: toUTCIso(eventForm.start_at),
        end_at: toUTCIso(eventForm.end_at || eventForm.start_at),
        notify_before_minutes: 30,
      })
      setEventDialog(false)
      setEventForm({ type: 'visita_presencial', title: '', start_at: '', end_at: '', description: '' })
      loadRelated()
    } catch (err: unknown) {
      const { toast: t } = await import('sonner')
      t.error(err instanceof Error ? err.message : 'Error al agendar')
    } finally {
      setSavingEvent(false)
    }
  }

  async function handleArchive() {
    if (!lead) return
    await supabase.from('leads').update({ is_archived: true }).eq('id', lead.id)
    toast.success('Lead archivado')
    navigate(`/boards/${lead.board_id}`)
  }

  // ── Render guards ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )

  if (loadError) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <AlertCircle className="h-8 w-8 text-red-400" />
      <p className="text-sm text-gray-600">Error al cargar el lead</p>
      <p className="text-xs text-red-500 max-w-md text-center">{loadError}</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}>Reintentar</Button>
    </div>
  )

  if (!lead) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-gray-500">Lead no encontrado</p>
      <Button variant="outline" onClick={() => navigate('/boards')}>Volver a tableros</Button>
    </div>
  )

  // ── Datos derivados del lead ───────────────────────────────────────────────
  const displayName  = cleanName(lead.name) || lead.name
  const boardData    = lead.board as unknown as JoinedBoard | null
  const columnData   = lead.column as unknown as JoinedColumn | null
  const proData      = lead.assigned_professional as unknown as JoinedPro | null
  const boardColor   = boardData?.color ?? '#2563EB'

  const ACTION_LABELS: Record<string, string> = {
    created:              'creó el lead',
    updated:              'actualizó el lead',
    assigned_professional:'asignó un profesional',
    budget_updated:       'actualizó el presupuesto',
    created_via_webhook:  'recibió el lead via webhook',
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-10">
      {/* Input general — siempre montado para que fileInputRef nunca sea null */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileUpload}
        accept=".pdf,.xlsx,.xls,.csv,.txt,.jpg,.jpeg,.png,.webp,.doc,.docx"
      />
      {/* Input específico para presupuesto PDF */}
      <input
        ref={pdfInputRef}
        type="file"
        className="hidden"
        accept=".pdf"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) await extractBudgetFromPDF(file)
        }}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/boards/${lead.board_id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 break-words">{displayName}</h1>
            {lead.is_read === false && (
              <span className="text-[10px] font-black bg-red-500 text-white rounded px-1.5 py-0.5 shrink-0">NUEVO</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs">
            {boardData && (
              <span className="flex items-center gap-1 font-medium" style={{ color: boardColor }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: boardColor }} />
                {boardData.name}
              </span>
            )}
            {columnData && <Badge variant="outline" className="text-xs">{columnData.name}</Badge>}
            <Badge variant="secondary" className="text-xs">{sourceLabel(lead.source)}</Badge>
            <span className="text-gray-400 flex items-center gap-1">
              <Calendar className="h-3 w-3" />{formatDate(lead.created_at)}
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit2 className="h-4 w-4" />Editar
          </Button>
          <Button variant="destructive" size="sm" onClick={handleArchive}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Columna principal (2/3): en móvil va DESPUÉS del contacto ────── */}
        <div className="lg:col-span-2 space-y-5 order-2 lg:order-1">

          {/* Info del lead */}
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Nombre</p>
                  <p className="text-sm font-semibold text-gray-900">{displayName}</p>
                </div>
                {lead.company && (
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1">
                      <Building2 className="h-3 w-3" />Empresa
                    </p>
                    <p className="text-sm text-gray-700">{lead.company}</p>
                  </div>
                )}
              </div>

              {lead.concept && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1">
                    <Wrench className="h-3 w-3" />Concepto
                  </p>
                  <p className="text-sm font-semibold text-primary-600">{lead.concept}</p>
                </div>
              )}

              {(lead.zone || lead.address) && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />Zona
                  </p>
                  <p className="text-sm text-gray-700">{lead.zone || lead.address}</p>
                </div>
              )}

              {lead.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Trabajo a realizar</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{lead.notes}</p>
                  </div>
                </>
              )}

              {lead.ai_summary && (
                <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
                  <p className="text-xs font-bold text-purple-600 mb-1 flex items-center gap-1.5">
                    <span className="bg-purple-600 text-white text-[9px] font-black px-1 py-0.5 rounded">IA</span>
                    Resumen generado
                  </p>
                  <p className="text-sm text-purple-900 leading-relaxed">{lead.ai_summary}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabs */}
          <Tabs defaultValue="comments">
            <TabsList className="flex-wrap h-auto gap-0.5">
              <TabsTrigger value="visits">
                <Calendar className="h-3.5 w-3.5 mr-1.5" />
                Visitas ({leadEvents.length})
              </TabsTrigger>
              <TabsTrigger value="comments">
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                Comentarios ({comments.length})
              </TabsTrigger>
              <TabsTrigger value="activity">
                <Activity className="h-3.5 w-3.5 mr-1.5" />
                Actividad ({activities.length})
              </TabsTrigger>
              <TabsTrigger value="files">
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                Archivos ({files.length})
              </TabsTrigger>
              <TabsTrigger value="budgets">
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                Presupuestos ({leadBudgets.length})
              </TabsTrigger>
            </TabsList>

            {/* ── Presupuestos ─────────────────────────────────────────── */}
            <TabsContent value="budgets" className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">Presupuestos del cliente</p>
                <Button size="sm" onClick={openBudgetWizard} disabled={preparingBudget} className="gap-1.5 text-xs">
                  <Sparkles className="h-3.5 w-3.5" />{preparingBudget ? 'Leyendo adjuntos…' : 'Crear presupuesto'}
                </Button>
              </div>
              {leadBudgets.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin presupuestos para este cliente</p>
                  <button className="mt-2 text-xs text-primary-600" onClick={openBudgetWizard} disabled={preparingBudget}>{preparingBudget ? 'Leyendo adjuntos…' : 'Crear el primer presupuesto →'}</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {groupLeadBudgets(leadBudgets).map(group => group.length > 1 ? (
                    <BudgetOptionsGroup
                      key={group[0].group_id!}
                      budgets={group}
                      onWhatsApp={budgetWhatsApp}
                      onExport={exportBudget}
                      onDelete={deleteBudget}
                      onOpen={() => navigate('/budgets')}
                      onCompare={() => exportBudgetComparison(group, budgetIssuer(group[0]))}
                    />
                  ) : (
                    <SingleBudgetRow
                      key={group[0].id}
                      b={group[0]}
                      onWhatsApp={budgetWhatsApp}
                      onExport={exportBudget}
                      onDelete={deleteBudget}
                      onOpen={() => navigate('/budgets')}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Comentarios */}
            {/* ── Visitas ──────────────────────────────────────────── */}
            <TabsContent value="visits" className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">Visitas y llamadas agendadas</p>
                <Button size="sm" variant="outline" onClick={() => setEventDialog(true)} className="gap-1.5 text-xs">
                  <CalendarPlus className="h-3.5 w-3.5" />
                  Agendar visita
                </Button>
              </div>

              {leadEvents.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin visitas agendadas</p>
                  <button className="mt-2 text-xs text-primary-600" onClick={() => setEventDialog(true)}>Agendar primera visita →</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {leadEvents.map(ev => {
                    const icons: Record<string, React.ElementType> = {
                      visita_presencial:  Home,
                      llamada:            PhoneCall,
                      seguimiento:        RefreshCw,
                      presupuesto_insitu: ClipboardList,
                    }
                    const colors: Record<string, string> = {
                      visita_presencial:  'bg-blue-100 text-blue-600',
                      llamada:            'bg-green-100 text-green-600',
                      seguimiento:        'bg-purple-100 text-purple-600',
                      presupuesto_insitu: 'bg-amber-100 text-amber-600',
                    }
                    const Icon = icons[ev.type] ?? Calendar
                    const isPast = new Date(ev.start_at) < new Date()
                    return (
                      <div key={ev.id} className={`flex items-start gap-3 p-3 rounded-lg border ${isPast ? 'bg-gray-50 border-gray-100 opacity-70' : 'bg-white border-gray-200'}`}>
                        <div className={`p-1.5 rounded-lg shrink-0 ${colors[ev.type] ?? 'bg-gray-100 text-gray-500'}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{ev.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {new Date(ev.start_at).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                            {' a las '}
                            {new Date(ev.start_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {ev.description && <p className="text-xs text-gray-400 mt-1">{ev.description}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isPast && <span className="text-[10px] text-gray-400">Pasada</span>}
                          <button
                            onClick={() => openEditEvent(ev)}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteEvId(ev.id)}
                            className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Dialog confirmar borrado */}
              <Dialog open={!!confirmDeleteEvId} onOpenChange={() => setConfirmDeleteEvId(null)}>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader><DialogTitle>¿Eliminar esta visita?</DialogTitle></DialogHeader>
                  <p className="text-sm text-gray-500">Esta acción no se puede deshacer.</p>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={() => setConfirmDeleteEvId(null)}>Cancelar</Button>
                    <Button variant="destructive" onClick={() => handleDeleteLeadEvent(confirmDeleteEvId!)}>Eliminar</Button>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Dialog editar visita */}
              <Dialog open={!!editingEvent} onOpenChange={() => setEditingEvent(null)}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Editar visita</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Título</Label>
                      <Input placeholder="Visita, llamada de seguimiento…" value={editEventForm.title}
                        onChange={e => setEditEventForm(f => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tipo</Label>
                      <Select value={editEventForm.type} onValueChange={v => setEditEventForm(f => ({ ...f, type: v as EventType }))}>
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
                        <Input type="datetime-local" value={editEventForm.start_at}
                          onChange={e => setEditEventForm(f => ({ ...f, start_at: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Fin</Label>
                        <Input type="datetime-local" value={editEventForm.end_at}
                          onChange={e => setEditEventForm(f => ({ ...f, end_at: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Notas</Label>
                      <Textarea rows={2} value={editEventForm.description}
                        onChange={e => setEditEventForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setEditingEvent(null)}>Cancelar</Button>
                      <Button onClick={handleUpdateEvent} disabled={savingEditEv || !editEventForm.start_at}>
                        {savingEditEv ? 'Guardando…' : 'Guardar cambios'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Dialog agendar visita */}
              <Dialog open={eventDialog} onOpenChange={setEventDialog}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Agendar visita</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Título <span className="text-gray-400 font-normal text-xs">(opcional)</span></Label>
                      <Input placeholder="Visita presencial, llamada de seguimiento…" value={eventForm.title}
                        onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tipo</Label>
                      <Select value={eventForm.type} onValueChange={v => setEventForm(f => ({ ...f, type: v as EventType }))}>
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
                        <Input type="datetime-local" value={eventForm.start_at} onChange={e => setEventForm(f => ({ ...f, start_at: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Fin</Label>
                        <Input type="datetime-local" value={eventForm.end_at} onChange={e => setEventForm(f => ({ ...f, end_at: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Notas</Label>
                      <Textarea rows={2} placeholder="Observaciones…" value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setEventDialog(false)}>Cancelar</Button>
                      <Button onClick={handleCreateEvent} disabled={savingEvent || !eventForm.start_at}>
                        {savingEvent ? 'Guardando…' : 'Agendar'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </TabsContent>

            <TabsContent value="comments" className="mt-4 space-y-3">
              {comments.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Sin comentarios todavía</p>
              )}
              {comments.map(c => (
                <div key={c.id} className="flex gap-3">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-xs">
                      {c.profile?.full_name ? getInitials(c.profile.full_name) : 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-700">{c.profile?.full_name ?? 'Usuario'}</span>
                      <span className="text-xs text-gray-400">{formatRelativeTime(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.content}</p>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Textarea
                  rows={2}
                  placeholder="Escribe un comentario… (Ctrl+Enter para enviar)"
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment() }}
                />
                <Button size="sm" className="self-end" onClick={handleAddComment} disabled={!newComment.trim()}>
                  Enviar
                </Button>
              </div>
            </TabsContent>

            {/* Actividad */}
            <TabsContent value="activity" className="mt-4">
              {activities.length === 0
                ? <p className="text-sm text-gray-400 text-center py-6">Sin actividad registrada</p>
                : (
                  <div className="space-y-2">
                    {activities.map(a => {
                      const meta = (a.metadata ?? {}) as Record<string, string>
                      const label = a.action.startsWith('moved_to_')
                        ? `movió el lead a "${a.action.replace('moved_to_', '')}"`
                        : a.action === 'file_uploaded'
                          ? `subió el archivo "${meta.name ?? ''}"`
                          : ACTION_LABELS[a.action] ?? a.action.replace(/_/g, ' ')
                      return (
                        <div key={a.id} className="flex items-start gap-3 text-sm">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-1.5 shrink-0" />
                          <div className="flex-1 text-gray-600">
                            <span className="font-medium text-gray-800">{a.profile?.full_name ?? 'Sistema'}</span>
                            {' '}{label}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">
                            {formatRelativeTime(a.created_at)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              }
            </TabsContent>

            {/* Archivos */}
            <TabsContent value="files" className="mt-4 space-y-3">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="h-4 w-4" />{uploading ? 'Subiendo…' : 'Subir archivo'}
              </Button>
              {files.length === 0 && <p className="text-sm text-gray-400">Sin archivos adjuntos</p>}
              {files.map(f => {
                const isBudget = f.name.startsWith('[PRESUPUESTO]')
                const displayName = isBudget ? f.name.replace('[PRESUPUESTO] ', '') : f.name
                return (
                  <div
                    key={f.id}
                    className={`flex items-center gap-3 p-3 rounded-lg ${isBudget ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}
                  >
                    <Paperclip className={`h-4 w-4 shrink-0 ${isBudget ? 'text-amber-500' : 'text-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      {isBudget && (
                        <span className="inline-block text-[10px] font-bold bg-amber-500 text-white rounded px-1.5 py-0.5 mr-1.5 mb-0.5">
                          PRESUPUESTO
                        </span>
                      )}
                      <a href={f.url} target="_blank" rel="noreferrer"
                        className={`text-sm hover:underline truncate block ${isBudget ? 'text-amber-700' : 'text-primary-600'}`}>
                        {displayName}
                      </a>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      onClick={async () => { await supabase.from('lead_files').delete().eq('id', f.id); loadRelated() }}
                      className="text-red-400 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Sidebar acciones rápidas (1/3): en móvil va PRIMERO ─────────── */}
        <div className="space-y-4 order-1 lg:order-2">

          {/* Contacto */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Phone className="h-4 w-4 text-green-500" />Contacto
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lead.phone ? (
                <>
                  <p className="text-sm font-bold text-gray-900">{lead.phone}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={`tel:${lead.phone}`}>
                      {/* En móvil: botón grande con padding extra */}
                      <Button variant="outline" className="w-full text-green-700 border-green-300 hover:bg-green-50 gap-2 h-11 md:h-9 text-sm md:text-xs">
                        <Phone className="h-4 w-4 md:h-3.5 md:w-3.5" />Llamar
                      </Button>
                    </a>
                    <a href={toWhatsApp(lead.phone)} target="_blank" rel="noreferrer">
                      <Button variant="outline" className="w-full text-emerald-700 border-emerald-300 hover:bg-emerald-50 gap-2 h-11 md:h-9 text-sm md:text-xs">
                        <MessageCircle className="h-4 w-4 md:h-3.5 md:w-3.5" />WhatsApp
                      </Button>
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400">Sin teléfono</p>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-sm text-primary-600 hover:underline truncate">
                  <Mail className="h-3.5 w-3.5 shrink-0" />{lead.email}
                </a>
              )}

              {/* Compartir con profesional por WhatsApp */}
              <button
                onClick={handleShareWhatsApp}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-dashed border-gray-300 text-xs font-medium text-gray-600 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
              >
                <Share2 className="h-3.5 w-3.5" />
                Compartir con profesional
                {proData?.name && (
                  <span className="text-gray-400">— {proData.name}</span>
                )}
              </button>
            </CardContent>
          </Card>

          {/* Enlace público */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link className="h-4 w-4 text-indigo-500" />Enlace público
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!publicToken ? (
                <>
                  <p className="text-xs text-gray-400">
                    Genera un enlace para compartir con el profesional sin acceso a la app.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={generatePublicLink}
                    disabled={generatingLink}
                  >
                    <Link className="h-3.5 w-3.5" />
                    {generatingLink ? 'Generando…' : 'Generar enlace público'}
                  </Button>
                </>
              ) : (
                <>
                  {/* Enlace generado */}
                  <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">
                    <code className="flex-1 text-[11px] text-gray-600 truncate">
                      {window.location.origin}/p/{publicToken}
                    </code>
                    <button
                      onClick={copyPublicLink}
                      className="shrink-0 text-gray-400 hover:text-primary-600 transition-colors"
                      title="Copiar"
                    >
                      {linkCopied
                        ? <Check className="h-3.5 w-3.5 text-green-500" />
                        : <Copy className="h-3.5 w-3.5" />
                      }
                    </button>
                  </div>

                  {/* Acciones */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={copyPublicLink}
                    >
                      {linkCopied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      {linkCopied ? 'Copiado' : 'Copiar'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                      onClick={sharePublicLinkWhatsApp}
                    >
                      <Share2 className="h-3 w-3" />
                      WhatsApp
                    </Button>
                  </div>

                  {/* Revocar */}
                  <button
                    onClick={revokePublicLink}
                    className="w-full flex items-center justify-center gap-1.5 text-[11px] text-red-400 hover:text-red-600 transition-colors py-1"
                  >
                    <Trash className="h-3 w-3" />
                    Revocar enlace
                  </button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Mover columna */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ChevronRight className="h-4 w-4 text-slate-500" />Estado
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={qColumn} onValueChange={setQColumn}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Seleccionar estado…" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm" className="w-full"
                onClick={quickSaveColumn}
                disabled={savingQ === 'col' || !qColumn || qColumn === lead.column_id}
              >
                {savingQ === 'col' ? 'Moviendo…' : 'Mover aquí'}
              </Button>
            </CardContent>
          </Card>

          {/* Asignar profesional */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4 text-primary-500" />Profesional
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {proData && !editOpen && (
                <div className="text-sm mb-2">
                  <p className="font-medium text-gray-900">{proData.name}</p>
                  {proData.specialty && <p className="text-xs text-gray-400">{proData.specialty}</p>}
                  {proData.phone && (
                    <a href={`tel:${proData.phone}`} className="text-xs text-primary-600 hover:underline flex items-center gap-1 mt-1">
                      <Phone className="h-3 w-3" />{proData.phone}
                    </a>
                  )}
                  <Separator className="my-2" />
                </div>
              )}
              <Select value={qProfessional} onValueChange={setQProfessional}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {professionals.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.specialty ? ` · ${p.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm" variant="outline" className="w-full"
                onClick={quickSaveProfessional}
                disabled={savingQ === 'prof' || (qProfessional === 'none' ? !lead.assigned_to : qProfessional === lead.assigned_to)}
              >
                {savingQ === 'prof' ? 'Asignando…' : 'Confirmar asignación'}
              </Button>
            </CardContent>
          </Card>

          {/* Finanzas */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-amber-500" />Finanzas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Subir PDF del presupuesto */}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                disabled={extracting}
                onClick={() => pdfInputRef.current?.click()}
              >
                <span>📄</span>
                {extracting ? 'Leyendo PDF…' : 'Subir presupuesto PDF'}
              </Button>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">O introduce el importe manualmente</Label>
                <div className="flex gap-2">
                  <Input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    className="h-8 text-sm"
                    value={qBudget}
                    onChange={e => setQBudget(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') quickSaveBudget() }}
                  />
                  <Button size="sm" variant="outline" onClick={quickSaveBudget} disabled={savingQ === 'budget'}>
                    {savingQ === 'budget' ? '…' : 'OK'}
                  </Button>
                </div>
                {lead.budget_amount != null && (
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(lead.budget_amount)}</p>
                )}
              </div>
              {lead.commission_amount != null && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-gray-400">Comisión (15%)</p>
                    <p className="text-base font-bold text-amber-600">{formatCurrency(lead.commission_amount)}</p>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                {lead.commission_paid
                  ? <Badge variant="success" className="text-xs"><CheckCircle className="h-3 w-3 mr-1" />Cobrada</Badge>
                  : <Badge variant="warning" className="text-xs"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>
                }
                <Switch checked={lead.commission_paid} onCheckedChange={toggleCommission} />
              </div>
            </CardContent>
          </Card>

          {/* Archivos rápido */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-slate-500" />Adjuntos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full"
                onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="h-4 w-4" />{uploading ? 'Subiendo…' : 'Subir archivo'}
              </Button>
              {files.length > 0 && (
                <p className="text-xs text-gray-400 mt-2 text-center">
                  {files.length} archivo{files.length !== 1 ? 's' : ''} adjunto{files.length !== 1 ? 's' : ''}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Meta */}
          <div className="text-xs text-gray-400 space-y-1 px-1">
            <p>Creado: {formatDateTime(lead.created_at)}</p>
            <p>Actualizado: {formatDateTime(lead.updated_at)}</p>
          </div>
        </div>
      </div>

      {/* ── Dialog edición completa ───────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar lead</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <Input value={form.company} placeholder="Reformas S.L." onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Concepto</Label>
              <Input value={form.concept} placeholder="Reforma baño…" onChange={e => setForm(p => ({ ...p, concept: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Zona / Ciudad</Label>
              <Input value={form.zone} placeholder="León, Madrid…" onChange={e => setForm(p => ({ ...p, zone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Dirección completa</Label>
              <Input value={form.address} placeholder="Calle Mayor 1, León" onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Origen</Label>
              <Select value={form.source} onValueChange={v => setForm(p => ({ ...p, source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="form">Formulario</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="call">Llamada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Trabajo a realizar</Label>
              <Textarea rows={4} value={form.notes} placeholder="Descripción…"
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <span className="bg-purple-600 text-white text-[9px] font-black px-1 py-0.5 rounded">IA</span>
                Resumen generado
              </Label>
              <Textarea rows={3} value={form.ai_summary} placeholder="Resumen IA…"
                onChange={e => setForm(p => ({ ...p, ai_summary: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 mt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Asistente de presupuesto (desde la ficha del lead) */}
      {budgetWizard && organization && (
        <BudgetWizard
          initial={budgetWizard}
          leads={lead ? [lead] : []}
          professionals={professionals}
          orgId={organization.id}
          userId={user?.id ?? null}
          orgName={organization.name}
          onClose={() => setBudgetWizard(null)}
          onSaved={() => loadRelated()}
          onEditBudget={() => { setBudgetWizard(null); navigate('/budgets') }}
        />
      )}
    </div>
  )
}
