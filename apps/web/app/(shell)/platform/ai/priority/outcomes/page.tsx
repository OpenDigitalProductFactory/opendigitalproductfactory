// apps/web/app/(shell)/platform/ai/priority/outcomes/page.tsx
// EP-GOLDEN-TRIANGLE Slice 3 — the "see the difference in outcome" surface.
// Reconstructs receipts for recent runs against the currently effective posture
// (fail-open) and shows, in plain language, what each run actually did versus what
// the priority asked for, plus a learned-default calibration suggestion (Slice 6).
import { GoldenTriangleOutcomes } from "@/components/golden-triangle/GoldenTriangleOutcomes";
import { suggestCalibration } from "@/lib/golden-triangle/calibrate";
import { listRecentPostureReceipts } from "@/lib/golden-triangle/telemetry-receipts";
import { getEffectiveGoldenTrianglePosture } from "@/lib/golden-triangle/persistence";

export const dynamic = "force-dynamic";

export default async function GoldenTriangleOutcomesPage() {
  const receipts = await listRecentPostureReceipts(25);
  const resolved = await getEffectiveGoldenTrianglePosture(null);
  // The learned-default suggestion only makes sense when a posture is set and runs exist.
  const suggestion =
    resolved && receipts.length
      ? suggestCalibration(resolved.preference, receipts.map((r) => r.receipt))
      : null;
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>Priority — Outcomes</h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Recent runs measured against your current priority. A green &ldquo;Matched&rdquo; means the platform delivered
          the tier and effort you chose; &ldquo;Deviated&rdquo; flags a run that landed below it. When enough runs
          accumulate, a suggestion at the top proposes a better-fitted default.
        </p>
      </div>
      <GoldenTriangleOutcomes receipts={receipts} suggestion={suggestion} />
    </div>
  );
}
