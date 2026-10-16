import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
const offline = readFileSync(new URL('../../public/offline.html', import.meta.url), 'utf8')
const origin = 'https://kelilingku.test'
const cacheName = 'kelilingku-shell-v2'
const key = value => new URL(typeof value === 'string' ? value : value.url, origin).href

function worker() {
  const handlers = new Map()
  const stores = new Map()
  const caches = {
    async keys() { return [...stores.keys()] },
    async delete(name) { return stores.delete(name) },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const rows = stores.get(name)
      return {
        async addAll(urls) { for (const url of urls) rows.set(key(url), new Response(url === '/offline.html' ? offline : 'static')) },
        async match(request) { return rows.get(key(request))?.clone() },
        async put(request, response) { rows.set(key(request), response.clone()) },
        async keys() { return [...rows.keys()].map(url => new Request(url)) },
        async delete(request) { return rows.delete(key(request)) },
      }
    },
  }
  const fetch = vi.fn().mockRejectedValue(new Error('offline'))
  const self = { location: { origin }, addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: vi.fn(), clients: { claim: vi.fn() } }
  runInNewContext(source, { self, caches, fetch, URL, Response })
  async function dispatch(name, request) {
    const tasks = []
    let response
    handlers.get(name)({ request, waitUntil: task => tasks.push(task), respondWith: task => { response = task } })
    const result = await response
    await Promise.all(tasks)
    return result
  }
  const request = (path, options = {}) => ({ url: `${origin}${path}`, method: 'GET', headers: new Headers(), mode: 'cors', cache: 'default', ...options })
  return { caches, stores, fetch, self, dispatch, request }
}

describe('production service worker', () => {
  it('precaches a dependency-free offline screen, not old application HTML', async () => {
    const w = worker()
    await w.dispatch('install')
    const urls = [...w.stores.get(cacheName).keys()]
    expect(urls).toContain(`${origin}/offline.html`)
    expect(urls).not.toContain(`${origin}/`)
    expect(offline).not.toMatch(/<script|\/assets\//)
    expect(w.self.skipWaiting).toHaveBeenCalledOnce()
  })
  it('removes only obsolete Kelilingku caches during activation', async () => {
    const w = worker()
    for (const name of ['another-app', 'kelilingku-shell-v1', cacheName]) await w.caches.open(name)
    await w.dispatch('activate')
    expect(await w.caches.keys()).toEqual(['another-app', cacheName])
    expect(w.self.clients.claim).toHaveBeenCalledOnce()
  })
  it.each([true, false])('returns an honest offline response even with precache=%s', async installed => {
    const w = worker()
    if (installed) await w.dispatch('install')
    const response = await w.dispatch('fetch', w.request('/orders/private', { mode: 'navigate' }))
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toContain('Koneksi terputus')
  })
  it('never caches online navigation or private HTML', async () => {
    const w = worker()
    w.fetch.mockResolvedValueOnce(new Response('private page'))
    const response = await w.dispatch('fetch', w.request('/chat/private', { mode: 'navigate' }))
    expect(await response.text()).toBe('private page')
    expect(await w.caches.keys()).toEqual([])
  })
  it.each([
    ['/api/orders', {}],
    ['/assets/main.js?token=private', {}],
    ['/assets/main.js', { method: 'POST' }],
    ['/assets/main.js', { headers: new Headers({ Authorization: 'Bearer private' }) }],
    ['/assets/main.js', { cache: 'no-store' }],
    ['/assets/main.js', { url: 'https://external.test/assets/main.js' }],
  ])('does not intercept non-public request %s %j', async (path, options) => {
    const w = worker()
    expect(await w.dispatch('fetch', w.request(path, options))).toBeUndefined()
    expect(w.fetch).not.toHaveBeenCalled()
  })
  it('keeps bundled assets available offline without another network request', async () => {
    const w = worker()
    w.fetch.mockResolvedValueOnce(new Response('bundle', { headers: { 'Content-Type': 'text/javascript' } }))
    const request = w.request('/assets/main-hash.js')
    expect(await (await w.dispatch('fetch', request)).text()).toBe('bundle')
    expect(await (await w.dispatch('fetch', request)).text()).toBe('bundle')
    expect(w.fetch).toHaveBeenCalledOnce()
  })
  it.each([
    [200, 'text/html', ''],
    [404, 'text/javascript', ''],
    [200, 'text/javascript', 'no-store'],
  ])('does not cache a wrong/error/private bundle response %i %s %s', async (status, type, policy) => {
    const w = worker()
    w.fetch.mockResolvedValueOnce(new Response('not a reusable bundle', { status, headers: { 'Content-Type': type, 'Cache-Control': policy } }))
    const request = w.request('/assets/main-hash.js')
    await w.dispatch('fetch', request)
    expect(await (await w.caches.open(cacheName)).match(request)).toBeUndefined()
  })
  it('returns a network error, never app HTML, for a missing offline asset', async () => {
    const w = worker()
    expect((await w.dispatch('fetch', w.request('/assets/missing.js'))).type).toBe('error')
  })
  it('refreshes unversioned manifest and falls back to its cache offline', async () => {
    const w = worker()
    const request = w.request('/manifest.webmanifest')
    w.fetch.mockResolvedValueOnce(Response.json({ version: 1 })).mockResolvedValueOnce(Response.json({ version: 2 }))
    await w.dispatch('fetch', request)
    expect(await (await w.dispatch('fetch', request)).json()).toEqual({ version: 2 })
    expect(await (await w.dispatch('fetch', request)).json()).toEqual({ version: 2 })
  })
  it('does not make network assets fail when CacheStorage is unavailable', async () => {
    const w = worker()
    w.caches.open = async () => { throw new Error('storage denied') }
    w.fetch.mockResolvedValueOnce(new Response('online bundle'))
    expect(await (await w.dispatch('fetch', w.request('/assets/main.js'))).text()).toBe('online bundle')
  })
  it('bounds old bundled assets without evicting the offline screen', async () => {
    const w = worker()
    await w.dispatch('install')
    const cache = await w.caches.open(cacheName)
    for (let index = 0; index < 65; index++) await cache.put(`${origin}/assets/chunk-${index}.js`, new Response('old'))
    w.fetch.mockResolvedValueOnce(new Response('new', { headers: { 'Content-Type': 'text/javascript' } }))
    await w.dispatch('fetch', w.request('/assets/new.js'))
    expect((await cache.keys()).filter(entry => new URL(entry.url).pathname.startsWith('/assets/'))).toHaveLength(64)
    expect(await cache.match('/offline.html')).toBeDefined()
  })
})
