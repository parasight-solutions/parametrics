import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '5050', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev',
  databaseUrl: process.env.DATABASE_URL || 'postgres://dev:dev@localhost:5432/gbp_automator',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  encKeyB64: process.env.ENCRYPTION_KEY_BASE64 || '',
  defaultTz: process.env.DEFAULT_TZ || 'UTC',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(s => s.trim())
}
