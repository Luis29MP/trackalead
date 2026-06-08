import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'

export function JoinOrg() {
  const { orgId } = useParams<{ orgId: string }>()
  const { session, loading, refreshOrganization } = useAuth()
  const navigate = useNavigate()
  const [orgName, setOrgName] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!orgId) return
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()
      .then(({ data }) => setOrgName(data?.name ?? null))
  }, [orgId])

  useEffect(() => {
    if (!loading && !session) {
      // Guardar la intención y redirigir al login
      sessionStorage.setItem('pendingJoinOrg', orgId ?? '')
      navigate('/login')
    }
  }, [loading, session, orgId, navigate])

  async function handleJoin() {
    if (!session || !orgId) return
    setJoining(true)
    try {
      const { error } = await supabase.from('org_members').insert({
        org_id: orgId,
        user_id: session.user.id,
        role: 'manager',
      })
      if (error && error.code !== '23505') throw error // 23505 = ya existe
      await refreshOrganization()
      toast.success(`Te has unido a ${orgName ?? 'la organización'}`)
      setDone(true)
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al unirse')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!orgName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-gray-500">Enlace de invitación no válido</p>
          <Button className="mt-4" onClick={() => navigate('/')}>Ir al inicio</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
        <div className="w-14 h-14 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-primary-600 font-bold text-xl">TL</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Invitación a organización</h2>
        <p className="text-gray-500 text-sm mb-6">
          Has sido invitado a unirte a <span className="font-semibold text-gray-800">{orgName}</span>
        </p>
        {done ? (
          <p className="text-green-600 font-medium">¡Unido! Redirigiendo...</p>
        ) : (
          <Button className="w-full" onClick={handleJoin} disabled={joining}>
            {joining ? 'Uniéndose...' : 'Aceptar invitación'}
          </Button>
        )}
      </div>
    </div>
  )
}
