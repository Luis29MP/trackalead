-- Tipo de evento en calendar_events
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS type text DEFAULT 'visita_presencial';

-- Referencia del evento en notificaciones (para deduplicación)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS calendar_event_id uuid REFERENCES calendar_events(id) ON DELETE SET NULL;

-- Índice para deduplicación rápida
CREATE INDEX IF NOT EXISTS notif_calendar_event_idx
  ON notifications(user_id, calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;
