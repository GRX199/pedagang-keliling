export type DateCursor = { created_at: string; id: string }

export function compareCreatedRows(left: DateCursor, right: DateCursor) {
  const microseconds = (value: string) =>
    Date.parse(value) * 1000 +
    Number((value.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0').slice(3, 6))
  return (
    microseconds(left.created_at) - microseconds(right.created_at) ||
    left.id.localeCompare(right.id)
  )
}

export function dateCursorFilter(
  cursor: DateCursor,
  direction: 'before' | 'after' = 'before'
) {
  const operator = direction === 'before' ? 'lt' : 'gt'
  return `created_at.${operator}.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.${operator}.${cursor.id})`
}

export function literalSearch(value: string) {
  const escaped = value
    .trim()
    .slice(0, 120)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll('*', '\\*')
  return `"%${escaped}%"`
}

export function pageOf<T extends DateCursor>(rows: T[], size: number) {
  const items = rows.slice(0, size)
  const last = items.at(-1)
  return {
    items,
    next:
      rows.length > size && last
        ? { created_at: last.created_at, id: last.id }
        : null
  }
}
