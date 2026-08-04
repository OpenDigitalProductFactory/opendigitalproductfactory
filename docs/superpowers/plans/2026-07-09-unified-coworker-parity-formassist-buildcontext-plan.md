# Unified coworker path parity: form-assist + Build Studio context (BI-45514C4E)

- **Date:** 2026-07-09
- **Epic:** EP-F7E35344 (AI Coworker Capability Inputs) — relates EP-CLAUDE-INSIDE-OUT
- **BI:** BI-45514C4E ("Resolve the legacy-vs-unified coworker prompt path split")
- **Kernel altitude ledger:** DI-C77495CA9CCF (`parity-only-no-flip`)

## Design grounding

- **Source of truth:** `apps/web/lib/actions/agent-coworker.ts` — the coworker
  chat action, which branches on `USE_UNIFIED_COWORKER` (`isUnifiedCoworkerEnabled`,
  `lib/shared/feature-flags.ts`). Unified branch → `assembleSystemPrompt`
  (`lib/tak/prompt-assembler.ts`); legacy branch → inline `promptSections`.
- **Substrate inspected:** the unified branch is a superset of legacy on skills,
  decision-routing, profession corpus, wiki recall, context arbitration, and
  working-memory (BI-15FE2F07) — **except** two sections only the legacy branch
  injects: the elevated form-fill instruction (`buildFormAssistInstruction`) and
  Build Studio context (`getBuildContextSection` + ideate reusability guard +
  live execution progress). The legacy branch also auto-resolves the `/build`
  route build id; the unified branch did not, so a Build-Studio coworker on the
  unified path also silently lost build-scoped tool filtering
  (`resolvedBuildId`, agent-coworker.ts).
- **Decision:** create a new shared artifact (`coworker-context-sections.ts`)
  that is the single implementation of these sections, consumed by the unified
  path. This is the substantive, non-regressing majority of "resolve the split."

## Kernel decision (why no flip in this PR)

`principle_decide` (DI-C77495CA9CCF) scored three options; **`parity-only-no-flip`
won (composite 14.07, high confidence)** over `close-parity-then-flip` (12.85) and
`naive-flip-now` (3.98). Flipping the default changes how every install's coworker
prompt is assembled (high blast radius) and is the operator's call; this PR closes
the parity gap so the flip becomes a safe, well-understood follow-up.

## Approach

1. **New module** `lib/tak/coworker-context-sections.ts`: `formAssistSection`,
   `resolveRouteBuildId`, `buildBuildContextSections`, and a `buildCoworkerExtraSections`
   convenience that returns `{ resolvedBuildId, sections }`. Logic is copied from
   the legacy branch verbatim so output is identical.
2. **Assembler** `prompt-assembler.ts`: new optional `extraSections: string[]`,
   appended after Block 7 (attachments). Empty/absent is a strict no-op (empty
   and omitted produce a byte-identical prompt); empty-string entries skipped.
3. **Unified branch** `agent-coworker.ts`: call `buildCoworkerExtraSections`,
   assign back `resolvedBuildId` (so build-scoped tool filtering applies), pass
   `extraSections`.
4. **Legacy branch: UNTOUCHED.** It keeps its inline copy, guaranteeing a strict
   no-op for current default installs. Pointing legacy at the shared module is a
   follow-up SSoT cleanup (tracked on the BI).
5. **Tests:** helper (`formAssistSection` gating, `resolveRouteBuildId` route
   cases) + assembler (`extraSections` placement, empty/omitted no-op, empty-entry
   skip).

## Blast radius

Because the default flag stays off, these changes affect **only installs that
explicitly enabled `USE_UNIFIED_COWORKER`** — which were previously getting a
*broken* unified path (missing form-assist + build context + build-scoped tools).
For them this is strictly a fix; for the default-legacy majority it is a no-op.

## Follow-up (operator-gated)

- Flip `USE_UNIFIED_COWORKER` default on (one line in `isUnifiedCoworkerEnabled`),
  after runtime-verifying unified parity on a live install.
- Retire the legacy branch and point it (or delete it) at the shared module.
