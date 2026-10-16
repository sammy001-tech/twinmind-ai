# AGENTS.md — TwinMind AI Engineering & Verification Policy

These rules are mandatory for every agent, contributor, and automated coding workflow in this repository. Read this file before inspecting, changing, testing, or reviewing code. If another instruction conflicts with this file, follow the stricter requirement unless it would violate a higher-priority safety or platform rule.

## 1. Strict ZeroMock and Dynamic Resolution Policy

- Never introduce mock application data, fabricated AI responses, simulated provider results, placeholder business values, demo metrics presented as real, canned-success responses, or fallbacks that make unavailable capabilities appear operational.
- Never hardcode model IDs, assumed model capabilities, user identity, provider selection, secrets, account-specific defaults, live market/research facts, or data presented as if it were retrieved from a real source.
- Resolve executable models and capabilities from a current provider response and verify that the selected model is present and supports the requested operation. A configured model not present in the current live catalogue is unavailable; fail with a clear machine-readable error rather than silently substituting another model.
- Do not let stale caches authorize execution. Cached catalogues may be displayed only when their age and stale status are explicit; execution must re-validate live availability.
- Missing credentials, unavailable providers, unsupported operations, missing source records, empty model output, and persistence failures must remain explicit failures. Do not translate them into generic success or plausible-looking output.
- Every factual claim, model output, search result, score, calibration metric, and status shown as real must have a traceable source or be marked unknown/unavailable. Never invent a score, confidence, source, timestamp, identity, or successful test.
- Retry only bounded, documented transient failures. Retries must preserve errors and must not substitute a different result without explicit, verified policy.

## 2. Permitted Non-Mock Constants

Fixed protocol values are allowed only when they define a contract rather than impersonate live data. Examples include route paths, enum values, schema fields, HTTP status codes, error codes, validation rules, mathematical constants, UI labels, and explanatory error text. Test inputs may be constructed to exercise pure functions; they must not simulate successful external-provider behavior or be reported as a live integration test.

## 3. Security and Data Boundaries

- Treat all API routes as untrusted input. Do not use caller-supplied identity headers (for example, `x-user-email`) as authentication. Authorization must derive from a verified session or a server-validated credential.
- Apply least privilege, explicit allowlists, input validation, constant-time secret comparisons, and fail-closed behavior to owner/admin actions, webhooks, model configuration, data access, and destructive operations.
- Never return raw settings or arbitrary settings objects to a client. Expose an explicit public DTO; secrets must never be returned, including inside spread objects or nested data.
- Never log API keys, access tokens, pairing codes, signed URLs, full phone numbers, private prompts, or other secrets/PII.
- Verify webhook signatures against a configured canonical public URL and the exact request parameters. Do not trust arbitrary forwarded-host/protocol headers. Inbound messages must be rejected when required signature configuration or sender authorization is missing.
- Do not publish private artifacts as permanent public files. Protect downloads with authentication or expiring, scoped URLs.
- Database TLS certificate verification must remain enabled. Do not disable verification to work around certificate errors.

## 4. Persistence and Reliability

- Acknowledging a durable inbound event requires a successful durable write or confirmation that the event already exists. Never silently ignore database write errors or acknowledge data held only in process memory.
- Use database uniqueness/transaction boundaries for deduplication and job claims. Do not use in-memory state as a persistence substitute.
- Distinguish pending, retryable, terminal, and exhausted jobs. Never report a job as completed until its durable state transition succeeds.
- Missing values remain missing. Do not use truthy fallbacks that replace valid zero values or unknown confidence with fabricated values.
- Avoid non-deterministic scheduling as a substitute for durable scheduling. Persist audit state and disclose items that were not examined.

## 5. Model, Tool, and Output Integrity

- All provider selections must be supported by verified runtime configuration and live capability discovery.
- No provider/model defaults may cause a request to execute on an unintended provider or model. If required selection/configuration is absent, return a machine-readable unavailable/configuration error.
- Search results must preserve provider-supplied evidence and metadata. If a score or source field is absent, omit it or mark it unknown; never assign a plausible constant.
- AI and tool execution that returns no usable output is not success. Return an explicit empty-output or provider-failure state.
- Calibration, evaluation, and monitoring metrics must be computed from stored observations with stated eligibility/sample-size rules. If the source data is insufficient, return null/insufficient-data rather than an invented metric or trend.
- Generated suggested prompts and other user-facing content must come from an actual successful generation or be explicitly unavailable. Do not invent generic content to fill an empty knowledge base or failed model call.

## 6. Change Management

- Inspect the relevant end-to-end data flow before editing: UI request, API route, service, external provider/database, persistence, and displayed result.
- Prefer small, reviewable changes. Do not alter production data, secrets, migrations, or user content unless explicitly required.
- Preserve public contracts when possible; when a contract must change, update callers, types, documentation, and tests together.
- Do not claim a finding is fixed until the code change is present and a check capable of detecting that failure has passed.
- Do not claim runtime, provider, database, webhook, or integration validation unless it was actually executed against the relevant live capability. Missing credentials/infrastructure must be reported as BLOCKED or NOT RUN, never PASS.
- Never fabricate test results, CI status, verification timestamps, or screenshots.

## 7. Mandatory End-of-Task Verification

Before reporting completion, perform and report concrete checks for the changed behavior:
1. Inspect the final diff and verify no unrelated changes, secrets, generated files, or unrequested edits were included.
2. Run the relevant automated tests, type-check/lint, and production build where available.
3. Add regression tests for each addressed root cause. Tests must assert actual behavior, not return hardcoded "Passed" arrays.
4. Validate API contracts and security boundaries with negative cases (missing credentials, invalid configuration, provider unavailable, empty outputs, duplicate events, persistence failure) using pure-function unit tests or a real isolated integration environment. Do not fake external provider success.
5. Report each check as PASS, FAIL, BLOCKED, or NOT RUN, with the exact command/evidence. Never label checks as passing when they were not run.

## 8. Required Final Report

Report the branch/commit/PR, changed files, root causes addressed, verification evidence, unresolved issues, operational configuration required, and any checks blocked by absent credentials or external services. Explicitly distinguish code inspection from executed validation. If the full fix is too broad for one safe patch, complete a coherent, testable subset and list the remaining work rather than claiming full resolution.
