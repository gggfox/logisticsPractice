# Acme Logistics: Inbound Carrier Sales Automation

## Executive Summary

This document describes a fully automated inbound carrier sales system built for Acme Logistics using the HappyRobot voice AI platform. The solution replaces manual carrier call handling with an AI-powered agent that verifies carriers, matches them to available loads, negotiates pricing, and books freight -- all in real time, 24/7.

The system processes inbound carrier calls end-to-end: from FMCSA verification through load matching, price negotiation (up to 3 rounds), and call transfer to a sales representative when a deal is reached. Every interaction is recorded, classified, and fed into a real-time analytics dashboard for operational visibility.

---

## System Architecture

```
Carrier (Phone/Web) --> HappyRobot Voice AI Agent
                            |
                    Bridge API (our backend)
                     /      |       \
              FMCSA API   Convex DB   Webhooks
                            |
                     React Dashboard
                  (real-time analytics)
```

**Core Components:**

- **HappyRobot Voice Agent**: Handles live carrier conversations using registered API tools
- **Bridge API (Motia)**: RESTful endpoints that HappyRobot calls during conversations to verify carriers, search loads, and process negotiations
- **Convex Database**: Real-time document database with live subscriptions powering the dashboard
- **Analytics Dashboard**: React-based command center showing KPIs, call history, load board, carrier intelligence, and negotiation analytics

---

## Feature Walkthrough

### 1. Carrier Verification

When a carrier calls in, the AI agent asks for their MC number and verifies eligibility in real time via the FMCSA QCMobile API. The system checks:

- Operating authority status (must be "AUTHORIZED")
- Out-of-service orders
- Active OOS dates

Results are cached for 24 hours to reduce external API calls. Ineligible carriers are informed and the call ends gracefully.

### 2. Load Matching

Verified carriers describe their preferred lanes. The system searches available loads by origin, destination, and equipment type with fuzzy city/state matching. Results are sorted by pickup date proximity and presented to the carrier with full details: rate, dates, weight, miles, and commodity.

### 3. Automated Negotiation

If the carrier makes a counter-offer below the posted rate:

- The system evaluates the offer against a configurable acceptance margin (default: 5% below loadboard rate)
- If within margin, the offer is accepted immediately
- If below margin, a counter-offer is calculated using an escalating concession strategy
- Up to 3 negotiation rounds are supported
- Each round is logged for analytics and strategy optimization

### 4. Call Classification and Sentiment Analysis

After each call completes, the system automatically:

- Classifies the outcome (booked, declined, no match, transferred, dropped)
- Analyzes carrier sentiment from the transcript (positive, neutral, negative, frustrated)
- Records all data for the analytics dashboard

### 5. Real-Time Analytics Dashboard

The dashboard provides six views with live data:

| View | Purpose |
|------|---------|
| **Overview** | KPI cards, call volume trends, outcome distribution, sentiment breakdown |
| **Live Feed** | Real-time scrolling feed of active and recent calls |
| **Call History** | Filterable table with transcript access and CSV export |
| **Load Board** | Active loads with geographic map visualization |
| **Carrier Intelligence** | Carrier verification status, call history, booking rates |
| **Negotiation Analytics** | Round distribution, acceptance rates, rate comparison charts |

All views update in real time via Convex database subscriptions -- no polling, no manual refresh.

---

## Security Posture

| Layer | Implementation |
|-------|---------------|
| **Transport** | HTTPS enforced (Railway automatic TLS / Let's Encrypt) |
| **API Authentication** | API key required on all endpoints (`x-api-key` header) |
| **Webhook Integrity** | HMAC-SHA256 signature verification on all incoming webhooks |
| **Rate Limiting** | Sliding window limiter (100 req/min per API key) |
| **Secret Management** | All credentials in environment variables, never in code |
| **CORS** | Restricted to dashboard origin only |
| **Container Security** | Non-root user in Docker, minimal Alpine image (~80MB) |

---

## Infrastructure and Deployment

- **Containerization**: Multi-stage Docker build producing a minimal production image
- **Cloud Hosting**: Railway (automatic HTTPS, Docker deployment, usage-based billing)
- **Infrastructure as Code**: Terraform configuration for reproducible deployments
- **CI/CD**: GitHub Actions pipeline with lint, typecheck, unit tests, E2E tests, and automated deployment
- **Database**: Convex (managed, serverless, ACID-compliant, real-time subscriptions)

### Deployment Cost Estimate

| Component | Monthly Cost |
|-----------|-------------|
| Railway API service | ~$5-10 |
| Convex (free tier) | $0 |
| Dashboard hosting | $0 (Vercel free tier or Railway) |
| **Total** | **~$5-10/month** |

---

## Scaling Considerations

The architecture is designed to scale with Acme Logistics' growth:

- **Motia's event-driven steps** decouple call processing from API response times
- **Convex** handles concurrent real-time subscriptions across multiple dashboard users
- **Hourly metric aggregation** ensures dashboard performance remains constant regardless of call volume
- **Carrier cache** reduces FMCSA API dependency from every call to once per carrier per day
- **Terraform modules** are portable to AWS ECS Fargate if Railway capacity is exceeded

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Voice AI | HappyRobot | Purpose-built for freight, Bridge API integration |
| Backend | Motia (Node.js) | Event-driven steps, built-in observability, trace propagation |
| Database | Convex | Real-time subscriptions, end-to-end TypeScript, zero config |
| Frontend | React + Tremor + Recharts | Production-ready dashboard components, dark mode |
| Validation | Zod | Single source of truth for types and runtime validation |
| Maps | Leaflet | Open-source geographic visualization |
| Testing | Vitest + Playwright | Fast unit/component tests + reliable E2E |
| IaC | Terraform (Railway) | Declarative, version-controlled infrastructure |
| CI/CD | GitHub Actions | Automated lint, test, build, deploy pipeline |
| Container | Docker (multi-stage) | Portable, minimal production images |

---

## Getting Started

```bash
# Clone and install
git clone <repo-url> && cd logisticsPractice
pnpm install

# Set up environment
cp .env.example .env
# Fill in API keys

# Seed demo data
npx tsx scripts/seed.ts

# Start development
pnpm dev

# Run tests
pnpm test
```

See `docs/happyrobot-setup.md` for HappyRobot platform configuration instructions.
