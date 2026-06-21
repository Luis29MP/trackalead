// Extrae texto plano de un archivo para la base de conocimiento / presupuestos.
// Soporta PDF (pdfjs), Excel/CSV (xlsx), Word (.docx, mammoth) y texto.
// Las imágenes no devuelven texto. Los PDF escaneados se pueden pasar a imagen
// con pdfToImages() para que los lea la visión de la IA.

import { sheetToText } from './sheetParse'

async function loadPdf(arrayBuffer: ArrayBuffer) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise
}

async function extractPdf(file: File): Promise<string> {
  const pdf = await loadPdf(await file.arrayBuffer())
  let text = ''
  const pages = Math.min(pdf.numPages, 15)
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += (content.items as { str?: string }[]).map(it => it.str ?? '').join(' ') + '\n'
  }
  return text.slice(0, 20000)
}

// Renderiza las primeras páginas de un PDF a imagen JPEG base64 (para PDF escaneados
// sin capa de texto: planos, pliegos firmados…). Cada página máx. ~1500px.
export async function pdfToImages(file: File, maxPages = 8): Promise<{ mime: string; data: string }[]> {
  const pdf = await loadPdf(await file.arrayBuffer())
  const out: { mime: string; data: string }[] = []
  const pages = Math.min(pdf.numPages, maxPages)
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2, 1500 / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    out.push({ mime: 'image/jpeg', data: dataUrl.split(',')[1] })
  }
  return out
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return (value ?? '').slice(0, 40000)
}

export async function extractKnowledgeText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    return extractPdf(file)
  }
  if (/\.(xlsx|xls|csv)$/.test(name) || file.type.includes('sheet') || file.type === 'text/csv') {
    return sheetToText(file)
  }
  if (/\.docx$/.test(name) || file.type.includes('officedocument.wordprocessingml')) {
    return extractDocx(file)
  }
  if (file.type.startsWith('text/') || /\.(txt|md)$/.test(name)) {
    return (await file.text()).slice(0, 40000)
  }
  // Imágenes u otros: sin texto (se guarda el archivo igualmente)
  return ''
}
