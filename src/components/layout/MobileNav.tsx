import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, LayoutGrid, Map, Calendar, Menu, X,
  DollarSign, HardHat, Users, Bell, Settings, LogOut, Radar,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const BOTTOM_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Inicio' },
  { to: '/boards',    icon: LayoutGrid,      label: 'Tableros' },
  { to: '/map',       icon: Map,             label: 'Mapa' },
  { to: '/calendar',  icon: Calendar,        label: 'Agenda' },
]

const DRAWER_ITEMS = [
  { to: '/finances',      icon: DollarSign, label: 'Finanzas' },
  { to: '/professionals', icon: HardHat,    label: 'Profesionales' },
  { to: '/team',          icon: Users,      label: 'Equipo' },
  { to: '/notifications', icon: Bell,       label: 'Notificaciones' },
  { to: '/settings',      icon: Settings,   label: 'Configuración' },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  return (
    <>
      {/* ── Barra inferior ──────────────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50"
        style={{ height: 64 }}
      >
        <div className="flex h-full">
          {BOTTOM_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary-600' : 'text-gray-400'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('h-5 w-5', isActive && 'text-primary-600')} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}

          {/* Botón Menú */}
          <button
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              open ? 'text-primary-600' : 'text-gray-400'
            )}
            onClick={() => setOpen(true)}
          >
            <Menu className={cn('h-5 w-5', open && 'text-primary-600')} />
            <span>Menú</span>
          </button>
        </div>
      </nav>

      {/* ── Drawer lateral derecho ───────────────────────────────────── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-[60] flex justify-end">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="relative w-72 h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header del drawer */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary-600" />
                <span className="font-bold text-[15px] text-gray-900">TrackALead</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Perfil */}
            {profile && (
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900 truncate">{profile.full_name ?? 'Usuario'}</p>
                <p className="text-xs text-gray-400 truncate">{profile.email}</p>
              </div>
            )}

            {/* Items del drawer */}
            <nav className="flex-1 overflow-y-auto py-2">
              {DRAWER_ITEMS.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-50'
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </nav>

            {/* Cerrar sesión */}
            <div className="border-t border-gray-100 p-4">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 w-full px-2 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
