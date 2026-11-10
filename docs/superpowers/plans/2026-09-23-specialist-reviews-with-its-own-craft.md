---
title: "The pre-commit specialist reviews with its own craft"
status: active
backlog: BI-39C7D449
date: 2026-09-23
---

# The pre-commit specialist reviews with its own craft

> **BI-39C7D449.** The last open piece of the founder's 2026-09-08 direction:
> *"A data architect AI coworker for example should be looking at the data
> architecture before it's committed to make sure the design and implementation
> approach are in alignment with its expertise. Likewise the UX design expert
> for UX changes and so on."*
> Depends on [WSID reachability](2026-09-22-wsid-craft-decides-its-own-class.md),
> which is merged and proven live (`DI-96AC5C9AF3E1`).

## The gap

`selectSemanticReviewSpecialists` has routed changed files to the right
specialist for months: `.tsx` to UX Accessibility (AGT-903), `prisma/` to Data
Governance (AGT-902), `package.json` to SBOM (AGT-131), `architecture/` to the
Architecture Guardrail (AGT-181). That half works.

What never worked is the half that matters. Each branch ran on a one-line
persona string from `SPECIALIST_SYSTEM_PROMPTS` — *"You are the Data Governance
specialist. Review only data-model, migration, privacy, retention, and
governance risks"* — and nothing else. AGT-902 reviewed a migration without the
data-governance corpus scoring it. The specialist had a name and a scope, but
none of its profession's recorded doctrine.

## The mechanical cause

The registry binds a family to **role slugs**, and
`findProfessionFamilyForAgentIdentity` states the contract in its own comment:

> Registry-driven agents use `AGT-*` as `Agent.agentId` and their role slug as
> `Agent.name`.

Every call site passed the **agent id alone**. No family claims the literal
string `"AGT-903"`, so `resolveProfessionCorpusContext` returned
`missed-unmapped` and never looked the corpus up. Nothing logged a failure,
because a miss is a legitimate outcome for a genuinely unmapped agent. Measured
on the registry:

| Identifier passed | Resolves to |
|---|---|
| `AGT-903`, `AGT-902`, `AGT-131`, `AGT-181` | nothing |
| `ux-accessibility-agent` | `ux-design` |
| `data-governance-agent` | `security` |
| `sbom-management-agent` | `release-service-management` |
| `architecture-guardrail-agent` | `enterprise-architecture` |

The bindings were there the whole time. The lane was asking with the wrong key.

## The same defect in the build lane

`appendGovernedSpecialistCorpus` (BI-C654F960) exists to inject craft corpus
into build specialists and is flag-gated default-off. It passes
`identity: { agentId }` alone, and `AGT-BUILD-DA`, `AGT-BUILD-SE`,
`AGT-BUILD-FE`, `AGT-904` and `AGT-BUILD-QA` are in no family's roles — so that
injection could never fire even with its flag on. It was dead by construction,
and the flag hid it: nobody turning the flag on would see corpus appear.

`opts.role` is already the role slug the registry knows, and all five map. One
argument closes it.

## Shape

1. `specialist-craft-context.ts` resolves each specialist's craft in one DB
   round trip: read the `Agent` identity tuple the seed persists, hand
   `resolveProfessionCorpusContext` the **full tuple**, return a prompt block
   per agent plus a per-agent status.
2. `dispatchRoutedSemanticReview` layers the block onto the persona and logs one
   line naming each specialist's craft, status and page count.
3. `build-specialist-corpus.ts` passes `roleSlug`.

Deliberately **not** a hardcoded agent-id-to-craft table in the change-review
module. The registry is the binding, and reading the identity the seed already
writes means a specialist added later works with no change here.

## What it is not

**Not a gate.** Craft corpus is additive context for a reviewer. A DB error, an
unmapped agent, an empty corpus and an empty applicable slice all return the
persona unchanged, and the lane behaves exactly as it does today.

**Not a widening of scope.** The persona is ordered first and still sets what
the branch may review; the corpus supplies the doctrine that scope is judged
against. A corpus page cannot turn the UX branch into an architecture review.

**Not a mode change.** `scripts/semantic-review-policy.json` stays
`"mode": "shadow"`. Making specialists competent and making them blocking are
separate decisions, and the second needs calibration samples this install does
not have. Shipping both at once would mean a specialist blocking a merge on
doctrine it had been reading for zero days.

## Verification

`specialist-craft-context.test.ts` covers the four seeded specialists resolving
to four distinct crafts, the empty-corpus and DB-error fail-open paths, an
unknown agent, persona-before-corpus ordering, and the log line. The honest one
is *"would miss if the role slug were dropped from the identity tuple"*: it
asserts `missed-unmapped` for an identity carrying the id alone, which is
exactly the pre-change behaviour, so the regression cannot return silently.

Not proven by test: that a live review injects pages on this install. That
needs a real pre-commit review with a `.tsx` or `prisma/` file in the diff, and
is the acceptance step — read the `[semantic-review] specialist craft:` line
and confirm it says `injected` rather than `missed-unmapped`.
