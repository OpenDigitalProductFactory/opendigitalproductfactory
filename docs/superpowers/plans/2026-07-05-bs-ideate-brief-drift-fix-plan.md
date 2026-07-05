# Build Studio ideate brief-drift fix — BI-4E84841D (EP-BS-UX-HARDENING)

**Status:** implemented (PR #2601)

## Problem

Verified live 2026-07-04 on an internal Build Studio meta-feature (a change to
the build-list UI itself): the ideate-generated Feature Brief carried
`TARGET ROLES = admin, customer` and `PORTFOLIO CONTEXT =
manufacturing_and_delivery`, and the user's explicit request for a relative
timestamp ("e.g. 3m ago") was replaced by an absolute format ("Updated Jun
15"). Erodes trust in the describe-it-and-it-builds path.

## Root cause

1. **Fabricated defaults, not LLM drift:** `saveBuildEvidence`'s designDoc
   path auto-populates a missing brief with hardcoded
   `portfolioContext: "manufacturing_and_delivery"` and
   `targetRoles: ["admin", "customer"]` (`apps/web/lib/mcp-tools.ts`).
2. **Requirement loss at the ideate→research handoff:** the ideate coworker
   summarizes the request into a 2-3 sentence `userContext` for
   `start_ideate_research`, and the researcher writes `acceptanceCriteria`
   with no instruction to preserve explicit user requirements — exact formats
   and examples get paraphrased away.

## Plan (all landed in one PR)

1. **`apps/web/lib/build/derive-auto-brief.ts` (new):**
   `deriveAutoBriefFromDesignDoc` — honest-by-default brief derivation.
   Doc-provided values or empty; never fabricated audience/ownership. Empty
   values degrade gracefully: feature attribution skips portfolio scoping on
   empty `portfolioContext`; the business brief raises "Who is affected by
   this business change?" as an open question on empty `targetRoles`.
   Extracted as its own module (rather than inline in `mcp-tools.ts`) to
   respect the module-size ratchet. Unit-tested (regression suite).
2. **Design-research prompt** (`buildResearchPrompt`,
   `apps/web/lib/integrate/ideate-dispatch.ts`): new `targetRoles` designDoc
   field with internal-meta-feature audience guidance (internal operator
   roles, never "customer"); acceptance criteria must carry every explicit
   user requirement verbatim; new `PRESERVE EXPLICIT USER REQUIREMENTS` rule.
   Prompt-contract unit tests guard both.
3. **Ideate coworker prompt** (`prompts/build-phase/ideate.prompt.md` v3 +
   hardcoded fallback in `apps/web/lib/integrate/build-agent-prompts.ts`):
   `INTERNAL META-FEATURE CHECK` (do not apply the org's customer-facing
   business context to platform tooling), explicit requirements are hard
   constraints, and `userContext` must QUOTE user requirements verbatim.
4. **`update_feature_brief` tool descriptions:** internal-work guidance for
   `portfolioContext`/`targetRoles`; verbatim-requirement rule for
   `acceptanceCriteria`.

## Verification

- Deterministic half: unit tests (`derive-auto-brief.test.ts`,
  `ideate-dispatch.test.ts` prompt-contract guards).
- Prompt-behavior half: drive a real internal meta-feature build on the live
  portal post-merge (dpf-drive-portal-and-observe-build) and compare the
  generated brief against the description — roles must be internal, portfolio
  unforced, explicit requirements present in the acceptance criteria.
