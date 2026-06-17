import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Bell, Radar, CheckCheck, Phone, MapPin, Wrench } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/hooks/useNotifications'
import { formatRelativeTime } from '@/lib/utils'

interface LeadLite {
  id: string
  name: string | null
  phone: string | null
  concept: string | null
  zone: string | null
}

export function Topbar() {
  const [search, setSearch] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { organization } = useAuth()
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()

  // Cargar todos los leads activos de la org en memoria (búsqueda instantánea y por teléfono)
  const [allLeads, setAllLeads] = useState<LeadLite[]>([])
  useEffect(() => {
    if (!organization?.id) { setAllLeads([]); return }
    supabase.from('leads')
      .select('id, name, phone, concept, zone')
      .eq('org_id', organization.id)
      .eq('is_archived', false)
      .then(({ data }) => setAllLeads((data ?? []) as LeadLite[]))
  }, [organization?.id])

  // Filtro: por nombre/concepto/zona (texto) y por teléfono comparando solo dígitos
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    const qDigits = q.replace(/\D/g, '')
    return allLeads.filter(l => {
      if (l.name?.toLowerCase().includes(q)) return true
      if (l.concept?.toLowerCase().includes(q)) return true
      if (l.zone?.toLowerCase().includes(q)) return true
      if (qDigits.length >= 3 && (l.phone?.replace(/\D/g, '') ?? '').includes(qDigits)) return true
      return false
    }).slice(0, 8)
  }, [search, allLeads])

  // Cerrar dropdowns al click fuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function goToLead(id: string) {
    setSearch(''); setSearchOpen(false)
    navigate(`/leads/${id}`)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (results.length > 0) goToLead(results[0].id)   // Enter → primer resultado
  }

  function handleNotifClick(n: { id: string; body: string; calendar_event_id?: string | null }) {
    markRead(n.id)
    setNotifOpen(false)
    // Navegar al lead si el cuerpo menciona un lead_id (futuro), por ahora ir a notificaciones
    navigate('/notifications')
  }

  return (
    <header className="bg-white border-b border-gray-200 shrink-0">

      {/* ── Versión móvil ────────────────────────────────────────────── */}
      <div className="flex md:hidden items-center justify-between px-4" style={{ height: 56 }}>
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-primary-600" />
          <span className="font-bold text-[15px] text-gray-900 tracking-tight">TrackALead</span>
        </div>
        <div className="relative" ref={notifOpen ? notifRef : undefined}>
          <Button variant="ghost" size="icon" onClick={() => setNotifOpen(o => !o)}>
            <Bell className="h-5 w-5 text-gray-500" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>
          {notifOpen && <NotifDropdown notifications={notifications} unreadCount={unreadCount} onMarkRead={handleNotifClick} onMarkAll={markAllRead} onClose={() => setNotifOpen(false)} navigate={navigate} />}
        </div>
      </div>

      {/* ── Versión escritorio ───────────────────────────────────────── */}
      <div className="hidden md:flex items-center gap-4 px-6" style={{ height: 56 }}>
        <div className="flex-1 flex justify-center">
          <div className="relative w-full max-w-md" ref={searchRef}>
            <form onSubmit={handleSearch}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Buscar por teléfono, nombre, trabajo o zona…"
                value={search}
                onChange={e => { setSearch(e.target.value); setSearchOpen(true) }}
                onFocus={() => setSearchOpen(true)}
                className="pl-9 h-8 text-sm bg-gray-50 border-gray-200 focus:bg-white"
              />
            </form>

            {searchOpen && search.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                {results.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-6">Sin resultados para "{search}"</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    {results.map(l => (
                      <button
                        key={l.id}
                        onClick={() => goToLead(l.id)}
                        className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <p className="text-sm font-medium text-gray-900 truncate">{l.name || 'Lead'}</p>
                        <div className="flex items-center gap-2.5 text-[11px] text-gray-400 mt-0.5 flex-wrap">
                          {l.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{l.phone}</span>}
                          {l.concept && <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />{l.concept}</span>}
                          {l.zone && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{l.zone}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Campana con badge */}
        <div className="relative shrink-0" ref={notifRef}>
          <Button variant="ghost" size="icon" onClick={() => setNotifOpen(o => !o)} title="Notificaciones">
            <Bell className="h-4 w-4 text-gray-500" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>
          {notifOpen && (
            <NotifDropdown
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={handleNotifClick}
              onMarkAll={markAllRead}
              onClose={() => setNotifOpen(false)}
              navigate={navigate}
            />
          )}
        </div>
      </div>
    </header>
  )
}

// ── Dropdown de notificaciones ────────────────────────────────────────────────
function NotifDropdown({ notifications, unreadCount, onMarkRead, onMarkAll, onClose, navigate }: {
  notifications: Array<{ id: string; title: string; body: string; is_read: boolean; created_at: string; calendar_event_id?: string | null }>
  unreadCount: number
  onMarkRead: (n: { id: string; body: string; calendar_event_id?: string | null }) => void
  onMarkAll: () => void
  onClose: () => void
  navigate: (path: string) => void
}) {
  return (
    <div
      className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden"
      style={{ maxHeight: 440 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
        <span className="text-sm font-semibold text-gray-800">
          Notificaciones {unreadCount > 0 && <span className="text-red-500">({unreadCount})</span>}
        </span>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button onClick={onMarkAll} className="text-[11px] text-primary-600 hover:underline flex items-center gap-1">
              <CheckCheck className="h-3 w-3" />Leer todas
            </button>
          )}
          <button onClick={() => { onClose(); navigate('/notifications') }} className="text-[11px] text-gray-400 hover:text-gray-600">
            Ver todas
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
        {notifications.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">Sin notificaciones</div>
        ) : (
          notifications.slice(0, 5).map(n => (
            <button
              key={n.id}
              onClick={() => onMarkRead(n)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-start gap-3 ${!n.is_read ? 'bg-blue-50/40' : ''}`}
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!n.is_read ? 'bg-primary-500' : 'bg-transparent'}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-snug ${!n.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {n.title}
                </p>
                <p className="text-[11px] text-gray-500 truncate mt-0.5">{n.body}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{formatRelativeTime(n.created_at)}</p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
