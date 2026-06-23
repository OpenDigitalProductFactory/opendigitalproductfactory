# Golden Triangle — posture control (UI)

`EP-GOLDEN-TRIANGLE` · Slice 2 (`BI-D48EB34C`). The canonical, reusable control for setting a Cost / Quality / Time posture. Design: [`docs/design/golden-triangle-design.md`](../../../../docs/design/golden-triangle-design.md) §6.

## Components

- **`GoldenTriangleControl`** — the control. Controlled (`value` + `onChange`). Three coordinated layers, by design:
  1. **Presets (primary, one click):** Fast / Balanced / Assured / Frugal, each with a plain-language effect line.
  2. **Triangle (opt-in fine-tune):** a draggable point inside a Cost / Quality / Time triangle (pointer + keyboard on the thumb).
  3. **Numeric inputs (canonical accessible control):** three labelled percent inputs — a 2D drag surface is *not* a 1-D ARIA slider, so the numeric/preset layer is the accessible source of truth.
- **`GoldenTrianglePriorityPanel`** — a stateful host (view-local state) for a settings/preview surface.
- **`posture-display.ts`** — pure helpers: triangle geometry (`weightsToPoint` / `pointToWeights`), preset metadata, and `describeConfigured()` / `plainSummary()` which derive the readout from the **real Slice 1 compiler** so the UI never drifts from what gets configured.

## Surface

Live at **`/platform/ai/priority`** (preview). Per-scope persistence (Slice 4) and the receipt/outcome view (Slice 3b) are not wired yet.

## Ease-of-use stance

One gesture sets everything, and the control always shows—in plain words—what it configured (model tier, effort, verification, retries). That transparency-with-simplicity is the differentiator over platforms that expose dozens of raw model/parameter knobs. Progressive disclosure per AGENTS.md §12: presets first; the triangle and numeric inputs are there when wanted, never required.
