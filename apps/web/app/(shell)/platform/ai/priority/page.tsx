// apps/web/app/(shell)/platform/ai/priority/page.tsx
// EP-GOLDEN-TRIANGLE Slice 2/4 — the Golden Triangle priority control surface.
// A non-technical operator sets a Cost / Quality / Time posture; the platform
// compiles it into model tier, effort, verification, and retries. Seeds from the
// saved WWMD/platform default (migration-free, on the platform profile).
import Link from "next/link";

import { GoldenTrianglePriorityPanel } from "@/components/golden-triangle/GoldenTrianglePriorityPanel";
import { getGoldenTrianglePosture } from "@/lib/golden-triangle/persistence";

export default async function GoldenTrianglePriorityPage() {
  const saved = await getGoldenTrianglePosture({ kind: "platform" });
  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>Priority</h1>
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
            Set the Cost / Quality / Time priority for AI work. Pick a preset or fine-tune the triangle — the
            platform compiles it into the right model, effort, and verification, and shows in plain language
            exactly what it configured. Save it as the platform default for new work.
          </p>
        </div>
        <Link
          href="/platform/ai/priority/outcomes"
          style={{ flex: "0 0 auto", fontSize: 12, color: "var(--dpf-accent)", whiteSpace: "nowrap", marginTop: 2 }}
        >
          See outcomes →
        </Link>
      </div>
      <GoldenTrianglePriorityPanel initial={saved ?? undefined} />
    </div>
  );
}
