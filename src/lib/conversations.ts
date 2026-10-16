import { supabase } from '../shared/lib/supabase'
import { reportError } from '../shared/lib/error-reporting'

export async function findOrCreateDirectChat(
  userId: string,
  partnerId: string,
) {
  if (!userId || !partnerId || userId === partnerId) {
    throw new Error('Peserta chat tidak valid')
  }

  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .contains('participants', [userId, partnerId])
    .order('last_updated', { ascending: false })
    .limit(1)

  if (error) throw error

  if (data?.[0]) return data[0]

  const payload = {
    participants: [userId, partnerId],
    last_updated: new Date().toISOString(),
  }

  const { data: createdChat, error: createError } = await supabase
    .from('chats')
    .insert([payload])
    .select()
    .single()

  if (createError?.code === '23505') {
    const { data: existingRows, error: existingError } = await supabase
      .from('chats')
      .select('*')
      .contains('participants', [userId, partnerId])
      .order('last_updated', { ascending: false })
      .limit(1)

    if (existingError) throw existingError
    if (existingRows?.[0]) return existingRows[0]
  }

  if (createError) throw createError
  return createdChat
}

export async function sendChatMessage(
  chatId: string,
  fromUser: string,
  text: string,
) {
  if (!chatId || !fromUser || !String(text || '').trim()) {
    throw new Error('Pesan tidak valid')
  }

  const payload = {
    chat_id: chatId,
    from_user: fromUser,
    text: String(text).trim(),
  }

  const { data, error } = await supabase
    .from('messages')
    .insert([payload])
    .select()
    .single()

  if (error) throw error

  const { error: chatError } = await supabase
    .from('chats')
    .update({ last_updated: new Date().toISOString() })
    .eq('id', chatId)

  if (chatError) {
    void reportError(chatError, 'chat')
  }

  return data
}
