import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  MapPin,
  ClipboardList,
  MessageCircle,
  Package,
  UserRound,
  ShieldCheck,
  ChevronDown,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../features/auth/AuthProvider'
import { useToast } from './ToastProvider'
import { supabase } from '../lib/supabase'
import {
  getFriendlyFetchErrorMessage,
  requireServerOrigin,
} from '../../lib/network'
import { useRealtimeNotifications } from '../../features/notifications/useNotifications'
import { errorMessage } from '../lib/utils'
type NavItem = { to: string; label: string; count: number; active: boolean }

export default function AppNavigation() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAccountMenuOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!accountMenuOpen) return undefined

    function handlePointerDown(event: PointerEvent) {
      if (!accountMenuRef.current) return
      if (
        event.target instanceof Node &&
        accountMenuRef.current.contains(event.target)
      )
        return
      setAccountMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [accountMenuOpen])

  async function setVendorOfflineBeforeLogout() {
    if (role !== 'vendor' || !user?.id) return

    try {
      const { data } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token
      if (!accessToken) throw new Error('Sesi login tidak ditemukan')

      const serverOrigin = requireServerOrigin()
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 4500)
      let response
      try {
        response = await fetch(`${serverOrigin}/api/vendor/${user.id}/online`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ online: false }),
          signal: controller.signal,
        })
      } finally {
        window.clearTimeout(timeoutId)
      }

      const payload = await response.json().catch(() => ({}))
      if (!response.ok)
        throw new Error(payload?.error || `HTTP ${response.status}`)
    } catch (error) {
      console.warn('setVendorOfflineBeforeLogout.backend', error)
      try {
        const { error: updateError } = await supabase
          .from('vendors')
          .update({ online: false, location: null, last_seen_at: null })
          .eq('id', user.id)

        if (updateError) throw updateError
      } catch (fallbackError) {
        console.warn('setVendorOfflineBeforeLogout.fallback', fallbackError)
        toast.push(
          getFriendlyFetchErrorMessage(
            error,
            'Anda berhasil logout, tetapi status toko mungkin belum sempat diubah ke offline.',
          ),
          { type: 'warning' },
        )
      }
    }
  }

  async function handleLogout() {
    if (logoutBusy) return
    setLogoutBusy(true)
    setAccountMenuOpen(false)

    try {
      await setVendorOfflineBeforeLogout()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      navigate('/login', { replace: true })
    } catch (e) {
      console.error('Logout error', e)
      toast.push(errorMessage(e, 'Gagal logout. Coba lagi.'), { type: 'error' })
    } finally {
      setLogoutBusy(false)
    }
  }

  const avatarUrl = user?.user_metadata?.avatar_url
  const notificationCounts = useRealtimeNotifications({
    user,
    role,
    pathname: location.pathname,
    search: location.search,
    toast,
  })

  const isAdmin = role === 'admin'
  const isVendor = !isAdmin && role === 'vendor'
  const accountLabel = isAdmin
    ? 'Admin aktif'
    : isVendor
      ? 'Pedagang aktif'
      : 'Pelanggan aktif'
  const currentTab = new URLSearchParams(location.search).get('tab')
  const effectiveTab =
    currentTab || (isAdmin ? 'admin' : isVendor ? 'products' : 'orders')

  const navItems: NavItem[] = user
    ? isAdmin
      ? [
          {
            to: '/dashboard?tab=admin',
            label: 'Admin',
            count: 0,
            active:
              location.pathname === '/dashboard' && effectiveTab === 'admin',
          },
          {
            to: '/map',
            label: 'Peta',
            count: 0,
            active: location.pathname === '/map',
          },
          {
            to: '/dashboard?tab=profile',
            label: 'Profil',
            count: 0,
            active:
              location.pathname === '/dashboard' && effectiveTab === 'profile',
          },
        ]
      : isVendor
        ? [
            {
              to: '/map',
              label: 'Peta',
              count: 0,
              active: location.pathname === '/map',
            },
            {
              to: '/dashboard?tab=orders',
              label: 'Pesanan',
              count: notificationCounts.orders,
              active:
                location.pathname === '/dashboard' && effectiveTab === 'orders',
            },
            {
              to: '/chat',
              label: 'Chat',
              count: notificationCounts.messages,
              active: location.pathname.startsWith('/chat'),
            },
            {
              to: '/dashboard?tab=products',
              label: 'Produk',
              count: 0,
              active:
                location.pathname === '/dashboard' &&
                effectiveTab === 'products',
            },
            {
              to: '/dashboard?tab=profile',
              label: 'Profil',
              count: 0,
              active:
                location.pathname === '/dashboard' &&
                effectiveTab === 'profile',
            },
          ]
        : [
            {
              to: '/map',
              label: 'Peta',
              count: 0,
              active: location.pathname === '/map',
            },
            {
              to: '/dashboard?tab=orders',
              label: 'Pesanan',
              count: notificationCounts.orders,
              active:
                location.pathname === '/dashboard' && effectiveTab === 'orders',
            },
            {
              to: '/chat',
              label: 'Chat',
              count: notificationCounts.messages,
              active: location.pathname.startsWith('/chat'),
            },
            {
              to: '/dashboard?tab=profile',
              label: 'Profil',
              count: 0,
              active:
                location.pathname === '/dashboard' &&
                effectiveTab === 'profile',
            },
          ]
    : []

  const mobileNavItems = isVendor
    ? navItems.filter((item) => item.label !== 'Profil')
    : navItems

  function NavIcon({ label }: { label: string }) {
    const icons: Record<string, LucideIcon> = {
      Peta: MapPin,
      Pesanan: ClipboardList,
      Chat: MessageCircle,
      Produk: Package,
      Profil: UserRound,
      Admin: ShieldCheck,
    }
    const Icon = icons[label] || UserRound
    return <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
  }

  function renderDesktopNavItem(item: NavItem) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={`rounded-full px-3 py-2 text-sm font-medium transition ${
          item.active
            ? 'bg-slate-900 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <span>{item.label}</span>
          {item.count > 0 && (
            <span
              className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                item.active
                  ? 'bg-white/15 text-white'
                  : 'bg-rose-500 text-white'
              }`}
            >
              {item.count}
            </span>
          )}
        </span>
      </NavLink>
    )
  }

  return (
    <>
      <header className="sticky top-0 z-[1300] border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex items-center gap-4">
              <Link
                to={user ? (isAdmin ? '/dashboard?tab=admin' : '/map') : '/'}
                className="inline-flex min-w-0 items-center gap-3"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
                  K
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                    Kelilingku
                  </span>
                  <span className="hidden text-xs text-slate-500 lg:block">
                    Belanja sekitar, langsung terhubung
                  </span>
                </span>
              </Link>

              {user && (
                <nav className="hidden gap-2 lg:flex">
                  {navItems.map((item) => renderDesktopNavItem(item))}
                </nav>
              )}
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {user ? (
                <div ref={accountMenuRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    onClick={() => setAccountMenuOpen((current) => !current)}
                    className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-slate-200 bg-white p-1 pr-1 transition hover:bg-slate-50 sm:pr-3"
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="avatar"
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                        {
                          (user.user_metadata?.full_name ||
                            user.email ||
                            'U')[0]
                        }
                      </span>
                    )}
                    <span className="hidden min-w-0 text-left sm:block">
                      <span className="block max-w-36 truncate text-sm font-medium text-slate-800">
                        {user.user_metadata?.full_name || user.email}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className="hidden h-4 w-4 text-slate-400 sm:block"
                    />
                  </button>

                  {accountMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-[1700] mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10"
                    >
                      <div className="border-b border-slate-100 px-3 py-2">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {user.user_metadata?.full_name || user.email}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {accountLabel}
                        </div>
                      </div>
                      <Link
                        to="/dashboard?tab=profile"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        <NavIcon label="Profil" />
                        Profil & pengaturan
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={logoutBusy}
                        onClick={() => void handleLogout()}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <LogOut aria-hidden="true" className="h-5 w-5" />
                        {logoutBusy ? 'Keluar...' : 'Keluar'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <a
                    href="/#cara-kerja"
                    className="hidden rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 sm:inline-flex"
                  >
                    Cara Kerja
                  </a>
                  <Link
                    to="/login"
                    className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <span className="sm:hidden">Masuk</span>
                    <span className="hidden sm:inline">Login / Daftar</span>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {user && (
        <nav className="fixed inset-x-3 bottom-3 z-[1200] lg:hidden">
          <div
            className="grid rounded-[22px] border border-slate-200/80 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur"
            style={{
              gridTemplateColumns: `repeat(${mobileNavItems.length || 1}, minmax(0, 1fr))`,
            }}
          >
            {mobileNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className={`relative min-w-0 rounded-[16px] px-1 py-2 text-center text-[11px] font-medium transition ${
                  item.active
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex flex-col items-center gap-1">
                  <NavIcon label={item.label} />
                  <span className="max-w-full truncate">{item.label}</span>
                  {item.count > 0 ? (
                    <span
                      className={`absolute right-[22%] top-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 py-0.5 text-[9px] font-semibold ${
                        item.active
                          ? 'bg-white/15 text-white'
                          : 'bg-rose-500 text-white'
                      }`}
                    >
                      {item.count}
                    </span>
                  ) : null}
                </span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </>
  )
}
