import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Budget } from '@/types'

export interface PdfOrgInfo {
  name?: string
  phone?: string | null
  email?: string | null
  address?: string | null
  logoUrl?: string | null  // data URL o URL pública de imagen (opcional)
}

const PRIMARY: [number, number, number] = [37, 99, 235]   // #2563EB
const DARK: [number, number, number] = [15, 23, 42]       // #0F172A
const GRAY: [number, number, number] = [100, 116, 139]

function eur(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

// Red de seguridad: el cliente NUNCA debe ver el margen/comisión/sobrecoste.
// Elimina cualquier frase de las notas que lo mencione.
function sanitizeClientNotes(text: string): string {
  const FORBIDDEN = /(margen|comisi[oó]n|sobrecoste|sobre[\s-]?coste|markup|beneficio interno|incremento (del|de un) \d+\s*%|\d+\s*%\s*(adicional|de margen|extra))/i
  return text
    .split(/(?<=[.\n])/)            // trocear por frases/líneas
    .filter(s => !FORBIDDEN.test(s))
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function buildDoc(budget: Budget, org: PdfOrgInfo = {}): { doc: jsPDF; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const marginX = 14
  let y = 16

  // ── Cabecera: logo + datos empresa (izq) / "PRESUPUESTO" (der) ──────────────
  let logoW = 0
  if (org.logoUrl) {
    try {
      const props = doc.getImageProperties(org.logoUrl)
      const maxW = 30, maxH = 22
      const ratio = Math.min(maxW / props.width, maxH / props.height)
      logoW = props.width * ratio
      const logoH = props.height * ratio
      const fmt = (props.fileType || 'PNG').toUpperCase()
      doc.addImage(org.logoUrl, fmt, marginX, y, logoW, logoH)
    } catch { logoW = 0 /* logo inválido, se omite */ }
  }
  const headerX = logoW > 0 ? marginX + logoW + 5 : marginX

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...DARK)
  doc.text(org.name || 'Mi Empresa', headerX, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  const orgLines = [org.address, org.phone, org.email].filter(Boolean) as string[]
  orgLines.forEach((line, i) => doc.text(line, headerX, y + 12 + i * 4.5))

  // Bloque derecha
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...PRIMARY)
  doc.text('PRESUPUESTO', pageW - marginX, y + 6, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  const num = budget.id.slice(0, 8).toUpperCase()
  const date = new Date(budget.created_at).toLocaleDateString('es-ES')
  doc.text(`Nº ${num}`, pageW - marginX, y + 13, { align: 'right' })
  doc.text(`Fecha: ${date}`, pageW - marginX, y + 17.5, { align: 'right' })

  y += 30
  doc.setDrawColor(...PRIMARY)
  doc.setLineWidth(0.6)
  doc.line(marginX, y, pageW - marginX, y)
  y += 8

  // ── Datos del cliente ────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...DARK)
  doc.text('CLIENTE', marginX, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(60, 60, 60)
  const clientLines = [
    budget.client_name || '—',
    budget.client_phone || null,
    budget.client_address || null,
    budget.concept ? `Trabajo: ${budget.concept}` : null,
  ].filter(Boolean) as string[]
  clientLines.forEach((line, i) => doc.text(line, marginX, y + i * 4.8))
  y += clientLines.length * 4.8 + 4

  // ── Tabla de líneas ──────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [['Concepto', 'Uds.', 'Precio/ud', 'Total']],
    body: budget.lines.map(l => [
      l.concept,
      String(l.units),
      eur(l.unit_price),
      eur(l.total),
    ]),
    theme: 'striped',
    headStyles: { fillColor: PRIMARY, textColor: 255, fontStyle: 'bold', halign: 'left' },
    bodyStyles: { textColor: 40, fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'center', cellWidth: 18 },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
    },
    margin: { left: marginX, right: marginX },
  })

  // @ts-expect-error lastAutoTable lo añade el plugin en runtime
  let afterY: number = doc.lastAutoTable?.finalY ?? y + 20
  afterY += 8

  // ── Totales (alineados a la derecha) ─────────────────────────────────────────
  const totalsX = pageW - marginX - 60
  const valuesX = pageW - marginX
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRAY)
  doc.text('Subtotal', totalsX, afterY)
  doc.setTextColor(40, 40, 40)
  doc.text(eur(budget.subtotal), valuesX, afterY, { align: 'right' })

  afterY += 5.5
  doc.setTextColor(...GRAY)
  doc.text(`IVA (${budget.vat_percent}%)`, totalsX, afterY)
  doc.setTextColor(40, 40, 40)
  doc.text(eur(budget.vat_amount), valuesX, afterY, { align: 'right' })

  afterY += 4
  doc.setDrawColor(...PRIMARY)
  doc.setLineWidth(0.4)
  doc.line(totalsX, afterY, valuesX, afterY)
  afterY += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...PRIMARY)
  doc.text('TOTAL', totalsX, afterY)
  doc.text(eur(budget.total), valuesX, afterY, { align: 'right' })

  afterY += 12

  // ── Condiciones y validez ────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...DARK)
  doc.text('CONDICIONES', marginX, afterY)
  afterY += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(80, 80, 80)
  const safeNotes = sanitizeClientNotes(budget.notes ?? '')
  const conditions = safeNotes || 'Presupuesto sin compromiso. Precios sujetos a revisión tras visita técnica.'
  const condLines = doc.splitTextToSize(conditions, pageW - marginX * 2)
  doc.text(condLines, marginX, afterY)
  afterY += condLines.length * 4.2 + 3
  doc.setTextColor(...GRAY)
  doc.text(`Validez del presupuesto: ${budget.validity_days} días`, marginX, afterY)

  // ── Pie de página ────────────────────────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight()
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.line(marginX, pageH - 16, pageW - marginX, pageH - 16)
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  const footer = [org.name, org.phone, org.email].filter(Boolean).join('  ·  ')
  doc.text(footer || 'TrackALead', pageW / 2, pageH - 11, { align: 'center' })

  const fileName = `Presupuesto_${(budget.client_name || 'cliente').replace(/\s+/g, '_')}_${num}.pdf`
  return { doc, fileName }
}

// Descarga el PDF
export function exportBudgetPdf(budget: Budget, org: PdfOrgInfo = {}) {
  const { doc, fileName } = buildDoc(budget, org)
  doc.save(fileName)
}

// Devuelve el PDF como Blob (para subirlo a Storage y compartir por WhatsApp)
export function budgetPdfBlob(budget: Budget, org: PdfOrgInfo = {}): Blob {
  const { doc } = buildDoc(budget, org)
  return doc.output('blob')
}
