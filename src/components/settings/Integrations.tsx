import { useEffect, useState } from 'react'
import { MessageCircle, Calendar, Check, Copy, Plus, Trash2, RefreshCw, Link2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const CALLBACK_URL = 'https://qplznujisnpwyhrjjuyp.supabase.co/functions/v1/whatsapp-webhook'

type WhProvider = 'meta_whatsapp' | 'evolution_api'
interface Recipient { name: string; phone: string }

function genVerifyToken() {
  return 'tal_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
}

function StatusBadge({ row }: { row?: { is_active: boolean } | null }) {
  if (!row) return <span className="text-[11px] text-gray-400">No configurado</span>
  return row.is_active
    ? <span className="text-[11px] font-semibold text-green-600 flex items-center gap-1"><Check className="h-3.5 w-3.5" />Conectado</span>
    : <span className="text-[11px] font-semibold text-amber-600">Configurado · desconectado</span>
}

export function Integrations() {
  const { organization, user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [savingWa, setSavingWa] = useState(false)
  const [savingGc, setSavingGc] = useState(false)
  const [copied, setCopied] = useState(false)

  // filas guardadas por proveedor (para el estado de conexión)
  const [rows, setRows] = useState<Record<string, { is_active: boolean; config: Record<string, unknown> } | undefined>>({})

  const [whProvider, setWhProvider] = useState<WhProvider>('meta_whatsapp')

  // Meta Cloud API
  const [meta, setMeta] = useState({ phone_number_id: '', waba_id: '', verify_token: '', access_token: '', app_secret: '' })
  const [metaSaved, setMetaSaved] = useState({ access_token: false, app_secret: false })

  // Evolution API
  const [evo, setEvo] = useState({ server_url: '', instance_name: '', verify_token: '', api_key: '' })
  const [evoSaved, setEvoSaved] = useState({ api_key: false })

  // Google Calendar
  const [gcal, setGcal] = useState<{ calendar_id: string; notify_jose: boolean; recipients: Recipient[] }>({ calendar_id: '', notify_jose: false, recipients: [] })
  const [newRecipient, setNewRecipient] = useState<Recipient>({ name: '', phone: '' })

  useEffect(() => { load() }, [organization?.id])

  async function load() {
    if (!organization?.id) return
    setLoading(true)
    const { data } = await supabase.from('org_integrations').select('provider, config, is_active').eq('org_id', organization.id)
    const byProvider: Record<string, { is_active: boolean; config: Record<string, unknown> }> = {}
    for (const r of data ?? []) byProvider[r.provider] = { is_active: r.is_active, config: (r.config ?? {}) as Record<string, unknown> }
    setRows(byProvider)

    const m = byProvider.meta_whatsapp?.config ?? {}
    setMeta({
      phone_number_id: String(m.phone_number_id ?? ''),
      waba_id: String(m.waba_id ?? ''),
      verify_token: String(m.verify_token ?? '') || genVerifyToken(),
      access_token: '', app_secret: '',
    })
    setMetaSaved({ access_token: !!m.access_token, app_secret: !!m.app_secret })

    const e = byProvider.evolution_api?.config ?? {}
    setEvo({
      server_url: String(e.server_url ?? ''),
      instance_name: String(e.instance_name ?? ''),
      verify_token: String(e.verify_token ?? '') || genVerifyToken(),
      api_key: '',
    })
    setEvoSaved({ api_key: !!e.api_key })

    const g = byProvider.google_calendar?.config ?? {}
    setGcal({
      calendar_id: String(g.calendar_id ?? ''),
      notify_jose: !!g.notify_jose,
      recipients: Array.isArray(g.recipients) ? (g.recipients as Recipient[]) : [],
    })

    if (byProvider.evolution_api && !byProvider.meta_whatsapp) setWhProvider('evolution_api')
    setLoading(false)
  }

  async function saveIntegration(provider: string, config: Record<string, unknown>, is_active: boolean, setBusy: (v: boolean) => void) {
    if (!organization || !user) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('save-integration', {
      body: { org_id: organization.id, provider, config, is_active },
    })
    setBusy(false)
    const errMsg = error?.message ?? (data as { error?: string } | null)?.error
    if (errMsg) { toast.error(errMsg); return }
    toast.success('Integración guardada')
    await load()
  }

  function saveWhatsApp() {
    if (whProvider === 'meta_whatsapp') {
      if (!meta.phone_number_id.trim()) { toast.error('Falta el Phone Number ID'); return }
      saveIntegration('meta_whatsapp', {
        phone_number_id: meta.phone_number_id.trim(),
        waba_id: meta.waba_id.trim(),
        verify_token: meta.verify_token.trim(),
        access_token: meta.access_token.trim(),   // vacío => conserva el cifrado existente
        app_secret: meta.app_secret.trim(),
      }, true, setSavingWa)
    } else {
      if (!evo.server_url.trim() || !evo.instance_name.trim()) { toast.error('Faltan Server URL e Instance Name'); return }
      saveIntegration('evolution_api', {
        server_url: evo.server_url.trim(),
        instance_name: evo.instance_name.trim(),
        verify_token: evo.verify_token.trim(),
        api_key: evo.api_key.trim(),
      }, true, setSavingWa)
    }
  }

  function saveGoogleCalendar() {
    saveIntegration('google_calendar', {
      calendar_id: gcal.calendar_id.trim(),
      notify_jose: gcal.notify_jose,
      recipients: gcal.recipients,
    }, !!gcal.calendar_id.trim() || gcal.recipients.length > 0, setSavingGc)
  }

  function copyCallback() {
    navigator.clipboard.writeText(CALLBACK_URL)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  function addRecipient() {
    const name = newRecipient.name.trim(); const phone = newRecipient.phone.trim()
    if (!name || !phone) { toast.error('Nombre y número requeridos'); return }
    setGcal(g => ({ ...g, recipients: [...g.recipients, { name, phone }] }))
    setNewRecipient({ name: '', phone: '' })
  }
  function removeRecipient(i: number) {
    setGcal(g => ({ ...g, recipients: g.recipients.filter((_, idx) => idx !== i) }))
  }

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
  }

  const waRow = whProvider === 'meta_whatsapp' ? rows.meta_whatsapp : rows.evolution_api

  return (
    <div className="space-y-5">

      {/* ── WhatsApp ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 text-emerald-600">
              <MessageCircle className="h-4 w-4" />WhatsApp
            </CardTitle>
            <StatusBadge row={waRow} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Proveedor</Label>
            <Select value={whProvider} onValueChange={v => setWhProvider(v as WhProvider)}>
              <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="meta_whatsapp">Meta Cloud API (oficial)</SelectItem>
                <SelectItem value="evolution_api">Evolution API (autohospedado)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {whProvider === 'meta_whatsapp' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone Number ID" value={meta.phone_number_id} onChange={v => setMeta(m => ({ ...m, phone_number_id: v }))} placeholder="1029384756" />
              <Field label="WABA ID" value={meta.waba_id} onChange={v => setMeta(m => ({ ...m, waba_id: v }))} placeholder="WhatsApp Business Account ID" />
              <SecretField label="Access Token (System User)" saved={metaSaved.access_token} value={meta.access_token} onChange={v => setMeta(m => ({ ...m, access_token: v }))} />
              <SecretField label="App Secret" saved={metaSaved.app_secret} value={meta.app_secret} onChange={v => setMeta(m => ({ ...m, app_secret: v }))} />
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center justify-between">
                  Verify Token
                  <button type="button" onClick={() => setMeta(m => ({ ...m, verify_token: genVerifyToken() }))} className="text-[11px] text-primary-600 flex items-center gap-1"><RefreshCw className="h-3 w-3" />Regenerar</button>
                </Label>
                <Input value={meta.verify_token} onChange={e => setMeta(m => ({ ...m, verify_token: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Server URL" value={evo.server_url} onChange={v => setEvo(s => ({ ...s, server_url: v }))} placeholder="http://tu-nas:8080" />
              <Field label="Instance Name" value={evo.instance_name} onChange={v => setEvo(s => ({ ...s, instance_name: v }))} placeholder="trackalead" />
              <SecretField label="API Key" saved={evoSaved.api_key} value={evo.api_key} onChange={v => setEvo(s => ({ ...s, api_key: v }))} />
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center justify-between">
                  Verify Token
                  <button type="button" onClick={() => setEvo(s => ({ ...s, verify_token: genVerifyToken() }))} className="text-[11px] text-primary-600 flex items-center gap-1"><RefreshCw className="h-3 w-3" />Regenerar</button>
                </Label>
                <Input value={evo.verify_token} onChange={e => setEvo(s => ({ ...s, verify_token: e.target.value }))} />
              </div>
            </div>
          )}

          {/* Callback URL (solo lectura) */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />Callback URL (webhook)</Label>
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">
              <code className="flex-1 text-[11px] text-gray-600 truncate">{CALLBACK_URL}</code>
              <button onClick={copyCallback} className="shrink-0 text-gray-400 hover:text-primary-600" title="Copiar">
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-gray-400">Pégala en la configuración del webhook de tu proveedor, junto con el Verify Token de arriba.</p>
          </div>

          <Button onClick={saveWhatsApp} disabled={savingWa} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />{savingWa ? 'Guardando…' : 'Guardar y validar'}
          </Button>
        </CardContent>
      </Card>

      {/* ── Google Calendar ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 text-blue-600">
              <Calendar className="h-4 w-4" />Google Calendar
            </CardTitle>
            <StatusBadge row={rows.google_calendar} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Button variant="outline" disabled className="gap-2">
              <Calendar className="h-4 w-4" />Conectar con Google
            </Button>
            <p className="text-[11px] text-gray-400 mt-1">OAuth2 próximamente. Por ahora, configura el calendario compartido y las notificaciones por WhatsApp.</p>
          </div>

          <Field label="ID del calendario compartido" value={gcal.calendar_id} onChange={v => setGcal(g => ({ ...g, calendar_id: v }))} placeholder="abc123@group.calendar.google.com" />

          <div className="flex items-center justify-between border border-gray-100 rounded-lg p-3">
            <div>
              <p className="text-sm font-medium text-gray-800">Notificar a José por WhatsApp al asignarle una tarea</p>
              <p className="text-[11px] text-gray-400">Aviso instantáneo cuando se le asigna un lead o partida.</p>
            </div>
            <Switch checked={gcal.notify_jose} onCheckedChange={v => setGcal(g => ({ ...g, notify_jose: v }))} />
          </div>

          {/* Destinatarios de notificación */}
          <div className="space-y-2">
            <Label className="text-xs">Destinatarios de notificaciones por WhatsApp</Label>
            <p className="text-[11px] text-gray-400">Reciben el resumen diario de tareas y los nuevos leads.</p>
            {gcal.recipients.length > 0 && (
              <div className="space-y-1.5">
                {gcal.recipients.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>
                      <p className="text-xs text-gray-400">{r.phone}</p>
                    </div>
                    <button onClick={() => removeRecipient(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <Input placeholder="Nombre" value={newRecipient.name} onChange={e => setNewRecipient(r => ({ ...r, name: e.target.value }))} className="sm:w-44" />
              <Input placeholder="Número (con prefijo)" value={newRecipient.phone} onChange={e => setNewRecipient(r => ({ ...r, phone: e.target.value }))} className="flex-1" />
              <Button variant="outline" onClick={addRecipient} className="gap-1.5"><Plus className="h-4 w-4" />Añadir</Button>
            </div>
          </div>

          <Button onClick={saveGoogleCalendar} disabled={savingGc} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />{savingGc ? 'Guardando…' : 'Guardar'}
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        🔒 Los tokens y claves se guardan cifrados (AES-GCM) y solo se descifran en el servidor (Edge Functions <code>whatsapp-send</code> / <code>whatsapp-webhook</code>). Nunca se exponen en el navegador.
      </p>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function SecretField({ label, saved, value, onChange }: { label: string; saved: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="password" value={value} onChange={e => onChange(e.target.value)}
        placeholder={saved ? '•••••••• (guardado — deja vacío para no cambiarlo)' : ''} />
    </div>
  )
}
