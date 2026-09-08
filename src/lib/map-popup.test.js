import { describe, expect, it } from 'vitest'
import { escapeMapText } from './map-popup'

describe('tracking popup text', () => {
  it('renders injected markup as text instead of executable HTML', () => {
    expect(escapeMapText('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(escapeMapText('Rumah A & B')).toBe('Rumah A &amp; B')
  })
  it('handles missing locations', () => {
    expect(escapeMapText(null)).toBe('')
    expect(escapeMapText(undefined)).toBe('')
  })
})
