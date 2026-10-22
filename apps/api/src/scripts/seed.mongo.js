import "dotenv/config"
import { col } from '../lib/mongo.js'
import { assertLocalSeedEnvironment, seedLocalAdmin } from '../services/localDevSeed.js'

// Local development only. Usage (password is read from env, never printed):
//   NODE_ENV=development MONGODB_URI=mongodb://127.0.0.1:27017 \
//   SEED_ADMIN_PASSWORD='<12+ chars>' npm run seed:mongo [-- --reset-password]
// Optional SEED_ADMIN_EMAIL (default admin@example.com).

// Checked after env loading (mongo.js may load .env) and before connecting.
try {
  assertLocalSeedEnvironment(process.env)
} catch (e) {
  console.error(`[seed.mongo] refused: ${e.code}: ${e.message}`)
  process.exit(1)
}

async function main(){
  const result = await seedLocalAdmin({
    users: await col('users'),
    resetPassword: process.argv.includes('--reset-password'),
  })
  console.log(`[seed.mongo] local admin ${result.action} (user_id=${result.user_id})`)
}
main().then(()=>process.exit(0)).catch(e=>{ console.error(`[seed.mongo] failed: ${e?.code || 'error'}: ${e?.message || ''}`); process.exit(1) })
