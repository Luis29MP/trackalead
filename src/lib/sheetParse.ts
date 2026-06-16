import * as XLSX from 'xlsx'
import type { ProRate } from '@/types'

// Convierte un número en formato español/inglés a number.
function parseNum(v: unknown): number {
  if (v == null) return 0
  let s = String(v).replace(/[^\d,.-]/g, '')
  // 1.234,56 → 1234.56  |  1,234.56 → 1234.56
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

// Parsea un Excel/CSV de tarifas → ProRate[]. Detecta cabecera por nombres comunes;
// si no la hay, asume columnas: trabajo | precio | unidad.
export async function parseRatesFromFile(file: File): Promise<ProRate[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false })
  if (!rows.length) return []

  const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
  const header = (rows[0] as unknown[]).map(norm)
  const findCol = (...keys: string[]) => header.findIndex(h => keys.some(k => h.includes(k)))

  let wtCol = findCol('trabajo', 'concepto', 'tipo', 'servicio', 'partida', 'descrip')
  let minCol = findCol('mín', 'min', 'minimo', 'mínimo')
  let recCol = findCol('recomend', 'precio', 'pvp', 'tarifa', 'importe', '€', 'coste')
  let unitCol = findCol('unidad', 'ud', 'medida', 'um')
  const hasHeader = wtCol >= 0 || recCol >= 0
  const dataRows = hasHeader ? rows.slice(1) : rows
  if (!hasHeader) { wtCol = 0; recCol = 1; unitCol = 2; minCol = -1 }

  const rates: ProRate[] = []
  for (const raw of dataRows) {
    const r = raw as unknown[]
    const work_type = String(r[wtCol] ?? '').trim()
    if (!work_type) continue
    const rec = parseNum(r[recCol >= 0 ? recCol : 1])
    const min = minCol >= 0 ? parseNum(r[minCol]) : rec
    const unit = unitCol >= 0 ? (String(r[unitCol] ?? '').trim() || 'ud') : 'ud'
    if (!rec && !min) continue
    rates.push({ work_type, min_price: min || rec, rec_price: rec || min, unit })
  }
  return rates
}

// Convierte la primera hoja de un Excel/CSV a texto plano (para la base de conocimiento).
export async function sheetToText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const out: string[] = []
  for (const name of wb.SheetNames.slice(0, 5)) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
    out.push(`# ${name}\n${csv}`)
  }
  return out.join('\n\n').slice(0, 20000)
}
