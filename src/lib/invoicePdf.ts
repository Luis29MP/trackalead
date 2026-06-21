import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Invoice } from '@/types'
import type { PdfOrgInfo } from './budgetPdf'

const PRIMARY: [number, number, number] = [37, 99, 235]
const DARK: [number, number, number] = [15, 23, 42]
const GRAY: [number, number, number] = [100, 116, 139]

function eur(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0)
}
function fdate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('es-ES') : '—'
}
const PAY_LABEL: Record<string, string> = {
  transferencia: 'Transferencia bancaria', efectivo: 'Efectivo', tarjeta: 'Tarjeta', cheque: 'Cheque',
}

function buildInvoiceDoc(inv: Invoice, org: PdfOrgInfo = {}): { doc: jsPDF; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 14
  let y = 16

  // Cabecera: emisor (izq) + "FACTURA" (der)
  let logoW = 0
  if (org.logoUrl) {
    try {
      const props = doc.getImageProperties(org.logoUrl)
      const ratio = Math.min(30 / props.width, 22 / props.height)
      logoW = props.width * ratio
      doc.addImage(org.logoUrl, (props.fileType || 'PNG').toUpperCase(), marginX, y, logoW, props.height * ratio)
    } catch { logoW = 0 }
  }
  const hX = logoW > 0 ? marginX + logoW + 5 : marginX
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...DARK)
  doc.text(org.name || 'Mi Empresa', hX, y + 6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY)
  ;[org.address, org.phone, org.email].filter(Boolean).forEach((l, i) => doc.text(l as string, hX, y + 12 + i * 4.5))

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...PRIMARY)
  doc.text('FACTURA', pageW - marginX, y + 6, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...DARK)
  doc.text(`Nº ${inv.invoice_number}`, pageW - marginX, y + 13, { align: 'right' })
  doc.setFontSize(9); doc.setTextColor(...GRAY)
  doc.text(`Fecha: ${fdate(inv.issue_date)}`, pageW - marginX, y + 18, { align: 'right' })
  if (inv.due_date) doc.text(`Vencimiento: ${fdate(inv.due_date)}`, pageW - marginX, y + 22.5, { align: 'right' })

  y += 32
  doc.setDrawColor(...PRIMARY); doc.setLineWidth(0.6); doc.line(marginX, y, pageW - marginX, y); y += 8

  // Cliente (facturar a)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...DARK)
  doc.text('FACTURAR A', marginX, y); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60)
  const cl = [
    inv.client_name || '—',
    inv.client_nif ? `NIF/CIF: ${inv.client_nif}` : null,
    inv.client_address || null,
    [inv.client_phone, inv.client_email].filter(Boolean).join('  ·  ') || null,
  ].filter(Boolean) as string[]
  cl.forEach((l, i) => doc.text(l, marginX, y + i * 4.8))
  y += cl.length * 4.8 + 4

  // Líneas
  autoTable(doc, {
    startY: y,
    head: [['Concepto', 'Uds.', 'Precio/ud', 'Total']],
    body: (inv.items ?? []).map(l => [l.concept, String(l.units), eur(l.unit_price), eur(l.total)]),
    theme: 'striped',
    headStyles: { fillColor: PRIMARY, textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: 40, fontSize: 9 },
    columnStyles: { 1: { halign: 'center', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 30 }, 3: { halign: 'right', cellWidth: 30, fontStyle: 'bold' } },
    margin: { left: marginX, right: marginX },
  })
  // @ts-expect-error lastAutoTable lo añade el plugin
  let ay = (doc.lastAutoTable?.finalY ?? y) + 8

  const tX = pageW - marginX - 60, vX = pageW - marginX
  doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY)
  doc.text('Base imponible', tX, ay); doc.setTextColor(40, 40, 40); doc.text(eur(inv.subtotal), vX, ay, { align: 'right' })
  ay += 5.5; doc.setTextColor(...GRAY); doc.text(`IVA (${inv.tax_rate}%)`, tX, ay); doc.setTextColor(40, 40, 40); doc.text(eur(inv.tax_amount), vX, ay, { align: 'right' })
  ay += 4; doc.setDrawColor(...PRIMARY); doc.setLineWidth(0.4); doc.line(tX, ay, vX, ay); ay += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...PRIMARY)
  doc.text('TOTAL', tX, ay); doc.text(eur(inv.total), vX, ay, { align: 'right' })
  ay += 12

  // Forma de pago + notas
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...DARK)
  doc.text('CONDICIONES DE PAGO', marginX, ay); ay += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80)
  if (inv.payment_method) { doc.text(`Forma de pago: ${PAY_LABEL[inv.payment_method] ?? inv.payment_method}`, marginX, ay); ay += 4.5 }
  if (inv.notes) {
    const lines = doc.splitTextToSize(inv.notes, pageW - marginX * 2)
    doc.text(lines, marginX, ay); ay += lines.length * 4.2
  }

  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3); doc.line(marginX, pageH - 16, pageW - marginX, pageH - 16)
  doc.setFontSize(8); doc.setTextColor(...GRAY)
  const footer = [org.name, org.phone, org.email].filter(Boolean).join('  ·  ')
  doc.text(footer || 'TrackALead', pageW / 2, pageH - 11, { align: 'center' })

  const fileName = `Factura_${inv.invoice_number.replace(/[^\w-]+/g, '_')}.pdf`
  return { doc, fileName }
}

export function exportInvoicePdf(inv: Invoice, org: PdfOrgInfo = {}) {
  const { doc, fileName } = buildInvoiceDoc(inv, org)
  doc.save(fileName)
}
export function viewInvoicePdf(inv: Invoice, org: PdfOrgInfo = {}) {
  const { doc } = buildInvoiceDoc(inv, org)
  window.open(doc.output('bloburl') as unknown as string, '_blank', 'noopener')
}
