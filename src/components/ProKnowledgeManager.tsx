import { useEffect, useState } from 'react'
import { Upload, Trash2, FileText, Table, StickyNote, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { extractKnowledgeText } from '@/lib/extractText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ProKnowledge } from '@/types'

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  example_budget: { label: 'Presupuesto ejemplo', icon: FileText, color: 'text-blue-500' },
  rate_table:     { label: 'Tabla de tarifas',    icon: FileSpreadsheet, color: 'text-emerald-500' },
  note:           { label: 'Nota',                icon: StickyNote, color: 'text-amber-500' },
  document:       { label: 'Documento',           icon: Table, color: 'text-gray-500' },
}

export function ProKnowledgeManager({ professionalId, orgId }: { professionalId: string; orgId: string }) {
  const [items, setItems] = useState<ProKnowledge[]>([])
  const [uploading, setUploading] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteText, setNoteText] = useState('')

  useEffect(() => { load() }, [professionalId])

  async function load() {
    const { data } = await supabase.from('pro_knowledge').select('*')
      .eq('professional_id', professionalId).order('created_at', { ascending: false })
    setItems((data ?? []) as ProKnowledge[])
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const content = await extractKnowledgeText(file).catch(() => '')
        const path = `${orgId}/${professionalId}/${Date.now()}-${file.name}`
        let fileUrl: string | null = null
        const { error } = await supabase.storage.from('pro-knowledge').upload(path, file, { upsert: true })
        if (!error) fileUrl = supabase.storage.from('pro-knowledge').getPublicUrl(path).data.publicUrl
        const type = /presupuesto|budget|oferta/i.test(file.name)
          ? 'example_budget'
          : (/\.(xlsx|xls|csv)$/i.test(file.name) ? 'rate_table' : 'document')
        await supabase.from('pro_knowledge').insert({
          professional_id: professionalId, org_id: orgId, type,
          title: file.name, content_text: content || null, file_url: fileUrl,
        })
      }
      toast.success('Material añadido a la base de conocimiento')
      await load()
    } catch {
      toast.error('Error al subir el archivo')
    } finally {
      setUploading(false)
    }
  }

  async function addNote() {
    if (!noteText.trim()) return
    await supabase.from('pro_knowledge').insert({
      professional_id: professionalId, org_id: orgId, type: 'note',
      title: noteTitle.trim() || 'Nota', content_text: noteText.trim(),
    })
    setNoteTitle(''); setNoteText('')
    toast.success('Nota guardada')
    load()
  }

  async function remove(id: string) {
    await supabase.from('pro_knowledge').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Sube presupuestos de ejemplo (PDF), tablas de tarifas (Excel/CSV) o notas de tus trabajos habituales. La IA los usará para afinar los precios.
      </p>

      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg py-4 cursor-pointer hover:border-primary-400 text-gray-500 hover:text-primary-600 text-sm">
        <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.txt,.md,image/*" className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        <Upload className="h-4 w-4" />{uploading ? 'Procesando…' : 'Subir presupuestos, tarifas o documentos'}
      </label>

      {/* Nota rápida */}
      <div className="border border-gray-100 rounded-lg p-2 space-y-2">
        <Input placeholder="Título de la nota (opcional)" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} className="h-8 text-sm" />
        <Textarea rows={2} placeholder="Ej: mano de obra electricista 35€/h; desplazamiento 30€; CIE 180€…" value={noteText} onChange={e => setNoteText(e.target.value)} className="text-sm" />
        <Button size="sm" variant="outline" onClick={addNote} disabled={!noteText.trim()}>Guardar nota</Button>
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-2">Sin material todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map(it => {
            const meta = TYPE_META[it.type] ?? TYPE_META.document
            const Icon = meta.icon
            return (
              <div key={it.id} className="flex items-center gap-2.5 border border-gray-100 rounded-lg px-3 py-2">
                <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{it.title || meta.label}</p>
                  <p className="text-[10px] text-gray-400">{meta.label}{it.content_text ? ' · texto extraído' : ''}</p>
                </div>
                {it.file_url && <a href={it.file_url} target="_blank" rel="noreferrer" className="text-[11px] text-primary-600 hover:underline shrink-0">ver</a>}
                <button onClick={() => remove(it.id)} className="text-red-400 hover:text-red-600 shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
