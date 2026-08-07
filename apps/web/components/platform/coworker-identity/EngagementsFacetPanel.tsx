// apps/web/components/platform/coworker-identity/EngagementsFacetPanel.tsx
// EP-COWORKER-IDENTITY-360 Phase 1 — the "who has engaged it" facet body. Pure
// presentation over CoworkerEngagementsSummary (loadCoworkerEngagements). People
// vs other agents are visually distinguished. Server component.
import type {
  CoworkerEngagementsSummary,
  CoworkerEngager,
} from "@/lib/coworker-identity/engagements-projection";

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relTime(from: Date, now: Date): string {
  const ms = now.getTime() - from.getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function toneColor(tone: CoworkerEngager["tone"]): { bg: string; fg: string } {
  switch (tone) {
    case "open":
      return { bg: "var(--dpf-warning-soft, rgba(183,121,31,0.14))", fg: "var(--dpf-warning)" };
    case "done":
      return { bg: "var(--dpf-success-soft, rgba(31,157,87,0.14))", fg: "var(--dpf-success)" };
    default:
      return { bg: "var(--dpf-surface-2)", fg: "var(--dpf-muted)" };
  }
}

function EngagerRow({ e, now }: { e: CoworkerEngager; now: Date }) {
  const isAgent = e.kind === "agent";
  const tone = toneColor(e.tone);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "10px 0",
        borderTop: "1px solid var(--dpf-border)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 700,
          background: isAgent ? "var(--dpf-accent-soft)" : "var(--dpf-surface-2)",
          color: isAgent ? "var(--dpf-accent)" : "var(--dpf-text-secondary)",
          border: "1px solid var(--dpf-border)",
        }}
      >
        {isAgent ? "◆" : initials(e.label)}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>{e.label}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 650,
              padding: "1px 7px",
              borderRadius: 999,
              background: isAgent ? "var(--dpf-accent-soft)" : "var(--dpf-surface-2)",
              color: isAgent ? "var(--dpf-accent)" : "var(--dpf-text-secondary)",
            }}
          >
            {isAgent ? "AI coworker" : "Person"}
          </span>
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--dpf-muted)", marginTop: 1 }}>{e.how}</span>
      </span>
      <span style={{ textAlign: "right", flexShrink: 0 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 11,
            fontWeight: 650,
            padding: "1px 8px",
            borderRadius: 999,
            background: tone.bg,
            color: tone.fg,
            textTransform: "capitalize",
          }}
        >
          {e.status.replace(/[_-]/g, " ")}
        </span>
        <span style={{ display: "block", fontSize: 11, color: "var(--dpf-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
          {relTime(e.lastAt, now)}
          {e.count > 1 ? ` · ×${e.count}` : ""}
        </span>
      </span>
    </div>
  );
}

export function EngagementsFacetPanel({
  summary,
  now = new Date(),
}: {
  summary: CoworkerEngagementsSummary;
  now?: Date;
}) {
  const { engagers, totals } = summary;

  if (engagers.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
        No one has engaged this coworker yet — no people or agents have summoned it or delegated work to it.
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "0 0 4px" }}>
        <strong style={{ color: "var(--dpf-text-secondary)" }}>{totals.people}</strong> people ·{" "}
        <strong style={{ color: "var(--dpf-text-secondary)" }}>{totals.agents}</strong> agents ·{" "}
        <strong style={{ color: "var(--dpf-text-secondary)" }}>{totals.open}</strong> open
      </p>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {engagers.map((e) => (
          <EngagerRow key={`${e.kind}:${e.id}`} e={e} now={now} />
        ))}
      </div>
    </div>
  );
}
