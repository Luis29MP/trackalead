import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Search, Filter, Download, Eye, Pencil, Trash2, Send, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { exportInvoicePdf, viewInvoicePdf } from '@/lib/invoicePdf'
import { type PdfOrgInfo } from '@/lib/budgetPdf'
import { InvoiceForm } from '@/components/InvoiceForm'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Invoice, InvoiceStatus, Professional } from '@/types'

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; color: string }> = {
  draft:     { label: 'Borrador', color: 'bg-gray-100 text-gray-600' },
  sent:      { label: 'Enviada',  color: 'bg-blue-100 text-blue-700' },
  paid:      { label: 'Pagada',   color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Anulada',  color: 'bg-red-100 text-red-700' },
}

export function Invoices() {
  const { organization, user } = useAuth()
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  useEffect(() => { if (organization?.id) load() }, [organization?.id])

  async function load() {
    if (!organization?.id) return
    setLoading(true)
    const [{ data: inv }, { data: pros }] = await Promise.all([
      supabase.from('invoices').select('*').eq('org_id', organization.id).order('created_at', { ascending: false }),
      supabase.from('professionals').select('*').eq('org_id', organization.id),
    ])
    setInvoices((inv ?? []) as Invoice[])
    setProfessionals((pros ?? []) as Professional[])
    setLoading(false)
  }

  function issuer(inv: Invoice): PdfOrgInfo {
    const pro = professionals.find(p => p.id === inv.professional_id)
    if (pro && (pro.company_name || pro.logo_url)) {
      const addr = [pro.address, pro.cif ? `NIF: ${pro.cif}` : null].filter(Boolean).join('  ·  ')
      return { name: pro.company_name || pro.name, phone: pro.phone, email: pro.email, address: addr || null, logoUrl: pro.logo_url ?? null }
    }
    return { name: organization?.name }
  }

  async function setStatus(inv: Invoice, status: InvoiceStatus) {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === 'paid') patch.paid_at = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('invoices').update(patch).eq('id', inv.id)
    if (error) { toast.error('No se pudo actualizar'); return }
    toast.success(status === 'sent' ? 'Marcada como enviada' : status === 'paid' ? 'Marcada como pagada' : 'Actualizada')
    load()
  }
  async function remove(inv: Invoice) {
    if (!window.confirm(`¿Borrar la factura ${inv.invoice_number}?`)) return
    await supabase.from('invoices').delete().eq('id', inv.id)
    toast.success('Factura borrada'); load()
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter(i => {
      if (filterStatus !== 'all' && i.status !== filterStatus) return false
      if (!q) return true
      return (i.invoice_number?.toLowerCase().includes(q) ?? false) || (i.client_name?.toLowerCase().includes(q) ?? false)
    })
  }, [invoices, search, filterStatus])

  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0)
  const totalPending = invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.total, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Facturas</h1>
          <p className="text-gray-500 text-sm mt-1">{invoices.length} facturas · Cobrado {formatCurrency(totalPaid)} · Pendiente {formatCurrency(totalPending)}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input placeholder="Buscar nº o cliente…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-60 text-sm" />
        </div>
        <Filter className="h-4 w-4 text-gray-400" />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="draft">Borrador</SelectItem><SelectItem value="sent">Enviada</SelectItem>
            <SelectItem value="paid">Pagada</SelectItem><SelectItem value="cancelled">Anulada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Sin facturas</h3>
          <p className="text-gray-500 text-sm mt-1">Convierte un presupuesto validado en factura desde la ficha del lead.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-3">Nº</th><th className="text-left px-3 py-3">Cliente</th>
                  <th className="text-right px-3 py-3">Total</th><th className="text-left px-3 py-3">Estado</th>
                  <th className="text-left px-3 py-3">Emisión</th><th className="text-center px-3 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map(inv => {
                  const st = INVOICE_STATUS[inv.status]
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-800">{inv.invoice_number}</td>
                      <td className="px-3 py-3">
                        {inv.lead_id
                          ? <button onClick={() => navigate(`/leads/${inv.lead_id}`)} className="text-primary-600 hover:underline">{inv.client_name || '—'}</button>
                          : <span>{inv.client_name || '—'}</span>}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{formatCurrency(inv.total)}</td>
                      <td className="px-3 py-3"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span></td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(inv.issue_date ?? inv.created_at)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {inv.status === 'draft' && <button onClick={() => setStatus(inv, 'sent')} className="p-1.5 rounded hover:bg-blue-50 text-blue-500" title="Marcar enviada"><Send className="h-3.5 w-3.5" /></button>}
                          {(inv.status === 'sent' || inv.status === 'draft') && <button onClick={() => setStatus(inv, 'paid')} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Marcar pagada"><CheckCircle2 className="h-3.5 w-3.5" /></button>}
                          <button onClick={() => viewInvoicePdf(inv, issuer(inv))} className="p-1.5 rounded hover:bg-primary-50 text-primary-600" title="Ver"><Eye className="h-3.5 w-3.5" /></button>
                          <button onClick={() => exportInvoicePdf(inv, issuer(inv))} className="p-1.5 rounded hover:bg-blue-50 text-blue-500" title="PDF"><Download className="h-3.5 w-3.5" /></button>
                          <button onClick={() => { setEditInvoice(inv); setFormOpen(true) }} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => remove(inv)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Borrar"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && editInvoice && organization && (
        <InvoiceForm
          open={formOpen} onOpenChange={setFormOpen}
          orgId={organization.id} userId={user?.id ?? null}
          invoice={editInvoice}
          onSaved={load}
        />
      )}
    </div>
  )
}
