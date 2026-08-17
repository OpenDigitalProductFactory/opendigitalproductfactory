# components/ui — Shared UI Primitives

Token-backed building blocks for every portal surface. Compose these instead of
re-typing class strings — the adoption ratchet
(`scripts/check-ux-primitive-adoption.mjs`) freezes the residual inline
card/button strings and fails CI on new ones.

> Spec: [`docs/superpowers/specs/2026-08-16-ux-foundation-button-surface-design.md`](../../../../docs/superpowers/specs/2026-08-16-ux-foundation-button-surface-design.md)
> · Reporting palette: [`report-kit/README.md`](report-kit/README.md)

## Core primitives

| Primitive | Server-usable? | Use it for |
|---|---|---|
| `Button` | ✅ (pure) | any standalone action button — variants `primary`/`secondary`/`ghost`/`danger`, sizes `sm`/`md` |
| `Surface` | ✅ (pure) | card/panel wrappers — `level` 1/2, `padding` none/sm/md/lg, `rounded` md/lg/xl |
| `Spinner` | ✅ (pure) | indeterminate activity of unknown duration |
| `Skeleton` (report-kit) | ✅ (pure) | loading shimmer for a KNOWN layout (`loading.tsx` files) |
| `Dialog` (`confirmDialog`/`alertDialog`/`promptDialog`) | client | in-app replacements for native `confirm`/`alert`/`prompt` |
| `LocalTime` / `RelativeTime` | client | timezone-correct timestamps |
| `form/` (FormField, SubmitButton, FormStatus, …) | client | the portal form contract (BI-8E74C749) |
| `report-kit/` (StatusBadge, DataTable, Notice, …) | mixed | reporting & data-display palette |

## Button vs `primaryButtonClass`

- **`Button`** is the canonical action button. New code composes it.
- **`form/styles.ts` `primaryButtonClass`** remains as the form-kit compat
  surface — `SubmitButton` and existing form layouts compose it, and it is now
  token-correct (`text-[var(--dpf-on-accent)]`). Do not reach for it in new
  non-form code; use `Button`.

## The `--dpf-on-accent` rule

Text or icons sitting on a solid accent (or error) fill use
`text-[var(--dpf-on-accent)]`. `text-white` on an accent fill is a defect — in
dark mode the accent is light and white fails WCAG AA. The old "exception:
text-white on accent buttons" guidance is retired; there is no exception.

## Status colors

Never a local status→color map. A status resolves through
`report-kit/statusColors.ts` (`STATUS_INTENT` registry) via
`<StatusBadge domain=… status=…>`. Adding a domain/status is a one-line
registry edit.
