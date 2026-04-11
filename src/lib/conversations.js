import { supabase } from './supabase'

export async function findOrCreateDirectChat(userId, partnerId) {
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

  if (createError) throw createError
  return createdChat
}

export async function sendChatMessage(chatId, fromUser, text) {
  if (!chatId || !fromUser || !String(text || '').trim()) {
    throw new Error('Pesan tidak valid')
  }

  const payload = {
    chat_id: chatId,
    from_user: fromUser,
    text: String(text).trim(),
  }

  const { error } = await supabase.from('messages').insert([payload])
  if (error) throw error

  await supabase
    .from('chats')
    .update({ last_updated: new Date().toISOString() })
    .eq('id', chatId)
}
