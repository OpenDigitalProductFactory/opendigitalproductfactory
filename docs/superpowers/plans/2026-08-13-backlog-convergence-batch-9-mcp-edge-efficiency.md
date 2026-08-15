# Batch 9 — MCP and Edge Call-Efficiency Reliability

## Goal

Resolve ten live reliability BacklogItems without implementing their unverified intake hypotheses. The batch repairs the one measured source of avoidable edge traffic, teaches the efficiency analyzer about contractual machine cadence, and verifies the already-landed tool-honesty and lease outcomes that supersede the remaining recommendations.

This is the ninth ten-item campaign batch and the third batch in the current 50-item campaign. It serves MSP operators and this installation by reducing always-on edge noise while preserving fast liveness, discovery freshness, governed leases, and honest coworker answers.

## Live backlog scope

1. `BI-MCP-EFF-CB6E0EB0` — discovery-run high-volume diagnosis
2. `BI-MCP-EFF-25168AA6` — heartbeat high-volume diagnosis
3. `BI-MCP-EFF-DE4DA06B` — federation-candidate high-volume diagnosis
4. `BI-5556C36F` — umbrella edge heartbeat/federation investigation
5. `BI-MCP-EFF-CC6BC37A` — nonprod lease-renewal volume
6. `BI-MCP-EFF-E7BBD514` — nonprod lease-list volume
7. `BI-SIG-90461D34` — nonprod lease-claim failures
8. `BI-CAP-5ECA6A51` — repeated `wiki_query` failure
9. `BI-CAP-167CBCF7` — repeated `review_estate_identity` failure
10. `BI-E72BA4CD` — authorized-surface failure misreported as empty data

## Validity and supersession audit

The live 168-hour efficiency request returned a capped 5,000-row ledger whose actual event window was only about 15.5 hours. Absolute call totals therefore cannot be interpreted as a full-window waste budget.

| BacklogItem | Disposition | Live/source grounding |
|---|---|---|
| BI-MCP-EFF-CB6E0EB0 | verified-existing / false diagnosis | The edge collector already combines host, ARP, and adapter observations into one idempotent envelope every authority-set five minutes. Current traffic matches that contract; no local queue or skill is warranted. |
| BI-MCP-EFF-25168AA6 | verified-existing / false diagnosis | The authority deliberately returns a 60-second heartbeat interval while readiness degrades after three minutes and declares offline after ten. Extending to five–ten minutes would erase the healthy detection margin. |
| BI-MCP-EFF-DE4DA06B | implement the real remainder | The endpoint and Go client already submit an array. The real waste is that the DNS-SD loop posts the same snapshot—including empty snapshots—every 15 seconds. Submit only changed non-empty snapshots and refresh them before the two-minute authority TTL. |
| BI-5556C36F | implement systemic investigation outcome | Preserve heartbeat liveness, remove redundant federation posts, and stop the analyzer from treating known healthy cadence as generic interactive-tool waste. |
| BI-MCP-EFF-CC6BC37A | verified-existing | Current ledger has 33 successful renewals and no failures; governed renewal is TTL-capped activity evidence, not blind status polling. No server-side immortal lease will be added. |
| BI-MCP-EFF-E7BBD514 | verified-existing / stale signal | Current ledger has six successful list calls, below the finding floor. FIFO admission and lease status are already returned by the canonical tools. |
| BI-SIG-90461D34 | verified-existing / stale signal | Current ledger has six successful claims and no failures. Existing tool contracts return retryability and exact lease identity; source tests cover occupied and queued paths. |
| BI-CAP-5ECA6A51 | superseded by PR #4275 | Current ledger has 29 successful calls; repeated use is one caller's identical-query thrash. PR #4275 adds the missing lexical fallback and is validated separately on the same deployed mainline. |
| BI-CAP-167CBCF7 | verified-existing | The live tool now rejects missing identity with an actionable request and reports a named miss honestly. It does not fabricate an estate result. A known-item happy path will be exercised before closure. |
| BI-E72BA4CD | superseded by PRs #4257, #4259, #4260, #4262, #4267 | Those merged changes prehydrate authorized surfaces, preserve response authority, require grounded coverage, and distinguish unavailable evidence from empty data. Exact source regressions and a populated live surface remain the completion gate. |

Active edge-fleet branches and unrelated TAK/inference work remain excluded. Code-graph search returned no indexed hits for the exact edge route names, so the overlap audit used repository history, active PR/worktree inspection, and explicit source search as the documented fallback.

## Governed scope decision

WWMD consultation `DI-385A8D57EBA4` recommended `validate_then_batch` with high confidence, composite `12.149`, margin `3.202`, and no commandment conflict. The batch therefore treats runtime evidence as the validity gate, implements only the coherent remainder, and closes stale or superseded items only with proportional evidence.

## Design

### Change-aware federation snapshots

Keep the existing array wire contract. In the native Go edge discovery loop:

1. canonicalize the already-sorted candidate snapshot;
2. do not submit an empty snapshot because the authority cache already expires absent candidates by TTL;
3. submit a non-empty snapshot immediately when its content changes;
4. refresh an unchanged non-empty snapshot before the authority's two-minute TTL;
5. retain the 15-second local discovery observation cadence so new peers remain prompt;
6. leave failed submissions eligible for the next observation tick.

This removes the current installation's no-peer steady-state traffic without weakening discovery or creating a second transport/tool.

### Contract-aware efficiency analysis

The analyzer must not infer waste from a global absolute count alone when a known machine route is operating at its designed cadence. Add a small source-owned cadence registry for edge heartbeat, discovery runs, and federation candidate refresh. Evaluate those tools per stable thread/agent identity and suppress only the `high_volume` finding when observed calls fit the contractual upper bound with a bounded jitter allowance. Failure, retry-storm, and same-thread thrash findings remain active; an over-cadence machine loop still produces a finding.

The report detail must state when contractual cadence suppressed a raw-volume finding so operators can distinguish “not analyzed” from “analyzed and healthy.”

## TDD and verification

1. Add failing Go tests for empty-snapshot suppression, change-triggered submission, TTL-safe refresh, and retry after failure.
2. Add failing analyzer tests for healthy multi-agent contractual cadence, over-cadence detection, and unchanged failure/retry behavior.
3. Implement the smallest change-aware loop and cadence-aware analysis that make the tests pass.
4. Run the affected Go and Vitest suites, TypeScript checks, policy guards, and production build.
5. Run the exact-tree merged-code gate and independent semantic review before opening the PR.
6. Merge through the queue and deploy only through `/ops/self-upgrade`.
7. On the canonical live installation, verify the deployed SHA, rerun the efficiency ledger, exercise wiki retrieval, estate identity honesty/happy path, a populated authorized surface, and canonical nonprod lease behavior.
8. Record server-resolved evidence and close all ten items with an explicit implementation, verified-existing, or superseded disposition.

## Documentation impact

The plan documents the changed internal operational contract. No public API shape, UI route, migration, prompt, or operator action changes. If implementation changes a tunable interval or host-specific contract, update the edge-node operator documentation in the same PR; otherwise no user-facing documentation change is required.

## Non-goals

- Adding a skill around REST edge ingestion.
- Replacing heartbeat with WebSocket/SSE without a separately ratified transport design.
- Lengthening heartbeat beyond the existing healthy-readiness window.
- Making nonprod leases immortal or bypassing FIFO/TTL governance.
- Reimplementing the authorized-surface or wiki fixes already merged or queued.

## Backlog coverage receipt

Receipt `cmssdc1hv0a2501p2pm4r3zyf` records a decomposed mapping from umbrella `BI-5556C36F` to all ten live items above. The edge-system deliverable depends on the discovery-contract, heartbeat-contract, and federation-change-aware deliverables; the seven verification/supersession outcomes are independently shippable.
