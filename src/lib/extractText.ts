// Extrae texto plano de un archivo para la base de conocimiento del profesional.
// Soporta PDF (pdfjs), Excel/CSV (xlsx) y texto. Las imágenes no devuelven texto.

import { sheetToText } from './sheetParse'

async function extractPdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  let text = ''
  const pages = Math.min(pdf.numPages, 15)
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += (content.items as { str?: string }[]).map(it => it.str ?? '').join(' ') + '\n'
  }
  return text.slice(0, 20000)
}

export async function extractKnowledgeText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    return extractPdf(file)
  }
  if (/\.(xlsx|xls|csv)$/.test(name) || file.type.includes('sheet') || file.type === 'text/csv') {
    return sheetToText(file)
  }
  if (file.type.startsWith('text/') || /\.(txt|md)$/.test(name)) {
    return (await file.text()).slice(0, 20000)
  }
  // Imágenes u otros: sin texto (se guarda el archivo igualmente)
  return ''
}
