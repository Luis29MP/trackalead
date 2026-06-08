import { useEffect, useState } from 'react'
import { Info, AlertTriangle, Wrench, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Announcement {
  id: string
  title: string
  body: string
  type: string
  target: string
  expires_at: string | null
}

const TYPE_STYLE: Record<string, { bg: string; icon: React.ElementType }> = {
  info:        { bg: 'bg-blue-600',  icon: Info },
  warning:     { bg: 'bg-amber-500', icon: AlertTriangle },
  maintenance: { bg: 'bg-red-600',   icon: Wrench },
}

export function AnnouncementBanner() {
  const { organization } = useAuth()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dismissed_announcements') ?? '[]') } catch { return [] }
  })

  useEffect(() => {
    load()
  }, [organization?.id])

  async function load() {
    const nowIso = new Date().toISOString()
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })

    // Filtrar por target
    const orgPlan = organization?.plan ?? 'free'
    const filtered = (data ?? []).filter(a => {
      if (a.target === 'all') return true
      if (a.target === 'pro') return orgPlan !== 'free'
      if (a.target === 'free') return orgPlan === 'free'
      if (organization && a.target === organization.id) return true
      return false
    })
    setAnnouncements(filtered)
  }

  function dismiss(id: string) {
    const next = [...dismissed, id]
    setDismissed(next)
    localStorage.setItem('dismissed_announcements', JSON.stringify(next))
  }

  const visible = announcements.filter(a => !dismissed.includes(a.id))
  if (visible.length === 0) return null

  // Mostrar solo el más reciente
  const a = visible[0]
  const style = TYPE_STYLE[a.type] ?? TYPE_STYLE.info
  const Icon = style.icon

  return (
    <div className={`${style.bg} text-white px-4 py-2 flex items-center gap-3 text-sm shrink-0`}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">{a.title}</span>
        <span className="opacity-90"> — {a.body}</span>
      </div>
      <button onClick={() => dismiss(a.id)} className="shrink-0 opacity-80 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
