import { expect, it } from 'vitest'
import { isPostgresReplicationReady } from './realtime'

it('distinguishes a ready Postgres listener from a joined socket or an error', () => {
  expect(
    isPostgresReplicationReady({ extension: 'postgres_changes', status: 'ok' }),
  ).toBe(true)
  for (const payload of [
    null,
    undefined,
    'SUBSCRIBED',
    {},
    { extension: 'system', status: 'ok' },
    { extension: 'postgres_changes', status: 'error' },
  ]) {
    expect(isPostgresReplicationReady(payload)).toBe(false)
  }
})
