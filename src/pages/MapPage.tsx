import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleMap, useJsApiLoader, InfoWindow } from '@react-google-maps/api'
import { Filter, Phone, MessageCircle, RefreshCw, MapPin, Locate } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useLeads } from '@/hooks/useLeads'
import { useBoards } from '@/hooks/useBoards'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, sourceLabel } from '@/lib/utils'
import type { Board, Lead } from '@/types'

// ── SVG helpers ───────────────────────────────────────────────────────────────
function makePinSvg(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22s14-12.667 14-22C28 6.268 21.732 0 14 0z"
      fill="${color}" stroke="white" stroke-width="2.5"/>
    <circle cx="14" cy="14" r="5" fill="white"/>
  </svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

// Marcador azul pulsante para la posición del usuario
function makeUserDotSvg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="18" fill="#2563EB" fill-opacity="0.15"/>
    <circle cx="20" cy="20" r="11" fill="#2563EB" fill-opacity="0.3"/>
    <circle cx="20" cy="20" r="6" fill="#2563EB" stroke="white" stroke-width="2.5"/>
  </svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function toWhatsApp(phone: string) {
  const d = phone.replace(/\D/g, '')
  return d.startsWith('34') ? `https://wa.me/${d}` : `https://wa.me/34${d}`
}

const SPAIN_CENTER = { lat: 40.4168, lng: -3.7038 }
const MAP_OPTIONS: google.maps.MapOptions = {
  zoomControl: true, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
  styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
}

export function MapPage() {
  const { leads, refetch } = useLeads()
  const { boards } = useBoards()
  const { organization } = useAuth()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [filterBoard, setFilterBoard] = useState<string>('all')
  const [geocoding, setGeocoding] = useState(false)
  const [geoProgress, setGeoProgress] = useState<{ done: number; total: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const navigate = useNavigate()

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  })

  const mapRef           = useRef<google.maps.Map | null>(null)
  const markersRef       = useRef<google.maps.Marker[]>([])
  const clustererRef     = useRef<import('@googlemaps/markerclusterer').MarkerClusterer | null>(null)
  const userMarkerRef    = useRef<google.maps.Marker | null>(null)
  const hasFitRef        = useRef(false)   // solo hacer fitBounds la primera vez
  const [mapReady, setMapReady] = useState(false)

  const onLoad = useCallback((m: google.maps.Map) => {
    mapRef.current = m
    setMapReady(true)
  }, [])
  const onUnmount = useCallback(() => {
    mapRef.current = null
    setMapReady(false)
  }, [])

  // board_id → color
  const boardColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    boards.forEach((b: Board) => { m[b.id] = b.color })
    return m
  }, [boards])

  const filtered = useMemo(() =>
    leads.filter(l => {
      if (!l.lat || !l.lng) return false
      if (filterBoard !== 'all' && l.board_id !== filterBoard) return false
      return true
    })
  , [leads, filterBoard])

  const withoutCoords = useMemo(() =>
    leads.filter(l => (!l.lat || !l.lng) && (l.zone || l.address))
  , [leads])

  // ── Marcadores + clustering ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !isLoaded) return

    // Limpiar
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []
    if (clustererRef.current) {
      clustererRef.current.clearMarkers()
      clustererRef.current.setMap(null)
      clustererRef.current = null
    }

    // Crear marcadores
    const newMarkers = filtered.map(lead => {
      const color = boardColorMap[lead.board_id] ?? '#2563EB'
      const marker = new window.google.maps.Marker({
        position: { lat: lead.lat!, lng: lead.lng! },
        title: lead.name,
        icon: {
          url: makePinSvg(color),
          scaledSize: new window.google.maps.Size(28, 36),
          anchor: new window.google.maps.Point(14, 36),
        },
      })
      marker.addListener('click', () => {
        setSelectedLead(prev => prev?.id === lead.id ? null : lead)
      })
      return marker
    })

    markersRef.current = newMarkers

    // Clustering
    import('@googlemaps/markerclusterer').then(({ MarkerClusterer }) => {
      if (!mapRef.current) return
      clustererRef.current = new MarkerClusterer({ map: mapRef.current, markers: newMarkers })
    })

    // ── FitBounds: solo la primera vez que hay leads ──────────────────────
    if (!hasFitRef.current && filtered.length > 0) {
      hasFitRef.current = true
      const bounds = new window.google.maps.LatLngBounds()
      filtered.forEach(l => bounds.extend({ lat: l.lat!, lng: l.lng! }))
      setTimeout(() => {
        const m = mapRef.current
        if (!m) return
        m.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 })
        // fitBounds es asíncrono; esperamos el evento idle para limitar el zoom
        const listener = window.google.maps.event.addListenerOnce(m, 'idle', () => {
          const z = m.getZoom() ?? 0
          if (z > 12) m.setZoom(12)
        })
        // Seguro de limpieza por si idle no llega
        setTimeout(() => {
          window.google.maps.event.removeListener(listener)
          const z = m.getZoom() ?? 0
          if (z > 12) m.setZoom(12)
        }, 2000)
      }, 100)
    } else if (!hasFitRef.current && filtered.length === 0) {
      // Sin leads → España
      mapRef.current.setCenter(SPAIN_CENTER)
      mapRef.current.setZoom(6)
    }
  }, [mapReady, filtered, boardColorMap])

  // ── Geolocalización del usuario ───────────────────────────────────────────
  function handleLocateMe() {
    if (!navigator.geolocation) {
      toast.error('Tu navegador no soporta geolocalización')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        if (mapRef.current) {
          mapRef.current.setCenter({ lat, lng })
          mapRef.current.setZoom(13)
        }
        // Marcador de posición del usuario
        if (userMarkerRef.current) userMarkerRef.current.setMap(null)
        if (mapRef.current) {
          userMarkerRef.current = new window.google.maps.Marker({
            position: { lat, lng },
            map: mapRef.current,
            title: 'Tu ubicación',
            zIndex: 1000,
            icon: {
              url: makeUserDotSvg(),
              scaledSize: new window.google.maps.Size(40, 40),
              anchor: new window.google.maps.Point(20, 20),
            },
          })
        }
        setLocating(false)
        toast.success('Mapa centrado en tu posición')
      },
      (err) => {
        setLocating(false)
        const msgs: Record<number, string> = {
          1: 'Permiso denegado. Activa la geolocalización en tu navegador.',
          2: 'No se pudo obtener tu posición.',
          3: 'Tiempo de espera agotado.',
        }
        toast.error(msgs[err.code] ?? 'Error de geolocalización')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
  }

  // ── Geocodificación masiva ────────────────────────────────────────────────
  async function handleBulkGeocode() {
    if (!organization || withoutCoords.length === 0) return
    setGeocoding(true)
    setGeoProgress({ done: 0, total: withoutCoords.length })
    let success = 0
    const { geocode } = await import('@/lib/geocode')

    for (let i = 0; i < withoutCoords.length; i++) {
      const lead = withoutCoords[i]
      setGeoProgress({ done: i + 1, total: withoutCoords.length })
      try {
        const text = lead.zone || lead.address || ''
        if (!text) continue
        const result = await geocode(text)
        if (result) {
          await supabase.from('leads')
            .update({ lat: result.lat, lng: result.lng, updated_at: new Date().toISOString() })
            .eq('id', lead.id)
          success++
        }
        await new Promise(r => setTimeout(r, 220))
      } catch { /* continuar */ }
    }

    hasFitRef.current = false  // forzar fitBounds con los nuevos leads
    setGeoProgress(null)
    setGeocoding(false)
    await refetch()
    success > 0
      ? toast.success(`${success} de ${withoutCoords.length} leads geolocalizados`)
      : toast.warning('No se pudo geolocalizar ningún lead')
  }

  if (!isLoaded) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
    </div>
  )

  return (
    // h-full: ocupa todo lo que le da AppLayout (que ya tiene overflow:hidden en /map)
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header: filtros y acciones ─────────────────────────────────── */}
      <div className="shrink-0 px-4 md:px-6 pt-4 pb-3 bg-background space-y-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Mapa de Leads</h1>
            <p className="text-xs text-gray-400">
              {filtered.length} en el mapa
              {withoutCoords.length > 0 && <span className="text-amber-500"> · {withoutCoords.length} sin ubicación</span>}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-gray-400" />
              <Select value={filterBoard} onValueChange={v => { setFilterBoard(v); hasFitRef.current = false }}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tableros</SelectItem>
                  {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {withoutCoords.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleBulkGeocode} disabled={geocoding} className="text-xs gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${geocoding ? 'animate-spin' : ''}`} />
                {geocoding && geoProgress
                  ? `${geoProgress.done}/${geoProgress.total}…`
                  : `Geolocalizar ${withoutCoords.length}`
                }
              </Button>
            )}
          </div>
        </div>

        {/* Leyenda por tablero */}
        {boards.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {boards.map(b => {
              const count = leads.filter(l => l.board_id === b.id && l.lat && l.lng).length
              if (count === 0) return null
              return (
                <button
                  key={b.id}
                  onClick={() => setFilterBoard(filterBoard === b.id ? 'all' : b.id)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all"
                  style={{
                    borderColor: b.color,
                    backgroundColor: filterBoard === b.id ? b.color + '20' : 'white',
                    color: b.color,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: b.color }} />
                  {b.name} <span className="opacity-60">({count})</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Mapa: ocupa TODO el resto ──────────────────────────────────── */}
      <div style={{ flex: '1 1 0%', position: 'relative', overflow: 'hidden' }}>
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={SPAIN_CENTER}
          zoom={6}
          options={MAP_OPTIONS}
          onLoad={onLoad}
          onUnmount={onUnmount}
        >
          {/* InfoWindow del lead seleccionado */}
          {selectedLead?.lat && selectedLead?.lng && (
            <InfoWindow
              position={{ lat: selectedLead.lat, lng: selectedLead.lng }}
              options={{ pixelOffset: new window.google.maps.Size(0, -36) }}
              onCloseClick={() => setSelectedLead(null)}
            >
              <div className="font-sans min-w-[180px] max-w-[230px] space-y-2 p-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: boardColorMap[selectedLead.board_id] ?? '#2563EB' }} />
                  <p className="font-bold text-gray-900 text-sm leading-tight truncate">{selectedLead.name}</p>
                </div>
                {(selectedLead as unknown as { concept?: string }).concept && (
                  <p className="text-xs font-medium text-blue-600">
                    {(selectedLead as unknown as { concept: string }).concept}
                  </p>
                )}
                {(selectedLead.zone || selectedLead.address) && (
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {selectedLead.zone || selectedLead.address}
                  </p>
                )}
                {selectedLead.phone && (
                  <p className="text-xs text-gray-700 font-medium">{selectedLead.phone}</p>
                )}
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant="secondary" className="text-[10px] py-0">{sourceLabel(selectedLead.source)}</Badge>
                  {selectedLead.budget_amount && (
                    <span className="text-xs font-bold text-amber-600">{formatCurrency(selectedLead.budget_amount)}</span>
                  )}
                </div>
                {selectedLead.phone && (
                  <div className="flex gap-1.5">
                    <a href={`tel:${selectedLead.phone}`}
                      className="flex-1 flex items-center justify-center gap-1 text-[11px] bg-green-50 border border-green-200 text-green-700 rounded py-1.5 hover:bg-green-100">
                      <Phone className="h-3 w-3" />Llamar
                    </a>
                    <a href={toWhatsApp(selectedLead.phone)} target="_blank" rel="noreferrer"
                      className="flex-1 flex items-center justify-center gap-1 text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-700 rounded py-1.5 hover:bg-emerald-100">
                      <MessageCircle className="h-3 w-3" />WA
                    </a>
                  </div>
                )}
                <button
                  onClick={() => navigate(`/leads/${selectedLead.id}`)}
                  className="w-full text-[11px] bg-primary-600 text-white rounded py-1.5 hover:bg-primary-700 font-medium"
                >
                  Ver ficha completa →
                </button>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>

        {/* Botón de geolocalización — flotante sobre el mapa */}
        <button
          onClick={handleLocateMe}
          disabled={locating}
          title="Centrar en mi posición"
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 10,
            width: 40,
            height: 40,
            background: 'white',
            border: '1px solid rgba(0,0,0,0.2)',
            borderRadius: 4,
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: locating ? 'wait' : 'pointer',
          }}
        >
          <Locate
            style={{
              width: 18,
              height: 18,
              color: locating ? '#2563EB' : '#555',
              animation: locating ? 'pulse 1s infinite' : 'none',
            }}
          />
        </button>

        {/* Nota leads sin coords */}
        {withoutCoords.length > 0 && !geocoding && (
          <div style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(4px)',
            border: '1px solid #FDE68A',
            borderRadius: 8,
            padding: '4px 12px',
            fontSize: 11,
            color: '#92400E',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            ⚠️ {withoutCoords.length} leads sin ubicación — pulsa "Geolocalizar" arriba
          </div>
        )}
      </div>
    </div>
  )
}
