-- Migración: añadir campos que faltan en leads
-- Ejecutar en Supabase → SQL Editor

-- Campo empresa/cliente (para leads B2B)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company text;

-- Concepto del trabajo (ej: "Reforma baño", "Boletín eléctrico")
ALTER TABLE leads ADD COLUMN IF NOT EXISTS concept text;

-- Zona / ciudad (alias semántico de address para la UI)
-- Ya existe 'address', usamos 'zone' como campo adicional más específico
ALTER TABLE leads ADD COLUMN IF NOT EXISTS zone text;

-- Marcar si el lead ha sido leído (para badge "NUEVO")
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT true;

-- Actualizar leads existentes: marcar como leídos
UPDATE leads SET is_read = true WHERE is_read IS NULL;
