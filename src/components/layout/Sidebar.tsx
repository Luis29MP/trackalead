import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, LayoutGrid, Map, Calendar, DollarSign,
  HardHat, Users, Bell, Settings, LogOut, Radar,
  ChevronDown, Check, Building2, Shield, Star, FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '@/lib/utils'
import type { Organization } from '@/types'

const NAV_ITEMS = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Panel Control' },
  { to: '/boards',        icon: LayoutGrid,      label: 'Tableros' },
  { to: '/map',           icon: Map,             label: 'Mapa' },
  { to: '/calendar',      icon: Calendar,        label: 'Calendario' },
  { to: '/finances',      icon: DollarSign,      label: 'Finanzas' },
  { to: '/budgets',       icon: FileText,        label: 'Presupuestos' },
  { to: '/professionals', icon: HardHat,         label: 'Profesionales' },
  { to: '/team',          icon: Users,           label: 'Equipo' },
  { to: '/notifications', icon: Bell,            label: 'Notificaciones' },
  { to: '/settings',      icon: Settings,        label: 'Configuración' },
]

function OrgSwitcher() {
  const { organization, session } = useAuth()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!session) return
    supabase
      .from('org_members')
      .select('org_id, organization:organizations(id, name, plan)')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (data) setOrgs(data.map((m: Record<string, unknown>) => m.organization as Organization).filter(Boolean))
      })
  }, [session?.user.id])

  async function handleSwitch(orgId: string) {
    localStorage.setItem('selected_org_id', orgId)
    window.location.reload()
  }

  if (orgs.length === 0 && organization) {
    return (
      <div className="mx-3 mb-3 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {organization.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">{organization.name}</p>
            <p className="text-slate-600 text-[10px] truncate">Organización</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-3 relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center gap-2.5"
      >
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
          {organization?.name?.charAt(0).toUpperCase() ?? 'O'}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-white text-xs font-semibold truncate">{organization?.name ?? '…'}</p>
          <p className="text-slate-600 text-[10px] truncate">Cambiar organización</p>
        </div>
        <ChevronDown className={cn('h-3 w-3 text-slate-400 transition-transform shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <p className="text-[10px] uppercase font-bold text-slate-500 px-3 pt-2 pb-1 tracking-widest">
            Mis organizaciones
          </p>
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors',
                org.id === organization?.id
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : 'text-slate-300 hover:bg-white/5'
              )}
            >
              <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-[10px] shrink-0">
                {org.name.charAt(0).toUpperCase()}
              </div>
              <span className="flex-1 truncate font-medium">{org.name}</span>
              {org.id === organization?.id && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
          <div className="border-t border-white/10 px-3 py-2">
            <button
              onClick={() => { setOpen(false); window.location.href = '/settings' }}
              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1.5 transition-colors"
            >
              <Building2 className="h-3 w-3" />
              Gestionar organizaciones
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ width = 240 }: { width?: number }) {
  const { profile, signOut, systemRole } = useAuth()
  const navigate = useNavigate()
  const isLifetime = profile?.plan_status === 'lifetime'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-40"
      style={{ width, background: '#0F172A', flexShrink: 0 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10 shrink-0">
        <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shrink-0">
          <Radar className="h-4 w-4 text-white" />
        </div>
        <span className="text-white font-bold text-[15px] tracking-tight">TrackALead</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-400 hover:bg-white/8 hover:text-white'
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
          {/* Enlace Super Admin — solo visible para super_admin */}
          {systemRole === 'super_admin' && (
            <li>
              <NavLink
                to="/superadmin"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors mt-2 border border-purple-500/30',
                    isActive ? 'bg-purple-600 text-white' : 'text-purple-400 hover:bg-purple-500/20 hover:text-purple-300'
                  )
                }
              >
                <Shield className="h-4 w-4 shrink-0" />
                Super Admin
              </NavLink>
            </li>
          )}
        </ul>
      </nav>

      {/* Org Switcher */}
      <OrgSwitcher />

      {/* User */}
      <div className="px-3 pb-4 border-t border-white/10 pt-3 shrink-0">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-2.5 flex-1 min-w-0 rounded-lg hover:bg-white/5 transition-colors text-left -mx-1 px-1 py-1"
            title="Tu cuenta y configuración"
          >
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-primary-800 text-white text-xs">
                {profile?.full_name ? getInitials(profile.full_name) : 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate leading-tight flex items-center gap-1">
                <span className="truncate">{profile?.full_name ?? 'Usuario'}</span>
                {isLifetime && <Star className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />}
              </p>
              <p className="text-slate-500 text-[11px] truncate">
                {profile?.email}{isLifetime && <span className="text-amber-400"> · Lifetime</span>}
              </p>
            </div>
          </button>
          <button
            onClick={handleSignOut}
            className="text-slate-500 hover:text-white transition-colors shrink-0"
            title="Cerrar sesión"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
