import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { query } from '../lib/db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dir = path.join(__dirname, '../../migrations')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

await query('create table if not exists schema_migrations (filename text primary key, executed_at timestamptz not null default now())')

for (const f of files) {
  const { rows } = await query('select 1 from schema_migrations where filename=$1', [f])
  if (rows.length) continue
  const sql = fs.readFileSync(path.join(dir, f), 'utf8')
  console.log('Applying', f)
  await query(sql)
  await query('insert into schema_migrations(filename) values ($1)', [f])
}

console.log('Migrations complete')
process.exit(0)
