import { describe, expect, it } from 'vitest'
import { compareCreatedRows, dateCursorFilter, literalSearch, pageOf } from './keyset'

describe('stable bounded pagination', () => {
  const cursor = { id: 'a', created_at: '2026-10-17T00:00:00.123456+00:00' }
  it('keeps PostgreSQL timestamp precision and breaks ties with the id', () => {
    expect(dateCursorFilter(cursor)).toBe(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.a)`)
    expect(dateCursorFilter(cursor, 'after')).toContain('id.gt.a')
  })
  it('uses one lookahead row without skipping it on the next page', () => {
    const rows = Array.from({ length: 21 }, (_, id) => ({ ...cursor, id: String(id) }))
    const first = pageOf(rows, 20)
    expect(first.items).toHaveLength(20)
    expect(first.next?.id).toBe('19')
    expect(pageOf(rows.slice(20), 20).next).toBeNull()
    expect(pageOf([], 20)).toEqual({ items: [], next: null })
  })
  it('sorts PostgreSQL sub-millisecond timestamps before falling back to id', () => {
    const earlier = { id: 'z', created_at: '2026-10-17T00:00:00.123001+00:00' }
    const later = { id: 'a', created_at: '2026-10-17T00:00:00.123999+00:00' }
    expect(compareCreatedRows(earlier, later)).toBeLessThan(0)
    expect(compareCreatedRows({ ...earlier, id: 'a' }, earlier)).toBeLessThan(0)
  })
  it('quotes filter grammar and escapes wildcard searches rather than injecting filters', () => {
    expect(literalSearch(' a,b)"%_*\\ ')).toBe('"%a,b)\\"\\%\\_\\*\\\\%"')
    expect(literalSearch('x'.repeat(200))).toHaveLength(124)
  })
})
