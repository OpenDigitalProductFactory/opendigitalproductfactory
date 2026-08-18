---
status: active
---

# UX Foundation — Button, Surface & the `--dpf-on-accent` Token

**Status:** Shipped (with this PR)
**Owner:** Platform / Web UX
**Date:** 2026-08-16
**Surface:** `apps/web` (portal)
**Origin:** Simplify & Strengthen architecture pass 2026-08-16 §3.3-b / §4-P1 (Tier-0 move #3)

---

## 1. Problem

The two most-repeated markup patterns in the portal have no primitive at all:

- The **card string** (`border-[var(--dpf-border)] … bg-[var(--dpf-surface-1)]`)
  appears ~727 times across 426 files, with radius (`rounded`/`md`/`lg`/`xl`/`2xl`)
  and padding (`p-3`/`p-4`/`p-5`/`p-6`) drifting per page.
- The **accent-button string** (`bg-[var(--dpf-accent)] … hover:opacity-90 …`)
  appears ~296 times — and because no token existed for "the label color on an
  accent fill", the label was hardcoded `text-white` (~346 occurrences, the
  single largest theme-violation class). The canonical `primaryButtonClass`
  itself carried the defect. **The missing `--dpf-on-accent` token made
  compliance impossible**: in dark mode the accent is a light periwinkle
  (`#7c8cf8`) on which white fails WCAG AA (3.0:1).

The architecture pass names the systemic pattern (P1 — paved roads without
ratchets): the platform builds correct primitives and leaves adoption
voluntary. The one success, `report-kit`, shipped with a spec, a README, named
components, and a ratchet culture. This spec applies that recipe to the button
and card layer.

## 2. Research & Benchmarking

Compared before finalizing (per the design-research rule):

- **shadcn/ui `Button` / `Card`** — variant + size props resolved by a class
  composer (`cva`), colors through CSS custom properties (`--primary` /
  `--primary-foreground`). DPF **adopts** the foreground-token pairing (that is
  exactly `--dpf-accent` / `--dpf-on-accent`) and the variant/size prop shape;
  **rejects** the `cva`/`tailwind-merge` dependency — two `Record` lookups
  cover four variants and two sizes, and DPF already declines class-merge
  libraries elsewhere.
- **Radix Themes `Button` / `Card`** — semantic color scales with guaranteed
  contrast per step (step-9 fill pairs a computed contrast color). DPF
  **adopts** the principle that the pair is defined once in the theme, not per
  call site; **rejects** the full 12-step scale — the DPF token set is
  deliberately small and brand-overridable at runtime.
- **Material (MUI) `Button`** — `variant="contained|outlined|text"` maps to the
  same primary/secondary/ghost trio; `theme.palette.primary.contrastText` is
  the on-accent analog. Confirms the four-variant envelope is the industry
  floor; DPF adds `danger` because destructive confirm buttons already exist
  (Dialog `tone="danger"`).

## 3. Decisions

1. **`--dpf-on-accent` is a first-class color token**, hand-authored in
   `apps/web/app/globals.css` beside `--dpf-accent` (the color tokens are
   deliberately not in the DTCG generator — see the globals.css header):
   light `#ffffff` (5.2:1 on `#2563eb`), dark `#0f0f1a` (6.3:1 on `#7c8cf8`).
   The runtime brand override registers it as `palette.onAccent`
   (`apps/web/lib/release/branding.ts`) so a brand whose accent flips the AA
   answer can override the label color with it. Several components already
   referenced `var(--dpf-on-accent, fallback)` speculatively; the token now
   exists and the fallbacks become dead insurance.
2. **`ui/Button`** (`apps/web/components/ui/Button.tsx`) — variants
   `primary | secondary | ghost | danger`, sizes `sm | md`, renders a real
   `<button>` defaulting to `type="button"`. Server-usable, token-only.
   Solid fills pair with `text-[var(--dpf-on-accent)]`; `text-white` on an
   accent fill is now a defect everywhere, with no exception.
3. **`ui/Surface`** (`apps/web/components/ui/Surface.tsx`) — the canonical
   card/panel wrapper encoding the variants the 727 sites actually use:
   `level` (1 = card on bg, 2 = nested panel), `padding`
   (`none | sm | md | lg` → –, `p-3`, `p-4`, `p-6`), `rounded`
   (`md | lg | xl`), polymorphic `as` for semantic elements. Defaults match
   the dominant pattern so most migrations are 1:1 swaps.
4. **`primaryButtonClass` stays** as the form-kit compat surface (SubmitButton
   composes it), now token-correct. New standalone buttons compose `Button`;
   the class string is not exported as a general-purpose API.
5. **First adoption cohort** proves the primitives where the pass found four
   byte-similar raw-hex palettes: the finance detail pages
   (`bills | purchase-orders | expense-claims | suppliers`)/`[id]/page.tsx`
   and their action components. Their local status→hex maps move to the
   `statusColors.ts` registry (`financeApproval`, `financeExpenseCategory`
   added; the other finance domains already existed).
6. **The adoption ratchet ships in the same PR**
   (`scripts/check-ux-primitive-adoption.mjs`): shrink-only budgets for
   (a) inline accent-button class strings outside `components/ui`,
   (b) inline card strings outside `components/ui`, (c) `text-white`
   occurrences in `apps/web`, and (d) route-group error/loading boundary
   coverage (W7). Owned baseline
   (`scripts/ux-primitive-adoption-baseline.json`, owner
   platform-architecture, expiry 2026-11-16); new growth fails CI. Wired as a
   `guard()` entry in `scripts/lib/ci-policy-guards.mjs` (source profile) with
   a roster pin in `scripts/ci-policy-guards.test.mjs`, same as
   `fk-index-coverage-guard`.

## 4. Non-goals

- No mass migration of the ~700 residual inline card/button sites — the
  ratchet freezes them; migration proceeds cohort by cohort.
- No new dialog/drawer/tab primitives (the pass's §3.3-f nine-dialog finding
  is separate work).
- No change to `report-kit` or the form contract beyond the token fix.

## 5. When to use what

| Need | Use |
|---|---|
| Standalone action button | `ui/Button` |
| Form submit with pending state | `ui/form` `SubmitButton` (composes `primaryButtonClass`) |
| Card / panel wrapper | `ui/Surface` |
| Status / severity pill | `report-kit` `StatusBadge` (registry-backed) |
| Inline callout | `report-kit` `Notice` |

See `apps/web/components/ui/README.md` for the kit-level index.
