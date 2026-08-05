# Critical Business Journey Watchdog — design

- **Backlog item:** BI-E105303D
- **Epic:** EP-PROACTIVE-OPS (composes EP-ATTENTION-SURFACE, EP-ASSURANCE-LEDGER)
- **Kernel decision:** DI-96D3FD5C089B
- **Date:** 2026-07-28

## 1. Problem

A live install can lose a revenue-critical journey — signup, intake, booking, inquiry,
payment — and nobody finds out until a customer complains. DPF already owns every
ingredient needed to notice: a scheduled-job substrate, an assurance evidence store, a
contracted operator-issue inbox, and a calm "Needs you" attention surface. Nothing joins
them for this purpose.

Verified absent on 2026-07-28 (`ac7f31bdb3`):

| Candidate | What it actually is | Why it does not cover this |
| --- | --- | --- |
| `lib/coworker-lifecycle/golden-journeys.ts` | Read-only probes per **coworker** | Certifies agents, not business journeys |
| `lib/business-activity-sim/` | Pure in-memory flow + oracles | Never touches the running install |
| `lib/operate/endpoint-test-runner.ts` | Capability probes per **AI model** | Tests models, not journeys |
| `SCHEDULING_MAP` / `SCHEDULED_JOB_CATALOG` | 60+ jobs | No journey job of any kind |

A repo-wide search for `critical business journey` / `journey watchdog` returns zero matches.

## 2. Decision

Kernel `DI-96D3FD5C089B` scored three options for `external_coding_agent` in contexts
`build-studio` / `ui` / `platform`:

| Option | Composite |
| --- | --- |
| **compose-existing-substrate** | **19.011** |
| defer, ship attention deep-link fidelity instead | 12.974 |
| dedicated journey subsystem (new Prisma models, own alerting) | 11.524 |

Margin 6.037, confidence high, no commandment conflict. Top contributors: *Research and
Use Standards*, *Ship Real Functionality*, *Never Assume — Verify*.

**Compose. No new Prisma model, no new queue, no new evidence store, no new notification
system.**

## 3. The honesty problem, and the mechanism that solves it

`structural-verification-is-not-functional` is a commandment. A watchdog that pings
`/book` and reports "booking journey healthy" would violate it — and would be worse than
no watchdog, because it manufactures false confidence in exactly the place the owner
stops looking.

So verification depth is a **first-class, per-step, surfaced value**, not an
implementation detail:

| Depth | What it proves | Cost |
| --- | --- | --- |
| `reachability` | the entry surface responds as declared | lowest |
| `contract` | the journey's required substrate exists and is coherent (published storefront, bookable items, configured archetype) | low |
| `data-path` | the journey's real persistence path and **real database constraints** execute end-to-end inside a watchdog-owned transaction that is then rolled back | moderate |
| `interaction` | the real server action / rendered client is driven end-to-end | **not covered in P1** |

Two rules make this honest rather than decorative:

1. **A journey's achieved depth is the weakest depth among its passing steps.** One
   `reachability`-only step caps the whole journey at `reachability`.
2. **The surface always states what was *not* checked.** A journey verified to
   `data-path` renders "Not checked: a customer doing this in a browser." The
   watchdog never renders an unqualified "healthy".

`interaction` depth is deliberately named and deliberately absent, so the gap is visible
in the product rather than hidden in a backlog.

## 4. Zero-side-effect functional probing

`data-path` probes must never leave business rows behind — a synthetic booking in the
owner's reservation queue is a defect, not evidence.

The runner opens its own interactive transaction, performs the journey's real writes
through the real Prisma schema, asserts the real constraints fired (unique refs, foreign
keys, the `StorefrontBooking_no_overlap` gist EXCLUDE constraint, required columns), then
throws a private sentinel to force rollback. Nothing commits.

A regression test asserts row counts for every touched table are unchanged across a full
sweep. If that test fails, the watchdog is polluting the business and must not ship.

**Known limit, stated plainly:** because the public submit paths (`submitBooking`,
`submitInquiry`) are `"use server"` actions bound to the module-level client, a
watchdog-owned transaction cannot wrap them without their inner transaction committing
independently. P1 therefore exercises the journey's data path and constraints, **not the
server action's own branch logic**. That is precisely why `interaction` exists as an
uncovered depth rather than being quietly folded into `data-path`.

## 4a. False alarms are a failure mode too

A watchdog that cries wolf gets ignored, which destroys the same trust a watchdog that
overstates its coverage destroys. One case is common enough to handle explicitly.

The watchdog runs **inside** the install, so the public address may be unreachable from
there for reasons that are not an outage: split-horizon DNS, a proxy that only accepts
external traffic, a missing NAT hairpin. Probing the public origin is still correct — that
is the customer's actual path — but a connection-level failure alone is not proof the site
is down.

So a network-level failure is re-tried against the install's own loopback origin, and the
two outcomes are reported **differently**:

- neither answers → "could not be reached at all" (an outage)
- loopback answers, public does not → "works inside the install but not at its public web
  address" (a DNS / proxy / certificate problem)

Both are real failures worth raising. Collapsing them would send the operator hunting the
wrong problem. An HTTP error status needs no such treatment — a 500 is a 500 wherever it
is observed.

### 4a.1 "Could not check" is not a failure (added 2026-08-04, BI-04CC2090)

The cases above all assume the probe *ran*. A third case comes before them: the probe could
not be attempted at all, because the install has no public web address or no organization
address configured. Nothing was learned about the business — not even that it is
unreachable.

The first build had no vocabulary for this. `StepProbeResult` carried only
`passed: boolean`, so "I could not check" was recorded as `passed: false` and the journey
verdict collapsed to `failed`. On an install with no configured address that produced four
`error`-severity rows reading *"Customers can book a time with you — not working"*, open for
seven days, on evidence whose own text said the page *"cannot be checked"*. Every run in
that install's history carried `achievedDepth: null`: nothing had ever been verified.

That is this section's own failure mode, arriving through a case it did not enumerate — and
it is §3's honesty rule inverted. §3 stops the watchdog implying more *coverage* than it
established; this stops it implying more *knowledge*.

So a probe can now report `unverifiable` with a keyed reason, and a journey blocked by such
a step is `unverifiable`, never `failed`:

- it opens **no** `journey_failure` row, because that row is a claim about the business;
- it opens a grouped `journey_unverifiable` row at `warn`, keyed by **cause** rather than by
  journey, so four journeys blocked by one missing setting are one thing to fix;
- it is never silent — silence here would just trade this bug for the one in BI-948E8873;
- the sweep records `inconclusive`, never `passed`, because a run that established nothing
  has not passed.

The distinction is the whole point: a failed journey is a statement about the business, an
unverifiable one is a statement about the watchdog. Only the first should ever be red.

Every reachability request is also bounded by a 15s `AbortSignal.timeout`. A watchdog that
can hang is worse than no watchdog: it stays silent through the very outage it exists to
report, and silence is indistinguishable from health. A customer would have given up long
before 15s anyway, so a slower response is a failure by the journey's own standard rather
than merely a slow check. (Found by live verification, not by review — the first live run
against a real install hit a route that accepted the connection and never answered.)

## 5. Applicability — install-defined, not hardcoded

A journey declares `appliesWhen(context)` against a resolved `InstallJourneyContext`
(published storefront, primary + composed archetypes, bookable items, inquiry-capable
surface, payment configuration). A journey that does not apply resolves to
`not-applicable` — never a failure, never a red tile. An install with no storefront has
no storefront journeys, and says so.

## 6. Substrate reuse map

| Need | Existing substrate | Reused how |
| --- | --- | --- |
| Run evidence | `AssuranceRun` | `scopeType: "business-journey"`, `adapterKey: "journey-watchdog"` |
| Per-failure evidence | `AssuranceFinding` | one per failed step, with expected vs actual + achieved depth; absent-clean resolves what stops reproducing |
| Operator inbox row | `PortfolioQualityIssue` | new registry-contracted type `journey_failure` |
| Lifecycle contract | `packages/db/src/quality-issue-registry.ts` | `resolvedBy: "monitor-clears"`, auto-resolves when the next run of the same journey passes |
| Notification | Attention Surface | new read-model source `business-journey` |
| Scheduling | Inngest cron + `SCHEDULED_JOB_CATALOG` + `SCHEDULING_MAP` | one entry, quiescence-gated |
| Remediation | governed backlog flow | operator-initiated action only (§8) |

## 7. Cadence and cost

Three times a week (`0 6 * * 1,3,5`), not nightly. The transcript's own operator runs the
equivalent Mon/Wed/Fri because the run costs real money. Cheapest-recipe-first is
structural here: `reachability` and `contract` steps are near-free and run first; a
`data-path` step only runs when the cheaper steps for that journey passed, so a broken
storefront costs one HTTP call rather than a full transaction rehearsal.

Deliberately off the 04:00–05:00 nightly block to avoid same-tick contention with the
data-model mirror, SysML projection, memory consolidation, and coworker certification.

## 8. Remediation stays governed

The watchdog **never** creates a build, opens a PR, or merges a fix. On failure it:

1. records evidence,
2. opens one contracted issue,
3. surfaces one attention item with one recommended action.

The recommended action deep-links the operator to the specific journey's evidence, where
"File a governed fix" routes through the existing backlog flow. Automatic tee-up is a
separate governed item precisely so this slice cannot silently create-and-merge.

## 9. Attention item shape

- `source: "business-journey"`, `residueReason: "no-self-heal"`
- `riskClass`: `high-risk` when the journey is revenue-bearing, else `bounded-write`
- `decideEffort: "review"` — a broken journey is a fact to act on, not a scored call
- `decisionClass: { scorability: "unscorable" }` — consistent with `platform-health`
- Title is the outcome in the owner's language ("New customers can't request a quote"),
  not the mechanism ("inquiry probe step 2 failed")
- Deep link resolves to the specific journey, honouring the BI-C7D25599 2026-07-22
  finding that landing on a broad list recreates the cognitive load the interruption
  already spent

## 10. Out of scope (governed follow-ups)

- `interaction` depth via `browser-drive`
- authenticated multi-actor journeys requiring a real session
- automatic governed remediation tee-up
- per-journey cost telemetry

## 11. Acceptance

1. A failing journey opens exactly one `journey_failure` row; a later passing run resolves it.
2. Evidence names the failing step, expected vs actual, and achieved depth.
3. Attention shows plain-language why-now + one action deep-linking to that journey.
4. A `reachability`-only journey is never presented as functionally verified.
5. A full sweep changes no business row counts.
6. Registered in `SCHEDULING_MAP`; respects the quiescence gate.
7. No new Prisma model; no parallel queue, evidence store, or notification path.
