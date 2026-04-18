# HappyRobot Platform Configuration Guide

This document describes how to configure the **Inbound Carrier Sales** voice workflow on the
HappyRobot platform for **HappyRobot Logistics / Acme Logistics** carrier sales automation.

Terminology follows the current HappyRobot docs (<https://docs.happyrobot.ai>):

- A **workflow** is the executable graph you build in the editor.
- A **trigger node** starts the workflow. For browser-based testing we use the
  **AI Agent → Web call** trigger (no phone number required).
- An **Inbound Voice Agent** action node contains the voice session: a nested **Prompt**
  node (model + system prompt + initial message) plus **Tool** nodes the LLM can call.
- Each **Tool** node has child action nodes (usually a **Webhook** node) that execute
  when the LLM invokes the tool.
- Downstream of the voice agent, **AI Classify** and **AI Extract** core nodes turn the
  finished transcript into structured outputs.

> Per spec ([requirements](../requitements.secret.md)), **do not purchase a phone number**.
> Use the Web call AI Agent trigger and the in-editor **Preview workflow** button to place
> test calls from the browser.

---

## 1. Prerequisites

1. An organization on <https://platform.happyrobot.ai>.
2. API deployed (the Motia app in `apps/api`) with these environment variables set
   ( see [`.env.example`](../.env.example) ):
    - `BRIDGE_API_KEY` — shared secret for tool calls and the call-completed
      webhook (sent as `x-api-key`)
    - `FMCSA_WEB_KEY` — FMCSA developer portal web key
    - `CONVEX_URL`, `CONVEX_DEPLOY_KEY` — Convex backend
    - `HAPPYROBOT_API_KEY` — only needed for fetching transcripts back from
      HappyRobot (`GET /api/v1/calls/:call_id/transcript`)
    - `WEBHOOK_SECRET` — **optional**. Only consulted when a caller sends
      `x-webhook-signature` (e.g. a signing proxy in front of the webhook).
      HappyRobot workflow webhooks only ship static headers, so the common
      case leaves this unset and relies on `x-api-key` alone.
3. A public HTTPS base URL for the API (`{BASE_URL}` below). Locally you can expose
   `http://localhost:3111` with a tunnel (cloudflared / ngrok); in production use the
   Dokploy domain from [`docs/dokploy-setup.md`](./dokploy-setup.md).

All Bridge-API endpoints are mounted under `/api/v1/` — see
[`apps/api/requests.http`](../apps/api/requests.http) for the canonical list.

---

## 2. Create the workflow

1. In the platform sidebar, open **Workflows → Editor** and click the workflow picker.
2. Click **Create workflow** and name it `Inbound Carrier Sales`.
3. The editor opens with an empty canvas. The workflow we build has this shape:

```text
Web call (AI Agent trigger)
        │
        ▼
┌─ Inbound Voice Agent ──────────────────────────────────┐
│   Prompt                                               │
│   Tool: verify_carrier      → Webhook GET FMCSA carrier│
│   Tool: find_loads          → Webhook GET loads search │
│   Tool: find_load           → Webhook GET load by id   │
│   Tool: negotiate_offer     → Webhook POST offer       │
│   Tool: transfer_to_sales   → Fixed-message tool       │
└────────────────────────────────────────────────────────┘
        │
        ▼
AI Classify (call outcome)
        │
        ▼
AI Extract (structured data)
```

The current deployed workflow (`Inbound Carrier Sales New`, id `0falkz3hrfh8`) already
has the Web call trigger, Inbound Voice Agent, Prompt, `verify_carrier` + `find_available_loads`
tools, and the Classify + Extract tail. It is **missing** the `find_load`, `negotiate_offer`,
and `transfer_to_sales` tools, the prompt has two `⚠️ (Part missing)` placeholders, and the
webhook nodes point at placeholder AWS API Gateway URLs that need to be replaced with your
deployed `{BASE_URL}` (see §5).

---

## 3. Trigger: Web call

Add an **AI Agent → Web call** trigger node. Using the Web call trigger means no telephony
assignment is required and calls are placed from the Preview panel in the editor.

Configuration:

| Field       | Value                                          |
|-------------|------------------------------------------------|
| Event Name  | `Web call`                                     |
| Data Schema | (leave empty; runtime provides `room_name`, `to_number=web`, `from_number=web`) |

Link the Voice Agent node's **Call** field to this trigger.

---

## 4. Inbound Voice Agent

Add an **Inbound Voice Agent** action node and set:

| Field                        | Value                                              |
|------------------------------|----------------------------------------------------|
| Agent                        | Any voice from Assets → Voices (we use `Paul`)     |
| Languages                    | `en-US`                                            |
| Voices                       | Same voice as Agent (multi-select allowed for A/B) |
| Call                         | → `Web call` trigger                               |
| Background noise             | `Call center`                                      |
| Noise reduction              | `No` (default)                                     |
| Max call duration            | `600` seconds (10 min)                             |
| Max duration transfer number | leave blank (we end the call on timeout)           |
| Respect business hours       | Disabled                                           |
| Record                       | `true`                                             |
| Play recording message       | `false` (simplifies demo; enable + pick Natural/Custom for production) |
| Disable time fillers         | `false`                                            |
| Stay silent                  | `true`                                             |
| Real-time sentiment          | `false` (sentiment is computed server-side post-call) |
| Contact intelligence         | `Disable auto contact context = false` if you want memory; leave off for the demo |

### 4.1 Transcription accuracy

In the agent's **Transcription** section set:

- **Transcription context** — `Callers are US freight carriers booking loads. Expect US city names, ZIP codes, MC numbers, DOT numbers, load reference numbers (three uppercase letters + five digits), and freight industry terms (BOL, POD, FCFS, FAK, reefer, flatbed, van, deadhead, lumper, TWIC).`
- **Key terms** — click *Review AI-generated keyterms* and keep the freight-specific
  suggestions (MC number, reefer, flatbed, FCFS, BOL, POD, lumper, deadhead, TWIC, FAK,
  freight of all kinds, load posting, reference number, HappyRobot Logistics, …).

### 4.2 End-of-turn detection / STT / LLM

Defaults are fine for an English-only POC:

- STT: HappyRobot default (`legacy` is the currently selected transcriber).
- End-of-turn: `English`.
- TTS: the selected Voice from Assets → Voices.
- LLM: `Turbo` (set on the Prompt node, see §4.3).

---

## 5. Prompt node

Add a **Prompt** node as the first child under the Voice Agent.

| Field                   | Value                                                                 |
|-------------------------|-----------------------------------------------------------------------|
| Use Custom LLM          | `No`                                                                  |
| Model                   | `Turbo`                                                               |
| Initial Message         | `Thank you for calling Happy Robot Logistics, how can I help?`        |
| Prompt                  | See template below — must have **no `⚠️ (Part missing)` gaps**         |

System prompt (paste into the Prompt field, replacing the current one):

```text
# Background
You are a carrier sales representative working for HappyRobot Logistics.

# Goal
Help inbound carriers find, price, and book a load. Verify the carrier against
FMCSA, pitch a matching load, negotiate up to three rounds, and hand off to a
human sales rep on agreement.

# How you will operate

## 1. Greeting
Greet the caller professionally. They are almost always calling about a load
they saw posted online.

## 2. Getting the load reference
Ask: "Do you see a reference number on that posting?"
- If they give a reference number, save it as @reference_number and call
  find_load with it.
- If they do NOT have a reference number, ask: "What is the lane and trailer
  type?" Capture origin, destination, and equipment, then call find_loads.

## 3. Carrier qualification
Ask: "What's your MC number?"
Call the verify_carrier tool with the MC number. Confirm the returned company
name with the caller ("Is this <company_name>?"). If the name does not match,
ask for the MC number again (up to twice).

Only proceed if the tool returns eligible = true. If the carrier is not
eligible (not authorized, not active, or unsafe), politely decline and end
the call.

## 4. Pitching the load
Confirm the load details using this style:
  "Alright, so this is a <commodity_type>. <origin> to <destination>.
   Picks up <pickup_datetime> in <origin>, delivers <delivery_datetime> in
   <destination>. It's <commodity_type> weighing <weight> pounds. We need
   <equipment_type>, <dimensions>. <notes>. I have <loadboard_rate> on
   this one — would you like to book the load?"

## 5. Negotiation (max 3 rounds)
If the caller counter-offers a rate, call the negotiate_offer tool with
call_id, load_id, carrier_mc, and their offered_rate.

- If the tool returns accepted = true, confirm the final rate and move to
  transfer (step 6).
- If the tool returns a counter_offer, relay it to the caller:
  "We can do $<counter_offer> for this load. The posted rate is
   $<loadboard_rate>."
- When the tool returns max_rounds_reached = true, deliver the final counter
  and tell the caller this is our best and final offer. If they still decline,
  thank them and end the call.

Never make up a number — always use the tool.

## 6. Transfer on agreement
When a price is agreed, call the transfer_to_sales tool. The tool plays:
  "Transfer was successful and now you can wrap up the conversation."
After the tool runs, thank the caller and end the call.

## 7. Style
Keep responses concise and natural — you are on a phone call. Use simple,
conversational language and a few filler words ("okay", "alright", "sure
thing"). Avoid sounding robotic or overly formal. Always be courteous,
regardless of outcome.
```

Remove the two `⚠️ (Part missing)` placeholders currently in the deployed prompt — the
sections above under *Carrier qualification* and *Finding a Load* replace them.

---

## 6. Tool nodes

Each tool below is a **Tool** child of the Inbound Voice Agent, with a **Webhook** child
node that hits the Bridge API. All webhooks use `x-api-key: {BRIDGE_API_KEY}` and
`No Auth` in the Webhook authentication field (we authenticate via header, not a built-in
method). Set **Error Handling → Gracefully handle 5XX errors** off so the agent retries a
tool if the API briefly fails.

Variables from tool parameters are referenced in child nodes with `@<param_name>`.

### 6.1 `verify_carrier`

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| Description | `Validate the carrier's MC number via FMCSA. Call this after the caller provides their MC number. Returns the carrier's legal name and eligibility.` |
| Message     | `AI` — "Let me look up your MC real quick"                            |
| Hold music  | `Ring tones`                                                          |
| Parameters  | `mc_number` (required) — "The carrier's FMCSA Motor Carrier (MC) number, digits only." Example: `123456` |

**Child webhook:**

| Field   | Value                                                            |
|---------|------------------------------------------------------------------|
| Method  | `GET`                                                            |
| URL     | `{BASE_URL}/api/v1/carriers/@mc_number`                          |
| Headers | `x-api-key: {BRIDGE_API_KEY}`                                    |

### 6.2 `find_loads`

Used when the caller does **not** have a reference number.

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| Description | `Search available loads matching the caller's lane. Use this when the caller describes a lane and equipment type but does not have a specific reference number.` |
| Message     | `AI` — "Let me see what we have on that lane"                         |
| Hold music  | `Ring tones`                                                          |
| Parameters  | `origin`, `destination`, `equipment_type` (all optional)              |

**Child webhook:**

| Field           | Value                                                        |
|-----------------|--------------------------------------------------------------|
| Method          | `GET`                                                        |
| URL             | `{BASE_URL}/api/v1/loads`                                    |
| Query params    | `origin=@origin`, `destination=@destination`, `equipment_type=@equipment_type` |
| Headers         | `x-api-key: {BRIDGE_API_KEY}`                                |

### 6.3 `find_load`

Used when the caller gives a reference number.

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| Description | `Fetch full details for a specific load by its reference number. Use when the caller provides a reference number from a posting.` |
| Message     | `AI` — "Let me pull up that load"                                     |
| Parameters  | `reference_number` (required) — "The load's reference number (three uppercase letters and five digits, e.g. ABC12345)." |

**Child webhook:**

| Field   | Value                                                            |
|---------|------------------------------------------------------------------|
| Method  | `GET`                                                            |
| URL     | `{BASE_URL}/api/v1/loads/@reference_number`                      |
| Headers | `x-api-key: {BRIDGE_API_KEY}`                                    |

### 6.4 `negotiate_offer`

The server holds all negotiation logic — the agent just relays the tool's response.
See [`apps/api/src/steps/bridge/log-offer.step.ts`](../apps/api/src/steps/bridge/log-offer.step.ts).

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| Description | `Evaluate a carrier's offered rate. Returns either accepted=true or a counter_offer. Handles up to 3 rounds per call_id. Use whenever the caller proposes a rate.` |
| Message     | `AI` — "One moment, let me check on that number"                      |
| Hold music  | `Acoustic`                                                            |
| Parameters  | `call_id` (required, example: `@session_id`), `load_id` (required), `carrier_mc` (required), `offered_rate` (required, numeric) |

**Child webhook:**

| Field        | Value                                                                                                              |
|--------------|--------------------------------------------------------------------------------------------------------------------|
| Method       | `POST`                                                                                                             |
| URL          | `{BASE_URL}/api/v1/offers`                                                                                         |
| Content type | `application/json`                                                                                                 |
| Body (Raw)   | `{ "call_id": "@call_id", "load_id": "@load_id", "carrier_mc": "@carrier_mc", "offered_rate": @offered_rate }`     |
| Headers      | `x-api-key: {BRIDGE_API_KEY}`                                                                                      |

### 6.5 `transfer_to_sales`

Per [requirements](../requitements.secret.md), the transfer is **mocked** — we just play
the scripted line. Use HappyRobot's **Direct Transfer** integration if you want a real SIP
transfer later (see the Prompts & Tools docs for direct / warm / whisper modes).

| Field       | Value                                                                  |
|-------------|------------------------------------------------------------------------|
| Description | `Hand off the caller to a human sales rep once a rate is agreed. Call only after negotiate_offer returns accepted=true.` |
| Message     | `Fixed` — "Transfer was successful and now you can wrap up the conversation." |
| Parameters  | none                                                                   |
| Child node  | none (the Fixed message is all the caller hears)                       |

---

## 7. AI Classify (call outcome)

Add an **AI Classify** core node after the Voice Agent.

| Field   | Value                                                                            |
|---------|----------------------------------------------------------------------------------|
| Model   | default                                                                          |
| Input   | `@transcript` from the Inbound Voice Agent                                       |
| Prompt  | `You are a call analytics assistant. Classify the completed call based on the transcript: "Success" if the carrier agreed to book the load. "Rate too high" if they declined because the rate did not work. "Not interested" if they declined for any other reason. Provide exactly one of those three tags.` |
| Tags    | `Success`, `Rate too high`, `Not interested`                                     |

---

## 8. AI Extract (structured outputs)

Add an **AI Extract** core node after Classify.

| Field   | Value                                                                            |
|---------|----------------------------------------------------------------------------------|
| Input   | `@transcript`, plus `@duration` from the Voice Agent                             |
| Prompt  | `You are a data-extraction assistant. From the completed call transcript, pull out: reference_number (the load the caller asked about), mc_number (the carrier's MC number), booking_decision ("yes" if they agreed to book, otherwise "no"), decline_reason (if booking_decision is no, capture why; otherwise empty), final_rate (the agreed rate in USD if booked, otherwise empty), negotiation_rounds (integer count of counter-offers), call_duration_seconds (from the @duration variable). Return JSON with these keys.` |

---

## 9. Workflow-level webhook (call-completed)

Go to **Workflow settings → Webhooks** and add:

| Field   | Value                                                  |
|---------|--------------------------------------------------------|
| URL     | `{BASE_URL}/api/v1/webhooks/call-completed`            |
| Headers | `x-api-key: {BRIDGE_API_KEY}`                          |

HappyRobot's workflow-level webhook UI only supports static headers, so it
cannot sign requests per-body. The API treats `x-api-key` as the sole auth
gate for this route — identical to every other Bridge endpoint.

If you later put a signing proxy in front of the webhook, set `WEBHOOK_SECRET`
on the API and have the proxy send `x-webhook-signature` as hex-encoded
HMAC-SHA256 of the raw body. The API records the outcome as
`signature_state=valid|invalid` on the wide event and the
`carrier_sales.webhook.received` metric; it never 401s based on the
signature.

```bash
# Example if you're manually signing for testing:
echo -n '<raw body>' | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET"
```

HappyRobot's webhooks are fired after the workflow completes; the body should include
`call_id`, `phone_number`, `carrier_mc`, `load_id`, `transcript`, `duration_seconds`,
`started_at`, `ended_at`, `status`, and the `extracted_data` JSON from the AI Extract
node. See [`apps/api/requests.http`](../apps/api/requests.http) for the canonical payload
and [`CallWebhookPayloadSchema`](../packages/shared/src/schemas/call.schema.ts) for the contract.

---

## 10. Testing from the browser (Web call trigger)

1. Click **Preview workflow** in the top-right of the editor.
2. Pick **Web call** as the trigger to exercise.
3. Click **Call** — the browser opens a WebRTC session and you can speak to the agent.
4. After hanging up, open **Runs** in the sidebar to inspect:
    - the full transcript
    - each tool call (parameters + child webhook response)
    - the AI Classify tag + AI Extract JSON output
    - the recording (if enabled)
5. Verify the **Workflow-level webhook** fired by checking the API logs / wide events
   (`docs/observability.md`) and the Convex dashboard.

---

## 11. Platform API keys

The HappyRobot-side API keys (under **Account and Settings → API Keys**) are used by
our API to fetch transcripts via `GET /api/v1/calls/:call_id/transcript`. Store the
value as `HAPPYROBOT_API_KEY` in the deployed environment. Keys are shown **once** at
creation — rotate by revoking and creating a new one.

---

## 12. Environment reference

API-side variables consumed by the flows above:

| Variable              | Used by                                                |
|-----------------------|--------------------------------------------------------|
| `BRIDGE_API_KEY`      | `apiKeyAuth` middleware on every Bridge endpoint (including the call-completed webhook) |
| `ADMIN_API_KEY`       | `/api/v1/admin/seed` only                              |
| `WEBHOOK_SECRET`      | Optional. Only used when a caller sends `x-webhook-signature`; decorates telemetry rather than gating the route |
| `FMCSA_WEB_KEY`       | `fmcsa.service.ts`                                     |
| `HAPPYROBOT_API_KEY`  | `happyrobot.service.ts` (transcript fetch)             |
| `CONVEX_URL`          | `convex.service.ts` for loads / negotiations / calls   |

See [`apps/api/src/config.ts`](../apps/api/src/config.ts) for how the API resolves
these at startup.
