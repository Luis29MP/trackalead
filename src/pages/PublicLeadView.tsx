import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MapPin, Wrench, FileText, Radar, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface PublicLead {
  name: string
  zone: string | null
  address: string | null
  concept: string | null
  notes: string | null
  phone: string | null
  lat: number | null
  lng: number | null
}

function toWhatsApp(phone: string) {
  const d = phone.replace(/\D/g, '')
  return d.startsWith('34') ? `https://wa.me/${d}` : `https://wa.me/34${d}`
}

export function PublicLeadView() {
  const { token } = useParams<{ token: string }>()
  const [lead, setLead] = useState<PublicLead | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    fetchLead()
  }, [token])

  async function fetchLead() {
    setLoading(true)
    // RPC con SECURITY DEFINER: solo expone campos públicos del lead por su token
    const { data, error } = await supabase.rpc('public_lead_by_token', { p_token: token })
    if (error || !data) {
      setNotFound(true)
    } else {
      setLead(data as PublicLead)
    }
    setLoading(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <Header />
      <div className="mt-10 max-w-sm">
        <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-gray-800">Enlace no válido</h2>
        <p className="text-gray-500 text-sm mt-2">
          Este enlace no existe o ha sido revocado.
        </p>
      </div>
    </div>
  )

  const location = lead!.zone || lead!.address
  const mapsUrl = lead!.lat && lead!.lng
    ? `https://maps.google.com/?q=${lead!.lat},${lead!.lng}`
    : lead!.address
      ? `https://maps.google.com/?q=${encodeURIComponent(lead!.address)}`
      : null

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header />

      <main className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-md space-y-4">

          {/* Card principal */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Color header */}
            <div className="h-2 bg-primary-600" />
            <div className="p-5 space-y-4">

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Cliente</p>
                <h1 className="text-xl font-bold text-gray-900">{lead!.name}</h1>
              </div>

              {location && (
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400 font-medium">Zona</p>
                    <p className="text-sm text-gray-800">{location}</p>
                  </div>
                </div>
              )}

              {lead!.concept && (
                <div className="flex items-start gap-3">
                  <Wrench className="h-4 w-4 text-primary-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400 font-medium">Trabajo</p>
                    <p className="text-sm font-semibold text-primary-700">{lead!.concept}</p>
                  </div>
                </div>
              )}

              {lead!.notes && (
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400 font-medium">Descripción</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{lead!.notes}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Acciones */}
          <div className="space-y-3">
            {lead!.phone && (
              <>
                <a href={`tel:${lead!.phone}`} className="block">
                  <button className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2.5 transition-colors active:scale-[0.98]">
                    <Phone className="h-5 w-5" />
                    Llamar al cliente — {lead!.phone}
                  </button>
                </a>
                <a href={toWhatsApp(lead!.phone)} target="_blank" rel="noreferrer" className="block">
                  <button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2.5 transition-colors active:scale-[0.98]">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    WhatsApp al cliente
                  </button>
                </a>
              </>
            )}

            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noreferrer" className="block">
                <button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2.5 transition-colors active:scale-[0.98]">
                  <MapPin className="h-5 w-5" />
                  Abrir en Google Maps
                </button>
              </a>
            )}
          </div>

          <p className="text-center text-xs text-gray-400 pt-2">
            Gestión de leads con TrackALead
          </p>
        </div>
      </main>
    </div>
  )
}

function Header() {
  return (
    <div className="bg-slate-900 px-6 py-4 flex items-center gap-2.5">
      <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center shrink-0">
        <Radar className="h-3.5 w-3.5 text-white" />
      </div>
      <span className="text-white font-bold text-[15px] tracking-tight">TrackALead</span>
    </div>
  )
}
