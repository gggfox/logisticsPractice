# Inbound Carrier Sales Automation

Automated inbound carrier call handling for freight brokerages, powered by a [Voice AI](https://happyrobot.ai).

## What It Does

Carriers call in to request loads. The AI agent verifies their MC number via FMCSA, searches available loads, pitches matching freight, and negotiates pricing -- all automatically. A real-time dashboard gives operations teams full visibility into call outcomes, carrier sentiment, and negotiation analytics.

## Architecture

```
Carrier --> Voice AI --> Bridge API (Motia) --> Convex DB --> React Dashboard
                                        |
                                    FMCSA API
```

- **Bridge API**: Motia-powered REST endpoints that the Voice AI calls during live conversations
- **Dashboard**: React + Tremor + Recharts with real-time Convex subscriptions
- **Infrastructure**: Docker + Dokploy (Hostinger VPS) + GitHub Actions CI

## Quick Start

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Fill in: BRIDGE_API_KEY, FMCSA_WEB_KEY, CONVEX_URL, etc.

# Seed demo data
npx tsx scripts/seed.ts

# Development
pnpm dev          # Start API + Dashboard
pnpm test         # Unit tests
pnpm typecheck    # TypeScript checks
pnpm check        # Biome lint + format

# Docker
docker compose up
```

## Project Structure

```
apps/
  api/              Motia backend (Bridge API + webhooks + event processing)
  dashboard/        React analytics dashboard
packages/
  shared/           Zod schemas, TypeScript types, constants
  convex/           Database schema, queries, mutations
infra/              Deployment notes (Dokploy on Hostinger VPS)
scripts/            Seed data generator
docs/               Voice AI setup, Dokploy setup, client document
```

## Bridge API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/loads` | Search loads by origin, destination, equipment |
| GET | `/api/v1/loads/:id` | Get load details |
| GET | `/api/v1/carriers/:mc` | Verify carrier via FMCSA |
| POST | `/api/v1/offers` | Log negotiation offer |
| POST | `/api/v1/webhooks/call-completed` | Voice AI call webhook |
| GET | `/api/v1/health` | Health check |

All endpoints require `x-api-key` header (except health check).

## Testing

```bash
pnpm test                              # All unit tests
cd apps/dashboard && pnpm test:e2e     # Playwright E2E
```

## Deployment

The API and Dashboard both run on a [Hostinger](https://www.hostinger.com/) VPS managed by [Dokploy](https://dokploy.com/). Two Dokploy applications point at this repo:

- `api`       -> [apps/api/Dockerfile](apps/api/Dockerfile)       -> `https://api.<yourdomain>`
- `dashboard` -> [apps/dashboard/Dockerfile](apps/dashboard/Dockerfile) -> `https://dashboard.<yourdomain>`

Pushes to `main` trigger Dokploy's GitHub webhook, which rebuilds and redeploys both containers. Traefik (built into Dokploy) terminates TLS via Let's Encrypt.

See the full step-by-step walkthrough in [docs/dokploy-setup.md](docs/dokploy-setup.md).

## Documentation

- [Dokploy Setup Guide](docs/dokploy-setup.md)
- [Voice AI Setup Guide](docs/happyrobot-setup.md)
- [Acme Logistics Solution Document](docs/acme-logistics-solution.md)
