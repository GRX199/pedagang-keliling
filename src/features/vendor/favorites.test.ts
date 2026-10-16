import { describe, expect, it, vi } from 'vitest'
vi.mock('../../shared/lib/supabase', () => ({ supabase: {} }))
import { updateFavoriteIds } from './useFavorites'

describe('favorite optimistic state', () => {
  it('does not duplicate an existing favorite', () => {
    expect(updateFavoriteIds(['a', 'b'], 'a', true)).toEqual(['a', 'b'])
  })
  it('restores only the failed vendor without erasing another pending change', () => {
    const optimistic = updateFavoriteIds(updateFavoriteIds([], 'a', true), 'b', true)
    expect(updateFavoriteIds(optimistic, 'a', false)).toEqual(['b'])
  })
  it('does not mutate the previous cached list', () => {
    const previous = ['a']
    expect(updateFavoriteIds(previous, 'a', false)).toEqual([])
    expect(previous).toEqual(['a'])
  })
})
