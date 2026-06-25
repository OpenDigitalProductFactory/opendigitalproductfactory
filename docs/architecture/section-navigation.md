# Section Navigation (SectionNav)

Status: standard (BI-ARCH-SECTIONNAV, EP-PLATFORM-CONSOLIDATION)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md) §6.5

Dense operational surfaces (Platform, Admin, Finance, Ops, …) render a secondary
"section nav" below the global shell: a row of top-level families/tabs plus the
active family's sub-items. These used to be cloned per surface as
`PlatformTabNav`, `AdminTabNav`, `FinanceTabNav`, `OpsTabNav` — four copies of the
same markup, styling, and active-state chrome that drifted independently.

There is now **one renderer**: [`components/shell/SectionNav.tsx`](../../apps/web/components/shell/SectionNav.tsx),
driven by the shared shape in
[`lib/navigation/section-nav-model.ts`](../../apps/web/lib/navigation/section-nav-model.ts).

## How it splits

- **Rendering + styling is shared.** `SectionNav` owns the markup for all three
  display styles and is pure/presentational (no hooks) — easy to unit-test with
  fixed configs.
- **Active-state resolution stays domain-owned.** Each surface's thin wrapper
  keeps its own `usePathname` and its surface-specific matching rules (Platform's
  family-key match, Finance's href match, Ops's `/ops` exact-vs-prefix rule), then
  builds a fully-resolved `SectionNavConfig` and hands it to `SectionNav`. This is
  why the migration changed zero behavior: the wrappers compute exactly what they
  computed before.
- **Section data stays domain-owned** (`platform-nav.ts`, `admin-nav.ts`, …). The
  shared piece is only the rendering contract.

## Display styles

| Style | Surfaces | Chrome |
| --- | --- | --- |
| `pill` | Platform, Admin | rounded-full family + sub-item pills; sub-items always shown |
| `tab` | Finance | underline (`border-b-2`) family tabs; sub-items in a boxed panel, shown only when present |
| `grouped` | Ops | labelled groups of underline tabs (no sub-items) |

The `dense` flag (pill) tightens spacing and hides the description for embedded
surfaces (e.g. the AI Operations Map).

## Adding or changing a section nav

Build a `SectionNavConfig` from your domain nav data (resolving `active` for each
family/link) and render `<SectionNav config={...} />`. **Do not clone a `*TabNav`
component.** If a surface needs chrome the three styles do not cover, extend
`SectionNav` (and the model) rather than forking a one-off renderer.

All colors are `--dpf-*` tokens (AGENTS.md §12). The duplicate-subnav regression
guard (`app/(shell)/platform/tools/layout.test.tsx`, BI-UI-DUPMENU01) still
applies: a section nav mounts once per section, never duplicated at page level.
