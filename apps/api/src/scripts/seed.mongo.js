import "dotenv/config"
import { col } from '../lib/mongo.js'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

async function main(){
  const users = await col('users')
  const admin = await users.findOne({ email:'admin@example.com' })
  if (!admin) {
    await users.insertOne({
      id: crypto.randomUUID(),
      email: 'admin@example.com',
      password_hash: await bcrypt.hash('Admin@123456', 10),
      role: 'super_admin',
      created_at: new Date(), updated_at: new Date()
    })
    console.log('Seeded admin user -> email: admin@example.com, password: Admin@123456')
  } else {
    console.log('Admin already exists')
  }
}
main().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1) })
