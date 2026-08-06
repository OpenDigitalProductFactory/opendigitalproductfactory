# Page-Owned Context Contract (Phase 2) — Implementation Plan

**Spec of record:** `docs/superpowers/specs/2026-08-05-coworker-page-perception-context-contract-design.md` (Option B)
**Epic:** EP-8C706944 (c) — replace the allow-list with a per-page registry every page contributes to
**Predecessor:** Phase 1 point-fix merged as PR #4048 (`/ops/self-upgrade` provider)
**Kernel gate:** `principle_decide` NOT run (portal MCP not connected this session) — proceeding on the spec's provisional Option-B recommendation; ratification deferred.

## Goal
Replace the ad-hoc `Record<string, fn>` route-context registry + longest-prefix resolver with a typed **page-owned context contract**:
- Each page's context is a `PageContextProvider` module (page-owned, one file per surface).
- Providers declare **exact** vs **prefix** match — a route **never inherits a sibling/parent's PAGE DATA** (the `/ops/self-upgrade → /ops backlog` flaw class, generalized).
- Unmatched routes get the static name-label fallback (never another page's data).

## Non-goals (this phase)
- Filesystem auto-discovery of co-located `app/**/coworker-context.ts` (zero-registration). We deliver an explicit **manifest** (`registry.ts`) that each provider module registers into — same guarantee, no fragile build-time scan. Auto-discovery is a documented follow-up.
- The surface→tool parity CI guard + baseline page-scoped read grant — those are Phase 3 (separate PR).
- No change to arbitration / token budget / prompt-assembler.

## Design
### Contract
```ts
// lib/tak/route-context/types.ts
export interface PageContextInput { userId: string; route: string }
export interface PageContextProvider {
  route: string;                 // the route this owns, e.g. "/ops" or "/compliance"
  match: "exact" | "prefix";     // exact: only this route. prefix: this route + descendants.
  build: (input: PageContextInput) => Promise<string | null>;
}
```

### Resolution (no data inheritance)
1. Universal `BUSINESS CONTEXT` block (unchanged).
2. **Exact** provider whose `route === routeContext` wins outright.
3. Else the longest **prefix** provider whose route is a path-prefix of `routeContext`.
4. Else `buildDefaultRouteContext` (name label). An `exact` provider's data is **never** returned for a descendant route.

### Match-mode classification (behavior-preserving except closing the leak)
- **prefix** (genuinely parse/serve descendants): `/compliance` (parses entityId), `/build/work` (capsule regex), `/build`, `/finance`, `/storefront`, `/portfolio`, `/portfolio/product`, `/platform/ai`, `/platform/ai/providers`, `/platform/tools/discovery`, `/coworker-decisions`, `/inventory`, `/compliance/licensing`.
- **exact** (single page — must not leak to descendants): `/ops` (backlog), `/ops/dev-loop`, `/ops/self-upgrade`, `/workspace`, `/employee`, `/customer/funnel`.
  Rationale: the name-label fallback (which steers to read tools) is safer for an unowned descendant than a parent's aggregate — the spec's core stance.

### Page-owned modules
`lib/tak/route-context/providers/<surface>.ts` — one module per provider, each `export const provider: PageContextProvider`. `lib/tak/route-context/registry.ts` imports them into `PAGE_CONTEXT_PROVIDERS`. `route-context.ts` becomes the thin resolver + business-context + default label (shrinks well under the 800-LOC ratchet — a net ratchet-down).

## Sequencing (two PRs)
The semantic change (the contract + no-inheritance) and the mechanical 15-file
move are separated so each is independently reviewable:
- **PR 1 (this one) — the contract + resolution.** `PageContextProvider` type, the
  typed `PAGE_CONTEXT_PROVIDERS` registry with `match` modes, the exact-first /
  longest-prefix resolver (no data inheritance), and the no-inheritance +
  parity tests. Provider bodies stay in `route-context.ts` for now; the registry
  is the self-registration point. **This is the systemic fix for the flaw class.**
- **PR 2 (fast-follow) — page-owned modules.** Extract the ~15 inline providers
  into `route-context/providers/*.ts` (golden-test-protected pure move), shrinking
  `route-context.ts` back under the ratchet. Optional stretch: filesystem
  auto-discovery of co-located `app/**` context modules.

## Steps
1. `types.ts` (the contract). ✔
2. Rewrite the registry as `PageContextProvider[]` + the exact/prefix resolver in `route-context.ts`. ✔
3. Golden tests: existing `route-context.test.ts` stays green (parity); ADD — (a) an `exact` provider's descendant gets the **name label**, not the parent data (`/ops/patches` etc.); (b) an exact dashboard descendant (`/customer/funnel/...`) falls to the label; prefix-serving covered by the existing `/finance/settings/tax` case. ✔
4. Module-size re-baseline for the +13 resolver lines (PR 2 shrinks it back down).
5. Local merged-code gate (pregate) → DCO PR.

## Verification
- `route-context.test.ts` green (parity) + new no-inheritance/prefix tests.
- Explicit regression: `/ops/patches`, `/ops/journeys`, `/ops/changes`, `/ops/promotions`, `/ops/security` (all descendants of the now-`exact` `/ops`) resolve to the name label, NOT the backlog.
- Typecheck exit 0; exhaustive merged-code gate green.

## Risk
- Provider extraction drift → golden output-parity tests before/after each batch.
- Shared helpers (`humanizeRoute`, `containsAnyToken`, `isTexasFinanceFootprint`, `getBusinessContextBlock`) → move to a shared `route-context/shared.ts` imported by providers.
- Behavior shift from `exact` reclassification → covered by the explicit descendant regression tests; this shift is the intended fix, not a regression.
