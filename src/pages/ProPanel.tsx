import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MapPin, Wrench, Upload, MessageCircle, Send, Radar, AlertCircle, ArrowLeft, FileText, Plus, Trash2, Check, X, Sparkles, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { generateBudget } from '@/lib/ai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/utils'
import { ProKnowledgeManager } from '@/components/ProKnowledgeManager'
import type { Professional, Lead, BudgetLine, BudgetPartida, PartidaStatus, ProRate } from '@/types'

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
  const [selectedPartida, setSelectedPartida] = useState<PanelPartida | null>(null)
  const [partidaLines, setPartidaLines]  = useState<BudgetLine[]>([])
  const [savingPartida, setSavingPartida] = useState(false)
  const [ownerId, setOwnerId]            = useState<string | null>(null)
  const [generatingBudget, setGeneratingBudget] = useState(false)
  const [showConfig, setShowConfig]      = useState(false)
  const [rates, setRates]                = useState<ProRate[]>([])
  const [savingRates, setSavingRates]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    loadProfessional()
  }, [token])

  useEffect(() => {
    if (selectedLead) loadComments(selectedLead.id)
  }, [selectedLead?.id])

  async function loadProfessional() {
    setLoading(true)
    const { data, error } = await supabase
      .from('professionals').select('*').eq('magic_token', token).eq('app_access', true).maybeSingle()
    if (error || !data) { setNotFound(true); setLoading(false); return }
    setProfessional(data)
    setRates(data.rates ?? [])

    // Dueño de la organización (para usar sus claves de IA al generar)
    const { data: org } = await supabase.from('organizations').select('owner_id').eq('id', data.org_id).maybeSingle()
    setOwnerId(org?.owner_id ?? null)

    // Actualizar last_access
    await supabase.from('professionals').update({ last_access: new Date().toISOString() }).eq('id', data.id)

    // Cargar leads asignados
    const { data: leadsData } = await supabase
      .from('leads')
      .select('*, column:board_columns(id,name,color), board:boards(id,name,color)')
      .eq('assigned_to', data.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    setLeads((leadsData ?? []) as PanelLead[])

    await loadPartidas(data.id)
    setLoading(false)
  }

  async function loadPartidas(proId: string) {
    const { data } = await supabase
      .from('budget_partidas')
      .select('*, budget:budgets(client_name, concept, lead_id, vat_percent)')
      .eq('professional_id', proId)
      .order('created_at', { ascending: false })
    setPartidas((data ?? []) as PanelPartida[])
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
    const { error } = await supabase.from('professionals').update({ rates }).eq('id', professional.id)
    setSavingRates(false)
    if (error) toast.error('Error al guardar'); else { toast.success('Tarifas guardadas'); setProfessional({ ...professional, rates }) }
  }

  // El profesional genera el presupuesto con IA (usa las claves del dueño de la org).
  async function generateProBudget(lead: PanelLead) {
    if (!professional) return
    setGeneratingBudget(true)
    try {
      const client = lead.name.replace(/^nombre:\s*/i, '').trim() || 'Cliente'
      const { fetchProKnowledgeText } = await import('@/lib/proKnowledge')
      const knowledge = await fetchProKnowledgeText(professional.id)
      const result = await generateBudget({
        clientName: client,
        concept: lead.concept || lead.notes || 'Trabajo',
        notes: lead.notes || undefined,
        zone: lead.zone || undefined,
        marginPercent: 20,
        proRates: professional.rates,
        userId: ownerId ?? undefined,
        knowledge,
      })
      const subtotal = result.subtotal
      const vatAmount = Math.round(subtotal * 21) / 100
      const total = Math.round((subtotal + vatAmount) * 100) / 100

      const { data: budget } = await supabase.from('budgets').insert({
        org_id: lead.org_id, lead_id: lead.id, professional_id: professional.id,
        client_name: client, client_phone: lead.phone || null, client_address: lead.address || null,
        concept: lead.concept || null, lines: result.lines, subtotal,
        vat_percent: 21, vat_amount: vatAmount, total,
        margin_percent: 20, validity_days: 30, notes: result.notes || null,
        status: 'draft', ai_generated: true,
      }).select().single()

      if (budget) {
        await supabase.from('budget_partidas').insert({
          budget_id: budget.id, org_id: lead.org_id, trade: lead.concept || 'General',
          professional_id: professional.id, lines: result.lines, subtotal, status: 'pending',
        })
        const { data: members } = await supabase.from('org_members').select('user_id').eq('org_id', lead.org_id)
        for (const m of members ?? []) {
          await supabase.from('notifications').insert({
            user_id: m.user_id,
            title: `🧾 ${professional.name} generó un presupuesto`,
            body: `${lead.concept ?? ''} · ${client} (${formatCurrency(total)})`,
            is_read: false,
          })
        }
      }
      toast.success('Presupuesto generado')
      await loadPartidas(professional.id)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el presupuesto')
    } finally {
      setGeneratingBudget(false)
    }
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
    const { error } = await supabase.from('budget_partidas').update({
      lines: partidaLines, subtotal, status, updated_at: new Date().toISOString(),
    }).eq('id', selectedPartida.id)
    if (error) { toast.error('Error al guardar'); setSavingPartida(false); return }

    // Notificar a la organización
    const { data: members } = await supabase.from('org_members').select('user_id').eq('org_id', selectedPartida.org_id)
    const statusLabel = newStatus ? PARTIDA_STATUS[newStatus].label : 'actualizada'
    for (const m of members ?? []) {
      await supabase.from('notifications').insert({
        user_id: m.user_id,
        title: `🧾 ${professional.name} — partida ${newStatus ? statusLabel.toLowerCase() : 'editada'}`,
        body: `${selectedPartida.trade} · ${selectedPartida.budget?.client_name ?? ''} (${formatCurrency(subtotal)})`,
        is_read: false,
      })
    }
    toast.success(newStatus ? `Partida marcada como ${statusLabel}` : 'Cambios guardados')
    setSavingPartida(false)
    await loadPartidas(professional.id)
    setSelectedPartida(prev => prev ? { ...prev, lines: partidaLines, subtotal, status } : prev)
  }

  async function loadComments(leadId: string) {
    const { data } = await supabase
      .from('lead_comments').select('id,content,created_at')
      .eq('lead_id', leadId).eq('is_professional', true).order('created_at')
    setComments(data ?? [])
  }

  async function submitNote() {
    if (!newNote.trim() || !selectedLead || !professional) return
    await supabase.from('lead_comments').insert({
      lead_id: selectedLead.id,
      user_id: null,         // sin user_id (acceso sin auth)
      content: newNote.trim(),
      is_professional: true,
    })
    // Notificar a la org
    const { data: members } = await supabase
      .from('org_members').select('user_id').eq('org_id', selectedLead.org_id)
    for (const m of members ?? []) {
      await supabase.from('notifications').insert({
        user_id: m.user_id,
        title: `📝 ${professional.name} dejó una nota`,
        body: `En lead: ${selectedLead.name} — ${newNote.substring(0, 80)}`,
        is_read: false,
      })
    }
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
      await supabase.from('lead_files').insert({
        lead_id: selectedLead.id, name: `[PROFESIONAL] ${file.name}`,
        url: urlData.publicUrl, type: file.type, size: file.size,
      })
      // Notificar a la org
      const { data: members } = await supabase
        .from('org_members').select('user_id').eq('org_id', selectedLead.org_id)
      for (const m of members ?? []) {
        await supabase.from('notifications').insert({
          user_id: m.user_id,
          title: `📎 ${professional.name} subió un archivo`,
          body: `${file.name} en lead: ${selectedLead.name}`,
          is_read: false,
        })
      }
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
            {professional && <ProKnowledgeManager professionalId={professional.id} orgId={professional.org_id} />}
          </div>
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
