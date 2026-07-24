---
title: Structural verification is not functional verification
slug: structural-verification-is-not-functional
pageKind: principle
status: published
abstract: Code in a bundle, migrations applied, tests passing, routes returning 4xx — none of it proves the feature works. Drive the happy path on the live install before claiming complete.
principleTier: commandment
principleDirection: Drive the end-to-end happy path on the live install and confirm user-facing state changed before claiming a feature is complete; structural evidence alone marks it draft, not done.
principleDimensionVector: {"evidence_density": 1.0, "governance_compliance": 0.8, "long_term_maintainability": 0.5, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - build-studio
principlePublic: false
authoredAt: 2026-05-18
authoredBy: mark-bodman
---

# Structural verification is not functional verification

**The agent does not claim a feature is "complete" or "shipped" based on
structural evidence alone.** Code in a bundle, migrations applied, routes
returning the right HTTP status to malformed input, unit tests passing —
these prove the code is **installed**. They do not prove the feature
**works**.

A feature works when an operator can complete the end-to-end happy path on
the live install, observable in user-facing state. Anything less is a
**draft** status, not a complete one.

## The anti-pattern in detail

Treating these as proof of "complete" is wrong:

- Compiled bundle contains the right strings
- Database has the right tables / migrations / seed rows
- Routes respond with the right error codes to malformed requests
- Unit tests pass — especially when mocked dependencies hide the actual
  failure surface
- CI is green
- "It's wired correctly per the spec"

The first time this principle was named: 2026-05-17, after voice/STT was
declared "complete and live" four times across Slices 1 and 2. Then the
operator clicked the mic. Nothing happened. The button changed state,
audio was captured, the POST fired, the route returned 503 — because the
STT sidecar had never been started, the provider record was
`unconfigured`, and the 503 error message hid in a button tooltip telling
the operator to run a docker command. **The feature had never worked
end-to-end once.** Every "complete" claim was based on structural
evidence: bundle had the code, route returned the right error class on
malformed input, 113 unit tests passed.

## What "complete" requires

Before claiming a feature is complete, ALL of:

1. **Drive the actual happy path on the live install.** Click the button.
   Record audio. Send the email. Submit the form. Drive it via Chrome
   MCP, computer-use MCP, or a curl-with-real-payload. Do not stop at
   "the route returns the right error code on malformed input."
2. **Observe the user-visible result.** Did the transcript text actually
   appear in the textarea? Did the row appear in the admin history? Did
   the email arrive in the inbox? Screenshot, query the user-visible
   surface, confirm the receipt.
3. **If the happy path can't be driven** (e.g., requires real microphone
   input that can't be synthesized, or a real OAuth token the agent
   doesn't have), say so **explicitly** in the status report. Do not
   elide. The phrase "structural integration is proven" is a red flag
   that should be treated as **incomplete**.
4. **For features that depend on optional infrastructure** (sidecars,
   external services, GPU hardware), default-on install posture is part
   of "done." If the feature requires the operator to run any docker /
   shell command to activate, the feature is not done — per the
   [`never-ask-user-to-run-commands`](never-ask-user-to-run-commands.md)
   commandment.
5. **Read the operator-facing copy as if knowing nothing.** If the error
   message would make a non-technical operator panic, type a command
   into a terminal they don't have open, or just give up — the message
   is wrong and the feature isn't done.

## Specific tactics

- **End-to-end smoke check** as the LAST step of every implementation
  slice, BEFORE the status report. Documented in the PR's test plan as
  a checked box, not a `[ ] Manual verification (describe below)` stub.
- **Verify on the exact install posture an operator gets** — not on a worktree, not in dev mode, not with environment overrides. The live install is the ground truth. A worktree is a source-control isolation surface, not a runtime clone (see [`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md)); never invest thread time standing up pnpm/corepack, copied node_modules, or rewired workspace symlinks inside the worktree just to run a build-gate check there. Run that check against the canonical install instead, and file the worktree harness gap as its own platform BI.
- **Distinguish "I tested it" from "the operator could test it"** in
  status reports. The first is necessary but not sufficient.

## Seed-change pre-push checklist

Modifying `packages/db/src/seed.ts` or `packages/db/data/providers-registry.json`
has cascading effects: invariants enforced by
`assertActiveProvidersHaveClearance` and by
`scripts/audit-routing-spec-boot-invariants.ts` fire if the seed
produces a broken DB state. Seed runs locally against EXISTING rows on a
live install; CI runs against a FRESH DB — so "passes locally" is not
evidence the CI gate will pass.

Before pushing any seed change:

1. **Delete the rows the change might affect** from the live DB to
   simulate the fresh-install CREATE-branch path. The existing rows
   mask CREATE-branch bugs.
2. **Re-run the seed** and verify exit 0.
3. **Run the routing-invariants audit:**
   `pnpm --filter web exec tsx scripts/audit-routing-spec-boot-invariants.ts --baseline docs/superpowers/audits/2026-04-27-routing-spec-boot-invariants.json`
   Verify `new: 0` and exit 0.
4. **Verify the JSON catalog fields you're predicating on are actually
   present.** When predicating on a JSON field, either confirm it's
   universally present OR default missing values to match the schema
   default.

The cost of skipping this check is paid in CI cascades that block every
downstream PR until the fix lands. The audit script + a row delete is
~5 seconds combined.

## Penalty

This is a **commandment-tier** principle. The first violation that named
it cost the operator hours of failed mic clicks plus a multi-PR CI
cascade. There is no acceptable exception: structural ≠ functional, ever.

## Related principles

- [`never-ask-user-to-run-commands`](never-ask-user-to-run-commands.md) —
  operator-facing copy never names shell; the agent runs the system
- [`evidence-before-diagnosis`](evidence-before-diagnosis.md) — verify
  the suspected cause before naming it
- [`check-tool-signals-first`](check-tool-signals-first.md) — confirm
  the boundary's actual behavior, don't speculate
