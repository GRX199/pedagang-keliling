import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Explicit asset imports let Vite resolve default markers in production bundles.
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })
export default L
