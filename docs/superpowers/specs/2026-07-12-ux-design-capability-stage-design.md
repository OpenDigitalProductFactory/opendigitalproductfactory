# UX-design capability stage — enforced design-system check + propose-N directions

- **Status:** implemented (check wired advisory; directions a wired primitive)
- **Date:** 2026-07-12
- **BI:** BI-66656F61 · **Epic:** EP-F7E35344
- **Strategy:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §5

## Problem

DPF already has a strong design-system *prompt* (`specialist-prompts.ts` FRONTEND_ENGINEER: DPF tokens, no hardcoded colors, an a11y bar) — but two 2026 UX-design practices had no home in the pipeline:

1. **The design-system rules are prose, not a check.** Nothing verifies the generated code against them; the review phase captures a single screenshot, not a token/a11y audit. A frontend model that ignores the prompt ships a hardcoded `#4ade80` and no one gates it.
2. **No propose-N visual directions.** Sampling-temperature variety was removed on Opus 4.7+/Sonnet 5; Anthropic's sanctioned substitute for a net-new surface is to propose N concrete directions and pick one. DPF had no such step, so net-new UI converges on the model's default house style.

## Design

Two pure, dependency-injected modules under `apps/web/lib/build/`:

- **`ui-quality-checks.ts` — `scanUiSource(source, {isPlatformUi})`.** A heuristic static scan (regex over source, not a full parser) that flags exactly the rules the frontend prompt names: hardcoded hex, tailwind color-shade classes, inline rgb/hsl (critical on platform UI, minor on product-sandbox UI where a generated palette is legitimate); and a11y smells — `div onClick`, `span role="button"`, and interactive-source-without-`focus-visible`. A line already using `var(--dpf-*)` and comment lines are suppressed. Returns findings + severity counts + `clean`.
- **`design-directions.ts` — `proposeVisualDirections(surface, {llm, count})`.** Prompts for N (clamped 2–4) DISTINCT directions (background + accent + typeface + rationale), parses the JSON array, drops malformed entries, and renders a "pick one before building" block for the ideate/UX-fit trail.

## Wiring

The static check is wired as an **advisory** gate in `pre-pr-gates.ts` (`runUiQualityGate`), scanning added lines of changed `.tsx/.jsx/.css` files — the same diff-scan seam as the security/architecture/dependency gates. It **warns, never blocks** (UX findings are non-gating in this pipeline) and sets `requiresHumanReview`, so a token/a11y regression surfaces on the PR gate report instead of only in a prompt the model may ignore. `proposeVisualDirections` is a wired primitive callable at ideate for a net-new UI surface; attaching its output as UX-fit evidence is the natural follow-up once a net-new-surface signal is threaded through ideate.

## Verification

`ui-quality-checks.test.ts` (12) — token rules (hex/tailwind/rgb, platform-vs-sandbox severity, var(--dpf-*) + comment suppression, semantic-class non-flag), a11y (div onClick, span role=button, focus-visible file-level once + present-not-flagged), clean/counts, formatting. `design-directions.test.ts` (10) — prompt contents, parse, malformed-drop, count clamp, unparseable→empty, formatting. `pre-pr-gates.test.ts` UI-gate integration (3) — warn-never-block + requiresHumanReview, token-compliant pass, non-UI-file ignore. All pure-module tests pass locally via vitest; the pre-pr-gates suite runs in CI (it transitively imports the generated Prisma client, unavailable in a source-only worktree).

## Non-goals

Not a browser/visual-regression harness (multi-viewport + light/dark screenshot + axe against a live DOM is the follow-up, building on `build-review-verification`). The static check is a heuristic lint, not a full a11y auditor. Does not replace the frontend design-system prompt — it enforces it.
