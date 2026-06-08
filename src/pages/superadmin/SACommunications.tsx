import { useEffect, useState } from 'react'
import { Megaphone, Info, AlertTriangle, Wrench, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDateTime } from '@/lib/utils'

interface Announcement {
  id: string
  title: string
  body: string
  type: string
  target: string
  expires_at: string | null
  created_at: string
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ElementType; bg: string }> = {
  info:        { label: 'Info', color: 'text-blue-600', icon: Info, bg: 'bg-blue-50 border-blue-200' },
  warning:     { label: 'Advertencia', color: 'text-amber-600', icon: AlertTriangle, bg: 'bg-amber-50 border-amber-200' },
  maintenance: { label: 'Mantenimiento', color: 'text-red-600', icon: Wrench, bg: 'bg-red-50 border-red-200' },
}

export function SACommunications() {
  const { user } = useAuth()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ title: '', body: '', type: 'info', target: 'all', expires_at: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false })
    setAnnouncements(data ?? [])
    setLoading(false)
  }

  async function handleSend() {
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    try {
      await supabase.from('announcements').insert({
        title: form.title.trim(),
        body: form.body.trim(),
        type: form.type,
        target: form.target,
        created_by: user!.id,
        expires_at: form.expires_at || null,
      })
      toast.success('Comunicación enviada')
      setForm({ title: '', body: '', type: 'info', target: 'all', expires_at: '' })
      load()
    } catch { toast.error('Error al enviar') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    await supabase.from('announcements').delete().eq('id', id)
    toast.success('Comunicación eliminada')
    load()
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Comunicaciones</h1>
        <p className="text-gray-400 text-sm">Anuncios y notificaciones globales a usuarios</p>
      </div>

      {/* Crear anuncio */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Megaphone className="h-4 w-4" />Nuevo anuncio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Título</Label>
              <Input placeholder="Mantenimiento programado…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Mensaje</Label>
              <Textarea rows={3} placeholder="Detalles del anuncio…" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">🔵 Info</SelectItem>
                  <SelectItem value="warning">🟡 Advertencia</SelectItem>
                  <SelectItem value="maintenance">🔴 Mantenimiento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Destinatarios</Label>
              <Select value={form.target} onValueChange={v => setForm(f => ({ ...f, target: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los usuarios</SelectItem>
                  <SelectItem value="pro">Solo planes PRO+</SelectItem>
                  <SelectItem value="free">Solo plan FREE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Caduca el <span className="text-gray-400 text-xs font-normal">(opcional)</span></Label>
              <Input type="datetime-local" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
            </div>
          </div>
          <Button onClick={handleSend} disabled={saving || !form.title.trim() || !form.body.trim()} className="gap-2">
            <Send className="h-4 w-4" />{saving ? 'Enviando…' : 'Enviar comunicación'}
          </Button>
        </CardContent>
      </Card>

      {/* Historial */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Historial ({announcements.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : announcements.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-400">Sin comunicaciones enviadas</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {announcements.map(a => {
                const meta = TYPE_META[a.type] ?? TYPE_META.info
                const Icon = meta.icon
                const expired = a.expires_at && new Date(a.expires_at) < new Date()
                return (
                  <div key={a.id} className={`flex items-start gap-3 px-5 py-3 ${expired ? 'opacity-50' : ''}`}>
                    <div className={`p-1.5 rounded-lg shrink-0 ${meta.bg} border`}>
                      <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{a.body}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
                        <span className={meta.color}>{meta.label}</span>
                        <span>·</span>
                        <span>{a.target === 'all' ? 'Todos' : a.target.toUpperCase()}</span>
                        <span>·</span>
                        <span>{formatDateTime(a.created_at)}</span>
                        {expired && <span className="text-red-400">· caducado</span>}
                      </div>
                    </div>
                    <button onClick={() => handleDelete(a.id)} className="text-gray-300 hover:text-red-500 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
