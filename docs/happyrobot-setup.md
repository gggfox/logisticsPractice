# HappyRobot Platform Configuration Guide

This document describes how to configure the inbound voice agent on the HappyRobot platform
for the Acme Logistics carrier sales automation.

## 1. Create Inbound Agent

1. Log in to the HappyRobot platform at https://app.happyrobot.ai
2. Navigate to **Agents** > **Create Agent**
3. Select **Inbound** as the agent type
4. Name the agent: `Acme Logistics - Carrier Sales`

## 2. Agent Persona

Set the system prompt / persona instructions:

```
You are an AI assistant for Acme Logistics, a freight brokerage. You handle inbound calls
from carriers looking to book loads. You are professional, efficient, and knowledgeable about
freight operations.

Your workflow:
1. Greet the carrier professionally
2. Ask for their MC number to verify eligibility
3. Use the find_carrier tool to verify the carrier with FMCSA
4. If eligible, ask about their preferred lanes (origin, destination, equipment type)
5. Use the find_loads tool to search for matching available loads
6. Pitch the best matching load with details (rate, pickup date, weight, miles)
7. Ask if they are interested in the load at the posted rate
8. If they make a counter-offer, use the log_offer tool to evaluate it
9. You may negotiate up to 3 rounds - be firm but fair
10. If a price is agreed, confirm the booking and say:
    "Transfer was successful and now you can wrap up the conversation"
11. If no agreement after 3 rounds, thank them and end the call professionally
12. Always be courteous regardless of outcome
```

## 3. Register API Tools

Register these Bridge API tools pointing to your deployed API:

### find_carrier
- **Method**: GET
- **URL**: `{BASE_URL}/api/v1/carriers/{mc_number}`
- **Headers**: `x-api-key: {BRIDGE_API_KEY}`
- **Description**: Verify a carrier's eligibility by their MC number using FMCSA data

### find_loads
- **Method**: GET  
- **URL**: `{BASE_URL}/api/v1/loads`
- **Query Parameters**: `origin`, `destination`, `equipment_type`
- **Headers**: `x-api-key: {BRIDGE_API_KEY}`
- **Description**: Search available loads matching the carrier's preferred lanes

### find_load
- **Method**: GET
- **URL**: `{BASE_URL}/api/v1/loads/{load_id}`
- **Headers**: `x-api-key: {BRIDGE_API_KEY}`
- **Description**: Get full details of a specific load by ID

### log_offer
- **Method**: POST
- **URL**: `{BASE_URL}/api/v1/offers`
- **Headers**: `x-api-key: {BRIDGE_API_KEY}`
- **Body**: `{ "call_id": "...", "load_id": "...", "carrier_mc": "...", "offered_rate": 0 }`
- **Description**: Log a negotiation offer and get acceptance/counter-offer response

## 4. Webhook Configuration

1. Navigate to **Integrations** > **Webhooks**
2. Add a new webhook:
   - **Event**: Call Completed
   - **URL**: `{BASE_URL}/api/v1/webhooks/call-completed`
   - **Headers**: `x-api-key: {BRIDGE_API_KEY}`
   - **Secret**: Set to your `WEBHOOK_SECRET` environment variable value

## 5. Testing with Web Call Trigger

Per requirements, do NOT purchase a phone number. Instead:

1. Navigate to the agent configuration
2. Use the **Web Call Trigger** feature to initiate test calls
3. This allows testing the full flow through a browser-based call interface

## 6. Environment Variables

Ensure your deployed API has these environment variables set:

| Variable | Description |
|----------|-------------|
| `BRIDGE_API_KEY` | API key shared with HappyRobot for Bridge API auth |
| `WEBHOOK_SECRET` | HMAC secret for webhook signature verification |
| `FMCSA_WEB_KEY` | Your FMCSA developer portal web key |
| `CONVEX_URL` | Your Convex deployment URL |
| `HAPPYROBOT_API_KEY` | API key for calling HappyRobot's API (transcripts) |
