---
status: active
---

# External initiative-review workflow repair

- **Primary backlog item:** `BI-6804F720`
- **Related plan-coverage defect:** `BI-0996913C`
- **Workroom:** `WC-12BC22D4`
- **Design:** [`2026-08-24-external-mcp-coworker-thread-context-design.md`](../specs/2026-08-24-external-mcp-coworker-thread-context-design.md)
- **Architecture decision:** `DI-BCCA7F3AC101` — use the existing auth-bound remote-task substrate for threadless external MCP callers

## Outcome

An authenticated external Codex, Claude, Grok, embedded, or generic MCP caller can request or summon the independent Change Reviewer with an immutable initiative-design packet. The reviewer executes under its own Principal and `initiative_design_review` grant, so a passing `spec-approval` receipt atomically creates `initiative_scope_baseline`; the author remains unable to self-approve; plan coverage can then be recorded against the baseline.

## Deliverable

This is one workflow repair, not two independently shippable changes. The request and summon doors share one threadless adapter and one task-idempotency contract; shipping only one leaves the documented reviewer route client-dependent.

| Key | Backlog item | Independently shippable | Depends on |
| --- | --- | --- | --- |
| `external-initiative-review` | `BI-6804F720` | no | existing coworker Principal/grant and initiative-readiness receipt writers |

## Traceability

- **Requirements:** `OBJ-GPCR-001`, `OBJ-GPCR-002`, `OBJ-GPCR-003`, plus the external-handoff objective baseline in the linked design.
- **Contracts:** `request_coworker`, `summon_coworker`, `submitRemoteCoworkerTask`, `record_initiative_design_review`, `record_plan_backlog_coverage`.
- **Flow:** external Workroom -> named reviewer task -> reviewer Principal/grant -> immutable `spec-approval` -> atomic `initiative_scope_baseline` -> plan coverage.
- **Verification:** both external doors dispatch; exact target/artifact packet survives; retry is exactly-once and token-bound; conflicting replay refuses; portal-thread behavior is unchanged; reviewer conformance and self-review refusal remain green; coverage succeeds with a baseline; missing-baseline copy names the reachable action and no stale BI.

## TDD phases

1. **Red — external routing.** Replace the current `missing_threadId` expectations with failing request/summon tests for verified PAT context, deterministic `requestKey`, exact immutable reviewer packet, and the shared host matrix.
2. **Red — idempotency.** Add focused remote-task tests for same token/key replay, conflicting envelope refusal, another token isolation, and concurrent uniqueness through a deterministic public task id.
3. **Green — shared adapter.** Add one adapter behind both coworker handlers. Preserve the portal-thread collaboration owners and reject threadless non-PAT contexts.
4. **Green — task identity.** Bind task identity to token plus request key and bind replay to an immutable request digest. Keep target resolution and agent grants server-side.
5. **Refactor.** Keep transport/result/error mapping in the shared adapter and keep task-id generation in the canonical autonomous-work owner; do not duplicate either handler.
6. **Verify.** Run the focused coworker, remote-task, autonomous-run, single-principal, baseline, and plan-coverage tests plus typecheck if the managed worktree reaches compile-ready.
7. **Live proof after deployment.** From an external MCP client, request and summon `AGT-WS-REVIEW` against the immutable `BI-B131F357` design, capture the receipt/baseline ids, retry for idempotency, then record the existing immutable plan's coverage.

## Publication exception

The operator explicitly directed this repair to bypass the local/pregate gate because that gate is the blocked subject workflow. The branch will still carry DCO, focused test evidence, an independent semantic review receipt, and protected GitHub CI. No local-CI evidence will be claimed.
