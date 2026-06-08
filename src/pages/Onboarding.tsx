import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Onboarding() {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const { createOrganization, profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await createOrganization(name.trim())
      toast.success('¡Organización creada!')
      navigate('/boards', { replace: true })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al crear organización')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-base">TL</span>
          </div>
          <span className="text-white font-bold text-2xl tracking-tight">TrackALead</span>
        </div>

        <Card className="shadow-2xl">
          <CardHeader className="text-center">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Building2 className="h-6 w-6 text-primary-600" />
            </div>
            <CardTitle className="text-xl">Crea tu organización</CardTitle>
            <CardDescription>
              {profile?.full_name ? `Hola ${profile.full_name}, e` : 'E'}mpezamos configurando tu empresa
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="orgName">Nombre de tu empresa</Label>
                <Input
                  id="orgName"
                  placeholder="Reformas García S.L."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-gray-400">Puedes cambiarlo después en Configuración</p>
              </div>
              <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
                {loading ? 'Creando...' : 'Crear organización y entrar'}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                onClick={() => signOut()}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cerrar sesión
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
