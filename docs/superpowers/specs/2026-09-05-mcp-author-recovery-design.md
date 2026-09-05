---
status: draft
---

# External-author MCP recovery and actionable governance handoff

Backlog: BI-CF118B6D. Workroom: WC-0B137E7F.

This is the independently reviewable recovery slice of the [published consolidation design](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/99f5703813ac7290fe694325836f544e9857ae2f/docs/superpowers/specs/2026-09-04-mcp-client-contract-consolidation-design.md). It carries that design's section 2 acceptance unchanged. Efficiency aggregation, pagination and hook metadata are separate backlog items and are not part of this scope baseline.

## Purpose and authority boundaries

An external author must receive an executable next step when identity, evidence or reviewer prerequisites are missing. Preserve the existing initiative readiness projector, Workroom identity, reviewerRoutes, TaskRun lifecycle, scope baseline and ToolExecution ledger. No new orchestration service, ledger or receipt-writer tool. No database migration is proposed. Additive diagnostics preserve existing inputs and grant enforcement; missing identity must never become permission to self-approve.

The audited process failure is a documentation parent receiving coverage recovery that cannot produce the promised reviewer route. Bind this implementation slice to its actual refactor BI, preserving that BI's feature review gates. Do not reclassify the documentation parent or exempt it from baseline validation merely to pass a test.

### Research & Benchmarking

| Reference | Adopt | Do not infer or adopt |
| --- | --- | --- |
| [MCP tools, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Human titles, explicit input/output contracts, valid structured results. | Metadata alone guarantees a client's UI or permission enforcement. Serialized text alongside structured data is a compatibility recommendation, so deduplication must be measured at the host boundary. |
| [MCP pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination) | Opaque continuation and unambiguous completion for listings. | Protocol tools/list pagination automatically paginates a domain list_workrooms result; implement its domain contract explicitly. |
| [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) | Record the negotiated revision in every benchmark; note `ttlMs`/`cacheScope` on `tools/list` and the `io.modelcontextprotocol/tasks` extension (`tasks/get`, `tasks/update`) as inputs to EP-E1F1DB58 scoping. Claude Code's v2 runtime already asks HTTP servers whether they speak it. | Re-platforming the route on the new revision inside this iteration, or treating the current experimental `tasks/submit|result` surface as the standard one. |
| [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) | Per-tool `_meta["anthropic/maxResultSizeChars"]` on list tools; `list_changed` over the v2 held stream; `/usage` per-server attribution as an independent context-cost measure. | That the 100,000-character route cap "matches" Claude Code: the client keeps what the server discards. That ToolSearch ranks the way `tool-intent.ts` does. |
| [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference) | Per-tool output truncation budgets, verified against the supported host and configuration adapter. | Raising `output_token_limit` guarantees lossless persistence, or a CLI setting automatically applies to the installed Desktop client. |
| [Codex hooks](https://learn.chatgpt.com/docs/hooks) · [Claude Code hooks](https://code.claude.com/docs/en/hooks) | Source inspection, exact-definition trust, and the `statusMessage` field both clients document; generate it once into the managed `hooks.json` that feeds all three hook planes; verify the rendered client. | Unsupported hook title fields, automatic trust changes, or assuming `statusMessage` names the list row on either client. |
| [OpenTelemetry GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | Align future measurements with tool execution identity, latency and outcome vocabulary; keep the existing ledger. | A new telemetry backend or prompt-content collection as a prerequisite for this repair. |

Compared implementation patterns: DPF's existing domain-pack registry (retain), the MCP standard's typed tool/result boundary (adopt), and the hosts' own hook/trust adapters and result persistence (respect and test). A generic action facade is rejected for this iteration because it moves risk into hidden action schemas and duplicates existing governance. No third-party dependency is required.

## 2. External-author recovery — BI-CF118B6D

Contract CT-MCP-RECOVERY, journey FLOW-MCP-AUTHOR.

Consolidate missing-identity diagnosis and repair construction into the existing initiative recovery subsystem. Both read-only readiness and attempted transitions consume that projection. A read does not dispatch reviewers or mutate readiness. Expensive artifact resolution stays outside write transactions and should reuse existing immutable artifact information.

Adoption remains compatible with legitimate early work that has no commit yet, but returns missing baseSha/headSha and the gates they prevent. Do not label missing identity as a provider outage. Repairs include all required adoption identity, retain supplied valid values, and identify values that must still be resolved. Never invent SHAs. Do not advise re-signing unless signature evidence actually fails. The ARTIFACT_AUTHOR_REQUIRED remedy currently lives in two files with identical text; one of them goes.

Discovery distinguishes a callable tool from a workflow route. When authority permits revealing the distinction, identify unknown names, unavailable direct grants and reviewer-only execution; otherwise use a non-enumerating unavailable reason plus a safe supported entry point. Route author review through existing readiness/reviewerRoutes/request_coworker. The incorrect record_initiative_plan_review name must not be created as a workaround.

A blocked room must be distinguishable from a waiting one. The audit snapshot of WC-375F098A records unmet reviewer-role gates without a dispatched reviewer. Project prerequisite readiness separately from reviewer execution: missing author identity or artifact evidence carries exact missing fields and a repair packet; an unavailable provider carries its observed error, retryability and next action. Neither proves that no eligible reviewer exists. Once prerequisites permit routing, expose an eligible route, an actual pending dispatch with an inspectable id, or a confirmed reviewer-availability escalation naming the role and capability gap. Preserve the existing TaskRun lifecycle for completed, failed or cancelled dispatches; terminal work must not appear as still pending. Unknown availability remains explicitly unknown with a finite diagnostic or escalation step. Reuse existing state types and projectors rather than adding an independent status ledger.

Acceptance AC-MCP-RECOVERY:

1. An adopted room missing only baseSha reports that exact field, preserves its valid head and yields a repair packet matching the actual adopt_worktree schema.
2. Read-only and transition recovery agree on missing facts, responsible role and next action.
3. A valid already-signed/pushed artifact does not produce re-sign/rewrite advice solely because baseSha is absent.
4. A complete author journey crosses adoption, published immutable artifact, readiness, independent reviewer dispatch, and persisted approval. Test author/referee identities separately and read the receipt back.
5. Negative cases include unknown writer name, author without direct writer grants, no eligible reviewer, missing base, missing head, inaccessible artifact, stale head and provider failure. Each has a finite next step or explicit escalation; no retry loop to an impossible direct writer.
6. Readiness, get_workroom and the Workroom list agree on prerequisite blockers, responsible role, next action and reviewer execution state. Missing baseSha yields an author repair, provider failure does not claim reviewer absence, and pending work cites a real dispatch. Failed, cancelled and completed dispatches are not shown as pending. An operator can distinguish blocked, actionable, queued and terminal work without reading the activity log.

Current reproduction: WC-375F098A / BI-154689E7, base expected f62c1edb4b5cead926f8f69913fa29b73845f9cb, head 4053e900d8d178f9a4c61b0defc79e2d69c1c5a6. Its owner tests repair; this design does not authorize another task to take over that room.

Additional acceptance AC-MCP-RECOVERY 7: recovery must be valid for the actual readiness profile and plan parent. Coverage on documentation parent BI-DC0F14E0 returned `traceability-incomplete` and prescribed an implementation claim; that claim returned IRD-52AD360FFE11, `doc-only`, `allowed`, and no reviewerRoutes. `planning/plan-backlog-coverage.ts` requires a baseline unconditionally, while `backlog/initiative-readiness/evaluate.ts` exempts documentation-only work from the gates that create it. This confirms unusable recovery guidance, not that baseline enforcement should be removed. BI-CF118B6D owns this regression alongside the other recovery failures.

Resolve the documentation-authoring versus implementation-parent binding in the existing planning contract. A profile-aware refusal must supply a valid supported next action or an explicit parent-binding correction with the required evidence; it must not promise reviewer routes that its recommended call cannot return. Reuse existing profile policy. Test the coverage refusal followed by its actual prescribed readiness call for doc-only, fix and feature profiles, including a documentation parent mapping feature children. Preserve immutable scope binding, feature/refactor approval and author/reviewer separation. No automatic reclassification, new umbrella or baseline exemption is authorized by this acceptance criterion. Keep the live blocking condition separate from the defect's tracking id.


## Implementation and verification boundary

Inspect the existing readiness guidance, canonical artifact discovery, governed-work-claim, workroom read projections, plan-backlog-coverage and readiness profile consumers. Consolidate repeated guidance and derive recovery from the existing profile policy. Allocate 20–30% of the slice effort to this consolidation and measure definitions removed and consumers covered.

Before implementation, publish a plan for this BI and bind its atomic internal steps to the approved scope baseline; obtain independent plan review. The first failing integration case follows the coverage error's own recommended call and detects the doc-only allowed/no-route dead end. Verify all AC-MCP-RECOVERY 1–7 scenarios across advertised schema, handler, persistence and readback. Use separate author and reviewer identities; preserve negative grant cases. Record actual dispatch ids and read persisted approval back before claiming reviewer completion.

Source-local checks precede canonical shared nonproduction verification. Check operator-visible state in the Workroom list and detail as well as MCP projections. Unit mocks cannot be the only authority/provider test. No implementation or runtime verification has been performed by this design publication.

Risk: inconsistent consumer state or accidental authority expansion. Revert the scoped projector/adapter change together while preserving immutable records and existing receipts. A needed schema migration or altered governance rule requires explicit design revision before implementation.
