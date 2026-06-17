import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Globe, Layers, Check, Trash2, Users, Sparkles } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useBoards, STANDARD_COLUMNS } from '@/hooks/useBoards'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { formatDate } from '@/lib/utils'
import type { Board } from '@/types'

const BOARD_COLORS = [
  '#2563EB', '#7C3AED', '#DC2626', '#D97706', '#059669', '#0891B2',
  '#9333EA', '#C026D3', '#E11D48', '#65A30D',
]

interface BoardFormData {
  name: string
  description: string
  website_url: string
  color: string
}

export function Boards() {
  const { boards, loading, createBoard, deleteBoard } = useBoards()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [selectedColor, setSelectedColor] = useState(BOARD_COLORS[0])
  const [preset, setPreset] = useState<'standard' | 'empty' | 'custom'>('standard')
  const [customCols, setCustomCols] = useState<Set<string>>(() => new Set(STANDARD_COLUMNS.map(c => c.name)))
  const navigate = useNavigate()
  const form = useForm<BoardFormData>({ defaultValues: { color: BOARD_COLORS[0] } })

  function toggleCustomCol(name: string) {
    setCustomCols(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  async function handleCreate(data: BoardFormData) {
    setCreating(true)
    try {
      let cols: { name: string; color: string }[]
      if (preset === 'standard') {
        cols = STANDARD_COLUMNS
      } else if (preset === 'empty') {
        cols = [{ name: 'Nuevo lead', color: '#6B7280' }]
      } else {
        cols = STANDARD_COLUMNS.filter(c => customCols.has(c.name))
        if (cols.length === 0) cols = [{ name: 'Nuevo lead', color: '#6B7280' }]
      }
      const board = await createBoard({ ...data, color: selectedColor }, cols)
      toast.success('Tablero creado')
      setOpen(false)
      form.reset()
      setPreset('standard')
      setCustomCols(new Set(STANDARD_COLUMNS.map(c => c.name)))
      navigate(`/boards/${board.id}`)
    } catch {
      toast.error('Error al crear tablero')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(board: Board) {
    const n = board.lead_count ?? 0
    if (!window.confirm(
      `¿Eliminar el tablero "${board.name}"?\n\nSe borrarán también sus ${n} lead(s) y todas sus listas, comentarios y archivos. Esta acción es irreversible.`
    )) return
    try {
      await deleteBoard(board.id)
      toast.success(`Tablero "${board.name}" eliminado`)
    } catch {
      toast.error('No se pudo eliminar el tablero')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableros</h1>
          <p className="text-gray-500 text-sm mt-1">Gestiona los tableros de captación de leads</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Nuevo tablero
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Crear tablero</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input placeholder="Reforma cocinas Madrid" {...form.register('name', { required: true })} />
              </div>
              <div className="space-y-1.5">
                <Label>Descripción (opcional)</Label>
                <Input placeholder="Leads de reformas de cocina..." {...form.register('description')} />
              </div>
              <div className="space-y-1.5">
                <Label>Web de captación (opcional)</Label>
                <Input placeholder="https://miempresa.com" {...form.register('website_url')} />
              </div>
              <div className="space-y-1.5">
                <Label>Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {BOARD_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        outline: selectedColor === color ? `3px solid ${color}` : undefined,
                        outlineOffset: '2px',
                      }}
                    />
                  ))}
                </div>
              </div>
              {/* Columnas iniciales */}
              <div className="space-y-2">
                <Label>Columnas del tablero</Label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'standard', label: 'Estándar', desc: '7 columnas' },
                    { key: 'empty',    label: 'Vacío',    desc: 'Solo "Nuevo lead"' },
                    { key: 'custom',   label: 'Personalizar', desc: 'Elige cuáles' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPreset(opt.key)}
                      className={`text-left rounded-lg border p-2.5 transition-colors ${
                        preset === opt.key
                          ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="text-xs font-semibold text-gray-800">{opt.label}</p>
                      <p className="text-[11px] text-gray-400 leading-tight">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {preset === 'custom' && (
                  <div className="border border-gray-100 rounded-lg p-2 space-y-1 mt-1">
                    {STANDARD_COLUMNS.map(col => {
                      const checked = customCols.has(col.name)
                      return (
                        <button
                          key={col.name}
                          type="button"
                          onClick={() => toggleCustomCol(col.name)}
                          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 transition-colors"
                        >
                          <span className={`w-4 h-4 rounded flex items-center justify-center border ${checked ? 'bg-primary-600 border-primary-600' : 'border-gray-300'}`}>
                            {checked && <Check className="h-3 w-3 text-white" />}
                          </span>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                          <span className="text-xs text-gray-700">{col.name}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={creating}>
                  {creating ? 'Creando...' : 'Crear tablero'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {boards.length === 0 ? (
        <div className="text-center py-16">
          <Layers className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Sin tableros</h3>
          <p className="text-gray-500 text-sm mt-1">Crea tu primer tablero para empezar a gestionar leads</p>
          <Button className="mt-4" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Crear tablero
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              onClick={() => navigate(`/boards/${board.id}`)}
              onDelete={() => handleDelete(board)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BoardCard({ board, onClick, onDelete }: { board: Board; onClick: () => void; onDelete: () => void }) {
  const total = board.lead_count ?? 0
  const nuevos = board.new_count ?? 0
  return (
    <Card
      className="group cursor-pointer hover:shadow-md transition-shadow border-l-4"
      style={{ borderLeftColor: board.color }}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{board.name}</CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50"
              title="Eliminar tablero"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <div className="w-3 h-3 rounded-full mt-0.5" style={{ backgroundColor: board.color }} />
          </div>
        </div>
        {board.description && (
          <p className="text-sm text-gray-500 line-clamp-2">{board.description}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Resumen: total de leads + nuevos (48 h) */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-xs font-semibold">
            <Users className="h-3.5 w-3.5 text-slate-400" />{total} {total === 1 ? 'lead' : 'leads'}
          </span>
          {nuevos > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 text-primary-700 px-2.5 py-1 text-xs font-semibold ring-1 ring-primary-200">
              <Sparkles className="h-3.5 w-3.5" />{nuevos} {nuevos === 1 ? 'nuevo' : 'nuevos'} · 48 h
            </span>
          ) : (
            <span className="text-[11px] text-gray-400">Sin nuevos (48 h)</span>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-400">
          {board.website_url && (
            <div className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              <span className="truncate max-w-[120px]">{board.website_url.replace(/^https?:\/\//, '')}</span>
            </div>
          )}
          <span className="ml-auto">{formatDate(board.created_at)}</span>
        </div>
      </CardContent>
    </Card>
  )
}
