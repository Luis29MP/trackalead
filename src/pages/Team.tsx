import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link, Copy, Check, Crown, Shield, User, Users, Trash2, Pencil, X, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useBoards } from '@/hooks/useBoards'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { getInitials } from '@/lib/utils'
import type { OrgMember, Profile, UserRole, Board, Invitation } from '@/types'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario', admin: 'Administrador',
  manager: 'Gestor', installer: 'Instalador',
}
const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-700', admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700', installer: 'bg-gray-100 text-gray-700',
}

interface MemberWithProfile extends OrgMember {
  profile: Profile
}

interface InviteForm {
  name: string; email: string; phone: string; role: string
  allBoards: boolean; boardIds: string[]
}

const EMPTY_INVITE: InviteForm = {
  name: '', email: '', phone: '', role: 'manager', allBoards: true, boardIds: [],
}

export function Team() {
  const { organization, user } = useAuth()
  const { boards } = useBoards()
  const navigate = useNavigate()
  const [members, setMembers]           = useState<MemberWithProfile[]>([])
  const [pending, setPending]           = useState<Invitation[]>([])
  const [loading, setLoading]           = useState(false)
  const [inviteOpen, setInviteOpen]     = useState(false)
  const [editMember, setEditMember]     = useState<MemberWithProfile | null>(null)
  const [form, setForm]                 = useState<InviteForm>(EMPTY_INVITE)
  const [saving, setSaving]             = useState(false)
  const [generatedLink, setGeneratedLink] = useState('')
  const [copied, setCopied]             = useState(false)

  const isOwner = members.find(m => m.user_id === user?.id)?.role === 'owner'

  useEffect(() => {
    if (!organization) return
    loadAll()
  }, [organization?.id])

  async function loadAll() {
    setLoading(true)
    const [{ data: m }, { data: i }] = await Promise.all([
      supabase.from('org_members').select('*, profile:profiles(*)').eq('org_id', organization!.id).order('role'),
      supabase.from('invitations').select('*').eq('org_id', organization!.id).is('accepted_at', null).order('created_at', { ascending: false }),
    ])
    setMembers((m ?? []) as MemberWithProfile[])
    setPending(i ?? [])
    setLoading(false)
  }

  async function handleInvite() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('invitations').insert({
        org_id: organization!.id,
        created_by: user!.id,
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        role: form.role,
        permissions: { all_boards: form.allBoards, board_ids: form.boardIds },
      }).select().single()
      if (error) throw error
      const link = `${window.location.origin}/invite/${data.token}`
      setGeneratedLink(link)
      toast.success('Invitación generada')
      loadAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al crear invitación')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEditMember() {
    if (!editMember) return
    setSaving(true)
    await supabase.from('org_members').update({ role: editMember.role, permissions: editMember.permissions }).eq('id', editMember.id)
    toast.success('Miembro actualizado')
    setSaving(false)
    setEditMember(null)
    loadAll()
  }

  async function handleRemoveMember(memberId: string) {
    await supabase.from('org_members').delete().eq('id', memberId)
    toast.success('Miembro eliminado')
    loadAll()
  }

  async function handleDeleteInvitation(id: string) {
    await supabase.from('invitations').delete().eq('id', id)
    toast.success('Invitación cancelada')
    loadAll()
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    toast.success('Enlace copiado')
    setTimeout(() => setCopied(false), 2000)
  }

  function shareWhatsApp(link: string, name: string) {
    const msg = encodeURIComponent(`Hola ${name}, te invito a gestionar leads en TrackALead. Entra aquí: ${link}`)
    const phone = form.phone?.replace(/\D/g, '')
    const wa = phone ? `https://wa.me/34${phone}?text=${msg}` : `https://wa.me/?text=${msg}`
    window.open(wa, '_blank')
  }

  function toggleBoard(boardId: string) {
    setForm(f => ({
      ...f,
      boardIds: f.boardIds.includes(boardId)
        ? f.boardIds.filter(id => id !== boardId)
        : [...f.boardIds, boardId],
    }))
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipo</h1>
          <p className="text-gray-500 text-sm mt-1">Colaboradores de <span className="font-medium">{organization?.name}</span></p>
        </div>
        {isOwner && (
          <Button onClick={() => { setForm(EMPTY_INVITE); setGeneratedLink(''); setInviteOpen(true) }}>
            <Users className="h-4 w-4" />Invitar colaborador
          </Button>
        )}
      </div>

      {/* Miembros activos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />{members.length} miembro{members.length !== 1 ? 's' : ''} activo{members.length !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : members.map(m => {
            const isSelf = m.user_id === user?.id
            return (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-0">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs">{m.profile?.full_name ? getInitials(m.profile.full_name) : 'U'}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {m.profile?.full_name ?? 'Usuario'}
                    {isSelf && <span className="text-xs text-gray-400 ml-1">(tú)</span>}
                  </p>
                  <p className="text-xs text-gray-400">{m.profile?.email}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[m.role] ?? ROLE_COLOR.manager}`}>
                  {ROLE_LABEL[m.role] ?? m.role}
                </span>
                {isOwner && !isSelf && m.role !== 'owner' && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditMember({ ...m })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => handleRemoveMember(m.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Invitaciones pendientes */}
      {pending.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-gray-500">Invitaciones pendientes ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pending.map(inv => {
              const link = `${window.location.origin}/invite/${inv.token}`
              return (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{inv.name ?? 'Sin nombre'}</p>
                    <p className="text-xs text-gray-400">{inv.email ?? inv.phone ?? '—'} · {ROLE_LABEL[inv.role] ?? inv.role}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">Pendiente</Badge>
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => copyLink(link)}>
                    <Copy className="h-3 w-3" />Copiar
                  </Button>
                  {inv.phone && (
                    <Button size="sm" variant="outline" className="text-xs text-emerald-700 border-emerald-300" onClick={() => {
                      const msg = encodeURIComponent(`Hola ${inv.name ?? ''}, te invito a gestionar leads en TrackALead. Entra aquí: ${link}`)
                      window.open(`https://wa.me/34${inv.phone!.replace(/\D/g,'')}?text=${msg}`, '_blank')
                    }}>WA</Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => handleDeleteInvitation(inv.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Dialog invitar */}
      <Dialog open={inviteOpen} onOpenChange={v => { setInviteOpen(v); if (!v) setGeneratedLink('') }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Invitar colaborador</DialogTitle></DialogHeader>

          {!generatedLink ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label>Nombre *</Label>
                  <Input placeholder="José García" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" placeholder="jose@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono (para WhatsApp)</Label>
                  <Input placeholder="600 000 000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador — acceso total</SelectItem>
                    <SelectItem value="manager">Gestor — gestión de leads</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3">
                <Label>Permisos de tableros</Label>
                <div className="flex items-center gap-3">
                  <Switch checked={form.allBoards} onCheckedChange={v => setForm(f => ({ ...f, allBoards: v, boardIds: [] }))} />
                  <span className="text-sm text-gray-700">Todos los tableros</span>
                </div>
                {!form.allBoards && (
                  <div className="space-y-2 pl-1">
                    {boards.map((b: Board) => (
                      <label key={b.id} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.boardIds.includes(b.id)} onChange={() => toggleBoard(b.id)}
                          className="rounded border-gray-300 text-primary-600" />
                        <span className="text-sm text-gray-700">{b.name}</span>
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
                <Button onClick={handleInvite} disabled={saving || !form.name.trim()}>
                  {saving ? 'Generando…' : 'Generar enlace de invitación'}
                </Button>
              </div>
            </div>
          ) : (
            /* Enlace generado */
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-sm font-semibold text-green-700 mb-2">✅ Invitación creada para {form.name}</p>
                <div className="flex items-center gap-2 bg-white border border-green-200 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-gray-600 truncate">{generatedLink}</code>
                  <button onClick={() => copyLink(generatedLink)} className="shrink-0 text-gray-400 hover:text-primary-600">
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => copyLink(generatedLink)} className="gap-2">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  Copiar enlace
                </Button>
                <Button
                  className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
                  onClick={() => shareWhatsApp(generatedLink, form.name)}
                >
                  <span>📲</span> Compartir por WhatsApp
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={() => { setInviteOpen(false); setGeneratedLink('') }}>
                Cerrar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog editar miembro */}
      <Dialog open={!!editMember} onOpenChange={() => setEditMember(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Editar colaborador</DialogTitle></DialogHeader>
          {editMember && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{getInitials(editMember.profile?.full_name ?? 'U')}</AvatarFallback></Avatar>
                <div>
                  <p className="text-sm font-medium">{editMember.profile?.full_name}</p>
                  <p className="text-xs text-gray-400">{editMember.profile?.email}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <Select value={editMember.role} onValueChange={v => setEditMember(m => m ? { ...m, role: v as UserRole } : null)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="manager">Gestor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Permisos de tableros</Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={(editMember.permissions as unknown as { all_boards: boolean })?.all_boards ?? true}
                    onCheckedChange={v => setEditMember(m => m ? { ...m, permissions: { all_boards: v, board_ids: [] } as unknown as OrgMember['permissions'] } : null)}
                  />
                  <span className="text-sm">Todos los tableros</span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditMember(null)}>Cancelar</Button>
                <Button onClick={handleSaveEditMember} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
