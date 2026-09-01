---
status: active
---

# Completion-readiness recovery plan

**Backlog item:** `BI-199F71B6`  
**Workroom:** `WC-0C842917`  
**Design:** `docs/superpowers/specs/2026-09-01-completion-readiness-recovery-design.md`
(`2026-08-25-initiative-readiness-reviewer-packet-design.md` is the parent
packet contract; the binding extension is specified by this plan's design.)

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
before any success claim, and `dpf-pr-with-dco` for handoff.

## Current state

- Live reproduction: completion for `BI-BFBF1BBB` / `WC-923105A2` recognizes
  eight passing delivery activities, but returns no executable
  acceptance-reviewer packet.
- Overlap: `BI-EDC0DAF2` and `BI-E2B632D2` own terminal-writer execution and
  replay; neither owns packet issuance from terminal transition refusals.
- Architecture: extend `resolveInitiativeReviewerRecovery`, canonical artifact
  discovery, Workroom liveness, and baseline-chain validation. Add no storage,
  writer, receipt, or review engine.

## Atomic deliverable

This is one clean revert: expose the already-designed recovery packet at the
two terminal MCP adapters. The registry addition, shared resolver, adapter
projection, tests, and API documentation are not independently useful because
none can close the route alone.

| Objective / acceptance | Contract | Flow | Verification |
|---|---|---|---|
| `OBJ-PACKET-TERMINAL`, `AC-PACKET-TERMINAL-001` | design §14.2 | refused terminal transition → shared recovery adapter → MCP response | BacklogItem and Workroom adapter tests |
| `OBJ-PACKET-MAPPING`, `AC-PACKET-TERMINAL-002`, `AC-PACKET-TERMINAL-005` | design §§14.2, 14.4 | acceptance requirement → evidence-writer lane → exact `objective-mapping` packet | registry, packet-schema, and live replay tests |
| `OBJ-PACKET-UNCHANGED`, `AC-PACKET-TERMINAL-003` | design §§14.1, 14.5 | allowed transition bypasses recovery | existing terminal-transition suites plus focused regressions |
| `AC-PACKET-TERMINAL-004` | design §§14.2–14.4 | missing/ambiguous identity → typed escalation → no dispatch | shared adapter failure fixtures |

## Phase 1 — RED: model the missing terminal route

Touched files:

- `apps/web/lib/tak/initiative-readiness-tool-grants.test.ts`
- `apps/web/lib/backlog/initiative-readiness/terminal-recovery.test.ts`

Add failing tests that prove the acceptance-reviewer requirements currently
produce no route, then specify an exact `objective-mapping` packet with the
current baseline. Specify unique live Workroom resolution and typed no-route
failure for missing/ambiguous Workroom, baseline, or canonical artifact.

Verification: run only the two focused Vitest files and retain the expected RED
failure before implementation.

## Phase 2 — GREEN: compose the canonical recovery substrate

Touched files:

- `apps/web/lib/tak/initiative-readiness-tool-grants.ts`
- `apps/web/lib/backlog/initiative-readiness/terminal-recovery.ts`
- `apps/web/lib/backlog/initiative-readiness/index.ts`

Add `acceptance-reviewer` as an objective-mapping proposal route on the existing
evidence writer without widening receipt gates. Implement the shared adapter
over canonical Workroom liveness, baseline-chain validation, provider artifact
discovery, and the existing reviewer resolver. Keep all reads bounded and all
failures fail-closed.

Verification: focused RED tests turn green; run all graph-linked readiness and
TAK tests returned by `find_related_tests`.

## Phase 3 — project recovery at both terminal adapters

Touched files:

- `apps/web/lib/backlog/mcp-terminal-status.ts`
- `apps/web/lib/work-capsules/mcp-handlers.ts`

On terminal refusal only, resolve recovery after the protected transaction and
attach it to the existing `initiative_not_ready` response. Pass the exact
Workroom id on the Workroom path. Do not alter verdicts, status mutations, or
success responses.

Verification: adapter regressions prove both paths expose the same shape and
allowed transitions remain byte-compatible apart from the absent recovery
field on failures.

## Phase 4 — documentation and functional acceptance

Touched files:

- `docs/architecture/mcp-tool-authorization-runbook.md`
- this plan and the binding design

Document that recovery bindings are server-issued and that terminal callers
dispatch the returned packet unchanged. After merge and canonical self-upgrade,
repeat the real `BI-BFBF1BBB` completion attempt, dispatch its returned packet,
record the objective mapping, and prove both the BI and Workroom close.

Verification: affected Vitest suites, `node scripts/check-style-drift.mjs`,
`pnpm --filter web build`, exact-tree pregate, PR health, canonical functional
replay. UX is not applicable because the change adds no UI; migration is not
applicable because it changes no schema.

## Risks and rollback

- Risk: treating objective mapping as a receipt gate would let a proposal look
  like approval. Control: keep `objective-mapping` out of
  `INITIATIVE_GATE_KEYS` and terminal evaluation unchanged.
- Risk: choosing the wrong room or stale baseline. Control: require one live
  room (or the exact refused room), immutable base/head, and validated current
  baseline chain; otherwise return no route.
- Risk: provider discovery adds latency to refusal. Control: run only after a
  terminal denial and retain the existing one-call bounded compare contract.
- Rollback: revert the additive recovery projection; terminal verdicts and
  mutations are untouched, restoring the prior honest-but-unexecutable refusal.

## Backlog coverage

- Decision: atomic
- Parent: `BI-199F71B6`
- Receipt: `cmtif5ip50c9k01mn8k70lx14`
- Rationale: The registry route, shared resolver, both refusal projections, tests, and documentation form one response contract and none is independently useful.
- Dependencies: `BI-EDC0DAF2` is merged and deployed; `BI-E2B632D2` remains separate replay hardening and does not block this source delivery.

## Progress evidence

- Phase 1 complete: focused RED proved the acceptance-reviewer requirement was
  unroutable and the shared terminal adapter did not exist.
- Phase 2 complete: the evidence-writer registry now emits an exact
  `objective-mapping` packet, and the shared resolver fails closed on Workroom,
  baseline, and artifact identity.
- Phase 3 complete: both terminal MCP adapters attach the same server-issued
  recovery shape on refusal and bypass recovery on success.
- Verification: 41 affected readiness tests pass, including registry, shared
  resolver, terminal repositories, Workroom liveness, and both MCP projections;
  style guard, web typecheck, and production build also pass. Exact-tree pregate,
  PR health, and canonical replay remain pending.
