-- Registro de uso de IA (tokens + coste estimado en €). Alimentado por la Edge Function ai-proxy.
create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid, user_id uuid, professional_id uuid,
  provider text, model text,
  prompt_tokens integer default 0, completion_tokens integer default 0, total_tokens integer default 0,
  cost_eur numeric default 0, label text,
  created_at timestamptz default now()
);
alter table ai_usage enable row level security;
drop policy if exists ai_usage_org_members on ai_usage;
create policy ai_usage_org_members on ai_usage for select using (org_id in (select my_org_ids()));
create index if not exists ai_usage_org_created_idx on ai_usage (org_id, created_at desc);
