import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { query } from '../lib/db.js'

const adminEmail = 'admin@example.com'
const adminPass = 'Admin@123456'

const { rows } = await query('select 1 from users where email=$1', [adminEmail])
if (!rows.length) {
  const id = crypto.randomUUID()
  const hash = await bcrypt.hash(adminPass, 10)
  await query('insert into users (id, email, password_hash, name, role) values ($1,$2,$3,$4,$5)', [id, adminEmail, hash, 'Admin', 'super_admin'])
  console.log('Seeded admin:', adminEmail, adminPass)
} else {
  console.log('Admin already exists')
}

// sample client/location/post
const clientId = crypto.randomUUID()
await query('insert into clients (id, name, status) values ($1,$2,$3) on conflict do nothing', [clientId, 'Acme Plumbing', 'active'])
const locId = crypto.randomUUID()
await query('insert into locations (id, client_id, google_location_id, name, time_zone, status) values ($1,$2,$3,$4,$5,$6) on conflict do nothing',
  [locId, clientId, 'g:mock:123', 'Acme Main', 'America/Chicago', 'active']
)
const postId = crypto.randomUUID()
await query('insert into posts (id, client_id, location_id, type, title, body, status) values ($1,$2,$3,$4,$5,$6,$7)',
  [postId, clientId, locId, 'update', 'Welcome', 'Grand opening soon.', 'draft']
)
console.log('Seed complete:')
console.log(' clientId =', clientId)
console.log(' locationId =', locId)
console.log(' postId =', postId)
process.exit(0)
