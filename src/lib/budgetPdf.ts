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

function buildDoc(budget: Budget, org: PdfOrgInfo = {}, opts: { hideUnitPrice?: boolean } = {}): { doc: jsPDF; fileName: string } {
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

  // ── Datos del cliente (en caja) ──────────────────────────────────────────────
  const boxPad = 3.5
  const clientRows = [
    ['Nombre:', budget.client_name || '—'],
    budget.client_nif ? ['DNI/NIF:', budget.client_nif] : null,
    budget.client_address ? ['Dirección:', budget.client_address] : null,
    budget.concept ? ['Trabajo:', budget.concept] : null,
  ].filter(Boolean) as [string, string][]
  const boxH = 7 + clientRows.length * 4.8 + boxPad
  doc.setFillColor(245, 247, 250)
  doc.roundedRect(marginX, y, pageW - marginX * 2, boxH, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRAY)
  doc.text('DATOS DEL CLIENTE', marginX + boxPad, y + 5)
  let cy = y + 11
  doc.setFontSize(9.2)
  for (const [k, v] of clientRows) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK); doc.text(k, marginX + boxPad, cy)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60)
    doc.text(doc.splitTextToSize(v, pageW - marginX * 2 - boxPad * 2 - 24), marginX + boxPad + 24, cy)
    cy += 4.8
  }
  y += boxH + 8

  // ── Tablas por sección (trabajo / Materiales / …) ─────────────────────────────
  const hideUP = !!opts.hideUnitPrice
  const groups: { title: string | null; lines: typeof budget.lines }[] = []
  for (const l of budget.lines) {
    const key = l.section || null
    let g = groups.find(x => x.title === key)
    if (!g) { g = { title: key, lines: [] }; groups.push(g) }
    g.lines.push(l)
  }
  let afterY = y
  groups.forEach((g) => {
    if (g.title) {
      afterY += 2
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...DARK)
      doc.text(g.title, pageW / 2, afterY + 4, { align: 'center' })
      afterY += 7
    }
    autoTable(doc, {
      startY: afterY,
      head: [hideUP ? ['Concepto', 'Uds.', 'Total'] : ['Concepto', 'Uds.', 'Precio/ud', 'Total']],
      body: g.lines.map(l => hideUP
        ? [l.concept, l.uds_label ?? String(l.units), eur(l.total)]
        : [l.concept, l.uds_label ?? String(l.units), eur(l.unit_price), eur(l.total)]),
      theme: 'striped',
      headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold', halign: 'left' },
      bodyStyles: { textColor: 40, fontSize: 9 },
      columnStyles: hideUP
        ? { 0: { cellWidth: 'auto' }, 1: { halign: 'center', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 32, fontStyle: 'bold' } }
        : { 0: { cellWidth: 'auto' }, 1: { halign: 'center', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 30 }, 3: { halign: 'right', cellWidth: 30, fontStyle: 'bold' } },
      margin: { left: marginX, right: marginX },
    })
    // @ts-expect-error lastAutoTable lo añade el plugin en runtime
    afterY = (doc.lastAutoTable?.finalY ?? afterY) + 6
  })

  // ── Resumen: subtotales por sección + Subtotal + IVA + TOTAL ───────────────────
  const rowsX = marginX, valuesX = pageW - marginX
  const sumRow = (label: string, value: string, o: { bold?: boolean; color?: [number, number, number]; rule?: boolean } = {}) => {
    if (o.rule) { doc.setDrawColor(...PRIMARY); doc.setLineWidth(0.4); doc.line(rowsX, afterY - 2, valuesX, afterY - 2) }
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal')
    doc.setFontSize(o.bold ? 11.5 : 9.5)
    const c = o.color ?? ([80, 80, 80] as [number, number, number])
    doc.setTextColor(c[0], c[1], c[2])
    doc.text(label, rowsX, afterY)
    doc.text(value, valuesX, afterY, { align: 'right' })
    afterY += o.bold ? 7.5 : 5.4
  }
  afterY += 3
  if (groups.length > 1) {
    for (const g of groups) sumRow(`${g.title || 'Trabajo'}:`, eur(g.lines.reduce((s, l) => s + (l.total || 0), 0)))
    afterY += 1.5
  }
  sumRow('Subtotal', eur(budget.subtotal))
  sumRow(`IVA (${budget.vat_percent}%)`, eur(budget.vat_amount))
  sumRow('TOTAL PRESUPUESTO', eur(budget.total), { bold: true, color: PRIMARY, rule: true })

  // ── Condiciones / validez ─────────────────────────────────────────────────────
  afterY += 5
  const safeNotes = sanitizeClientNotes(budget.notes ?? '')
  if (safeNotes) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80)
    const condLines = doc.splitTextToSize(safeNotes, pageW - marginX * 2)
    doc.text(condLines, marginX, afterY); afterY += condLines.length * 4.2 + 2
  }
  doc.setFontSize(8.5); doc.setTextColor(...GRAY)
  doc.text(`Validez del presupuesto: ${budget.validity_days} días`, marginX, afterY)
  afterY += 12

  // ── Aceptación del presupuesto ─────────────────────────────────────────────────
  const pageHt = doc.internal.pageSize.getHeight()
  if (afterY > pageHt - 40) { doc.addPage(); afterY = 20 }
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3); doc.line(marginX, afterY, pageW - marginX, afterY); afterY += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...DARK)
  doc.text('ACEPTACIÓN DEL PRESUPUESTO:', marginX, afterY); afterY += 11
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80, 80, 80)
  doc.text('EL CLIENTE, FECHA: ______________________________', marginX, afterY)

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
export function exportBudgetPdf(budget: Budget, org: PdfOrgInfo = {}, opts: { hideUnitPrice?: boolean } = {}) {
  const { doc, fileName } = buildDoc(budget, org, opts)
  doc.save(fileName)
}

// Abre el PDF en una pestaña nueva del navegador (sin descargar) — para revisar/validar
export function viewBudgetPdf(budget: Budget, org: PdfOrgInfo = {}, opts: { hideUnitPrice?: boolean } = {}) {
  const { doc } = buildDoc(budget, org, opts)
  const url = doc.output('bloburl') as unknown as string
  window.open(url, '_blank', 'noopener')
}

// Transforma un presupuesto (coste del profesional) al PVP del cliente aplicando el
// margen a cada partida y quitando las líneas marcadas como internas.
export function toClientBudget(budget: Budget, marginPercent: number): Budget {
  const f = 1 + (marginPercent || 0) / 100
  const r2 = (n: number) => Math.round(n * 100) / 100
  const lines = (budget.lines ?? []).filter(l => !l.internal).map(l => ({
    ...l, unit_price: r2((l.unit_price || 0) * f), total: r2((l.total || 0) * f),
  }))
  const subtotal = r2(lines.reduce((s, l) => s + (l.total || 0), 0))
  const vat_amount = r2(subtotal * (budget.vat_percent || 0) / 100)
  const total = r2(subtotal + vat_amount)
  return { ...budget, lines, subtotal, vat_amount, total }
}

// Etiqueta corta de la propuesta ("Propuesta 1") a partir del nº final del concepto
function optionLabel(b: Budget, i: number): string {
  const m = (b.concept || '').match(/(\d+)\s*$/)
  return `Propuesta ${m ? m[1] : i + 1}`
}

// ── PDF comparativo: varias opciones del mismo trabajo en un único documento ────
export function exportBudgetComparison(budgets: Budget[], org: PdfOrgInfo = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 14
  let y = 16
  const first = budgets[0]
  const baseTitle = `Comparativa de ${budgets.length} propuestas`

  // ── Cabecera ───────────────────────────────────────────────────────────────
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
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...PRIMARY)
  doc.text('COMPARATIVA', pageW - marginX, y + 6, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY)
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, pageW - marginX, y + 13, { align: 'right' })

  y += 30
  doc.setDrawColor(...PRIMARY); doc.setLineWidth(0.6); doc.line(marginX, y, pageW - marginX, y); y += 8

  // ── Cliente + trabajo ────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...DARK)
  doc.text('CLIENTE', marginX, y); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60)
  ;[first.client_name || '—', first.client_phone || null, first.client_address || null, `Trabajo: ${baseTitle}`]
    .filter(Boolean).forEach((l, i) => doc.text(l as string, marginX, y + i * 4.8))
  y += 4 * 4.8 + 4

  // ── Resumen comparativo ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...DARK)
  doc.text('RESUMEN DE OPCIONES', marginX, y); y += 3
  autoTable(doc, {
    startY: y,
    head: [['Opción', 'Conceptos', 'Total (IVA incl.)']],
    body: budgets.map((b, i) => [optionLabel(b, i), String(b.lines?.length ?? 0), eur(b.total)]),
    theme: 'grid',
    headStyles: { fillColor: PRIMARY, textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: 40, fontSize: 9.5 },
    columnStyles: { 1: { halign: 'center', cellWidth: 28 }, 2: { halign: 'right', cellWidth: 40, fontStyle: 'bold' } },
    margin: { left: marginX, right: marginX },
  })
  // @ts-expect-error lastAutoTable lo añade el plugin
  y = (doc.lastAutoTable?.finalY ?? y) + 10

  // ── Detalle por opción ───────────────────────────────────────────────────────
  budgets.forEach((b, i) => {
    if (y > pageH - 50) { doc.addPage(); y = 16 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...PRIMARY)
    doc.text(optionLabel(b, i), marginX, y); y += 5
    autoTable(doc, {
      startY: y,
      head: [['Concepto', 'Uds.', 'Precio/ud', 'Total']],
      body: (b.lines ?? []).map(l => [l.concept, String(l.units), eur(l.unit_price), eur(l.total)]),
      theme: 'striped',
      headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold' },
      bodyStyles: { textColor: 40, fontSize: 8.5 },
      columnStyles: { 1: { halign: 'center', cellWidth: 16 }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'right', cellWidth: 26, fontStyle: 'bold' } },
      margin: { left: marginX, right: marginX },
    })
    // @ts-expect-error lastAutoTable lo añade el plugin
    let ay = (doc.lastAutoTable?.finalY ?? y) + 5
    const tX = pageW - marginX - 60, vX = pageW - marginX
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY)
    doc.text('Subtotal', tX, ay); doc.setTextColor(40, 40, 40); doc.text(eur(b.subtotal), vX, ay, { align: 'right' })
    ay += 5; doc.setTextColor(...GRAY); doc.text(`IVA (${b.vat_percent}%)`, tX, ay); doc.setTextColor(40, 40, 40); doc.text(eur(b.vat_amount), vX, ay, { align: 'right' })
    ay += 5.5; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...PRIMARY)
    doc.text('TOTAL', tX, ay); doc.text(eur(b.total), vX, ay, { align: 'right' })
    y = ay + 12
  })

  // ── Pie ──────────────────────────────────────────────────────────────────────
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3); doc.line(marginX, pageH - 16, pageW - marginX, pageH - 16)
  doc.setFontSize(8); doc.setTextColor(...GRAY)
  const footer = [org.name, org.phone, org.email].filter(Boolean).join('  ·  ')
  doc.text(footer || 'TrackALead', pageW / 2, pageH - 11, { align: 'center' })

  doc.save(`Comparativa_${(first.client_name || 'cliente').replace(/\s+/g, '_')}.pdf`)
}

// Devuelve el PDF como Blob (para subirlo a Storage y compartir por WhatsApp)
export function budgetPdfBlob(budget: Budget, org: PdfOrgInfo = {}): Blob {
  const { doc } = buildDoc(budget, org)
  return doc.output('blob')
}
