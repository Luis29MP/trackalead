import { useState, useEffect } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Borrado seguro de un tablero: pide escribir el nombre exacto para confirmar.
// Las FK ON DELETE CASCADE eliminan listas, leads, comentarios, archivos, etc.
export function DeleteBoardDialog({
  board, leadCount, open, onOpenChange, onDeleted,
}: {
  board: { id: string; name: string } | null
  leadCount?: number
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted?: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { if (open) setText('') }, [open, board?.id])

  async function confirmDelete() {
    if (!board) return
    if (text.trim() !== board.name) { toast.error('El nombre no coincide'); return }
    setDeleting(true)
    const { error } = await supabase.from('boards').delete().eq('id', board.id)
    setDeleting(false)
    if (error) { toast.error('No se pudo eliminar el tablero'); return }
    toast.success(`Tablero "${board.name}" eliminado`)
    onDeleted?.(board.id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!deleting) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="h-5 w-5" />Eliminar tablero
          </DialogTitle>
        </DialogHeader>
        {board && (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Se eliminará <strong>"{board.name}"</strong> y <strong>todo</strong> su contenido
                {typeof leadCount === 'number' ? <> ({leadCount} lead{leadCount === 1 ? '' : 's'})</> : null}:
                listas, leads, comentarios, archivos, eventos y presupuestos. <strong>Es irreversible.</strong>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Escribe <span className="font-semibold text-gray-800">{board.name}</span> para confirmar</Label>
              <Input value={text} onChange={e => setText(e.target.value)} placeholder={board.name} autoFocus
                onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>Cancelar</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 gap-1.5"
                disabled={deleting || text.trim() !== board.name}
                onClick={confirmDelete}
              >
                <Trash2 className="h-4 w-4" />{deleting ? 'Eliminando…' : 'Eliminar definitivamente'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
