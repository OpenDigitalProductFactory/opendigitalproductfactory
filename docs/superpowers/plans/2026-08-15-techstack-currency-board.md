# Plan — Surface the tech-stack lifecycle we are subject to (BI-6328BCA6)

**BI:** `BI-6328BCA6` (Workstream 4) · **Epic:** `EP-VSL-SURFACE`
**Depends on:** `BI-E55991E9` (grammar, merged — `TECH_CURRENCY_GRAMMAR`, Currency axis)
**Date:** 2026-08-15 · **Branch:** `feat/vsl-techstack-currency`

## Design grounding

The owner's third value-stream instance: "the technology stack we run has a lifecycle we are subject to." The Currency axis (`apps/web/lib/lifecycle.ts` `deriveCurrency`) and the `technology-currency` gap dimension already exist; `/ops/patches` surfaces the *discovered customer estate*, not DPF's own stack — and `list_patch_posture` returns nothing for our own runtimes because the own stack was never enumerated. This BI adds the missing **own-stack** surface on the existing Currency axis. Migration-free.

## Honesty constraint

Current versions are curated from the repo manifests (facts). Support/EOL dates are operator-sourced — a component with no recorded date reads as `unsourced` (an actionable gap), never a fabricated status. This keeps the board truthful and makes wiring a real EOL feed (e.g. endoflife.date) a clean follow-up.

## Deliverables (atomic)

1. **`apps/web/lib/ops/platform-stack.ts`** (pure): the curated `PLATFORM_STACK` (Node, Postgres, Next.js, React, TypeScript, Prisma, Tailwind) + `assessPlatformStack` mapping each to the canonical Currency axis via `deriveCurrency`, with an `unsourced` state for undated components; `stackCurrencySummary` + `ACTIONABLE_CURRENCIES` (feed the upgrade roadmap). Unit-tested.
2. **`/ops/stack-currency` board** + an Ops nav tab ("Stack Currency"), distinct from Patches (customer estate). Shows each component's current version, currency status, and support-end date; flags approaching/EOL items for an upgrade path; prompts recording an EOL date where unsourced.
3. **UX-fit manifest** (new read-only route) at `docs/ux-fit/2026-08-15-platform-stack-currency-board.ux-fit.json`.

## Verification

- Unit: `platform-stack.test.ts` (4) — unsourced handling, axis mapping, summary. `apps/web` typecheck clean.
- Ratchets (module-size, prose, style/token) + ux-fit gate green; local merged-CI before push.

## Backlog Coverage

Atomic: the pure Currency-axis mapping and the single board that renders it are one indivisible own-stack-currency surface — the board is not useful without the assessment, and the assessment has no other consumer. No phase is independently shippable.
