-- Envío de correos desde la plataforma usando el SMTP de cada web.
-- email_accounts: config SMTP por web (contraseña cifrada con AI_KEYS_KEK).
-- sent_emails: histórico de correos enviados (visible para todo el equipo).

create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  board_id uuid references public.boards(id) on delete set null,  -- opcional: la web/tablero
  label text,                       -- ej. "Carpintería León"
  from_email text not null,         -- info@tucarpinteroenleon.com
  from_name text,                   -- nombre mostrado al cliente
  smtp_host text not null,          -- ej. mail.tucarpinteroenleon.com
  smtp_port integer not null default 465,
  smtp_secure boolean not null default true,   -- 465=SSL (true) · 587=STARTTLS (false)
  smtp_user text not null,          -- normalmente = from_email
  smtp_pass_encrypted text not null,-- AES-GCM (secreto AI_KEYS_KEK); nunca en claro
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_accounts_org_idx on public.email_accounts(org_id);
create index if not exists email_accounts_board_idx on public.email_accounts(board_id);
grant all on public.email_accounts to anon, authenticated, service_role;
alter table public.email_accounts enable row level security;
drop policy if exists email_accounts_all_org_members on public.email_accounts;
create policy email_accounts_all_org_members on public.email_accounts
  for all using (org_id in (select public.my_org_ids()))
  with check (org_id in (select public.my_org_ids()));

create table if not exists public.sent_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  board_id uuid references public.boards(id) on delete set null,
  budget_id uuid references public.budgets(id) on delete set null,
  from_email text,
  to_email text not null,
  subject text,
  body text,
  attachment_name text,
  status text not null default 'sent',   -- sent | error
  error text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists sent_emails_org_idx on public.sent_emails(org_id);
create index if not exists sent_emails_lead_idx on public.sent_emails(lead_id);
grant all on public.sent_emails to anon, authenticated, service_role;
alter table public.sent_emails enable row level security;
drop policy if exists sent_emails_all_org_members on public.sent_emails;
create policy sent_emails_all_org_members on public.sent_emails
  for all using (org_id in (select public.my_org_ids()))
  with check (org_id in (select public.my_org_ids()));

-- ROLLBACK:
-- drop table if exists public.sent_emails;
-- drop table if exists public.email_accounts;
