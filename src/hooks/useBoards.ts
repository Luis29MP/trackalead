import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Board, BoardColumn } from '@/types'
import { useAuth } from '@/context/AuthContext'

// Columnas estándar de un tablero de captación de leads
export const STANDARD_COLUMNS: { name: string; color: string }[] = [
  { name: 'Nuevo lead',    color: '#6B7280' },
  { name: 'Gestionado',    color: '#3B82F6' },
  { name: 'Visitado',      color: '#8B5CF6' },
  { name: 'Presupuestado', color: '#F59E0B' },
  { name: 'Aceptado',      color: '#10B981' },
  { name: 'Rechazado',     color: '#EF4444' },
  { name: 'Finalizado',    color: '#059669' },
]

export function useBoards() {
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(false)   // false inicial, no bloquea si org es null
  const { organization } = useAuth()

  useEffect(() => {
    if (!organization?.id) {
      setBoards([])
      setLoading(false)
      return
    }
    loadBoards()
  }, [organization?.id])

  async function loadBoards() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('boards')
        .select('*')
        .eq('org_id', organization!.id)
        .order('created_at', { ascending: false })
      setBoards(data ?? [])
    } catch {
      setBoards([])
    } finally {
      setLoading(false)
    }
  }

  // columns: lista de columnas a crear. Si no se pasa, usa las estándar.
  async function createBoard(board: Partial<Board>, columns?: { name: string; color: string }[]) {
    const { data, error } = await supabase
      .from('boards')
      .insert({ ...board, org_id: organization!.id })
      .select()
      .single()

    if (error) throw error

    const cols = columns && columns.length > 0 ? columns : STANDARD_COLUMNS
    await supabase.from('board_columns').insert(
      cols.map((col, i) => ({ name: col.name, color: col.color, position: i, board_id: data.id }))
    )

    await loadBoards()
    return data
  }

  return { boards, loading, refetch: loadBoards, createBoard }
}

export function useBoardColumns(boardId: string) {
  const [columns, setColumns] = useState<BoardColumn[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!boardId) return
    loadColumns()
  }, [boardId])

  async function loadColumns() {
    setLoading(true)
    try {
      const { data: cols } = await supabase
        .from('board_columns')
        .select('*')
        .eq('board_id', boardId)
        .order('position')

      if (!cols || cols.length === 0) {
        setColumns([])
        return
      }

      const { data: leads } = await supabase
        .from('leads')
        .select('*, assigned_professional:professionals(*)')
        .eq('board_id', boardId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })

      setColumns(
        cols.map((col) => ({
          ...col,
          leads: (leads ?? []).filter((l) => l.column_id === col.id),
        }))
      )
    } catch {
      setColumns([])
    } finally {
      setLoading(false)
    }
  }

  return { columns, loading, refetch: loadColumns }
}
