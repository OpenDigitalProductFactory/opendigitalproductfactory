# Golden Triangle — posture control (UI)

`EP-GOLDEN-TRIANGLE` · Slice 2 (`BI-D48EB34C`). The canonical, reusable control for setting a Cost / Quality / Time posture. Design: [`docs/design/golden-triangle-design.md`](../../../../docs/design/golden-triangle-design.md) §6. **What each vector position actually configures** (exact parameters + features on/off, incl. the debate rung): [`docs/design/golden-triangle-vector-reference.md`](../../../../docs/design/golden-triangle-vector-reference.md).

## Components

- **`GoldenTriangleControl`** — the control. Controlled (`value` + `onChange`). Three coordinated layers, by design:
  1. **Presets (primary, one click):** Fast / Balanced / Assured / Frugal, each with a plain-language effect line.
  2. **Triangle (opt-in fine-tune):** a draggable point inside a Cost / Quality / Time triangle (pointer + keyboard on the thumb).
  3. **Numeric inputs (canonical accessible control):** three labelled percent inputs — a 2D drag surface is *not* a 1-D ARIA slider, so the numeric/preset layer is the accessible source of truth.
- **`GoldenTrianglePriorityPanel`** — a stateful host (view-local state) for the platform-default settings surface.
- **`CoworkerPriorityDock`** — the per-coworker control docked in-flow at the composer (collapsed by default to a colour-graded chip; expands to the full control). Replaced the old `CoworkerPriorityControl` header popover, which clipped off the panel edge.
- **`posture-display.ts`** — pure helpers: triangle geometry (`weightsToPoint` / `pointToWeights`), preset metadata, `postureLabel()` (a meaningful label at every position — the preset name, or the corner a dragged posture leans toward like "Lower Cost", never a bare "Custom"), `describeConfigured()` (the configured-chip explanation, derived from the **real Slice 1 compiler** so the UI never drifts), `TRIANGLE_AXIS_GUIDE` (the min/max explainer), and `balanceState()` for the colour cue.

## Balance colouring

The triangle shades by balance: **green** when the three axes are centred, through **yellow** to **red** as the posture trades one or two axes away (pushing toward an edge or vertex). Each vertex is labelled with what pulling toward it buys — **Higher Reasoning** (top), **Lower Cost** (bottom-left), **Lower Time** (bottom-right) — while the gradient colour conveys balance, named by a balance pill ("Well balanced" / "Higher Cost & More Time"). It is an at-a-glance cue that you are trading something away.

## Surfaces

- **`/platform/ai/assignments`** (the unified **"Priority & Models"** surface) — the full platform-default
  control, embedded on top of the advanced per-coworker guardrails. `/platform/ai/priority` redirects here.
- **AI coworker composer** — `CoworkerPriorityDock`, a compact chip + popover that sets the per-coworker posture.

Per-scope persistence (Slice 4) and the receipt/outcome view (Slice 3b) are wired: posture is stored
migration-free on the platform `DecisionPerspectiveProfile.autonomyPolicy`, and outcomes render at
`/platform/ai/priority/outcomes`.

## Ease-of-use stance

One gesture sets everything, and the control always shows—in plain words—what it configured (model tier, effort, verification, retries). That transparency-with-simplicity is the differentiator over platforms that expose dozens of raw model/parameter knobs. Progressive disclosure per AGENTS.md §12: presets first; the triangle and numeric inputs are there when wanted, never required.
