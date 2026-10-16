export function isPostgresReplicationReady(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'extension' in payload &&
    payload.extension === 'postgres_changes' &&
    'status' in payload &&
    payload.status === 'ok'
  )
}
