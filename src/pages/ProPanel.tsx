import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MapPin, Wrench, Upload, MessageCircle, Send, Radar, AlertCircle, ArrowLeft, FileText, Plus, Trash2, Check, X, Sparkles, Settings, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { generateBudget } from '@/lib/ai'
import { viewBudgetPdf } from '@/lib/budgetPdf'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/utils'
import { ProKnowledgeManager } from '@/components/ProKnowledgeManager'
import type { Professional, Lead, Budget, BudgetLine, BudgetPartida, PartidaStatus, ProRate } from '@/types'

type PanelPartida = BudgetPartida & {
  budget: { client_name: string | null; concept: string | null; lead_id: string | null; vat_percent: number } | null
}

const PARTIDA_STATUS: Record<PartidaStatus, { label: string; color: string }> = {
  pending:  { label: 'Pendiente', color: 'bg-amber-100 text-amber-700' },
  accepted: { label: 'Aceptada',  color: 'bg-blue-100 text-blue-700' },
  done:     { label: 'Hecha',     color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rechazada', color: 'bg-red-100 text-red-700' },
}

// Extiende Lead con los joins de Supabase
type PanelLead = Omit<Lead, 'column' | 'board'> & {
  column: { name: string; color: string } | null
  board: { name: string; color: string } | null
}

interface ProComment {
  id: string
  content: string
  created_at: string
}

function toWhatsApp(phone: string) {
  const d = phone.replace(/\D/g, '')
  return d.startsWith('34') ? `https://wa.me/${d}` : `https://wa.me/34${d}`
}

// Presupuestos del profesional (vía RPC pro_budgets)
interface PanelBudget {
  id: string; group_id: string | null; lead_id: string | null; concept: string | null
  client_name: string | null; client_phone: string | null; client_address: string | null
  lines: BudgetLine[]; subtotal: number; vat_percent: number; vat_amount: number; total: number
  validity_days: number; status: string; validated_at: string | null
  notes: string | null; created_at: string; lead_name: string | null
}

// Presupuestos PROPIOS del profesional (trabajos suyos)
interface OwnBudget {
  id: string; client_name: string | null; concept: string | null
  lines: BudgetLine[]; subtotal: number; vat_percent: number; total: number
  notes: string | null; created_at: string
}

function groupProBudgets(budgets: PanelBudget[]): PanelBudget[][] {
  const seen = new Set<string>(); const out: PanelBudget[][] = []
  for (const b of budgets) {
    if (b.group_id) { if (seen.has(b.group_id)) continue; seen.add(b.group_id); out.push(budgets.filter(x => x.group_id === b.group_id)) }
    else out.push([b])
  }
  return out
}
function optLabel(b: PanelBudget, i: number): string {
  const m = (b.concept || '').match(/(\d+)\s*$/)
  return `Propuesta ${m ? m[1] : i + 1}`
}

// Tarjeta de presupuesto en el panel del profesional: ve las opciones, abre el PDF y valida.
function ProBudgetCard({ budgets, onValidate, onView }: { budgets: PanelBudget[]; onValidate: (b: PanelBudget) => void; onView: (b: PanelBudget) => void }) {
  const [active, setActive] = useState(0)
  const b = budgets[active] ?? budgets[0]
  const isGroup = budgets.length > 1
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
      <div>
        <p className="font-semibold text-gray-900 truncate">{b.client_name || b.lead_name || 'Cliente'}</p>
        <p className="text-sm text-primary-600 font-medium truncate">{isGroup ? `${budgets.length} propuestas` : (b.concept || 'Presupuesto')}</p>
      </div>
      {isGroup && (
        <div className="flex gap-1 flex-wrap">
          {budgets.map((opt, i) => (
            <button key={opt.id} onClick={() => setActive(i)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${i === active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {optLabel(opt, i)} · {formatCurrency(opt.total)}
            </button>
          ))}
        </div>
      )}
      <div className="border border-gray-100 rounded-lg divide-y divide-gray-50">
        {(b.lines ?? []).map((l, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs gap-2">
            <span className="text-gray-700 truncate">{l.concept}</span>
            <span className="text-gray-500 shrink-0">{l.units} × {formatCurrency(l.unit_price)} = <strong className="text-gray-800">{formatCurrency(l.total)}</strong></span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold text-gray-900">Total: {formatCurrency(b.total)}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onView(b)}><Eye className="h-4 w-4" />Ver</Button>
          {b.validated_at
            ? <span className="text-[12px] font-semibold text-green-600 flex items-center gap-1"><Check className="h-4 w-4" />Validado</span>
            : <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700" onClick={() => onValidate(b)}><Check className="h-4 w-4" />Validar</Button>}
        </div>
      </div>
    </div>
  )
}

export function ProPanel() {
  const { token } = useParams<{ token: string }>()
  const [professional, setProfessional]  = useState<Professional | null>(null)
  const [leads, setLeads]                = useState<PanelLead[]>([])
  const [selectedLead, setSelectedLead]  = useState<PanelLead | null>(null)
  const [comments, setComments]          = useState<ProComment[]>([])
  const [newNote, setNewNote]            = useState('')
  const [loading, setLoading]            = useState(true)
  const [uploading, setUploading]        = useState(false)
  const [notFound, setNotFound]          = useState(false)
  const [partidas, setPartidas]          = useState<PanelPartida[]>([])
  const [budgets, setBudgets]            = useState<PanelBudget[]>([])
  const [selectedPartida, setSelectedPartida] = useState<PanelPartida | null>(null)
  const [partidaLines, setPartidaLines]  = useState<BudgetLine[]>([])
  const [savingPartida, setSavingPartida] = useState(false)
  const [ownerId, setOwnerId]            = useState<string | null>(null)
  const [generatingBudget, setGeneratingBudget] = useState(false)
  const [showConfig, setShowConfig]      = useState(false)
  const [rates, setRates]                = useState<ProRate[]>([])
  const [savingRates, setSavingRates]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Mis presupuestos propios
  const [ownBudgets, setOwnBudgets]      = useState<OwnBudget[]>([])
  const [ownEditing, setOwnEditing]      = useState(false)
  const [ownDraft, setOwnDraft]          = useState<{ id: string | null; client_name: string; concept: string; vat_percent: number; notes: string }>({ id: null, client_name: '', concept: '', vat_percent: 21, notes: '' })
  const [ownLines, setOwnLines]          = useState<BudgetLine[]>([])
  const [genOwn, setGenOwn]              = useState(false)
  const [savingOwn, setSavingOwn]        = useState(false)
  const [contributing, setContributing]  = useState(false)

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    loadProfessional()
  }, [token])

  useEffect(() => {
    if (selectedLead) loadComments(selectedLead.id)
  }, [selectedLead?.id])

  async function loadProfessional() {
    setLoading(true)
    const ok = await reload()
    if (!ok) setNotFound(true)
    setLoading(false)
  }

  // Carga TODO vía RPC SECURITY DEFINER (valida el token y devuelve solo lo del profesional)
  async function reload(): Promise<boolean> {
    const { data, error } = await supabase.rpc('pro_load', { p_token: token })
    if (error || !data) return false
    const d = data as { professional: Professional; owner_id: string | null; leads: PanelLead[]; partidas: PanelPartida[] }
    setProfessional(d.professional)
    setRates(d.professional.rates ?? [])
    setOwnerId(d.owner_id ?? null)
    setLeads(d.leads ?? [])
    setPartidas(d.partidas ?? [])
    const { data: bg } = await supabase.rpc('pro_budgets', { p_token: token })
    setBudgets((bg ?? []) as PanelBudget[])
    const { data: ob } = await supabase.rpc('pro_own_budget_list', { p_token: token })
    setOwnBudgets((ob ?? []) as OwnBudget[])
    return true
  }

  async function validateBudget(b: PanelBudget) {
    const { error } = await supabase.rpc('pro_budget_validate', { p_token: token, p_budget_id: b.id })
    if (error) { toast.error('No se pudo validar'); return }
    toast.success('Presupuesto validado — el gestor recibe el aviso')
    reload()
  }

  // Texto de conocimiento para la IA: biblioteca de la empresa + conocimiento del profesional
  async function proKnowledgeText(): Promise<string> {
    const [{ data: lib }, { data: kn }] = await Promise.all([
      supabase.rpc('pro_budget_library_list', { p_token: token }),
      supabase.rpc('pro_knowledge_list', { p_token: token }),
    ])
    let out = ''
    for (const k of (lib ?? []) as { title: string | null; gremio: string | null; content_text: string | null }[]) {
      if (!k.content_text) continue
      const chunk = `\n--- Presupuesto real${k.gremio ? ` (${k.gremio})` : ''}: ${k.title ?? ''} ---\n${k.content_text.slice(0, 3000)}`
      if (out.length + chunk.length > 12000) break
      out += chunk
    }
    for (const k of (kn ?? []) as { type: string; title: string | null; content_text: string | null }[]) {
      if (!k.content_text) continue
      const chunk = `\n--- ${k.type}: ${k.title ?? ''} ---\n${k.content_text.slice(0, 2500)}`
      if (out.length + chunk.length > 16000) break
      out += chunk
    }
    return out.trim()
  }

  function openPartida(p: PanelPartida) {
    setSelectedPartida(p)
    setPartidaLines((p.lines ?? []).map(l => ({ ...l })))
  }

  // ── Mis tarifas ───────────────────────────────────────────────────────────
  function addRate() { setRates(prev => [...prev, { work_type: '', min_price: 0, rec_price: 0, unit: 'ud' }]) }
  function updateRate(i: number, patch: Partial<ProRate>) { setRates(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function removeRate(i: number) { setRates(prev => prev.filter((_, idx) => idx !== i)) }
  async function importRates(file: File) {
    try {
      const { parseRatesFromFile } = await import('@/lib/sheetParse')
      const imported = await parseRatesFromFile(file)
      if (!imported.length) { toast.error('No se encontraron tarifas en el archivo'); return }
      setRates(prev => [...prev, ...imported])
      toast.success(`${imported.length} tarifa(s) importada(s)`)
    } catch { toast.error('No se pudo leer el archivo') }
  }
  async function saveRates() {
    if (!professional) return
    setSavingRates(true)
    const { error } = await supabase.rpc('pro_rates_save', { p_token: token, p_rates: rates })
    setSavingRates(false)
    if (error) toast.error('Error al guardar'); else { toast.success('Tarifas guardadas'); setProfessional({ ...professional, rates }) }
  }

  // El profesional genera el presupuesto con IA (usa las claves del dueño de la org).
  async function generateProBudget(lead: PanelLead) {
    if (!professional) return
    setGeneratingBudget(true)
    try {
      const client = lead.name.replace(/^nombre:\s*/i, '').trim() || 'Cliente'
      const knowledge = await proKnowledgeText()
      const result = await generateBudget({
        clientName: client,
        concept: lead.concept || lead.notes || 'Trabajo',
        notes: lead.notes || undefined,
        zone: lead.zone || undefined,
        marginPercent: 20,
        proRates: professional.rates,
        userId: ownerId ?? undefined,
        knowledge,
        professionalId: professional.id,
        orgId: professional.org_id,
      })
      const subtotal = result.subtotal
      const vatAmount = Math.round(subtotal * 21) / 100
      const total = Math.round((subtotal + vatAmount) * 100) / 100

      const { error } = await supabase.rpc('pro_budget_create', {
        p_token: token, p_lead_id: lead.id, p_client_name: client,
        p_client_phone: lead.phone || null, p_client_address: lead.address || null,
        p_concept: lead.concept || null, p_lines: result.lines, p_subtotal: subtotal,
        p_vat_percent: 21, p_vat_amount: vatAmount, p_total: total,
        p_notes: result.notes || null, p_trade: lead.concept || 'General',
      })
      if (error) throw error
      toast.success('Presupuesto generado')
      await reload()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el presupuesto')
    } finally {
      setGeneratingBudget(false)
    }
  }

  // ── Mis presupuestos propios (trabajos del profesional, con IA) ──────────────
  function openOwnNew() { setOwnDraft({ id: null, client_name: '', concept: '', vat_percent: 21, notes: '' }); setOwnLines([]); setOwnEditing(true) }
  function openOwnEdit(b: OwnBudget) { setOwnDraft({ id: b.id, client_name: b.client_name ?? '', concept: b.concept ?? '', vat_percent: b.vat_percent ?? 21, notes: b.notes ?? '' }); setOwnLines((b.lines ?? []).map(l => ({ ...l }))); setOwnEditing(true) }
  function updateOwnLine(i: number, patch: Partial<BudgetLine>) {
    setOwnLines(prev => prev.map((l, idx) => { if (idx !== i) return l; const n = { ...l, ...patch }; n.total = Math.round((Number(n.units) || 0) * (Number(n.unit_price) || 0) * 100) / 100; return n }))
  }
  function addOwnLine() { setOwnLines(prev => [...prev, { concept: '', units: 1, unit_price: 0, total: 0 }]) }
  function removeOwnLine(i: number) { setOwnLines(prev => prev.filter((_, idx) => idx !== i)) }
  async function generateOwn() {
    if (!professional) return
    if (!ownDraft.concept.trim()) { toast.error('Describe el trabajo primero'); return }
    setGenOwn(true)
    try {
      const knowledge = await proKnowledgeText()
      const result = await generateBudget({
        clientName: ownDraft.client_name || 'Cliente', concept: ownDraft.concept,
        marginPercent: 20, proRates: professional.rates, userId: ownerId ?? undefined, knowledge,
        professionalId: professional.id, orgId: professional.org_id,
      })
      setOwnLines(result.lines.map(l => ({ ...l })))
      if (result.notes && !ownDraft.notes.trim()) setOwnDraft(d => ({ ...d, notes: result.notes }))
      toast.success('Presupuesto generado — revísalo y guarda')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al generar')
    } finally { setGenOwn(false) }
  }
  async function saveOwn() {
    setSavingOwn(true)
    const subtotal = Math.round(ownLines.reduce((s, l) => s + (l.total || 0), 0) * 100) / 100
    const total = Math.round((subtotal + subtotal * (ownDraft.vat_percent || 0) / 100) * 100) / 100
    const { error } = await supabase.rpc('pro_own_budget_save', {
      p_token: token, p_id: ownDraft.id, p_client_name: ownDraft.client_name || null, p_concept: ownDraft.concept || null,
      p_lines: ownLines, p_subtotal: subtotal, p_vat: ownDraft.vat_percent, p_total: total, p_notes: ownDraft.notes || null,
    })
    setSavingOwn(false)
    if (error) { toast.error('No se pudo guardar'); return }
    toast.success('Presupuesto guardado'); setOwnEditing(false); await reload()
  }
  async function deleteOwn(id: string) {
    if (!window.confirm('¿Borrar este presupuesto?')) return
    await supabase.rpc('pro_own_budget_delete', { p_token: token, p_id: id }); reload()
  }
  function ownPdf(b: OwnBudget) {
    const issuer = { name: professional?.company_name || professional?.name, phone: professional?.phone, email: professional?.email, address: professional?.address, logoUrl: professional?.logo_url }
    const like = { id: b.id, client_name: b.client_name, client_phone: null, client_address: null, concept: b.concept, lines: b.lines, subtotal: b.subtotal, vat_percent: b.vat_percent, vat_amount: Math.round(b.subtotal * (b.vat_percent || 0)) / 100, total: b.total, notes: b.notes, created_at: b.created_at, validity_days: 30 }
    viewBudgetPdf(like as unknown as Budget, issuer)
  }

  // El profesional aporta un presupuesto real a la biblioteca de la empresa
  async function contributeToLibrary(file: File) {
    setContributing(true)
    try {
      const { extractKnowledgeText } = await import('@/lib/extractText')
      const text = await extractKnowledgeText(file)
      if (text.trim().length < 50) { toast.error('No se pudo leer texto (¿foto/escaneo? súbelo en PDF con texto o Excel)'); return }
      const { error } = await supabase.rpc('pro_budget_library_add', {
        p_token: token, p_title: file.name, p_gremio: professional?.specialty ?? null, p_content_text: text.slice(0, 40000), p_file_url: null,
      })
      if (error) { toast.error('No se pudo aportar'); return }
      toast.success('Añadido a la biblioteca de la empresa')
    } catch { toast.error('No se pudo leer el archivo') }
    finally { setContributing(false) }
  }

  function updatePartidaLine(i: number, patch: Partial<BudgetLine>) {
    setPartidaLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, ...patch }
      next.total = Math.round((Number(next.units) || 0) * (Number(next.unit_price) || 0) * 100) / 100
      return next
    }))
  }
  function addPartidaLine() {
    setPartidaLines(prev => [...prev, { concept: '', units: 1, unit_price: 0, total: 0 }])
  }
  function removePartidaLine(i: number) {
    setPartidaLines(prev => prev.filter((_, idx) => idx !== i))
  }

  const partidaSubtotal = partidaLines.reduce((s, l) => s + (l.total || 0), 0)

  async function savePartida(newStatus?: PartidaStatus) {
    if (!selectedPartida || !professional) return
    setSavingPartida(true)
    const subtotal = Math.round(partidaSubtotal * 100) / 100
    const status = newStatus ?? selectedPartida.status
    const { error } = await supabase.rpc('pro_partida_save', {
      p_token: token, p_partida_id: selectedPartida.id, p_lines: partidaLines, p_subtotal: subtotal, p_status: status,
    })
    if (error) { toast.error('Error al guardar'); setSavingPartida(false); return }
    const statusLabel = newStatus ? PARTIDA_STATUS[newStatus].label : null
    toast.success(statusLabel ? `Partida marcada como ${statusLabel}` : 'Cambios guardados')
    setSavingPartida(false)
    await reload()
    setSelectedPartida(prev => prev ? { ...prev, lines: partidaLines, subtotal, status } : prev)
  }

  async function loadComments(leadId: string) {
    const { data } = await supabase.rpc('pro_lead_comments', { p_token: token, p_lead_id: leadId })
    setComments((data ?? []) as ProComment[])
  }

  async function submitNote() {
    if (!newNote.trim() || !selectedLead || !professional) return
    const { error } = await supabase.rpc('pro_lead_comment', { p_token: token, p_lead_id: selectedLead.id, p_content: newNote.trim() })
    if (error) { toast.error('Error al enviar'); return }
    toast.success('Nota enviada')
    setNewNote('')
    loadComments(selectedLead.id)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedLead || !professional) return
    setUploading(true)
    try {
      const path = `${selectedLead.org_id}/${selectedLead.id}/pro-${Date.now()}-${file.name}`
      const { data: up, error } = await supabase.storage.from('lead-files').upload(path, file)
      if (error) throw error
      const { data: urlData } = supabase.storage.from('lead-files').getPublicUrl(up.path)
      const { error: rpcErr } = await supabase.rpc('pro_lead_file', {
        p_token: token, p_lead_id: selectedLead.id, p_name: `[PROFESIONAL] ${file.name}`,
        p_url: urlData.publicUrl, p_type: file.type, p_size: file.size,
      })
      if (rpcErr) throw rpcErr
      toast.success('Archivo subido')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al subir')
    } finally {
      setUploading(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <Header />
      <div className="mt-10 max-w-sm">
        <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-gray-800">Enlace no válido</h2>
        <p className="text-gray-500 text-sm mt-2">Este enlace no existe o el acceso ha sido desactivado.</p>
      </div>
    </div>
  )

  if (selectedPartida) {
    const st = PARTIDA_STATUS[selectedPartida.status]
    const vat = selectedPartida.budget?.vat_percent ?? 21
    const vatAmount = Math.round(partidaSubtotal * vat) / 100
    const total = Math.round((partidaSubtotal + vatAmount) * 100) / 100
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Header proName={professional?.name} />
        <div className="max-w-lg mx-auto w-full px-4 py-6 space-y-4">
          <button onClick={() => setSelectedPartida(null)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" />Volver
          </button>

          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-gray-400">Partida · {selectedPartida.trade}</p>
                <h2 className="text-lg font-bold text-gray-900 truncate">{selectedPartida.budget?.client_name ?? 'Cliente'}</h2>
                {selectedPartida.budget?.concept && <p className="text-sm text-primary-600 mt-0.5">{selectedPartida.budget.concept}</p>}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
            </div>
          </div>

          {/* Líneas editables de TU partida */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Tu partida ({selectedPartida.trade})</h3>
            {partidaLines.map((l, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-2 space-y-1.5">
                <Input value={l.concept} onChange={e => updatePartidaLine(i, { concept: e.target.value })} placeholder="Concepto" className="h-9 text-sm" />
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} value={l.units} onChange={e => updatePartidaLine(i, { units: Number(e.target.value) })} className="h-9 text-sm w-16 text-center" />
                  <span className="text-xs text-gray-400">×</span>
                  <Input type="number" min={0} step="0.01" value={l.unit_price} onChange={e => updatePartidaLine(i, { unit_price: Number(e.target.value) })} className="h-9 text-sm w-24 text-right" />
                  <span className="ml-auto text-sm font-semibold">{formatCurrency(l.total)}</span>
                  <button onClick={() => removePartidaLine(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addPartidaLine} className="gap-1.5"><Plus className="h-3.5 w-3.5" />Añadir línea</Button>
            <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
              <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{formatCurrency(partidaSubtotal)}</span></div>
              <div className="flex justify-between text-gray-500"><span>IVA ({vat}%)</span><span>{formatCurrency(vatAmount)}</span></div>
              <div className="flex justify-between font-bold text-primary-600"><span>Total</span><span>{formatCurrency(total)}</span></div>
            </div>
          </div>

          {/* Acciones */}
          <div className="space-y-2">
            <Button className="w-full" onClick={() => savePartida()} disabled={savingPartida}>{savingPartida ? 'Guardando…' : 'Guardar cambios'}</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="text-blue-700 border-blue-300 gap-1.5" onClick={() => savePartida('accepted')} disabled={savingPartida}><Check className="h-4 w-4" />Aceptar</Button>
              <Button variant="outline" className="text-green-700 border-green-300 gap-1.5" onClick={() => savePartida('done')} disabled={savingPartida}><Check className="h-4 w-4" />Trabajo hecho</Button>
              <Button variant="outline" className="text-red-600 border-red-300 gap-1.5 col-span-2" onClick={() => savePartida('rejected')} disabled={savingPartida}><X className="h-4 w-4" />Rechazar</Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (showConfig) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Header proName={professional?.name} />
        <div className="max-w-lg mx-auto w-full px-4 py-6 space-y-4">
          <button onClick={() => setShowConfig(false)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" />Volver
          </button>

          {/* Mis tarifas */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Mis tarifas</h3>
            <p className="text-xs text-gray-400">La IA usará estos precios al generar tus presupuestos.</p>
            {rates.map((r, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-2 space-y-1.5">
                <Input value={r.work_type} onChange={e => updateRate(i, { work_type: e.target.value })} placeholder="Tipo de trabajo" className="h-9 text-sm" />
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} step="0.01" value={r.min_price} onChange={e => updateRate(i, { min_price: Number(e.target.value) })} className="h-9 text-sm w-20 text-right" placeholder="mín" />
                  <Input type="number" min={0} step="0.01" value={r.rec_price} onChange={e => updateRate(i, { rec_price: Number(e.target.value) })} className="h-9 text-sm w-20 text-right" placeholder="rec" />
                  <select value={r.unit} onChange={e => updateRate(i, { unit: e.target.value })} className="h-9 text-sm border border-gray-200 rounded px-2">
                    <option value="ud">ud</option><option value="hora">hora</option><option value="m²">m²</option><option value="ml">ml</option>
                  </select>
                  <button onClick={() => removeRate(i)} className="text-red-400 hover:text-red-600 ml-auto"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={addRate} className="gap-1.5"><Plus className="h-3.5 w-3.5" />Añadir</Button>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium px-3 h-8 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer text-gray-600">
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importRates(f) }} />
                <Upload className="h-3.5 w-3.5" />Importar Excel
              </label>
              <Button size="sm" className="ml-auto" onClick={saveRates} disabled={savingRates}>{savingRates ? 'Guardando…' : 'Guardar tarifas'}</Button>
            </div>
          </div>

          {/* Base de conocimiento */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Mis ejemplos y documentos</h3>
            {professional && <ProKnowledgeManager professionalId={professional.id} orgId={professional.org_id} proToken={token} />}
          </div>

          {/* Aportar a la biblioteca de la empresa */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Aportar a la biblioteca de la empresa</h3>
            <p className="text-xs text-gray-400">Sube presupuestos reales tuyos (PDF con texto, Excel o Word). Mejoran el motor para todos.</p>
            <label className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 h-9 rounded-md border cursor-pointer text-gray-600 ${contributing ? 'opacity-60 pointer-events-none' : 'border-gray-200 hover:bg-gray-50'}`}>
              <input type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,.txt" className="hidden" disabled={contributing}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) contributeToLibrary(f) }} />
              <Upload className="h-3.5 w-3.5" />{contributing ? 'Procesando…' : 'Subir presupuesto'}
            </label>
          </div>
        </div>
      </div>
    )
  }

  if (ownEditing) {
    const sub = ownLines.reduce((s, l) => s + (l.total || 0), 0)
    const vatAmt = Math.round(sub * (ownDraft.vat_percent || 0)) / 100
    const tot = Math.round((sub + vatAmt) * 100) / 100
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Header proName={professional?.name} />
        <div className="max-w-lg mx-auto w-full px-4 py-6 space-y-4">
          <button onClick={() => setOwnEditing(false)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft className="h-4 w-4" />Volver</button>

          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <h2 className="text-lg font-bold text-gray-900">{ownDraft.id ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
            <p className="text-xs text-gray-400">Para tus propios trabajos. La IA usa tus tarifas y la biblioteca de la empresa.</p>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Cliente</label>
              <Input value={ownDraft.client_name} onChange={e => setOwnDraft(d => ({ ...d, client_name: e.target.value }))} placeholder="Nombre del cliente" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Trabajo a presupuestar</label>
              <Textarea rows={3} value={ownDraft.concept} onChange={e => setOwnDraft(d => ({ ...d, concept: e.target.value }))} placeholder="Describe el trabajo: p. ej. Cambiar 3 radiadores y purgar el circuito en piso de 90 m²…" />
            </div>
            <Button className="w-full gap-1.5" onClick={generateOwn} disabled={genOwn}><Sparkles className="h-4 w-4" />{genOwn ? 'Generando…' : 'Generar con IA'}</Button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Líneas del presupuesto</h3>
            {ownLines.length === 0 && <p className="text-xs text-gray-400">Genera con IA o añade líneas a mano.</p>}
            {ownLines.map((l, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-2 space-y-1.5">
                <Input value={l.concept} onChange={e => updateOwnLine(i, { concept: e.target.value })} placeholder="Concepto" className="h-9 text-sm" />
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} value={l.units} onChange={e => updateOwnLine(i, { units: Number(e.target.value) })} className="h-9 text-sm w-16 text-center" />
                  <span className="text-xs text-gray-400">×</span>
                  <Input type="number" min={0} step="0.01" value={l.unit_price} onChange={e => updateOwnLine(i, { unit_price: Number(e.target.value) })} className="h-9 text-sm w-24 text-right" />
                  <span className="ml-auto text-sm font-semibold">{formatCurrency(l.total)}</span>
                  <button onClick={() => removeOwnLine(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={addOwnLine} className="gap-1.5"><Plus className="h-3.5 w-3.5" />Añadir línea</Button>
              <label className="text-xs text-gray-500 ml-auto flex items-center gap-1.5">IVA %
                <Input type="number" min={0} value={ownDraft.vat_percent} onChange={e => setOwnDraft(d => ({ ...d, vat_percent: Number(e.target.value) }))} className="h-8 w-16 text-right text-sm" />
              </label>
            </div>
            <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
              <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{formatCurrency(sub)}</span></div>
              <div className="flex justify-between text-gray-500"><span>IVA ({ownDraft.vat_percent}%)</span><span>{formatCurrency(vatAmt)}</span></div>
              <div className="flex justify-between font-bold text-primary-600"><span>Total</span><span>{formatCurrency(tot)}</span></div>
            </div>
          </div>

          <Button className="w-full" onClick={saveOwn} disabled={savingOwn || ownLines.length === 0}>{savingOwn ? 'Guardando…' : 'Guardar presupuesto'}</Button>
        </div>
      </div>
    )
  }

  if (selectedLead) {
    const cleanName = selectedLead.name.replace(/^nombre:\s*/i, '').trim()
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Header proName={professional?.name} />
        <div className="max-w-lg mx-auto w-full px-4 py-6 space-y-4">
          <button onClick={() => setSelectedLead(null)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" />Volver a mis trabajos
          </button>

          {/* Info del lead */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="h-1.5" style={{ backgroundColor: (selectedLead.board as unknown as { color: string })?.color ?? '#2563EB' }} />
            <div className="p-5 space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Cliente</p>
                <h2 className="text-lg font-bold text-gray-900">{cleanName}</h2>
              </div>
              {selectedLead.concept && (
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-primary-500" />
                  <span className="text-sm font-medium text-primary-600">{selectedLead.concept}</span>
                </div>
              )}
              {(selectedLead.zone || selectedLead.address) && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  {selectedLead.zone || selectedLead.address}
                </div>
              )}
              {selectedLead.notes && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1 font-medium">Trabajo a realizar</p>
                  <p className="text-sm text-gray-700">{selectedLead.notes}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                  {(selectedLead.column as unknown as { name: string })?.name ?? 'Sin estado'}
                </span>
              </div>
            </div>
          </div>

          {/* Contacto */}
          {selectedLead.phone && (
            <div className="grid grid-cols-2 gap-3">
              <a href={`tel:${selectedLead.phone}`}>
                <Button variant="outline" className="w-full gap-2 h-12 text-green-700 border-green-300 hover:bg-green-50">
                  <Phone className="h-4 w-4" />Llamar cliente
                </Button>
              </a>
              <a href={toWhatsApp(selectedLead.phone)} target="_blank" rel="noreferrer">
                <Button variant="outline" className="w-full gap-2 h-12 text-emerald-700 border-emerald-300 hover:bg-emerald-50">
                  <MessageCircle className="h-4 w-4" />WhatsApp cliente
                </Button>
              </a>
            </div>
          )}

          {/* Presupuesto del trabajo */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Presupuesto</h3>
            {(() => {
              const leadPartida = partidas.find(p => p.budget?.lead_id === selectedLead.id)
              if (leadPartida) {
                const stt = PARTIDA_STATUS[leadPartida.status]
                return (
                  <button onClick={() => openPartida(leadPartida)} className="w-full flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2.5 hover:bg-gray-50">
                    <div className="text-left min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">Tu presupuesto · {leadPartida.trade}</p>
                      <p className="text-xs text-gray-400">{formatCurrency(leadPartida.subtotal)} · pulsa para editar</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${stt.color}`}>{stt.label}</span>
                  </button>
                )
              }
              return (
                <>
                  <p className="text-xs text-gray-400">Aún no hay presupuesto para este trabajo. Genéralo con IA y quedará guardado.</p>
                  <Button className="w-full gap-1.5" onClick={() => generateProBudget(selectedLead)} disabled={generatingBudget}>
                    <Sparkles className="h-4 w-4" />{generatingBudget ? 'Generando…' : 'Generar presupuesto con IA'}
                  </Button>
                </>
              )
            })()}
          </div>

          {/* Mis notas */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-800">Mis notas</h3>
            {comments.length === 0 ? (
              <p className="text-sm text-gray-400">Sin notas aún</p>
            ) : (
              <div className="space-y-2">
                {comments.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-700">{c.content}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {new Date(c.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Textarea rows={2} placeholder="Escribe una nota…" value={newNote} onChange={e => setNewNote(e.target.value)}
                className="text-sm" />
              <Button size="sm" className="self-end" onClick={submitNote} disabled={!newNote.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Subir presupuesto */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Subir presupuesto / foto</h3>
            <p className="text-xs text-gray-400">Los archivos son visibles por la empresa</p>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload}
              accept=".pdf,.jpg,.jpeg,.png,.webp" />
            <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4" />{uploading ? 'Subiendo…' : 'Subir archivo'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header proName={professional?.name} />
      <main className="max-w-lg mx-auto w-full px-4 py-6 space-y-4">
        <button onClick={() => setShowConfig(true)} className="w-full flex items-center justify-between bg-white rounded-2xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><Settings className="h-4 w-4 text-gray-500" />Mis tarifas y ejemplos</span>
          <span className="text-xs text-primary-600">Configurar →</span>
        </button>

        {/* Presupuestos / partidas asignadas */}
        {partidas.length > 0 && (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><FileText className="h-5 w-5 text-primary-600" />Presupuestos asignados</h2>
              <p className="text-sm text-gray-400">Partidas que debes presupuestar o ejecutar</p>
            </div>
            {partidas.map(p => {
              const st = PARTIDA_STATUS[p.status]
              return (
                <button key={p.id} onClick={() => openPartida(p)}
                  className="w-full text-left bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow active:scale-[0.99] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{p.budget?.client_name ?? 'Cliente'}</p>
                      <p className="text-sm text-primary-600 font-medium flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" />{p.trade}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">{(p.lines?.length ?? 0)} línea{(p.lines?.length ?? 0) !== 1 ? 's' : ''}</span>
                    <span className="text-sm font-bold text-gray-900">{formatCurrency(p.subtotal)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Presupuestos de los clientes (con opciones) — ver y validar */}
        {budgets.length > 0 && (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><FileText className="h-5 w-5 text-primary-600" />Presupuestos de tus clientes</h2>
              <p className="text-sm text-gray-400">Revisa las opciones y valídalas. Al validar, el gestor recibe un aviso.</p>
            </div>
            {groupProBudgets(budgets).map(group => (
              <ProBudgetCard
                key={group[0].group_id ?? group[0].id}
                budgets={group}
                onValidate={validateBudget}
                onView={(x) => viewBudgetPdf(x as unknown as Budget, { name: professional?.company_name || professional?.name })}
              />
            ))}
          </div>
        )}

        {/* Mis presupuestos propios (trabajos del profesional) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary-600" />Mis presupuestos</h2>
              <p className="text-sm text-gray-400">Para tus propios trabajos, con IA</p>
            </div>
            <Button size="sm" className="gap-1.5 shrink-0" onClick={openOwnNew}><Plus className="h-4 w-4" />Nuevo</Button>
          </div>
          {ownBudgets.map(b => (
            <div key={b.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{b.client_name || 'Cliente'}</p>
                  <p className="text-sm text-gray-500 truncate">{b.concept || ''}</p>
                </div>
                <span className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(b.total)}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => ownPdf(b)}><Eye className="h-4 w-4" />PDF</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openOwnEdit(b)}><Settings className="h-4 w-4" />Editar</Button>
                <button onClick={() => deleteOwn(b.id)} className="text-red-400 hover:text-red-600 ml-auto"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <h2 className="text-lg font-bold text-gray-900">Mis trabajos asignados</h2>
          <p className="text-sm text-gray-400">{leads.length} trabajo{leads.length !== 1 ? 's' : ''} asignado{leads.length !== 1 ? 's' : ''}</p>
        </div>

        {leads.length === 0 ? (
          <div className="text-center py-12">
            <Wrench className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-sm">No tienes trabajos asignados por ahora</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map(lead => {
              const cleanName = lead.name.replace(/^nombre:\s*/i, '').trim()
              const boardColor = (lead.board as unknown as { color: string })?.color ?? '#2563EB'
              return (
                <button
                  key={lead.id}
                  className="w-full text-left bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow active:scale-[0.99]"
                  onClick={() => setSelectedLead(lead)}
                >
                  <div className="h-1" style={{ backgroundColor: boardColor }} />
                  <div className="p-4 space-y-2">
                    <p className="font-semibold text-gray-900">{cleanName}</p>
                    {lead.concept && (
                      <p className="text-sm text-primary-600 font-medium flex items-center gap-1.5">
                        <Wrench className="h-3.5 w-3.5" />{lead.concept}
                      </p>
                    )}
                    {(lead.zone || lead.address) && (
                      <p className="text-sm text-gray-500 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-gray-400" />{lead.zone || lead.address}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                        {(lead.column as unknown as { name: string })?.name ?? ''}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(lead.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function Header({ proName }: { proName?: string }) {
  return (
    <div className="bg-slate-900 px-4 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center">
          <Radar className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-white font-bold text-[15px]">TrackALead</span>
      </div>
      {proName && <span className="text-slate-400 text-sm">{proName}</span>}
    </div>
  )
}
