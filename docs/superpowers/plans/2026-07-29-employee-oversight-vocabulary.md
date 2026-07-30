# Personalize the "H" in HITL — role-resolved employee/owner vocabulary

**Backlog item:** BI-F2EC4699
**Decision ledger:** DI-08B93C8D3AAF (`principle_decide`, high confidence, margin 5.431, no commandment conflict)
**Precedent:** BI-08393602 / PR #3527 — "Agent" vs "AI coworker"

## Problem

The platform used "human" interchangeably with "employee", and rendered the bare
acronym `HITL` in the portal — `HITL T2`, `HITL-0`, `HITL tier`, `human-only`.
Both are hostile to the non-technical business owner the portal is for. The
founder's direction: personalize what the "H" implies.

Two findings shaped the plan.

**A blanket `human` → `employee` replace would be wrong.** Roughly 106 sites
refer to the *business owner*, not a workforce member — `owner: "human
decision-maker"`, "A real human judgment is still required.", "accountable human
role" (used to reject naming a coworker "Owner" or "Founder"). Calling the owner
an employee is less acceptable to a non-technical reader than the status quo, not
more.

**`human` is also a live enum value, not only prose.** `callingPopulation:
"human"` on the kernel decision surface, principle `appliesTo`, `Principal.kind`,
and 11 Prisma columns (`humanSupervisorId`, `requiresHumanReview`,
`humanControlRequired`, `hitlTierDefault`, `estimateHuman*`, `humanScore`,
`avgHumanScore`, `humanContextRef`, `humanReviewedAt`, `mfaMode =
"human_step_up"`). Renaming those needs migrations; renaming the copy does not.

## Decisions (founder-confirmed, three explicit calls)

1. **Depth — user-facing copy only.** Rendered labels, user-guide docs, and
   prompt-visible vocabulary change. Internal symbols, the `human` principal-kind
   enum, and the Prisma columns stay. "human" remains the correct technical
   opposite of "agent" in the identity domain. **No migration.**
2. **Owner case — role-resolved.** `employee` for workforce referents, `owner`
   for the accountable business decision-maker (reusing the existing
   `lib/owner-first/` lens). Where a referent is genuinely neither — the identity
   principal count spans employees *and* contractors — the neutral word ("People")
   is used rather than asserting a role the code does not know.
3. **HITL acronym — dropped from the UI, kept in code.** Users see role language;
   `hitlTier` / `HITL` survive in comments, identifiers, and internal docs.

Out of scope, deliberately: `human-readable` (272 occurrences) is a different
sense of the word and must never be swept.

## What shipped

### One canonical copy module

`apps/web/lib/workforce/oversight-copy.ts` is now the single source of truth for
tier language and colour, following the `lib/proactivity/proactivity-copy.ts`
precedent:

| Stored tier | Label | Short | Intent |
| --- | --- | --- | --- |
| 0 | Employee only | Employee only | danger |
| 1 | Needs approval | Needs approval | warning |
| 2 | Employee review | Reviewed | info |
| 3 | Runs on its own | On its own | success |

Colour resolves through the new `employeeOversight` namespace in
`components/ui/report-kit/statusColors.ts`, per AGENTS.md §12 (status colour goes
through the report-kit intent registry, never a local map).

### Drift and a latent bug fixed on the way

Six components each carried their own tier map, and they had **drifted**: tier 1
was `#f97316`, `var(--dpf-warning)`, and `var(--dpf-accent)` in different files;
tier 2 was `var(--dpf-info)` in one and `#3b82f6` in another. Two used raw hex,
which §12 prohibits. A seventh label set lived in `DelegationChainPanel`'s legend
("Always human", "Spot-check").

Separately, `AuthorityMatrixPanel` and `EffectivePermissionsPanel` built badge
backgrounds as `` `${tierColour}20` `` — string-concatenating an alpha suffix onto
a CSS value. That only ever produced valid CSS for the raw-hex tiers; for the
`var(--dpf-*)` tiers it emitted `var(--dpf-error)20`, an invalid declaration the
browser dropped. Both now use the token-backed `softBg` (`color-mix`).

### Not consolidated, deliberately

`lib/coworker-service-catalog/authority-projection.ts` maps the same tier to
"Cannot act" / "Acts with approval" / "Acts with review" / "Can act within
limits". That is a *different, valid lens* — it describes the coworker's
authority rather than naming the supervising employee — and it already contains
neither the acronym nor the word "human". It is a tested contract, so it was left
alone. Consolidating the two lenses is a follow-up candidate, not this change.

## Verification

- `lib/workforce/oversight-copy.test.ts` — 9 tests. Asserts no tier surface
  contains "hitl", "human", or "tier N"; that colours resolve to `--dpf-*` tokens
  and never raw hex; that the four intents stay distinct; and that an unmapped
  tier returns `null`/"Not set" rather than a fabricated posture.
- Full `apps/web` suite: **18,030 passed**. The 128 remaining test failures are
  all `Cannot find package 'next/*'` / `@dpf/integration-shared` — the hollow
  `node_modules` in both clones, not this change.
- `agent-thread-dispatcher-runtime.test.ts` (6 failures) was **baselined on a
  clean tree with the branch stashed** and fails identically there. Pre-existing.
- Bare `tsc` is not a valid gate in this worktree (hollow `node_modules` yields
  phantom `TS2307`s); filtered to the touched files it reports zero errors.
  Real typecheck is the Docker pregate / CI.
- Suites whose components import `next/link` — including
  `WorkforceRosterPanel.test.tsx` — cannot execute locally at all and are
  verified in CI.

## Backlog coverage

- Decision: atomic
- Parent: BI-F2EC4699
- Receipt: cms6pmiiz02vk01og4ayrtura
- Dependencies: none
- Rationale: A vocabulary change is only coherent when it lands whole — no phase is independently shippable, so every deliverable ships under BI-F2EC4699 alone.

| Deliverable | Independently shippable | Depends on |
| --- | --- | --- |
| `oversight-copy-module` — canonical copy module + `employeeOversight` intent namespace | no | — |
| `component-deduplication` — collapse the six drifted tier maps onto it | no | `oversight-copy-module` |
| `role-resolved-prose-sweep` — employee/owner sweep across copy, gates, prompts | no | `oversight-copy-module` |
| `docs-and-standard` — user-guide alignment + anti-regression rule | no | `component-deduplication`, `role-resolved-prose-sweep` |

**Atomicity rationale.** A vocabulary change is only coherent when it lands whole.
Shipping the module without the six call sites would leave the acronym rendering
in five panels while a sixth showed plain language — a visibly inconsistent state
worse than before. Shipping the prose sweep without the module would re-introduce
the drifted per-component maps this change exists to delete. Shipping the code
without the user-guide pages would leave documentation naming labels the portal no
longer shows. Every phase is a partial rename of one surface vocabulary, so the
change is delivered under BI-F2EC4699 alone.

## Follow-ups

- Consolidate the `authority-projection` authority-lens labels with
  `oversight-copy` behind one registry.
- The kernel commandment page is still titled "Human-in-the-Loop at Phase
  Boundaries". Internal governance doctrine, untouched by the copy-only depth
  decision; renaming it is a kernel-evolution decision in its own right.
