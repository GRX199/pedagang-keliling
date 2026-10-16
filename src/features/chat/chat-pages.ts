import { supabase } from '../../shared/lib/supabase'
import {
  dateCursorFilter,
  pageOf,
  type DateCursor
} from '../../shared/lib/keyset'
import type { Message } from '../../types/domain.types'

export const MESSAGE_PAGE_SIZE = 40
export async function fetchMessagePage(
  chatId: string,
  cursor: DateCursor | null,
  direction: 'before' | 'after',
  signal: AbortSignal
) {
  let request = supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: direction === 'after' })
    .order('id', { ascending: direction === 'after' })
    .limit(MESSAGE_PAGE_SIZE + 1)
  if (cursor) request = request.or(dateCursorFilter(cursor, direction))
  const { data, error } = await request.abortSignal(signal)
  if (error) throw error
  return pageOf<Message>(data, MESSAGE_PAGE_SIZE)
}
export type MessagePage = Awaited<ReturnType<typeof fetchMessagePage>>
export type MessageUpdates = {
  messages: Message[]
  through: DateCursor | null
  catchingUp: boolean
}
