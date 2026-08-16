# Backlog convergence Batch 7 implementation plan

**Date:** 2026-08-13
**Capsule:** WC-66B084B6
**Umbrella:** BI-5659D187
**Design authority:** `docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md`

## Outcome

Land one cohesive reliability and work-convergence PR for ten audited BacklogItems. Five items are verified-existing outcomes whose requested behavior is already on `main`; the other five extend the ratified Universal Work Formula without creating parallel substrate.

## Validity and overlap result

| BacklogItem | Disposition | Grounding |
|---|---|---|
| BI-CAP-766BD341 | verified-existing | Context-sized total attachment cap, role/core/intent phasing, grant-preserving `load_tools`, and selection-cliff tests already live in `coworker-tool-budget.ts`. |
| BI-7E80080E | verified-existing | Slot-scoped Postgres ownership plus the two-minute admitted-lease heartbeat supervisor and quiescence-safe queue recovery already live on `main`. |
| BI-BC4AE430 | verified-existing / duplicate | PR #4063 shipped the requested diff-scoped clock-bomb guard, self-tests, CI registration, sweep rationale, and paved fix guidance under BI-E104FBCC. |
| BI-ED1B1EA5 | verified-existing | Host-side Apple Silicon unified-memory detection, persisted host profile, model-tier selection, served-context sizing, installer wiring, and tests are already live. |
| BI-19685F4B | implement focused remainder | Generic no-eligible copy is honest, but context exclusion details are still discarded. Preserve structured context shortfall details and make the coworker response actionable; do not bypass routing policy by force-running an ineligible endpoint. |
| BI-321FA58B | implement retrieval repair | The principle file exists but `wiki_query` returns no result when embeddings are unavailable. Add an overlay-aware Postgres lexical fallback so durable doctrine remains retrievable. |
| BI-5659D187 | implement | Expand the carrier-neutral WorkUnit contract, add TaskRun adaptation, and route case/customer projection through the single status authority. |
| BI-650994D7 | implement | Complete canonical WorkItem anchoring for both backlog-backed and ad-hoc capsules, and load capsules by `workItemId` before the legacy backlog fallback. The FK/migration already exist and are not duplicated. |
| BI-C2EB2C6B | implement | Add an idempotent terminal execution reconciliation core that clears stale active links, preserves retry intent, and refuses to infer `done` without governed completion evidence. Couple it to the existing capsule reaper. |
| BI-BC6099FE | implement | Add a source-registry-backed WorkUnit conformance guard and the paved-road `dpf-bring-work-under-formula` skill. |

Active Work Room, edge-fleet, estate, federation, and pinned-pnpm branches were excluded after live build, PR, and worktree overlap checks. No selected implementation file is knowingly owned by those efforts.

## Deliverables and order

1. **Canonical contract and projection** (`BI-5659D187`): write red tests, expand `WorkUnit`, add TaskRun adapter, and expose `projectWorkUnitState`; make build customer status a thin adapter.
2. **Canonical anchor and case join** (`BI-650994D7`, depends on 1): write red tests for ad-hoc capsules and work-item-first case loading; extend the existing anchor rather than add another identity path.
3. **Terminal reconciliation** (`BI-C2EB2C6B`, depends on 1 and 2): model terminal outcomes as explicit actions, clear stale execution links, reopen abandoned/retryable work, and leave completion pending unless server-resolved evidence exists; run idempotently from the governed reaper path.
4. **Conformance and paved road** (`BI-BC6099FE`, depends on 1–3): register carriers/adapters, add a CI guard that fails unregistered work carriers and bespoke projectors, register it with policy guards, and add the canonical skill.
5. **Doctrine retrieval** (`BI-321FA58B`): add tested Postgres lexical fallback with org-overlay masking and principle filters when embeddings cannot be generated.
6. **Honest routing failure** (`BI-19685F4B`): retain exclusion reasons and render context required/served numbers when present; keep policy exclusions fail-closed.
7. **Verified-existing evidence** (five listed items): run their direct regression suites on the exact candidate tree and record one evidence activity per item before lifecycle closure.

## Verification

- Focused Vitest/Node tests for every modified pure module and guard.
- Production web build with zero TypeScript errors.
- Local merged-code CI against current `origin/main` in the governed shared sandbox.
- DCO semantic review receipt, PR health, and merge queue.
- Canonical `/ops/self-upgrade` to the exact merged SHA on the live install.
- Live validation: `wiki_query` finds Universal Work Formula without embedding availability; coworker no-eligible context copy is honest; work-case/capsule paths remain healthy. No new migration is expected because the nullable FK migration already exists.

## Documentation impact

The conformance skill and this plan are the contributor-facing documentation. Existing architecture/design docs remain authoritative; code points back to them. Install docs change only if implementation discovers a host-contract delta (none is planned).

## Backlog coverage receipt

Receipt `cmss6goto01af01qwu64a8oyw` records the decomposed ten-item mapping above. Dependency order is contract → anchor → reconciliation → conformance; doctrine retrieval, routing honesty, and verified-existing evidence are independent.
