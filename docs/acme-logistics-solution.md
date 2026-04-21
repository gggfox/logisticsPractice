# Acme Logistics

## Build Description: Inbound Carrier Sales Automation

Prepared for `Acme Logistics`

## Executive Summary

This build gives Acme Logistics a production-oriented take-home implementation of an inbound carrier sales workflow for carriers calling on posted freight. Instead of requiring a broker to handle every first-touch call manually, the system answers inbound calls, qualifies the carrier, identifies the relevant load, manages initial rate discussion inside defined guardrails, and records the outcome in an operations dashboard backed by Convex data.

The intent is not to replace Acme's brokerage team. The intent is to automate repetitive front-end call handling, improve after-hours and overflow coverage, standardize qualification, and give leadership a clearer picture of what is happening across inbound carrier demand.

## What Problem This Build Solves

Freight brokerages lose time and margin when brokers are forced to spend large parts of the day on repetitive first-touch calls. The same operational pain points show up repeatedly:

- Inbound calls arrive after hours or during peak volume.
- Carrier qualification is inconsistent from rep to rep.
- Posted-load inquiries consume broker time before a load is even confirmed as a fit.
- Negotiation activity is hard to review after the fact.
- Managers lack a clean view of call outcomes, booking conversion, and carrier sentiment.

This build addresses those issues by creating a structured, always-on intake layer for inbound carrier sales.

## What The Build Does

### 1. Answers and qualifies inbound carrier calls

The voice agent handles incoming carrier conversations through HappyRobot. It greets the caller, determines whether they are calling about a specific posted load or a lane, and captures the MC number for compliance screening.

Carrier qualification is performed against FMCSA data in real time so the workflow can screen out ineligible carriers before a broker spends time on the call.

### 2. Finds and presents available freight

Once the carrier is qualified, the system identifies the target load by reference number or by lane and equipment type. It presents the relevant details a carrier would expect to hear on an inbound sales call, including:

- Origin and destination
- Pickup and delivery timing
- Equipment type
- Weight and commodity
- Mileage
- Posted rate

This keeps the conversation natural and useful while still following a consistent sales process.

### 3. Handles initial negotiation inside guardrails

If the carrier asks for a different rate, the workflow can manage the first round of negotiation using broker-defined rules. The current build supports:

- Automatic acceptance when an offer is within an acceptable margin
- Structured counteroffers when an offer falls below the threshold
- Up to three negotiation rounds
- Logging of each negotiation round for review and reporting

When pricing is agreed, the build supports confirming the booking at the agreed rate once it falls within the allowed range. In the current take-home workflow, the final human handoff is simulated rather than executed through a live telephony transfer.

### 4. Captures the complete call record

After the call ends, the system processes the webhook payload, normalizes the data, and stores the information needed for operations and reporting. That includes:

- Call transcript
- Call status and duration
- Carrier MC number
- Load reference
- Booking outcome
- Negotiation rounds
- Sentiment and call classification

This creates a usable audit trail instead of leaving valuable information buried in call recordings or broker notes.

### 5. Feeds a live brokerage dashboard

The build includes a dashboard for the operations team so Acme can monitor the system as calls happen. The dashboard is designed to answer the questions a brokerage leadership team cares about:

- How many inbound calls are we receiving?
- How many are being booked, declined, transferred, or lost?
- Which loads are attracting demand?
- Which carriers are calling most often?
- How is negotiation performance trending over time?

Operational views update live through Convex queries, while summary metrics are aggregated on an hourly schedule. That gives supervisors timely visibility without relying on manual reporting or exported spreadsheets.

## End-To-End Workflow

1. A carrier calls Acme about a posted load.
2. The voice agent collects the reference number or asks for lane and equipment details.
3. The workflow asks for the MC number and verifies the carrier against FMCSA data.
4. The system locates the matching load and presents shipment details.
5. The carrier either accepts the posted rate or begins negotiation.
6. The workflow confirms the booking within guardrails and, in the current take-home version, simulates the final handoff to a human rep.
7. The completed call is recorded, classified, and made visible in the dashboard.

## What Acme Receives In This Build

This build includes the working system slice needed to demonstrate the workflow end to end:

- An inbound voice workflow configured for freight-style carrier calls
- A secured Bridge API for carrier verification, load lookup, negotiation, booking, and webhook intake
- A live dashboard for calls, loads, carrier activity, and negotiation reporting, with Convex-backed views and scheduled summary metrics
- Logging, metrics, and traceability for operational support
- Containerized deployment and CI automation for repeatable validation and hosting
- Supporting technical documentation for setup and maintenance

## Operating Model

This solution is best suited for:

- After-hours load coverage
- Overflow call handling during busy brokerage windows
- Standardized qualification for posted-load inquiries
- Faster first response on carrier demand
- Cleaner reporting on negotiation behavior and booking conversion

It should be viewed as a broker-assist system rather than a full TMS replacement. Human brokers remain important for exceptions, relationship-managed freight, customer-specific pricing decisions, and edge cases that should not be automated.

## Technical Implementation Overview

The build uses a practical, production-oriented architecture for a take-home implementation:

- **Voice layer:** HappyRobot manages the live carrier conversation.
- **Application layer:** A Fastify-based Bridge API handles qualification, load search, negotiation, booking, and webhook processing.
- **Data layer:** Convex stores loads, calls, negotiations, and metrics, and powers live dashboard views plus scheduled summary rollups.
- **Dashboard:** A React-based web application gives operations and leadership immediate visibility into activity and outcomes.
- **Async processing:** Background workers handle post-call enrichment, classification, and metric aggregation.
- **Observability:** OpenTelemetry and SigNoz provide traces, metrics, and structured logs for support and troubleshooting.

The result is a system that is fast enough for live call workflows, instrumented enough to explain its behavior, and structured so it could be hardened further for a production rollout.

## Security And Operational Controls

The build includes several controls that make the implementation operationally credible:

- HTTPS at public endpoints
- API-key protection on application routes
- Optional webhook-signature telemetry alongside API-key auth
- Rate limiting to protect the API surface
- Secrets managed through environment variables rather than code
- Restricted API CORS origin handling for the dashboard
- Containerized API deployment with a non-root runtime
- Structured logging and operational telemetry for auditability

The main gaps before a live rollout are the intentionally open Convex/dashboard access model used for this take-home and the fact that webhook signatures are recorded as telemetry rather than enforced authentication. Those are acceptable for a synthetic-data exercise, but they would need hardening before production.

## Hosting And Deployment

The current deployment model is container-based and intentionally straightforward:

- The API and dashboard run as separate services
- Deployment targets a Hostinger VPS managed through Dokploy
- GitHub Actions runs linting, type safety, tests, and builds on pushes and pull requests
- Dokploy rebuilds and redeploys the services on push to `main`, with post-deploy health verification handled in GitHub Actions
- Health checks and monitoring are built into the deployment workflow

This gives Acme a simple operating footprint without requiring a heavy internal platform team.

## Inputs Required From Acme Logistics

To move from build completion to live production use, Acme would need to provide or approve:

- HappyRobot account and workflow access
- Production API keys and environment configuration
- The source of truth for active load inventory
- Negotiation tolerance and pricing rules
- Transfer policy or phone routing for human handoff
- Preferred greeting, branding, and escalation language

## Recommended Phase Two Options

If Acme wants to expand beyond the initial build, the next logical enhancements would be:

- TMS integration so booked loads sync into the brokerage's core operating system
- Broker or team-based routing rules
- Customer-specific pricing rules and load prioritization
- Carrier allowlists, blocklists, and compliance exceptions
- Expanded reporting around lane demand, coverage gaps, and rep handoff quality
- Additional channels such as SMS follow-up or outbound reactivation

## Closing Statement

In practical terms, this build gives Acme Logistics a digital front line for inbound carrier sales. It qualifies callers, protects broker time, captures negotiation intelligence, and gives the team a live operating view of what is happening across load inquiries.

For a freight broker, the value is simple: more coverage, more consistency, better visibility, and fewer missed opportunities on inbound demand.
