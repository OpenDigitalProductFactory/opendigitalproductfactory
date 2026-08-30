---
status: active
---

# Proactive Workrooms — the room carries the drive, not the coworker

**Epics:** `EP-WORKFORCE-TRANSITION` (live coverage) · `EP-WORK-CONVERGENCE` (room substrate) · `EP-PAAW-HARMONIZATION` (standard)
**Kernel consult:** `DI-6B057EE5AE32` — `wire-work-shapes-to-rooms`, composite 10.594, margin 7.655, **high** confidence, no commandment conflict, autonomy-eligible
**Standard:** `DPF-PAAW` §9.5 (Workroom definition/instance), `PAAW-WORK-030`…`034`
**Instance under design:** customer 0 — DPF's own customer-zero install, archetype `software-platform`

> **A workroom that only acts when a human opens it is a folder. The drive to act
> belongs to the room's definition — what starts it, what stages it moves through,
> who answers for each, and what stops it — not to the identity of whoever happens
> to be assigned.**

---

## 1. What is actually true today

Every row is code-verified against `main` at `49bbbb2e8`, or live-queried from the install. None is inferred.

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | **The standing-activity substrate exists, is conformance-checked, and has zero production consumers.** `WorkShapeDefinition` declares triggers, stages, accountable principal per stage, `governed-decision` vs `status-change` advances, stop conditions (success/failure/budget) and a review point. `validateWorkShape` enforces the §8.11 MUSTs. `projectWorkShapeCycleBoundary` emits the exact cycle record the room adapter already parses. | `apps/web/lib/work-management/work-shapes.ts`; every caller of `getWorkShape` / `listWorkShapes` / `projectWorkShapeCycleBoundary` is in `work-shapes.test.ts` |
| 2 | **Only one shape is declared, and its runner never touches a Workroom.** `obligation-assurance-watch` runs a sweep and writes findings. It never calls `projectWorkShapeCycleBoundary`, never opens a room, never records room activity. The declared shape and the running job are unjoined. | `apps/web/lib/queue/functions/obligation-assurance-watch.ts` (78 lines, no room reference) |
| 3 | **Proactive drive is keyed to the coworker, not the work.** `COWORKER_SELF_TASKS` is a hand-curated registry of four agent-keyed entries whose only dial is cron cadence (`balanced` = weekly, `assertive` = daily). Nothing binds an entry to a room, a portfolio, an obligation, or a stop condition. | `apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts` |
| 4 | **The proactivity resolver has no room in its ladder and no activity family for source operations.** Scopes are `agent:` → `route-context:` → `activity-family:`. The 15 families cover marketing, finance close, tax, field dispatch, security *incidents* — none covers contribution intake, code review, advisory triage, or payables. | `proactivity-resolver.server.ts` `scopeKeysForInput`; `proactivity-types.ts` `PROACTIVITY_ACTIVITY_FAMILIES` |
| 5 | **The live room population is development sessions, not business operations.** Of 60 rooms scanned, 2 are live and 58 are history; 42 are reapable. 37 died by lease expiry. Most titles are `Work on BI-…`. | `list_workrooms` (2026-08-29): `{"scanned":60,"live":2,"history":58,"reapable":42}` |
| 6 | **The one business-operations room that was tried died of exactly this gap.** `WC-42C558DD` "Security findings watch — Dependabot, code scanning, OSV" was created manually, portfolio `foundational`, serving three portfolios, anchored to the GitHub Security tab — and expired seven days later with no executor and no drive. It is the design's own motivating defect, already on the install. | `list_workrooms`, `WC-42C558DD`, `liveness: lease-expired` |
| 7 | **The PAAW axes are specified but not populated.** 73% of rooms carry no `portfolioRole`, 67% no `activityKind`, **zero** carry `productsAndServicesSold`, and 0 of 330 declare a collaboration shape. | `EP-WORKFORCE-TRANSITION` triage items (live backlog) |
| 8 | **Nesting is specified and not modelled.** PAAW §9.5 and the vocabulary boundary define sub-rooms and the five work-coordination relations (`contains`, `spawned-from`, `depends-on`, `blocks`, `contributes-to`). `Workroom` has **no** parent/child column and no relation table; `grep` for `parentWorkroom`/`subRoom` returns nothing outside docs. | `packages/db/prisma/schema/work-coordination.prisma` `model Workroom`; `docs/architecture/workroom-vocabulary-boundary.md` |
| 9 | **Work posture already solved the "how hard, how fast" half — for turns, not for rooms.** Slices A–G shipped: shape × archetype stream × temporal band × stakes compose into a posture under a tighten-only invariant. It resolves *when a turn happens*. Nothing makes a turn happen. | `docs/superpowers/specs/2026-08-22-workroom-work-posture-design.md` §9 shipped state |
| 10 | **The forge substrate for the DPF-specific work already exists.** `GitHubForgeAdapter`, `github-rest-reader`, `github-inventory`, `issue-bridge`, `contribution-review`, `github-pr-readiness`, `local-repository-health`. Finance carries `Bill`, `BillApproval`, `Supplier`, `PurchaseOrder`, `RecurringSchedule`. | `apps/web/lib/forge/`, `apps/web/lib/contributor-change-lanes/`, `packages/db/prisma/schema/finance.prisma` |

## 2. The gap, stated once

Findings 1–10 are one gap seen from ten angles: **the platform can decide how a coworker should
behave once work is happening, and cannot make work happen.**

Posture answers *how hard*. Authority answers *how far*. Nothing answers *whether the room wakes up
at all* — except a hand-written cron keyed to a coworker's name, which knows nothing about the room,
the portfolio, the obligation, or when to stop.

That is why the security-findings room (finding 6) died. Nobody wrote it badly. There was nowhere for
its drive to live.

## 3. Approach: the room definition carries the drive

Adopted per `DI-6B057EE5AE32`. Rejected alternatives, with the kernel's scoring:

- **Extend the agent-keyed self-task registry** (composite 2.540). Cheapest and fastest, but it
  entrenches the category error: drive stays a property of *who* rather than *what work*. Every new
  standing room needs a hand-written cron, and no room can inherit a stop condition, a review point,
  or a portfolio. Rejected.
- **A new per-room proactivity table and engine** (composite 2.939). A third mechanism deciding when
  an agent acts, beside the proactivity resolver and the work-shape registry. Highest blast radius,
  lowest reversibility, and a direct Single-Source-of-Truth violation. Rejected.
- **Adopted — wire the declared work-shape registry into the room and the scheduler** (composite
  10.594). The substrate is already written, already conformance-tested, and already projects onto
  the room-cycle record. This is not new thinking; it is thinking that was completed and never
  connected.

### 3.1 The four questions a standing room must answer

A `WorkShapeDefinition` already answers all four. Binding it to a room is the whole design.

| Question | Answered by | Today |
| --- | --- | --- |
| What wakes this room? | `triggers` — the closed §8.11.1 vocabulary (`cadence`, `deadline-horizon`, `estate-drift`, `evidence-decay`, `authority-change`, `escalation`, `claim`) | declared, never read |
| What does it do, in order? | `stages`, each with an `accountablePrincipalRef` | declared, never read |
| Which advances need a human? | `advance.kind: "governed-decision"` — a sealed decision, not a status write | declared, never read |
| What stops it? | `stopConditions` (success / failure / **budget**) and `reviewPoint` | declared, never read |

### 3.2 The binding

One field, no new table: a standing room declares `workShapeKey@version` on `Workroom.scopeClaims` —
the same migration-free mechanism the collaboration-shape claim and the posture claim already use
(`workroom-shape-claim.ts`). A drive runner then:

1. reads the shape from the registry;
2. resolves the posture through the existing §3.1 ladder (`work-posture` slices A–G), which supplies
   cadence, channel and action boundary;
3. runs the stage whose accountable principal is an `agent:` reference, in **act** mode, through the
   existing `ScheduledAgentTask` dispatcher with that coworker's granted tools;
4. records a room cycle via `projectWorkShapeCycleBoundary` and room activity via the existing
   ledger; and
5. stops on any declared stop condition, escalating rather than continuing.

A stage whose accountable principal is a `role:` or `person:` reference is **never** run by the
runner. It becomes an attention item for that principal. This is finding 2's lesson made structural:
the sweep is the agent's, the response is the owner's.

### 3.3 Nesting is a relation, not a column

Finding 8 must be closed for the portfolio-aligned nesting the operator has already designed to be
real. The vocabulary boundary already names five relations and warns against collapsing them into
parent/child. The realization is therefore a `WorkroomRelation` join (`fromWorkroomId`,
`toWorkroomId`, `relation`, `createdAt`), not a `parentWorkroomId` column — because `contains`,
`spawned-from`, `depends-on`, `blocks` and `contributes-to` are five different facts and a single
nullable parent can only express one of them, badly.

## 4. The demarcation — three layers, one rule

The operator's constraint is the sharpest requirement here: some of this is generic archetype
machinery and some is DPF's own business. Getting that boundary wrong is how customer-zero work leaks
into every install.

**The rule, stated so it can be checked mechanically:**

> If it names a repository, a forge account, a credential, a person, a supplier, or a threshold
> number, it is **instance** and lives in configuration.
> If it names a business *kind* of work, it is **archetype** and lives in the profile.
> If it names no business at all, it is **platform** and lives in the substrate.

| Layer | Owns | Home | Ships to |
| --- | --- | --- | --- |
| **L1 — Platform substrate** | The shape→room binding, the drive runner, the relation model, posture resolution, evidence, stop-condition enforcement, portfolio placement | `apps/web/lib/work-management/`, `apps/web/lib/queue/functions/` | every install, every archetype |
| **L2 — Archetype profile** | The *set* of standing room definitions a business of this kind needs, derived from its OVSM — not authored per install | `packages/storefront-templates/src/` (derived, like `operational-value-stream.ts`) | every install of that archetype |
| **L3 — Instance overlay** | Which repo, which forge account, which coworker holds which stage, which thresholds, which suppliers | `Organization` config + `scopeClaims` + connector credentials — **DB rows, never code** | this operator install only |

**Three conformance tests hold the line**, because a prose boundary is not a control gate:

1. No file under `packages/storefront-templates/` may contain a forge URL, an org slug other than the
   archetype's own key, or a credential-shaped string.
2. Every L2 room definition must resolve for **every** leaf archetype in its category from OVSM
   alone, with no per-install input — the same *derive, never author* discipline the OVSM contract
   already declares and the work-posture design already enforces for postures.
3. No L1 module may import from `packages/storefront-templates/src/archetypes/`.

### 4.1 Worked example of the boundary

| Concern | Layer | Why |
| --- | --- | --- |
| "A standing room can wake on a cadence and stop on a budget condition" | L1 | names no business |
| "A software platform needs a contribution-intake room and a dependency-advisory room" | L2 | names a kind of business, true of every software platform |
| "The contribution-intake room watches `OpenDigitalProductFactory/opendigitalproductfactory`" | L3 | names a repository |
| "Advisory triage escalates above CVSS 7.0" | L3 | names a threshold |
| "The `decide` stage of advisory triage is owned by a human, not the agent" | L2 | a property of the work kind, not of customer 0 |
| "That human is Mark" | L3 | names a person |

## 5. The customer-0 room set (L2 shapes, L3 bindings)

Portfolio placement follows PAAW §6's placement question, not intuition. Each top room is standing;
each sub-room has an independently meaningful objective or control boundary, per `PAAW-WORK-033`.

### `foundational` — Source Custody and Assurance
*Placement question: a reusable cross-product foundation used broadly? Yes — security, governance,
shared platform.* Replaces the dead `WC-42C558DD`.

| Sub-room | Trigger | Agent stages | Human-owned stage |
| --- | --- | --- | --- |
| Dependency and advisory watch | `cadence`, `estate-drift` | sweep advisories, correlate to the manifest, raise findings | accept / patch / defer-with-a-date |
| Repository policy drift | `cadence`, `authority-change` | read branch protection, DCO, token grants; diff against declared policy | approve a policy change |
| Secret and credential hygiene | `cadence`, `evidence-decay` | scan for exposure, report age of every credential | rotate (**never** agent-performed) |

### `manufactureAndDeliver` — Contribution Flow
*Placement question: a specialized production capability used directly to make external value? Yes —
CI/CD is named explicitly in PAAW §6.*

| Sub-room | Trigger | Agent stages | Human-owned stage |
| --- | --- | --- | --- |
| Pull-request flow | `cadence`, `escalation` | read PR health mechanically (`pnpm pr:health`), classify stalled / conflicted / unreviewed, summarize | merge decision |
| Issue triage | `cadence` | classify, deduplicate against the backlog, propose a backlog item | accept into the backlog |
| Release readiness | `deadline-horizon` | assemble the gate evidence, name what is missing | cut the release |

### `productsAndServicesSold` — Adopter and Inquiry Desk
*Placement question: part of the value promise delivered to an external party? Yes.* Closes finding
7's zero-coverage hole on this portfolio.

| Sub-room | Trigger | Agent stages | Human-owned stage |
| --- | --- | --- | --- |
| Inquiry response | `escalation` (inbound), `cadence` (ageing) | draft a grounded reply, attach evidence | **send** — outbound is never agent-completed |
| Adopter health | `cadence` | read install telemetry and upstream issues, report | act on a churn signal |

### `forEmployees` — Contributor Relations
*Placement question: contributor capacity, or a service intended primarily for contributors? Yes —
and PAAW puts AI coworkers in this portfolio too.*

| Sub-room | Trigger | Agent stages | Human-owned stage |
| --- | --- | --- | --- |
| Contributor intake | `cadence` | sync the contributor inventory, flag missing DCO/licence facts | admit a contributor |
| Coworker fitness | `cadence`, `evidence-decay` | report capability-plane gaps and stale qualifications | grant or revoke |

### `foundational` — Business Administration
*Placement question: reusable cross-enterprise foundation? Yes.* **This is the one placement worth
the operator's explicit ratification** — an argument exists for treating payables as its own
support portfolio, and PAAW §6's representative list does not name finance. Recorded here rather
than decided silently.

| Sub-room | Trigger | Agent stages | Human-owned stage |
| --- | --- | --- | --- |
| Payables | `deadline-horizon` | read `Bill` / `RecurringSchedule`, report what falls due and what is unrecorded | **pay** — money movement is never agent-performed |
| Vendor and subscription review | `cadence` | report renewals and spend against commitments | renew or cancel |

## 6. Safety — what the drive may and may not do

The drive inherits every existing guard and adds no new authority. Stated explicitly because a
standing activity that can start itself is the highest-consequence thing in this design.

- **A shape may tighten. It may never widen.** The work-posture tighten-only invariant governs the
  drive unchanged: a derived cadence may raise urgency, never relax an action boundary.
- **`governed-decision` advances cannot be downgraded by any posture.** Already a §8.11.2 MUST; the
  runner enforces it by refusing to execute a stage whose accountable principal is not an `agent:`.
- **Three acts stay human, by construction, and are named in the shape:** sending anything outward,
  moving money, and rotating a credential. They appear as human-owned stages above.
- **Every shape must declare a failure exit and a budget stop.** `validateWorkShape` already refuses
  a shape with only a success exit; the runner must honour the budget stop rather than burying a
  ledger — the lesson `obligation-assurance-watch` already encodes at 200 findings.
- **Every shape is reviewed on its `reviewPoint` whether or not it moved.** A watch that has found
  nothing for a month is as likely to be broken as to be reassuring.
- **An enforcement refusal is a stop.** A runner that cannot claim its lease, cannot reach the forge,
  or reads an empty substrate reports and stops; it never raises findings from an empty read.

## 7. Research and benchmarking

Three comparable approaches to declarative standing automation were examined.

- **Kubernetes controllers and the reconcile loop.** A controller declares a desired state, wakes on
  a resync interval or a watch event, and reconciles. DPF **adopts** the trigger split (periodic
  resync ≈ `cadence`, watch ≈ `estate-drift`/`escalation`) and the discipline that the loop is
  level-triggered — it re-reads the world rather than trusting an event it may have missed. DPF
  **rejects** unbounded reconciliation: our loop must stop on a declared budget and be reviewed on a
  cadence, because ours can spend money and inference tokens where a controller only writes objects.
- **Prefect / Dagster declarative scheduling with sensors and assets.** Work is declared as an asset
  with a freshness policy; a sensor wakes the flow when the policy is violated. DPF **adopts**
  freshness-as-trigger — this is exactly `evidence-decay` — and the separation of the schedule from
  the work definition. DPF **rejects** their runtime-owned retry semantics: our equivalent must
  resolve where governance can see it, because our advance can be a sealed decision, not a retry.
- **Renovate and Dependabot as standing repository agents.** Both are configuration-declared,
  repository-scoped, and open a PR rather than merging one. DPF **adopts** the propose-never-commit
  posture wholesale — it is the same boundary as our human-owned stages — and **adopts** their
  demarcation shape, where the tool is generic and the repository binding is configuration. DPF
  **rejects** their per-repo config file as the source of truth: our binding belongs in the governed
  room record so a gate can read it.

**Standards basis.** The shape's declared triggers, stop conditions and review point are the NIST AI
RMF *Manage* function applied to standing autonomy: an automated activity that can start itself must
declare in advance how it ends and when it is examined. The human-owned stages implement the
`human-in-the-loop-at-phase-boundaries` commandment at the boundary a cadence would otherwise erase.

## 8. Decomposition

Each slice is independently shippable and inert until the next lands. Slices A–D are L1 platform;
E is L2 archetype; F is L3 instance. That ordering is deliberate — the instance overlay lands last,
so the generic layers are proven before customer 0's own business rides on them.

| Slice | Layer | Content | Inert until |
| --- | --- | --- | --- |
| **A** | L1 | Shape→room binding: the `scopeClaims` claim reader/writer, and `projectWorkShapeCycleBoundary` wired into the room-cycle adapter. No runner. | B |
| **B** | L1 | The drive runner: resolve shape → resolve posture → dispatch the `agent:` stage through `ScheduledAgentTask` → record cycle and activity → honour stop conditions. Refuses non-`agent:` stages. | E |
| **C** | L1 | `WorkroomRelation` — the five relations, with the migration. Closes finding 8. | — |
| **D** | L1 | Proactivity families for standing operations, so a posture can govern this work at all (finding 4). | B |
| **E** | L2 | The `software-platform` standing-room profile, derived from OVSM, with the three conformance tests of §4. | F |
| **F** | L3 | the operator install's bindings: repo, forge account, coworker-to-stage assignment, thresholds. Configuration rows and one seed. | — |
| **G** | L1 | Room surface: the drive, its next wake, its last cycle, and why it is behaving as it is. | B |
| **H** | L1 | Retire the agent-keyed self-task registry onto shapes, once E and F prove the path. Not before. | E, F |

## 9. Non-goals

- Not replacing the proactivity resolver, the Golden Triangle compiler, or the work-posture layer —
  this composes them.
- Not a new decision engine; `principle_decide` remains the PDP.
- Not per-install room authoring (§4 rule 2) and not a second work ledger (`PAAW-WORK-030`).
- Not autonomy for outbound sends, money movement, or credential rotation — ever.
- Not the FPAW→PAAW rule-prefix crosswalk; that is `EP-PAAW-HARMONIZATION` slice 2.

## 10. Related

- [Work Posture](2026-08-22-workroom-work-posture-design.md) — how hard and how fast, once a turn happens
- [Workroom vocabulary boundary](../../architecture/workroom-vocabulary-boundary.md) — definition/instance, sub-rooms, the five relations
- [DPF-PAAW](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md) §6, §9.5
- [AI Coworker Proactivity Policy](2026-06-29-ai-coworker-proactivity-policy-design.md) — the engine this drives through
- [Workroom portfolio convergence](../plans/2026-08-24-workroom-portfolio-convergence.md) — where definitions and instances live in the UI
