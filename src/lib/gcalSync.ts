import { supabase } from './supabase'

// Sincroniza una visita con Google Calendar (si la org lo tiene conectado).
// Es "fire and forget": si no está conectado o falla, no rompe el flujo de la app.
// En 'upsert' guarda el google_event_id devuelto en la propia fila del evento.
export interface SyncEvent {
  id: string
  org_id: string
  title: string
  description?: string | null
  location?: string | null
  start_at: string
  end_at: string
  notify_before_minutes?: number | null
  google_event_id?: string | null
}

export async function syncCalendarEvent(op: 'upsert' | 'delete', ev: SyncEvent): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('gcal-sync', {
      body: {
        org_id: ev.org_id,
        op,
        google_event_id: ev.google_event_id ?? null,
        event: {
          title: ev.title,
          description: ev.description ?? null,
          location: ev.location ?? null,
          start_at: ev.start_at,
          end_at: ev.end_at,
          notify_before_minutes: ev.notify_before_minutes ?? 30,
        },
      },
    })
    if (error) return
    const res = data as { ok?: boolean; google_event_id?: string; notConnected?: boolean }
    if (op === 'upsert' && res?.google_event_id && res.google_event_id !== ev.google_event_id) {
      await supabase.from('calendar_events').update({ google_event_id: res.google_event_id }).eq('id', ev.id)
    }
  } catch {
    /* silencioso: la sync no debe bloquear la gestión de la agenda */
  }
}
