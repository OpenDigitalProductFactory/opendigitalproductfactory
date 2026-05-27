# ADR: Vertical Workspace Home Substrate Sign-off

**Date:** 2026-05-26
**Backlog item:** BI-1CCC6264
**Epic:** EP-REDUCTION-GEAR-ARCH
**Branch:** `feat/vertical-workspace-home-substrate` (rebased onto current `origin/main`, single commit `0e3135ea`)
**Status:** Accepted for branch handoff

## Decision

Ship the substrate that lets vertical workspace homes coexist with the platform-operator workspace as a fallback. The substrate establishes the API contracts; concrete vertical home renderings ship in follow-on BIs against the registry boundary.

The substrate consists of:

1. **A typed `WorkspaceHomeContribution` registry** under `apps/web/lib/workspace-home/` that exposes:
   - Typed component keys (`WorkspaceHomeComponentKey`) and primitive keys (`WorkspaceHomePrimitiveKey`) that BI-5B8FE5C1 fills out.
   - A baseline slot covenant (`today-now`, `exceptions-needs-review`, `coworker-handoffs`) that every contribution must honor.
   - A typed `WorkspaceHomeDataRef` declaration vocabulary covering `projection | canonical-data | signal`.
   - Fail-closed semantics for unknown component keys (admin-visible placeholder, no throw for workers).
2. **A resolver** (`resolveWorkspaceHomeContribution`) that selects `vertical / unconfigured` modes from a `StorefrontConfig → StorefrontArchetype` pair, preferring exact semantic archetype matches over category fallbacks, and returning an honest unconfigured mode with `fallback: "platform"` + `setupAction: "choose-or-finish-business-setup"` whenever no contribution matches.
3. **A setup activation summary service** (`buildWorkspaceHomeActivationSummary` / `buildWorkspaceHomeActivationSummaries`) that lets business and storefront setup surfaces report a worker-home outcome — exact / category / no-home — for an archetype without rendering `/workspace`.
4. **A `PlatformWorkspaceHome` component** that extracts the existing `/workspace` Command Center into a reusable platform-operator fallback, so the platform workspace remains visually unchanged when no vertical contribution applies.
5. **An `UnconfiguredWorkspaceHomeNotice`** banner that mounts on the unconfigured path to give admins / setup users an honest signal that no worker home is active.
6. **A thin `/workspace` route** (`apps/web/app/(shell)/workspace/page.tsx`) that loads platform data, resolves the contribution, and renders `<UnconfiguredWorkspaceHomeNotice />` (when unconfigured) above `<PlatformWorkspaceHome data={…} />` — auth / loader / render split via `apps/web/lib/workspace-home/platform-loader.ts`.
7. **Activation summary wiring in `/storefront/setup`** that pre-computes a `workspaceHomeActivation` per offered archetype so the `SetupWizard`'s Preview step displays match outcome + primitive widgets + status inline.

## Mapping — BI acceptance criteria to evidence

| BI acceptance criterion | Evidence |
|---|---|
| Resolver tests: exact archetype, category fallback, no contribution, archetype change re-eval, no `StorefrontConfig` | `apps/web/lib/workspace-home/registry.test.ts` (six cases). Resolver also exercised via `activation-summary.test.ts:106` which proves an archetype + empty registry produces the unconfigured mode (the "no contribution" path). |
| Slot covenant must hold on registration | `registry.test.ts:60-77` — registering a contribution missing `exceptions-needs-review` throws. |
| Unknown component keys: admin-visible placeholder, no throw | `registry.test.ts:79-93` — `validateWorkspaceHomeComponent` for `key:"unsupported-widget"` returns `{ok:false, placeholder:{componentKey, reason:"unknown-component-key"}}` and does not throw. |
| Setup activation summary covers exact, category, no-home, primitive widgets, required canonical data, required signals | `apps/web/lib/workspace-home/activation-summary.test.ts` — four cases including primitive widget list `["service-queue","customer-map","coworker-handoffs"]`, canonical data `["customer-account","service-location","work-order"]`, required signals `["scheduled-work","urgent-exception","coworker-handoff"]`, and the serializable / JSON.stringify-roundtrip property. |
| Business/storefront setup presents the worker-home activation outcome immediately on archetype selection | `apps/web/app/(shell)/storefront/setup/page.tsx:38-42` (loader builds summaries per archetype); `apps/web/components/storefront-admin/SetupWizard.tsx:187-201, 426-429` (wizard threads through the summary to `ArchetypeActivationSummary`); `apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx:161-223` (renders Worker Home label + status + primitive tags). Tested in `ArchetypeActivationSummary.test.tsx` four cases. |
| Platform workspace home remains visually unchanged as fallback | Live drive on dev-portal (`docs/superpowers/evidence/2026-05-26-vertical-workspace-home-substrate/dynamic-analysis.md` Drive #1) confirms the Command Center layout is unchanged. The refactor moves the JSX from `app/(shell)/workspace/page.tsx` into `components/workspace-home/PlatformWorkspaceHome.tsx` without DOM-tree changes inside the rendered Command Center subtree. |
| No worker-facing UI copy exposes gear / ring / torque / slip / wear / triple / cockpit terminology | `UnconfiguredWorkspaceHomeNotice.test.tsx:7-13` (regex assertion on the notice copy); `ArchetypeActivationSummary.test.tsx:120-126` (regex assertion on the unconfigured-home panel); live-page vocabulary scan in dynamic-analysis Drive #4 returned only one `COCKPIT` hit, which is in the platform-operator `(shell)` chrome contributed by BI-19D40BE7 — see *Audience boundary* below. |
| Components use DPF theme variables and semantic tones only | `UnconfiguredWorkspaceHomeNotice.test.tsx:15-20` asserts `var(--dpf-` is present and no hardcoded neutrals / hex colors. `ArchetypeActivationSummary.tsx` is fully theme-tokenized (no hardcoded colors). `PlatformWorkspaceHome.tsx` preserves the pre-substrate theme-token usage. |
| Production-path UX verification captures desktop and mobile fallback / unconfigured states on the Live portal | `docs/superpowers/evidence/2026-05-26-vertical-workspace-home-substrate/dynamic-analysis.md` — Drive #1 desktop on dev-portal :3001 against the live DB; Drive #2 mobile responsive verified via class-chain + computed-styles (the available Claude-in-Chrome `resize_window` resizes the chrome window without shrinking the viewport, so the responsive-layout signal is captured via Tailwind class semantics + `getComputedStyle` + the existing snapshot test). Drive #3 confirms `/storefront/setup` correctly redirects on a configured install. |
| `pnpm --filter web typecheck` and production build pass | Recorded as `build_pass` evidence on BI-1CCC6264 (activityId `cmpniblx800pb01t5ioa7tfpt`). After `prisma generate` to absorb new tables added on main during the 87-commit rebase gap, `pnpm --filter web typecheck` is green and `pnpm --filter web build` compiles successfully in 16.1s. The 18 Turbopack warnings emitted cascade from two pre-existing main-branch ancestors (`apps/web/lib/platform/version.ts`, `packages/db/src/discovery-collectors/*.ts`), zero of which involve substrate code. |

## Audience boundary

This is non-negotiable per the BI body and parent spec §5.5 (audience layering):

- **Platform-operator surface** — gear / ring / torque / slip / wear / cockpit vocabulary is the **correct** language. BI-19D40BE7 shipped the install-aware cockpit at `/admin/cockpit` and BI-19D40BE7 owns the platform shell's `INTERNAL COCKPIT` chip in the `(shell)` layout.
- **In-trench worker surface** — gear vocabulary is **forbidden**. This is the surface the substrate ships: `UnconfiguredWorkspaceHomeNotice`, `PlatformWorkspaceHome` body content (the worker's home, even when it's the platform fallback), and the `ArchetypeActivationSummary` worker-home panel.

The substrate establishes the **API contract** for the future shell-chrome switch — the `WorkspaceHomeResolution.mode` field. Once vertical contributions exist downstream, a follow-on BI can teach the `(shell)` layout to read this mode and swap the chrome (hiding "INTERNAL COCKPIT" branding when a vertical home is rendering, swapping in vertical-native shell chrome, etc.). The substrate intentionally does not implement that chrome swap, because no vertical contributions exist for it to switch on — the switch would be unobservable dead code today. The contract handle is what ships; the switch fills out downstream.

## Substrate boundary

This BI ships the substrate **only**. The 11 archetype-specific worker homes (Dale HVAC under BI-CE6AF925, and the others across the active capability lanes) land in follow-on BIs that register against `WorkspaceHomeRegistry`. Today the default registry is empty by design — every install renders `unconfigured`-mode (platform fallback + notice) until the first vertical contribution lands. This is the honest "no worker home yet" state the BI asks for.

The `WorkspaceHomePrimitiveKey` enum is the boundary BI-5B8FE5C1 fills out with concrete reusable primitive renderers (today-strip, service-queue, customer-map, exception-list, coworker-handoffs, …). The substrate enumerates the keys without shipping the React renderers for them.

## Standing-rules audit

- **Mirror, don't migrate.** The substrate is additive: new `apps/web/lib/workspace-home/` module + new `apps/web/components/workspace-home/` components + a thin extraction of the existing `workspace/page.tsx` into `loadPlatformWorkspaceHomeData` and `PlatformWorkspaceHome`. No schema change. Nothing in the database changes. `ArchetypeActivationSummary` is extended (added `workspaceHomeActivation` optional prop) — not replaced; existing call sites that don't pass the new prop continue to work. `SetupWizard` is extended to thread the new prop end-to-end without altering its existing state machine.
- **Schema honesty.** The registry types name their fields after what they hold: `semanticArchetypeIds` (exact-match), `archetypeCategories` (fallback set), `setupActivation` (the setup-time projection of what activates), `slots` (the layout covenant), `components` (concrete renderable widgets), `componentKeys` (the typed registry-known set). `WorkspaceHomeResolution` is a discriminated union over `mode: "vertical" | "unconfigured"` and exposes `match: "exact" | "category" | "none"` so callers can disambiguate. Nothing is named for what it might do later.
- **Make silent failures observable.** Unknown component keys return a `placeholder` field with `reason: "unknown-component-key"` rather than throwing or silently rendering nothing — the BI's "admin-visible Slot misconfigured placeholder" signal. The unconfigured path explicitly mounts `<UnconfiguredWorkspaceHomeNotice />` rather than letting the install silently look "fine" when it lacks a worker home. The activation summary returns the same shape whether the archetype matches a contribution or not (with `mode`/`status` discriminating), so a downstream renderer can't accidentally treat a no-home outcome as a configured-home outcome via duck-typing.

## Spec / plan alignment

- Parent spec: [docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md](../specs/2026-05-24-reduction-gear-architecture-design.md) (§5.5 audience layering, §5.6 vertical workspace home contract).
- Direct spec: [docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md](../specs/2026-05-24-vertical-workspace-home-design.md).
- Implementation plan in the substrate commit: [docs/superpowers/plans/2026-05-25-vertical-workspace-home-substrate.md](../plans/2026-05-25-vertical-workspace-home-substrate.md).
- Predecessor activation-summary design merged via [PR #1117](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1117).

## Open follow-ups

- **BI-5B8FE5C1** — fill out the `WorkspaceHomePrimitive` registry with concrete reusable primitive renderers (today-strip, service-queue, customer-map, exception-list, coworker-handoff list, metric tile, calendar, activity feed, platform tile grid).
- **BI-CE6AF925** and the sibling vertical-lane BIs — register concrete vertical `WorkspaceHomeContribution`s against the registry (Dale HVAC, the other 10 archetype lanes).
- **Worker-mode shell-chrome switch** — once vertical contributions exist and the resolver returns `mode: "vertical"`, the `(shell)` layout should read `WorkspaceHomeResolution.mode` and swap chrome (hide `INTERNAL COCKPIT` chip, swap nav-group filter, define role-authorized operator switching for HR-000/HR-100 to step into the platform-operator surface from the worker home). The substrate exposes the contract handle; the switch is a follow-on.
- **Telemetry on unconfigured-archetype rate** — track how often a configured install lands on the platform fallback because no vertical contribution matched its archetype, so coverage gaps surface as a metric rather than as silent fallback. Suggested instrumentation: a Prometheus counter incremented inside `resolveWorkspaceHomeContribution` when `mode === "unconfigured"` and the archetype is non-null.

## Consequences

- Every install today renders `unconfigured`-mode at `/workspace` (platform fallback + notice), because the registry is empty by design. This is intentional and is the BI's honest "no worker home yet" state.
- The substrate-level worker surfaces are vocabulary-clean for the in-trench worker audience. The platform-operator `(shell)` chrome (which legitimately uses "INTERNAL COCKPIT") is untouched.
- `ArchetypeActivationSummary` is now a dual-purpose panel: capability activation (existing) + worker-home activation (new). Both halves render independently — passing only `workspaceHomeActivation` (no `activationProfile`) is a supported state and renders only the Worker Home half.
- The substrate-only delivery does not implement the BI body's "remove platform-operator header language from the worker home" line item in code; it ships the contract handle (`WorkspaceHomeResolution.mode`) that a follow-on BI uses to implement the chrome switch. This is documented as an open follow-up above and is the audience-boundary call-out the BI requires.
- The `WorkspaceHomeRegistry` is mutable today (a singleton `defaultWorkspaceHomeRegistry` instance plus `registerWorkspaceHomeContribution`). Future contributions can either mutate the default registry at module-init time or compose a per-render registry. If multiple modules race to register the same contribution `id`, the current implementation does not dedupe — that's a downstream concern when more than one contribution exists.
