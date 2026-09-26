import { useEffect, useState } from 'react'
import { Mail, Plus, Trash2, Pencil, Send, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useBoards } from '@/hooks/useBoards'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface EmailAccount {
  id: string
  board_id: string | null
  label: string | null
  from_email: string
  from_name: string | null
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  smtp_user: string
  is_active: boolean
}

interface FormState {
  id?: string
  board_id: string
  label: string
  from_email: string
  from_name: string
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  smtp_user: string
  smtp_pass: string
}

const EMPTY: FormState = {
  board_id: '', label: '', from_email: '', from_name: '', smtp_host: '',
  smtp_port: 465, smtp_secure: true, smtp_user: '', smtp_pass: '',
}

export function EmailAccounts() {
  const { organization } = useAuth()
  const { boards } = useBoards()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  useEffect(() => { if (organization) load() /* eslint-disable-next-line */ }, [organization?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('email_accounts')
      .select('id, board_id, label, from_email, from_name, smtp_host, smtp_port, smtp_secure, smtp_user, is_active')
      .eq('org_id', organization!.id).order('created_at', { ascending: true })
    setAccounts((data ?? []) as EmailAccount[])
    setLoading(false)
  }

  const boardName = (id: string | null) => boards.find(b => b.id === id)?.name ?? null

  function openNew() { setForm(EMPTY); setOpen(true) }
  function openEdit(a: EmailAccount) {
    setForm({
      id: a.id, board_id: a.board_id ?? '', label: a.label ?? '', from_email: a.from_email,
      from_name: a.from_name ?? '', smtp_host: a.smtp_host, smtp_port: a.smtp_port,
      smtp_secure: a.smtp_secure, smtp_user: a.smtp_user, smtp_pass: '',
    })
    setOpen(true)
  }

  async function save() {
    if (!form.from_email.trim() || !form.smtp_host.trim()) { toast.error('Faltan el correo y el servidor SMTP'); return }
    if (!form.id && !form.smtp_pass.trim()) { toast.error('Escribe la contraseña del buzón'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          action: 'save_account',
          account: {
            id: form.id, org_id: organization!.id,
            board_id: form.board_id || null, label: form.label || null,
            from_email: form.from_email.trim(), from_name: form.from_name || null,
            smtp_host: form.smtp_host.trim(), smtp_port: Number(form.smtp_port) || 465,
            smtp_secure: form.smtp_secure, smtp_user: (form.smtp_user || form.from_email).trim(),
            smtp_pass: form.smtp_pass,
          },
        },
      })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Error al guardar')
      toast.success('Cuenta de correo guardada')
      setOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  async function testAccount(a: EmailAccount) {
    setTestingId(a.id)
    try {
      const { data, error } = await supabase.functions.invoke('send-email', { body: { action: 'test', account_id: a.id } })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Error SMTP')
      toast.success(`Prueba enviada a ${a.from_email}. Revisa la bandeja.`)
    } catch (e) {
      toast.error(`Falló la prueba: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setTestingId(null)
    }
  }

  async function remove(a: EmailAccount) {
    if (!confirm(`¿Eliminar la cuenta ${a.from_email}?`)) return
    await supabase.from('email_accounts').delete().eq('id', a.id)
    setAccounts(prev => prev.filter(x => x.id !== a.id))
    toast.success('Cuenta eliminada')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Mail className="h-4 w-4 text-primary-600" />Correo saliente por web</h3>
          <p className="text-xs text-gray-500 mt-0.5">Configura el buzón de cada web para enviar correos al cliente desde su propio dominio. La contraseña se guarda cifrada.</p>
        </div>
        <Button onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" />Nueva cuenta</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-gray-200 rounded-xl text-gray-400">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Aún no hay cuentas de correo. Añade la de una web para poder enviar emails al cliente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map(a => (
            <div key={a.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0"><Mail className="h-4 w-4 text-primary-600" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{a.from_email}{a.label ? ` · ${a.label}` : ''}</p>
                <p className="text-[11px] text-gray-400 truncate">{a.smtp_host}:{a.smtp_port} · {boardName(a.board_id) ?? 'Sin tablero'}</p>
              </div>
              <button onClick={() => testAccount(a)} disabled={testingId === a.id} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600" title="Enviar correo de prueba">
                {testingId === a.id ? <span className="text-[10px]">…</span> : <Send className="h-4 w-4" />}
              </button>
              <button onClick={() => openEdit(a)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => remove(a)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? 'Editar cuenta de correo' : 'Nueva cuenta de correo'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Web / tablero (opcional)</Label>
              <Select value={form.board_id || 'none'} onValueChange={v => setForm(f => ({ ...f, board_id: v === 'none' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Sin tablero" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin tablero (general)</SelectItem>
                  {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Correo (from) *</Label>
                <Input placeholder="info@tuweb.com" value={form.from_email} onChange={e => setForm(f => ({ ...f, from_email: e.target.value, smtp_user: f.smtp_user || e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Nombre mostrado</Label>
                <Input placeholder="Tu Carpintero en León" value={form.from_name} onChange={e => setForm(f => ({ ...f, from_name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Servidor SMTP *</Label>
                <Input placeholder="mail.tuweb.com" value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Puerto</Label>
                <Input type="number" value={form.smtp_port} onChange={e => setForm(f => ({ ...f, smtp_port: Number(e.target.value), smtp_secure: Number(e.target.value) === 465 }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.smtp_secure} onCheckedChange={v => setForm(f => ({ ...f, smtp_secure: v }))} />
              <Label className="text-sm">Conexión segura SSL (puerto 465). Desactiva para STARTTLS (587).</Label>
            </div>
            <div className="space-y-1.5">
              <Label>Usuario SMTP</Label>
              <Input placeholder="normalmente el mismo correo" value={form.smtp_user} onChange={e => setForm(f => ({ ...f, smtp_user: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña del buzón {form.id && <span className="text-[11px] text-gray-400">(déjala vacía para no cambiarla)</span>}</Label>
              <Input type="password" placeholder="••••••••" value={form.smtp_pass} onChange={e => setForm(f => ({ ...f, smtp_pass: e.target.value }))} />
              <p className="text-[11px] text-gray-400">Se guarda cifrada. En cPanel de LucusHost: host suele ser mail.tudominio.com, puerto 465 (SSL), usuario = tu correo.</p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving} className="gap-1.5"><CheckCircle2 className="h-4 w-4" />{saving ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
