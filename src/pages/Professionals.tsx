import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, HardHat, Phone, Mail, Pencil, Trash2, Smartphone, Copy, Check, ExternalLink, Upload, FileText, Eye, ChevronRight, MapPin, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ProKnowledgeManager } from '@/components/ProKnowledgeManager'
import type { Professional, ProRate, Budget } from '@/types'

interface DetailLead { id: string; name: string; concept: string | null; zone: string | null; address: string | null }

interface ProForm {
  name: string; phone: string; email: string; specialty: string
  is_active: boolean; app_access: boolean; rates: ProRate[]
  company_name: string; address: string; cif: string; logo_url: string
}
const EMPTY: ProForm = {
  name: '', phone: '', email: '', specialty: '', is_active: true, app_access: false, rates: [],
  company_name: '', address: '', cif: '', logo_url: '',
}

// Redimensiona el logo a máx. 300px y lo pasa a data URL PNG (para el PDF)
function logoToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const max = 300
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas')); return }
      ctx.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/png')
      URL.revokeObjectURL(url)
      resolve(dataUrl)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')) }
    img.src = url
  })
}

export function Professionals() {
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading]             = useState(true)
  const [dialog, setDialog]               = useState(false)
  const [editing, setEditing]             = useState<Professional | null>(null)
  const [saving, setSaving]               = useState(false)
  const [form, setForm]                   = useState<ProForm>(EMPTY)
  const [magicLink, setMagicLink]         = useState('')
  const [copied, setCopied]               = useState(false)
  const [stats, setStats]                 = useState<Record<string, { leads: number; budgets: number }>>({})
  const [detailPro, setDetailPro]         = useState<Professional | null>(null)
  const [detailLeads, setDetailLeads]     = useState<DetailLead[]>([])
  const [detailBudgets, setDetailBudgets] = useState<Budget[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const { organization } = useAuth()
  const navigate = useNavigate()

  async function openDetail(p: Professional) {
    setDetailPro(p)
    setLoadingDetail(true)
    const [{ data: leadsData }, { data: budgetsData }] = await Promise.all([
      supabase.from('leads').select('id, name, concept, zone, address').eq('assigned_to', p.id).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('budgets').select('*').eq('professional_id', p.id).order('created_at', { ascending: false }),
    ])
    setDetailLeads((leadsData ?? []) as DetailLead[])
    setDetailBudgets((budgetsData ?? []) as Budget[])
    setLoadingDetail(false)
  }

  useEffect(() => {
    if (!organization) return
    loadProfessionals()
  }, [organization?.id])

  async function loadProfessionals() {
    setLoading(true)
    const { data } = await supabase
      .from('professionals').select('*').eq('org_id', organization!.id).order('name')
    const pros = data ?? []
    setProfessionals(pros)
    setLoading(false)

    // Estadísticas por profesional: leads asignados + presupuestos (partidas)
    const s: Record<string, { leads: number; budgets: number }> = {}
    await Promise.all(pros.map(async (p) => {
      const [{ count: leads }, { count: budgets }] = await Promise.all([
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('assigned_to', p.id).eq('is_archived', false),
        supabase.from('budget_partidas').select('*', { count: 'exact', head: true }).eq('professional_id', p.id),
      ])
      s[p.id] = { leads: leads ?? 0, budgets: budgets ?? 0 }
    }))
    setStats(s)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setMagicLink('')
    setDialog(true)
  }

  function openEdit(p: Professional) {
    setEditing(p)
    setForm({
      name: p.name, phone: p.phone ?? '', email: p.email ?? '', specialty: p.specialty ?? '',
      is_active: p.is_active, app_access: p.app_access, rates: p.rates ?? [],
      company_name: p.company_name ?? '', address: p.address ?? '', cif: p.cif ?? '', logo_url: p.logo_url ?? '',
    })
    // No mostrar la pantalla del enlace al editar: el formulario manda. El enlace
    // se ve dentro del formulario (sección "Acceso a la app").
    setMagicLink('')
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
          rates: form.rates,
          company_name: form.company_name || null, address: form.address || null,
          cif: form.cif || null, logo_url: form.logo_url || null,
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
          rates: form.rates,
          company_name: form.company_name || null, address: form.address || null,
          cif: form.cif || null, logo_url: form.logo_url || null,
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

  // ── Tarifas ────────────────────────────────────────────────────────────────
  function addRate() {
    setForm(f => ({ ...f, rates: [...f.rates, { work_type: '', min_price: 0, rec_price: 0, unit: 'ud' }] }))
  }
  function updateRate(i: number, patch: Partial<ProRate>) {
    setForm(f => ({ ...f, rates: f.rates.map((r, idx) => idx === i ? { ...r, ...patch } : r) }))
  }
  function removeRate(i: number) {
    setForm(f => ({ ...f, rates: f.rates.filter((_, idx) => idx !== i) }))
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
                        <button onClick={() => openDetail(p)} className="font-semibold text-gray-900 truncate hover:text-primary-600 transition-colors text-left" title="Ver ficha">{p.name}</button>
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
                      {/* Estadísticas */}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs text-gray-500 flex items-center gap-1"><HardHat className="h-3.5 w-3.5 text-gray-400" />{stats[p.id]?.leads ?? 0} lead{(stats[p.id]?.leads ?? 0) !== 1 ? 's' : ''}</span>
                        <span className="text-xs text-gray-500 flex items-center gap-1"><FileText className="h-3.5 w-3.5 text-gray-400" />{stats[p.id]?.budgets ?? 0} presupuesto{(stats[p.id]?.budgets ?? 0) !== 1 ? 's' : ''}</span>
                      </div>
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500" onClick={() => openDetail(p)} title="Ver ficha">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => handleDelete(p.id)} title="Eliminar">
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

      {/* Ficha del profesional */}
      <Dialog open={!!detailPro} onOpenChange={v => { if (!v) setDetailPro(null) }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Ficha del profesional</DialogTitle></DialogHeader>
          {detailPro && (
            <div className="space-y-4">
              {/* Cabecera */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shrink-0">
                  {detailPro.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">{detailPro.company_name || detailPro.name}</p>
                  <p className="text-xs text-gray-400">{[detailPro.specialty, detailPro.phone, detailPro.email].filter(Boolean).join(' · ')}</p>
                </div>
                <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => { const p = detailPro; setDetailPro(null); openEdit(p) }}>
                  <Pencil className="h-3.5 w-3.5" />Editar
                </Button>
              </div>

              {loadingDetail ? (
                <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
              ) : (
                <>
                  {/* Leads asignados */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Leads asignados ({detailLeads.length})</p>
                    {detailLeads.length === 0 ? (
                      <p className="text-sm text-gray-400">Sin leads asignados.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detailLeads.map(l => (
                          <button key={l.id} onClick={() => navigate(`/leads/${l.id}`)} className="w-full flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 hover:bg-gray-50 text-left">
                            <Wrench className="h-3.5 w-3.5 text-primary-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-800 truncate">{l.name}</p>
                              <p className="text-xs text-gray-400 truncate">{[l.concept, l.zone || l.address].filter(Boolean).join(' · ')}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Presupuestos */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Presupuestos ({detailBudgets.length})</p>
                    {detailBudgets.length === 0 ? (
                      <p className="text-sm text-gray-400">Sin presupuestos.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detailBudgets.map(b => (
                          <button key={b.id} onClick={() => navigate('/budgets')} className="w-full flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 hover:bg-gray-50 text-left">
                            <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-800 truncate">{b.concept || b.client_name}</p>
                              <p className="text-xs text-gray-400">{formatDate(b.created_at)} · {b.client_name}</p>
                            </div>
                            <span className="text-sm font-semibold text-gray-900 shrink-0">{formatCurrency(b.total)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog crear/editar */}
      <Dialog open={dialog} onOpenChange={v => { setDialog(v); if (!v) setMagicLink('') }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar profesional' : 'Nuevo profesional'}</DialogTitle></DialogHeader>

          {magicLink ? (
            /* Mostrar enlace mágico */
            <div className="space-y-4 min-w-0">
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
                <Smartphone className="h-8 w-8 text-indigo-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-indigo-700">{form.name} tiene acceso a la app</p>
                <p className="text-xs text-indigo-500 mt-1">Comparte este enlace único con el profesional</p>
              </div>
              <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-3 py-2 min-w-0">
                <code className="flex-1 min-w-0 text-xs text-gray-600 truncate">{magicLink}</code>
                <button onClick={() => copyLink(magicLink)} className="shrink-0 text-gray-400 hover:text-indigo-600">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="space-y-4 min-w-0">
              <Tabs defaultValue="datos" className="min-w-0">
                <TabsList className="mb-3">
                  <TabsTrigger value="datos">Datos</TabsTrigger>
                  <TabsTrigger value="tarifas">Tarifas</TabsTrigger>
                  {editing && <TabsTrigger value="conocimiento">Conocimiento</TabsTrigger>}
                </TabsList>

                <TabsContent value="datos" className="space-y-4 mt-0">
                  <div className="space-y-1.5">
                    <Label>Nombre *</Label>
                    <Input placeholder="Carlos López" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Especialidad</Label>
                    <Input placeholder="Electricista, Fontanero…" value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Teléfono</Label>
                      <Input placeholder="600 000 000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input type="email" placeholder="carlos@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                  </div>

                  {/* Datos de empresa para el PDF del presupuesto */}
                  <div className="border-t border-gray-100 pt-3 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos para presupuestos</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Empresa / autónomo</Label>
                        <Input placeholder="Reformas Carlos S.L." value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>NIF / CIF</Label>
                        <Input placeholder="B12345678" value={form.cif} onChange={e => setForm(f => ({ ...f, cif: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Dirección</Label>
                      <Input placeholder="Calle Mayor 1, León" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Logo</Label>
                      <div className="flex items-center gap-3">
                        {form.logo_url ? (
                          <div className="relative w-16 h-16 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center">
                            <img src={form.logo_url} alt="logo" className="max-w-full max-h-full object-contain" />
                            <button onClick={() => setForm(f => ({ ...f, logo_url: '' }))} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-primary-400 text-gray-400 hover:text-primary-500">
                            <input type="file" accept="image/*" className="hidden" onChange={async e => {
                              const file = e.target.files?.[0]; e.target.value = ''
                              if (!file) return
                              try { const url = await logoToDataUrl(file); setForm(f => ({ ...f, logo_url: url })) }
                              catch { toast.error('No se pudo cargar el logo') }
                            }} />
                            <Plus className="h-5 w-5" />
                          </label>
                        )}
                        <p className="text-[11px] text-gray-400 flex-1">Si lo subes, los presupuestos asignados a este profesional saldrán con su logo y datos de empresa.</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                    <Label>Activo</Label>
                  </div>
                  <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100 space-y-2.5">
                    <div className="flex items-center gap-3">
                      <Switch checked={form.app_access} onCheckedChange={v => setForm(f => ({ ...f, app_access: v }))} />
                      <div>
                        <p className="text-sm font-medium text-indigo-800">Acceso a la app</p>
                        <p className="text-xs text-indigo-500">Genera un enlace único para que vea sus trabajos asignados sin contraseña</p>
                      </div>
                    </div>
                    {/* Enlace ya generado (al editar un profesional con acceso) */}
                    {editing?.app_access && editing?.magic_token && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-2.5 py-1.5">
                          <code className="flex-1 min-w-0 text-[11px] text-gray-600 truncate">{`${window.location.origin}/pro/${editing.magic_token}`}</code>
                          <button onClick={() => copyLink(`${window.location.origin}/pro/${editing.magic_token}`)} className="shrink-0 text-gray-400 hover:text-indigo-600">
                            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => copyLink(`${window.location.origin}/pro/${editing.magic_token}`)}>
                            <Copy className="h-3.5 w-3.5" />Copiar enlace
                          </Button>
                          {editing.phone && (
                            <Button type="button" size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5 flex-1"
                              onClick={() => sendWhatsApp(editing, `${window.location.origin}/pro/${editing.magic_token}`)}>
                              📲 WhatsApp
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="tarifas" className="space-y-2 mt-0">
                  <p className="text-xs text-gray-400">Tarifas de referencia. La IA las usará al generar presupuestos para leads asignados a este profesional.</p>
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] text-gray-500 uppercase">
                          <th className="text-left px-2 py-2">Tipo de trabajo</th>
                          <th className="text-right px-1 py-2 w-20">Mín. €</th>
                          <th className="text-right px-1 py-2 w-20">Rec. €</th>
                          <th className="text-left px-1 py-2 w-20">Unidad</th>
                          <th className="w-7"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {form.rates.map((r, i) => (
                          <tr key={i}>
                            <td className="px-1 py-1">
                              <Input value={r.work_type} onChange={e => updateRate(i, { work_type: e.target.value })} placeholder="Alicatado…" className="h-8 text-xs border-0 focus-visible:ring-1" />
                            </td>
                            <td className="px-1 py-1">
                              <Input type="number" min={0} step="0.01" value={r.min_price} onChange={e => updateRate(i, { min_price: Number(e.target.value) })} className="h-8 text-xs text-right border-0 focus-visible:ring-1" />
                            </td>
                            <td className="px-1 py-1">
                              <Input type="number" min={0} step="0.01" value={r.rec_price} onChange={e => updateRate(i, { rec_price: Number(e.target.value) })} className="h-8 text-xs text-right border-0 focus-visible:ring-1" />
                            </td>
                            <td className="px-1 py-1">
                              <Select value={r.unit} onValueChange={v => updateRate(i, { unit: v })}>
                                <SelectTrigger className="h-8 text-xs px-2"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ud">ud</SelectItem>
                                  <SelectItem value="hora">hora</SelectItem>
                                  <SelectItem value="m²">m²</SelectItem>
                                  <SelectItem value="ml">ml</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-1 py-1 text-center">
                              <button onClick={() => removeRate(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                            </td>
                          </tr>
                        ))}
                        {form.rates.length === 0 && (
                          <tr><td colSpan={5} className="text-center text-xs text-gray-400 py-4">Sin tarifas configuradas</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={addRate} className="gap-1.5"><Plus className="h-3.5 w-3.5" />Añadir tarifa</Button>
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium px-3 h-8 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer text-gray-600">
                      <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async e => {
                        const file = e.target.files?.[0]; e.target.value = ''
                        if (!file) return
                        try {
                          const { parseRatesFromFile } = await import('@/lib/sheetParse')
                          const imported = await parseRatesFromFile(file)
                          if (!imported.length) { toast.error('No se encontraron tarifas en el archivo'); return }
                          setForm(f => ({ ...f, rates: [...f.rates, ...imported] }))
                          toast.success(`${imported.length} tarifa(s) importada(s)`)
                        } catch { toast.error('No se pudo leer el archivo') }
                      }} />
                      <Upload className="h-3.5 w-3.5" />Importar Excel/CSV
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-400">Excel/CSV con columnas: trabajo · precio · unidad (detecta la cabecera automáticamente).</p>
                </TabsContent>

                {editing && (
                  <TabsContent value="conocimiento" className="mt-0">
                    <ProKnowledgeManager professionalId={editing.id} orgId={organization!.id} />
                  </TabsContent>
                )}
              </Tabs>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setDialog(false)} className="w-full">Cancelar</Button>
                <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="w-full">
                  {saving ? 'Guardando…' : 'Guardar'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
