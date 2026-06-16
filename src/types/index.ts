export type UserRole = 'owner' | 'admin' | 'manager' | 'installer'
export type LeadSource = 'form' | 'whatsapp' | 'call'
export type CommissionStatus = 'pending' | 'paid'

export type SystemRole = 'super_admin' | 'user'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  phone: string | null
  system_role: SystemRole
  created_at: string
  // Suscripción por usuario (owner)
  plan?: string                 // free, pro, enterprise
  plan_status?: string          // active, suspended, trial, cancelled, lifetime
  trial_ends_at?: string | null
  next_billing_at?: string | null
  lifetime_since?: string | null
}

export interface Invitation {
  id: string
  org_id: string
  email: string | null
  phone: string | null
  name: string | null
  role: string
  token: string
  permissions: { all_boards: boolean; board_ids: string[] }
  created_by: string | null
  accepted_at: string | null
  created_at: string
}

export interface Organization {
  id: string
  name: string
  owner_id: string
  plan: string
  created_at: string
  plan_status?: string         // active, suspended, trial, cancelled
  trial_ends_at?: string | null
  next_billing_at?: string | null
  suspended_at?: string | null
}

export interface OrgMember {
  id: string
  org_id: string
  user_id: string
  role: UserRole
  phone?: string | null
  status?: string
  permissions?: { all_boards: boolean; board_ids: string[] }
  profile?: Profile
}

export interface Board {
  id: string
  org_id: string
  name: string
  description: string | null
  website_url: string | null
  color: string
  created_at: string
  columns?: BoardColumn[]
  lead_count?: number
}

export interface BoardColumn {
  id: string
  board_id: string
  name: string
  position: number
  color: string
  leads?: Lead[]
}

export interface Lead {
  id: string
  board_id: string
  org_id: string
  column_id: string
  title: string
  name: string
  company: string | null      // empresa/cliente
  concept: string | null      // tipo de trabajo ("Reforma baño", "Boletín eléctrico"…)
  zone: string | null         // ciudad/zona
  phone: string | null
  email: string | null
  address: string | null
  lat: number | null
  lng: number | null
  source: LeadSource
  notes: string | null
  ai_summary: string | null
  assigned_to: string | null
  is_read: boolean            // false = badge "NUEVO"
  public_token: string | null // token para enlace público compartible
  budget_amount: number | null
  commission_amount: number | null
  commission_paid: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
  assigned_professional?: Professional
  column?: BoardColumn
  board?: Board
}

export interface LeadFile {
  id: string
  lead_id: string
  name: string
  url: string
  type: string
  size: number
  created_at: string
}

export interface LeadComment {
  id: string
  lead_id: string
  user_id: string
  content: string
  created_at: string
  profile?: Profile
}

export interface LeadActivity {
  id: string
  lead_id: string
  user_id: string
  action: string
  metadata: Record<string, unknown>
  created_at: string
  profile?: Profile
}

export interface ProRate {
  work_type: string       // tipo de trabajo
  min_price: number       // precio mínimo
  rec_price: number       // precio recomendado
  unit: string            // hora, m², ud…
}

export interface Professional {
  id: string
  org_id: string
  name: string
  phone: string | null
  email: string | null
  specialty: string | null
  is_active: boolean
  user_id: string | null
  magic_token: string | null
  app_access: boolean
  last_access: string | null
  rates?: ProRate[]
  company_name?: string | null
  address?: string | null
  cif?: string | null
  logo_url?: string | null    // data URL (base64) del logo
}

export type BudgetStatus = 'draft' | 'sent' | 'accepted' | 'rejected'

// Estado de una partida de cara al profesional asignado
export type PartidaStatus = 'pending' | 'accepted' | 'rejected' | 'done'

export interface BudgetLine {
  concept: string
  units: number
  unit_price: number
  total: number
}

// Partida (gremio) de un presupuesto, asignable a un profesional
export interface BudgetPartida {
  id: string
  budget_id: string
  org_id: string
  trade: string                 // gremio: albañilería, fontanería, electricidad…
  professional_id: string | null
  lines: BudgetLine[]
  subtotal: number
  status: PartidaStatus
  notes: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface Budget {
  id: string
  org_id: string
  lead_id: string | null
  created_by: string | null
  professional_id?: string | null
  client_name: string | null
  client_phone: string | null
  client_address: string | null
  concept: string | null
  lines: BudgetLine[]
  subtotal: number
  vat_percent: number
  vat_amount: number
  total: number
  margin_percent: number
  validity_days: number
  notes: string | null
  status: BudgetStatus
  ai_generated: boolean
  created_at: string
  updated_at: string
}

export interface ProKnowledge {
  id: string
  professional_id: string
  org_id: string
  type: string                  // document, example_budget, rate_table, note
  title: string | null
  content_text: string | null
  file_url: string | null
  created_at: string
}

export type EventType = 'visita_presencial' | 'llamada' | 'seguimiento' | 'presupuesto_insitu' | 'reunion' | 'otro'

export interface CalendarEvent {
  id: string
  org_id: string
  lead_id: string | null
  user_id: string
  title: string
  description: string | null
  type: EventType
  start_at: string
  end_at: string
  notify_before_minutes: number
  lead?: Lead
}

export interface Notification {
  id: string
  user_id: string
  title: string
  body: string
  is_read: boolean
  created_at: string
  calendar_event_id?: string | null
}

export interface DashboardMetrics {
  total_leads: number
  leads_this_month: number
  total_budget: number
  total_commissions: number
  paid_commissions: number
  pending_commissions: number
  conversion_rate: number
}
