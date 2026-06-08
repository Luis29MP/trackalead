import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Board, BoardColumn } from '@/types'
import { useAuth } from '@/context/AuthContext'

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

  async function createBoard(board: Partial<Board>) {
    const { data, error } = await supabase
      .from('boards')
      .insert({ ...board, org_id: organization!.id })
      .select()
      .single()

    if (error) throw error

    const defaultColumns = [
      { name: 'Nuevo lead',    position: 0, color: '#6B7280' },
      { name: 'Gestionado',    position: 1, color: '#3B82F6' },
      { name: 'Visitado',      position: 2, color: '#8B5CF6' },
      { name: 'Presupuestado', position: 3, color: '#F59E0B' },
      { name: 'Aceptado',      position: 4, color: '#10B981' },
      { name: 'Rechazado',     position: 5, color: '#EF4444' },
      { name: 'Finalizado',    position: 6, color: '#059669' },
    ]

    await supabase.from('board_columns').insert(
      defaultColumns.map((col) => ({ ...col, board_id: data.id }))
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
