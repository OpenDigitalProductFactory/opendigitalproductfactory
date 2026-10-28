---
status: active
---

# Business operations extraction — BS-01

Parent design: [reusable architecture extraction](../specs/2026-10-18-reusable-architecture-extraction-design.md), family 6. Backlog BI-9A6163AD; Workroom WC-63F33236. Base `4fa796b64425b6129f172a01b89d8c8887c065fc`.

The operator authorized local implementation and independent Codex review with native review/plan coverage unrun. Code publication, production/runtime changes and DPF2 writes remain unauthorized.

1. Characterize existing versioned snapshot selectors, live loader, rescue outcome facts/cockpit and workspace mount.
2. Move the current snapshot engine and render-neutral contracts into `@dpf/storefront-templates/operations`; retain one semantic-intent and source-health vocabulary. Migrate real API/workspace/admin consumers and remove the legacy loader facade. Compatibility type re-exports remain owned by @markdbodman under this item until all component/host imports move; no second engine remains.
3. Share organization-scoped canonical animal/custody aggregate reads between the rescue cockpit and twin outcomes. Remove listing-status counts. Preserve completed custody history, legal holds and unknown versus zero. Keep domain mutation/transaction owners unchanged.
4. Add a bounded TENANTS customer projection from existing accounts, subscriptions and service tickets. Host permissions govern reads; missing current authority yields unavailable sources without querying them. Stored account states remain authoritative; no new health/MRR algorithm. Paid invoice counts cease to assert delivered work.
5. Suppress demo room overlays on live rescue snapshots. Keep renderer/layout behavior and the home cockpit attention owner. Add source-local privacy, stale/concurrent revision, semantic rendering and density proofs. Served nonproduction browser qualification remains unrun; do not start a runtime.
6. Compile and execute an isolated synthetic software/customer and shelter consumer under exact Node 24.16.0 / TypeScript 6.0.3 with no application aliases or runtime dependencies. Record source digests, provenance, limitations and atomic rollback.

Verification: claimed-path impact contract resolved; graph-linked tests plus colocated suites, full twin/animal/ward/restaurant/workspace regression coverage, package and web typechecks, style/prose/module/doc freshness guards. Baseline characterization precedes moves; intentional truth/authorization changes receive first-failing regressions. Existing read-model revision remains a display token, never mutation authorization or an atomic multi-source transaction certificate.

Stop condition: source-local checks and isolated consumer pass, actual callers use the sole extracted engine, independent review findings are repaired, and all unsupported/runtime qualifications are recorded. Freeze for parent review; do not commit or publish from this subtask.

Rollback: revert this slice's package entry, host callers and fact/projection adapters together. Canonical database rows and transaction owners require no migration or rollback.

## Local UX fit review

Fits with guardrails: Workspace remains the operation overview for an authorized
operator. Reuse its existing twin primitives and layout; contextual record links
use existing Customer and Service Desk routes. They send no prompts and perform
no commands. Missing authority stays unavailable. Work responsibility uses the
recorded principal reference when the host cannot resolve a display name, and
priority remains visible. Existing labels become native, focusable links with
specific accessible names; no new navigation home or duplicate attention owner.

Independent review identified ignored action/owner fields and an inaccurate
renewal window label. First-failing renderer and projection regressions were
observed before repair. Host-shaped projection/render tests, semantic link/focus
checks, existing axe/density tests and theme/prose scans provide local evidence.
Served DOM budget measurement, mobile/keyboard/screen-reader qualification and
the native UX manifest remain unrun under the authorized local-only exception.
