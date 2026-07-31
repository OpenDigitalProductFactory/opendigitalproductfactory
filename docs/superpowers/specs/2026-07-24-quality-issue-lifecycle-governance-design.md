# Quality-issue lifecycle governance: no detector without a resolver

Status: implemented (phase 1 of BI-0B420A1D)
Date: 2026-07-24
Backlog: BI-0B420A1D — handoff capture for the holistic estate-management thread

## Problem

The open-issues arc (PRs #3163 / #3418 / #3424 / #3437 / #3448) fixed five
*instances* of the same defect. This spec fixes the *class*.

Every one of those defects had the same shape: **a detector with no lifecycle and
no notion of consequence.** Nothing in the platform required an issue type to
declare how it ends, so detectors accumulated 2,247 open rows over roughly two
months and buried the handful of rows that were real signal.

Two concrete, verified findings underpin this:

1. **The type union was fiction.** `QUALITY_ISSUE_TYPES` declared 8 types. The
   live database held 10 — **8 of them undeclared**, and 6 of the declared ones
   never used. `openOrUpdateQualityIssue` validates against the union and throws
   on unknown types, but **7 direct `prisma.portfolioQualityIssue.upsert` call
   sites bypass it entirely** (`discovery-sync.ts`, `discovery-runner.ts`,
   `health-alert-issue.ts`, `edge-event-correlation.ts`). The validation was
   real; nothing routed through it.

2. **Hand-maintained token lists have no conformance check.**
   `discovery-collectors/docker.ts` emits `docker-host:` (HYPHEN) while the
   Docker-origin guard listed `docker_host:` (UNDERSCORE). One character leaked
   **124 rows** that survived every prior suppression pass and cleanup migration.

## Design

### 1. The registry is the contract (`packages/db/src/quality-issue-registry.ts`)

Every issue type declares how it ends:

| Field | Meaning |
| --- | --- |
| `resolvedBy` | `discovery-sweep-reconcile` \| `suppressed-at-emission` \| `operator` \| `coworker` \| `monitor-clears` |
| `autoResolveWhen` | the machine-checkable auto-close condition, or `null` |
| `operatorActionable` | can a human/coworker actually do something? |
| `expectedSteadyState` | open rows expected in a healthy install (0 = any row is drift) |
| `owner` | who drives the queue down when it exceeds budget |

### 2. Enforcement is the compiler, not a script

`QualityIssueType` is **derived** from the registry (`keyof typeof
QUALITY_ISSUE_REGISTRY`), and `InventoryQualityIssue.issueType` is typed as
`QualityIssueType` instead of `string`. That chain —
`evaluateInventoryQuality` → `discovery-sync`'s direct `prisma.upsert` — is
exactly how the 8 undeclared types reached production. **Emitting an
unregistered type is now a compile error**, which is stronger than a CI script
and cannot be bypassed by choosing a different write path.

Two unit-test gates back it:
- every registered type declares a resolver, owner, budget and summary;
- **a type that never auto-resolves must be operator-actionable** — otherwise it
  is a permanently-open row generator by construction (precisely what
  `name_not_promotable` / `type_not_promotable` were).

### 3. The platform surfaces its own drift

`qualityIssueDrift(openCountsByType)` returns every queue over its declared
budget, worst overrun first, **with its owner**. This is the input a proactive
sweep — or the weekly use-it-or-lose-it token allocator — consumes to decide what
to work on, so drift is surfaced by the platform rather than noticed by a human
looking at a dashboard.

### 4. Self-healing: the `docker-host:` leak

The guard now lists **both** separators, so no new rows of that shape are
emitted, and a non-destructive migration resolves the 124 already persisted.
Verified live: resolves exactly **124**, leaves **17** open — the genuine UniFi
gateway/switch/AP topology and host NICs, which are real operator signal and are
deliberately kept.

## Why compile-time over a CI ratchet

An open-count ratchet (the `module-size-baseline.txt` pattern) was the other
candidate and is still worth having, but it cannot run in CI: the count lives in
the operator's database, which CI has no access to. The honest split is:

- **CI / compile time** — prevent a detector being *born* without a lifecycle.
  Fully static, and delivered here.
- **Runtime sweep** — measure drift against `expectedSteadyState` on the live
  install, auto-resolve what declares itself auto-resolvable, and file/route the
  rest. Needs the registry as its prerequisite, which this delivers.

## Phase 2 — the runtime sweep (`quality-issue-drift-sweep`)

Phase 1 is the compile-time gate. Phase 2 makes each type's declared lifecycle
LIVE on the operator's install, as a scheduled inngest sweep
(`governance/quality-issue-drift-sweep-scheduled`, daily 05:23, quiescence-gated,
concurrency 1) delegating to the pure `runQualityIssueDriftSweep(db)`
(`packages/db/src/quality-issue-drift-sweep.ts`):

1. **Self-heal backstop — both directions.** Every subject-bearing type declares
   `subject` (`entity` | `relationship` | `scope`) and `raisedBySubjectAbsence`,
   and the sweep closes rows in whichever direction the contract implies:

   - **Subject recovered** (`raisedBySubjectAbsence: true` — the staleness
     detectors). Closes open `stale_entity` / `stale_relationship` rows whose
     FK-linked row is now `active` (recovered by a *different* source than the
     one that marked it stale) or gone (deleted). The common recovery case is
     already handled in-sweep by discovery-sync; this is the global backstop for
     what per-source reconcile misses.
   - **Subject lost** (`raisedBySubjectAbsence: false` — everything else with a
     subject). Closes open rows whose FK-linked row has since gone `stale` or
     been deleted. An issue like *"still needs identity review for manufacturer"*
     asserts that a LIVE thing needs work; once that thing stops being observed
     the assertion is moot and no operator or coworker can ever close it by
     acting.

   **Why the dual matters.** Phase 2 originally implemented only the first
   direction, against a hand-written `["stale_entity", "stale_relationship"]`
   list. On the live install that left **179 of 462 open rows pinned to
   already-stale entities** — 108 `lifecycle_unverified` and 69
   `catalog_match_ambiguous` — permanently unresolvable, burying the ~209 rows
   that were genuinely actionable. Both lists are now DERIVED from the registry,
   so a new detector inherits the correct self-healing behaviour by declaring its
   contract rather than by someone remembering to edit the sweep.

   **Deliberately not guessed at.** A row with no subject FK is left alone rather
   than resolved from its `issueKey` string. 49 such legacy rows exist on the live
   install (37 naming a now-stale entity, 6 an active one, 6 an entity that no
   longer exists); they are data hygiene, tracked separately, not a sweep
   responsibility.

2. **Drift detection.** Compares live open counts to each type's declared
   `expectedSteadyState` and returns every over-budget queue, worst-first, with
   its owner. This is the runtime analogue of the compile-time gate: a NEW
   detector that starts accumulating is surfaced automatically.

**Why not an open-count CI ratchet.** The `module-size-baseline.txt` pattern
cannot apply — the open count lives in the operator's database, which CI has no
access to. Drift monitoring must run at runtime, which is what this sweep is.

**Deliberate boundary.** The sweep does NOT file backlog items or route work.
Turning drift into funded, routed work (drift → BI → weekly use-it-or-lose-it
token budget → Build Studio / owning coworker) is the auto-processing
orchestration owned by the holistic estate-management thread; it consumes the
`drift` this returns. Keeping detection and routing apart avoids the
backlog-flood failure mode a self-filing sweep has caused before. The existing
`governed-backlog-tee-up` → Ideate → Build autopilot is the router it feeds.

**Verified state at build (2026-07-24).** 388 open, of which **0** are
FK-resolvable — discovery-sync's reconcile plus the arc's migrations already
drained the mechanically-resolvable set, so the backstop resolves 0 today. Its
standing value is (a) catching future cross-source recovery / deletion, and (b)
making drift visible: `lifecycle_unverified` (178) and `catalog_match_ambiguous`
(175) show as over-budget, owned by `coworker:estate-specialist` and already
covered by the in-progress triage sprint BI-E4A86393.

## Out of scope / follow-ups (BI-0B420A1D)

- **Runtime drift sweep + auto-processing loop**: detect drift → file/claim a BI →
  spend the expiring weekly token budget → route mechanical work to Build Studio
  and judgement work to the owning coworker.
- **Consequence-based severity** from distance to the service path (#3448 made
  this computable; severity is still uniformly `warn`).
- **Collector key-prefix conformance**: assert every `externalRef` / `naturalKey`
  prefix any collector emits is known to the classifiers — the mechanical
  generalisation of the `docker-host:` fix.
- **Retention/aging** for genuinely-decommissioned managed assets (operator
  policy decision).
- Reconciling the duplicated Estate Specialist BIs (BI-4FACD527 /
  BI-IMP-D44FA0C6) and the in-progress triage sprint (BI-E4A86393), which owns
  the `lifecycle_unverified` + `catalog_match_ambiguous` queue content.
