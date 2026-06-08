import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Notification } from '@/types'

const EVENT_TYPE_LABELS: Record<string, string> = {
  visita_presencial:  'Visita presencial',
  llamada:            'Llamada',
  seguimiento:        'Seguimiento',
  presupuesto_insitu: 'Presupuesto in-situ',
  reunion:            'Reunión',
  otro:               'Otro',
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const { user, organization } = useAuth()
  const loadingRef = useRef(false)

  useEffect(() => {
    if (!user) return
    load()
    checkUpcoming()

    const interval = setInterval(() => {
      load()
      checkUpcoming()
    }, 5 * 60 * 1000)   // cada 5 minutos

    return () => clearInterval(interval)
  }, [user?.id, organization?.id])  // eslint-disable-line

  async function load() {
    if (!user || loadingRef.current) return
    loadingRef.current = true
    try {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)
      const list = data ?? []
      setNotifications(list)
      setUnreadCount(list.filter(n => !n.is_read).length)
    } finally {
      loadingRef.current = false
    }
  }

  async function checkUpcoming() {
    if (!user || !organization) return

    const now = new Date()
    const todayStart    = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const todayEnd      = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
    const tomorrowEnd   = new Date(tomorrowStart.getTime() + 86_400_000 - 1000)

    const { data: events } = await supabase
      .from('calendar_events')
      .select('*, lead:leads(name, concept)')
      .eq('org_id', organization.id)
      .gte('start_at', todayStart.toISOString())
      .lte('start_at', tomorrowEnd.toISOString())
      .order('start_at')

    if (!events?.length) return

    for (const ev of events) {
      // Comprobar si ya existe notificación para este evento
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', user.id)
        .eq('calendar_event_id', ev.id)
        .maybeSingle()

      if (existing) continue

      const evDate  = new Date(ev.start_at)
      const isToday = evDate >= todayStart && evDate <= todayEnd
      const timeStr = format(evDate, 'HH:mm', { locale: es })
      const lead    = ev.lead as { name?: string; concept?: string } | null
      const name    = lead?.name ? lead.name.replace(/^nombre:\s*/i, '').trim() : 'Cliente'
      const concept = lead?.concept ?? ''
      const typeLabel = EVENT_TYPE_LABELS[ev.type] ?? ev.title

      const title = isToday
        ? `🔴 HOY a las ${timeStr} — ${typeLabel}`
        : `🟡 Mañana a las ${timeStr} — ${typeLabel}`
      const body = concept ? `${name} — ${concept}` : name

      await supabase.from('notifications').insert({
        user_id: user.id,
        title,
        body,
        calendar_event_id: ev.id,
        is_read: false,
      })
    }

    await load()
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function markAllRead() {
    if (!user) return
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  return { notifications, unreadCount, load, markRead, markAllRead }
}
