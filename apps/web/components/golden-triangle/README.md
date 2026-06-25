# Golden Triangle — posture control (UI)

`EP-GOLDEN-TRIANGLE` · Slice 2 (`BI-D48EB34C`). The canonical, reusable control for setting a Cost / Quality / Time posture. Design: [`docs/design/golden-triangle-design.md`](../../../../docs/design/golden-triangle-design.md) §6.

## Components

- **`GoldenTriangleControl`** — the control. Controlled (`value` + `onChange`). Three coordinated layers, by design:
  1. **Presets (primary, one click):** Fast / Balanced / Assured / Frugal, each with a plain-language effect line.
  2. **Triangle (opt-in fine-tune):** a draggable point inside a Cost / Quality / Time triangle (pointer + keyboard on the thumb).
  3. **Numeric inputs (canonical accessible control):** three labelled percent inputs — a 2D drag surface is *not* a 1-D ARIA slider, so the numeric/preset layer is the accessible source of truth.
- **`GoldenTrianglePriorityPanel`** — a stateful host (view-local state) for a settings/preview surface.
- **`CoworkerPriorityControl`** — a small, self-contained posture chip for the AI coworker dialog header: a balance-coloured dot + active preset that opens the compact control in a popover.
- **`posture-display.ts`** — pure helpers: triangle geometry (`weightsToPoint` / `pointToWeights`), preset metadata, `describeConfigured()` / `plainSummary()` (derived from the **real Slice 1 compiler** so the UI never drifts), and `balanceState()` for the colour cue.

## Balance colouring

The triangle shades by balance: **green** when the three axes are centred, through **yellow** to **red** as one or two axes get starved (the posture pushes toward an edge or vertex). A starved axis's vertex label turns red, and a balance pill names the state ("Well balanced" / "Starving Time"). It is an at-a-glance cue that you are trading something away.

## Surfaces

- **`/platform/ai/assignments`** (the unified **"Priority & Models"** surface) — the full platform-default
  control, embedded on top of the advanced per-coworker guardrails. `/platform/ai/priority` redirects here.
- **AI coworker composer** — `CoworkerPriorityDock`, a compact chip + popover that sets the per-coworker posture.

Per-scope persistence (Slice 4) and the receipt/outcome view (Slice 3b) are wired: posture is stored
migration-free on the platform `DecisionPerspectiveProfile.autonomyPolicy`, and outcomes render at
`/platform/ai/priority/outcomes`.

## Ease-of-use stance

One gesture sets everything, and the control always shows—in plain words—what it configured (model tier, effort, verification, retries). That transparency-with-simplicity is the differentiator over platforms that expose dozens of raw model/parameter knobs. Progressive disclosure per AGENTS.md §12: presets first; the triangle and numeric inputs are there when wanted, never required.
