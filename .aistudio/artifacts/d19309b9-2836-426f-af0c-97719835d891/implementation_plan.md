# Implementation Plan: TwinMind Decision Calibration Engine, Experiment Lifecycle & Security-Hardened Test Suite

A complete, production-grade specification for TwinMind AI's Decision Calibration Dashboard, Experiment Lifecycle Management, Database Schema Enhancements, and Security-Isolated Negative Test Suite.

---

## User Review & Critical Decisions Applied

> [!NOTE]
> All 5 contract fixes requested in the architectural review have been incorporated into this finalized specification:
> 1. **Dual Navigation Entry**: Calibration Dashboard accessible as a top-level tab in main app navigation AND contextually inside `DecisionAnalyzerModal` using unified components & data hooks.
> 2. **Unbundled Metric Calibration**:
>    - Evidence Sufficiency, Prediction Confidence, and Observed Success Rates are strictly unbundled.
>    - Probabilistic accuracy uses the Brier Score (`Brier = (Predicted Prob - Actual Outcome)^2`), where lower is better.
>    - Sample size thresholding (`n >= 5` eligible observations) enforces "Insufficient Data" badges rather than displaying misleading 100% accuracy scores.
>    - `Inconclusive`, `Pivoted`, `Overdue`, and `Cancelled` outcomes are preserved distinctly and excluded from success/failure ratios.
> 3. **Experiment Lifecycle & Schema**:
>    - Explicit states: `Proposed` -> `Active Experiment` -> `Awaiting Data` / `Overdue` -> `Completed Review` / `Pivoted` / `Cancelled`.
>    - Recommending without baselines defaults to unmeasured `Hypothesis` status.
>    - Schema: `decision_experiments` table in Neon DB linked to `decisions` with immutable predictions, target metrics, baseline units, and user ownership.
> 4. **Strict Database & Idempotency Constraints**:
>    - Unique constraint on `(user_email, review_key)` in `decision_reviews` and `decision_experiments`.
>    - Reusing an idempotency key with a changed payload returns HTTP 409 Conflict rather than accepting mutated data.
> 5. **Secured Test Runner Environment**:
>    - Negative test suite runner secured under `/api/admin/test/negative-matrix` requiring admin authorization tokens and using isolated, temporary DB transactions to prevent production pollution.

---

## 1. Architecture & Component Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TwinMind AI UI Layout                         │
│  ┌─────────────────────────────┐     ┌───────────────────────────────┐  │
│  │   Navigation Sidebar / Tab  │     │   DecisionAnalyzerModal       │  │
│  │  - "Calibration & Experiments"    │  - "View Calibration History" │  │
│  └──────────────┬──────────────┘     └───────────────┬───────────────┘  │
└─────────────────┼────────────────────────────────────┼──────────────────┘
                  │                                    │
                  └─────────────────┬──────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   DecisionCalibrationDashboard.tsx                      │
│  - Brier Calibration Scorecard (Sample-Size Gated n >= 5)               │
│  - Unbundled Metrics: Evidence Sufficiency vs. Prediction Confidence    │
│  - Filterable Experiment Matrix (Active, Overdue, Completed, Pivoted)  │
│  - Side-by-Side Immutable Prediction vs Real-World Outcome Log          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ HTTP API Requests
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Express Node.js Server                          │
│  ┌────────────────────────────┐      ┌───────────────────────────────┐  │
│  │  /api/decisions            │      │  /api/decisions/:id/experiment│  │
│  │  - Immutable History       │      │  - Lifecycle Transitions      │  │
│  ├────────────────────────────┤      ├───────────────────────────────┤  │
│  │  /api/decisions/:id/reviews│      │  /api/admin/test/neg-matrix   │  │
│  │  - Append-Only Observations│      │  - Isolated Admin Test Suite  │  │
│  │  - 409 Idempotency Guard   │      │  - 10 Edge Case Assertions    │  │
│  └──────────────┬─────────────┘      └───────────────┬───────────────┘  │
└───────────────────┼───────────────────────────────────┼──────────────────┘
                                    │ Neon DB SQL Pool
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Neon PostgreSQL Database                         │
│  ┌─────────────────────────────┐     ┌───────────────────────────────┐  │
│  │ decisions                   │     │ decision_experiments          │  │
│  │ - id, title, full_analysis  │     │ - id, decision_id, user_email │  │
│  ├─────────────────────────────┤     │ - baseline_metric, target_val │  │
│  │ decision_reviews            │     │ - status, start_date, deadline│  │
│  │ - id, decision_id, user_email     └───────────────────────────────┘  │
│  │ - observation, outcome, review_key (UNIQUE per user)                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detailed Technical & Data Contracts

### A. Calibration Model Rules
- **Brier Score Calculation**: For $N$ eligible finalized predictions ($N \ge 5$):
  $$Brier = \frac{1}{N} \sum_{i=1}^{N} (f_i - o_i)^2$$
  where $f_i \in [0, 1]$ is predicted confidence normalized to a decimal and $o_i \in \{0, 1\}$ ($1 = \text{Met Success Threshold}, 0 = \text{Missed Baseline}$).
- **Sample Size Guard**: If $N < 5$, render `Sample Size Insufficient (N/5)` badge instead of a numerical score.
- **Categorical Outcomes**: `Inconclusive`, `Pivoted`, `Cancelled`, and `Overdue` are grouped into separate tracking buckets and excluded from binary success/failure score math.

### B. Neon Database Schema
```sql
CREATE TABLE IF NOT EXISTS decision_experiments (
  id SERIAL PRIMARY KEY,
  decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,
  baseline_metric VARCHAR(255),
  target_metric VARCHAR(255),
  units VARCHAR(50),
  threshold_value NUMERIC,
  measurement_direction VARCHAR(20) DEFAULT 'above', -- 'above' or 'below'
  status VARCHAR(50) DEFAULT 'Proposed', -- Proposed, Active, Overdue, Completed, Pivoted, Cancelled
  start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  target_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique index to prevent duplicate idempotency key mutations with different payloads
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_user_key ON decision_reviews (user_email, review_key);
```

### C. Admin Test Runner Authorization & Verification
- Test runner route `/api/admin/test/negative-matrix` requires `x-admin-token` header matching server environment or localhost context.
- Executes 10 deterministic test cases against mock transaction fixtures without mutating production records.

---

## 3. Execution Roadmap

1. **Phase 1**: Database schema & service methods in `server/db/neonService.ts` (`decision_experiments`, idempotency conflict detection, Brier metrics).
2. **Phase 2**: Server API endpoints in `server.ts` (`/api/decisions/:id/experiments`, `/api/admin/test/negative-matrix` with admin auth).
3. **Phase 3**: Frontend `DecisionCalibrationDashboard.tsx` component with unbundled scorecards, Brier calculation, status filters, and dual navigation entry points in `App.tsx` and `DecisionAnalyzerModal.tsx`.
4. **Phase 4**: Automated negative test matrix execution and verification.
