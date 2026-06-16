-- ─────────────────────────────────────────────────────────────────────────────
-- Desactivar el LISTADO público de objetos en los buckets públicos.
-- Los buckets siguen siendo public=true → el acceso por URL del objeto se mantiene
-- (no depende de la política SELECT). Quitar la política SELECT amplia bloquea
-- únicamente el listado/enumeración de objetos vía API (.list()). Lint 0025.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "budgets_pdf_public_read"           ON storage.objects;  -- budgets
DROP POLICY IF EXISTS "storage_lead_files_select"         ON storage.objects;  -- lead-files
DROP POLICY IF EXISTS "Public Access to Lead Attachments" ON storage.objects;  -- lead-attachments
DROP POLICY IF EXISTS "pro_knowledge_read"                ON storage.objects;  -- pro-knowledge
