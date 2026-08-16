# Archetype Job Validation Loop

Repeatable, per-job validation that an archetype install makes each real job
**more productive under its own login** — DPF as added value, never new
operational burden, exercised safely. This is the persona layer on top of the
[archetype exercise harness](archetype-exercise-harness.md): the harness stands
up the scenario and demand; this loop validates what each **person** experiences.

## Organizing principle: the physical space, mirrored virtually

(Operator doctrine, 2026-07-29.) The virtual workplace mirrors the physical
one: where people work and do specific jobs has a virtual counterpart. For
born-virtual work the mapping is direct. For physical work, jobs are organized
by **expected outcome** — cooking the food, seating the guest, taking orders
and serving, paying the employees — and each outcome maps to a working surface
(a standing Workroom per ongoing outcome, a finite room per bounded one) with
the people and AI coworkers who own that outcome inside its boundary. The
underlying substrate exists (Work Cases/Rooms, workspace homes, roles,
coworkers); the current phase is TAILORING it per archetype, per job, per
activity — which is precisely what this loop validates: does each job's
virtual room serve its physical outcome better than working without it?

First exercised live on the restaurant archetype, 2026-07-29 (goal thread:
restaurant-owner overnight exercise). Companion substrate:

- **Workrooms** (`docs/superpowers/specs/2026-07-26-work-rooms-collaboration-design.md`,
  EP-2984B02B) — the collaboration surface a job uses for active work.
- **Workspace home profiles** (`apps/web/lib/workspace-home/profiles.ts`) —
  archetype-category tailoring of the signed-in home.
- **Occupation homes** (BI-001FD798 for food-hospitality) — the per-job home,
  in backlog; until it ships, jobs land on the category home and this loop
  measures the gap.
- **Invite flow** (`apps/web/lib/actions/invite-actions.ts`) — how a staff
  member gets their own login.

## The loop (per job, per iteration)

For every job in the archetype's scenario pack:

1. **Identity** — the job holder has their OWN login (invite → sign-up →
   platform role). Never test a job through the owner/admin account: authority,
   attention, and home tailoring all differ. Record the role and grants used.
2. **Landing** — sign in and record what the FIRST screen gives this job:
   Can they answer "what needs me right now?" without navigating? Score the
   landing surface: job-relevant items above the fold, zero items that belong
   to another job, zero technical/platform noise for non-technical roles.
3. **Journeys** — run the job's scripted journeys (scenario pack `jobs`
   section). Each journey states: trigger → steps through the UI → expected
   outcome → verification (DB/receipt, never just the UI).
4. **Productivity delta** — for each journey record: step count, dead ends,
   escalations to another role, and whether the AI coworker removed steps
   (proposed, drafted, or completed work) or added them (approvals with no
   context, noise, wrong-confidence output). The pass bar: **the journey with
   DPF must not take more steps than the pre-DPF baseline recorded in the
   scenario pack** — value added, not burden.
5. **Safety** — verify the role boundary while doing the work: actions outside
   the job's authority are absent or refused (grant checks), money-out and
   public-facing actions always escalate to the accountable human, and
   destructive paths demand explicit confirmation. A tailored page that
   over-exposes admin controls is a FAIL even if the journey succeeds.
6. **Capture** — every deficiency becomes a backlog item scoped
   archetype-leaf / archetype-category / common / platform (the harness doc's
   deficiency protocol). Tacit knowledge surfaced by the run routes by layer:
   - **WWWD (organization layer)** — how THIS business decides and operates:
     house policies, comp authority, reorder thresholds, no-show handling.
     A decision the platform could not ground (low-confidence escalation) is
     a missing WWWD stance — record the stance, don't just answer the
     question (see BI-00A1DB81).
   - **WSID (job/profession layer)** — how the JOB is done well anywhere:
     how a host recovers an overbook, how a cook sequences tickets, how
     purchasing sizes an order. This corpus grounds the coworker serving that
     job (the autonomous runtime injects it via profession grounding), so a
     job-technique gap observed in a journey is a WSID corpus gap.
   The test for which layer: would another restaurant want this knowledge?
   Yes → WSID (profession). Only this business → WWWD (organization).

## Restaurant job matrix (first pack)

Each row is an expected outcome of the physical restaurant and the job that
owns it; the "landing" is that outcome's virtual room/home.

| Outcome | Job | Login/role | Landing must answer | Core journeys | Coworker leverage expected |
| --- | --- | --- | --- | --- | --- |
| The business runs | Owner/manager | owner role | "Are we ready for the next service? What needs me?" | review attention queue; approve coworker proposals; review money-out | assertive coworkers pre-digest decisions; only escalations surface |
| Guests are seated | Host | staff role | "Who's arriving, what tables are open, who's waiting?" | confirm reservation; seat walk-in; handle cancellation | coworker confirms routine bookings, flags conflicts only |
| Food is cooked | Cook / kitchen | staff role | "What orders are in, what do I fire next?" | accept order → mark ready → mark fulfilled (BI-115E0D1F lane) | coworker sequences tickets, flags allergy notes (BK-3CQYK6MV pattern) |
| Kitchen stays stocked | Purchasing / stock | staff or manager | "What's running low against what's selling?" | review restocking proposal; approve supplier order (owner approves spend) | proactive demand-review task proposes orders from sales (blocked on BI-SPEND-003 substrate) |
| Employees are paid | Owner + finance coworker | owner role | "Is payroll ready, on time, and correct?" | review payroll run; approve payment (money-out always human) | finance coworker prepares the run; owner approves |

Known gaps this matrix already exposes (do not re-file): single-login install
(staff have no accounts until invited), occupation homes not yet built
(BI-001FD798), no ingredient substrate (BI-SPEND-003), inquiry reply missing
(BI-E3517AD5).

## Iteration protocol

- Re-run the loop after every self-upgrade that touches a validated surface,
  and fully per release. The harness seeds identical data each time, so
  deltas in step counts and deficiency counts are comparable across runs.
- Store per-run results as a dated report (harness `--report`) plus the BI
  list; a job regressing (more steps, new dead end, safety miss) is a
  release-blocking finding for that archetype.
- Porting to another archetype = writing that archetype's job matrix into its
  scenario pack (jobs, journeys, pre-DPF baselines); the loop itself is
  archetype-agnostic.

## Scenario-pack `jobs` contract (extension)

A pack adds a `jobs` array; each entry:

- `job` — name ("host"), `role` — platform role used at sign-in
- `landing` — what the first screen must answer for this job
- `journeys` — `{ name, trigger, steps, expected, verify, preDpfBaselineSteps }`
- `coworkerLeverage` — what the AI coworker is expected to take off this job

Harness support for driving per-job logins and asserting the productivity
delta is tracked separately (see the BI referenced in the changelog for this
doc); until it lands, steps 1–5 run manually against the seeded scenario.
