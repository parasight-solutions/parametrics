# GBP Automator — JS-only Express + BullMQ Skeleton

A production-minded, **JavaScript-only** starter for automating Google Business Profile (GBP) tasks with queues and cron.

## Quickstart

```bash
# 0) Infra: Postgres + Redis (dev)
docker compose up -d db redis

# 1) Install deps
npm i

# 2) Env
cp .env.example .env
# (edit values if needed; defaults work for local dev)

# 3) DB migrate + seed
npm run migrate
npm run seed

# 4) Run all: API + Workers + Scheduler
npm run dev
```
- API: http://localhost:5050/api/v1/health
- JWT login (seeded): `admin@example.com / Admin@123456`

### Useful calls (HTTP)
See `http/sample.http` for examples of Health, Login, and Enqueue Publish.
