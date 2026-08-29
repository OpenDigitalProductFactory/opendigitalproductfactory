---
status: active
---

# Work Posture — implementation plan

**Epic:** `EP-WORK-POSTURE`
**Design:** [Work Posture design](../specs/2026-08-22-workroom-work-posture-design.md)
**Kernel consult:** `DI-D2A1964BD351` — `derive-and-layer`, composite 10.603, margin 6.373, high confidence

## Backlog coverage

| Slice | Item | Size | Content |
| --- | --- | --- | --- |
| A | `BI-462F3AF7` | small | Temporal band resolver over the existing operating-hours substrate |
| B | `BI-0C5A83A8` | medium | Work-posture resolver — the precedence ladder, tighten-only invariant, provenance |
| C | `BI-B32E8C32` | small | `taskClass` is dead in the Golden Triangle compiler — make it live as the shape carrier |
| D | `BI-4F468192` | medium | Room-scoped posture — declaration on `scopeClaims` + derivation from shape/stream/clock |
| E | `BI-13ED1BE1` | large | `verificationDepth` becomes load-bearing; the two HITL ladders join |
| F | `BI-5087F34F` | medium | Scheduled work records its trigger, room and obligation |
| G | `BI-BEDAFF57` | small | Archetype posture conformance test over the whole catalogue |
| H | `BI-4EB2F1D0` | medium | Room surface renders the posture and its provenance |

## Status ⟦runtime: 2026-08-28⟧

All eight slices have landed. Seven went across five PRs (#4488, #4492, #4569, and the
posture-governs branch); **H — the rich layer-by-layer provenance surface — landed on
`feat/work-posture-provenance`.**

H is a PROJECTION, not a second resolver. `resolveWorkPosture` already emitted a complete
decision log — every clamp, in application order, with a stable `reasonCode` — so
`lib/work-posture/provenance.ts` reads the layer and the driving input from that code by
lookup and never recomputes them from the inputs. A second derivation would be a second
source of truth able to disagree with the first (AGENTS.md §1). The chain renders inside
the room surface's existing collapsed "Pace and priority" disclosure and REPLACES the flat
"Why" list that section used to show, so the same reasons appear once, attributed to the
layer that produced them, and the arrival view gains no words.

Two follow-on wiring gaps were found while verifying H and filed rather than built: a
scheduled tick still does not resolve posture through the room ladder (`BI-27C8484F`), and
a coworker's ordinary in-room proactivity still resolves from the old identity ladder
(`BI-87C9C91C`). Both are the same "posture resolves but nothing consumes it" defect on
different execution paths, and are worth sequencing together so the room dimension is added
to `ProactivityResolverInput` once.

Two items outside the original eight were found and closed on the way: the workroom shape
had no write path at all (`BI-8C54B216`), and the posture was display-only
(`BI-06C41FDC`). Two more were found and filed, not built: the semantic-review
self-classification gap (`BI-888825F6`) and the preview/gate lease contention
(`BI-8FF00C3B`).

## Ordering and why

The ordering is chosen so that **nothing changes behaviour until D**, and D is a single,
reviewable switch-on rather than a diffuse one.

```
A ──► B ──► D ──► H
      ▲     │
C ────┘     ├──► E
            └──► F
G (independent — depends only on D's derivation table)
```

- **A and B are pure and inert.** They compute; nothing calls them. They can land and sit
  in the tree with zero runtime risk, which is what makes the invariant testing worth
  doing thoroughly before anything depends on it.
- **C is independently valuable.** Making `taskClass` live is a defect fix in its own
  right and is Balanced-inert on its own.
- **D is the switch-on.** One slice, one review, one place to look if posture behaviour
  changes unexpectedly.
- **E, F, H, G follow D** and are independently shippable against it.

## Phase 1 — the derivation core (this branch: A + B)

Pure, deterministic, no I/O, no caller. Delivered together because B consumes A and
neither is meaningful alone.

1. **Temporal band resolver.** Pure function over `(now, weeklySchedule, timezone,
   lowTrafficWindows, dueAt, warningWindow)` returning one band. Reads the existing
   operating-hours contract types; introduces no second calendar and no second timezone
   resolution path.
2. **Exemption list.** `security-incident`, `platform-health`, `queue-health`, and a late
   `field-dispatch-appointment` never receive a damping effect. Explicit and tested — the
   silently damped security incident is the failure this design most needs to prevent.
3. **Work-posture resolver.** The §3.1 ladder as a pure composition over both existing
   engines, emitting `PolicyAdjustment` provenance for every clamp.
4. **Tighten-only enforcement.** Not a convention — a mechanism. The composition applies
   derived deltas through a clamp function that can only move a value in the tightening
   direction, so a widening derivation is unrepresentable rather than merely untested.
5. **Balanced-inert no-regression test**, in the shape of the existing
   `golden-triangle/hot-path-no-regression.test.ts`.

**Exit criteria.** Unit tests green for the affected packages; production build clean;
every band reachable in test including DST and a closed-all-week schedule; the tighten-only
property asserted over the full cross-product of derived vs. inherited postures.

No UX verification applies — Phase 1 has no surface. No migration applies — Phase 1 adds
no schema.

## Phase 2 — make the compiler read its own input (C)

Task-class table in `compileGoldenTrianglePolicy`, bumping the compiler version. Guarded
by the existing compile snapshots so that an unknown or default task class compiles
exactly as it does today.

## Phase 3 — switch on at the room (D), then G

The room declaration reader/writer on `scopeClaims`, the shape and archetype derivation,
wired at the room-scoped seams only. The non-room inference path is untouched. G follows
immediately, because the archetype conformance test is what proves the derivation reaches
all 111 leaf archetypes rather than the one that field dispatch supplies today.

## Phase 4 — enforcement and triggers (E, F)

E is the largest slice and the one that changes what the platform will *refuse* to do, so
it lands alone. F follows.

## Phase 5 — surface (H)

Carries the UX-fit manifest and live UX verification.

## Risks and how each is bounded

| Risk | Bound |
| --- | --- |
| A derivation quietly widens authority | Tighten-only is a mechanism, not a convention (Phase 1 step 4); asserted at both B and D |
| Out-of-hours damping silences an incident | Explicit exemption list, tested, named in the spec |
| Posture behaviour changes before anyone intends it | A and B ship inert; D is the single switch-on |
| Per-archetype authoring creeps in | G's conformance test; the spec names an authored posture table as the defect to prevent |
| The compiler version bump breaks receipt reading | Receipts carry `compilerVersion`; the bump is additive and old receipts stay interpretable |

## Out of scope

Everything in the design's §11 non-goals: no replacement of either engine, no new decision
engine, no per-archetype authoring, no second calendar, no new table.
