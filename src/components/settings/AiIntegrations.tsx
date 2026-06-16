import { useEffect, useState } from 'react'
import { Sparkles, Check, Trash2, KeyRound, Star } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Provider = 'anthropic' | 'openai' | 'gemini'

const PROVIDERS: { id: Provider; label: string; color: string; models: string[]; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', color: 'text-orange-600', placeholder: 'sk-ant-...', models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { id: 'openai',    label: 'OpenAI (GPT)',       color: 'text-emerald-600', placeholder: 'sk-...',     models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'gemini',    label: 'Google Gemini',      color: 'text-blue-600',    placeholder: 'AIza...',    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'] },
]

interface KeyState {
  saved: boolean
  model: string
  is_preferred: boolean
  input: string   // texto del campo password (no se guarda en BD hasta pulsar guardar)
}

function emptyState(defaultModel: string): KeyState {
  return { saved: false, model: defaultModel, is_preferred: false, input: '' }
}

export function AiIntegrations() {
  const { user } = useAuth()
  const [states, setStates] = useState<Record<Provider, KeyState>>({
    anthropic: emptyState('claude-sonnet-4-6'),
    openai: emptyState('gpt-4o-mini'),
    gemini: emptyState('gemini-2.5-flash'),
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Provider | null>(null)

  useEffect(() => { load() }, [user?.id])

  async function load() {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('user_api_keys')
      .select('provider, is_preferred, preferred_model')
      .eq('user_id', user.id)

    setStates(prev => {
      const next = { ...prev }
      for (const p of PROVIDERS) {
        const row = data?.find(d => d.provider === p.id)
        next[p.id] = {
          saved: !!row,
          model: row?.preferred_model || p.models[1] || p.models[0],
          is_preferred: !!row?.is_preferred,
          input: '',
        }
      }
      return next
    })
    setLoading(false)
  }

  const preferred = PROVIDERS.find(p => states[p.id].is_preferred)?.id ?? ''
  const configured = PROVIDERS.filter(p => states[p.id].saved)

  async function save(p: Provider) {
    if (!user) return
    const st = states[p]
    if (!st.saved && !st.input.trim()) { toast.error('Introduce la API key'); return }
    setBusy(p)
    const { data, error } = await supabase.functions.invoke('save-api-key', {
      body: {
        user_id: user.id,
        provider: p,
        api_key: st.input.trim(),   // vacío => solo actualiza modelo
        preferred_model: st.model,
        is_preferred: st.is_preferred,
      },
    })
    if (error || data?.error) toast.error('Error al guardar: ' + (error?.message ?? data?.error))
    else toast.success('Guardado')
    setBusy(null)
    await load()
  }

  async function remove(p: Provider) {
    if (!user) return
    setBusy(p)
    const { error } = await supabase.from('user_api_keys').delete().eq('user_id', user.id).eq('provider', p)
    if (error) toast.error('Error al eliminar')
    else toast.success('Key eliminada')
    setBusy(null)
    await load()
  }

  async function setPreferred(p: string) {
    if (!p || !user) return
    // Actualización directa vía RLS (cada usuario solo toca sus filas)
    const { error: e1 } = await supabase.from('user_api_keys').update({ is_preferred: false }).eq('user_id', user.id)
    const { error: e2 } = await supabase.from('user_api_keys').update({ is_preferred: true }).eq('user_id', user.id).eq('provider', p)
    if (e1 || e2) toast.error('Error al cambiar el preferido')
    else toast.success('Proveedor preferido actualizado')
    await load()
  }

  function patch(p: Provider, patch: Partial<KeyState>) {
    setStates(prev => ({ ...prev, [p]: { ...prev[p], ...patch } }))
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary-600" />
            Proveedor de IA preferido
          </CardTitle>
        </CardHeader>
        <CardContent>
          {configured.length === 0 ? (
            <p className="text-sm text-gray-400">Configura al menos un proveedor abajo para elegir tu IA principal.</p>
          ) : (
            <div className="flex items-center gap-3">
              <Select value={preferred} onValueChange={setPreferred}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Elige proveedor preferido" /></SelectTrigger>
                <SelectContent>
                  {configured.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">Se usará primero; si falla, se prueban los demás automáticamente.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        PROVIDERS.map(p => {
          const st = states[p.id]
          return (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-sm flex items-center gap-2 ${p.color}`}>
                    <KeyRound className="h-4 w-4" />{p.label}
                    {st.is_preferred && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />Preferido
                      </span>
                    )}
                  </CardTitle>
                  {st.saved ? (
                    <span className="text-[11px] font-semibold text-green-600 flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" />Key guardada
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-400">Sin configurar</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">API key</Label>
                    <Input
                      type="password"
                      placeholder={st.saved ? '•••••••••• (guardada — deja vacío para no cambiarla)' : p.placeholder}
                      value={st.input}
                      onChange={e => patch(p.id, { input: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Modelo</Label>
                    <Select value={st.model} onValueChange={v => patch(p.id, { model: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {p.models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => save(p.id)} disabled={busy === p.id}>
                    {busy === p.id ? 'Guardando…' : st.saved ? 'Actualizar' : 'Guardar'}
                  </Button>
                  {st.saved && (
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200 gap-1.5" onClick={() => remove(p.id)} disabled={busy === p.id}>
                      <Trash2 className="h-3.5 w-3.5" />Eliminar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })
      )}

      <p className="text-xs text-gray-400">
        🔒 Las API keys se guardan cifradas y solo se usan en el servidor (Edge Function <code>ai-proxy</code>) para generar presupuestos y resúmenes. Nunca se exponen en el navegador.
      </p>
    </div>
  )
}
