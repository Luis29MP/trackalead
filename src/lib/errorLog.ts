import { supabase } from './supabase'

// Contexto actual del usuario, lo setea AuthContext cuando carga la sesión.
// Los handlers globales de error lo leen para adjuntar user_id / org_id.
let currentUserId: string | null = null
let currentOrgId: string | null = null

export function setErrorLogContext(userId: string | null, orgId: string | null) {
  currentUserId = userId
  currentOrgId = orgId
}

// Anti-spam: evita insertar el mismo error en bucle.
let lastMessage = ''
let lastTime = 0

export async function logError(message: string, stack?: string | null) {
  const msg = (message || 'Error desconocido').slice(0, 1000)
  const now = Date.now()
  if (msg === lastMessage && now - lastTime < 3000) return
  lastMessage = msg
  lastTime = now

  try {
    await supabase.from('error_logs').insert({
      message: msg,
      stack: stack ? stack.slice(0, 4000) : null,
      url: window.location.href,
      user_id: currentUserId,
      org_id: currentOrgId,
    })
  } catch {
    // Nunca dejar que el logger rompa la app
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    logError(e.message || 'Error', e.error?.stack)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string; stack?: string } | undefined
    const msg = reason?.message ?? String(e.reason)
    logError('Promesa no controlada: ' + msg, reason?.stack)
  })
}
