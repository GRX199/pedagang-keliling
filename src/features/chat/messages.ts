import type { Message } from '../../types/domain.types'
import { compareCreatedRows } from '../../shared/lib/keyset'

const IMAGE_MESSAGE_PREFIX = '[kelilingku:image] '

export function buildImageMessageText(url: string, caption = '') {
  return `${IMAGE_MESSAGE_PREFIX}${JSON.stringify({ url, caption: caption.trim() })}`
}

export function parseImageMessageText(text: string | null) {
  if (!text?.startsWith(IMAGE_MESSAGE_PREFIX)) return null
  try {
    const payload: unknown = JSON.parse(text.slice(IMAGE_MESSAGE_PREFIX.length))
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('url' in payload) ||
      typeof payload.url !== 'string'
    )
      return null
    const url = new URL(payload.url)
    if (!['https:', 'http:'].includes(url.protocol)) return null
    const caption =
      'caption' in payload && typeof payload.caption === 'string' ? payload.caption.trim() : ''
    return { url: url.toString(), caption }
  } catch {
    return null
  }
}

export function mergeMessages(current: readonly Message[], incoming: readonly Message[]) {
  const rows = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) rows.set(message.id, message)
  return [...rows.values()].sort(compareCreatedRows)
}

export function formatChatTimestamp(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const time = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} ${time}`
}
