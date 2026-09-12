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

## Phase 1 — this branch

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

## Phase 2 — not in this branch

- **Recursive roll-up (AC-CS-04).** A concluded room reconciles against the objective it
  serves through `ProductObjectiveWork`, and an objective whose measure is unmet with no
  work in motion and no named blockage becomes an unmet outcome at the level above,
  terminating at the organization's stated purpose.
- **One visible answer (AC-CS-05).** A single read answering outcome-met / in-motion /
  blocked-and-owned for a room, an objective and the organization.
- **Live proof (AC-CS-06).** A real unmet outcome surfacing without anyone asking.

Phase 1 is the substrate Phase 2 reads. Splitting here keeps the recursion honest: there is
no point rolling up conclusions until every tick produces one.

## Design constraints, each from an observed failure

- **Tighten-only.** No new authority and no new escalation path. A blockage is surfaced to
  its already-accountable owner, and reaching a human still obeys the escalation gate
  (`BI-6B3DA9DD`): damaging, or nothing recorded can steer it.
- **Not a nag.** An always-red signal is worse than none (`BI-E71B2F82`). A blockage carries
  the event that clears it, so it can be rechecked when that event could have occurred
  rather than re-raised on a timer.
- **No new engine.** Composed from the drive, the shape registry and the accountability
  lineage that already exist.
