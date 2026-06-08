-- TrackALead — Schema SQL
-- Ejecutar en el SQL Editor de Supabase
-- Versión corregida: tablas primero, políticas RLS al final

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLAS (en orden de dependencias, sin políticas todavía)
-- ============================================================

-- profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- organizations
create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid references profiles(id) on delete set null,
  plan text default 'free',
  created_at timestamptz default now()
);

-- org_members
create table if not exists org_members (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner', 'admin', 'manager', 'installer')),
  unique (org_id, user_id)
);

-- boards
create table if not exists boards (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  website_url text,
  color text default '#2563EB',
  created_at timestamptz default now()
);

-- board_columns
create table if not exists board_columns (
  id uuid primary key default uuid_generate_v4(),
  board_id uuid not null references boards(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  color text default '#6B7280'
);

-- professionals (debe ir antes que leads por la FK assigned_to)
create table if not exists professionals (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  specialty text,
  is_active boolean default true
);

-- leads
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  board_id uuid not null references boards(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  column_id uuid references board_columns(id) on delete set null,
  title text,
  name text not null,
  phone text,
  email text,
  address text,
  lat double precision,
  lng double precision,
  source text not null default 'form' check (source in ('form', 'whatsapp', 'call')),
  notes text,
  ai_summary text,
  assigned_to uuid references professionals(id) on delete set null,
  budget_amount numeric(12, 2),
  commission_amount numeric(12, 2),
  commission_paid boolean default false,
  is_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- lead_files
create table if not exists lead_files (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references leads(id) on delete cascade,
  name text not null,
  url text not null,
  type text,
  size bigint,
  created_at timestamptz default now()
);

-- lead_comments
create table if not exists lead_comments (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references leads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- lead_activity
create table if not exists lead_activity (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references leads(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  action text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- calendar_events
create table if not exists calendar_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  notify_before_minutes integer default 30
);

-- notifications
create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- TRIGGER: auto-crear perfil al registrarse
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- HABILITAR RLS (después de crear todas las tablas)
-- ============================================================
alter table profiles           enable row level security;
alter table organizations      enable row level security;
alter table org_members        enable row level security;
alter table boards             enable row level security;
alter table board_columns      enable row level security;
alter table professionals      enable row level security;
alter table leads              enable row level security;
alter table lead_files         enable row level security;
alter table lead_comments      enable row level security;
alter table lead_activity      enable row level security;
alter table calendar_events    enable row level security;
alter table notifications      enable row level security;

-- ============================================================
-- POLÍTICAS RLS (todas al final, todas las tablas ya existen)
-- ============================================================

-- profiles
create policy "profiles_select_own"
  on profiles for select using (auth.uid() = id);
create policy "profiles_update_own"
  on profiles for update using (auth.uid() = id);
create policy "profiles_insert_own"
  on profiles for insert with check (auth.uid() = id);
-- Permitir leer perfiles de miembros de la misma org
create policy "profiles_select_org_members"
  on profiles for select using (
    exists (
      select 1 from org_members om1
      join org_members om2 on om1.org_id = om2.org_id
      where om1.user_id = auth.uid() and om2.user_id = profiles.id
    )
  );

-- organizations (ahora org_members ya existe)
create policy "orgs_select_members"
  on organizations for select
  using (
    exists (
      select 1 from org_members
      where org_id = organizations.id and user_id = auth.uid()
    )
  );
create policy "orgs_update_owner"
  on organizations for update
  using (owner_id = auth.uid());
create policy "orgs_insert_authenticated"
  on organizations for insert
  with check (auth.uid() is not null);

-- org_members
create policy "org_members_select_own"
  on org_members for select
  using (user_id = auth.uid());
create policy "org_members_select_same_org"
  on org_members for select
  using (
    exists (
      select 1 from org_members om2
      where om2.org_id = org_members.org_id and om2.user_id = auth.uid()
    )
  );
create policy "org_members_insert_own"
  on org_members for insert
  with check (user_id = auth.uid());

-- boards
create policy "boards_all_org_members"
  on boards for all
  using (
    exists (
      select 1 from org_members
      where org_id = boards.org_id and user_id = auth.uid()
    )
  );

-- board_columns
create policy "columns_all_org_members"
  on board_columns for all
  using (
    exists (
      select 1 from boards b
      join org_members om on om.org_id = b.org_id
      where b.id = board_columns.board_id and om.user_id = auth.uid()
    )
  );

-- professionals
create policy "professionals_all_org_members"
  on professionals for all
  using (
    exists (
      select 1 from org_members
      where org_id = professionals.org_id and user_id = auth.uid()
    )
  );

-- leads
create policy "leads_all_org_members"
  on leads for all
  using (
    exists (
      select 1 from org_members
      where org_id = leads.org_id and user_id = auth.uid()
    )
  );

-- lead_files
create policy "lead_files_all_org_members"
  on lead_files for all
  using (
    exists (
      select 1 from leads l
      join org_members om on om.org_id = l.org_id
      where l.id = lead_files.lead_id and om.user_id = auth.uid()
    )
  );

-- lead_comments
create policy "lead_comments_all_org_members"
  on lead_comments for all
  using (
    exists (
      select 1 from leads l
      join org_members om on om.org_id = l.org_id
      where l.id = lead_comments.lead_id and om.user_id = auth.uid()
    )
  );

-- lead_activity
create policy "lead_activity_all_org_members"
  on lead_activity for all
  using (
    exists (
      select 1 from leads l
      join org_members om on om.org_id = l.org_id
      where l.id = lead_activity.lead_id and om.user_id = auth.uid()
    )
  );

-- calendar_events
create policy "calendar_events_all_org_members"
  on calendar_events for all
  using (
    exists (
      select 1 from org_members
      where org_id = calendar_events.org_id and user_id = auth.uid()
    )
  );

-- notifications
create policy "notifications_all_own"
  on notifications for all
  using (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
insert into storage.buckets (id, name, public)
values ('lead-files', 'lead-files', true)
on conflict (id) do nothing;

create policy "storage_lead_files_insert"
  on storage.objects for insert
  with check (bucket_id = 'lead-files' and auth.uid() is not null);

create policy "storage_lead_files_select"
  on storage.objects for select
  using (bucket_id = 'lead-files');

create policy "storage_lead_files_delete"
  on storage.objects for delete
  using (bucket_id = 'lead-files' and auth.uid() is not null);

-- ============================================================
-- ÍNDICES
-- ============================================================
create index if not exists leads_org_id_idx         on leads(org_id);
create index if not exists leads_board_id_idx        on leads(board_id);
create index if not exists leads_column_id_idx       on leads(column_id);
create index if not exists leads_is_archived_idx     on leads(is_archived);
create index if not exists lead_comments_lead_id_idx on lead_comments(lead_id);
create index if not exists lead_activity_lead_id_idx on lead_activity(lead_id);
create index if not exists notifications_user_id_idx on notifications(user_id);
create index if not exists calendar_events_org_idx   on calendar_events(org_id);
