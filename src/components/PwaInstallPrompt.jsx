import { useEffect, useState } from 'react'
import { isStandaloneApp } from '../lib/pwa'

const DISMISS_KEY = 'kelilingku:pwa-install-dismissed'

export default function PwaInstallPrompt({ role }) {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  })

  useEffect(() => {
    if (role !== 'vendor' || isStandaloneApp()) return undefined

    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }

    function handleAppInstalled() {
      setInstallPrompt(null)
      window.localStorage.setItem(DISMISS_KEY, '1')
      setDismissed(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [role])

  if (role !== 'vendor' || dismissed || !installPrompt) return null

  async function handleInstall() {
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice?.outcome === 'accepted') {
        setInstallPrompt(null)
        window.localStorage.setItem(DISMISS_KEY, '1')
        setDismissed(true)
      }
    } catch (error) {
      console.warn('handlePwaInstall', error)
    }
  }

  function handleDismiss() {
    window.localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="fixed inset-x-3 bottom-24 z-[1250] md:bottom-5">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-[22px] border border-emerald-200 bg-white/95 p-3 shadow-2xl shadow-slate-900/15 backdrop-blur">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-950 text-sm font-bold text-white">
          K
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-950">Install Kelilingku</div>
          <div className="text-xs leading-snug text-slate-500">
            Lebih cepat dibuka saat berdagang dan terasa seperti aplikasi HP.
          </div>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
        >
          Install
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
