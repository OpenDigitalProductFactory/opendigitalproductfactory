---
status: draft
---

# MCP client contract review — September 4, 2026

Review: BI-DC0F14E0 · Workroom WC-B2E2DA53 · Epic EP-E1F1DB58.
Source inspected: `f62c1edb4b5cead926f8f69913fa29b73845f9cb`.
Live observations: operator development install, September 4, approximately 23:45–23:57 UTC.
This is an architecture review and proposed iteration, not a claim that runtime defects are fixed.

## Finding

The MCP connection works, but several contracts do not let clients reliably finish the next step. The strongest evidence concerns incomplete recovery instructions, destructive result truncation, and incomplete measurement coverage. These deserve priority over adding more tools or instructions.

The architecture is not an untouched monolith. `apps/web/lib/mcp-tools.ts` is 675 lines at the inspected revision; its registry imports 90 domain packs. That consolidation is valuable. The remaining problem is consistency across schema, handler, persistence, transport, and client presentation. Preserve this architecture and repair those boundaries.

## PR sample and limits

The adjacent [300-row sample](2026-09-04-mcp-pr-sample.csv) preserves GitHub API values retrieved with:

```text
gh pr list --repo OpenDigitalProductFactory/opendigitalproductfactory --state merged --limit 300 --json number,title,createdAt,mergedAt,additions,deletions,changedFiles,url --search 'merged:>=2026-08-06'
```

The cap was reached. This is a recent bounded sample, not all PRs in August or all historical defects. Its merge timestamps span August 27 05:06 to September 4 21:53 UTC. Title-prefix classification gives:

| Prefix | PRs |
| --- | ---: |
| fix | 189 (63%) |
| feat | 56 |
| doc / docs | 44 |
| build | 6 |
| test | 2 |
| refactor | 1 |
| perf | 1 |
| other | 1 |

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

The operator supplied a reproduction from the task owning BI-154689E7. This review independently read WC-375F098A and confirmed `baseSha: null`, `headSha: 4053e900d8d178f9a4c61b0defc79e2d69c1c5a6`, branch `feat/delivery-closeout-efficiency`. The supplied expected base is `f62c1edb4b5cead926f8f69913fa29b73845f9cb`; the peer's readiness receipt is IRD-C005F9D89744.

At source revision above:

- `work-capsules/governed-work-claim.ts:137` requires an immutable base/head to discover reviewer artifacts, but recommends adoption with only headBranch/headSha.
- `backlog/initiative-readiness/canonical-artifact-discovery.ts:90` repeats the incomplete repair; malformed base/head is classified as provider-unavailable before any provider call.
- `backlog/initiative-readiness/readiness-guidance.ts:169` and `tak/initiative-readiness-tool-grants.ts:370` both carry generic author/sign/push guidance.
- Direct loading of reviewer-only writers is not the author workflow. Existing implementation-readiness recovery returns reviewerRoutes for request_coworker. Plan review uses record_initiative_design_review with gate=plan-review.

The missing base is confirmed. This review did not mutate the peer's workroom or test whether supplying it completes review. A missing direct writer is not proof the workflow is unavailable. Capture this as BI-CF118B6D, preserving independent-review authority.

### 2. Successful listings can discard their useful data — high priority

`list_workrooms({limit:100})` returned success and a summary of 100 scanned, 22 live and 64 reap candidates. The transport replaced the 105,701-character data object with `_truncated`, a generic note and a preview. Neither the capsule array nor the structured summary remained. These are counts from that scan, not estate totals.

`list_workrooms({limit:10})` returned ten structured records. Its schema has limit and filters, but no cursor, so the generic suggestion to paginate cannot traverse the omitted records. `apps/web/app/api/mcp/v1/route.ts:627` owns the preview substitution. BI-3CE72645 should repair the existing page/read contract rather than increase the response cap.

### 3. The efficiency report silently excludes newer activity — high priority

Requested `analyze_mcp_call_efficiency({windowHours:168,notify:false,dispatchAiOps:false})` at 23:51 UTC. It returned 5,000 calls with observed boundaries August 28 23:51 through August 29 08:20, successRate=0.946 and ledgerSufficiency.usable=true. A separate one-hour query returned 94 calls from September 4, proving newer records exist.

`operate/mcp-call-efficiency/report.ts` orders ascending and takes 5,000; the analyzer reports the observed events' boundaries. It does not report requested-window coverage. The seven-day result therefore cannot support a seven-day health claim. The sampled 178 failures in 602 get_backlog_item calls are an investigation lead, not a current defect rate. Cadence/refusal suppression also means headline success and per-tool figures have different denominators.

Preserve ToolExecution as the ledger. BI-4BB68EB6 should make requested range, observed range, population count and completeness explicit, then aggregate with bounded memory. tools/list and pre-auth failures remain unlogged gaps already acknowledged in the canonical efficiency design.

### 4. Enumeration is available but poorly explained — medium priority

The current Codex catalog exposes 251 DPF callable entries. A query for installation health status loaded 16 tools, including unrelated employee and staffing tools. `tak/tool-intent.ts` uses token overlap, a threshold greater than zero, registry-order ties, and a cap of 16. This explains low-specificity discovery without implying authorization is broken.

`load_tools` returns the same no-granted-match message for several causes. Safe structured reasons and the supported workflow entry point would reduce speculative searches. Never expose confidential ungranted inventory just to improve diagnostics.

Full-tier discovery for Codex is deliberate: the host indexes definitions and attaches them lazily. Catalog character size is not equivalent to tokens billed on every turn. Do not switch to core tier or strip installation/authority context without cross-client measurements.

### 5. Hook labels are a separate adapter problem — medium priority

The installed plugin has 16 PreToolUse, 6 SessionStart, 3 SessionEnd and 2 Stop command handlers, plus WorktreeCreate. Definitions provide script commands without descriptive status metadata. The screenshot labels them by ordinal. Existing MCP ToolDefinition.title support does not prove hook-list label support: these are different schemas and host surfaces.

SessionStart 1–6 map to process-spine health, governance freshness, worktree hygiene, heartbeat, root-clone freshness and readiness banner. SessionEnd 1–3 map to uncommitted-work guard, heartbeat and hygiene; Stop 1–2 map to uncommitted-work guard and heartbeat.

The screenshot's trust state differs from saved trust hashes; execution was not functionally established. Do not silently trust/re-enable hooks during a labeling change. The original statement that descriptions alone explain the numbered UI was too certain: absent metadata is verified, but the Codex list's choice of label has not been traced to UI source.

## Recommendation and scope

Use the [consolidation addendum](../specs/2026-09-04-mcp-client-contract-consolidation-design.md). First deliver recoverable external-author contracts and truthful metrics, then bounded traversal; fold labeling/discovery into existing BI-1BA8F46C. Existing BI-154689E7 and its delivery-closeout addendum own asynchronous acceptance and cleanup.

Kernel advisory DI-432289AB11A5 recommends contract-consolidation with high confidence and no commandment conflict. It uses disclosed assessment magnitudes, not empirical measurements. Initial featureless consultation DI-E620488486F2 produced no usable signal; it is not an approval. The advisory selects direction, not implementation-gate receipts.

Reserve 20–30% of implementation effort for removing duplicated field parsing, recovery guidance and result projection. Count eliminated independent definitions and covered consumer seams, not just deleted lines. Each slice remains one independently verifiable PR with its own acceptance evidence. Do not add new guards merely to compensate for leaving duplicated rules in place.

## Evidence and status

Read-only live calls establish the defects described above; GitHub bodies establish the reported historical chains. No platform source behavior, runtime configuration, hook trust or peer workroom was changed in this review. Follow-up items are triage intake with this draft design, not implementation-ready approvals. The catalog/read/recovery benchmarks must run after each implementation and on the deployed build before claiming an improvement works.
