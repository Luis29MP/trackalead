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
      const list = data ?? []
      const boardIds = list.map(b => b.id)

      if (boardIds.length === 0) { setBoards([]); return }

      // Columna de "nuevos leads" de cada tablero: la que se llama "Nuevo(s) lead(s)"
      // (match por nombre); si no hay, la primera por posición (lista de entrada).
      const { data: cols } = await supabase
        .from('board_columns')
        .select('id, board_id, name, position')
        .in('board_id', boardIds)
      const colsByBoard: Record<string, { id: string; name: string; position: number }[]> = {}
      for (const c of cols ?? []) (colsByBoard[c.board_id] ??= []).push(c)
      const newColByBoard: Record<string, string | undefined> = {}
      for (const b of list) {
        const bcols = (colsByBoard[b.id] ?? []).slice().sort((a, z) => a.position - z.position)
        const match = bcols.find(c => /nuevo/i.test(c.name)) ?? bcols[0]
        newColByBoard[b.id] = match?.id
      }

      // Resumen por tablero: total de leads activos y nuevos (en la lista de nuevos, últimas 48 h)
      const { data: leads } = await supabase
        .from('leads')
        .select('board_id, column_id, created_at')
        .eq('org_id', organization!.id)
        .eq('is_archived', false)
      const cutoff = Date.now() - 48 * 60 * 60 * 1000
      const stats: Record<string, { total: number; nuevos: number }> = {}
      for (const l of leads ?? []) {
        const s = (stats[l.board_id] ??= { total: 0, nuevos: 0 })
        s.total++
        if (l.column_id === newColByBoard[l.board_id] && new Date(l.created_at).getTime() >= cutoff) s.nuevos++
      }

      setBoards(list.map(b => ({
        ...b,
        lead_count: stats[b.id]?.total ?? 0,
        new_count: stats[b.id]?.nuevos ?? 0,
      })))
    } catch {
      setBoards([])
    } finally {
      setLoading(false)
    }
  }

  async function deleteBoard(id: string) {
    // Las FK ON DELETE CASCADE borran columnas, leads y sus datos asociados.
    const { error } = await supabase.from('boards').delete().eq('id', id)
    if (error) throw error
    setBoards(prev => prev.filter(b => b.id !== id))
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

  return { boards, loading, refetch: loadBoards, createBoard, deleteBoard }
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
        // orden manual (Trello) primero; los que no lo tienen, por fecha
        .order('position', { ascending: true, nullsFirst: false })
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
