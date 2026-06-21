import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, RefreshCw, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { nextInvoiceNumber } from '@/lib/invoiceNumber'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/utils'
import type { Budget, BudgetLine, Invoice, InvoiceStatus } from '@/types'

const SERIES_KEY = 'invoice_series_default'

interface Draft {
  id?: string
  lead_id: string | null
  budget_id: string | null
  professional_id: string | null
  invoice_series: string
  auto_number: boolean
  invoice_number: string
  status: InvoiceStatus
  client_name: string; client_nif: string; client_address: string; client_email: string; client_phone: string
  items: BudgetLine[]
  tax_rate: number
  issue_date: string
  due_date: string
  payment_method: string
  notes: string
}

function emptyDraft(): Draft {
  return {
    lead_id: null, budget_id: null, professional_id: null,
    invoice_series: localStorage.getItem(SERIES_KEY) || 'A',
    auto_number: true, invoice_number: '', status: 'draft',
    client_name: '', client_nif: '', client_address: '', client_email: '', client_phone: '',
    items: [], tax_rate: 21,
    issue_date: new Date().toISOString().slice(0, 10), due_date: '', payment_method: 'transferencia', notes: '',
  }
}

function fromBudgetDraft(b: Budget, lead?: { name?: string | null; phone?: string | null; address?: string | null }): Draft {
  return {
    ...emptyDraft(),
    lead_id: b.lead_id, budget_id: b.id, professional_id: b.professional_id ?? null,
    client_name: b.client_name || lead?.name || '',
    client_phone: b.client_phone || lead?.phone || '',
    client_address: b.client_address || lead?.address || '',
    items: (b.lines ?? []).map(l => ({ ...l })),
    tax_rate: b.vat_percent ?? 21,
    notes: b.notes || '',
  }
}

function fromInvoiceDraft(inv: Invoice): Draft {
  return {
    id: inv.id, lead_id: inv.lead_id, budget_id: inv.budget_id, professional_id: inv.professional_id,
    invoice_series: inv.invoice_series || 'A', auto_number: false, invoice_number: inv.invoice_number, status: inv.status,
    client_name: inv.client_name || '', client_nif: inv.client_nif || '', client_address: inv.client_address || '',
    client_email: inv.client_email || '', client_phone: inv.client_phone || '',
    items: (inv.items ?? []).map(l => ({ ...l })), tax_rate: inv.tax_rate ?? 21,
    issue_date: inv.issue_date || new Date().toISOString().slice(0, 10), due_date: inv.due_date || '',
    payment_method: inv.payment_method || 'transferencia', notes: inv.notes || '',
  }
}

export function InvoiceForm({ open, onOpenChange, orgId, userId, fromBudget, lead, leadId, invoice, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orgId: string
  userId: string | null
  fromBudget?: Budget
  lead?: { name?: string | null; phone?: string | null; address?: string | null }
  leadId?: string
  invoice?: Invoice
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [saving, setSaving] = useState(false)

  // Inicializa el borrador al abrir
  useEffect(() => {
    if (!open) return
    if (invoice) setDraft(fromInvoiceDraft(invoice))
    else if (fromBudget) setDraft(fromBudgetDraft(fromBudget, lead))
    else setDraft({ ...emptyDraft(), lead_id: leadId ?? null,
      client_name: lead?.name ?? '', client_phone: lead?.phone ?? '', client_address: lead?.address ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Numeración automática: calcula el siguiente número de la serie
  useEffect(() => {
    if (!open || invoice) return
    if (draft.auto_number) {
      nextInvoiceNumber(orgId, draft.invoice_series).then(n => setDraft(d => ({ ...d, invoice_number: n })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.auto_number, draft.invoice_series])

  const totals = useMemo(() => {
    const subtotal = Math.round(draft.items.reduce((s, l) => s + (l.total || 0), 0) * 100) / 100
    const tax_amount = Math.round(subtotal * draft.tax_rate) / 100
    return { subtotal, tax_amount, total: Math.round((subtotal + tax_amount) * 100) / 100 }
  }, [draft.items, draft.tax_rate])

  function updateLine(i: number, patch: Partial<BudgetLine>) {
    setDraft(d => ({ ...d, items: d.items.map((l, idx) => {
      if (idx !== i) return l
      const n = { ...l, ...patch }
      n.total = Math.round((Number(n.units) || 0) * (Number(n.unit_price) || 0) * 100) / 100
      return n
    }) }))
  }
  const addLine = () => setDraft(d => ({ ...d, items: [...d.items, { concept: '', units: 1, unit_price: 0, total: 0 }] }))
  const removeLine = (i: number) => setDraft(d => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }))

  async function save() {
    if (!draft.client_name.trim()) { toast.error('Falta el nombre del cliente'); return }
    if (!draft.invoice_number.trim()) { toast.error('Falta el número de factura'); return }
    if (draft.items.length === 0) { toast.error('Añade al menos una línea'); return }
    setSaving(true)
    localStorage.setItem(SERIES_KEY, draft.invoice_series.trim())
    const payload = {
      org_id: orgId, lead_id: draft.lead_id, budget_id: draft.budget_id, professional_id: draft.professional_id,
      invoice_number: draft.invoice_number.trim(), invoice_series: draft.invoice_series.trim() || null, auto_number: draft.auto_number,
      status: draft.status,
      client_name: draft.client_name.trim(), client_nif: draft.client_nif.trim() || null, client_address: draft.client_address.trim() || null,
      client_email: draft.client_email.trim() || null, client_phone: draft.client_phone.trim() || null,
      items: draft.items, subtotal: totals.subtotal, tax_rate: draft.tax_rate, tax_amount: totals.tax_amount, total: totals.total,
      issue_date: draft.issue_date || null, due_date: draft.due_date || null,
      payment_method: draft.payment_method || null, notes: draft.notes.trim() || null,
      created_by: userId, updated_at: new Date().toISOString(),
    }
    try {
      if (draft.id) {
        const { error } = await supabase.from('invoices').update(payload).eq('id', draft.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('invoices').insert(payload)
        if (error) throw error
      }
      toast.success('Factura guardada')
      onSaved(); onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar la factura')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary-600" />{draft.id ? 'Editar factura' : 'Nueva factura'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Numeración */}
          <div className="border border-gray-100 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Numeración automática</Label>
              <Switch checked={draft.auto_number} onCheckedChange={v => setDraft(d => ({ ...d, auto_number: v }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-gray-400">Serie</Label>
                <Input value={draft.invoice_series} onChange={e => setDraft(d => ({ ...d, invoice_series: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px] text-gray-400">Nº de factura</Label>
                <div className="flex gap-1.5">
                  <Input value={draft.invoice_number} onChange={e => setDraft(d => ({ ...d, invoice_number: e.target.value }))} disabled={draft.auto_number} className="h-8 text-sm" />
                  {draft.auto_number && !draft.id && (
                    <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" title="Recalcular"
                      onClick={() => nextInvoiceNumber(orgId, draft.invoice_series).then(n => setDraft(d => ({ ...d, invoice_number: n })))}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cliente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Cliente</Label><Input value={draft.client_name} onChange={e => setDraft(d => ({ ...d, client_name: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">NIF / CIF</Label><Input value={draft.client_nif} onChange={e => setDraft(d => ({ ...d, client_nif: e.target.value }))} placeholder="12345678Z" /></div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Dirección</Label><Input value={draft.client_address} onChange={e => setDraft(d => ({ ...d, client_address: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={draft.client_email} onChange={e => setDraft(d => ({ ...d, client_email: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Teléfono</Label><Input value={draft.client_phone} onChange={e => setDraft(d => ({ ...d, client_phone: e.target.value }))} /></div>
          </div>

          {/* Líneas */}
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <th className="text-left px-2 py-2">Concepto</th><th className="text-center px-2 py-2 w-14">Uds.</th>
                <th className="text-right px-2 py-2 w-24">Precio</th><th className="text-right px-2 py-2 w-24">Total</th><th className="w-8"></th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {draft.items.map((l, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><Input value={l.concept} onChange={e => updateLine(i, { concept: e.target.value })} className="h-8 text-xs border-0 focus-visible:ring-1" placeholder="Concepto…" /></td>
                    <td className="px-1 py-1"><Input type="number" min={0} value={l.units} onChange={e => updateLine(i, { units: Number(e.target.value) })} className="h-8 text-xs text-center border-0 focus-visible:ring-1" /></td>
                    <td className="px-1 py-1"><Input type="number" min={0} step="0.01" value={l.unit_price} onChange={e => updateLine(i, { unit_price: Number(e.target.value) })} className="h-8 text-xs text-right border-0 focus-visible:ring-1" /></td>
                    <td className="px-2 py-1 text-right font-semibold text-gray-800 text-xs">{formatCurrency(l.total)}</td>
                    <td className="px-1 py-1 text-center"><button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
                {draft.items.length === 0 && <tr><td colSpan={5} className="text-center text-xs text-gray-400 py-4">Sin líneas. Añade una.</td></tr>}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={addLine} className="gap-1.5"><Plus className="h-3.5 w-3.5" />Añadir línea</Button>

          {/* Config + totales */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Fecha emisión</Label><Input type="date" value={draft.issue_date} onChange={e => setDraft(d => ({ ...d, issue_date: e.target.value }))} className="h-9" /></div>
                <div className="space-y-1"><Label className="text-xs">Vencimiento</Label><Input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))} className="h-9" /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">IVA</Label>
                  <Select value={String(draft.tax_rate)} onValueChange={v => setDraft(d => ({ ...d, tax_rate: Number(v) }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="21">21%</SelectItem><SelectItem value="10">10%</SelectItem><SelectItem value="0">0%</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Forma de pago</Label>
                  <Select value={draft.payment_method} onValueChange={v => setDraft(d => ({ ...d, payment_method: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="transferencia">Transferencia</SelectItem><SelectItem value="efectivo">Efectivo</SelectItem>
                      <SelectItem value="tarjeta">Tarjeta</SelectItem><SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Estado</Label>
                <Select value={draft.status} onValueChange={v => setDraft(d => ({ ...d, status: v as InvoiceStatus }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Borrador</SelectItem><SelectItem value="sent">Enviada</SelectItem>
                    <SelectItem value="paid">Pagada</SelectItem><SelectItem value="cancelled">Anulada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 self-start">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Base imponible</span><span className="font-medium">{formatCurrency(totals.subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">IVA ({draft.tax_rate}%)</span><span className="font-medium">{formatCurrency(totals.tax_amount)}</span></div>
              <div className="flex justify-between text-base font-bold text-primary-600 border-t border-gray-200 pt-2"><span>TOTAL</span><span>{formatCurrency(totals.total)}</span></div>
            </div>
          </div>

          <div className="space-y-1"><Label className="text-xs">Notas</Label><Textarea rows={2} value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Condiciones, datos de pago…" /></div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar factura'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
