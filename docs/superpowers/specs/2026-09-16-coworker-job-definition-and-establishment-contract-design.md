---
status: active
---

# Coworker job definition — establishment as hiring, not wiring

**Operator goal:** 2026-09-16 — *"make sure the process to create new AI coworkers is as
articulate and complete as defining a job, and specifying the requirements to fulfill that job.
Priming, and tailoring to the specific archetype and specific local or other context when
implemented on a new instance through initial deploy, or upgrade situation. Once the process is
well established and refined, we need to run our gaps through this process to make sure existing
instances are properly setup."*

**Backlog item:** `BI-2D0063DF`
**Standard:** FPAW §10 (performer kinds, allocation patterns, eligibility gates)
**Related rulings:** `DI-81E47BDA59F1` cadence is room-owned · `DI-21CD5A026BD4` boundary editor

## 1. The finding

`establish_coworker` is the single factory door. It accepts seven inputs — `agentId`, `name`,
`description`, `valueStream`, `sensitivity`, `grants`, `minimumTier` — and returns a checklist.

That checklist makes five things **mandatory**, and all five are plumbing: a roster entry, a grants
entry, a route binding, a model-floor row, a profession-family mapping. Then, verbatim:

> `Optionally: curated golden journey, service-catalog offer, COWORKER_SELF_TASKS entry.`

The eight conformance axes that guard the door are all referential integrity — grants present,
grants honored, route reachable, persona real, model floor present, model floor real, wildcard
skill reaches the roster, existing self-tasks point at real coworkers. `LIFE-009` checks that a
self-task that *exists* names a real coworker. **Nothing checks that a coworker has one.**

So the door asks whether a coworker is correctly **wired**. It never asks whether it has a **job**.

### 1.1 Why this is the root cause, not a symptom

The same codebase grades coworker completeness on seven planes — identity, corpus/WSID,
governance/WWWD, shape, cadence, toolsAndSkills, evidence. The factory door requires roughly one
and a half of them.

The measure therefore keeps finding exactly what the creation process keeps permitting:

| measured | permitted by the door |
|---|---|
| 52 coworkers with no cadence — any Proactivity setting is a silent no-op | cadence is "optional" |
| 39 with no declared work shape — nothing bounds what their standing work may do | shape is not an input |
| 39 with no evidence | golden journey is "optional" |
| corpus and governance ungraded above L0 for most | neither is an establishment input |

Closing these by hand works and does not stop new ones arriving, because the door that creates
them never asked. The operator's analogy is exact: nobody hires by completing payroll, badge and
desk assignment while leaving *what is this job, what does good look like, when do they work, what
must they know* as optional.

## 2. Research & Benchmarking

- **O\*NET** (US Dept. of Labor, CC BY 4.0) decomposes 1,016 occupations into ~19,000 tasks, rolled
  into 2,000 Detailed Work Activities and 41 Generalized Work Activities. **Adopted:** the
  activity-level decomposition — a job is a bundle of activities, and allocation happens per
  activity, not per whole job. **Rejected:** importing the occupation taxonomy itself; DPF's
  archetype OVSM already names the activities each business runs, and a second taxonomy would be a
  parallel registry.
- **SHRM / ISO 30414 job-description practice** converges on purpose, accountabilities, authority,
  qualifications, reporting line, and success measures. **Adopted** wholesale as the axis list —
  §3 maps each to substrate that already exists.
- **IT4IT** role catalogue — already present in `agent_registry.json` as `it4it_sections` on each
  `AGT-1xx` entry. **Adopted** as conformance mapping. **Rejected** as a hiring plan; PR #5384
  recorded 31 of these as deliberately unstaffed rather than as holes.
- **FPAW §10** — performer kinds and the twelve allocation patterns. **Adopted** as the authority
  axis: a job definition must name which allocation pattern governs, which is what says where the
  human/AI boundary falls for that role.

## 3. The job definition, and where each axis already lives

The claim of this design is that **almost nothing new is needed**. Eight of nine axes already have
canonical homes; what is missing is that the door does not demand them.

| # | Job-definition axis | Existing home | Today |
|---|---|---|---|
| 1 | Purpose | `capability_domain` on the registry entry | present, not validated |
| 2 | Accountabilities — outcomes owned | `WorkShapeDefinition` stages, gates, stop conditions | **optional** |
| 3 | Authority — decide alone vs escalate | grants + FPAW §10 allocation pattern | grants only; pattern unconsumed |
| 4 | Standing work and cadence | `COWORKER_SELF_TASKS`, room posture | **optional**, and room-owned per `DI-81E47BDA59F1` |
| 5 | Qualifications | skills, tool grants, model floor | grants and floor mandatory; **skills not** |
| 6 | Context it must know — **priming** | corpus / WSID | **not an establishment input** |
| 7 | Success measures and evidence | certification, golden journey | **optional** |
| 8 | Supervision and escalation | `escalates_to`, `human_supervisor_id` | present, not required |
| 9 | Archetype and local tailoring | — | **not modelled** |

## 4. Axis 9 is already solved — for rooms

The archetype layer derives an **Operational Value Stream Model** per organisation
(`deriveOperationalValueStream`, one of the documented derive-with-override family). Each OVSM
stage carries `key`, `input`, `output`, `responsibleRole`, `trustGateKeys`, `metricBindings`.

Two projections consume it:

- `archetype-value-stream-projection.ts` → `EaElement` rows for the `/ea/value-streams` canvas
- `archetype-room-definition-projection.ts` → room definitions, mapping *stage key → what opens the
  room, input → trigger, output → what the room owes, responsibleRole → required role,
  trustGateKeys → gate bindings, metricBindings → measure bindings*

Its own header states the invariant: *"Both read the one derived OVSM, so the diagram and the rooms
cannot disagree about what the business runs: a stage on the canvas is a room, and a room is a
stage on the canvas."*

**No projection produces the role side.** `responsibleRole` is consumed only as a free-text
`requiredParticipantRole` string.

### 4.1 The design

> A coworker job definition is the **third projection** off the same OVSM.
>
> A stage on the canvas is a room. A room is a stage on the canvas. And the role accountable for
> that stage is a **job**.

This gives every property the goal asks for, without new archetype machinery:

- **Articulate as a job** — accountabilities are the stages naming this role; measures are those
  stages' `metricBindings`; gates are their `trustGateKeys`; the trigger/outcome pair is the
  stage's `input`/`output`.
- **Archetype tailoring** — free. The definition is derived from the archetype's own OVSM, so a
  dental practice's scheduling role and a farm's differ because their value streams differ, not
  because someone hand-wrote two definitions.
- **Local context** — free. The derive-with-override family already supports per-org override, and
  the projection is per-`orgId`.
- **Deploy and upgrade** — free, and this is the part with no current answer. The room projection
  already *"re-projects, updating in place and pruning what the archetype no longer declares"* on
  the existing `(source, orgId, stageKey)` identity. The job projection converges the same way:
  a new install projects, an upgrading install re-projects, and neither needs an AI client present
  (AGENTS.md §1, *platform function never depends on a client*).

### 4.2 What priming becomes

Axis 6 stops being a free-text wish. The corpus a role must hold is derivable from the stages it
owns: their domain, their `trustGateKeys` (which name the policies in play), and the jurisdiction
already tracked by `EP-LIC-C64FC2` for licensed work. Priming is **the projection of required
context from owned stages**, seeded at deploy and re-seeded on upgrade when the archetype's stages
change.

## 5. The contract

A coworker MUST NOT reach production without a complete job definition, where complete means every
axis in §3 is either **satisfied** or **waived**.

A waiver is not a blank. It carries the same discipline as `staffing_posture` (PR #5384):

- an explicit state, per axis
- a reason a person can disagree with
- a `reviewBy` date, enforced by a test that **fails the build** when it passes

This is deliberate symmetry. The platform now has one way of saying "this is not done, on purpose,
and here is when we will revisit" — and it should have exactly one.

### 5.1 What this does not do

- It does not retro-block existing coworkers. Established roles are graded by the existing measure;
  this contract governs the door from here on, and §7 runs the existing estate through it
  deliberately rather than by breaking the build.
- It does not make every axis mandatory for every role. A read-only advisory coworker may
  legitimately waive cadence; what it may not do is leave the question unanswered.
- It does not invent a second completeness model. The nine axes ARE the seven planes plus
  supervision and tailoring; the measure stays the grader.

## 6. Slices

1. **Contract + waiver vocabulary.** The nine axes as a typed contract, the per-axis waiver with
   reason and expiry, and the guard that fails on an expired waiver.
2. **Door demands it.** `establish_coworker` accepts the job definition; `definitionChecklist`
   stops saying "optionally"; a new `LIFE-0xx` axis fails a production promotion whose definition
   is neither satisfied nor waived.
3. **Third projection.** `archetype-job-definition-projection.ts` beside its two siblings,
   deriving definitions from the OVSM per org, converging on deploy and upgrade.
4. **Priming.** Required-context derivation from owned stages, seeded and re-seeded by (3).
5. **Run the estate through it.** §7.

## 7. Running the existing gaps through the process

The operator's closing instruction. After slices 1–3, the 67 open gaps become the worklist:

| open gaps | axis |
|---|---|
| 22 cadence | axis 4 — respecting the room-owned ruling |
| 18 toolsAndSkills | axis 5 |
| 14 identity | axis 1/8 |
| 7 evidence | axis 7 |
| 6 shape | axis 2 |

Each existing coworker is run through the contract and lands in one of three states: definition
completed, axis waived with reason and expiry, or role retired. The measure's open-gap count is the
progress bar, and it is already wired to a shrink-only ratchet.

## 8. Acceptance

| # | Requirement | Evidence |
|---|---|---|
| AC-1 | A coworker cannot be promoted to production with an axis neither satisfied nor waived | gate |
| AC-2 | Every waiver carries a reason and an expiry; an expired waiver fails the build | test |
| AC-3 | Job definitions derive from the org's OVSM, so archetype tailoring needs no per-archetype authoring | test |
| AC-4 | Re-projection converges an upgrading install and prunes what the archetype no longer declares | test |
| AC-5 | The projection runs server-side with no AI client present | test |
| AC-6 | No new completeness model: the nine axes map onto the seven planes plus supervision and tailoring | doc |

## 9. Status

Sections 1–4 are grounded in substrate read at authoring time.

**Slice 1 is delivered** — `packages/db/src/coworker-job-definition.ts`: the nine axes, the
satisfied/waived vocabulary, thin-justification and expiry refusal, and `AXIS_TO_CAPABILITY_PLANE`
pinning seven axes onto the measure's own plane names so this cannot drift into a second opinion
about completeness. Twelve tests, including the one that matters: a waiver fails the build the day
its review falls due.

Slices 2–5 are not started. They are tracked on `BI-2D0063DF`.
