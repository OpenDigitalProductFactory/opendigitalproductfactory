// apps/web/components/platform/coworker-identity/CostFacetPanel.tsx
// EP-COWORKER-IDENTITY-360 Phase 1 — the per-coworker Cost facet body. Pure
// presentation over CoworkerCostSummary (loadCoworkerCostProjection); no data
// fetching here. Server component.
import type { CoworkerCostSummary } from "@/lib/coworker-identity/cost-projection";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** A minimal sparkline from the ascending daily series. */
function Sparkline({ series }: { series: Array<{ day: string; usd: number }> }) {
  if (series.length < 2) return null;
  const max = Math.max(...series.map((p) => p.usd), 0.0001);
  const w = 220;
  const h = 48;
  const step = w / (series.length - 1);
  const pts = series.map((p, i) => {
    const x = i * step;
    const y = h - (p.usd / max) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Daily spend trend for the window"
      style={{ flex: "0 0 auto" }}
    >
      <path d={area} fill="var(--dpf-accent)" fillOpacity={0.14} />
      <path d={line} fill="none" stroke="var(--dpf-accent)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function CostFacetPanel({ summary }: { summary: CoworkerCostSummary }) {
  const { totalUsd, tokens, deltaPct, dailyUsd, drivers, budget, window } = summary;
  const hasSpend = totalUsd > 0 || drivers.length > 0;
  const deltaTone =
    deltaPct == null ? "var(--dpf-muted)" : deltaPct > 0 ? "var(--dpf-warning)" : "var(--dpf-success)";
  const maxDriver = Math.max(...drivers.map((d) => d.costUsd), 0.0001);

  if (!hasSpend) {
    return (
      <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
        No recorded spend for this coworker in the last {window.days} days.
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 750, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontSize: 15, color: "var(--dpf-muted)", fontWeight: 650 }}>$</span>
            {fmtUsd(totalUsd)}
          </div>
          <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 2 }}>
            last {window.days} days ·{" "}
            {deltaPct != null && (
              <span style={{ color: deltaTone, fontWeight: 650 }}>
                {deltaPct > 0 ? "▲" : "▼"} {Math.abs(deltaPct)}%
              </span>
            )}
            {deltaPct != null ? " vs prior · " : ""}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTokens(tokens)}</span> tokens
          </div>
        </div>
        <Sparkline series={dailyUsd} />
      </div>

      {(budget.dailyTokenLimit || budget.recentRejections > 0) && (
        <div style={{ marginTop: 15 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11.5,
              color: "var(--dpf-muted)",
              marginBottom: 6,
            }}
          >
            <span>Daily budget posture</span>
            {budget.dailyTokenLimit ? (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtTokens(budget.tokensToday)} / {fmtTokens(budget.dailyTokenLimit)} today
                {budget.usedPct != null ? ` · ${budget.usedPct}%` : ""}
              </span>
            ) : (
              <span>No daily limit set</span>
            )}
          </div>
          {budget.dailyTokenLimit != null && (
            <div style={{ height: 8, background: "var(--dpf-surface-2)", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, budget.usedPct ?? 0)}%`,
                  background: (budget.usedPct ?? 0) >= 90 ? "var(--dpf-warning)" : "var(--dpf-accent)",
                  borderRadius: 999,
                }}
              />
            </div>
          )}
          {budget.recentRejections > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--dpf-warning)", marginTop: 8 }}>
              {budget.recentRejections} budget rejection{budget.recentRejections === 1 ? "" : "s"} in the last 24h.
            </p>
          )}
        </div>
      )}

      {drivers.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--dpf-muted)",
              fontWeight: 650,
              margin: "0 0 9px",
            }}
          >
            Top cost drivers
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {drivers.map((d) => (
              <div
                key={d.key}
                style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", alignItems: "center", gap: 10, fontSize: 12.5 }}
              >
                <span
                  style={{ color: "var(--dpf-text-secondary)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={d.label}
                >
                  {d.label}
                </span>
                <span style={{ height: 6, background: "var(--dpf-surface-2)", borderRadius: 999, overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${Math.max(4, (d.costUsd / maxDriver) * 100)}%`,
                      background: "var(--dpf-accent)",
                      opacity: 0.8,
                      borderRadius: 999,
                    }}
                  />
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--dpf-muted)", fontWeight: 600 }}>
                  ${fmtUsd(d.costUsd)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
