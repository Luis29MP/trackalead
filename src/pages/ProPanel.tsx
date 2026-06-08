import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MapPin, Wrench, Upload, MessageCircle, Send, Radar, AlertCircle, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Professional, Lead } from '@/types'

// Extiende Lead con los joins de Supabase
type PanelLead = Omit<Lead, 'column' | 'board'> & {
  column: { name: string; color: string } | null
  board: { name: string; color: string } | null
}

interface ProComment {
  id: string
  content: string
  created_at: string
}

function toWhatsApp(phone: string) {
  const d = phone.replace(/\D/g, '')
  return d.startsWith('34') ? `https://wa.me/${d}` : `https://wa.me/34${d}`
}

export function ProPanel() {
  const { token } = useParams<{ token: string }>()
  const [professional, setProfessional]  = useState<Professional | null>(null)
  const [leads, setLeads]                = useState<PanelLead[]>([])
  const [selectedLead, setSelectedLead]  = useState<PanelLead | null>(null)
  const [comments, setComments]          = useState<ProComment[]>([])
  const [newNote, setNewNote]            = useState('')
  const [loading, setLoading]            = useState(true)
  const [uploading, setUploading]        = useState(false)
  const [notFound, setNotFound]          = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    loadProfessional()
  }, [token])

  useEffect(() => {
    if (selectedLead) loadComments(selectedLead.id)
  }, [selectedLead?.id])

  async function loadProfessional() {
    setLoading(true)
    const { data, error } = await supabase
      .from('professionals').select('*').eq('magic_token', token).eq('app_access', true).maybeSingle()
    if (error || !data) { setNotFound(true); setLoading(false); return }
    setProfessional(data)

    // Actualizar last_access
    await supabase.from('professionals').update({ last_access: new Date().toISOString() }).eq('id', data.id)

    // Cargar leads asignados
    const { data: leadsData } = await supabase
      .from('leads')
      .select('*, column:board_columns(id,name,color), board:boards(id,name,color)')
      .eq('assigned_to', data.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    setLeads((leadsData ?? []) as PanelLead[])
    setLoading(false)
  }

  async function loadComments(leadId: string) {
    const { data } = await supabase
      .from('lead_comments').select('id,content,created_at')
      .eq('lead_id', leadId).eq('is_professional', true).order('created_at')
    setComments(data ?? [])
  }

  async function submitNote() {
    if (!newNote.trim() || !selectedLead || !professional) return
    await supabase.from('lead_comments').insert({
      lead_id: selectedLead.id,
      user_id: null,         // sin user_id (acceso sin auth)
      content: newNote.trim(),
      is_professional: true,
    })
    // Notificar a la org
    const { data: members } = await supabase
      .from('org_members').select('user_id').eq('org_id', selectedLead.org_id)
    for (const m of members ?? []) {
      await supabase.from('notifications').insert({
        user_id: m.user_id,
        title: `📝 ${professional.name} dejó una nota`,
        body: `En lead: ${selectedLead.name} — ${newNote.substring(0, 80)}`,
        is_read: false,
      })
    }
    toast.success('Nota enviada')
    setNewNote('')
    loadComments(selectedLead.id)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedLead || !professional) return
    setUploading(true)
    try {
      const path = `${selectedLead.org_id}/${selectedLead.id}/pro-${Date.now()}-${file.name}`
      const { data: up, error } = await supabase.storage.from('lead-files').upload(path, file)
      if (error) throw error
      const { data: urlData } = supabase.storage.from('lead-files').getPublicUrl(up.path)
      await supabase.from('lead_files').insert({
        lead_id: selectedLead.id, name: `[PROFESIONAL] ${file.name}`,
        url: urlData.publicUrl, type: file.type, size: file.size,
      })
      // Notificar a la org
      const { data: members } = await supabase
        .from('org_members').select('user_id').eq('org_id', selectedLead.org_id)
      for (const m of members ?? []) {
        await supabase.from('notifications').insert({
          user_id: m.user_id,
          title: `📎 ${professional.name} subió un archivo`,
          body: `${file.name} en lead: ${selectedLead.name}`,
          is_read: false,
        })
      }
      toast.success('Archivo subido')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al subir')
    } finally {
      setUploading(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <Header />
      <div className="mt-10 max-w-sm">
        <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-gray-800">Enlace no válido</h2>
        <p className="text-gray-500 text-sm mt-2">Este enlace no existe o el acceso ha sido desactivado.</p>
      </div>
    </div>
  )

  if (selectedLead) {
    const cleanName = selectedLead.name.replace(/^nombre:\s*/i, '').trim()
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Header proName={professional?.name} />
        <div className="max-w-lg mx-auto w-full px-4 py-6 space-y-4">
          <button onClick={() => setSelectedLead(null)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" />Volver a mis trabajos
          </button>

          {/* Info del lead */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="h-1.5" style={{ backgroundColor: (selectedLead.board as unknown as { color: string })?.color ?? '#2563EB' }} />
            <div className="p-5 space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Cliente</p>
                <h2 className="text-lg font-bold text-gray-900">{cleanName}</h2>
              </div>
              {selectedLead.concept && (
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-primary-500" />
                  <span className="text-sm font-medium text-primary-600">{selectedLead.concept}</span>
                </div>
              )}
              {(selectedLead.zone || selectedLead.address) && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  {selectedLead.zone || selectedLead.address}
                </div>
              )}
              {selectedLead.notes && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1 font-medium">Trabajo a realizar</p>
                  <p className="text-sm text-gray-700">{selectedLead.notes}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                  {(selectedLead.column as unknown as { name: string })?.name ?? 'Sin estado'}
                </span>
              </div>
            </div>
          </div>

          {/* Contacto */}
          {selectedLead.phone && (
            <div className="grid grid-cols-2 gap-3">
              <a href={`tel:${selectedLead.phone}`}>
                <Button variant="outline" className="w-full gap-2 h-12 text-green-700 border-green-300 hover:bg-green-50">
                  <Phone className="h-4 w-4" />Llamar cliente
                </Button>
              </a>
              <a href={toWhatsApp(selectedLead.phone)} target="_blank" rel="noreferrer">
                <Button variant="outline" className="w-full gap-2 h-12 text-emerald-700 border-emerald-300 hover:bg-emerald-50">
                  <MessageCircle className="h-4 w-4" />WhatsApp cliente
                </Button>
              </a>
            </div>
          )}

          {/* Mis notas */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-800">Mis notas</h3>
            {comments.length === 0 ? (
              <p className="text-sm text-gray-400">Sin notas aún</p>
            ) : (
              <div className="space-y-2">
                {comments.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-700">{c.content}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {new Date(c.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Textarea rows={2} placeholder="Escribe una nota…" value={newNote} onChange={e => setNewNote(e.target.value)}
                className="text-sm" />
              <Button size="sm" className="self-end" onClick={submitNote} disabled={!newNote.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Subir presupuesto */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-gray-800">Subir presupuesto / foto</h3>
            <p className="text-xs text-gray-400">Los archivos son visibles por la empresa</p>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload}
              accept=".pdf,.jpg,.jpeg,.png,.webp" />
            <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4" />{uploading ? 'Subiendo…' : 'Subir archivo'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header proName={professional?.name} />
      <main className="max-w-lg mx-auto w-full px-4 py-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Mis trabajos asignados</h2>
          <p className="text-sm text-gray-400">{leads.length} trabajo{leads.length !== 1 ? 's' : ''} asignado{leads.length !== 1 ? 's' : ''}</p>
        </div>

        {leads.length === 0 ? (
          <div className="text-center py-12">
            <Wrench className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-sm">No tienes trabajos asignados por ahora</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map(lead => {
              const cleanName = lead.name.replace(/^nombre:\s*/i, '').trim()
              const boardColor = (lead.board as unknown as { color: string })?.color ?? '#2563EB'
              return (
                <button
                  key={lead.id}
                  className="w-full text-left bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow active:scale-[0.99]"
                  onClick={() => setSelectedLead(lead)}
                >
                  <div className="h-1" style={{ backgroundColor: boardColor }} />
                  <div className="p-4 space-y-2">
                    <p className="font-semibold text-gray-900">{cleanName}</p>
                    {lead.concept && (
                      <p className="text-sm text-primary-600 font-medium flex items-center gap-1.5">
                        <Wrench className="h-3.5 w-3.5" />{lead.concept}
                      </p>
                    )}
                    {(lead.zone || lead.address) && (
                      <p className="text-sm text-gray-500 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-gray-400" />{lead.zone || lead.address}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                        {(lead.column as unknown as { name: string })?.name ?? ''}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(lead.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function Header({ proName }: { proName?: string }) {
  return (
    <div className="bg-slate-900 px-4 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center">
          <Radar className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-white font-bold text-[15px]">TrackALead</span>
      </div>
      {proName && <span className="text-slate-400 text-sm">{proName}</span>}
    </div>
  )
}
