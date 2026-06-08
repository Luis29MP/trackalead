import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/types'
import { useAuth } from '@/context/AuthContext'

// Columnas seguras: solo las que SIEMPRE existen en el schema inicial
const LEAD_SELECT = `
  id, board_id, org_id, column_id, title, name, phone, email,
  address, lat, lng, source, notes, ai_summary, assigned_to,
  budget_amount, commission_amount, commission_paid, is_archived,
  created_at, updated_at,
  column:board_columns(id, name, color, position),
  board:boards(id, name, color),
  assigned_professional:professionals(id, name, specialty, phone, email)
`.replace(/\s+/g, ' ').trim()

// Columnas opcionales que pueden no existir todavía (migración pendiente)
async function enrichLead(lead: Lead): Promise<Lead> {
  try {
    const { data } = await supabase
      .from('leads')
      .select('company, concept, zone, is_read, public_token')
      .eq('id', lead.id)
      .maybeSingle()
    if (data) return { ...lead, ...data }
  } catch { /* columnas no existen aún — silencioso */ }
  return lead
}

export function useLeads(boardId?: string) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const { organization } = useAuth()

  useEffect(() => {
    if (!organization?.id) return
    loadLeads()
  }, [organization?.id, boardId])   // eslint-disable-line

  async function loadLeads() {
    setLoading(true)
    try {
      let query = supabase
        .from('leads')
        .select(LEAD_SELECT)
        .eq('org_id', organization!.id)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })

      if (boardId) query = query.eq('board_id', boardId)

      const { data, error } = await query
      if (error) { console.error('[useLeads]', error); setLeads([]); return }
      setLeads((data as unknown as Lead[]) ?? [])
    } catch (err) {
      console.error('[useLeads] error:', err)
      setLeads([])
    } finally {
      setLoading(false)
    }
  }

  return { leads, loading, refetch: loadLeads }
}

export function useLead(leadId: string) {
  const [lead, setLead]   = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!leadId) { setLoading(false); return }
    loadLead()
  }, [leadId])   // eslint-disable-line

  async function loadLead() {
    setLoading(true)
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_SELECT)
        .eq('id', leadId)
        .maybeSingle()

      if (error) throw error

      if (data) {
        const enriched = await enrichLead(data as unknown as Lead)
        setLead(enriched)
      } else {
        setLead(null)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useLead] error:', msg)
      setLoadError(msg)
      setLead(null)
    } finally {
      setLoading(false)
    }
  }

  return { lead, loading, loadError, refetch: loadLead }
}
