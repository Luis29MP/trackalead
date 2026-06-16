import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Radar, AlertCircle, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Invitation } from '@/types'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario', admin: 'Administrador', manager: 'Colaborador', installer: 'Instalador',
}

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [invitation, setInvitation]   = useState<Invitation & { org_name?: string } | null>(null)
  const [loading, setLoading]         = useState(true)
  const [notFound, setNotFound]       = useState(false)
  const [alreadyUsed, setAlreadyUsed] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [done, setDone]               = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPw: '' })

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    loadInvitation()
  }, [token])

  async function loadInvitation() {
    setLoading(true)
    const { data } = await supabase.rpc('invitation_by_token', { p_token: token })
    if (!data) { setNotFound(true); setLoading(false); return }
    const inv = data as Invitation & { org_name?: string }
    if (inv.accepted_at) { setAlreadyUsed(true); setLoading(false); return }
    setInvitation(inv)
    setForm(f => ({ ...f, name: inv.name ?? '', email: inv.email ?? '' }))
    setLoading(false)
  }

  async function handleAccept() {
    if (!invitation) return
    if (form.password !== form.confirmPw) { toast.error('Las contraseñas no coinciden'); return }
    if (form.password.length < 6) { toast.error('Mínimo 6 caracteres'); return }
    if (!form.name.trim()) { toast.error('Escribe tu nombre'); return }

    setSaving(true)
    try {
      // 1. Crear cuenta Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { full_name: form.name.trim() } },
      })
      if (authErr) throw authErr
      if (!authData.user) throw new Error('No se pudo crear la cuenta')

      const userId = authData.user.id

      // 2. Crear/actualizar perfil (policy profiles_insert_own)
      await supabase.from('profiles').upsert({
        id: userId, email: form.email, full_name: form.name.trim(),
      }, { onConflict: 'id' })

      // 3. Aceptar invitación: crea la membresía con rol/permisos y marca aceptada (RPC SECURITY DEFINER)
      const { error: accErr } = await supabase.rpc('accept_invitation', { p_token: token, p_user_id: userId })
      if (accErr) throw accErr

      setDone(true)
      toast.success('¡Bienvenido a TrackALead!')
      setTimeout(() => navigate('/dashboard'), 2000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear cuenta'
      toast.error(msg.includes('already registered') ? 'Este email ya está registrado' : msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="text-center text-white max-w-sm">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
        <h2 className="text-xl font-bold mb-2">Enlace no válido</h2>
        <p className="text-slate-400">Esta invitación no existe o ha caducado.</p>
      </div>
    </div>
  )

  if (alreadyUsed) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="text-center text-white max-w-sm">
        <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-400" />
        <h2 className="text-xl font-bold mb-2">Invitación ya usada</h2>
        <p className="text-slate-400 mb-4">Esta invitación ya fue aceptada.</p>
        <Button onClick={() => navigate('/login')}>Ir al login</Button>
      </div>
    </div>
  )

  if (done) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="text-center text-white max-w-sm">
        <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-400" />
        <h2 className="text-xl font-bold mb-2">¡Bienvenido!</h2>
        <p className="text-slate-400">Redirigiendo al panel…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
            <Radar className="h-5 w-5 text-white" />
          </div>
          <span className="text-white font-bold text-2xl">TrackALead</span>
        </div>

        <Card className="shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Invitación recibida</CardTitle>
            <CardDescription>
              Te han invitado a unirte a{' '}
              <strong className="text-gray-800">{invitation?.org_name}</strong>{' '}
              como <strong className="text-gray-800">{ROLE_LABEL[invitation?.role ?? 'manager'] ?? invitation?.role}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tu nombre</Label>
              <Input placeholder="José García" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                disabled={!!invitation?.email} className={invitation?.email ? 'bg-gray-50' : ''} />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña</Label>
              <Input type="password" placeholder="••••••••" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar contraseña</Label>
              <Input type="password" placeholder="••••••••" value={form.confirmPw} onChange={e => setForm(f => ({ ...f, confirmPw: e.target.value }))} />
            </div>
            <Button className="w-full" onClick={handleAccept} disabled={saving || !form.name || !form.email || !form.password}>
              {saving ? 'Creando cuenta…' : 'Aceptar invitación y entrar'}
            </Button>
            <p className="text-center text-xs text-gray-400">
              ¿Ya tienes cuenta?{' '}
              <button className="text-primary-600 hover:underline" onClick={() => navigate('/login')}>Inicia sesión</button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
