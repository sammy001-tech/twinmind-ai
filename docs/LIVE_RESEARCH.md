# Live Research: runtime behavior and configuration

TwinMind AI's live research workflow is evidence-bound. It uses the configured live model and Tavily credentials, normalizes provider-returned search records, extracts pages from validated source URLs, and uses the configured model to propose bounded follow-up queries from evidence already returned. No research source, excerpt, score, publication date, search result, or completion status is synthesized to fill a gap.

## Runtime path

1. The normal chat tool loop can call `searchWeb` and then `extractWebPages`. Page extraction is accepted only for URLs present in the user request or returned by an earlier successful live search. Chat tool events are streamed to the UI with invocation IDs so the displayed progress corresponds to actual tool execution.
2. Swarm research starts with a live search, uses the currently configured and live-validated provider/model to produce a validated follow-up-query plan, runs bounded follow-up searches, and extracts a bounded set of pages returned by those searches.
3. Source records are normalized and deduplicated by canonical HTTP(S) URL. Records without actual titles, URLs, or evidence content are excluded. Local/private URL targets are rejected for extraction.
4. Synthesis receives source IDs only for actual source records retained in its bounded evidence context. Material web claims are asked to cite these IDs. If the draft omits citations or references unknown IDs, the configured model gets one evidence-bounded correction attempt; invalid citations after that make synthesis fail explicitly.
5. Empty retrieval, extraction failures, invalid plans, budget exhaustion, timeouts, and synthesis/citation failures remain visible as errors or partial completion. A provider HTTP response by itself does not qualify as usable research evidence.

## Optional Render environment variables

These settings control bounded execution, not research facts. Existing live credentials and provider/model selections remain resolved at runtime. Invalid explicitly configured values fail closed instead of being silently replaced.

| Variable | Default | Accepted values |
|---|---:|---|
| `TWINMIND_RESEARCH_SEARCH_DEPTH` | `advanced` | `basic` or `advanced` |
| `TWINMIND_RESEARCH_SEARCH_RESULT_LIMIT` | `6` | Integer from `1` to `10` |
| `TWINMIND_RESEARCH_INITIAL_QUERY_LIMIT` | `2` | Integer from `0` to `4` supplemental queries in the initial plan |
| `TWINMIND_RESEARCH_FOLLOW_UP_LIMIT` | `2` | Integer from `0` to `4` |
| `TWINMIND_RESEARCH_EXTRACT_LIMIT` | `5` | Integer from `1` to `10` |
| `TWINMIND_RESEARCH_SOURCE_CONTENT_LIMIT` | `12000` | Integer from `1000` to `30000` characters |
| `TWINMIND_RESEARCH_REPORT_SOURCE_LIMIT` | `8` | Integer from `1` to `20` |
| `TWINMIND_SWARM_TOOL_BUDGET` | `12` | Integer from `6` to `40` tool calls, including retries |
| `TWINMIND_SWARM_DEADLINE_MS` | `75000` | Integer from `10000` to `300000` milliseconds |
| `TWINMIND_AGENT_MAX_TOOL_ROUNDS` | `4` | Integer from `1` to `8` model/tool rounds |
| `TWINMIND_AGENT_MAX_TOOL_CALLS` | `8` | Integer from `1` to `40` total tool executions per normal chat turn |

If a variable is not set, its documented execution-limit default applies. These are safety and resource limits, not static or substituted research outputs. Start with the defaults; increase the limits only after measuring actual provider latency, rate limits, source coverage, and cost.

## Verification boundaries

Pure tests validate URL policy, provider-record normalization, deduplication, citation-ID checks, dynamic configuration parsing, and adaptive-plan parsing. They do not simulate successful provider calls. A live Tavily extraction, live research-session run, or Render deployment must be separately exercised before claiming runtime integration success.
