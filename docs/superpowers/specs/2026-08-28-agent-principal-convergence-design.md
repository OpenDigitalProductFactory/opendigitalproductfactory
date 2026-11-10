---
status: active
---

# Agent Principal Convergence

- **Status:** implemented
- **Backlog:** BI-53C26E60
- **Related:** BI-3907AF35 (duplicate agent rows), BI-7E75F6E6 (Build Studio reviewer routing), BI-CFD5A55A (scope markers)

## Problem

Every agent that acts on this platform needs a `Principal`. Governed receipts are
attributed to one, and the independence rules that gate initiative readiness are
expressed entirely in terms of principals: an artifact's author principal may not
equal its reviewer principal.

Principal convergence was applied to `User` rows and not to `Agent` rows. The seed
creates agents from two places — `seedAgents`, which writes the `AGT-*` roster from
`agent_registry.json`, and `seedCoworkerAgents`, which writes the parallel slug-id
rows — and neither wrote a Principal. `syncAgentPrincipal` existed and was correct,
but ran only from `establish-coworker` and from one bootstrap agent.

On a seeded install the result was 71 of 76 `AGT-*` agents with no identity at all,
including `AGT-WS-REVIEW`, the designated independent Change Reviewer.

## Why it mattered

`resolveReviewerIdentity` attributes a receipt to the acting agent's principal and
falls back to the authenticated human when the agent alias misses. That fallback is
correct on its own terms — an external CLI session label carries an agent id and is
genuinely a human acting.

With no agent alias the lookup always missed. So a coworker that was summoned, and
that did call the writer, had its receipt attributed to the delegating human. The
human is the artifact's author. An author is the one identity independence forbids.

Every `independent: true` lane was therefore unsatisfiable: `design-spec`,
`spec-approval`, `architecture-review`, `data-review`, `ux-fit-review`,
`security-review`, `compliance-review`, `domain-review`, and the archetype lanes.
No scope baseline could be written, so no schema-v2 plan-coverage receipt was
reachable from any surface.

This is the same end state the earlier reviewer-identity work set out to remove — the
fix that stopped the receipt writers resolving the reviewer from the human alias
alone, recorded in the header comment of `reviewer-identity.ts`. That fix landed in
code; the data never converged, so the code path it added could not fire.

The failure was silent in a specific and costly way: the refusal named the rule and
advised summoning a reviewer coworker, which is exactly what the operator had just
done. Nothing distinguished "you reviewed your own work" from "the coworker you
summoned has no identity".

## Design

`convergeAgentPrincipals` (`packages/db/src/agent-principal-convergence.ts`) gives
every non-archived `Agent` exactly one agent-aliased `Principal`.

It lives in `packages/db` rather than `apps/web` because the seed cannot depend on
`apps/web`. The row shape matches `syncAgentPrincipal` exactly — `kind: "agent"`,
the agent's own status, its name as display name, and a clearance resolved through
`resolvePrincipalSensitivityClearance`, which normalises an empty list to the
`["public"]` floor that existing agent principals already carry. Writing `[]` would
have looked like a faithful copy and left every converged agent with no clearance.

Two aliases are written together: `aliasType: "agent"` keyed on the agent id, which
is what the reviewer lookup reads, and the private GAID. `(aliasType, aliasValue,
issuer)` is unique, so both key spaces are read up front; a stranded GAID is skipped
rather than allowed to throw, since the agent alias is the one that carries identity
and must never be the one dropped.

It is idempotent. An agent that already has an agent alias is left untouched,
including its clearance, so re-running converges nothing.

### Ordering

The seed runs convergence as `step("agentPrincipals")` after **both** agent seeders.
Either seeder can introduce an agent with no identity, so convergence placed between
them leaves the later seeder's agents unconverged.

### Guard

`scripts/check-agent-principal-convergence-wired.mjs` runs in the source guard set.
No source check can prove the data converged — that is the seed's job at run time.
What it proves is that the seed still runs the convergence, still runs it after every
agent seeder, and that the convergence module still writes the `aliasType: "agent"`
alias the reviewer lookup depends on.

## Deliberately not done

The refusal text is unchanged. It reads a coworker fallback as a human self-review
and sends the operator in a circle, and that is worth fixing. But an agent id that
resolves to the human principal is not proof of an unregistered coworker: an external
CLI session label does exactly the same thing legitimately, which
`single-principal-conformance.test.ts` asserts and which caught an earlier attempt to
infer it. Telling the two apart requires an `Agent`-table lookup that
`resolveReviewerIdentity`'s `AliasReader` does not currently have. Recorded on
BI-53C26E60 as remaining work rather than guessed at here.

The duplicate `AGT-WS-REVIEW` / `change-reviewer` rows for one coworker are left
alone; both now have identities. Collapsing them is BI-3907AF35, and `seedAgents`
carries an inline note on why the dual-seed pairs cannot simply be merged: many FK
consumers reference the slug rows.

## Verification

Found and verified running the Second Chance Animal Rescue newsletter page through
Build Studio as its owner, where it was the blocker between a passed design and
planning.

After converging the running install's 71 unconverged agents, a summoned
`change-reviewer` recorded a `design-spec` receipt for BI-336EEDF3 attributed to its
own principal — the first governed independent receipt this install has produced.
