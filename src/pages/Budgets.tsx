import { useEffect, useMemo, useState } from 'react'
import {
  FileText, Plus, Sparkles, Download, Pencil, Trash2, Search,
  ArrowLeft, ArrowRight, Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { generateBudget } from '@/lib/ai'
import { exportBudgetPdf } from '@/lib/budgetPdf'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Budget, BudgetLine, BudgetStatus, Lead, Professional } from '@/types'

const STATUS_META: Record<BudgetStatus, { label: string; color: string }> = {
  draft:    { label: 'Borrador', color: 'bg-gray-100 text-gray-600' },
  sent:     { label: 'Enviado',  color: 'bg-blue-100 text-blue-700' },
  accepted: { label: 'Aceptado', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rechazado',color: 'bg-red-100 text-red-700' },
}

interface Draft {
  id?: string
  lead_id: string | null
  client_name: string
  client_phone: string
  client_address: string
  concept: string
  work_notes: string
  professional_id: string | null
  margin_percent: number
  ai_instructions: string
  lines: BudgetLine[]
  vat_percent: number
  validity_days: number
  notes: string
  status: BudgetStatus
}

function emptyDraft(): Draft {
  return {
    lead_id: null, client_name: '', client_phone: '', client_address: '', concept: '',
    work_notes: '', professional_id: null, margin_percent: 20, ai_instructions: '',
    lines: [], vat_percent: 21, validity_days: 30, notes: '', status: 'draft',
  }
}

function recalc(lines: BudgetLine[], vatPercent: number) {
  const subtotal = Math.round(lines.reduce((s, l) => s + (l.total || 0), 0) * 100) / 100
  const vat_amount = Math.round(subtotal * vatPercent) / 100
  const total = Math.round((subtotal + vat_amount) * 100) / 100
  return { subtotal, vat_amount, total }
}

export function Budgets() {
  const { organization, user } = useAuth()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editDraft, setEditDraft] = useState<Draft | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [professionals, setProfessionals] = useState<Professional[]>([])

  useEffect(() => {
    if (!organization) return
    loadBudgets()
    loadLeadsAndPros()
  }, [organization?.id])

  async function loadBudgets() {
    setLoading(true)
    const { data } = await supabase.from('budgets').select('*').eq('org_id', organization!.id).order('created_at', { ascending: false })
    setBudgets((data ?? []) as Budget[])
    setLoading(false)
  }

  async function loadLeadsAndPros() {
    const [{ data: leadsData }, { data: prosData }] = await Promise.all([
      supabase.from('leads').select('id, name, phone, address, concept, zone, notes').eq('org_id', organization!.id).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('professionals').select('*').eq('org_id', organization!.id).eq('is_active', true).order('name'),
    ])
    setLeads((leadsData ?? []) as Lead[])
    setProfessionals((prosData ?? []) as Professional[])
  }

  function openNew() {
    setEditDraft(emptyDraft())
    setWizardOpen(true)
  }

  function openEdit(b: Budget) {
    setEditDraft({
      id: b.id,
      lead_id: b.lead_id,
      client_name: b.client_name ?? '',
      client_phone: b.client_phone ?? '',
      client_address: b.client_address ?? '',
      concept: b.concept ?? '',
      work_notes: '',
      professional_id: null,
      margin_percent: b.margin_percent ?? 20,
      ai_instructions: '',
      lines: b.lines ?? [],
      vat_percent: b.vat_percent ?? 21,
      validity_days: b.validity_days ?? 30,
      notes: b.notes ?? '',
      status: b.status ?? 'draft',
    })
    setWizardOpen(true)
  }

  async function handleDelete(id: string) {
    await supabase.from('budgets').delete().eq('id', id)
    toast.success('Presupuesto eliminado')
    setBudgets(prev => prev.filter(b => b.id !== id))
  }

  function exportPdf(b: Budget) {
    exportBudgetPdf(b, { name: organization?.name })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Presupuestos</h1>
          <p className="text-gray-500 text-sm mt-1">Genera presupuestos profesionales con IA</p>
        </div>
        <Button onClick={openNew} className="gap-1.5">
          <Sparkles className="h-4 w-4" />Generar presupuesto con IA
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Sin presupuestos</h3>
          <p className="text-gray-500 text-sm mt-1">Genera tu primer presupuesto con IA a partir de un lead</p>
          <Button className="mt-4 gap-1.5" onClick={openNew}><Sparkles className="h-4 w-4" />Generar presupuesto con IA</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-left px-3 py-3">Concepto</th>
                  <th className="text-right px-3 py-3">Total</th>
                  <th className="text-left px-3 py-3">Estado</th>
                  <th className="text-left px-3 py-3">Fecha</th>
                  <th className="text-center px-3 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {budgets.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{b.client_name || '—'}</td>
                    <td className="px-3 py-3 text-gray-500 max-w-[220px] truncate">{b.concept || '—'}</td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-900">{formatCurrency(b.total)}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_META[b.status]?.color ?? STATUS_META.draft.color}`}>
                        {STATUS_META[b.status]?.label ?? b.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400">{formatDate(b.created_at)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(b)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Ver / Editar"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => exportPdf(b)} className="p-1.5 rounded hover:bg-blue-50 text-blue-500" title="Exportar PDF"><Download className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(b.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {wizardOpen && editDraft && (
        <BudgetWizard
          initial={editDraft}
          leads={leads}
          professionals={professionals}
          orgId={organization!.id}
          userId={user?.id ?? null}
          orgName={organization?.name}
          onClose={() => setWizardOpen(false)}
          onSaved={() => { loadBudgets() }}
        />
      )}
    </div>
  )
}

// ── Asistente de generación (4 pasos) ──────────────────────────────────────────
function BudgetWizard({ initial, leads, professionals, orgId, userId, orgName, onClose, onSaved }: {
  initial: Draft
  leads: Lead[]
  professionals: Professional[]
  orgId: string
  userId: string | null
  orgName?: string
  onClose: () => void
  onSaved: () => void
}) {
  // Si viene con líneas (edición), empezamos en el paso 3
  const [step, setStep] = useState(initial.lines.length > 0 || initial.id ? 3 : 1)
  const [draft, setDraft] = useState<Draft>(initial)
  const [leadSearch, setLeadSearch] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(initial.id ?? null)

  const totals = useMemo(() => recalc(draft.lines, draft.vat_percent), [draft.lines, draft.vat_percent])

  const filteredLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase()
    if (!q) return leads.slice(0, 30)
    return leads.filter(l =>
      l.name?.toLowerCase().includes(q) ||
      l.concept?.toLowerCase().includes(q) ||
      l.phone?.toLowerCase().includes(q)
    ).slice(0, 30)
  }, [leads, leadSearch])

  function pickLead(l: Lead) {
    setDraft(d => ({
      ...d,
      lead_id: l.id,
      client_name: l.name ?? '',
      client_phone: l.phone ?? '',
      client_address: l.address ?? '',
      concept: l.concept ?? '',
      work_notes: l.notes ?? '',
    }))
    setStep(2)
  }

  async function handleGenerate() {
    if (!draft.concept.trim() && !draft.work_notes.trim()) {
      toast.error('El lead no tiene concepto ni notas para generar')
      return
    }
    setGenerating(true)
    try {
      const pro = professionals.find(p => p.id === draft.professional_id)
      const zone = leads.find(l => l.id === draft.lead_id)?.zone ?? undefined
      const result = await generateBudget({
        clientName: draft.client_name || 'Cliente',
        concept: draft.concept || draft.work_notes,
        notes: draft.work_notes,
        zone,
        marginPercent: draft.margin_percent,
        proRates: pro?.rates,
        extraInstructions: draft.ai_instructions,
      })
      setDraft(d => ({ ...d, lines: result.lines, notes: result.notes || d.notes }))
      toast.success('Presupuesto generado con IA')
      setStep(3)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al generar con IA')
      // Avanzar igualmente para edición manual
      setDraft(d => ({ ...d, lines: d.lines.length ? d.lines : [{ concept: '', units: 1, unit_price: 0, total: 0 }] }))
      setStep(3)
    } finally {
      setGenerating(false)
    }
  }

  function updateLine(i: number, patch: Partial<BudgetLine>) {
    setDraft(d => {
      const lines = d.lines.map((l, idx) => {
        if (idx !== i) return l
        const next = { ...l, ...patch }
        next.total = Math.round((Number(next.units) || 0) * (Number(next.unit_price) || 0) * 100) / 100
        return next
      })
      return { ...d, lines }
    })
  }
  function addLine() {
    setDraft(d => ({ ...d, lines: [...d.lines, { concept: '', units: 1, unit_price: 0, total: 0 }] }))
  }
  function removeLine(i: number) {
    setDraft(d => ({ ...d, lines: d.lines.filter((_, idx) => idx !== i) }))
  }

  async function save(): Promise<Budget | null> {
    if (!draft.client_name.trim()) { toast.error('Falta el nombre del cliente'); return null }
    if (draft.lines.length === 0) { toast.error('Añade al menos una línea'); return null }
    setSaving(true)
    const payload = {
      org_id: orgId,
      lead_id: draft.lead_id,
      created_by: userId,
      client_name: draft.client_name,
      client_phone: draft.client_phone || null,
      client_address: draft.client_address || null,
      concept: draft.concept || null,
      lines: draft.lines,
      subtotal: totals.subtotal,
      vat_percent: draft.vat_percent,
      vat_amount: totals.vat_amount,
      total: totals.total,
      margin_percent: draft.margin_percent,
      validity_days: draft.validity_days,
      notes: draft.notes || null,
      status: draft.status,
      ai_generated: true,
      updated_at: new Date().toISOString(),
    }
    try {
      let result: Budget | null = null
      if (savedId) {
        const { data } = await supabase.from('budgets').update(payload).eq('id', savedId).select().single()
        result = data as Budget
      } else {
        const { data } = await supabase.from('budgets').insert(payload).select().single()
        result = data as Budget
        if (result) setSavedId(result.id)
      }
      toast.success('Presupuesto guardado')
      onSaved()
      return result
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleExport() {
    const saved = await save()
    if (saved) exportBudgetPdf(saved, { name: orgName })
  }

  const STEPS = ['Lead', 'Configurar', 'Revisar', 'Exportar']

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{savedId ? 'Editar presupuesto' : 'Generar presupuesto con IA'}</DialogTitle></DialogHeader>

        {/* Indicador de pasos */}
        <div className="flex items-center gap-1.5 mb-2">
          {STEPS.map((label, i) => {
            const n = i + 1
            const active = step === n
            const done = step > n
            return (
              <div key={label} className="flex items-center gap-1.5 flex-1">
                <div className={`flex items-center gap-1.5 ${active ? 'text-primary-600' : done ? 'text-green-600' : 'text-gray-300'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${active ? 'bg-primary-600 text-white' : done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {done ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className="text-xs font-medium hidden sm:inline">{label}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-px ${done ? 'bg-green-400' : 'bg-gray-200'}`} />}
              </div>
            )
          })}
        </div>

        {/* ── Paso 1: seleccionar lead ─────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Buscar lead por nombre, concepto o teléfono…" value={leadSearch} onChange={e => setLeadSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {filteredLeads.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No se encontraron leads</p>
              ) : filteredLeads.map(l => (
                <button key={l.id} onClick={() => pickLead(l)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors">
                  <p className="text-sm font-medium text-gray-900">{l.name}</p>
                  <p className="text-xs text-gray-400">{[l.concept, l.zone, l.phone].filter(Boolean).join(' · ') || 'Sin detalles'}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400">Selecciona el lead para prellenar los datos del cliente.</p>
          </div>
        )}

        {/* ── Paso 2: configurar ───────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-900">{draft.client_name || 'Cliente'}</p>
              <p className="text-xs text-gray-400">{[draft.concept, draft.client_phone].filter(Boolean).join(' · ') || '—'}</p>
            </div>

            <div className="space-y-1.5">
              <Label>Profesional asignado (opcional)</Label>
              <Select value={draft.professional_id ?? 'none'} onValueChange={v => setDraft(d => ({ ...d, professional_id: v === 'none' ? null : v }))}>
                <SelectTrigger><SelectValue placeholder="Sin profesional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin profesional</SelectItem>
                  {professionals.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.rates?.length ? ` (${p.rates.length} tarifas)` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400">Si tiene tarifas configuradas, la IA las usará como referencia.</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Margen adicional</Label>
                <span className="text-sm font-bold text-primary-600">{draft.margin_percent}%</span>
              </div>
              <input
                type="range" min={0} max={50} step={5}
                value={draft.margin_percent}
                onChange={e => setDraft(d => ({ ...d, margin_percent: Number(e.target.value) }))}
                className="w-full accent-primary-600"
              />
              <p className="text-[11px] text-gray-400">Por defecto 20% para asegurar margen ("tirar para arriba").</p>
            </div>

            <div className="space-y-1.5">
              <Label>Notas adicionales para la IA (opcional)</Label>
              <Textarea rows={3} placeholder="Ej: incluir retirada de escombros, material de gama media…" value={draft.ai_instructions} onChange={e => setDraft(d => ({ ...d, ai_instructions: e.target.value }))} />
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Atrás</Button>
              <Button onClick={handleGenerate} disabled={generating} className="gap-1.5">
                <Sparkles className="h-4 w-4" />{generating ? 'Generando…' : 'Generar con IA'}
              </Button>
            </div>
          </div>
        )}

        {/* ── Paso 3: revisar y editar ─────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Datos cliente editables */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <Input value={draft.client_name} onChange={e => setDraft(d => ({ ...d, client_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Concepto</Label>
                <Input value={draft.concept} onChange={e => setDraft(d => ({ ...d, concept: e.target.value }))} />
              </div>
            </div>

            {/* Tabla de líneas */}
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                    <th className="text-left px-2 py-2">Concepto</th>
                    <th className="text-center px-2 py-2 w-16">Uds.</th>
                    <th className="text-right px-2 py-2 w-24">Precio/ud</th>
                    <th className="text-right px-2 py-2 w-24">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {draft.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-1 py-1">
                        <Input value={l.concept} onChange={e => updateLine(i, { concept: e.target.value })} className="h-8 text-xs border-0 focus-visible:ring-1" placeholder="Concepto…" />
                      </td>
                      <td className="px-1 py-1">
                        <Input type="number" min={0} value={l.units} onChange={e => updateLine(i, { units: Number(e.target.value) })} className="h-8 text-xs text-center border-0 focus-visible:ring-1" />
                      </td>
                      <td className="px-1 py-1">
                        <Input type="number" min={0} step="0.01" value={l.unit_price} onChange={e => updateLine(i, { unit_price: Number(e.target.value) })} className="h-8 text-xs text-right border-0 focus-visible:ring-1" />
                      </td>
                      <td className="px-2 py-1 text-right font-semibold text-gray-800 text-xs">{formatCurrency(l.total)}</td>
                      <td className="px-1 py-1 text-center">
                        <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                  {draft.lines.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-xs text-gray-400 py-4">Sin líneas. Añade una.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Button variant="outline" size="sm" onClick={addLine} className="gap-1.5"><Plus className="h-3.5 w-3.5" />Añadir línea</Button>

            {/* Resumen + opciones */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>IVA</Label>
                  <Select value={String(draft.vat_percent)} onValueChange={v => setDraft(d => ({ ...d, vat_percent: Number(v) }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="21">21%</SelectItem>
                      <SelectItem value="0">0% (exento)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Validez</Label>
                  <Select value={String(draft.validity_days)} onValueChange={v => setDraft(d => ({ ...d, validity_days: Number(v) }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 días</SelectItem>
                      <SelectItem value="30">30 días</SelectItem>
                      <SelectItem value="60">60 días</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Estado</Label>
                  <Select value={draft.status} onValueChange={v => setDraft(d => ({ ...d, status: v as BudgetStatus }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Borrador</SelectItem>
                      <SelectItem value="sent">Enviado</SelectItem>
                      <SelectItem value="accepted">Aceptado</SelectItem>
                      <SelectItem value="rejected">Rechazado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 self-start">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Subtotal</span><span className="font-medium">{formatCurrency(totals.subtotal)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">IVA ({draft.vat_percent}%)</span><span className="font-medium">{formatCurrency(totals.vat_amount)}</span></div>
                <div className="flex justify-between text-base font-bold text-primary-600 border-t border-gray-200 pt-2"><span>TOTAL</span><span>{formatCurrency(totals.total)}</span></div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notas y condiciones</Label>
              <Textarea rows={3} placeholder="Condiciones de pago, garantía, exclusiones…" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <Button variant="outline" onClick={() => setStep(savedId ? 3 : 2)} className="gap-1.5" disabled={!!savedId}><ArrowLeft className="h-4 w-4" />Atrás</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
                <Button onClick={() => setStep(4)} className="gap-1.5">Siguiente<ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Paso 4: exportar ─────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4 text-center py-4">
            <div className="w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center mx-auto">
              <FileText className="h-7 w-7 text-primary-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Presupuesto listo</p>
              <p className="text-sm text-gray-400">{draft.client_name} · {formatCurrency(totals.total)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-left text-sm space-y-1 max-w-xs mx-auto">
              <div className="flex justify-between"><span className="text-gray-500">Líneas</span><span>{draft.lines.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">IVA</span><span>{formatCurrency(totals.vat_amount)}</span></div>
              <div className="flex justify-between font-bold text-primary-600"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(3)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Volver a editar</Button>
              <Button onClick={handleExport} disabled={saving} className="gap-1.5"><Download className="h-4 w-4" />Guardar y exportar PDF</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
