// EP-GOLDEN-TRIANGLE Slice 3b — read-only "see the difference in outcome" view.
// Presentational only (no hooks / no I/O): renders stored receipts so it is
// trivially testable and safe in either a server or client tree. Data is fed by
// the server wrapper via listGoldenTriangleReceipts().
import type { StoredReceipt } from "@/lib/golden-triangle/receipt-store";

function tone(matched: boolean): { token: string; label: string } {
  return matched ? { token: "--dpf-success", label: "Matched" } : { token: "--dpf-warning", label: "Deviated" };
}

function reqLine(r: StoredReceipt["receipt"]): string {
  const parts: string[] = [];
  if (r.requested.minimumTier) parts.push(`${r.requested.minimumTier} tier`);
  if (r.requested.effort) parts.push(`${r.requested.effort} effort`);
  if (r.requested.verificationDepth) parts.push(`${r.requested.verificationDepth} verify`);
  return parts.length ? parts.join(" · ") : "no hard floor";
}

function presetLabel(p: string): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function EmptyState() {
  return (
    <div
      style={{
        border: "1px dashed var(--dpf-border)",
        borderRadius: 10,
        padding: "18px 16px",
        color: "var(--dpf-muted)",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: "var(--dpf-text)", fontSize: 13 }}>No outcome receipts yet.</strong>
      <p style={{ margin: "6px 0 0" }}>
        Once AI work runs under a saved priority, each run records a receipt here — what you asked for (model tier,
        effort, verification) versus what actually ran, with cost, time, and any failover. Adjust the triangle above and
        the difference shows up in this list.
      </p>
    </div>
  );
}

export function GoldenTriangleOutcomes({ receipts }: { receipts: StoredReceipt[] }) {
  if (!receipts.length) return <EmptyState />;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {receipts.map((row) => {
        const r = row.receipt;
        const t = tone(r.matchedRequest);
        return (
          <li
            key={row.interactionId}
            style={{
              border: "1px solid var(--dpf-border)",
              borderLeft: `3px solid var(${t.token})`,
              borderRadius: 10,
              padding: "10px 12px",
              background: "var(--dpf-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>
                {presetLabel(r.preset)}
                <span style={{ fontWeight: 400, color: "var(--dpf-muted)" }}> · {reqLine(r)}</span>
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: `var(${t.token})`,
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--dpf-text)" }}>{r.summary}</p>
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--dpf-muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
              {row.routeContext ? <span>surface: {row.routeContext}</span> : null}
              <span>{new Date(row.at).toLocaleString()}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
