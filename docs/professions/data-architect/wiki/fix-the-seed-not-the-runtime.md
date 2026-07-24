---
title: Fix the Seed, Not the Runtime
pageKind: principle
status: published
abstract: Recurring config or data regressions mean the seed wasn't patched. Fix the source, then add an invariant guard.
principleTier: core
principleDirection: Patch the seed/template/setup script that produces the wrong state, not the runtime that observes it.
principleDimensionVector: {"long_term_maintainability": 0.7, "schema_grounding": 0.5, "blast_radius": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Adopters running DPF need to know that data-shape regressions get fixed at the source — patching only the runtime symptom means the bug reappears on every fresh install.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

When a config or data regression keeps recurring, the seed / template / setup script wasn't patched. Patch the source first, then add an invariant guard that fails loudly if the regression is ever re-introduced.

## Why

A runtime-only fix solves the symptom on one install and leaves every other install (current and future) broken. A seed-level fix solves the symptom on every install — fresh installs come up correctly, existing installs can re-run the seed to recover, and the invariant guard catches anyone who tries to bypass the seed in the future. The symmetric failure (only patching the runtime) is how silent installation-divergence builds up across the user base: each install has subtly different default state, no one realizes until support tickets pile up months later.

## Applies To

In-platform coworkers managing platform state, external coding agents writing seed code, and humans operating installs. Symmetric. Applies to default configs, seed data, template files, setup wizards, and bootstrap scripts.

## How To Apply

When a bug report describes "X keeps being wrong," ask: where does X get its initial value? Patch THAT. Then add an invariant guard — a startup check, a lint, a test — that asserts the seed-produced state is correct. Don't only fix the symptom in the running process; that fix evaporates on the next fresh install. When the seed change is risky, ship a migration that runs the new seed against existing installs as a one-shot — but the seed itself is the canonical fix.

## Decision Dimensions

- `long_term_maintainability: 0.7` — seed-level fixes don't recur; runtime-only fixes recur on every fresh install.
- `schema_grounding: 0.5` — the seed IS the canonical config schema; patching it keeps the schema aligned.
- `blast_radius: -0.4` — fixing the root shrinks the blast radius of recurrence: a seed-level fix stops the defect being reborn on every fresh install, whereas a runtime-only patch leaves the seed free to regenerate it indefinitely.

## Examples

- **Positive:** An agent grant table comes up empty on fresh installs, causing every tool call to silently deny. The fix patches `packages/db/src/seed.ts` to insert the required grants on bootstrap, AND adds an invariant guard that throws on agent startup if grants are missing. Two months later a refactor accidentally removes the grants from the seed; the guard fires, the deploy fails, the agent reverts before anyone hits the silent-denial bug again.
- **Counterexample:** A hot-fix opens the platform admin UI and manually inserts the missing grants on one install. The reporter is unblocked. Three new installs come up over the next month; all three hit the same bug; each gets its own hot-fix.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
