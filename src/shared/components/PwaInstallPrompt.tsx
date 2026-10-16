import { useEffect, useRef, useState } from 'react'
import { isStandaloneApp } from '../../lib/pwa'
import type { Role } from '../../types/domain.types'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'kelilingku:pwa-install-dismissed'
function saveDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* The prompt still closes when storage is unavailable. */
  }
}

export default function PwaInstallPrompt({ role }: { role: Role | null }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  )
  const [installing, setInstalling] = useState(false)
  const installLock = useRef(false)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (isStandaloneApp()) return undefined

    function handleBeforeInstallPrompt(event: Event) {
      if (
        !('prompt' in event) ||
        typeof event.prompt !== 'function' ||
        !('userChoice' in event)
      )
        return
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }

    function handleAppInstalled() {
      setInstallPrompt(null)
      saveDismissed()
      setDismissed(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      )
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  if (role !== 'vendor' || dismissed || !installPrompt) return null

  async function handleInstall() {
    if (!installPrompt || installLock.current) return
    installLock.current = true
    setInstalling(true)
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice?.outcome === 'accepted') {
        setInstallPrompt(null)
        saveDismissed()
        setDismissed(true)
      }
    } catch (error) {
      console.warn('handlePwaInstall', error)
    } finally {
      setInstallPrompt(null)
      setInstalling(false)
      installLock.current = false
    }
  }

  function handleDismiss() {
    saveDismissed()
    setDismissed(true)
  }

  return (
    <div className="fixed inset-x-3 bottom-24 z-[1250] md:bottom-5">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-[22px] border border-emerald-200 bg-white/95 p-3 shadow-2xl shadow-slate-900/15 backdrop-blur">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-950 text-sm font-bold text-white">
          K
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-950">
            Install Kelilingku
          </div>
          <div className="text-xs leading-snug text-slate-500">
            Lebih cepat dibuka saat berdagang dan terasa seperti aplikasi HP.
          </div>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
        >
          {installing ? 'Memasang...' : 'Install'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-full px-2 py-2 text-xs font-semibold text-slate-500"
          aria-label="Tutup prompt install"
        >
          Nanti
        </button>
      </div>
    </div>
  )
}
