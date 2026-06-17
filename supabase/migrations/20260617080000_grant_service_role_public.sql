-- ─────────────────────────────────────────────────────────────────────────────
-- A service_role le faltaban los GRANT de tabla en public (p. ej. profiles), por lo
-- que las Edge Functions con service_role recibían "permission denied for table ...".
-- Se le conceden todos los privilegios sobre el esquema public (es el rol de backend
-- privilegiado, que además salta RLS). Es lo que Supabase concede por defecto.
-- ALTER DEFAULT PRIVILEGES lo aplica también a las tablas/secuencias futuras.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
