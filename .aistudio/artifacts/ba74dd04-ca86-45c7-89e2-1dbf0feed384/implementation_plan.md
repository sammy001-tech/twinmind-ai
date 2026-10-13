# Multi-Agent Specialist Swarm: Comprehensive Phase 2 Engineering Specification (Gated Build)

## Executive Summary

Phase 1 of the **Multi-Agent Specialist Swarm** is operational and verified under the strict **ZeroMock & Zero-Fallback Policy**. This document details the **Phase 2 Engineering Specification**, incorporating all four mandatory pre-build corrections, and begins the gated execution of **Milestone 1: Shared Operational Controls**.

---

## 1. Mandatory Pre-Build Corrections Applied

### Correction 1: Robust Combined Cancellation & Deadline Architecture
- **Root Controller & Combined Signal**: `AbortSignal.timeout(35_000)` produces an immutable signal without manual cancellation capability. We implement a root `AbortController` combined with the 35s timeout signal using `AbortSignal.any()`:
  ```ts
  const manualController = new AbortController();
  const timeoutSignal = AbortSignal.timeout(35_000);
  const combinedSignal = AbortSignal.any([manualController.signal, timeoutSignal]);
  ```
- **Propagation**: `combinedSignal` is passed into all specialist routines, HTTP client calls, bounded retry delays, and database queries.
- **Differentiating Timeout vs Manual Cancellation**: If `combinedSignal.aborted` fires:
  - If `manualController.signal.aborted` is true $\implies$ status is `cancelled` (user action via Web stop button or Telegram `/stop`).
  - Otherwise $\implies$ status is `timed_out` (35-second deadline reached).
- **Discarding Late Results**: A session-level lock flag `isTerminated = true` is set immediately upon abort. Late-resolving promises are intercepted and dropped; they are never emitted over SSE and never saved to persistence.

### Correction 2: Validated Active Embedding Model (`gemini-embedding-001`)
- **Active Model Selection**: Following Google's shutdown of `text-embedding-004` (retired January 14, 2026), the system standardizes on **`gemini-embedding-001`**.
- **Vector Dimension Verification**:
  - Configured explicitly with `{ outputDimensionality: 768 }`.
  - Prior to insertion into the Neon `vector(768)` column, the service validates `embedding.length === 768`. If length mismatches, the row is rejected rather than corrupting the pgvector index.

### Correction 3: Versioned Migration Lifecycle & Multi-Tenant Identity
- **Active Session Tracking**: The `status` constraint in `swarm_sessions` explicitly includes `'running'`:
  ```sql
  status VARCHAR(32) NOT NULL CHECK (
    status IN ('running', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'timed_out')
  )
  ```
- **Interrupted Session Recovery**: On application startup or Telegram bot reconnect, an initialization query marks orphaned active sessions as `failed`:
  ```sql
  UPDATE swarm_sessions 
  SET status = 'failed', error_details = 'INTERRUPTED_SERVER_RESTART' 
  WHERE status = 'running';
  ```
- **Tenant Ownership**: Removed the static default `'default'`. Tenant ownership is derived dynamically from the authenticated user context (`user.tenantId || user.id`).

### Correction 4: Tightened Secret Exclusions & Formal Cyclomatic Complexity
- **Narrow Secret Scanning Allowlists**: String literals are **not** exempted merely for containing words like `test` or `example`. Exclusions require matching:
  1. Designated test fixture directories: `fixtures/`, `__tests__/`, `*.test.ts`, `*.spec.ts`.
  2. Concrete, well-known public test dummies (e.g., AWS sample `AKIAIOSFODNN7EXAMPLE`, Stripe test key `sk_test_4eC39HqLyjWDarjtT1zdp7dc`).
- **McCabe Cyclomatic Complexity ($M$) Specification**:
  - Analyzed node types: `FunctionDeclaration`, `FunctionExpression`, `ArrowFunction`, and `MethodDeclaration`.
  - Formula: $M = 1 + \sum D$, where decision points $D$ count:
    - `IfStatement` (+1)
    - `ConditionalExpression` (ternary `?`) (+1)
    - `SwitchCase` (excluding default clause) (+1 per case)
    - Loops: `WhileStatement`, `DoWhileStatement`, `ForStatement`, `ForInStatement`, `ForOfStatement` (+1 each)
    - `CatchClause` (+1)
    - Binary logical operators: `&&`, `||`, `??` (+1 per operator instance)
  - Threshold: Functions with $M > 15$ trigger `SEC-004: Excessive Cyclomatic Complexity`.

---

## 2. Milestone 1: Shared Operational Controls Specification

Milestone 1 establishes the bedrock execution controls:

### A. Global Tool-Call Budget Manager
- **Atomic Budget Counter**: Maximum **6 calls** per swarm turn across all specialists combined.
- **Retry Invariant**: Every execution attempt—including retries in `callWithBoundedRetry`—increments the budget counter.
- **Rejection Contract**: If the budget is exhausted, `claimToolBudget()` throws `SwarmBudgetExceededError('SWARM_BUDGET_EXHAUSTED: 6-call limit reached')`.

### B. Provider Circuit Breakers
- Independent state machines for `Tavily`, `Gemini`, and `Neon`.
- Distinguishes 429 rate limits (exponential backoff) from 500/502/503 service failures.
- Trips to `OPEN` on 3 consecutive 5xx failures. 60-second cooldown before `HALF_OPEN` probe.

### C. Standardized Observable Status Taxonomy
- `running`: Active execution in progress.
- `completed`: All specialists and tools succeeded cleanly.
- `completed_with_errors`: Partial specialist success with explicit errors on failed sub-tasks; zero synthetic data.
- `failed`: All specialists or core orchestration failed.
- `cancelled`: Aborted by user manual action.
- `timed_out`: Aborted by 35-second global deadline.

---

## 3. Gated 6-Milestone Roadmap

```
[Milestone 1: Shared Operational Controls] ◄── CURRENT FOCUS
   ├── Atomic Tool Budget (6 calls max, retries counted)
   ├── Root AbortController + AbortSignal.any() 35s Deadline
   ├── Circuit Breakers (Tavily, Gemini, Neon)
   └── Observable Status Taxonomy
   ▼
[Milestone 2: Code & Security Auditor] (TypeScript AST SEC-001..SEC-004)
   ▼
[Milestone 3: Adversarial Critic] (1-5 Rubrics, 1-Loop Revision, Risk Disclosure)
   ▼
[Milestone 4: Neon PostgreSQL Persistence] (Migration 002, FK Cascade, Recovery)
   ▼
[Milestone 5: Knowledge Vault Auto-Indexing] (gemini-embedding-001 768d, Provenance)
   ▼
[Milestone 6: Telegram Cross-Channel Integration] (Pairing, Scoped /stop)
```

---

## 4. Phase 2 Release Checklist & Verification Gates

- [ ] **Gate 1: Resource Enforcement**: 6-call tool budget strictly halts further executions; retries consume budget; combined abort signal cancels tasks; circuit breakers handle cooldown and half-open state.
- [ ] **Gate 2: Auditor Reliability**: SEC-001 to SEC-004 validated against positive/negative fixtures with precise source locations.
- [ ] **Gate 3: Critic Correctness**: Bounded $R \le 10$ scoring, exactly one revision attempt, unresolved risk transparency.
- [ ] **Gate 4: Data Integrity**: Idempotent migration 002 with `running` status, interrupted session recovery, and tenant derivation.
- [ ] **Gate 5: Knowledge Vault**: `gemini-embedding-001` 768-dimension validation, eligibility filter, deduplication $> 0.88$.
- [ ] **Gate 6: Telegram Security**: User pairing authentication, scoped `/stop`, resource parity with Web.
- [ ] **Gate 7: Phase 1 Regression**: Live Tavily research, safe AST math, SSE streaming, and trace UI remain green.
- [ ] **Gate 8: Failure-Path Testing**: Transparent error reporting across all failure modes without synthetic fallbacks.
