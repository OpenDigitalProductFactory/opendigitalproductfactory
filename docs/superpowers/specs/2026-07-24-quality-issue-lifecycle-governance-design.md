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
