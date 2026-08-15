# Work-Model Convergence Addendum — The Universal Work Formula

**Status:** DRAFT (for founder review) · **Date:** 2026-08-12 · **Scope:** platform (WWMD)
**Extends:**
- `docs/superpowers/specs/2026-07-11-collaborative-work-management-convergence-memo.md` (kernel `complete-migrate`, EP-WORK-CONVERGENCE)
- `docs/superpowers/specs/2026-07-26-work-rooms-collaboration-design.md` (Work Room = pure projection over Work Case; `roomKey === caseKey`)

**Governing epic:** EP-WORK-CONVERGENCE (live: 8 done / 4 open as of 2026-08-12)
**Verified against:** `origin/main` @ `783312f45` (2026-08-12)
**Kernel ratification (WWMD, `principle_decide`, external_coding_agent):**
- Refactoring approach → **contract-and-gate** — composite 9.06, margin 4.49, HIGH confidence, no commandment conflict · ledger **DI-BF10BF48EED5**. Top contributors: Single Source of Truth, Ground New Work In Existing Platform, Architecture Over Shortcuts, "One data model, not two integrated". (`migrate-only` 4.58; `status-quo` 1.45.)
- Standard strategy → **author-awc-composition** — composite 11.61, margin 5.84, HIGH confidence, no commandment conflict · ledger **DI-149854BD4A55**. Top contributors: Research and Use Standards, Single Source of Truth, MCP Is the Coordination Plane. (`profile-only` 4.69; `cmmn-ground` 5.77.)

---

## 0. Why this addendum exists

The convergence memo already ratified the destination: *one durable work unit → workers behind it → one business-language projection → a plain status + approve/revise loop.* Eight of its nine BIs shipped. But three things are still true on `main`, and one idea is still unwritten:

1. The coding **WorkCapsule** and the collaboration **WorkCase/WorkRoom** still read as two peer concepts to a human, even though the code already models the capsule as a *carrier behind* a case.
2. Build Studio projects capsule status through its **own** `lib/build/customer-status-projection.ts`, and a **third** projector (`OwnerChangeView`, planned 2026-07-31) is about to be added — divergence, not convergence.
3. Nothing reconciles a WorkCapsule and a WorkItem that describe the **same piece of work** (both carry `backlogItemId`, no join). You can hold two rows for one job.
4. The reason all of this *should* collapse to one model has never been stated as a principle.

This addendum names that principle (§1), affirms the layered model (§2), and makes three decisions that finish the convergence (§3). It adds **no new concept and no new id space** — every change extends an existing registry, projection, or BI.

---

## 1. Principle — the Universal Work Formula (the keystone)

> **All work in DPF runs one invariant formula. Only three axes vary. The outcome is a result of the formula applied to the axes, never a reason to fork the formula.**

**The invariant formula (how work gets done — identical for a coding change, a sales opportunity, an approval, a field-service job):**

```
frame → propose → collaborate → review → govern → verify → carry-over / close
```

Concretely, these are the *same* mechanisms for every work type:
- **Process** — the state machine + allowed transitions (`WorkCaseState`, `supportedTransitions`, `WORK_CASE_ACTION_VERBS`).
- **Collaboration** — participants under one `Principal` abstraction, RACI roles `accountable | contributor | reviewer | observer`.
- **Reviewer** — review is a first-class role and a first-class transition, not a coding-only step.
- **Governance** — decision scope (WWMD/WWWD/WSID), receipt policy, sanctioned mutators, the human-in-the-loop envelope.
- **Verification & carry-over** — the sealed `WorkRoomOutcomePacket` (with the `raw_chat_not_durable` rule), `stopConditions`, and `planWorkRoomCarryOver`.

**The three variation axes (and only these):**

| Axis | What varies | Where it already lives |
|---|---|---|
| **Context** | domain, outcome definition, which records count as evidence | `WorkCaseSourceRegistryEntry.domainCategory / owningArea / accountResolverKey / required outcome categories` |
| **Temporal** | one-shot vs standing; short vs long; cycle cadence | `roomProjection.mode` (`finite` \| `standing`) + cycle boundaries |
| **Participant** | who is in the room and in what mix (person / agent / system / external) | Work-Rooms participant model + presence |

**The load-bearing claim:** the `WorkCaseSourceRegistryEntry` *is* the variation surface, and it is small. Everything else — the projection, the action registry, the participant/role model, the governance envelope, the outcome/verify/carry-over machinery — is the invariant formula and must exist **once**. A "coding" difference that is not one of {context, temporal, participant} is duplication to be removed; a difference that *is* one of those three is data in a registry entry, not new code.

**Disposition:** promote this to a kernel principle (`docs/founder-kernel/wiki/principles/universal-work-formula.md`, retrievable via `wiki_query`), so future work-type additions and reviews test against it. It becomes the altitude check the memo lacked: *"Are you adding a variation-axis registry entry, or forking the formula?"*

---

## 2. Layered model — capsule is a carrier, not a second unit (affirm)

The code already made the right call; this addendum ratifies it as doctrine so it stops re-emerging as a question:

- **The unit users see is the Work / Work Room / Work Case.** One generic collaboration unit, addressed by `caseKey = sourceType:sourceId`, projected on read. This is what carries "only contextual, temporal and participant differences."
- **`WorkCapsule` is a specialized *durable carrier* behind a room** — a coding cycle carrier (`cycleCarrierPrecedence: ["work-item","work-capsule","task-run"]`), holding the fields a CRM approval would never want (`repositoryFullName`, `headSha`, `worktreePath`, `sandboxId`, `pullRequestUrl`). This specialization is legitimate (context axis) **and** required by Anthropic's commercial terms (executors are *workers behind the unit*, not the unit).
- **"Capsule" is an implementation term, never a user-facing peer concept.** Laymen see work, status, and outcomes; the coordination plane is backstage (AGENTS.md §12 "hide complexity from layman users").

Net: not two concepts — one unit, one specialized carrier. The remaining work is wiring, not merging.

---

## 3. Three decisions that finish the convergence

### D1 — One projection authority (closes gap c; reconciles a live divergence)

**Decision:** the **WorkCase status projection (`work-management/status-projection.ts`, `projectCapsule`) is the single projection authority.** The build-side `lib/build/customer-status-projection.ts` and the *planned* `OwnerChangeView` (2026-07-31 Phase A) become **thin adapters over it or fold into it** — they must not be independent projectors. No third projector may be introduced.

**Why:** the memo already decided this (BI-BB13B599 → wire Build Studio to `projectCapsule`); shipping a build-local projector, and now planning a second one, silently re-forks the formula (violates §1). This is the highest-urgency item because divergence is *in motion* on the 2026-07-31 plan.

**BI action:** reconcile **BI-BB13B599** (memo, done-but-build-local) against **BI-8B601F2F/`OwnerChangeView`** (2026-07-31 plan). One authority; the other is an adapter. File a convergence BI or amend the 2026-07-31 plan before Phase A builds `owner-change-view.ts`.

### D2 — Capsule↔WorkItem reconciliation on shared work (closes gap b; the only undesigned item)

**Problem:** a `WorkCapsule` (`backlogItemId = BI-x`) and a `WorkItem` (`sourceType="backlog-item", sourceId = BI-x`) can both exist for BI-x with nothing joining them; `projectWorkCaseState` combines a *pre-assembled* input and never joins a capsule to a WorkItem by backlog id. Result: two rows, one job — the exact "two things" you flagged.

**Decision (recommended, for review):** **one canonical WorkItem per unit of work; the capsule points at it.**
- At capsule claim/adoption (extends **BI-5FDBF786** work-start), resolve-or-create the canonical `WorkItem` for the underlying work and set a new nullable **`WorkCapsule.workItemId`** FK.
- `case-read-model` joins the capsule via that FK when assembling the case; fallback join on `backlogItemId` for legacy rows.
- Terminal capsule/build state reconciles back through that FK into `BacklogItem` lifecycle — which is already the open **BI-C2EB2C6B**; fold it under this decision.
- Register the FK under the cross-domain-relation governance regime (platform-substrate-convergence §6.5), since it crosses the build ↔ work-management bounded contexts.

**BI action:** **new design + BI** (this is genuinely un-owned) — "Canonical WorkItem anchor for a WorkCapsule (single case per unit of work)." Sequence it before D3.

### D3 — No orphan coding sessions (closes gap a's real question)

**Context:** BI-AC815F1E ("bridge remaining primitives via source-registry") is **done** — it registered the non-coding primitives as case *sources* and deliberately left the capsule as a *carrier*. Correct per §2. The only remaining question is: what about a capsule-originated coding session that has **no WorkItem** (an external Claude/Codex/Grok run started outside the backlog)?

**Decision:** such a session **auto-materializes its canonical WorkItem** (via D2's resolve-or-create at work-start), so **every unit of work is a room** — no coding session is invisible to the collaboration surface. The capsule stays a carrier; it never becomes a case *source*. This keeps the source registry to the {context-axis} entries only and routes all coding through the same room as every other work type.

---

## 4. Payoff — coding inherits progressive context shaping for free

This convergence also closes the gap identified in the progressive-context-shaping analysis (the WorkCapsule had no maintained "current-state that outranks history"). The Work Room already implements the *verify + carry-over* stages of the formula, and routing coding through the room delivers them without building a parallel layer on the capsule:

- **Maintained current-state** — `buildWorkRoomView` (live: next action, blocking actor, boundary, current cycle) is what a fresh executor reads first.
- **Definition-of-done "now"** — `WorkRoomOutcomePacket` (`unresolvedWork[]` dispositions, `nextReviewAt`, sealed), with `raw_chat_not_durable` enforcing "history must not masquerade as current instruction" at the type level.
- **Stop condition** — cycle `stopConditions[]` (the field the capsule lacked).
- **Steering / carry-forward** — `planWorkRoomCarryOver` turns unresolved work into the next cycle's commands.

**One home for current-state: the room.** Do not add a current-state field to the capsule.

---

## 5. BI implications (extend, don't green-field)

| Item | Action |
|---|---|
| **BI-BB13B599** vs **BI-8B601F2F / OwnerChangeView** (2026-07-31) | **Reconcile (D1).** Declare `projectCapsule`/WorkCase the authority; make the build-side projectors adapters. Amend the 2026-07-31 plan before Phase A. |
| **NEW BI** — canonical WorkItem anchor + `WorkCapsule.workItemId` FK | **File (D2).** The one undesigned item. Governed under PSC §6.5 cross-domain relations. |
| **BI-C2EB2C6B** (terminal state → BacklogItem) | **Fold under D2** — it's the same FK/reconciliation. |
| **BI-5FDBF786** (work-start auto-adopts capsule) | **Extend (D3)** — also resolve-or-create the canonical WorkItem, so every session is a room. |
| **BI-C41AB195** (AgentSession rollup) + **BI-B416B12A** (comments/@mention/presence on the canonical unit) | **Reframe** — target the *room* as the canonical unit, not the capsule; they realize the collaboration/participant axis of §1. |
| **NEW BI** — kernel principle `universal-work-formula.md` | **File (§1).** Formalization + `wiki_query` retrievability; becomes the review altitude check. |

## 6. Non-goals
- Not merging `WorkCapsule` and `WorkItem` into one table (specialization is legitimate).
- Not renaming `WorkCapsule` in code (it's an internal carrier term).
- Not a new id space or a new "unit" concept.
- Not adding a current-state field to the capsule (the room owns current-state).
