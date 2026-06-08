export interface GeoResult {
  lat: number
  lng: number
  formattedAddress: string
}

// Llama a Google Maps Geocoding API con bias hacia España
export async function geocode(text: string): Promise<GeoResult | null> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key || !text.trim()) return null

  // Añadir ", España" si el texto no parece ya tener país
  const query = /españa|spain|\bES\b/i.test(text) ? text : `${text}, España`

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=es&language=es&key=${key}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()

    if (data.status === 'OK' && data.results?.length > 0) {
      const { lat, lng } = data.results[0].geometry.location
      return {
        lat,
        lng,
        formattedAddress: data.results[0].formatted_address ?? '',
      }
    }
  } catch (err) {
    console.error('[geocode]', err)
  }
  return null
}
