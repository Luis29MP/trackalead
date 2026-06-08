import { useEffect, useState } from 'react'
import { Plus, HardHat, Phone, Mail, Pencil, Trash2, Smartphone, Copy, Check, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import type { Professional } from '@/types'

interface ProForm {
  name: string; phone: string; email: string; specialty: string
  is_active: boolean; app_access: boolean
}
const EMPTY: ProForm = { name: '', phone: '', email: '', specialty: '', is_active: true, app_access: false }

export function Professionals() {
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading]             = useState(true)
  const [dialog, setDialog]               = useState(false)
  const [editing, setEditing]             = useState<Professional | null>(null)
  const [saving, setSaving]               = useState(false)
  const [form, setForm]                   = useState<ProForm>(EMPTY)
  const [magicLink, setMagicLink]         = useState('')
  const [copied, setCopied]               = useState(false)
  const { organization } = useAuth()

  useEffect(() => {
    if (!organization) return
    loadProfessionals()
  }, [organization?.id])

  async function loadProfessionals() {
    setLoading(true)
    const { data } = await supabase
      .from('professionals').select('*').eq('org_id', organization!.id).order('name')
    setProfessionals(data ?? [])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setMagicLink('')
    setDialog(true)
  }

  function openEdit(p: Professional) {
    setEditing(p)
    setForm({ name: p.name, phone: p.phone ?? '', email: p.email ?? '', specialty: p.specialty ?? '', is_active: p.is_active, app_access: p.app_access })
    setMagicLink(p.app_access && p.magic_token ? `${window.location.origin}/pro/${p.magic_token}` : '')
    setDialog(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        const { data } = await supabase.from('professionals').update({
          name: form.name, phone: form.phone || null, email: form.email || null,
          specialty: form.specialty || null, is_active: form.is_active, app_access: form.app_access,
        }).eq('id', editing.id).select().single()
        if (data?.app_access && data.magic_token) {
          setMagicLink(`${window.location.origin}/pro/${data.magic_token}`)
        }
        toast.success('Profesional actualizado')
      } else {
        const { data } = await supabase.from('professionals').insert({
          org_id: organization!.id,
          name: form.name, phone: form.phone || null, email: form.email || null,
          specialty: form.specialty || null, is_active: form.is_active, app_access: form.app_access,
        }).select().single()
        if (data?.app_access && data.magic_token) {
          setMagicLink(`${window.location.origin}/pro/${data.magic_token}`)
        } else {
          toast.success('Profesional creado')
          setDialog(false)
        }
      }
      loadProfessionals()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await supabase.from('professionals').delete().eq('id', id)
    toast.success('Profesional eliminado')
    loadProfessionals()
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    toast.success('Enlace copiado')
    setTimeout(() => setCopied(false), 2000)
  }

  function sendWhatsApp(pro: Professional, link: string) {
    const msg = encodeURIComponent(
      `Hola ${pro.name}, puedes ver tus trabajos asignados en TrackALead aquí: ${link}`
    )
    const phone = pro.phone?.replace(/\D/g, '')
    const wa = phone ? `https://wa.me/34${phone}?text=${msg}` : `https://wa.me/?text=${msg}`
    window.open(wa, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profesionales</h1>
          <p className="text-gray-500 text-sm mt-1">Instaladores y técnicos asignables</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />Añadir profesional
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : professionals.length === 0 ? (
        <div className="text-center py-16">
          <HardHat className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Sin profesionales</h3>
          <p className="text-gray-500 text-sm mt-1">Añade instaladores o técnicos para asignar a los leads</p>
          <Button className="mt-4" onClick={openCreate}><Plus className="h-4 w-4" />Añadir profesional</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {professionals.map(p => {
            const link = p.magic_token ? `${window.location.origin}/pro/${p.magic_token}` : ''
            return (
              <Card key={p.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                        <Badge variant={p.is_active ? 'success' : 'secondary'} className="text-xs shrink-0">
                          {p.is_active ? 'Activo' : 'Inactivo'}
                        </Badge>
                        {p.app_access && (
                          <Badge className="bg-indigo-100 text-indigo-700 text-xs shrink-0">
                            <Smartphone className="h-3 w-3 mr-1" />Con acceso
                          </Badge>
                        )}
                      </div>
                      {p.specialty && <p className="text-sm text-gray-500 mt-0.5">{p.specialty}</p>}
                      {p.phone && (
                        <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 mt-1.5 text-sm text-gray-600 hover:text-primary-600">
                          <Phone className="h-3.5 w-3.5" />{p.phone}
                        </a>
                      )}
                      {p.email && (
                        <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 mt-1 text-sm text-gray-600 hover:text-primary-600 truncate">
                          <Mail className="h-3.5 w-3.5 shrink-0" />{p.email}
                        </a>
                      )}
                      {/* Acceso a la app */}
                      {p.app_access && link && (
                        <div className="mt-3 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => copyLink(link)} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                              <Copy className="h-3 w-3" />Copiar enlace app
                            </button>
                            <a href={link} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-gray-600">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          {p.phone && (
                            <button onClick={() => sendWhatsApp(p, link)} className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                              📲 Enviar por WhatsApp
                            </button>
                          )}
                          {p.last_access && (
                            <p className="text-[11px] text-gray-400">
                              Último acceso: {new Date(p.last_access).toLocaleDateString('es-ES')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialog crear/editar */}
      <Dialog open={dialog} onOpenChange={v => { setDialog(v); if (!v) setMagicLink('') }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar profesional' : 'Nuevo profesional'}</DialogTitle></DialogHeader>

          {magicLink ? (
            /* Mostrar enlace mágico */
            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
                <Smartphone className="h-8 w-8 text-indigo-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-indigo-700">{form.name} tiene acceso a la app</p>
                <p className="text-xs text-indigo-500 mt-1">Comparte este enlace único con el profesional</p>
              </div>
              <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-3 py-2">
                <code className="flex-1 text-xs text-gray-600 truncate">{magicLink}</code>
                <button onClick={() => copyLink(magicLink)} className="shrink-0 text-gray-400 hover:text-indigo-600">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => copyLink(magicLink)}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  Copiar enlace
                </Button>
                {form.phone && (
                  <Button className="bg-emerald-500 hover:bg-emerald-600 text-white gap-2"
                    onClick={() => {
                      const msg = encodeURIComponent(`Hola ${form.name}, puedes ver tus trabajos asignados en TrackALead aquí: ${magicLink}`)
                      const wa = `https://wa.me/34${form.phone.replace(/\D/g,'')}?text=${msg}`
                      window.open(wa, '_blank')
                    }}>
                    📲 Enviar WhatsApp
                  </Button>
                )}
              </div>
              <Button variant="ghost" className="w-full" onClick={() => { setDialog(false); setMagicLink('') }}>Cerrar</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input placeholder="Carlos López" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Especialidad</Label>
                <Input placeholder="Electricista, Fontanero…" value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input placeholder="600 000 000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" placeholder="carlos@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <Label>Activo</Label>
              </div>
              <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <Switch checked={form.app_access} onCheckedChange={v => setForm(f => ({ ...f, app_access: v }))} />
                <div>
                  <p className="text-sm font-medium text-indigo-800">Acceso a la app</p>
                  <p className="text-xs text-indigo-500">Genera un enlace único para que vea sus trabajos asignados sin contraseña</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDialog(false)}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                  {saving ? 'Guardando…' : form.app_access ? 'Guardar y generar enlace' : 'Guardar'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
