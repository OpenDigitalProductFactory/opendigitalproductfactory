---
status: active
---

# Coordinated Workrooms implementation plan

**Design:** [2026-09-03-coordinated-workrooms-design.md](../specs/2026-09-03-coordinated-workrooms-design.md)
**Epics:** `EP-WORKFORCE-TRANSITION` · `EP-WORK-CONVERGENCE` · `EP-32B0E693`
**Kernel:** `DI-306B742EFD74` — derive-with-explicit-override, margin 4.817, high confidence,
autonomy-eligible. Phase B is no longer gated on a re-run. The two earlier timeouts are a separate
live defect in the steering engine, filed as `BI-D8D1371B`.

## Outcome

Every Workroom resolves exactly one accountable owner or is reported unowned. Nesting expresses
delegation downward and escalation upward, terminating at a named human. A COO coworker can see
across all rooms — progress, workload, schedules, bottlenecks — broadcast an ask down the tree, and
be told when a room stalls. The mechanism is common to every archetype; which rooms exist and which
specialists own them is per archetype; who fills each seat is per install.

## Delivery boundary

**Decision: sliced, and every slice ends at a joined seam.**

This program has now shipped four capabilities that were complete, tested, green and unconnected
(design finding 10). The response is structural rather than a resolution to be more careful: no
slice in this plan is "done" at a finished module. Each one names something observable on the
install, and that observation is the acceptance criterion.

## Phase A — governed appointment

Deliverable: a room can be given an owner, and the live room advances.

**Merged 2026-09-06** as `3201bf879` (PR #5099). Deploy to the live install is held by the
release batch valve (3 of 10 accumulated), so the on-install observable is not yet claimed.

Files:
- `apps/web/lib/mcp/packs/room-messaging-pack.ts` (the appointment tool)
- `apps/web/lib/work-management/room-participant-assignment.server.ts` (existing writer — its
  first caller)

Steps:
1. Failing tests first: appointing sets the `coordinator` role and `assignmentSource: "explicit"`;
   appointing a second coordinator is refused rather than silently added (conformance treats
   `multiple_coordinators` as blocking); appointment carries `consequence: "authority"`; a
   non-existent principal is refused rather than written as a dangling row.
2. Wire the tool to `persistWorkroomParticipantAssignment`.
3. Add the schema/handler parity guard from `scope-input-parity.test.ts` to this pack too — the
   same seam that dropped `workShape` exists here.

**Observable:** `WC-A69BCABB` leaves `conformance_pause` and its next drive tick advances a stage.
Recorded as canonical-runtime evidence, not asserted.

## Phase B — the ownership ladder

Deliverable: rooms resolve owners without hand-appointment; unresolvable rooms are listed as unowned.

Files:
- `apps/web/lib/work-management/room-coordinator.ts` (extend the existing derivation)
- `apps/web/lib/work-management/work-shapes.ts` (read `accountablePrincipalRef` as a source)

Steps:
1. Failing tests: explicit beats shape beats archetype beats orchestrator; **an unresolvable room
   returns null and is reported, never assigned to a plausible coworker**; derivation never yields
   a principal who is also the room's evaluator or approver.
2. Implement the ladder as a pure function over existing inputs. No new table.
3. Expose the unowned set.

**Observable:** the standing rooms on this install report owners without anyone appointing them,
and any that cannot are named.

**Delivered 2026-09-06.** Measured against the twelve live stalled rooms: the shape rung
resolves 12/12 drivers, each distinct from that room's own approver. The ladder is joined to
the Phase C stall item, which now names who should be appointed rather than only reporting
that nobody is — a diagnosis becomes a one-step instruction.

## Phase C — the bottleneck signal

Deliverable: a stalled room reaches a human.

This is the slice that makes finding 1 impossible to repeat: a room paused 26 times with nobody
told. It is small and it is the one with the highest ratio of value to effort in the plan.

Files:
- `apps/web/lib/attention/sources/` (new source over room drive state)

Steps:
1. Failing tests: a room paused for N consecutive ticks raises attention; an unowned room raises
   attention; a room advancing normally raises none; the attention names the room, the reason and
   the accountable principal.
2. Implement over `workspaceState.workroomDrive` — already written on every tick, currently read
   by nothing.

**Observable:** the paused room appears in the owner's attention surface.

**Delivered 2026-09-06** (`workroom-stall` source). Verified against the live database, not
only in tests: the query returns all twelve standing rooms as stalled — `WC-A69BCABB` at 331
consecutive refusals and the other eleven at 207-209, every one on
`missing_explicit_coordinator`. The seam check earned its keep: the raw SQL used the Prisma
model name `WorkroomActivity` rather than the physical `WorkCapsuleActivity`, which compiles,
type-checks and passes every unit test while returning nothing at runtime.

## Phase D — relation-derived hierarchy

Deliverable: nesting means delegation and escalation, not just containment.

Files:
- `apps/web/lib/work-management/room-relations.ts`
- escalation wiring against `agent_registry.json` `escalates_to`

Steps:
1. Failing tests: `contains` yields the delegation tree; escalation walks parent owners and
   terminates at an `HR-*` human; a cycle in the tree is refused; escalation never loops between
   orchestrators.
2. Implement as projection over the existing relation rows.

**Observable:** a stalled sub-room escalates to its parent's owner and then to a named human.

## Phase E — the COO surface

Deliverable: one view answers "is everything progressing, and where is it stuck".

Files:
- `apps/web/lib/ops/` read model; a route under the existing Operations section
- broadcast tool with tracked acknowledgement

Steps:
1. Failing tests for the read model: progress per room (owner, last cycle, last action, ticks since
   advance), workload per owner with span-of-control against the ICS-derived threshold, next wake,
   unowned and paused sets.
2. Broadcast: fan out down `contains`, record acknowledgement per room, report the unacknowledged.
   **It posts asks; it never dispatches stages.**
3. Surface built from report-kit primitives, theme-aware tokens, UX-fit manifest.

**Observable:** the COO view shows the real state of this install, including anything stuck.

## Phase F — archetype roster contract

Deliverable: which coworkers a business kind requires, and coverage measured against it.

Files:
- `packages/storefront-templates/src/` (roster declaration, derived like `standing-rooms.ts`)

Steps:
1. Failing conformance tests: every leaf archetype resolves a roster; no instance facts in the
   package (the existing demarcation guard extends to cover it); coverage is computable per install.
2. Declare the roster per archetype; measure the live install against it.

**Observable:** findings 5 and 7 become a number — "this install staffs 30 of the N roles its
archetype requires", with the gaps named.

## Phase G — the open-source-management archetype

Deliverable: this install runs its own archetype rather than the generic Software Platform leaf.

**Requires an operator pass before implementation.** The room set and roster for open-source
management are not enumerated in the design on purpose (§6.1) — inventing them would be the
author-per-archetype failure the derivation discipline exists to prevent.

Steps:
1. With the operator: enumerate the rooms and roster that an open-source management business needs
   beyond the generic set — licence and provenance, community and contributor relations, release
   signing, upstream/downstream coordination, security disclosure.
2. Add the leaf under `software-platform`.
3. Move `operatesASourceRepository` from a category gate to a leaf gate, so a SaaS product company
   in the same category stops receiving contributor-intake and DCO rooms it does not run.
4. Migrate this install to the new leaf.

**Observable:** `/ea/workrooms` shows this install's own archetype room set.

## Phase H — instance configuration

Deliverable: the live room set runs with named owners.

Config only. No code file may appear in this phase's diff — the same tripwire as the predecessor
plan's Phase F.

Steps: appoint owners for the standing rooms; activate `coo-orchestrator`; retire `WC-42C558DD`
into its replacement.

## Risks and rollback

- **A derived owner that is wrong is worse than none.** Mitigated by §4 layer 5: unresolvable
  resolves null and reports. Phase B's tests assert this directly.
- **Appointment becoming an authority bypass.** The coordinator must never satisfy a stage that
  requires an approver; conformance already refuses the overlap and Phase A tests it.
- **The COO becoming an execution path.** Phase E ships read-and-ask only; no dispatch.
- **Escalation loops.** Phase D refuses cycles and requires termination at a human.
- **Archetype churn.** Phase G changes which rooms an install receives; it migrates one install and
  the leaf gate is additive, so reverting restores the category behaviour.
- **Rollback:** A, C, D, E revert cleanly. B is a pure function. F and G are profile data.

## Backlog coverage

Filed under `EP-WORKFORCE-TRANSITION`, cross-linked to `EP-WORK-CONVERGENCE`. Coverage recorded via
`record_plan_backlog_coverage` once the plan commit's provenance resolves; no receipt claimed here.
