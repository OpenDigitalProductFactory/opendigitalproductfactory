---
status: draft
---

# MCP client contract review — September 4, 2026

Review: BI-DC0F14E0 · Workroom WC-B2E2DA53 · Epic EP-E1F1DB58.
Source inspected: `f62c1edb4b5cead926f8f69913fa29b73845f9cb`.
Live observations: operator development install. Codex Desktop, September 4, approximately 23:45–23:57 UTC. Cross-client check from Claude Code 2.1.200 against the same install, September 5, 00:18–00:25 UTC.
This is an architecture review and proposed iteration, not a claim that runtime defects are fixed.

## Finding

The MCP connection works, but several contracts do not let clients reliably finish the next step. The strongest evidence concerns incomplete recovery instructions, destructive result truncation, and incomplete measurement coverage. These deserve priority over adding more tools or instructions.

All three server-side defects reproduced identically from a second client. They are DPF contract defects, not Codex presentation quirks. Two of them are made worse by a client capability DPF does not use: both Claude Code and Codex now keep or bound large tool results on the client side, and Claude Code exposes a per-tool result-size hint, so the server-side preview is the only place in the chain where the data actually dies.

The architecture is not an untouched monolith. `apps/web/lib/mcp-tools.ts` is 762 lines at the inspected revision and is the thin composition layer over 90 scoped domain packs under `apps/web/lib/mcp/packs/`. That consolidation is valuable. The remaining problem is consistency across schema, handler, persistence, transport, and client presentation. Preserve this architecture and repair those boundaries.

## PR sample and limits

The adjacent [300-row sample](2026-09-04-mcp-pr-sample.csv) preserves GitHub API values retrieved with:

```text
gh pr list --repo OpenDigitalProductFactory/opendigitalproductfactory --state merged --limit 300 --json number,title,createdAt,mergedAt,additions,deletions,changedFiles,url --search 'merged:>=2026-08-06'
```

The cap was reached. This is a recent bounded sample, not all PRs in August or all historical defects. Its merge timestamps span August 27 05:06 to September 4 21:53 UTC. Title-prefix classification (re-derived from the CSV on September 5) gives:

| Prefix | PRs |
| --- | ---: |
| fix | 189 (63%) |
| feat | 56 |
| doc / docs | 44 (24 + 20) |
| build | 6 |
| test | 2 |
| refactor | 1 |
| perf | 1 |
| revert | 1 |

The sample adds 146,047 lines and removes 19,726, including generated artifacts, tests and documentation. That is a growth signal, not a code-quality measure. Refactoring may be hidden inside fix/feat PRs; one refactor title does not prove only one refactor occurred.

Median PR-open-to-merge time is 27.3 minutes; the empirical nearest-rank p90 is 294.9 minutes. This omits work before opening a PR and after merge. It cannot explain weeks-long task lifetime by itself. The closeout task must join claim, authoring, gate wait, merge, deployment, acceptance and cleanup timestamps before allocating delay or token cost.

### Confirmed examples of corrective chains

These are PR authors' documented diagnoses, not new reproductions of already-fixed defects:

| Chain | Evidence | Architectural implication |
| --- | --- | --- |
| [#4974](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4974) → [#4981](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4981) | A workShape field passed 627 tests but was omitted by the intermediate parseScopeInput handler. The fix documents success=true with the field absent. | Exercise the advertised schema through the real handler and persistence/readback boundary. Derive field handling rather than copying lists. |
| [#4951](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4951) → [#4997](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4997) | The committed-schema reader's tests injected readGit; the production Git invocation omitted safe.directory and always degraded on that install. | Keep a production-adapter test alongside pure injected tests; return explicit degradation reasons. |
| [#4989](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4989) → [#5017](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5017) | Fixing the pre-push reader left the plugin guard and PR-health reader unable to see another slot's PASS. | Converge all consumers on the canonical verdict reader; verify consumer coverage. |

These examples support an integration-contract weakness. They do not establish that all 189 fix PRs are regressions or that MCP caused every prolonged task.

## Live client findings

### 1. External-author recovery is incomplete — high priority

The operator supplied a reproduction from the task owning BI-154689E7. This review independently read WC-375F098A and confirmed `baseSha: null`, `headSha: 4053e900d8d178f9a4c61b0defc79e2d69c1c5a6`, branch `feat/delivery-closeout-efficiency`. The supplied expected base is `f62c1edb4b5cead926f8f69913fa29b73845f9cb`; the peer's readiness receipt is IRD-C005F9D89744. The Claude Code re-read on September 5 saw the same null base.

At source revision above:

- `work-capsules/governed-work-claim.ts:137` requires an immutable base/head to discover reviewer artifacts, but recommends adoption with only headBranch/headSha.
- `backlog/initiative-readiness/canonical-artifact-discovery.ts:90` repeats the incomplete repair; malformed base/head is classified as provider-unavailable before any provider call.
- `backlog/initiative-readiness/readiness-guidance.ts:169` and `tak/initiative-readiness-tool-grants.ts:370` both carry the same generic author/sign/push guidance, character for character. Two homes for one rule is the §1 single-source defect in miniature.
- Direct loading of reviewer-only writers is not the author workflow. Existing implementation-readiness recovery returns reviewerRoutes for request_coworker. Plan review uses record_initiative_design_review with gate=plan-review.

The missing base is confirmed. This review did not mutate the peer's workroom or test whether supplying it completes review. A missing direct writer is not proof the workflow is unavailable. Capture this as BI-CF118B6D, preserving independent-review authority.

**What the waiting thread is actually waiting on.** WC-375F098A has been `blocked` since 22:45 UTC on September 4 with a status override that expires at 22:45 on September 5. Its activity log holds a semantic-review pass, an evidence note ("runtime implementation awaits initiative reviewer capability"), lease renewals, and nothing else: no request_coworker dispatch, no reviewer TaskRun, no coworker offer, no open decision review. The design readiness projection for the item it filed (BI-E3B918C2) lists six unmet gates (RESEARCH_REQUIRED, CANONICAL_DESIGN_REQUIRED, SPEC_APPROVAL_REQUIRED, REVIEW_REQUIRED, OBJECTIVE_BASELINE_REQUIRED, ARTIFACT_AUTHOR_REQUIRED) whose accountable roles are reviewer roles the author cannot hold. The room is therefore not queued behind platform work; nothing was ever dispatched, and the platform shows no "waiting on X" pointer that would let an operator tell the difference. This is the bottleneck the operator is seeing: initiative-readiness.v2 moved review work from the authoring thread into the platform's reviewer lanes, and when a lane has no dispatch in flight the thread waits on nobody. The readiness output must name a pending dispatch id or say plainly that no one is coming (see AC-MCP-RECOVERY 5 and the new AC-MCP-RECOVERY 6 in the addendum).

### 2. Successful listings can discard their useful data — high priority

`list_workrooms({limit:100})` returned success and a summary of 100 scanned, 22 live and 64 reap candidates. The transport replaced the 105,701-character data object with `_truncated`, a generic note and a 2,000-character preview. Neither the capsule array nor the structured summary remained. These are counts from that scan, not estate totals. From Claude Code the same call returned the same marker at 105,474 characters: the defect is server-side and client-independent.

`list_workrooms({limit:10})` returned ten structured records. Its schema has limit and filters, but no cursor, so the generic suggestion to paginate cannot traverse the omitted records. `apps/web/app/api/mcp/v1/route.ts:623` applies the substitution; the budget is `MCP_ROUTE_TOOL_RESULT_CHAR_CAP = 100_000` in `tak/tool-result-budget.ts:42`, whose comment says it "matches Claude Code's default tool-result cap".

That premise no longer holds, and it is the client-specific half of this finding. Claude Code's documented behaviour at its 25,000-token default (`MAX_MCP_OUTPUT_TOKENS`) is to persist the oversized result to disk and hand the model a file reference; a server may raise one tool's threshold to 500,000 characters by setting `_meta["anthropic/maxResultSizeChars"]` on the `tools/list` entry. Codex CLI 0.152.0 (September 1) added a per-tool `output_token_limit` on the client side. So on both current clients the data would have survived the client boundary; DPF's preview marker destroys it first, and the route emits no `_meta` at all. BI-3CE72645 should repair the page/read contract rather than raise the cap, but the marker itself must degrade to a typed summary (counts, livenessSummary, a continuation) instead of a string preview, and list tools should carry the per-tool size hint for clients that honour it.

### 3. The efficiency report silently excludes newer activity — high priority

Requested `analyze_mcp_call_efficiency({windowHours:168,notify:false,dispatchAiOps:false})` at 23:51 UTC. It returned 5,000 calls with observed boundaries August 28 23:51 through August 29 08:20, successRate=0.946 and ledgerSufficiency.usable=true. A separate one-hour query returned 94 calls from September 4, proving newer records exist. The Claude Code re-run at 00:18 UTC on September 5 returned boundaries August 29 00:18 through 08:30: the observed window slides with the clock and is always the first eight or so hours of the requested range.

`operate/mcp-call-efficiency/report.ts:66` orders ascending and takes the caller's limit (default 5,000, loader maximum 20,000); the MCP tool schema does not expose that limit at all. The analyzer reports the observed events' boundaries, not requested-window coverage. The seven-day result therefore cannot support a seven-day health claim. The same loader feeds the scheduled job `queue/functions/mcp-call-efficiency-scan.ts` (cron 06:15 UTC, `windowHours: 24`, `notify: true`, `dispatchAiOps: true`), so every daily alert and AI Ops dispatch describes roughly 06:15–14:00 of the previous day and never the remaining sixteen hours. The critical findings in both live runs (single owner sessions calling `claim_nonprod_environment_lease` 243, 230, 189 and 130 times, all with `agentId: "unknown"`) are real leads, but they are from August 29 and would be re-filed as "current" by any dispatching run.

The sampled 178 failures in 597–602 get_backlog_item calls are an investigation lead, not a current defect rate. Cadence/refusal suppression also means headline success and per-tool figures have different denominators.

Preserve ToolExecution as the ledger. BI-4BB68EB6 should make requested range, observed range, population count and completeness explicit, then aggregate with bounded memory, and must gate the daily dispatch on a complete or explicitly partial-labelled scan. tools/list and pre-auth failures remain unlogged gaps already acknowledged in the canonical efficiency design. Claude Code 2.1.222 fixed `/usage` MCP attribution so a server's token share reflects only requests that consumed its results; that is an independent, client-side measurement of DPF's context cost worth recording alongside the ledger.

### 4. Enumeration is available but poorly explained — medium priority

The current Codex catalog exposes 251 DPF callable entries. A query for installation health status loaded 16 tools, including unrelated employee and staffing tools. From Claude Code the identical query returned the identical 16 names. `tak/tool-intent.ts` uses token overlap, a threshold greater than zero, registry-order ties, and a cap of 16 (`LOAD_TOOLS_BATCH_MAX`). This explains low-specificity discovery without implying authorization is broken.

`load_tools` returns the same no-granted-match message for several causes. Safe structured reasons and the supported workflow entry point would reduce speculative searches. Never expose confidential ungranted inventory just to improve diagnostics. The waiting thread in finding 1 hit exactly this: its override reason reads "exact tool discovery returned no granted design/architecture/plan receipt tools and marketplace has no route", which is the correct authorization outcome for an author, presented as a dead end.

Client-specific context. Both installed plugin configs (`claude.mcp.json`, `codex.mcp.json`) request `?tier=full`; Grok and Antigravity omit the hint and fall to the server default. Full-tier discovery for Codex is deliberate: the host indexes definitions and attaches them lazily. Claude Code does the same through its own ToolSearch index over tool name and description: in the September 5 session every DPF tool arrived deferred, and `load_tools` only matters on Claude if the model reads the server instructions and calls it. So on Claude the ranking that decides whether an intent finds a tool is the client's, not `tool-intent.ts`, and the one lever DPF controls on both clients is the first sentence of each tool description. Claude Code also caches remote discovery (`MCP_DISCOVERY_CACHE`) and, on its v2 runtime (default since 2.1.232), receives `list_changed` over a held stream; the route already answers `listChanged: true`. Catalog character size is not equivalent to tokens billed on every turn. Do not switch to core tier or strip installation/authority context without cross-client measurements.

### 5. Hook labels are a separate adapter problem — medium priority

The installed plugin's `hooks/hooks.json` has 16 PreToolUse command handlers (8 on `Bash`, 1 on `AskUserQuestion`, 7 on `Write|Edit|MultiEdit`), 6 SessionStart, 3 SessionEnd and 2 Stop, plus WorktreeCreate. Every handler carries exactly two keys, `type` and `command`; the file contains no `statusMessage` and no `description`. The Codex user hook plane (`~/.codex/hooks.json`) and the Grok plane (`~/.grok/hooks/dpf-guards.json`) are generated from this managed copy by `packages/dpf-skill-pack/scripts/update_agent_toolchain.py`, so there is one source to label. The screenshot labels them by ordinal. Existing MCP ToolDefinition.title support does not prove hook-list label support: these are different schemas and host surfaces.

Both clients now document the same field. Codex hook handlers accept `statusMessage`, `timeout`, `async`, `additionalContextLimit` and `commandWindows`. Claude Code 2.1.x hook handlers accept `statusMessage` (spinner text while the hook runs), `timeout`, `async`, `asyncRewake`, `if` (permission-rule filter) and `once`, with handler types `command`, `http`, `mcp_tool`, `prompt` and `agent`; its `/hooks` menu labels entries by `[type]` and source only, and a plugin `hooks.json` may carry a top-level `description`. Whether `statusMessage` is what either list renders as the row label is unverified; that is the prototype FLOW-MCP-HOOK must settle.

SessionStart 1–6 map to process-spine health, governance freshness, worktree hygiene, heartbeat, root-clone freshness and readiness banner. SessionEnd 1–3 map to uncommitted-work guard, heartbeat and hygiene; Stop 1–2 map to uncommitted-work guard and heartbeat. All run synchronously: eight Node processes per Bash call and six at every session start.

The screenshot's trust state differs from saved trust hashes; execution was not functionally established. Do not silently trust/re-enable hooks during a labeling change. The original statement that descriptions alone explain the numbered UI was too certain: absent metadata is verified, but the Codex list's choice of label has not been traced to UI source.

Client capabilities DPF does not yet use, recorded here as candidates for the adapter work and not as this iteration's scope: `async: true` for heartbeat and hygiene hooks; `if` filters so a Bash guard runs only for matching commands; the `mcp_tool` handler type, which lets a heartbeat call `heartbeat_workroom` directly instead of spawning Node; `SubagentStart`, which is the mechanical fix for AGENTS.md §4 "subagents do not read this file"; `PreCompact` to persist a workroom handoff before context loss; `WorktreeRemove` to guard junctioned worktree deletion; `PostToolUseFailure` and `Elicitation`. Codex 0.153.0 (September 3) added `Interrupt` hooks and MCP handlers inside hooks. Since 2.1.248 Claude Code treats a hook stdout `{…}` that is not valid JSON as a hook error rather than text, so every DPF hook script's output contract needs checking against that rule.

## Client release drift

Clients ship weekly; this review must be read against specific versions. Installed: Claude Code 2.1.200 (latest 2.1.261, 61 releases behind), Codex Desktop, Codex CLI latest 0.153.4 (September 4). Changes since the installed Claude Code version that touch these findings: 2.1.222 `/usage` MCP attribution; 2.1.224 tools that connect mid-turn are deferred with their names announced; 2.1.232 v2 runtime default, asking HTTP servers whether they support MCP 2026-07-28; 2.1.238 no `server/discover` before `initialize`; 2.1.247–2.1.248 hook output handling; 2.1.259 concurrent sessions no longer revert each other's `~/.claude.json`, which matters on an install running many sessions. Codex: 0.151.0 grace period for optional MCP server discovery; 0.152.0 per-tool `output_token_limit`; 0.153.0 `Interrupt` hooks, extensions that can inspect or replace MCP tool results, plugin marketplaces.

The protocol moved too. MCP 2026-07-28 was released on July 28 with a stateless core, Multi Round-Trip Requests replacing server-initiated `elicitation/create` and `sampling/createMessage`, cacheable list results (`ttlMs` and `cacheScope` on `tools/list`), a formal extensions framework, and Tasks moved out of the experimental core into the `io.modelcontextprotocol/tasks` extension with poll-based `tasks/get` and a new `tasks/update`. The route header pins 2025-11-25 and implements `tasks/submit|get|result|list|cancel` in the experimental shape. EP-E1F1DB58's "standard Tasks" target has therefore changed under it; that is an epic-scoping input, not a slice of this iteration. Every benchmark this iteration produces must record client name and version, negotiated protocol revision, and DPF source SHA, and the three probes above are cheap enough to re-run after each client upgrade.

## Recommendation and scope

Use the [consolidation addendum](../specs/2026-09-04-mcp-client-contract-consolidation-design.md). First deliver recoverable external-author contracts and truthful metrics, then bounded traversal; fold labeling/discovery into existing BI-1BA8F46C. Existing BI-154689E7 and its delivery-closeout addendum own asynchronous acceptance and cleanup.

Kernel advisory DI-432289AB11A5 recommends contract-consolidation with high confidence and no commandment conflict. It uses disclosed assessment magnitudes, not empirical measurements. Initial featureless consultation DI-E620488486F2 produced no usable signal; it is not an approval. The advisory selects direction, not implementation-gate receipts.

Reserve 20–30% of implementation effort for removing duplicated field parsing, recovery guidance and result projection. Count eliminated independent definitions and covered consumer seams, not just deleted lines. Each slice remains one independently verifiable PR with its own acceptance evidence. Do not add new guards merely to compensate for leaving duplicated rules in place.

## Evidence and status

Read-only live calls from two clients establish the defects described above; GitHub bodies establish the reported historical chains; client behaviour is taken from the vendors' published documentation and changelogs as of September 5 and from the installed plugin files. No platform source behavior, runtime configuration, hook trust or peer workroom was changed in this review. The Claude Code `load_tools` probe appended 16 tools to that session's list, which is the tool's documented discovery-only effect. Follow-up items are triage intake with this draft design, not implementation-ready approvals. The catalog/read/recovery benchmarks must run after each implementation and on the deployed build before claiming an improvement works.
