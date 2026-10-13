# Twilio WhatsApp Integration — Final Baseline Implementation Plan

A production-grade two-way WhatsApp integration for TwinMind powered by Twilio, featuring 100% natural language processing (zero slash commands), schema-validated intent classification, atomic lockfile persistence, lease-aware worker recovery, and complete security isolation.

---

## Executive Summary & Final Four Architecture Corrections

This specification incorporates the final four mandatory engineering corrections:

1. **Durable Persistence Before TwiML ACK**:
   - Processing order: (1) Validate `X-Twilio-Signature` -> (2) Authenticate Sender -> (3) Atomically Persist Inbound Message & Job State -> (4) Return HTTP 200 TwiML XML ACK -> (5) Process Asynchronously.
2. **State-Bound Confirmations & `tokenConfigured` Flag**:
   - Pending confirmations store `{ actionId, senderPhone, targetDecisionId, proposedObservation, expiresAt }`. Replies like `YES` authorize ONLY matching unexpired pending actions and execute exactly once.
   - `/api/settings` returns `twilioTokenConfigured: boolean` (e.g. `true`) rather than masked string masks (`••••••••`) to prevent saving mask placeholders as credentials.
3. **Lease-Aware & Heartbeat Crash Recovery**:
   - Jobs maintain a `workerLeaseId`, `lastHeartbeatAt`, and `attemptCount`. Recovery logic targets jobs with expired worker leases (e.g., no heartbeat for 5 minutes) rather than arbitrary job duration, preserving legitimate long-running multi-pass debates.
4. **Unified Credential Scope & Single-Source Resolution**:
   - Twilio credentials (`accountSid`, `authToken`, `whatsappNumber`) are resolved as **one complete configuration source** (all from Settings Manager OR all from Environment Variables). Partial configurations throw explicit configuration errors rather than falling back piecemeal.

---

## 1. System Pipeline & Webhook Execution Order

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TWILIO WHATSAPP GATEWAY                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ POST /api/twilio/whatsapp
                                    │ Header: X-Twilio-Signature
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       EXPRESS SERVER (server.ts)                       │
│                                                                        │
│  1. Security Check  ──► Validate X-Twilio-Signature                    │
│  2. Sender Auth     ──► Verify From against authorized user phone     │
│  3. Atomic Persist  ──► Record MessageSid & Job in twin-jobs.json      │
│  4. Return TwiML    ──► HTTP 200 TwiML ACK                             │
│  5. Async Dispatch  ──► Hand off to background worker                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   ASYNC JOB WORKER (jobQueueService.ts)                │
│                                                                        │
│  • Heartbeat Manager: Updates lastHeartbeatAt every 15 seconds         │
│  • Schema-Validated Intent Classifier (Zod)                            │
│    ├── Pending Confirmation Match ──► Execute pending mutation         │
│    ├── Confidence < 0.75          ──► Send clarification prompt        │
│    └── High Confidence            ──► Execute Intent Action:           │
│         ├─► DEBATE_REQUEST   ──► specialistSwarmService.ts             │
│         ├─► OUTCOME_LOGGING  ──► Stage confirmation prompt             │
│         ├─► DECISION_LOOKUP ──► Query decision store                   │
│         └─► GENERAL_CHAT     ──► twinAgentService.ts                   │
│                                                                        │
│  • Outbound Delivery: Push message via Twilio REST API                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Design & Technical Contracts

### A. Settings Data Model & Endpoint (`server/types/settings.ts`)
- Add Twilio settings:
  ```ts
  export interface TwilioSettings {
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioWhatsAppNumber?: string;
    userPhoneNumber?: string;
    enableWhatsAppAlerts?: boolean;
    enforceTwilioSignature?: boolean;
  }
  ```
- **API Response Sanitization**: `GET /api/settings` returns:
  ```json
  {
    "twilioAccountSid": "AC1234...",
    "twilioWhatsAppNumber": "whatsapp:+14155238886",
    "userPhoneNumber": "whatsapp:+1234567890",
    "twilioTokenConfigured": true,
    "enableWhatsAppAlerts": true,
    "enforceTwilioSignature": true
  }
  ```

### B. Durable Lockfile Queue (`server/services/jobQueueService.ts`)
- Uses `proper-lockfile` and `write-file-atomic` on `twin-jobs.json`.
- Schema:
  ```ts
  export interface JobRecord {
    jobId: string;
    messageSid: string;
    senderPhone: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    workerLeaseId?: string;
    lastHeartbeatAt?: string;
    attemptCount: number;
    createdAt: string;
    payload: any;
    error?: string;
  }
  ```
- **Duplicate Check**: Deduplicates inbound `MessageSid`. If `MessageSid` exists, return immediate TwiML XML without creating duplicate jobs.
- **Recovery Daemon**: Sweeps every 60s for `processing` jobs whose `lastHeartbeatAt` is older than 5 minutes, attempting up to 3 retries.

### C. Confirmation State Manager (`server/services/confirmationService.ts`)
- Tracks pending user action confirmations in memory and disk:
  ```ts
  export interface PendingConfirmation {
    actionId: string;
    senderPhone: string;
    targetDecisionId: string;
    proposedStatus: string;
    proposedNotes: string;
    expiresAt: string;
  }
  ```
- Expire window: 15 minutes.
- Matching logic: When a user sends "YES", "CONFIRM", or similar affirmative, check if an unexpired `PendingConfirmation` exists for `senderPhone`. If found, commit observation to `twin-knowledge.json` and clear the pending confirmation.

---

## 3. Phased Implementation Sequence

- **Phase 1: Repository Inspection & Security Foundation**
  - Inspect existing server files (`server.ts`, `server/services/settingsManager.ts`, `server/services/twinAgentService.ts`).
  - Extend settings types and add unified credential resolution logic.
  - Create `server/services/twilioService.ts` with signature validation, sender authorization, and `tokenConfigured` sanitization.
- **Phase 2: Schema-Validated Intent Classifier**
  - Implement `server/services/intentClassifier.ts` using Zod schema outputs and confidence thresholds.
- **Phase 3: Durable Job Queue & Heartbeat Manager**
  - Implement `server/services/jobQueueService.ts` with lockfile, atomic writes, `MessageSid` deduplication, and lease-based heartbeat recovery.
- **Phase 4: Confirmation Flow & Decision Storage Integration**
  - Implement `server/services/confirmationService.ts` and connect outcome updates to decision memory.
- **Phase 5: Settings UI & 3-Stage Connection Diagnostics**
  - Add "WhatsApp & Twilio" tab to `src/components/SettingsModal.tsx` with 3-stage diagnostic checks (`/api/twilio/test`).
- **Phase 6: End-to-End Verification & Gate Checks**
  - Execute build and lint checks (`compile_applet`, `lint_applet`).

---

## 4. Final Acceptance Checklist

- [ ] Webhook validates `X-Twilio-Signature` and checks sender authorization before anything else.
- [ ] Inbound messages are atomically persisted in `twin-jobs.json` before returning HTTP 200 TwiML ACK.
- [ ] Duplicate `MessageSid` webhooks are acknowledged without creating duplicate jobs or processing.
- [ ] Intent classification uses Zod schema validation; confidence < 0.75 triggers clarification.
- [ ] Outcome reports trigger a target confirmation prompt bound to `actionId` and `senderPhone`.
- [ ] Job crash recovery is lease-aware (uses `lastHeartbeatAt` expiration rather than total job duration).
- [ ] Settings API returns `twilioTokenConfigured: boolean` instead of masked placeholder strings.
- [ ] Unified credential resolution fails explicitly if credentials are partially configured across sources.
- [ ] Outbound REST submission and actual delivery callbacks (`sent` vs `delivered`) are tracked distinctly.
- [ ] All code compiles and lints cleanly via `compile_applet` and `lint_applet`.
