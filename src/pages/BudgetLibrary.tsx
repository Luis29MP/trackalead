import { useEffect, useState } from 'react'
import { BookOpen, Upload, Trash2, FileText, ExternalLink, Sparkles, User } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'

interface LibItem {
  id: string
  title: string | null
  gremio: string | null
  content_text: string | null
  file_url: string | null
  source: string | null
  created_at: string
}

export function BudgetLibrary() {
  const { organization, user } = useAuth()
  const [items, setItems] = useState<LibItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [gremios, setGremios] = useState<string[]>([])
  const [gremio, setGremio] = useState<string>('General')

  useEffect(() => { if (organization) { load(); loadGremios() } }, [organization?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('budget_library').select('*').eq('org_id', organization!.id).order('created_at', { ascending: false })
    setItems((data ?? []) as LibItem[])
    setLoading(false)
  }
  async function loadGremios() {
    const { data } = await supabase.from('boards').select('name').eq('org_id', organization!.id).order('name')
    setGremios(['General', ...((data ?? []).map(b => b.name as string))])
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !organization) return
    setUploading(true)
    const { extractKnowledgeText } = await import('@/lib/extractText')
    let ok = 0, skipped = 0
    for (const file of Array.from(files)) {
      try {
        const text = await extractKnowledgeText(file)
        if (text.trim().length < 50) { skipped++; continue }  // fotos/escaneos sin texto → se avisa
        // Guardar archivo (referencia) + texto en la biblioteca
        let fileUrl: string | null = null
        try {
          const path = `library/${organization.id}/${Date.now()}-${file.name}`
          const { data: up } = await supabase.storage.from('lead-files').upload(path, file, { upsert: true })
          if (up) fileUrl = supabase.storage.from('lead-files').getPublicUrl(up.path).data.publicUrl
        } catch { /* si falla el storage, guardamos el texto igualmente */ }
        const { error } = await supabase.from('budget_library').insert({
          org_id: organization.id, title: file.name, gremio: gremio === 'General' ? null : gremio,
          content_text: text.slice(0, 40000), file_url: fileUrl, source: 'org', created_by: user?.id ?? null,
        })
        if (!error) ok++
      } catch { skipped++ }
    }
    setUploading(false)
    if (ok) toast.success(`${ok} presupuesto(s) añadido(s) a la biblioteca`)
    if (skipped) toast.error(`${skipped} archivo(s) sin texto legible (¿foto o escaneo? súbelo en PDF con texto, Excel o Word)`, { duration: 7000 })
    load()
  }

  async function remove(id: string) {
    if (!window.confirm('¿Quitar este presupuesto de la biblioteca?')) return
    await supabase.from('budget_library').delete().eq('id', id)
    load()
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary-600" />Biblioteca de presupuestos</h1>
        <p className="text-gray-500 text-sm mt-1">Sube presupuestos <strong>reales</strong> (PDF con texto, Excel o Word). La IA los usa como referencia para clavar precios y formato al generar presupuestos.</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Gremio (opcional)</label>
              <Select value={gremio} onValueChange={setGremio}>
                <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {gremios.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className={`inline-flex items-center gap-2 px-4 h-10 rounded-md border cursor-pointer text-sm font-medium ${uploading ? 'opacity-60 pointer-events-none' : 'hover:bg-gray-50 border-gray-200'}`}>
              <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.docx,.txt" className="hidden" disabled={uploading}
                onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
              {uploading ? <><Sparkles className="h-4 w-4 animate-pulse" />Procesando…</> : <><Upload className="h-4 w-4" />Subir presupuestos</>}
            </label>
          </div>
          <p className="text-[11px] text-gray-400">Puedes subir varios a la vez. Las fotos o escaneos sin texto no valen (la IA no los "lee"); pásalos a PDF con texto o Excel.</p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">La biblioteca está vacía. Sube tus primeros presupuestos reales para que la IA aprenda vuestro estilo.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">{items.length} presupuesto(s) en la biblioteca</p>
          {items.map(it => (
            <Card key={it.id}>
              <CardContent className="p-3.5 flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{it.title || 'Presupuesto'}</p>
                  <p className="text-xs text-gray-400">
                    {it.gremio ? `${it.gremio} · ` : ''}{formatDate(it.created_at)}
                    {it.source === 'pro' && <span className="ml-1 inline-flex items-center gap-0.5 text-indigo-500"><User className="h-3 w-3" />profesional</span>}
                  </p>
                </div>
                {it.file_url && (
                  <a href={it.file_url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-primary-600 shrink-0" title="Ver archivo">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <button onClick={() => remove(it.id)} className="text-red-400 hover:text-red-600 shrink-0" title="Quitar"><Trash2 className="h-4 w-4" /></button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
