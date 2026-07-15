# Plan — Delivery Flow unified surface (BI-1DE21746, EP-DELIVERY-FLOW phase 2)

**Status:** DRAFT (staged in scratchpad; move into the BI-1DE21746 worktree off updated main once PR #3027 merges).
**BI:** BI-1DE21746 (large) — "Delivery Flow surface: unify /ops (backlog) + /ops/demand into one funnel→bet→board flow".
**Design source of truth:** `docs/superpowers/specs/2026-07-12-delivery-flow-demand-backlog-unification-design.md` (kernel-ratified unify-flow-ai-led).
**Depends on:** BI-E731A6C1 (PR #3027) — provenance read fields on `DemandItemView`/`getDemandItems` (`estimateAiJobSize`, `estimateHumanJobSize`, `estimateSource`, `estimateAgreed`). Branch off main AFTER #3027 lands.

## Goal
Demand and Backlog stop reading as two duplicate boards. One left-to-right **Delivery Flow**: investment **funnel** → **the bet** (the funded seam) → execution **board** — two deliberately different visual languages, one `BacklogItem` with two faces, a lens switch (Flow / Prioritize / Execute) over one dataset.

## Current substrate (read 2026-07-15)
- **Demand (invest):** `apps/web/app/(shell)/ops/demand/page.tsx` → `components/ops/DemandBoard.tsx` (3 tabs: Funnel `groupByFunnelStage`, Value×effort `buildValueEffortMatrix`, Balance `computeBucketMix`). Card = `DemandCard` — title, value band, effort/estimate line, "Why this score?" drill-in. Pure projections in `lib/demand/board.ts`.
- **Backlog (execute):** `apps/web/app/(shell)/ops/page.tsx` → `components/ops/OpsClient.tsx` — status board/list/grid over `BacklogItem.status`, with `SurfaceViewSwitcher`.
- **Nav:** `components/ops/ops-nav.ts` `OPS_NAV_GROUPS` — "Delivery" group = Backlog (`/ops`) + Demand (`/ops/demand`); rendered by `OpsTabNav`.
- **The bet (governed seam):** `approve_demand_for_funding` in `lib/mcp/packs/demand-scoring-pack.ts` → org WWWD gate → advances `demandStage` to `ready`.

## Phased steps (additive; no green-field)
1. **Route + shell.** Introduce `/ops/flow` (or promote in place) as the single Delivery Flow surface. Keep `/ops` and `/ops/demand` as redirects/aliases initially (no dead links) — collapse the nav in step 5. Server page loads both `getDemandItems()` and `getBacklogItems()` (already exist).
2. **Lens switch.** One client shell with three lenses over one dataset: **Flow** (the whole river: funnel → bet → board), **Prioritize** (today's Demand tabs — funnel/matrix/balance), **Execute** (today's Backlog status board). Reuse `DemandBoard` internals and `OpsClient` as the Prioritize/Execute lens bodies rather than re-implementing.
3. **The Flow lens (new).** Left-to-right composite: score-tinted narrowing funnel (raw→screened→shaped→ready) → an amber **"the bet"** seam column (the `ready`, funded crossing; surfaces `approve_demand_for_funding` state) → WIP status board (in-progress→done). Two visual languages: funnel = value/score tint; board = owner + burn-down. Pure grouping helper in `lib/demand/` (e.g. `flow.ts`) — one item placed by (`demandStage` upstream of bet) vs (`status` downstream), unit-tested.
4. **One-item-two-faces + estimate chip.** Upstream card face: score + **estimate chip** consuming the provenance fields — show effective estimate, whose (`estimateSource`), and `⇄ ai ↔ human · reconcile` when `estimateAiJobSize !== estimateHumanJobSize` and not agreed. (Display only here; the interactive reconcile flow is BI-AA1763CD.) Downstream face: owner + status/burn-down. Same `BI-…`, no copy.
5. **Nav collapse.** `ops-nav.ts`: "Delivery" group's Backlog+Demand → one **"Flow"** tab (lens sub-views). Verify nav-source registration (`lib/ea/domain-nav-sources.ts`) and the nav-teleport gate. Update any inbound links.
6. **Tests + guards.** Unit tests for the new pure flow-projection; component smoke for the lens switch; keep `OpsClient.test.tsx` green. Watch module-size ratchet (DemandBoard/new shell), Design Grounding Gate (this plan + spec are the grounding), UX-Fit (new route/nav change).

## Explicitly out of scope (later phases)
- **BI-A6648529** — AI-led volunteering: funding the bet triggers a proactive coworker to self-task/claim → advance status (wires the demand→ready seam to the proactivity/self-task engine).
- **BI-AA1763CD** — collaborative estimation UX: AI proposes on arrival, human confirm/overrule, interactive reconcile (writes via `record_effort_estimate`, shipped in BI-E731A6C1).

## Verification
- tsc green (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — pre-commit scoped tsc OOM-crashes; commit with `DPF_SKIP_TYPECHECK=1` after a clean out-of-band run).
- Drive the live `/ops/flow` surface (dev-portal-start / dpf-verify-on-live-install) once the portal upgrade settles.
- New route + nav change ⇒ regen route-manifest; UX-Fit-Decision trailer.
