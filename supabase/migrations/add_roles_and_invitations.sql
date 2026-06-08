-- ============================================================
-- ROLES Y SISTEMA DE INVITACIONES
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- Campos en profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS system_role text DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;

-- Quitar super_admin del email anterior (si existe)
UPDATE profiles SET system_role = 'user'
WHERE email = 'luis.gestion.webs@gmail.com';

-- Asignar super_admin a la cuenta de soporte de TrackALead
-- (crear la cuenta en Supabase Auth primero si no existe)
INSERT INTO profiles (id, email, full_name, system_role)
SELECT gen_random_uuid(), 'sat@trackalead.app', 'Super Admin TrackALead', 'super_admin'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE email = 'sat@trackalead.app');

UPDATE profiles SET system_role = 'super_admin'
WHERE email = 'sat@trackalead.app';

-- Invitaciones de colaboradores
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  email text,
  phone text,
  name text,
  role text DEFAULT 'collaborator',
  token text UNIQUE DEFAULT gen_random_uuid()::text,
  permissions jsonb DEFAULT '{"all_boards": true, "board_ids": []}',
  created_by uuid REFERENCES profiles(id),
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Permisos en org_members
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{"all_boards": true, "board_ids": []}';

-- Profesionales mejorada
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES profiles(id);
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS magic_token text UNIQUE DEFAULT gen_random_uuid()::text;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS app_access boolean DEFAULT false;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS last_access timestamptz;

-- Comentarios de profesionales (sin login)
ALTER TABLE lead_comments ADD COLUMN IF NOT EXISTS is_professional boolean DEFAULT false;

-- Permisos para las tablas nuevas
GRANT ALL ON TABLE invitations TO authenticated;
GRANT ALL ON TABLE invitations TO anon;
GRANT ALL ON TABLE invitations TO service_role;

-- Índices
CREATE INDEX IF NOT EXISTS invitations_token_idx ON invitations(token);
CREATE INDEX IF NOT EXISTS invitations_org_id_idx ON invitations(org_id);
CREATE INDEX IF NOT EXISTS professionals_magic_token_idx ON professionals(magic_token);
