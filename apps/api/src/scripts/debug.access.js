import 'dotenv/config'
import { ensureAccessToken } from '../integrations/google.store.js'

const uid = process.argv[2]
if (!uid) {
  console.error('Usage: node apps/api/src/scripts/debug.access.js <user_id>')
  process.exit(1)
}

const main = async () => {
  const t = await ensureAccessToken(uid)
  console.log(JSON.stringify(t, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
