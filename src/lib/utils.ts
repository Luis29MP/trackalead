import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatRelativeTime(date: string): string {
  const now = new Date()
  const then = new Date(date)
  const diff = now.getTime() - then.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return 'ahora mismo'
  if (minutes < 60) return `hace ${minutes} min`
  if (hours < 24) return `hace ${hours}h`
  if (days < 7) return `hace ${days}d`
  return formatDate(date)
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    form: 'Formulario',
    whatsapp: 'WhatsApp',
    call: 'Llamada',
  }
  return labels[source] ?? source
}

export function calculateCommission(budget: number, rate = 0.15): number {
  return Math.round(budget * rate * 100) / 100
}

// Convierte un string UTC de Supabase al formato que espera el input datetime-local (hora local).
// Ej: "2024-06-10T13:00:00+00:00" → "2024-06-10T15:00" (en UTC+2)
export function toLocalInput(isoString: string): string {
  const date = new Date(isoString)
  const offset = date.getTimezoneOffset() * 60000          // ms de diferencia local↔UTC
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

// Convierte el valor de un input datetime-local (hora local del navegador) a UTC ISO para guardar en BD.
// Ej: "2024-06-10T15:00" → "2024-06-10T13:00:00.000Z" (en UTC+2)
export function toUTCIso(localInput: string): string {
  if (!localInput) return localInput
  return new Date(localInput).toISOString()
}
