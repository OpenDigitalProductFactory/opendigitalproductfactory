# WSID Profession Decision Gate — closing the third decision-scope gap

_Status: implemented with BI-9900B365 · EP-8DC217EB BET-0c · 2026-07-09_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §9 (BET-0c) · sibling audit finding: plan §4 BET-2 ("WSID has no gate")_

## The gap

DPF's three decision scopes each need a governed door
([`decisions-belong-to-their-scope`](../../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md)):
WWMD had `build-studio-gate.ts`, WWWD had `org-business-gate.ts`, but WSID — a
profession-scoped "what would a competent _craft_ do here" decision — had **no
gate**, even though the `wsid-*` `DecisionPerspectiveProfile` rows are seeded
and the registry-driven identity binding (`resolve-profession-profile.ts`,
`docs/professions/registry.json`) already existed. Craft decisions therefore
either went unledgered or leaked into the wrong scope.

## What landed

Third sibling gate, same three-primitive spine, keyed on **agent identity**:

- **`resolveProfileMaterialForProfession`** (`material.ts`) — WSID mirror of
  `resolveProfileMaterialForOrg`: agent identity → registry family →
  `wsid-<professionKey>` entry profile → the shared `resolveProfileMaterial`
  chain-walk. Returns `professionProfileSelected` (true only when the
  profession's OWN profile supplied the material — not a fallback, not a
  coverage gap) and `professionKey`.
- **`evaluateProfessionDecisionGate`** (`profession-gate.ts`) — mirrors
  `org-business-gate.ts`: fail-closed to `escalate`, coverage-gap → `defer`
  (with an explicit unbound-role message), every outcome persisted to the
  `DecisionInteraction` ledger with
  `outcomePayload.{professionProfileSelected, professionKey, caller}`,
  `[tool-trace] wsid.*` events. `evaluateDecisionPerspective` is unchanged —
  it was already profile-agnostic.
- **`evaluate_profession_decision`** MCP tool
  (`mcp/packs/profession-decision-pack.ts`, pack-registered — not the frozen
  inline switch): resolves the CALLING coworker's identity from the dispatch
  context (refuses when no agent identity reached the tool), advisory
  recommendation + ledger record. Grant mirrors
  `evaluate_org_business_decision` (`work_capsule_read`).
- **`bet-professions.ts`** — the plan §9 0c bet→profession routing map
  (primary-first), contract-tested against `registry.json`. Consumed by the
  BET-0d dispatch harness; MUST NOT be duplicated elsewhere.

## Roster verification (the "assign profiles" half)

All 20 `COWORKER_AGENT_SEEDS` slugs already resolve to a profession family via
`registry.json` `roles[]` (verified mechanically 2026-07-09; the
establish-coworker checklist step 5 keeps this invariant for new coworkers).
Assignment is registry-driven — adding a coworker to a family's `roles[]` IS
the profile assignment; no DB write, no new binding table.

## Non-inherit boundary

Same doctrine as WWWD: platform doctrine is ADVISORY fallback when the craft
corpus is silent (`professionProfileSelected=false` is recorded), and an
unbound role defers rather than silently borrowing another scope's authority.

## Research & benchmarking

Shape follows the two in-repo siblings rather than inventing a new engine
(the ~70% gate duplication is a known BET-2 target — a future
`evaluatePerspectiveGate({resolver})` collapse absorbs all three; this gate
deliberately keeps the sibling shape so that collapse stays mechanical).
External anchor: profession-scoped decision corpora mirror how clinical/legal
practice guidelines gate craft calls separately from org policy.
