import { describe, expect, it } from 'vitest'
import type { Message } from '../../types/domain.types'
import { buildImageMessageText, mergeMessages, parseImageMessageText } from './messages'

const message = (id: string, created_at: string): Message => ({
  id,
  created_at,
  chat_id: 'room',
  from_user: 'buyer',
  text: id,
})
describe('chat cache merge', () => {
  it('preserves sends and realtime inserts when an older fetch finishes', () => {
    const early = message('early', '2026-10-15T10:00:00Z')
    const sent = message('sent', '2026-10-15T10:00:01Z')
    expect(mergeMessages([sent], [early]).map((row) => row.id)).toEqual(['early', 'sent'])
  })
  it('deduplicates repeated realtime and polling payloads', () => {
    const row = message('a', '2026-10-15T10:00:00Z')
    expect(mergeMessages([row], [row, { ...row, text: 'latest' }])).toEqual([
      { ...row, text: 'latest' },
    ])
  })
  it('keeps both rows with the same timestamp in deterministic order', () => {
    const a = message('a', '2026-10-15T10:00:00Z')
    const b = message('b', a.created_at)
    expect(mergeMessages([b], [a]).map((row) => row.id)).toEqual(['a', 'b'])
  })
})
describe('chat photo envelope', () => {
  it('does not add an automatic payment-proof caption', () => {
    expect(parseImageMessageText(buildImageMessageText('https://example.test/photo.png'))).toEqual({
      url: 'https://example.test/photo.png',
      caption: '',
    })
  })
  it('trims an optional caption', () => {
    expect(
      parseImageMessageText(
        buildImageMessageText('https://example.test/photo.png', '  Sudah transfer  ')
      )?.caption
    ).toBe('Sudah transfer')
  })
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///private/photo'])(
    'rejects an unsafe URL: %s',
    (url) => {
      expect(parseImageMessageText(buildImageMessageText(url))).toBeNull()
    }
  )
  it.each([
    'plain text',
    '[kelilingku:image] {',
    '[kelilingku:image] null',
    '[kelilingku:image] {"url":2}',
  ])('ignores malformed photo content: %s', (value) => {
    expect(parseImageMessageText(value)).toBeNull()
  })
})
