# Three-Band Stage D/E — Canvas Wiring + Cutover Plan

| Field | Value |
|-------|-------|
| **Status** | Plan for review |
| **Created** | 2026-06-05 |
| **Parent** | `EP-AI-OPSMAP` · `BI-65B0D697` · design: `2026-06-05-ai-operations-map-three-band-cohesive-layout-design.md` §7 Stage D/E |
| **UX fit** | Already decided in the design spec §2.2 — `fits-with-guardrails`: existing `/platform/ai/operations-map` route, no new nav/route/dashboard, local page controls only. This plan implements within that decision. |

## 0. Where we are

The hidden-canvas build is complete and merged (Stage 0/A/B1/C/B2/B2b) + marker popover (#1528). `OperationsTopologyCanvas` has full parity with the legacy provider panel — routes, markers + click inspector, replay scrubbing, zoom — **plus** the A2A arc half on one coworker spine with shared replay. It is exercised only by tests; it is not on the operator route.

Two working surfaces still ship today: `RoutingTopologyPanel` (provider) and `A2aInteractionsPanel` (A2A), each owning its own filter state internally.

## 1. The crux of Stage D

The canvas renders a *projection* — it takes `topology`, `dimension`, `replayTime/replayRange`, `selectedCoworkerId`, and already-visible routes/edges. The two legacy panels own filter state **internally** (route-state/provider/provider-type filters in `RoutingTopologyPanel`; type/state/coworker/authority in `A2aInteractionsPanel`; replay playhead published from the provider panel).

So wiring the canvas onto the route is not "swap a component" — it requires **lifting filter + replay state up** to a host so a single control rail drives the canvas. That is the real work and the real risk.

## 2. Strategy — additive preview, then cutover (parity-gated)

Never replace two verified panels in one move. Two stages:

### Stage D — canvas + unified controls behind a temporary preview switch

- **D1. Host + control state.** Introduce an `OperationsTopologyWorkspace` (or lift into `AiOperationsMap`) that owns: dimension (exists), route-state/provider/provider-type filters, A2A type/state/coworker/authority filters (reuse `ai-operations-map:a2a` prefs), the replay playhead, zoom. Compute the filtered route/edge sets and feed the canvas.
- **D2. One control rail + one inspector.** Consolidate the provider and A2A controls into a single rail (segmented/icon controls; `FilterBar` only where the facet model fits — graph controls stay segmented). One inspector surface that can describe a provider route/marker **or** an A2A edge.
- **D3. Temporary preview switch.** Render the canvas **only** behind a temporary switch (a `?topology=canvas` query param or a clearly-labeled "Unified view (preview)" control), defaulting OFF. Ordinary operators keep the legacy panels. The switch is explicitly temporary and removed at Stage E. (Spec: "If an internal switch is needed, it must be temporary and removed at cutover.")
- **Saved views.** Default: preserve the current storage split (saved views persist projection filters only). Do **not** broaden saved views in this slice; if topology state must be saved later, add a *versioned* payload with migration tests (spec §1.2).
- **Exit gate (source-local).** Filtered route/edge counts, dimension gating, replay sync, zoom, inspector content, and empty states match the legacy panels against the Stage 0 fixture. Full suite + typecheck green.

### Stage D verification — live, on the canonical runtime (the real gate)

This is the gate the spec requires before cutover, and the lesson from the A2A panel: **structural ≠ functional.**

1. Walk the live portal through a **self-upgrade** to pick up the merged canvas (the in-process path we validated earlier — `/ops/self-upgrade` → "Upgrade now").
2. Drive `/platform/ai/operations-map` via Claude-in-Chrome with the preview switch ON, against **real data** (the install has 60+ `PhaseHandoff` rows).
3. Confirm, side-by-side with the legacy panels: same coworkers/providers, routes (state/dash/markers), A2A arcs (kind/state), replay scrubbing parity, zoom, and the marker + edge inspectors. Check desktop **and** mobile widths for no clipping/overlap (the spec's responsive gate).
4. Record a dynamic-analysis narrative (drove X, observed Y, parity Z), not screenshots-only.

### Stage E — cutover + delete

Only after the live sign-off:
- Make the canvas the default topology surface for the route.
- Delete `RoutingTopologyPanel`, `A2aInteractionsPanel`'s SVG band (keep its filter/pref logic if reused), the temporary preview switch, and any now-duplicated style helpers (`routingLineStroke` etc. → the shared `operations-topology-style.ts`).
- Keep `DeliberationLensPanel` as the sibling lens (no truthful branch identity yet — `BI-8DF5E740`).
- Re-run full suite + typecheck + build; re-verify live; update `BI-65B0D697`.

## 3. Risks

| Risk | Mitigation |
|---|---|
| Lifting filter state out of two large panels regresses them. | Preview switch keeps legacy panels as the default + only surface ordinary operators see until Stage E. |
| The unified control rail becomes cluttered or loses a facet. | One rail, segmented/icon controls; parity test asserts every legacy filter has a canvas equivalent before cutover. |
| Premature cutover ships a regressed map. | Stage E is gated on the live functional sign-off, not source-local tests alone. |
| Scope creep into data/projection or saved views. | Render-only; saved-view split preserved; no schema/projection change. |

## 4. Sequencing summary

1. **D1+D2+D3** (one PR, off flat main): host + unified controls + preview switch; canvas hidden behind the switch; legacy panels default. Source-local parity green.
2. **Live verification** (self-upgrade + drive the portal). Record evidence on `BI-65B0D697`.
3. **Stage E** (one PR): default to canvas, delete legacy panels + temporary switch + duplicated helpers. Re-verify live.

## 5. Decision asked

1. Approve the **temporary-preview-switch then cutover** strategy (vs. a direct swap)?
2. Approve **lifting filter/replay state into a host** as the Stage D mechanism (the unavoidable part)?
3. Approve the **live self-upgrade + drive verification** as the cutover gate before deleting the old panels?
