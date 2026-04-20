# Inbound Carrier Sales — Test Call Scripts

End-to-end web-call scripts for validating the HappyRobot workflow against the
[FDE technical challenge](../requitements.secret.md). Read each script aloud in
the HappyRobot editor's **Preview workflow → Web call** panel.

The numbers below are calibrated to:

- the 5 seeded loads in prod (`LOAD-1000` … `LOAD-1004`)
- the negotiation logic in [`apps/api/src/routes/bridge/log-offer.ts`](../apps/api/src/routes/bridge/log-offer.ts):
  - accept margin: **5%** below `loadboard_rate` (`OFFER_ACCEPT_MARGIN_PERCENT`)
  - max rounds: **3** (`MAX_NEGOTIATION_ROUNDS`)
  - counter formula: `rate − gap × (0.3 + round × 0.15)`

### Carrier identifier gotcha — use DOT numbers, not MC dockets

`GET /api/v1/carriers/:mc` proxies to FMCSA's
`/qc/services/carriers/{id}` endpoint, which FMCSA treats as a **DOT
number**, not an MC docket (see the note at the top of
[`apps/api/requests.http`](../apps/api/requests.http)). The `123456`
value in the bruno fixtures and unit-test snapshots is a schema example
and does not resolve against live FMCSA.

For web-call testing, read a real DOT number when the agent asks for
your "MC number". Curated examples:

| Carrier                  | Say this | Type |
|--------------------------|----------|------|
| Schneider National       | **264184** | DOT  |
| Swift Transportation     | **54283**  | DOT  |

If you want to exercise the `Not eligible` branch, use an obviously
invalid identifier like `0` or `1` (FMCSA returns `content: null`, our
service returns `operating_status: 'NOT_FOUND'`, `is_eligible: false`).

If you later wire the route to the MC-docket endpoint
(`/qc/services/carriers/docket-number/{mc}`) instead, the MC values in
`requests.http` (`44110` for Schneider) become usable too.

---

## Seeded loads reference

| load_id    | Lane                          | Equipment | Pickup       | Delivery     | Rate   | Miles | Weight | Pieces |
|------------|-------------------------------|-----------|--------------|--------------|--------|-------|--------|--------|
| LOAD-1000  | Dallas, TX → Chicago, IL      | dry_van   | 2026-04-19   | 2026-04-21   | $3,163 | 920   | 20,060 | 8      |
| LOAD-1001  | Los Angeles, CA → Phoenix, AZ | reefer    | 2026-04-20   | 2026-04-22   | $1,197 | 370   | 43,543 | 7      |
| LOAD-1002  | Atlanta, GA → Miami, FL       | flatbed   | 2026-04-21   | 2026-04-23   | $2,241 | 660   | 41,921 | 9      |
| LOAD-1003  | Houston, TX → Memphis, TN     | dry_van   | 2026-04-22   | 2026-04-24   | $1,661 | 580   | 39,840 | 15     |
| LOAD-1004  | Chicago, IL → Detroit, MI     | reefer    | 2026-04-23   | 2026-04-25   | $919   | 280   | 20,303 | 12     |

All loads are `dimensions: 53ft`, `commodity_type` varies per row.

---

## Script A — Happy path with full 3-round negotiation

Primary end-to-end test. Covers ~90% of the spec. Uses **LOAD-1000**.

| Step | Who    | Line                                                                                                                                                                         | Verifies                                                        |
|------|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| 1    | Agent  | "Thank you for calling Happy Robot Logistics, how can I help?"                                                                                                               | Initial message                                                 |
| 2    | You    | "Hey, I'm calling about a load I saw posted."                                                                                                                                | Greeting flow                                                   |
| 3    | Agent  | "Do you see a reference number on that posting?"                                                                                                                             | Prompt step 2                                                   |
| 4    | You    | "Yeah, it's **LOAD-1000**."                                                                                                                                                  | `find_load` → `GET /api/v1/loads/LOAD-1000`                     |
| 5    | Agent  | "Got it — let me pull up that load."                                                                                                                                         | Tool round-trip                                                 |
| 6    | Agent  | "Also, what's your MC number?"                                                                                                                                               | Prompt step 3                                                   |
| 7    | You    | "MC **264184**." *(Schneider's DOT — see "Carrier identifier gotcha" above)*                                                                                                | `verify_carrier` → `GET /api/v1/carriers/264184`                |
| 8    | Agent  | "Is this **Schneider National Carriers Inc**?"                                                                                                                               | Name confirmation                                               |
| 9    | You    | "Yes, that's us."                                                                                                                                                            | Eligibility gate (`is_eligible=true`, `operating_status=AUTHORIZED`) |
| 10   | Agent  | "Alright, so this is General Freight. Dallas, TX to Chicago, IL. Picks up April 19, delivers April 21. 20,060 pounds, 8 pieces, dry van 53-foot. I have **$3,163** — want to book it?" | Pitch uses every field from the loads table              |
| 11   | You    | "That's low. I need **$2,700**."                                                                                                                                             | `negotiate_offer` round 1; expect `counter_offer ≈ $2,955`      |
| 12   | Agent  | "One moment… we can do **$2,955** on this load. The posted rate is $3,163."                                                                                                  | Round-1 counter relayed                                         |
| 13   | You    | "Still too low. How about **$2,950**?"                                                                                                                                       | `negotiate_offer` round 2; expect `counter ≈ $3,035`            |
| 14   | Agent  | "Let me check… we can do **$3,035**."                                                                                                                                        | Round-2 counter relayed                                         |
| 15   | You    | "Alright — I'll do **$3,010**."                                                                                                                                              | `negotiate_offer` round 3; $3,010 ≥ $3,004.85 → `accepted=true` |
| 16   | Agent  | "Great, $3,010 it is. Let me get you over to a rep."                                                                                                                         | `transfer_to_sales` tool                                        |
| 17   | Agent  | *(fixed)* "Transfer was successful and now you can wrap up the conversation."                                                                                                | Exact spec line                                                 |
| 18   | You    | "Thanks, talk to you soon." *(hang up)*                                                                                                                                      | Ends call                                                       |

### Negotiation math cheatsheet (LOAD-1000, loadboard_rate = $3,163)

- Min acceptable rate: `3163 × 0.95 = 3004.85`
- Round 1, offer $2,700: `gap = 463`, factor `0.45`, counter = `3163 − 463 × 0.45 ≈ 2955`
- Round 2, offer $2,950: `gap = 213`, factor `0.60`, counter = `3163 − 213 × 0.60 ≈ 3035`
- Round 3, offer $3,010: `3010 ≥ 3004.85` → **accepted**

### After hanging up, verify

1. **Runs panel**: `find_load`, `verify_carrier`, three `negotiate_offer` (rounds 1/2/3), one `transfer_to_sales`.
2. **AI Classify** → `Success`.
3. **AI Extract** → JSON roughly:

   ```json
   {
     "reference_number": "LOAD-1000",
     "mc_number": "264184",
     "booking_decision": "yes",
     "decline_reason": "",
     "final_rate": 3010,
     "negotiation_rounds": 3,
     "call_duration_seconds": "<number>"
   }
   ```

4. **Workflow-level webhook**: `POST /api/v1/webhooks/call-completed` fires; check
   the wide event ([`docs/observability.md`](./observability.md)) and the Convex
   `calls` table.
5. **Load status**: Convex `loads` row for `LOAD-1000` flipped to `booked`.
6. **Sentiment**: server-side post-call sentiment on the wide event / Convex
   call record should be positive.

---

## Script B — Lane search (no reference number)

Covers the `find_loads` path and the `Rate too high` classification.

1. Agent: initial greeting.
2. You: "Hey, got any **reefer** loads out of **Los Angeles**?"
3. Agent: "Do you see a reference number on that posting?"
4. You: "No, I'm just looking."
5. Agent: "What is the lane and trailer type?"
6. You: "LA to **Phoenix**, reefer."
7. Agent calls `find_loads?origin=Los Angeles&destination=Phoenix&equipment_type=reefer`
   → returns **LOAD-1001** ($1,197, 370 mi).
8. Agent asks for MC → you give **54283** (Swift's DOT) → verify passes.
9. Agent pitches LOAD-1001 at $1,197.
10. You: "No way — I need at least **$1,800**." *(above posted rate; expect counter ≈ $1,468)*
11. Agent relays counter.
12. You: "Still too low. Forget it." *(hang up)*

### Expected

- Classify = **Rate too high**.
- Extract: `booking_decision: "no"`, `decline_reason` mentions rate,
  `negotiation_rounds: 1`.

---

## Script C — Max-rounds exhausted

Uses **LOAD-1002** (Atlanta → Miami, flatbed, $2,241). Tests the "best and
final" branch and `max_rounds_reached: true` response.

1. Reference number **LOAD-1002**, MC **264184** (Schneider DOT).
2. Lowball each round:
   - Round 1: offer **$1,600** → counter ≈ $1,953
   - Round 2: offer **$1,700** → counter ≈ $1,916
   - Round 3: offer **$1,800** → counter ≈ $1,910 with "best and final" language
3. You: "Can't do it at that rate — I'll pass." *(hang up)*

### Expected

- 3rd `negotiate_offer` response has `max_rounds_reached: true`.
- Classify = **Rate too high**.
- Extract: `booking_decision: "no"`, `negotiation_rounds: 3`, `final_rate` empty.

---

## Script D — Ineligible carrier (FMCSA rejection)

Tests the rejection branch of `verify_carrier`.

1. Reference number **LOAD-1003**.
2. Agent asks for MC.
3. You: "MC **0**." *(or `1`, or `123456` — anything FMCSA doesn't know)*
4. `verify_carrier` returns `is_eligible: false`, `operating_status: NOT_FOUND`.
5. Agent politely declines and ends the call.

### Expected

- No `find_load` → transfer path reached.
- Classify = **Not interested**.
- Extract: `booking_decision: "no"`, `decline_reason` references eligibility.

---

## Script E — Instant accept (no negotiation)

Fastest smoke test. Uses **LOAD-1004** ($919).

1. Reference **LOAD-1004**, MC **264184** (Schneider DOT).
2. Agent pitches $919.
3. You: "**Sounds good, book it at $919.**"
4. Agent calls `negotiate_offer` with `offered_rate: 919` → immediate
   `accepted: true` (round 1).
5. Transfer tool fires, fixed message plays.

### Expected

- `negotiation_rounds: 1` (or 0 if the agent skips the tool — ideally it still
  calls it once so the server records the booking and flips LOAD-1004 to
  `booked`).
- Classify = **Success**.

---

## Coverage matrix

| Spec bullet                                      | Scripts                                |
|--------------------------------------------------|----------------------------------------|
| Get MC + verify with FMCSA                       | A, B, C, D, E                          |
| Ineligible carriers declined                     | D                                      |
| Search load and pitch all fields                 | A (by ref), B (by lane)                |
| Ask if interested                                | A, B, C, E                             |
| Counter-offer evaluation                         | A, B, C                                |
| Up to 3 back-and-forth negotiations              | A (3 → accept), C (3 → max)            |
| Transfer on agreement + exact mock line          | A, E                                   |
| Extract relevant data                            | A, C (compare JSON)                    |
| Classify call outcome                            | A (Success), B (Rate too high), D (Not interested) |
| Classify sentiment                               | A (positive), C (negative)             |
| Web-call trigger only, no phone number           | All (Preview workflow)                 |
| API key + HTTPS                                  | All tool calls use `x-api-key` over HTTPS `{BASE_URL}` |
| Dockerized deploy                                | Implicit — API must be up to serve the tool webhooks |

Run **Script A first**. If it passes end-to-end, B–E are short variants that
exercise the remaining branches.
