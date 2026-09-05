-- Enlace de cada visita con su evento en Google Calendar (sync una dirección:
-- TrackALead → calendario "Visitas" compartido). Null = aún no sincronizado.
alter table calendar_events add column if not exists google_event_id text;
comment on column calendar_events.google_event_id is 'ID del evento en Google Calendar (sync). Null = no sincronizado.';
