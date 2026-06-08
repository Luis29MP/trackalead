import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Building2, CreditCard, Megaphone, Settings, LogOut, Shield, Radar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

const ADMIN_NAV = [
  { to: '/superadmin',               icon: LayoutDashboard, label: 'Dashboard',        end: true },
  { to: '/superadmin/organizations', icon: Building2,       label: 'Organizaciones'   },
  { to: '/superadmin/billing',       icon: CreditCard,      label: 'Suscripciones'    },
  { to: '/superadmin/communications',icon: Megaphone,       label: 'Comunicaciones'   },
  { to: '/superadmin/plans',         icon: Settings,        label: 'Configuración'    },
]

export function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ minWidth: 1100 }}>

      {/* ── Sidebar admin ────────────────────────────────────────────── */}
      <aside
        className="flex flex-col h-full shrink-0"
        style={{ width: 240, background: '#0F172A' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/10">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shrink-0">
            <Radar className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <span className="text-white font-bold text-[14px]">TrackALead</span>
            <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider flex items-center gap-1">
              <Shield className="h-2.5 w-2.5" />Admin
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <ul className="space-y-0.5">
            {ADMIN_NAV.map(({ to, icon: Icon, label, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors',
                      isActive
                        ? 'bg-purple-600 text-white'
                        : 'text-slate-400 hover:bg-white/8 hover:text-white'
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Usuario */}
        <div className="px-3 pb-4 border-t border-white/10 pt-3 shrink-0">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-7 h-7 bg-purple-700 rounded-full flex items-center justify-center shrink-0">
              <Shield className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{profile?.full_name ?? 'Super Admin'}</p>
              <p className="text-slate-500 text-[11px] truncate">{profile?.email}</p>
            </div>
            <button onClick={handleSignOut} className="text-slate-500 hover:text-white transition-colors" title="Cerrar sesión">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Contenido ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Topbar admin */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center gap-3 px-6 shrink-0">
          <Shield className="h-4 w-4 text-purple-600" />
          <span className="font-semibold text-gray-800 text-sm">Panel de Administración</span>
          <span className="text-xs text-gray-400 ml-1">— TrackALead HQ</span>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
