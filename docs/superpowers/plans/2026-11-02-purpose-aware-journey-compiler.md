---
status: proposed
---

# Purpose-Aware Installation Journey Compiler Implementation Plan

| Field | Value |
| --- | --- |
| Date | 2026-11-02 |
| Backlog item | `BI-91EF130B` |
| Workroom | `WC-DA92E712` |
| Design | `docs/superpowers/specs/2026-11-02-purpose-aware-journey-compiler-design.md` |

## 1. Delivery agreement

Implement the read-only deterministic compiler inside the existing activation
orchestrator. This slice adds no UI, Prisma model, database migration,
federation writer, trust transition, or domain-specific first-value writer.

Recorded acceptance criteria, quoted verbatim:

1. “Five purposes × three environment classes compile deterministically.”
2. “Milestones resolve canonical evidence as satisfied, attention, blocked, deferred, or not-applicable.”
3. “Existing activation plans and legacy setup progress remain compatible.”
4. “Productive cannot be returned without profile first-value receipt.”
5. “No sibling orchestration substrate introduced.”

## 2. Work sequence

### Task 1 — Freeze compatibility and matrix behavior in red tests

Files:

- modify `apps/web/lib/workspace-home/activation-orchestrator/walker.test.ts` only if an explicit compatibility assertion is missing;
- add `apps/web/lib/workspace-home/activation-orchestrator/journey-compiler.test.ts`;
- add `apps/web/lib/workspace-home/activation-orchestrator/journey-fixtures.test.ts` only if the matrix becomes unreadable in one file.

Add failing tests for all 15 purpose/environment pairs, deterministic output
under reordered secondary purposes/relationships/evidence, incompatible
relationship inputs, the five statuses, stale observations, corrupt/unknown
evidence, and every first-value gate. Snapshot the existing `ActivationPlan`
shape before implementation. Commit the red tests and use exact-tree governed
local CI to record the expected failure.

### Task 2 — Add additive journey contracts

Files:

- modify `apps/web/lib/workspace-home/activation-orchestrator/types.ts`;
- modify `apps/web/lib/workspace-home/activation-orchestrator/index.ts`.

Add `JourneyConditionStatus`, evidence observation/condition, milestone
descriptor/result, action adapter, blocker, first-value mission, legacy
compatibility, compiler input, and `InstallationJourneyPlan` types. Preserve all
existing fields and exports. Use types from
`@dpf/db/installation-operating-intent`; do not duplicate the purpose or
environment unions.

### Task 3 — Add the versioned descriptor registry

Files:

- add `apps/web/lib/workspace-home/activation-orchestrator/journey-registry.ts`;
- add `apps/web/lib/workspace-home/activation-orchestrator/journey-registry.test.ts`.

Define a frozen registry with stable keys, canonical order, owning capability,
applicability, criticality, required evidence, route/action adapter,
human-decision flag, and staleness policy. Include the five first-value mission
descriptors. Enforce the 64-descriptor ceiling and uniqueness of milestone and
evidence keys.

### Task 4 — Implement pure evidence resolution

Files:

- add `apps/web/lib/workspace-home/activation-orchestrator/evidence-resolver.ts`;
- add `apps/web/lib/workspace-home/activation-orchestrator/evidence-resolver.test.ts`.

Resolve observations into the five closed statuses. Keep safe references and
observation fingerprints; exclude raw values. Resolve missing required evidence
as blocked, stale critical evidence as blocked, stale noncritical evidence as
attention, known future capability as deferred, and profile-inapplicable
evidence as not-applicable. Use an injected `observedAt` comparison boundary so
tests are deterministic; time is not included in semantic fingerprints.

### Task 5 — Implement the deterministic compiler

Files:

- add `apps/web/lib/workspace-home/activation-orchestrator/journey-compiler.ts`;
- update `apps/web/lib/workspace-home/activation-orchestrator/journey-compiler.test.ts`;
- modify `apps/web/lib/workspace-home/activation-orchestrator/index.ts`.

Validate input bounds, normalize unordered semantic sets, select applicable
descriptors, resolve conditions, preserve canonical registry order, build
blockers and the first-value mission, and compute a SHA-256 journey fingerprint
from semantic versions/references/statuses only. Accept an optional
`ActivationPlan` by reference in the result; do not reproduce its counts or
signal data. Return `productive` only when all critical milestones and the
matching first-value receipt are satisfied. Reserve `ecosystem-productive` for
an applicable, satisfied governed participation condition.

### Task 6 — Add legacy setup compatibility projection

Files:

- add `apps/web/lib/workspace-home/activation-orchestrator/legacy-setup-adapter.ts`;
- add `apps/web/lib/workspace-home/activation-orchestrator/legacy-setup-adapter.test.ts`;
- modify `apps/web/lib/workspace-home/activation-orchestrator/journey-compiler.ts`.

Map stable legacy setup step keys to milestone keys without importing route
components or writing `PlatformSetupProgress`. Preserve completed/skipped/pending
and out-of-order evidence. A legacy completion may satisfy a matching setup
milestone but never a first-value receipt, federation trust, or standards
qualification.

### Task 7 — Regression, architecture, and scope verification

Run targeted tests for the activation orchestrator, setup-progress projection,
and installation operating intent. Run TypeScript/build gates through governed
local integration CI on the exact commit. Scan for:

- duplicate purpose/environment unions;
- a second orchestrator/registry outside the existing package;
- Prisma schema or migration changes;
- raw secrets or unrestricted values in evidence types;
- any write/action invocation from compiler code.

Update the SysML/EA mirror only if the current architecture gate identifies a
required source artifact for this slice. Record architecture and plan coverage
against the immutable commit before implementation begins and again at handoff.

### Task 8 — PR and rollout handoff

Use signed-off commits, exact-tree local merge CI, semantic review, and the DPF
PR workflow. The PR must state that the compiler is additive and has no default
UI consumer. Rollback is deletion/disablement of the consumer; no data rollback
or trust-state rewrite exists.

## 3. Backlog coverage and four-way traceability

This plan is one atomic deliverable. The contracts, registry, resolver, compiler,
and compatibility adapter are not useful or safe as independent releases. The
next UI, federation, standards, and ecosystem-productivity releases retain their
separate backlog items under `EP-1FABA22D`.

| Deliverable | Backlog item | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- |
| `purpose-aware-journey-compiler` | `BI-91EF130B` | `OBJ-PJC-1`–`OBJ-PJC-5`; `AC-PJC-1`–`AC-PJC-5` | Design §§5–8 | Tasks 1–6 | Plan §4; Task 7 |

The condition blocking a governed coverage receipt before independent approval
is: **no initiative scope baseline exists for `BI-91EF130B`**. A passing
spec-approval receipt mints that baseline; the immutable plan blob is then bound
with `record_plan_backlog_coverage` before implementation.

## 4. Verification matrix

| Requirement | Evidence |
| --- | --- |
| 15 deterministic profiles | Table-driven compiler tests and order-invariance tests |
| Five condition statuses | Resolver unit tests including staleness and corrupt input |
| Activation compatibility | Existing walker suite unchanged and public shape assertion |
| Legacy compatibility | Adapter tests for completed, skipped, pending, and out-of-order progress |
| First-value gate | Five negative and five positive purpose fixtures |
| No sibling substrate | Path/diff scan; no schema/migration diff |
| Authority remains external | Tests prove profile compilation invokes no writers and cannot change federation/grant data |
| Production readiness | Exact-tree local CI, build/typecheck, architecture review, semantic review |

## 5. Rollback

The compiler is not the canonical owner of any record. Disable or remove its
consumer and continue to use the legacy setup projection and existing
`ActivationPlan`. Retain all intent, setup, federation, capability, task,
receipt, and Hive evidence. No down migration is required.

