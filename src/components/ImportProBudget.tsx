import { useState } from 'react'
import { Download, Upload, Sparkles, ArrowLeft, ArrowRight, X, AlertCircle, Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import { viewBudgetPdf } from '@/lib/budgetPdf'
import type { Budget, BudgetLine, Professional, Lead, ProRate } from '@/types'
import type { ExtractedBudget } from '@/lib/ai'

const r2 = (n: number) => Math.round(n * 100) / 100

// Normaliza un nombre para comparar (sin tildes, minúsculas, espacios colapsados)
function normName(s?: string | null): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Imagen a base64 JPEG (para la visión de la IA en escaneos/fotos)
function fileToImage(file: File): Promise<{ mime: string; data: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const max = 1500, scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d'); if (!ctx) { URL.revokeObjectURL(url); resolve(null); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const d = canvas.toDataURL('image/jpeg', 0.75); URL.revokeObjectURL(url)
      resolve({ mime: 'image/jpeg', data: d.split(',')[1] })
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

// "60 m2" → { qty: 60, unit: 'm²' }. Para alimentar tarifas del profesional.
function parseUds(uds: string): { qty: number; unit: string } {
  const m = (uds || '').match(/([\d.,]+)\s*(.*)/)
  if (!m) return { qty: 0, unit: 'ud' }
  const qty = Number(m[1].replace(/\./g, '').replace(',', '.')) || 0
  let unit = (m[2] || '').trim().toLowerCase()
  if (/m2|m²/.test(unit)) unit = 'm²'
  else if (/^d/.test(unit)) unit = 'día'
  else if (/^h/.test(unit)) unit = 'hora'
  else if (/ml|m\b/.test(unit)) unit = 'ml'
  else unit = 'ud'
  return { qty, unit }
}

// Aplica la comisión a las líneas originales → líneas del cliente (comisión oculta en el precio)
function applyCommission(ex: ExtractedBudget, type: 'percent' | 'fixed', value: number): BudgetLine[] {
  const flat = ex.sections.flatMap(s => s.lines)
  const origSub = flat.reduce((s, l) => s + l.total, 0)
  let lines: BudgetLine[]
  if (type === 'percent') {
    lines = flat.map(l => { const t = r2(l.total * (1 + value / 100)); return { concept: l.concept, units: 1, unit_price: t, total: t, uds_label: l.uds } })
  } else {
    lines = flat.map(l => { const extra = origSub > 0 ? value * (l.total / origSub) : 0; const t = r2(l.total + extra); return { concept: l.concept, units: 1, unit_price: t, total: t, uds_label: l.uds } })
    // Ajuste de redondeo para que el total cuadre con orig + fijo
    const target = r2(origSub + value), got = r2(lines.reduce((s, l) => s + l.total, 0)), diff = r2(target - got)
    if (diff !== 0 && lines.length) { const i = lines.reduce((mi, l, idx, a) => l.total > a[mi].total ? idx : mi, 0); lines[i] = { ...lines[i], total: r2(lines[i].total + diff), unit_price: r2(lines[i].unit_price + diff) } }
  }
  return lines
}

export function ImportProBudget({ professionals, leads, orgId, userId, onClose, onSaved }: {
  professionals: Professional[]; leads: Lead[]; orgId: string; userId: string | null
  onClose: () => void; onSaved: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [proId, setProId] = useState('')
  const [leadId, setLeadId] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedBudget | null>(null)
  const [error, setError] = useState('')
  const [commissionType, setCommissionType] = useState<'percent' | 'fixed'>('percent')
  const [commissionValue, setCommissionValue] = useState(15)
  const [iva, setIva] = useState(21)
  const [lines, setLines] = useState<BudgetLine[]>([])
  const [clientName, setClientName] = useState('')
  const [clientAddr, setClientAddr] = useState('')
  const [saving, setSaving] = useState(false)

  const pro = professionals.find(p => p.id === proId)
  const lead = leads.find(l => l.id === leadId)
  const origSubtotal = extracted ? r2(extracted.sections.flatMap(s => s.lines).reduce((s, l) => s + l.total, 0)) : 0
  const finalSubtotal = r2(lines.reduce((s, l) => s + (l.total || 0), 0))
  const comision = r2(finalSubtotal - origSubtotal)
  const ivaAmount = r2(finalSubtotal * (iva || 0) / 100)
  const total = r2(finalSubtotal + ivaAmount)

  async function handleFile(file: File) {
    setExtracting(true); setError('')
    try {
      let url: string | null = null
      try { const path = `budget-imports/${orgId}/${Date.now()}-${file.name}`; const { data: up } = await supabase.storage.from('lead-files').upload(path, file, { upsert: true }); if (up) url = supabase.storage.from('lead-files').getPublicUrl(up.path).data.publicUrl } catch { /* opcional */ }
      setFileUrl(url)
      let text = ''; let images: { mime: string; data: string }[] = []
      if (file.type.startsWith('image/')) { const img = await fileToImage(file); if (img) images = [img] }
      else {
        const { extractKnowledgeText, pdfToImages } = await import('@/lib/extractText')
        text = await extractKnowledgeText(file)
        if ((file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) && text.trim().length < 100) images = await pdfToImages(file, 8)
      }
      if (!text.trim() && !images.length) { setError('No se pudo leer el documento (¿formato no soportado?).'); return }
      const { extractBudgetDocument } = await import('@/lib/ai')
      const ex = await extractBudgetDocument({ text, images, issuerName: pro?.company_name || pro?.name })
      if (ex.sections.reduce((s, sec) => s + sec.lines.length, 0) === 0) { setError('No se detectaron partidas de precio en este documento. Revisa que el archivo sea legible.'); return }
      setExtracted(ex); setFileName(file.name)
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al leer el documento') }
    finally { setExtracting(false) }
  }

  function goStep2() {
    if (!proId) { toast.error('Elige el profesional'); return }
    if (!extracted) { toast.error('Sube el presupuesto del profesional'); return }
    // Nombre de cliente: si la IA devolvió al propio profesional como cliente, lo descartamos
    const exName = extracted.client.name?.trim() || ''
    const isPro = !!pro && (normName(exName) === normName(pro.name) || (!!pro.company_name && normName(exName) === normName(pro.company_name)))
    setClientName(isPro ? '' : exName)
    setClientAddr(extracted.client.address?.trim() || '')
    setStep(2)
  }
  function goStep3() {
    setLines(applyCommission(extracted!, commissionType, commissionValue))
    setStep(3)
  }
  function updateLine(i: number, patch: Partial<BudgetLine>) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch, unit_price: patch.total ?? l.unit_price } : l)) }
  function removeLine(i: number) { setLines(prev => prev.filter((_, idx) => idx !== i)) }

  async function mergeRates() {
    if (!pro || !extracted) return
    const rates: ProRate[] = [...(pro.rates ?? [])]
    for (const l of extracted.sections.flatMap(s => s.lines)) {
      const { qty, unit } = parseUds(l.uds)
      const unitPrice = qty > 0 ? r2(l.total / qty) : r2(l.total)
      const key = l.concept.trim().toLowerCase()
      const idx = rates.findIndex(r => r.work_type.trim().toLowerCase() === key)
      if (idx >= 0) rates[idx] = { ...rates[idx], rec_price: unitPrice, unit: qty > 0 ? unit : rates[idx].unit }
      else rates.push({ work_type: l.concept.trim(), min_price: unitPrice, rec_price: unitPrice, unit: qty > 0 ? unit : 'ud' })
    }
    await supabase.from('professionals').update({ rates }).eq('id', pro.id)
  }

  async function save(withPdf: boolean) {
    if (!pro) { setError('No se encuentra el profesional seleccionado. Vuelve al paso 1 y elígelo de nuevo.'); return }
    if (!lines.length) { setError('No hay partidas que guardar.'); return }
    setSaving(true); setError('')
    try {
      const finalClientName = clientName.trim() || lead?.name || 'Cliente'
      const clientAddress = clientAddr.trim() || lead?.address || null
      const concept = extracted?.sections.map(s => s.title).filter(Boolean).join(' + ') || (pro.specialty ? `Trabajo de ${pro.specialty}` : 'Presupuesto')

      // 1) Crear el presupuesto del cliente (PASO CRÍTICO — líneas con comisión ya aplicada)
      const payload = {
        org_id: orgId, lead_id: leadId || null, professional_id: pro.id, created_by: userId,
        client_name: finalClientName, client_phone: lead?.phone ?? null, client_address: clientAddress,
        concept, lines, subtotal: finalSubtotal, vat_percent: iva, vat_amount: ivaAmount, total,
        margin_percent: 0, validity_days: 30, notes: null, status: 'draft', ai_generated: false,
        commission_amount: comision,  // comisión exacta: subtotal final − subtotal del profesional
      }
      const { data: budget, error: bErr } = await supabase.from('budgets').insert(payload).select().single()
      if (bErr || !budget) {
        console.error('[ImportProBudget] Falló el insert en budgets:', bErr, payload)
        throw new Error(bErr?.message ? `No se pudo guardar el presupuesto: ${bErr.message}` : 'No se pudo guardar el presupuesto (respuesta vacía de la base de datos).')
      }

      // A partir de aquí el presupuesto YA existe: los pasos secundarios no deben tumbarlo ni ocultar su éxito.
      // 2) Auditoría del import (comisión interna)
      try {
        await supabase.from('professional_imported_budgets').insert({
          org_id: orgId, professional_id: pro.id, lead_id: leadId || null, budget_id: budget.id,
          source_file_url: fileUrl, extracted_json: extracted, commission_type: commissionType, commission_value: commissionValue,
          original_subtotal: origSubtotal, final_subtotal: finalSubtotal,
        })
      } catch (e) { console.warn('[ImportProBudget] auditoría no guardada (no crítico):', e) }

      // 3) Alimentar tarifas del profesional y la biblioteca (para la IA)
      try { await mergeRates() } catch (e) { console.warn('[ImportProBudget] tarifas no actualizadas (no crítico):', e) }
      try {
        const libText = `Presupuesto real de ${pro.company_name || pro.name}${finalClientName ? ` — cliente ${finalClientName}` : ''}\n` +
          (extracted?.sections ?? []).map(s => `${s.title ? `# ${s.title}\n` : ''}${s.lines.map(l => `- ${l.concept} | ${l.uds} | ${l.total} €`).join('\n')}`).join('\n')
        await supabase.from('budget_library').insert({ org_id: orgId, title: `Import ${pro.name} · ${finalClientName}`, gremio: pro.specialty ?? null, content_text: libText.slice(0, 40000), file_url: fileUrl, source: 'pro', professional_id: pro.id })
      } catch (e) { console.warn('[ImportProBudget] biblioteca no actualizada (no crítico):', e) }

      // 4) PDF del cliente (membrete del profesional, sin precio unitario) — solo si se pide
      if (withPdf) {
        try {
          const addr = [pro.address, pro.cif ? `NIF: ${pro.cif}` : null].filter(Boolean).join('  ·  ')
          const issuer = { name: pro.company_name || pro.name, phone: pro.phone, email: pro.email, address: addr || null, logoUrl: pro.logo_url ?? null }
          viewBudgetPdf({ ...(budget as Budget), lines }, issuer, { hideUnitPrice: true })
        } catch (e) { console.warn('[ImportProBudget] PDF no generado (no crítico):', e) }
      }

      toast.success(withPdf ? 'Presupuesto creado · generando PDF' : 'Presupuesto creado. Lo tienes en la lista de Presupuestos.')
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      console.error('[ImportProBudget] save() error:', e)
      setError(msg)
      toast.error(msg)
    }
    finally { setSaving(false) }
  }

  const proWarn = pro && (!pro.cif || !pro.address)

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-primary-600" />Importar de profesional · Paso {step}/3</DialogTitle></DialogHeader>

        {/* Paso 1: profesional + lead + archivo */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Profesional *</Label>
              <Select value={proId} onValueChange={setProId}>
                <SelectTrigger><SelectValue placeholder="Elige el profesional" /></SelectTrigger>
                <SelectContent>{professionals.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.specialty ? ` · ${p.specialty}` : ''}</SelectItem>)}</SelectContent>
              </Select>
              {proWarn && <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" />Este profesional no tiene NIF/dirección completos. Revísalo en su ficha para que el presupuesto sea válido.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Lead (opcional)</Label>
              <Select value={leadId || 'none'} onValueChange={v => setLeadId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Sin asociar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asociar</SelectItem>
                  {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.name}{l.concept ? ` · ${l.concept}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400">Si lo asocias, el presupuesto aparecerá en la ficha de ese lead.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Presupuesto del profesional *</Label>
              {extracted ? (
                <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2 min-w-0">
                  <span className="text-sm text-green-700 flex-1 min-w-0 truncate">✓ {fileName} — {extracted.sections.flatMap(s => s.lines).length} partida(s) leídas</span>
                  <button onClick={() => { setExtracted(null); setFileName(''); setFileUrl(null) }} className="text-gray-400 hover:text-red-500 shrink-0"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 cursor-pointer ${extracting ? 'opacity-60 pointer-events-none' : 'border-gray-300 hover:border-primary-400'} text-gray-500`}>
                  <input type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,image/*" className="hidden" disabled={extracting} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f) }} />
                  {extracting ? <><Sparkles className="h-6 w-6 animate-pulse" />Leyendo el presupuesto con IA…</> : <><Upload className="h-6 w-6" /><span className="text-sm font-medium">Sube el PDF/Excel/Word/foto</span></>}
                </label>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={goStep2} disabled={!proId || !extracted} className="gap-1.5">Continuar <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {/* Paso 2: comisión + IVA */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Comisión</Label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setCommissionType('percent')} className={`rounded-lg border p-3 text-left ${commissionType === 'percent' ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-gray-200'}`}>
                  <p className="text-sm font-semibold text-gray-800">Porcentaje</p><p className="text-[11px] text-gray-400">% sobre cada partida</p>
                </button>
                <button onClick={() => setCommissionType('fixed')} className={`rounded-lg border p-3 text-left ${commissionType === 'fixed' ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-gray-200'}`}>
                  <p className="text-sm font-semibold text-gray-800">Cantidad fija</p><p className="text-[11px] text-gray-400">€ repartidos entre las partidas</p>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} step={commissionType === 'percent' ? '0.5' : '1'} value={commissionValue} onChange={e => setCommissionValue(Number(e.target.value))} className="h-10 w-28 text-right" />
                <span className="text-sm text-gray-500">{commissionType === 'percent' ? '%' : '€ (total)'}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>IVA (%)</Label>
              <Input type="number" min={0} value={iva} onChange={e => setIva(Number(e.target.value))} className="h-10 w-28 text-right" />
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-sm text-gray-600">
              Subtotal del profesional: <strong>{formatCurrency(origSubtotal)}</strong> → con comisión: <strong className="text-primary-700">{formatCurrency(commissionType === 'percent' ? r2(origSubtotal * (1 + commissionValue / 100)) : r2(origSubtotal + commissionValue))}</strong>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Atrás</Button>
              <Button onClick={goStep3} className="gap-1.5">Revisar <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {/* Paso 3: revisión */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cliente {clientName.trim() ? '' : <span className="text-amber-600 text-[11px] font-normal">· revísalo</span>}</Label>
                <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nombre del cliente" className="h-10" />
              </div>
              <div className="space-y-1.5">
                <Label>Dirección <span className="text-gray-400 text-[11px] font-normal">(opcional)</span></Label>
                <Input value={clientAddr} onChange={e => setClientAddr(e.target.value)} placeholder="Dirección del cliente" className="h-10" />
              </div>
            </div>
            {!clientName.trim() && (
              <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" />No hemos detectado el cliente con seguridad (el documento parece una factura del profesional). Escríbelo aquí; luego la lista podrá vincularlo a su lead.</p>
            )}
            <div className="border border-gray-100 rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[440px]">
                <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                  <th className="text-left px-3 py-2">Concepto</th><th className="text-left px-2 py-2 w-20">Uds.</th><th className="text-right px-2 py-2 w-28">Total</th><th className="w-8"></th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1"><Input value={l.concept} onChange={e => updateLine(i, { concept: e.target.value })} className="h-8 text-xs border-0 focus-visible:ring-1" /></td>
                      <td className="px-2 py-1"><Input value={l.uds_label ?? ''} onChange={e => updateLine(i, { uds_label: e.target.value })} className="h-8 text-xs border-0 focus-visible:ring-1" /></td>
                      <td className="px-2 py-1"><Input type="number" min={0} step="0.01" value={l.total} onChange={e => updateLine(i, { total: Number(e.target.value) })} className="h-8 text-xs text-right border-0 focus-visible:ring-1" /></td>
                      <td className="px-1 text-center"><button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Aviso interno (no sale en el PDF) */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              🔒 <strong>Interno:</strong> Comisión aplicada: {commissionType === 'percent' ? `${commissionValue}%` : `${formatCurrency(commissionValue)} fijos`} · Subtotal profesional: {formatCurrency(origSubtotal)} · Subtotal final: {formatCurrency(finalSubtotal)} · <strong>Os quedáis {formatCurrency(comision)}</strong>. Esto no aparece en el PDF del cliente.
            </div>
            <div className="flex justify-end gap-4 text-sm">
              <span className="text-gray-500">Subtotal <strong className="text-gray-800">{formatCurrency(finalSubtotal)}</strong></span>
              <span className="text-gray-500">IVA ({iva}%) <strong className="text-gray-800">{formatCurrency(ivaAmount)}</strong></span>
              <span className="text-primary-700 font-bold">Total {formatCurrency(total)}</span>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
              <Button variant="ghost" onClick={() => setStep(2)} disabled={saving} className="gap-1.5 text-gray-500"><ArrowLeft className="h-4 w-4" />Atrás</Button>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => save(false)} disabled={saving || lines.length === 0} className="gap-1.5">
                  <Check className="h-4 w-4" />{saving ? 'Guardando…' : 'Solo guardar'}
                </Button>
                <Button onClick={() => save(true)} disabled={saving || lines.length === 0} className="gap-1.5">
                  <Download className="h-4 w-4" />{saving ? 'Guardando…' : 'Guardar y generar PDF'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
