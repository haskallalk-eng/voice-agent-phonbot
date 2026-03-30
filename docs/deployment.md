# Deployment Guide

## Prerequisites

- Docker + Docker Compose
- A domain pointing to your server
- Retell AI account + API key
- Stripe account (test or live keys)
- Resend account + verified domain

## Quick Start (Docker)

1. Clone the repo and copy env:
   ```bash
   cp .env.example .env
   # Edit .env with your actual keys
   ```

2. Start everything:
   ```bash
   cd infra/docker
   DOMAIN=yourdomain.com docker compose up -d
   ```

3. Caddy auto-provisions SSL via Let's Encrypt. Your app is live at `https://yourdomain.com`.

## Services

| Service  | Internal Port | Description                     |
|----------|---------------|---------------------------------|
| api      | 3001          | Fastify API server              |
| web      | 80            | React SPA (nginx)               |
| postgres | 5432          | PostgreSQL 16                   |
| redis    | 6379          | Redis 7 (sessions + traces)     |
| caddy    | 80, 443       | Reverse proxy + auto-SSL        |

## Environment Variables

See `.env.example` for all required variables.

### Required for Production
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Random 64-char hex (`openssl rand -hex 32`)
- `RETELL_API_KEY` — From Retell AI dashboard
- `STRIPE_SECRET_KEY` — From Stripe dashboard
- `STRIPE_WEBHOOK_SECRET` — From `stripe listen` or Stripe dashboard
- `RESEND_API_KEY` — From Resend dashboard
- `APP_URL` — Your frontend URL (e.g. `https://yourdomain.com`)
- `WEBHOOK_BASE_URL` — Public URL for Retell webhooks
- `DOMAIN` — Your domain for Caddy SSL

### Optional
- `OPENAI_API_KEY` — Only needed for web chat (voice works without it via Retell)
- `SENTRY_DSN` — Error tracking
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Calendar integration

## Stripe Setup

1. Create products + prices in Stripe for Starter/Pro/Agency plans
2. Set the price IDs in `.env`
3. Set up webhook endpoint: `https://yourdomain.com/billing/webhook`
4. Events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

## Retell AI Setup

1. After first deploy, go to Dashboard → Agent → Deploy
2. Set webhook URL in Retell dashboard: `https://yourdomain.com/retell/webhook`
3. Tool webhook URLs are auto-configured during deploy

## Resend Setup

1. Verify your domain in Resend
2. Update `EMAIL_FROM` to use your verified domain

## Health Check

```bash
curl https://yourdomain.com/health
# → {"ok":true,"checks":{"db":"ok","redis":"ok"}}
```

## Monitoring

- Health endpoint: `GET /health`
- Sentry (if configured): errors + performance
- Docker logs: `docker compose logs -f api`

## Scaling

The API is stateless (sessions in Redis, data in Postgres). To scale:
1. Run multiple `api` instances behind Caddy
2. Use managed Postgres (e.g. Supabase, Neon, RDS)
3. Use managed Redis (e.g. Upstash, ElastiCache)

## Local Development

```bash
pnpm install
pnpm dev          # starts API + Web in watch mode
```

API runs on `http://localhost:3001`, Web on `http://localhost:5173`.
