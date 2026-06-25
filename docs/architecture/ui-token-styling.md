# UI Token Styling & the Style-Drift Ratchet

Status: standard (BI-ARCH-UI-PRIMS, EP-PLATFORM-CONSOLIDATION)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md) §6.6

DPF surfaces are themed with CSS custom properties (`--dpf-*`) and the report-kit status
palette so light mode, dark mode, and per-org branding all work without touching component
code (AGENTS.md §12). Hardcoded hex colors break that — they ignore the theme and can't be
rebranded.

## The ratchet

The codebase predates this rule, so ~257 files still carry hardcoded hex. The spec is
explicit: **migrate as touched; do not run a blind mass rewrite.** So enforcement is a
ratchet, not a big-bang:

- [`scripts/check-style-drift.mjs`](../../scripts/check-style-drift.mjs) (CI job `Style
  Drift Guard`) records a per-file hex-count baseline in
  [`scripts/style-drift-baseline.json`](../../scripts/style-drift-baseline.json).
- A PR **fails** if it adds a **new** file with hardcoded hex, or **increases** the hex
  count of an already-listed file.
- When you migrate a surface off hex, run `node scripts/check-style-drift.mjs --update` to
  re-tighten the baseline — the ratchet only ever loosens by deliberate update.

Token/chart-theme files (`components/ui/report-kit/`, `chartTheme`, etc.) are the approved
homes for raw color values and are skipped. A genuine non-color `#abc`-shaped literal can
be marked with a trailing `// style-drift-allow` comment.

## Adopting the primitives (as touched)

When you touch a surface, prefer the shared operational primitives over hand-rolled UI:

- Status/severity colors → the report-kit `statusColors` registry
  (`resolveIntent` + `intentStyle`), never a local `Record<string, color>` map or raw hex.
- Badges, dense tables, KPI cards, filter bars, CSV export, charts →
  `components/ui/report-kit/*` (see its README), not bespoke one-offs.
- Any remaining color → a `--dpf-*` token (`var(--dpf-text)`, `var(--dpf-surface-1)`, …).

Surface-by-surface migrations (e.g. the workspace calendar's server↔client category color
contract in `calendar-data.ts` + `WorkspaceCalendar.tsx`, or the finance detail pages) are
**operator-verified** changes — they alter pixels, so they ship with before/after
screenshots per the spec's UI-primitive verification gate, not as part of this guard.
