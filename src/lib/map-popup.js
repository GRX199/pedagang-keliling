// Leaflet treats popup strings as HTML; names and meeting points are user input.
export function escapeMapText(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value ?? '').replace(/[&<>"']/g, (character) => entities[character])
}
