# Universal Work Formula — Refactoring Plan (durable, repeatable)

**Status:** DRAFT (for founder review) · **Date:** 2026-08-12 · **Scope:** platform (WWMD)
**Parent:** EP-WORK-CONVERGENCE · **Design:** `…/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md`
**Verified against:** `origin/main` @ `783312f45`
**Kernel ratification (WWMD):** approach = **contract-and-gate** (ledger **DI-BF10BF48EED5**, composite 9.06, margin 4.49, HIGH); standard = **author-awc-composition** (ledger **DI-149854BD4A55**, composite 11.61, margin 5.84, HIGH). No commandment conflicts.

---

## The core idea: refactor to a *contract + gate*, not a migration

A migration converges two rows once. What you asked for is **a repeatable approach** — so the deliverable is a **conformance contract** that any durable work carrier (`WorkCapsule`, `WorkItem`, `TaskRun`, and every future one) must satisfy, plus a **CI conformance gate** that makes divergence impossible to ship. The refactor then applies the *same recipe* to each carrier. This is the pattern DPF already uses for AI coworkers (canonical definition contract + nightly conformance gate) and archetypes (completeness gate) — we are giving "work" the same paved road.

The durable rule the gate enforces is the principle from the addendum:

> A difference between two work types that is **not** {context, temporal, participant} is duplication and fails the gate. A difference that **is** one of those three is a registry entry, not code.

---

## Part 1 — The repeatable mechanism (build this first; it is the reusable asset)

### 1.1 `WorkUnit` contract (the invariant, extracted once)
Extract the invariant Work Formula that `work-management/status-projection.ts` already implements into an explicit contract every carrier implements via a thin adapter:

```
WorkUnit (contract)
  identity          caseKey = sourceType:sourceId          (one addressable key)
  participants[]    Principal + role(accountable|contributor|reviewer|observer)
  process           state ∈ WorkCaseState, allowed transitions (WORK_CASE_ACTION_VERBS)
  currentState      buildWorkRoomView()  — the maintained "read this first" projection
  outcome           WorkRoomOutcomePacket — sealed DoD, raw_chat_not_durable, stopConditions
  governance        decisionScope(WWMD|WWWD|WSID) + receiptPolicy + sanctionedMutators + envelope
  carryOver         planWorkRoomCarryOver()
  ── variation axes (data, not code) ──
  context           domainCategory / owningArea / outcome-required-categories
  temporal          roomProjection.mode (finite|standing) + cycle boundaries
  participantMix    who/what is admitted
```

Nothing new is invented — this *names* what `WorkCaseSourceRegistryEntry` + the room projection already encode, so it can be enforced.

### 1.2 Single projection authority
`work-management/status-projection.ts` (`projectCapsule` etc.) is the **only** projector. `lib/build/customer-status-projection.ts` and the planned `OwnerChangeView` become thin adapters over it. (Addendum D1.)

### 1.3 Carrier adapter interface
Each carrier exposes `toWorkUnit()` (pure): `WorkCapsule → WorkUnit`, `WorkItem → WorkUnit`, `TaskRun → WorkUnit`. The projection consumes `WorkUnit`, never a carrier's bespoke shape.

### 1.4 Conformance gate (the thing that makes it durable)
A CI check + registry validation that fails a PR if:
- a new work carrier/source ships a **bespoke status projector, state enum, or lifecycle** instead of a `toWorkUnit()` adapter + a `source-registry` entry;
- a carrier difference is expressed in **code** rather than as a {context/temporal/participant} registry field;
- a carrier can originate work with **no addressable case** (orphan).

Model it on the coworker-definition conformance gate. This is what stops the next `OwnerChangeView` from being born.

### 1.5 Paved-road skill
`dpf-bring-work-under-formula` — the repeatable recipe an engineer/coworker follows to put ANY work type under the formula: *register variation axes in `source-registry` → implement `toWorkUnit()` → route through the single projection → pass the conformance gate → never author a bespoke projector/status.* (Mirrors `dpf-add-archetype` / `dpf-establish-coworker`.)

---

## Part 2 — The refactor, applied as the same recipe per carrier

Each carrier goes through the identical 5 steps (that repetition is the "repeatable approach"):

**R1 — Extract & codify** the `WorkUnit` contract from the existing WorkCase projection. *(once)*
**R2 — Anchor** (Addendum D2, the one green-field item): canonical `WorkItem` per unit of work; nullable `WorkCapsule.workItemId` FK resolved at claim/adoption; `case-read-model` joins by it (fallback `backlogItemId`); fold **BI-C2EB2C6B** (terminal state → BacklogItem) here. Governed under platform-substrate-convergence §6.5 cross-domain relations.
**R3 — Adapter-ize each carrier:** implement `toWorkUnit()` for `WorkCapsule`, then `WorkItem`, then `TaskRun`; delete/fold the build-local projectors into the single authority (Addendum D1).
**R4 — Gate it:** ship the conformance gate (1.4) + the paved-road skill (1.5), so future carriers can't diverge.
**R5 — Terminology & UX:** demote "capsule" to an internal carrier term; every user-facing surface says work / room / case; capsule sessions with no WorkItem auto-materialize one (Addendum D3) so nothing is an orphan.

### Phasing (maps to live BIs — extend, don't green-field)

| Phase | Work | BI mapping |
|---|---|---|
| **P0** Contract | Extract `WorkUnit` + `toWorkUnit()` interface; declare single projection authority | **BI-5659D187** (contract + single authority) — reconciles **BI-BB13B599** vs `OwnerChangeView`/**BI-8B601F2F** |
| **P1** Anchor | Canonical WorkItem + `workItemId` FK + join + terminal reconcile | **BI-650994D7** (anchor) ⊃ **BI-C2EB2C6B**; extends **BI-5FDBF786** |
| **P2** Adapters | `toWorkUnit()` for capsule/workitem/taskrun; fold build-local projectors | reframe **BI-C41AB195** (AgentSession rollup → room), **BI-B416B12A** (comments/@mention/presence → room) |
| **P3** Gate + Skill | Conformance gate CI check + `dpf-bring-work-under-formula` skill | **BI-BC6099FE** (gate + paved-road skill) |
| **P4** Terminology/UX | Demote "capsule"; orphan-free rooms; unify surfaces | reframe under **BI-5EA94BD1** lineage |
| **P5** Principle | Kernel principle `universal-work-formula.md` + `wiki_query` | **BI-321FA58B** (principle) — kernel-ratified DI-BF10BF48EED5 |

Write-model-first ordering (P1 anchor before adapters), matching the memo's proven sequencing.

---

## Part 3 — Standard candidate: **Agentic Work Case (AWC)** — compose, don't fork

**Research verdict (sources dated 2026-08-12):** the surveyed standards each own one layer and stop short of ours. A2A (Linux Foundation) standardizes *task transport + state* but models **one task, one agent, two roles** (`user`/`agent`) — no rooms, no accountability, no standing work. MCP Tasks standardizes *async execution* (and is **in flux** — demoted to an extension in the 2026-07-28 RC, so anchor loosely). OMG **CMMN** is the mature *case/stage/milestone/role* meta-model for non-deterministic knowledge work — but a notation, not a runtime protocol, and agent-blind. AGNTCY / Agent Protocol standardize agent *infrastructure/runtime*, not a work-case. **RACI/DACI** give the accountability vocabulary. **No standard defines a shared work-case spanning human + AI participants with roles, finite/standing temporality, outcome packets, and a governance envelope.** That is genuine white space — and DPF has already *built the reference implementation* of it.

**Recommendation: author AWC as a NEW standard candidate that is explicitly a *composition*, not a competitor** — the strongest position because we contribute working code, not a paper, matching Arcamanus's OSS-steward posture.

| Layer | Source | DPF stance |
|---|---|---|
| Task transport + state | **A2A** (`TaskState`, `AgentCard`, `tasks/*`) | **Adopt verbatim.** Already mirrored: `WorkCaseA2aStatus` = 8/9 A2A states; agent-card export live. Profile, never fork. |
| Async execution | **MCP Tasks** | Adopt as a **loose** boundary projection (Phase 0 shipped on `TaskRun`); do not hard-couple — spec is moving. |
| Case semantics | **OMG CMMN** (Case/Stage/Milestone/CaseRole) | Borrow **vocabulary + semantics**, not the XML notation. |
| Accountability roles | **RACI/DACI** | Cite as prior art for `accountable/contributor/reviewer/observer`. |
| **The new normative layer (our contribution)** | **AWC** | Author only what has no owner: symmetric **human+AI participant model** + accountability modes; **finite/standing temporal axis** + cycles/carry-over; **OutcomePacket** (governed close-out, `raw_chat_not_durable`); **Boundary contract** (11 gaps); **governance/receipt envelope**. |

**The `WorkUnit` contract (Part 1.1) IS the AWC data model** — refactor and standard are one artifact at two altitudes. This forces the sequencing that de-risks a "standard of one": **build the internal contract first (P0), harden it with the conformance gate (P3), then externalize the proven contract as AWC.** Author the standard *after* it has a reference implementation and, ideally, a co-sponsor.

**Venue:** the Linux Foundation agentic cluster (A2A + AGNTCY), which already positions as A2A/MCP-interoperable — the plausible home for a work-case layer *above* them. Governed under the existing MCP/A2A adoption epic **EP-E1F1DB58** (which already commits to the "coded spine · AI-reasoned fulfillment · human-gated consequences · coordinate-by-proposal-never-remote-write" boundary — AWC extends that, doesn't restate it).

**Standard-candidate BI:** **BI-AADFFCAF** ("AWC standard candidate — externalize the WorkUnit contract as an A2A/MCP/CMMN composition") under **EP-E1F1DB58**, sequenced **after** P3 (gate) proves the contract. Extend-vs-author ratified via `principle_decide` (WWMD) — **DI-149854BD4A55**, author-awc-composition, composite 11.61, margin 5.84, HIGH.

---

## Non-goals
- Not merging carrier tables (specialization is legitimate, gated by the three axes).
- Not renaming `WorkCapsule` in code.
- Not a new id space (`caseKey` stands).
- Not adding current-state to the capsule (the room owns it).
