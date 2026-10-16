import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent
} from 'react'
import type { User } from '@supabase/supabase-js'
import type { Message } from '../../types/domain.types'
import { useToast } from '../../shared/components/ToastProvider'
import { uploadImageFile } from '../../shared/lib/media'
import { errorMessage } from '../../shared/lib/utils'
import { useChat } from './useChat'
import { buildImageMessageText } from './messages'
import { MessageList } from './MessageList'
import { useChatVisibility } from './useChatVisibility'
import { SyncStatus } from '../../shared/components/SyncStatus'
import { reportError } from '../../shared/lib/error-reporting'

type Props = {
  chatId: string
  currentUser: User
  onMessageActivity?: (chatId: string, message: Message) => void
  paymentProofMode?: boolean
}

export function ChatThread({
  chatId,
  currentUser,
  onMessageActivity,
  paymentProofMode = false
}: Props) {
  const toast = useToast()
  const chat = useChat(chatId, currentUser.id, onMessageActivity)
  const { messages } = chat
  const roomRef = useRef<HTMLDivElement>(null)
  useChatVisibility(roomRef, currentUser.id, chatId, chat.isSuccess)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pendingImage, setPendingImage] = useState<{
    file: File
    previewUrl: string
    name: string
  } | null>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const latestMessageIdRef = useRef<string>()
  const prependRef = useRef<{
    height: number
    top: number
    firstId: string | undefined
  } | null>(null)
  const sendLock = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const list = messageListRef.current
    const latest = messages.at(-1)
    const newOwnMessage =
      latest?.id !== latestMessageIdRef.current &&
      latest?.from_user === currentUser.id
    latestMessageIdRef.current = latest?.id
    if (list && newOwnMessage) {
      prependRef.current = null
      nearBottomRef.current = true
      list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })
    } else if (list && prependRef.current) {
      if (messages[0]?.id === prependRef.current.firstId) return
      list.scrollTop =
        prependRef.current.top + list.scrollHeight - prependRef.current.height
      prependRef.current = null
    } else if (list && nearBottomRef.current) {
      nearBottomRef.current = true
      list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })
    }
  }, [messages, currentUser?.id])

  useEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl)
    }
  }, [pendingImage?.previewUrl])

  async function sendMessage() {
    if (pendingImage) {
      await sendImageMessage()
      return
    }

    if (sendLock.current || !chatId || !currentUser || !text.trim()) return

    sendLock.current = true
    setSending(true)
    try {
      await chat.send(text.trim())
      setText('')
    } catch (error) {
      void reportError(error, 'chat')
      toast.push(errorMessage(error) || 'Gagal mengirim pesan', {
        type: 'error'
      })
    } finally {
      sendLock.current = false
      setSending(false)
    }
  }

  async function sendImageMessage() {
    if (sendLock.current || !chatId || !currentUser || !pendingImage?.file)
      return

    const caption = text.trim()
    sendLock.current = true
    setSending(true)
    setUploadingImage(true)
    try {
      const imageUrl = await uploadImageFile({
        file: pendingImage.file,
        vendorId: currentUser.id,
        folder: 'chat'
      })
      if (!imageUrl) throw new Error('Gagal mendapatkan URL foto')

      await chat.send(buildImageMessageText(imageUrl, caption))
      setText('')
      setPendingImage(null)
      toast.push('Foto berhasil dikirim', { type: 'success' })
    } catch (error) {
      void reportError(error, 'media')
      toast.push(errorMessage(error) || 'Gagal mengirim foto', {
        type: 'error'
      })
    } finally {
      sendLock.current = false
      setUploadingImage(false)
      setSending(false)
    }
  }

  function clearPendingImage() {
    setPendingImage(null)
  }

  function handleImageInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setPendingImage({
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name
    })
  }

  return (
    <div ref={roomRef} className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="mb-1 text-right">
        <SyncStatus
          failed={!!chat.error}
          updatedAt={chat.dataUpdatedAt}
          connection={chat.connection}
          catchingUp={chat.catchingUp}
        />
      </div>
      <div
        ref={messageListRef}
        onLoadCapture={(event) => {
          const list = messageListRef.current
          if (
            list &&
            nearBottomRef.current &&
            event.target instanceof HTMLImageElement
          )
            list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })
        }}
        onScroll={() => {
          const list = messageListRef.current
          if (!list) return
          nearBottomRef.current =
            list.scrollHeight - list.scrollTop - list.clientHeight < 80
        }}
        className="min-h-0 flex-1 space-y-3 overflow-auto rounded-2xl border border-slate-100 bg-slate-50 p-3"
      >
        {chat.error ? (
          <div role="alert" className="text-sm text-rose-700">
            Gagal memuat pesan.{' '}
            <button
              type="button"
              onClick={() => {
                void chat.refetch()
              }}
            >
              Coba lagi
            </button>
          </div>
        ) : null}
        {chat.olderError && (
          <p role="alert" className="text-sm text-amber-800">
            Pesan lama belum dapat dimuat. Coba Pesan sebelumnya lagi.
          </p>
        )}
        {chat.hasOlder && (
          <button
            type="button"
            className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600"
            disabled={chat.fetching}
            onClick={async () => {
              const list = messageListRef.current
              if (!list || chat.fetching) return
              prependRef.current = {
                height: list.scrollHeight,
                top: list.scrollTop,
                firstId: messages[0]?.id
              }
              nearBottomRef.current = false
              const result = await chat.loadOlder()
              if (result.isError) prependRef.current = null
            }}
          >
            {chat.loadingOlder ? 'Memuat...' : 'Pesan sebelumnya'}
          </button>
        )}
        {chat.isPending && !messages.length ? (
          <div role="status" className="text-sm text-slate-500">
            {chat.paused
              ? 'Sambungkan koneksi untuk memuat percakapan.'
              : 'Memuat pesan...'}
          </div>
        ) : (
          <MessageList messages={messages} currentUserId={currentUser.id} />
        )}
      </div>

      {pendingImage ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
              <img
                src={pendingImage.previewUrl}
                alt={pendingImage.name || 'Preview foto'}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">
                Foto siap dikirim
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {pendingImage.name}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Tambahkan caption opsional sebelum kirim.
              </p>
              <button
                type="button"
                onClick={clearPendingImage}
                disabled={sending}
                className="mt-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageInputChange}
        />
        <textarea
          value={text}
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              sendMessage()
            }
          }}
          rows={1}
          className="min-h-[48px] min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm"
          placeholder={pendingImage ? 'Caption opsional...' : 'Ketik pesan...'}
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || !chatId || !currentUser}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 sm:min-w-24"
          >
            {pendingImage ? 'Ganti' : paymentProofMode ? 'Bukti' : 'Foto'}
          </button>
          <button
            onClick={sendMessage}
            disabled={sending || (!text.trim() && !pendingImage)}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400 sm:min-w-24"
          >
            {uploadingImage ? 'Upload...' : sending ? 'Mengirim...' : 'Kirim'}
          </button>
        </div>
      </div>
    </div>
  )
}
