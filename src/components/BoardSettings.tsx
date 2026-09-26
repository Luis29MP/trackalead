import { useEffect, useState } from 'react'
import { Settings2, Inbox, Send, MessageCircle, Plus, Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useTerritories } from '@/hooks/useBoards'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmailAccounts } from '@/pages/EmailAccounts'
import type { Board } from '@/types'

const VERTICALS: { key: string; label: string }[] = [
  { key: 'carpinteria', label: 'Carpintería' },
  { key: 'carpinteria_metalica', label: 'Carpintería Metálica' },
  { key: 'electricidad', label: 'Electricidad' },
  { key: 'fontaneria', label: 'Fontanería' },
  { key: 'pintura', label: 'Pintura' },
  { key: 'placas_solares', label: 'Placas solares' },
  { key: 'reformas', label: 'Reformas' },
  { key: 'tejados', label: 'Tejados' },
]
const COLORS = ['#2563EB', '#7C3AED', '#DC2626', '#D97706', '#059669', '#0891B2', '#9333EA', '#E11D48', '#65A30D']
const POSTMARK_INBOUND = '12eb8cbdd8e4249d80603d17f0b9cba2@inbound.postmarkapp.com'

interface Route { id: string; key: string; label: string | null }

export function BoardSettings({ board, open, onOpenChange, onSaved }: {
  board: Board
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const { organization } = useAuth()
  const { territories } = useTerritories()

  // General
  const [name, setName] = useState(board.name)
  const [color, setColor] = useState(board.color)
  const [vertical, setVertical] = useState(board.vertical_key ?? '')
  const [territory, setTerritory] = useState(board.territory_id ?? '')
  const [savingGen, setSavingGen] = useState(false)

  // Entrante
  const [routes, setRoutes] = useState<Route[]>([])
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [addingRoute, setAddingRoute] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(board.name); setColor(board.color); setVertical(board.vertical_key ?? ''); setTerritory(board.territory_id ?? '')
    supabase.from('email_ingest_routes').select('id, key, label').eq('board_id', board.id)
      .then(({ data }) => setRoutes((data ?? []) as Route[]))
  }, [open, board])

  async function saveGeneral() {
    setSavingGen(true)
    const { error } = await supabase.from('boards').update({
      name: name.trim() || board.name, color,
      vertical_key: vertical || null, territory_id: territory || null,
    }).eq('id', board.id)
    setSavingGen(false)
    if (error) { toast.error('No se pudo guardar'); return }
    toast.success('Tablero actualizado')
    onSaved()
  }

  async function addRoute() {
    const key = newKey.trim().toLowerCase().replace(/^www\./, '').replace(/^@/, '')
    if (!key) { toast.error('Escribe el dominio (ej. tuweb.com)'); return }
    setAddingRoute(true)
    const { data, error } = await supabase.from('email_ingest_routes')
      .insert({ org_id: organization!.id, board_id: board.id, key, label: newLabel.trim() || board.name })
      .select('id, key, label').single()
    setAddingRoute(false)
    if (error) { toast.error(error.message.includes('duplicate') ? 'Ese dominio ya está enrutado' : `No se pudo añadir: ${error.message}`); return }
    setRoutes(prev => [...prev, data as Route]); setNewKey(''); setNewLabel('')
    toast.success('Ruta de correo entrante añadida')
  }

  async function removeRoute(id: string) {
    await supabase.from('email_ingest_routes').delete().eq('id', id)
    setRoutes(prev => prev.filter(r => r.id !== id))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary-600" />Opciones · {board.name}</DialogTitle></DialogHeader>

        <Tabs defaultValue="general">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="general"><Settings2 className="h-3.5 w-3.5 mr-1.5" />General</TabsTrigger>
            <TabsTrigger value="in"><Inbox className="h-3.5 w-3.5 mr-1.5" />Correo entrante</TabsTrigger>
            <TabsTrigger value="out"><Send className="h-3.5 w-3.5 mr-1.5" />Correo saliente</TabsTrigger>
            <TabsTrigger value="wa"><MessageCircle className="h-3.5 w-3.5 mr-1.5" />WhatsApp</TabsTrigger>
          </TabsList>

          {/* ── General ── */}
          <TabsContent value="general" className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Provincia / territorio</Label>
                <Select value={territory || 'none'} onValueChange={v => setTerritory(v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Sin territorio" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin territorio</SelectItem>
                    {territories.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Gremio</Label>
                <Select value={vertical || 'none'} onValueChange={v => setVertical(v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Sin gremio" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin gremio</SelectItem>
                    {VERTICALS.map(v => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setColor(c)} className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                    style={{ backgroundColor: c, outline: color === c ? `3px solid ${c}` : undefined, outlineOffset: '2px' }} />
                ))}
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button onClick={saveGeneral} disabled={savingGen} className="gap-1.5"><Check className="h-4 w-4" />{savingGen ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </TabsContent>

          {/* ── Correo entrante ── */}
          <TabsContent value="in" className="space-y-3">
            <p className="text-xs text-gray-500">Los correos que lleguen a estos dominios entran como lead en <strong>{board.name}</strong>. En el hosting de cada web, reenvía <code className="bg-gray-100 px-1 rounded">info@dominio</code> a la dirección de Postmark:</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px] font-mono break-all text-slate-600">{POSTMARK_INBOUND}</div>
            <div className="space-y-2">
              {routes.length === 0 && <p className="text-xs text-gray-400">Sin dominios enrutados a este tablero todavía.</p>}
              {routes.map(r => (
                <div key={r.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2">
                  <Inbox className="h-4 w-4 text-primary-500 shrink-0" />
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-800 truncate">{r.key}</p>{r.label && <p className="text-[11px] text-gray-400 truncate">{r.label}</p>}</div>
                  <button onClick={() => removeRoute(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="dominio de la web (tuweb.com)" value={newKey} onChange={e => setNewKey(e.target.value)} />
              <Input placeholder="etiqueta (opcional)" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            </div>
            <Button variant="outline" onClick={addRoute} disabled={addingRoute} className="gap-1.5 w-full"><Plus className="h-4 w-4" />{addingRoute ? 'Añadiendo…' : 'Añadir dominio'}</Button>
          </TabsContent>

          {/* ── Correo saliente ── */}
          <TabsContent value="out">
            <EmailAccounts boardId={board.id} />
          </TabsContent>

          {/* ── WhatsApp ── */}
          <TabsContent value="wa" className="space-y-3">
            <div className="text-center py-8 text-gray-400">
              <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium text-gray-600">Bot de WhatsApp por tablero</p>
              <p className="text-xs mt-1 max-w-sm mx-auto">Aquí conectarás el número/bot de WhatsApp de esta web para captar y responder leads. Lo activamos cuando definas el proveedor (Meta WhatsApp Cloud API o Evolution API).</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
