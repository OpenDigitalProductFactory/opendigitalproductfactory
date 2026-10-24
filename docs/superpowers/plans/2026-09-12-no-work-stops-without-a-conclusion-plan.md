---
status: active
---

# No work stops without a conclusion — implementation plan

**Epic:** `EP-C00F61F4` (improvement is a platform facility)
**Item:** `BI-12A083B4`
**Founder direction:** 2026-09-11

> "If outcomes aren't met, continue or surface what is blocking when you stop so we can
> address the blockage. This is a recursively repeatable thing until the organization's
> stated objectives, the very reason for its existence, is met."

## The invariant

A stop is legitimate in exactly three states: the declared outcome is **met**, work
**continues**, or a **blockage** is named with an owner who can clear it and the
observable event that would clear it. Any fourth state is silence, and silence is what
makes a person have to ask.

## What was true before this

Measured against the drive's own exits in `lib/work-management/drive-resolution.ts`:

| exit | before | now |
| --- | --- | --- |
| `do_not_wake` / `missing_shape` | silent forever; nothing wakes the room | blockage, owner named |
| `do_not_wake` / `no_posture` | silent forever | blockage, owner named |
| `stop` / `unreachable_substrate` | ledger literally reads "drive stopped and raised nothing" | blockage, owner named |
| `stop` / `empty_read` | same | blockage, owner named |
| `stop` / `conformance_stop` | deviations recorded, no accountable | blockage, owner named |
| `attention` / `unknown_principal` | a hand raised at nobody | blockage, owner named |
| `stop` / `success` | correct | outcome-met |
| `do_not_wake` / `quiet` | correct | in-motion, a cadence decision |
| `attention` / role, person, governed | correct | in-motion |
| `dispatch_agent` / `agent_stage` | correct | in-motion |

Six of the ten left a room waiting on no one.

## Phase 1 — every tick concludes (delivered)

1. **`lib/work-management/drive-conclusion.ts`** — one pure classifier. It does not decide
   whether to stop; the work shape's declared stages and stop conditions already do that.
   It classifies the stop the drive reached. Unknown action/reason pairs fail closed as
   `unconcluded`, so a future exit that forgets to conclude surfaces on its first tick.
2. **Owner resolution, shared not duplicated.** `resolveRoomAccountabilityFromDb` is
   extracted beside the existing room-workforce read and both now build their lineage
   input through `accountabilityRoomsFrom`, so they cannot drift on who answers for a
   room. It walks containment and terminates at `Organization.topAccountablePrincipalId`.
3. **Lazy by construction.** `driveOutcomeNeedsOwner` gates the lineage walk, so a room
   that is moving or finished never pays for it. Only a stuck tick resolves an owner.
4. **The drive records it.** Every persisted snapshot carries `conclusion`, so a stop that
   concluded nothing reaches the database as a blockage rather than as quiet.
5. **Conformance walks.** Every action/reason pair the drive can produce is classified with
   no silence; every blockage names an observable unblocking event rather than a shrug;
   and every work shape in the registry declares a way to succeed, a way to fail, a named
   accountable per stage, unique stage keys and declared evidence.

Phase 1 is the substrate Phase 2 reads. Splitting here keeps the recursion honest: there is
no point rolling up conclusions until every tick produces one.

## Phase 2 — the recursion (delivered)

The word that matters in the founder's sentence is **recursively**. A room that concludes
cleanly while the objective it serves goes unmet, with nobody working on it, is the same
silence one level up. So the same three states are applied again at the objective, and again
at the organization, terminating at its stated reason for existing.

1. **`lib/work-management/conclusion-rollup.ts`** — pure, and the only place a judgement is
   made. `rollUpObjective` composes the objective's existing posture
   (`deriveObjectivePosture`) with the conclusions the drive already wrote on the rooms
   serving it. `rollUpOrganization` takes the state furthest from "someone is carrying this"
   across the objectives in play.
2. **The case this phase exists for (AC-CS-04).** An objective whose measure is unmet, with
   no work in motion and nothing blocked, previously raised nothing at all. It is now a
   blockage owned by whoever answers for the organization, cleared by *work is linked and
   started against this objective, or its target is revised*.
3. **Silence outranks a blockage.** `unconcluded` is treated as worse than `blocked`,
   because a blockage has an owner and a clearing event while an unconcluded state means
   nobody can even say what is true. That is the whole subject of this epic.
4. **Never call unreadable "met".** An objective with no observation, no baseline, no target
   or a changed measure contract is `unconcluded`, never `outcome-met` — the same rule
   Phase 1 applies when an owner cannot be resolved. It names the observation that would
   make it readable.
5. **Never invent an owner.** With no accountable principal the objective records
   `unconcluded` plus the setup that is missing, rather than a blockage stored against
   nobody. Proven by a test asserting the owner id appears nowhere in the output.
6. **What is not in play cannot make the organization look unmet.** Draft objectives are
   still being formed; closed and archived ones were concluded or withdrawn deliberately.
   All three are reported with a reason and excluded from what the organization owes.
7. **Terminating conditions.** Every objective in play met is success. No stated mission is
   `unconcluded` — the deepest form of the defect, not an unmet outcome but no stated
   outcome to be unmet. A stated mission with no objective in play is `unconcluded` too.
8. **One visible answer (AC-CS-05).** `resolveOutcomeRollup` answers for the organization
   and every objective in one call and one vocabulary, so the two cannot drift.
   `conclusion-rollup.server.ts` is the read that composes the real substrate into it.
9. **Conformance walks.** Every objective status crossed with every posture the type can
   hold is classified with no silent default; every blockage raised names an owner or the
   setup that is missing, plus an observable clearing event.

### Still owed

- **Live proof (AC-CS-06).** A real unmet outcome surfacing on this install without anyone
  asking. Phase 2 is proven by tests and by the read composing real substrate, not yet by
  observation on live data.

## Design constraints, each from an observed failure

- **Tighten-only.** No new authority and no new escalation path. A blockage is surfaced to
  its already-accountable owner, and reaching a human still obeys the escalation gate
  (`BI-6B3DA9DD`): damaging, or nothing recorded can steer it.
- **Not a nag.** An always-red signal is worse than none (`BI-E71B2F82`). A blockage carries
  the event that clears it, so it can be rechecked when that event could have occurred
  rather than re-raised on a timer.
- **No new engine.** Composed from the drive, the shape registry and the accountability
  lineage that already exist.
