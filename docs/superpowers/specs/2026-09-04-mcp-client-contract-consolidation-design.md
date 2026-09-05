---
status: draft
---

# MCP client contract consolidation — first iteration

Authoring review BI-DC0F14E0, WC-B2E2DA53, under EP-E1F1DB58.
Evidence: [client review](../audits/2026-09-04-mcp-client-contract-review.md).
This addendum is proposed design coverage for the named slices. It is not a plan approval or permission to bypass independent reviewers.

## 1. Purpose and existing boundaries

An authorized client should understand what it can do, retain useful results and recover from a blocked step without guessing tool names or rewriting valid artifacts. Preserve the domain-pack registry, ToolExecution ledger, Workroom identity, initiative reviewerRoutes and TaskRun lifecycle. Existing authority remains server-side.

Extend these designs rather than creating another orchestrator:

- [Deferred loading](2026-06-20-mcp-tool-tier-deferred-loading-design.md).
- [Call efficiency](2026-08-03-mcp-call-efficiency-loop-design.md).
- [MCP standard adoption](2026-08-06-mcp-2025-11-25-and-a2a-feature-adoption-design.md).

No new database model or generic dispatch tool is proposed. Database indexes may be justified by query plans during implementation; no migration is authorized by this draft. Keep existing tool names and input compatibility; add optional continuation/diagnostic fields, and test legacy clients. Authentication and independent-review ownership must not broaden.

Two client facts frame every slice. First, the server is no longer the only place that bounds a tool result: Claude Code persists oversized MCP results to disk and honours a per-tool `_meta["anthropic/maxResultSizeChars"]` hint, and Codex 0.152+ has a per-tool `output_token_limit`. The server budget is therefore a last line of defence, not the primary reader-protection it was designed as. Second, both clients index the full-tier catalog lazily on their own (Codex lazy attach, Claude Code ToolSearch), so DPF's `load_tools` ranking is one of two discovery paths and the tool description text is the shared input to both.

### Research & Benchmarking

| Reference | Adopt | Do not infer or adopt |
| --- | --- | --- |
| [MCP tools, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Human titles, explicit input/output contracts, valid structured results. | Metadata alone guarantees a client's UI or permission enforcement. Serialized text alongside structured data is a compatibility recommendation, so deduplication must be measured at the host boundary. |
| [MCP pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination) | Opaque continuation and unambiguous completion for listings. | Protocol tools/list pagination automatically paginates a domain list_workrooms result; implement its domain contract explicitly. |
| [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) | Record the negotiated revision in every benchmark; note `ttlMs`/`cacheScope` on `tools/list` and the `io.modelcontextprotocol/tasks` extension (`tasks/get`, `tasks/update`) as inputs to EP-E1F1DB58 scoping. Claude Code's v2 runtime already asks HTTP servers whether they speak it. | Re-platforming the route on the new revision inside this iteration, or treating the current experimental `tasks/submit|result` surface as the standard one. |
| [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) | Per-tool `_meta["anthropic/maxResultSizeChars"]` on list tools; `list_changed` over the v2 held stream; `/usage` per-server attribution as an independent context-cost measure. | That the 100,000-character route cap "matches" Claude Code: the client keeps what the server discards. That ToolSearch ranks the way `tool-intent.ts` does. |
| [Codex hooks](https://learn.chatgpt.com/docs/hooks) · [Claude Code hooks](https://code.claude.com/docs/en/hooks) | Source inspection, exact-definition trust, and the `statusMessage` field both clients document; generate it once into the managed `hooks.json` that feeds all three hook planes; verify the rendered client. | Unsupported hook title fields, automatic trust changes, or assuming `statusMessage` names the list row on either client. |
| [OpenTelemetry GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | Align future measurements with tool execution identity, latency and outcome vocabulary; keep the existing ledger. | A new telemetry backend or prompt-content collection as a prerequisite for this repair. |

Compared implementation patterns: DPF's existing domain-pack registry (retain), the MCP standard's typed tool/result boundary (adopt), and the hosts' own hook/trust adapters and result persistence (respect and test). A generic action facade is rejected for this iteration because it moves risk into hidden action schemas and duplicates existing governance. No third-party dependency is required.

## 2. External-author recovery — BI-CF118B6D

Contract CT-MCP-RECOVERY, journey FLOW-MCP-AUTHOR.

Consolidate missing-identity diagnosis and repair construction into the existing initiative recovery subsystem. Both read-only readiness and attempted transitions consume that projection. A read does not dispatch reviewers or mutate readiness. Expensive artifact resolution stays outside write transactions and should reuse existing immutable artifact information.

Adoption remains compatible with legitimate early work that has no commit yet, but returns missing baseSha/headSha and the gates they prevent. Do not label missing identity as a provider outage. Repairs include all required adoption identity, retain supplied valid values, and identify values that must still be resolved. Never invent SHAs. Do not advise re-signing unless signature evidence actually fails. The ARTIFACT_AUTHOR_REQUIRED remedy currently lives in two files with identical text; one of them goes.

Discovery distinguishes a callable tool from a workflow route. When authority permits revealing the distinction, identify unknown names, unavailable direct grants and reviewer-only execution; otherwise use a non-enumerating unavailable reason plus a safe supported entry point. Route author review through existing readiness/reviewerRoutes/request_coworker. The incorrect record_initiative_plan_review name must not be created as a workaround.

A blocked room must be distinguishable from a waiting one. Today WC-375F098A is `blocked` with six unmet reviewer-role gates and no dispatch, TaskRun, coworker offer or open decision review anywhere in the platform, and the readiness projection cannot say so. Every unmet gate whose accountable role the caller cannot hold must resolve to one of exactly three states: a pending dispatch with an id the operator can open, an eligible route the caller can trigger now, or an explicit "no eligible reviewer exists" escalation with the role and the capability gap named. "Awaits reviewer capability" without one of those three is a defect.

Acceptance AC-MCP-RECOVERY:

1. An adopted room missing only baseSha reports that exact field, preserves its valid head and yields a repair packet matching the actual adopt_worktree schema.
2. Read-only and transition recovery agree on missing facts, responsible role and next action.
3. A valid already-signed/pushed artifact does not produce re-sign/rewrite advice solely because baseSha is absent.
4. A complete author journey crosses adoption, published immutable artifact, readiness, independent reviewer dispatch, and persisted approval. Test author/referee identities separately and read the receipt back.
5. Negative cases include unknown writer name, author without direct writer grants, no eligible reviewer, missing base, missing head, inaccessible artifact, stale head and provider failure. Each has a finite next step or explicit escalation; no retry loop to an impossible direct writer.
6. For a room blocked on reviewer-role gates, the readiness projection and get_workroom both expose the waiting-on state (dispatch id, triggerable route, or named escalation) and the Workroom list surfaces it, so an operator can tell a queued room from an orphaned one without reading the activity log.

Current reproduction: WC-375F098A / BI-154689E7, base expected f62c1edb4b5cead926f8f69913fa29b73845f9cb, head 4053e900d8d178f9a4c61b0defc79e2d69c1c5a6. Its owner tests repair; this design does not authorize another task to take over that room.

## 3. Honest efficiency measurement — BI-4BB68EB6

Contract CT-MCP-COVERAGE, journey FLOW-MCP-MEASURE.

Refactor the existing loader and report into bounded aggregation over a fixed requested time range. Return requested bounds, observed bounds, included count, eligible population count when measured, and complete/partial disposition. Use a stable (createdAt,id) cursor or equivalent existing database aggregation; cap memory, not silently the meaning of the report. If a time/row budget interrupts a scan, mark it partial and preserve continuation/checkpoint provenance. Do not claim seven-day health or auto-dispatch corrective action from a silently partial sample.

The scheduled job in `queue/functions/mcp-call-efficiency-scan.ts` (06:15 UTC daily, 24-hour window, notify and dispatchAiOps on) consumes the same loader and today reports the first eight or so hours of each day. It is a consumer of this contract, not a separate fix: after the change it must refuse to notify or dispatch from a partial scan unless the notification itself carries the partial disposition and observed bounds. The loader's `limit` argument (default 5,000, ceiling 20,000) is not exposed by the tool schema; either expose it with the coverage fields or retire it in favour of the cursor.

Retain governed refusals separately from execution faults. State denominators for headline and per-tool rates. Keep successful response and usable outcome distinct: a transport preview is not a completed listing. Capture discovery/pre-auth telemetry as a separately designed extension of existing observability; do not put secret arguments or tokens in logs. Where the client offers an independent measure (Claude Code `/usage` per-server attribution since 2.1.222), record it beside the ledger figure rather than replacing either.

Acceptance AC-MCP-COVERAGE: more than 5,000 rows, tied timestamps, late-arriving rows, newest-window failure and empty range are covered. Verify counts against an authoritative fixed-range count, report incomplete scans honestly, and measure query duration/memory. Merely changing ASC to DESC is insufficient: it silently drops the other end. The daily job run against a day with more rows than the budget produces a notification that states partial coverage and files nothing as "current".

## 4. Bounded traversable results — BI-3CE72645

Contract CT-MCP-PAGE, journey FLOW-MCP-LIST.

Extend list_workrooms with a compact summary projection, supported opaque cursor and explicit completion. Details remain on get_workroom. Fix the snapshot/order/filter contract so pages are stable during concurrent updates; cursor authority and filters are validated on every request. Use a bounded page size and an explicit maximum detail payload. Oversize individual records must still yield an identifiable summary and supported detail route.

The transport budget remains a final protection. It must not turn normal successful typed results into an incompatible preview. When it does fire, it degrades to a typed shape, not a string preview: the tool's own structured summary fields (for list_workrooms, `livenessSummary` and counts), the number of records withheld, and the continuation or narrowing parameters that recover them. The budget must also stop pre-empting clients that would have kept the data: emit `_meta["anthropic/maxResultSizeChars"]` on list tools for Claude Code, document the Codex per-tool `output_token_limit` in `codex.mcp.json`, and revisit the `tool-result-budget.ts` comment that claims parity with Claude Code's cap. Reuse shared pagination/result primitives found in implementation discovery. Do not declare a new generic envelope until existing result shapes have been inventoried and compatibility tested.

Acceptance AC-MCP-PAGE: enumerate a fixed population above 100 without omissions or duplicates; retain valid structured records under the budget; filter and authorization behavior hold across pages; long strings do not erase the result; page counts are never presented as population totals. Test both legacy text and structured consumers, and run the over-budget case on Claude Code and Codex to show the client receives either the typed degradation or the full persisted result, never the string preview.

## 5. Discovery and operator presentation — existing BI-1BA8F46C

Reuse the existing surface/context-aware exposure catalog. Extend its design with two acceptance journeys rather than adding another catalog:

- FLOW-MCP-DISCOVER: representative intents find the relevant callable operation or supported workflow among the top results. Measure top-3 relevance on a fixed labeled set, no-match reasons, calls before first useful result and catalog bytes. Measure it twice per intent, once through DPF `load_tools` and once through the client's own index (Claude Code ToolSearch, Codex lazy attach), because on Claude Code the client's ranking is the one that fires. Keep full-tier behavior for lazy hosts until a tested replacement exists. The shared lever is the first sentence of each tool description; treat description edits as the primary intervention and measure them on both paths.
- FLOW-MCP-HOOK: the operator can identify purpose, triggering event, script/source and trust state before enabling a hook. Prototype against the actual supported host schema on both Codex and Claude Code; both document `statusMessage` per handler. Add it once to the managed `hooks/hooks.json`, since the Codex and Grok planes are generated from that file, then verify what each client actually renders. If a client cannot display friendly list labels, document the host limitation and provide a generated script-name mapping; never claim the UI is fixed from JSON alone.

Generate metadata from the existing canonical tool/hook definitions rather than maintaining a second independent list. Test representative Codex, Claude and generic MCP client paths. Title/status metadata is presentation only; server policy remains authoritative. A label change does not implicitly approve a new hook hash.

Client capabilities the audit found unused (`async` and `if` on hook handlers, the `mcp_tool` handler type, `SubagentStart`, `PreCompact`, `WorktreeRemove`, `PostToolUseFailure`, Codex `Interrupt`) are adapter follow-ups for BI-1BA8F46C or a new item, each needing its own rendered-client verification. They are named here so they are not re-discovered; they are not in this iteration's acceptance.

## 6. Refactoring allocation and delivery

Allocate 20–30% of implementation effort to consolidation within these slices: remove duplicated readiness guidance; replace hand-copied advertised/parsed field sets where supported; centralize bounded page/report projection; use one production Git/provider adapter per contract. Measure independent definitions removed and consumer coverage added. Do not game the allocation with formatting or bulk renaming.

Deliver separate, revertible slices. Recommended order is recovery and measurement first, then traversal, then exposure/presentation expansion against the new baselines. Recovery does not depend on the metrics fix to prove its own acceptance; the metrics fix is necessary before claiming aggregate savings. Each needs its own approved implementation plan and live backlog coverage before code.

Keep the existing BI-154689E7 closeout work and its authoring/acceptance handoff separate. TaskRun and release acceptance already exist; implement their supported handoff rather than keeping this audit task alive for deployment. Review the acceptance record on meaningful completion/failure through the existing mechanism, not repeated model polling.

## 7. Verification and stop conditions

Measure per-journey completion, discovery hops, failed non-retryable attempts, response completeness, latency and bytes. Join workroom authoring, merge, deployed-version acceptance and cleanup for end-to-end age. Do not call PR title share a defect escape rate or catalog bytes a billed-token estimate.

Every benchmark record carries the client name and version, the negotiated MCP protocol revision, the DPF source SHA and the tier hint used. Clients ship weekly (Claude Code 2.1.200 installed against 2.1.261 current; Codex CLI 0.153.4 on September 4), so a result without those four fields cannot be compared to its successor. The three live probes in the audit are cheap; re-run them after each client upgrade and before claiming a server-side improvement holds.

For each slice, demonstrate a failing behavior at the real boundary, then the same successful journey on the supported verification environment. Retain unit tests for policy and negative cases. Do not replace meaningful authority checks with mocks in the only integration test. Stop and report when the required authority/provider is unavailable; preserve a complete handoff instead of guessing a substitute writer, and make that handoff visible as a waiting-on state (§2), not only as a note in the activity log.

This iteration succeeds when each named acceptance journey works and the operator can understand its state. It does not require an MCP rewrite, a new orchestration service, or retirement of unrelated governance rules.
