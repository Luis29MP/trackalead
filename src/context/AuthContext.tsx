import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Organization, Profile } from '@/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  organization: Organization | null   // ghost org si está activo, real si no
  realOrganization: Organization | null  // siempre la org real del usuario
  systemRole: string | null
  isGhostMode: boolean
  ghostOrgName: string | null
  loading: boolean
  authError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => Promise<void>
  createOrganization: (name: string) => Promise<void>
  refreshOrganization: () => Promise<void>
  deleteOrganization: () => Promise<void>
  enterGhostMode: (org: Organization) => void
  exitGhostMode: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession]           = useState<Session | null>(null)
  const [profile, setProfile]           = useState<Profile | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [ghostOrg, setGhostOrg]         = useState<Organization | null>(() => {
    // Restaurar ghost mode si estaba activo antes de recargar la página
    const id   = localStorage.getItem('ghost_org_id')
    const name = localStorage.getItem('ghost_org_name')
    if (id && name) return { id, name, owner_id: '', plan: '', created_at: '' } as Organization
    return null
  })
  const [systemRole, setSystemRole]     = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [authError, setAuthError]       = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setLoading((prev) => {
        if (prev) setAuthError('No se pudo conectar con Supabase. Verifica tu conexión.')
        return false
      })
    }, 8000)

    supabase.auth.getSession().then(({ data: { session: s }, error }) => {
      clearTimeout(timeoutRef.current!)
      if (error) { setAuthError('Error Supabase: ' + error.message); setLoading(false); return }
      setSession(s)
      if (s) loadUserData(s.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) { setProfile(null); setOrganization(null) }
    })

    return () => { subscription.unsubscribe(); clearTimeout(timeoutRef.current!) }
  }, [])

  async function loadUserData(userId: string) {
    try {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      if (p) { setProfile(p); setSystemRole(p.system_role ?? 'user') }
      await loadOrg(userId)
    } catch (err) {
      console.error('loadUserData:', err)
    }
  }

  async function loadOrg(userId: string) {
    const { data: member } = await supabase
      .from('org_members').select('org_id').eq('user_id', userId).maybeSingle()
    if (!member) { setOrganization(null); return }
    const { data: org } = await supabase
      .from('organizations').select('*').eq('id', member.org_id).maybeSingle()
    setOrganization(org ?? null)
  }

  async function refreshOrganization() {
    if (!session) return
    await loadOrg(session.user.id)
  }

  // ─── CREAR ORGANIZACIÓN ──────────────────────────────────────────────────────
  // El orden importa: profiles debe existir antes de insertar en organizations
  // porque organizations.owner_id tiene FK → profiles.id
  async function createOrganization(name: string) {
    if (!session) throw new Error('Sin sesión activa')
    const userId = session.user.id
    const email  = session.user.email ?? ''

    // 1. Garantizar que el perfil existe (FK organizations.owner_id → profiles.id)
    const { error: pErr } = await supabase
      .from('profiles')
      .upsert({ id: userId, email, full_name: profile?.full_name ?? null }, { onConflict: 'id' })
    if (pErr) throw new Error(`Error de perfil: ${pErr.message}`)

    // 2. Crear organización
    const { data: org, error: oErr } = await supabase
      .from('organizations')
      .insert({ name: name.trim(), owner_id: userId })
      .select()
      .single()
    if (oErr) throw new Error(`Error al crear organización: ${oErr.message}`)

    // 3. Añadir usuario como owner en org_members
    const { error: mErr } = await supabase.from('org_members').insert({
      org_id: org.id, user_id: userId, role: 'owner',
    })
    // 23505 = unique violation → ya era miembro, no es un error real
    if (mErr && mErr.code !== '23505') throw new Error(`Error al unirse: ${mErr.message}`)

    setOrganization(org)
  }

  async function deleteOrganization() {
    if (!organization) throw new Error('Sin organización activa')
    const { error } = await supabase.from('organizations').delete().eq('id', organization.id)
    if (error) throw new Error(`Error al eliminar: ${error.message}`)
    setOrganization(null)
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data.user) await loadUserData(data.user.id)
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }, // para el trigger handle_new_user
    })
    if (error) throw error
    if (!data.user) throw new Error('No se recibió usuario de Supabase')

    // Upsert manual como seguro adicional al trigger
    await supabase.from('profiles').upsert(
      { id: data.user.id, email, full_name: fullName },
      { onConflict: 'id' }
    )
  }

  function enterGhostMode(org: Organization) {
    localStorage.setItem('ghost_org_id', org.id)
    localStorage.setItem('ghost_org_name', org.name)
    setGhostOrg(org)
  }

  function exitGhostMode() {
    localStorage.removeItem('ghost_org_id')
    localStorage.removeItem('ghost_org_name')
    setGhostOrg(null)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setOrganization(null)
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      profile,
      organization: ghostOrg ?? organization,   // ghost tiene prioridad
      realOrganization: organization,
      systemRole,
      isGhostMode: !!ghostOrg,
      ghostOrgName: ghostOrg?.name ?? null,
      loading,
      authError,
      signIn, signUp, signOut,
      createOrganization, refreshOrganization, deleteOrganization,
      enterGhostMode, exitGhostMode,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
