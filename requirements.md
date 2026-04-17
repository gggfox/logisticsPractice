# FDE Technical Challenge: Inbound Carrier Sales

## Overview

You are meeting with a customer (played by the interviewer) to present a solution you built using the HappyRobot platform. The customer is evaluating vendors to handle inbound carrier load sales automation. Your agent will receive calls from carriers looking to book loads. Your task is to show a working proof of concept and demonstrate both technical depth and customer-centric thinking.

---

## 📦 Goals

### 🤖 Objective 1: Implement Inbound Use Case

A freight brokerage wants to automate inbound carrier calls. Carriers call in to request loads. The system must vet them, match them to viable loads, and negotiate pricing automatically.

- Use the HappyRobot platform to create an inbound agent where the AI assistant gets calls from carriers.
- The loads will be searched using an API in a file or DB which will contain the context within the following fields for each load:

| Field              | Description                          |
|-------------------|--------------------------------------|
| load_id           | Unique identifier for the load       |
| origin            | Starting location                    |
| destination       | Delivery location                    |
| pickup_datetime   | Date and time for pickup             |
| delivery_datetime | Date and time for delivery           |
| equipment_type    | Type of equipment needed             |
| loadboard_rate    | Listed rate for the load             |
| notes             | Additional information               |
| weight            | Load weight                          |
| commodity_type    | Type of goods                        |
| num_of_pieces     | Number of items                      |
| miles             | Distance to travel                   |
| dimensions        | Size measurements                    |

#### The assistant must:

- Get their MC number and verify they are eligible to work with using the FMCSA API.
- Search the load and pitch the details.
- Ask if they’re interested in accepting the load.
- If they make a counter offer:
  - Evaluate it.
  - Handle up to 3 back-and-forth negotiations.
- If a price is agreed:
  - Transfer the call to a sales rep.
  - (Mock message example: *“Transfer was successful and now you can wrap up the conversation”*)
- Extract the most relevant data from the call.
- Classify the call based on its outcome.
- Classify the sentiment of the carrier.

---

### 📊 Objective 2: Metrics

- Create a dashboard/report mechanism to show use case metrics.
- Do **not** use the platform analytics.
- Build your own solution to demonstrate product thinking and engineering ability.

---

### ⚙️ Objective 3: Deployment and Infrastructure

- Containerize the solution using Docker.

---

## 🧪 Deliverables

1. An email to your prospect client, Carlos Becker (c.becker@happyrobot.ai, recruiter in CC) with your latest progress before the meeting.
2. A document describing your build as if for a real freight broker (e.g., *“Acme Logistics”*).
3. Access to your deployed dashboard.
4. Link to your code repository.
5. Link to the workflow in the HappyRobot platform.
6. A short video (5 minutes) covering:
   - Use case setup
   - Demo
   - Dashboard walkthrough

---

## 🛡️ Additional Considerations

### 1. Security

If you’re creating an API, include:

- HTTPS (self-signed locally is fine; use Let’s Encrypt or similar in production)
- API key authentication for all endpoints

---

### 2. Deployment

- Deploy your API to a cloud provider (AWS, Google Cloud, Azure, Fly.io, Railway, etc.)
- Provide clear instructions on:
  - How to access the deployment
  - How to reproduce it (Terraform, scripts, or manual steps)

---

### 3. Calls

- Do **not** buy a phone number on the platform.
- Use the web call trigger feature instead.