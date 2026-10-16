import { useEffect, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export function useChatVisibility(
  elementRef: RefObject<HTMLElement>,
  viewerId: string,
  chatId: string,
  loaded: boolean,
) {
  const client = useQueryClient()
  useEffect(() => {
    const element = elementRef.current
    if (!element || !viewerId || !chatId || !loaded) return
    const key = ['visible-chat', viewerId]
    let intersecting = false
    const clear = () => {
      if (client.getQueryData(key) === chatId) client.setQueryData(key, null)
    }
    const publish = () => {
      if (intersecting && document.visibilityState === 'visible')
        client.setQueryData(key, chatId)
      else clear()
    }
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting
      publish()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', publish)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', publish)
      clear()
    }
  }, [chatId, client, elementRef, loaded, viewerId])
}
