import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Order, Message } from '../../types/domain.types'
import type { Tables } from '../../types/database.types'
import type { Identity } from '../../lib/profiles'
type Chat = Tables<'chats'>
import { useChats, useDirectChat, useRelatedOrders } from './useChats'
import {
  pickFeaturedOrder,
  shouldShowPaymentProofShortcut
} from './order-context'
import { useNavigate } from 'react-router-dom'
import {
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  formatPriceLabel,
  isActiveOrderStatus
} from '../../lib/orders'
import { useAuth } from '../auth/AuthProvider'
import { ArrowLeft } from 'lucide-react'

export { ChatThread } from './ChatRoom'
import { ChatThread } from './ChatRoom'

function getPartnerId(chat: Chat | null, currentUserId: string | undefined) {
  return (
    (chat?.participants || []).find(
      (participant) => participant !== currentUserId
    ) || null
  )
}

function getPartnerLabel(
  chat: Chat | null,
  currentUserId: string | undefined,
  vendorMap: Record<string, Identity>
) {
  const partnerId = getPartnerId(chat, currentUserId)
  if (!partnerId) return 'Percakapan'
  return vendorMap[partnerId]?.name || 'Pengguna'
}

function OrderContextCard({
  currentUser,
  order,
  partnerLabel,
  relatedCount,
  onTrackOrder
}: {
  currentUser: User
  order: Order
  partnerLabel: string
  relatedCount: number
  onTrackOrder: () => void
}) {
  if (!order) return null

  const counterpartName =
    order.vendor_id === currentUser?.id
      ? order.buyer_name || partnerLabel || 'Pelanggan'
      : order.vendor_name || partnerLabel || 'Pedagang'
  const canTrackOrder = isActiveOrderStatus(order.status)

  return (
    <div className="min-w-0 max-w-full shrink-0 overflow-hidden rounded-xl bg-teal-800 p-3 text-white">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold tracking-tight sm:text-base">
              Pesanan #{String(order.id).slice(0, 8)}
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-100">
              {formatOrderStatusLabel(order)}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-slate-300">
            {[
              counterpartName,
              formatPaymentMethodLabel(order.payment_method),
              Number(order.total_amount || 0) > 0
                ? formatPriceLabel(order.total_amount)
                : null,
              relatedCount > 1 ? `${relatedCount} transaksi` : null
            ]
              .filter(Boolean)
              .join(' • ')}
          </div>
        </div>

        {canTrackOrder ? (
          <button
            onClick={onTrackOrder}
            className="shrink-0 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
          >
            {order.service_flow === 'pickup_v1' ? 'Detail' : 'Lacak'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function ChatWorkspace({
  initialVendorId = null,
  initialOrderId = null,
  embedded = false
}: {
  initialVendorId?: string | null
  initialOrderId?: string | null
  embedded?: boolean
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const inboxQuery = useChats(user?.id)
  const { chats, setChats, identities: vendorMap } = inboxQuery
  const directChatQuery = useDirectChat(user?.id, initialVendorId)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const loading = inboxQuery.isPending
  const creatingChat = directChatQuery.isFetching
  const [showInboxMobile, setShowInboxMobile] = useState(true)

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) || null,
    [chats, selectedChatId]
  )
  const selectedPartnerId = useMemo(
    () => getPartnerId(selectedChat, user?.id),
    [selectedChat, user?.id]
  )
  const selectedPartnerLabel = useMemo(
    () => getPartnerLabel(selectedChat, user?.id, vendorMap),
    [selectedChat, user?.id, vendorMap]
  )
  const relatedQuery = useRelatedOrders(user?.id, selectedPartnerId)
  const relatedOrders = relatedQuery.orders
  const loadingRelatedOrders = relatedQuery.isPending && !!selectedPartnerId
  const featuredOrder = useMemo(
    () => pickFeaturedOrder(relatedOrders, initialOrderId),
    [initialOrderId, relatedOrders]
  )
  const paymentProofMode = useMemo(
    () => shouldShowPaymentProofShortcut(featuredOrder, user),
    [featuredOrder, user]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    function handleResize() {
      if (window.innerWidth >= 1024) {
        setShowInboxMobile(true)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    setSelectedChatId((current) => {
      return chats.some((chat) => chat.id === current)
        ? current
        : chats[0]?.id || null
    })
  }, [chats])

  useEffect(() => {
    if (directChatQuery.data?.id) setSelectedChatId(directChatQuery.data.id)
  }, [directChatQuery.data?.id])

  useEffect(() => {
    if (!selectedChatId) {
      setShowInboxMobile(true)
      return
    }

    if (
      initialVendorId &&
      typeof window !== 'undefined' &&
      window.innerWidth < 1024
    ) {
      setShowInboxMobile(false)
    }
  }, [initialVendorId, selectedChatId])

  function selectChat(chatId: string) {
    setSelectedChatId(chatId)
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setShowInboxMobile(false)
    }
  }

  const handleMessageActivity = useCallback(
    (chatId: string, message: Message) => {
      if (!chatId || !message) return

      setChats((current) => {
        const currentIndex = current.findIndex((chat) => chat.id === chatId)
        if (currentIndex === -1) return current

        const nextRows = [...current]
        const [chat] = nextRows.splice(currentIndex, 1)
        nextRows.unshift({
          ...chat,
          last_updated: message.created_at || new Date().toISOString()
        })
        return nextRows
      })
    },
    [setChats]
  )

  return (
    <div
      className={`ui-chat-layout grid min-w-0 max-w-full gap-3 ${embedded ? 'grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]'}`}
    >
      <div
        className={`ui-surface min-h-0 overflow-y-auto p-3 sm:p-4 ${selectedChat && !showInboxMobile ? 'hidden lg:block' : ''}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Chat
            </h2>
            <div className="text-sm text-slate-500">
              {chats.length} percakapan
            </div>
          </div>
        </div>

        {inboxQuery.error || directChatQuery.error ? (
          <div role="alert" className="mb-3 text-sm text-rose-700">
            Gagal memuat percakapan.{' '}
            <button
              type="button"
              onClick={() => {
                void inboxQuery.refetch()
                if (directChatQuery.error) void directChatQuery.refetch()
              }}
            >
              Coba lagi
            </button>
          </div>
        ) : null}
        <div className="space-y-2">
          {loading || creatingChat ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
              Memuat percakapan...
            </div>
          ) : chats.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
              Belum ada percakapan.
            </div>
          ) : (
            chats.map((chat) => {
              const active = chat.id === selectedChatId
              const partnerId = getPartnerId(chat, user?.id)
              const partner = partnerId ? vendorMap[partnerId] : undefined

              return (
                <button
                  key={chat.id}
                  onClick={() => selectChat(chat.id)}
                  className={`flex min-w-0 w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    active
                      ? 'border-teal-700 bg-teal-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-teal-50">
                    {partner?.photo_url ? (
                      <img
                        src={partner.photo_url}
                        alt={partner.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
                        {(partner?.name || 'P')[0]}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">
                      {getPartnerLabel(chat, user?.id, vendorMap)}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {chat.last_updated
                        ? new Date(chat.last_updated).toLocaleString('id-ID')
                        : 'Belum ada aktivitas'}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div
        className={`ui-surface min-h-0 max-w-full flex-col overflow-hidden p-3 sm:p-4 ${selectedChat && !showInboxMobile ? 'flex' : 'hidden lg:flex'}`}
      >
        {selectedChat && user ? (
          <>
            <div className="mb-3 shrink-0 border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowInboxMobile(true)}
                  aria-label="Kembali"
                  className="ui-icon-button lg:hidden"
                >
                  <ArrowLeft aria-hidden="true" className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-900">
                    {selectedPartnerLabel}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
              {loadingRelatedOrders ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Memuat order terkait...
                </div>
              ) : featuredOrder ? (
                <OrderContextCard
                  currentUser={user}
                  order={featuredOrder}
                  partnerLabel={selectedPartnerLabel}
                  relatedCount={relatedOrders.length}
                  onTrackOrder={() => navigate(`/orders/${featuredOrder.id}`)}
                />
              ) : null}

              <div className="min-h-0 flex-1">
                <ChatThread
                  key={`${user.id}:${selectedChat.id}`}
                  chatId={selectedChat.id}
                  currentUser={user}
                  onMessageActivity={handleMessageActivity}
                  paymentProofMode={paymentProofMode}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-500">
            Pilih percakapan untuk mulai chat.
          </div>
        )}
      </div>
    </div>
  )
}
