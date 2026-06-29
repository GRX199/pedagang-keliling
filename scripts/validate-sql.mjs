import { readFile } from 'node:fs/promises'
import { parse } from 'pgsql-parser'

const migrationFiles = [
  'supabase/schema.sql',
  'supabase/phase1-foundation.sql',
  'supabase/admin-foundation.sql',
  'supabase/production-hardening.sql',
]

for (const file of migrationFiles) {
  const sql = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  await parse(sql)
  console.log(`SQL valid: ${file}`)
}
