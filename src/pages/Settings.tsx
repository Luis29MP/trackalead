import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  User, Building2, Lock, Globe, Link, Copy, Check,
  Crown, Shield, Trash2, Plus, Users,
} from 'lucide-react'
import { getInitials } from '@/lib/utils'
import type { OrgMember, Profile, UserRole } from '@/types'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario', admin: 'Administrador', manager: 'Gestor', installer: 'Instalador',
}
const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-700', admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700', installer: 'bg-gray-100 text-gray-700',
}

export function Settings() {
  const { profile, organization, user, createOrganization, deleteOrganization, refreshOrganization } = useAuth()
  const navigate = useNavigate()

  // ── Perfil ──────────────────────────────────────────────────────────────────
  const [profileForm, setProfileForm] = useState({ full_name: '' })
  const [savingProfile, setSavingProfile] = useState(false)

  // ── Organización ────────────────────────────────────────────────────────────
  const [orgName, setOrgName] = useState('')
  const [savingOrg, setSavingOrg] = useState(false)
  const [members, setMembers] = useState<(OrgMember & { profile: Profile })[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [showNewOrg, setShowNewOrg] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deletingOrg, setDeletingOrg] = useState(false)

  // ── Seguridad ───────────────────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ password: '', confirm: '' })
  const [savingPw, setSavingPw] = useState(false)

  // ── Notificaciones ──────────────────────────────────────────────────────────
  const [notifEmail, setNotifEmail] = useState(true)

  useEffect(() => {
    if (profile) setProfileForm({ full_name: profile.full_name ?? '' })
    if (organization) { setOrgName(organization.name); loadMembers() }
  }, [profile?.id, organization?.id])

  async function loadMembers() {
    if (!organization) return
    setLoadingMembers(true)
    const { data } = await supabase
      .from('org_members').select('*, profile:profiles(*)')
      .eq('org_id', organization.id).order('role')
    setMembers((data ?? []) as (OrgMember & { profile: Profile })[])
    setLoadingMembers(false)
  }

  // ── PERFIL ───────────────────────────────────────────────────────────────────
  async function saveProfile() {
    if (!user) return
    setSavingProfile(true)
    const { error } = await supabase.from('profiles').update({ full_name: profileForm.full_name }).eq('id', user.id)
    if (error) toast.error('Error al guardar perfil')
    else toast.success('Perfil actualizado')
    setSavingProfile(false)
  }

  // ── ORGANIZACIÓN ─────────────────────────────────────────────────────────────
  async function saveOrgName() {
    if (!organization) return
    setSavingOrg(true)
    const { error } = await supabase.from('organizations').update({ name: orgName }).eq('id', organization.id)
    if (error) toast.error('Error al guardar')
    else { toast.success('Nombre actualizado'); await refreshOrganization() }
    setSavingOrg(false)
  }

  function generateInviteLink() {
    const link = `${window.location.origin}/join/${organization!.id}`
    setInviteLink(link)
  }

  async function copyInviteLink() {
    if (!inviteLink) generateInviteLink()
    await navigator.clipboard.writeText(inviteLink || `${window.location.origin}/join/${organization!.id}`)
    setCopied(true)
    toast.success('Enlace copiado')
    setTimeout(() => setCopied(false), 2000)
  }

  async function changeRole(memberId: string, role: UserRole) {
    await supabase.from('org_members').update({ role }).eq('id', memberId)
    toast.success('Rol actualizado')
    loadMembers()
  }

  async function removeMember(memberId: string) {
    await supabase.from('org_members').delete().eq('id', memberId)
    toast.success('Miembro eliminado')
    loadMembers()
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return
    setCreatingOrg(true)
    try {
      await createOrganization(newOrgName.trim())
      toast.success('Nueva organización creada')
      setShowNewOrg(false)
      setNewOrgName('')
      navigate('/boards')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setCreatingOrg(false)
    }
  }

  async function handleDeleteOrg() {
    setDeletingOrg(true)
    try {
      await deleteOrganization()
      toast.success('Organización eliminada')
      setConfirmDelete(false)
      navigate('/onboarding')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeletingOrg(false)
    }
  }

  // ── SEGURIDAD ────────────────────────────────────────────────────────────────
  async function savePassword() {
    if (pwForm.password !== pwForm.confirm) { toast.error('Las contraseñas no coinciden'); return }
    if (pwForm.password.length < 6) { toast.error('Mínimo 6 caracteres'); return }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: pwForm.password })
    if (error) toast.error('Error al cambiar contraseña')
    else { toast.success('Contraseña actualizada'); setPwForm({ password: '', confirm: '' }) }
    setSavingPw(false)
  }

  const isOwner = members.find((m) => m.user_id === user?.id)?.role === 'owner'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-gray-500 text-sm mt-1">Cuenta, organización y seguridad</p>
      </div>

      <Tabs defaultValue="org">
        <TabsList className="mb-6">
          <TabsTrigger value="org"><Building2 className="h-3.5 w-3.5 mr-1.5" />Organización</TabsTrigger>
          <TabsTrigger value="profile"><User className="h-3.5 w-3.5 mr-1.5" />Perfil</TabsTrigger>
          <TabsTrigger value="security"><Lock className="h-3.5 w-3.5 mr-1.5" />Seguridad</TabsTrigger>
          <TabsTrigger value="api"><Globe className="h-3.5 w-3.5 mr-1.5" />API</TabsTrigger>
        </TabsList>

        {/* ── ORGANIZACIÓN ─────────────────────────────────────────────────── */}
        <TabsContent value="org" className="space-y-5">
          {/* Nombre */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Información de la organización</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <div className="flex gap-2">
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Mi Empresa S.L." />
                  <Button onClick={saveOrgName} disabled={savingOrg || !orgName.trim()}>
                    {savingOrg ? 'Guardando…' : 'Guardar'}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>ID de organización</Label>
                <Input value={organization?.id ?? '—'} disabled className="bg-gray-50 font-mono text-xs" />
              </div>
            </CardContent>
          </Card>

          {/* Miembros */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Miembros ({members.length})
                </CardTitle>
                {isOwner && (
                  <Button size="sm" variant="outline" onClick={copyInviteLink}>
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Link className="h-3.5 w-3.5" />}
                    {copied ? 'Copiado' : 'Copiar enlace de invitación'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingMembers ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {members.map((m) => {
                    const isSelf = m.user_id === user?.id
                    return (
                      <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className="text-xs">
                            {m.profile?.full_name ? getInitials(m.profile.full_name) : 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {m.profile?.full_name ?? 'Usuario'}
                            {isSelf && <span className="text-xs text-gray-400 ml-1">(tú)</span>}
                          </p>
                          <p className="text-xs text-gray-400">{m.profile?.email}</p>
                        </div>
                        {isOwner && !isSelf && m.role !== 'owner' ? (
                          <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as UserRole)}>
                            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Administrador</SelectItem>
                              <SelectItem value="manager">Gestor</SelectItem>
                              <SelectItem value="installer">Instalador</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className={`text-xs ${ROLE_COLOR[m.role] ?? ROLE_COLOR.installer}`}>
                            {ROLE_LABEL[m.role] ?? m.role}
                          </Badge>
                        )}
                        {isOwner && !isSelf && m.role !== 'owner' && (
                          <button onClick={() => removeMember(m.id)} className="text-red-400 hover:text-red-600 ml-1">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {isOwner && (
                <div className="px-5 py-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    Comparte el enlace de invitación con quien quieras añadir. Al acceder y aceptar, se unirán como Gestor (puedes cambiar el rol después).
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Nueva organización */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Crear otra organización</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-3">
                Puedes tener varias organizaciones. Útil si gestionas más de una empresa.
              </p>
              {showNewOrg ? (
                <div className="flex gap-2">
                  <Input
                    placeholder="Nombre de la nueva organización"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    autoFocus
                  />
                  <Button onClick={handleCreateOrg} disabled={creatingOrg || !newOrgName.trim()}>
                    {creatingOrg ? 'Creando…' : 'Crear'}
                  </Button>
                  <Button variant="outline" onClick={() => { setShowNewOrg(false); setNewOrgName('') }}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setShowNewOrg(true)}>
                  <Plus className="h-4 w-4" />
                  Nueva organización
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Zona de peligro */}
          {isOwner && (
            <Card className="border-red-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-red-600">Zona de peligro</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 mb-3">
                  Eliminar la organización borrará todos sus tableros, leads y datos. Esta acción es irreversible.
                </p>
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                  Eliminar organización
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── PERFIL ───────────────────────────────────────────────────────── */}
        <TabsContent value="profile" className="space-y-5">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Tu perfil</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user?.email ?? ''} disabled className="bg-gray-50" />
              </div>
              <div className="space-y-1.5">
                <Label>Nombre completo</Label>
                <Input
                  value={profileForm.full_name}
                  onChange={(e) => setProfileForm((f) => ({ ...f, full_name: e.target.value }))}
                  placeholder="Tu nombre"
                />
              </div>
              <Button onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SEGURIDAD ────────────────────────────────────────────────────── */}
        <TabsContent value="security" className="space-y-5">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Cambiar contraseña</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nueva contraseña</Label>
                <Input type="password" value={pwForm.password} onChange={(e) => setPwForm((f) => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <Label>Confirmar contraseña</Label>
                <Input type="password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))} placeholder="••••••••" />
              </div>
              <Button onClick={savePassword} disabled={savingPw || !pwForm.password}>
                {savingPw ? 'Guardando…' : 'Cambiar contraseña'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Notificaciones por email</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Nuevo lead</p>
                  <p className="text-xs text-gray-400">Recibe un email cuando entre un nuevo lead</p>
                </div>
                <Switch checked={notifEmail} onCheckedChange={setNotifEmail} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── API / WEBHOOK ────────────────────────────────────────────────── */}
        <TabsContent value="api" className="space-y-5">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Webhook — Recepción de leads</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Conecta cualquier formulario web para que los leads entren directamente en el tablero que elijas.
              </p>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Endpoint</p>
                <div className="bg-slate-900 rounded-lg px-4 py-2.5">
                  <code className="text-xs text-green-400">POST https://qplznujisnpwyhrjjuyp.supabase.co/functions/v1/ingest-lead</code>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Headers</p>
                <div className="bg-slate-900 rounded-lg px-4 py-2.5 space-y-1">
                  <code className="text-xs text-slate-400 block">Authorization: Bearer YOUR_SECRET_TOKEN</code>
                  <code className="text-xs text-slate-400 block">Content-Type: application/json</code>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Body JSON</p>
                <div className="bg-slate-900 rounded-lg px-4 py-3">
                  <pre className="text-xs text-green-400 font-mono leading-relaxed">{`{
  "board_id": "uuid-de-tu-tablero",
  "name":     "Juan García",
  "phone":    "600000000",
  "email":    "juan@email.com",
  "address":  "Calle Mayor 1, Madrid",
  "source":   "form",
  "notes":    "Interesado en reforma cocina"
}`}</pre>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                El lead se crea automáticamente en la columna "Nuevo" del tablero indicado.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm delete dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600">¿Eliminar organización?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Se eliminarán <strong>todos los tableros, leads, archivos y datos</strong> de{' '}
            <strong>{organization?.name}</strong>. Esta acción no se puede deshacer.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteOrg} disabled={deletingOrg}>
              {deletingOrg ? 'Eliminando…' : 'Sí, eliminar todo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
