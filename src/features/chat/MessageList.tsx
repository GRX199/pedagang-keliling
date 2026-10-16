import type { Message } from '../../types/domain.types'
import { parseImageMessageText, formatChatTimestamp } from './messages'

export function MessageList({
  messages,
  currentUserId,
}: {
  messages: Message[]
  currentUserId: string
}) {
  return (
    <>
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Belum ada pesan. Mulai percakapan dari sini.
        </div>
      ) : (
        messages.map((message) => {
          const mine = message.from_user === currentUserId
          const imageMessage = parseImageMessageText(message.text)
          return (
            <div key={message.id} data-message-id={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] overflow-hidden rounded-2xl px-3 py-2 text-sm sm:max-w-[85%] ${
                  mine
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                }`}
              >
                {imageMessage ? (
                  <div className="space-y-2">
                    <a
                      href={imageMessage.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-xl bg-black/10"
                    >
                      <img
                        src={imageMessage.url}
                        alt={imageMessage.caption || 'Foto chat'}
                        loading="lazy"
                        className="max-h-72 w-full object-cover"
                      />
                    </a>
                    {imageMessage.caption ? (
                      <div className="whitespace-pre-wrap break-words">{imageMessage.caption}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{message.text}</div>
                )}
                <div
                  className={`mt-1 break-words text-right text-[11px] ${mine ? 'text-slate-300' : 'text-slate-400'}`}
                >
                  {formatChatTimestamp(message.created_at)}
                </div>
              </div>
            </div>
          )
        })
      )}
    </>
  )
}
