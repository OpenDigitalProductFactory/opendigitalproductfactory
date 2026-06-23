// apps/web/app/(shell)/platform/ai/priority/page.tsx
// EP-GOLDEN-TRIANGLE Slice 2 — the Golden Triangle priority control surface.
// A non-technical operator sets a Cost / Quality / Time posture; the platform
// compiles it into model tier, effort, verification, and retries.
import { GoldenTrianglePriorityPanel } from "@/components/golden-triangle/GoldenTrianglePriorityPanel";

export default function GoldenTrianglePriorityPage() {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>Priority</h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Set the Cost / Quality / Time priority for AI work. Pick a preset or fine-tune the triangle — the
          platform compiles it into the right model, effort, and verification, and shows in plain language
          exactly what it configured.
        </p>
      </div>
      <GoldenTrianglePriorityPanel />
    </div>
  );
}
