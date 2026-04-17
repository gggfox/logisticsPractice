import L from 'leaflet'
import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

interface LoadPoint {
  load_id: string
  origin: string
  destination: string
  status: string
  loadboard_rate: number
}

const CITY_COORDS: Record<string, [number, number]> = {
  'dallas, tx': [32.7767, -96.797],
  'chicago, il': [41.8781, -87.6298],
  'los angeles, ca': [34.0522, -118.2437],
  'phoenix, az': [33.4484, -112.074],
  'atlanta, ga': [33.749, -84.388],
  'miami, fl': [25.7617, -80.1918],
  'houston, tx': [29.7604, -95.3698],
  'memphis, tn': [35.1495, -90.049],
  'detroit, mi': [42.3314, -83.0458],
  'new york, ny': [40.7128, -74.006],
  'denver, co': [39.7392, -104.9903],
  'seattle, wa': [47.6062, -122.3321],
  'nashville, tn': [36.1627, -86.7816],
  'indianapolis, in': [39.7684, -86.1581],
  'columbus, oh': [39.9612, -82.9988],
  'charlotte, nc': [35.2271, -80.8431],
  'jacksonville, fl': [30.3322, -81.6557],
  'san antonio, tx': [29.4241, -98.4936],
  'kansas city, mo': [39.0997, -94.5786],
  'st. louis, mo': [38.627, -90.1994],
  'salt lake city, ut': [40.7608, -111.891],
  'portland, or': [45.5152, -122.6784],
  'minneapolis, mn': [44.9778, -93.265],
  'oklahoma city, ok': [35.4676, -97.5164],
  'el paso, tx': [31.7619, -106.485],
  'laredo, tx': [27.5036, -99.5076],
}

function getCoords(city: string): [number, number] | null {
  const key = city.toLowerCase().trim()
  const direct = CITY_COORDS[key]
  if (direct) return direct
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    const cityPart = name.split(',')[0]
    if (cityPart && key.includes(cityPart)) return coords
  }
  return null
}

const STATUS_COLORS: Record<string, string> = {
  available: '#6b7280',
  in_negotiation: '#eab308',
  booked: '#10b981',
  expired: '#9ca3af',
}

interface LoadMapProps {
  loads: LoadPoint[]
}

export function LoadMap({ loads }: LoadMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    mapInstance.current = L.map(mapRef.current).setView([39.8283, -98.5795], 4)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(mapInstance.current)

    return () => {
      mapInstance.current?.remove()
      mapInstance.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    map.eachLayer((layer) => {
      if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        map.removeLayer(layer)
      }
    })

    for (const load of loads) {
      const originCoords = getCoords(load.origin)
      const destCoords = getCoords(load.destination)
      if (!originCoords || !destCoords) continue

      const color = STATUS_COLORS[load.status] ?? '#6b7280'

      const midLat = (originCoords[0] + destCoords[0]) / 2
      const midLng = (originCoords[1] + destCoords[1]) / 2
      const offset = Math.abs(originCoords[1] - destCoords[1]) * 0.15
      const arcMid: [number, number] = [midLat + offset, midLng]

      L.polyline([originCoords, arcMid, destCoords], {
        color,
        weight: 2.5,
        opacity: 0.7,
        smoothFactor: 2,
      })
        .bindPopup(
          `<strong>${load.load_id}</strong><br/>${load.origin} → ${load.destination}<br/>$${load.loadboard_rate} | ${load.status}`,
        )
        .addTo(map)

      L.circleMarker(originCoords, {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: 0.8,
      }).addTo(map)

      L.circleMarker(destCoords, {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: 0.8,
      }).addTo(map)
    }
  }, [loads])

  return (
    <div
      ref={mapRef}
      className="h-[500px] w-full rounded-xl border border-gray-200 dark:border-gray-800"
    />
  )
}
