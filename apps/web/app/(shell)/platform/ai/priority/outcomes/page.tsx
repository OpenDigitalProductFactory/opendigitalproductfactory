// apps/web/app/(shell)/platform/ai/priority/outcomes/page.tsx
// EP-GOLDEN-TRIANGLE Slice 3b — the "see the difference in outcome" surface.
// Reads recent Golden Triangle receipts (fail-open) and shows, in plain language,
// what each run actually did versus what the saved priority asked for.
import { GoldenTriangleOutcomes } from "@/components/golden-triangle/GoldenTriangleOutcomes";
import { listGoldenTriangleReceipts } from "@/lib/golden-triangle/receipt-store";

export const dynamic = "force-dynamic";

export default async function GoldenTriangleOutcomesPage() {
  const receipts = await listGoldenTriangleReceipts(25);
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>Priority — Outcomes</h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          What actually ran versus what each saved priority asked for. A green &ldquo;Matched&rdquo; means the platform
          delivered the tier, effort, and verification you chose; &ldquo;Deviated&rdquo; flags a downgrade — and tells
          you whether it was a posture trade-off or an infrastructure failover.
        </p>
      </div>
      <GoldenTriangleOutcomes receipts={receipts} />
    </div>
  );
}
