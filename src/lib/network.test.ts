import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getServerOrigin,
  requireServerOrigin,
  getGeolocationErrorMessage,
} from './network'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const open = (url: string, dev: boolean) => {
  vi.stubGlobal('window', {
    location: new URL(url),
    isSecureContext: url.startsWith('https:'),
  })
  vi.stubEnv('DEV', dev)
}
describe('backend configuration', () => {
  it('keeps local LAN testing available only in development', () => {
    open('http://192.168.1.4:5173', true)
    vi.stubEnv('VITE_SERVER_URL', 'http://localhost:4000')
    expect(requireServerOrigin()).toBe('http://192.168.1.4:4000')
  })
  it('never rewrites a production localhost backend to the public domain', () => {
    open('https://kelilingku.example', false)
    vi.stubEnv('VITE_SERVER_URL', 'http://localhost:4000')
    expect(getServerOrigin()).toBe('http://localhost:4000')
    expect(requireServerOrigin).toThrow('production masih localhost')
  })
  it('rejects mixed content before sending the request', () => {
    open('https://kelilingku.example', false)
    vi.stubEnv('VITE_SERVER_URL', 'http://api.example')
    expect(requireServerOrigin).toThrow('harus memakai HTTPS')
  })
  it.each(['bad url', 'javascript:alert(1)'])(
    'rejects an invalid endpoint %s',
    (url) => {
      open('https://kelilingku.example', false)
      vi.stubEnv('VITE_SERVER_URL', url)
      expect(requireServerOrigin).toThrow()
    },
  )
  it('requires explicit backend configuration in production', () => {
    open('https://kelilingku.example', false)
    vi.stubEnv('VITE_SERVER_URL', '')
    expect(requireServerOrigin).toThrow('belum dikonfigurasi')
  })
  it('accepts a secure production backend', () => {
    open('https://kelilingku.example', false)
    vi.stubEnv('VITE_SERVER_URL', 'https://api.example/')
    expect(requireServerOrigin()).toBe('https://api.example')
  })
  it('keeps permission-denied and GPS-timeout messages distinct', () => {
    open('https://kelilingku.example', false)
    expect(getGeolocationErrorMessage({ code: 1 })).toContain('ditolak')
    expect(getGeolocationErrorMessage({ code: 3 })).toContain(
      'belum sempat terbaca',
    )
  })
})
