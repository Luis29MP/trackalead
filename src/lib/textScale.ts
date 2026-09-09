// Tamaño de letra de la app, preferencia POR DISPOSITIVO (localStorage).
// Escala la raíz (html) → como todo usa unidades rem (Tailwind), crece de forma
// proporcional: texto, botones y espaciados. Cada persona lo ajusta en su móvil.
export type TextScale = 'normal' | 'grande' | 'xl'

const KEY = 'ui_text_scale'
const SIZE: Record<TextScale, string> = {
  normal: '100%',
  grande: '112.5%', // ~18px
  xl:     '125%',   // ~20px
}

export function getTextScale(): TextScale {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'grande' || v === 'xl') return v
  } catch { /* almacenamiento no disponible */ }
  return 'normal'
}

export function applyTextScale(scale: TextScale): void {
  try { document.documentElement.style.fontSize = SIZE[scale] ?? '100%' } catch { /* no-op */ }
}

export function setTextScale(scale: TextScale): void {
  try { localStorage.setItem(KEY, scale) } catch { /* no-op */ }
  applyTextScale(scale)
}
