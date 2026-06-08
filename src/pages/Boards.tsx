import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Globe, Layers } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useBoards } from '@/hooks/useBoards'
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
  const { boards, loading, createBoard } = useBoards()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [selectedColor, setSelectedColor] = useState(BOARD_COLORS[0])
  const navigate = useNavigate()
  const form = useForm<BoardFormData>({ defaultValues: { color: BOARD_COLORS[0] } })

  async function handleCreate(data: BoardFormData) {
    setCreating(true)
    try {
      const board = await createBoard({ ...data, color: selectedColor })
      toast.success('Tablero creado')
      setOpen(false)
      form.reset()
      navigate(`/boards/${board.id}`)
    } catch {
      toast.error('Error al crear tablero')
    } finally {
      setCreating(false)
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
            <BoardCard key={board.id} board={board} onClick={() => navigate(`/boards/${board.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}

function BoardCard({ board, onClick }: { board: Board; onClick: () => void }) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
      style={{ borderLeftColor: board.color }}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{board.name}</CardTitle>
          <div
            className="w-3 h-3 rounded-full shrink-0 mt-0.5"
            style={{ backgroundColor: board.color }}
          />
        </div>
        {board.description && (
          <p className="text-sm text-gray-500 line-clamp-2">{board.description}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
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
