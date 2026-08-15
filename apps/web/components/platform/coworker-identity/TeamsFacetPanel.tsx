// apps/web/components/platform/coworker-identity/TeamsFacetPanel.tsx
// EP-COWORKER-IDENTITY-360 Phase 2 — the Teams & collaboration ("work rooms")
// facet body. Pure presentation over CoworkerTeamsSummary. Server component.
import type { CoworkerTeamsSummary } from "@/lib/coworker-identity/teams-projection";

export function TeamsFacetPanel({ summary }: { summary: CoworkerTeamsSummary }) {
  if (summary.rooms.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
        This coworker is not a member of any team or collaboration room yet.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {summary.rooms.map((room) => (
        <div
          key={`${room.kind}:${room.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            border: "1px solid var(--dpf-border)",
            borderRadius: 8,
            background: "var(--dpf-surface-2)",
            padding: "10px 12px",
          }}
        >
          <span
            aria-hidden="true"
            title={room.kind === "value-stream-team" ? "Value-stream team" : "Owning team"}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              fontSize: 13,
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              color: "var(--dpf-accent)",
            }}
          >
            {room.kind === "value-stream-team" ? "◇" : "▤"}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 650, color: "var(--dpf-text)" }}>{room.name}</span>
            {room.detail && (
              <span style={{ display: "block", fontSize: 11.5, color: "var(--dpf-muted)", marginTop: 1 }}>
                {room.detail}
              </span>
            )}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 650,
              padding: "2px 9px",
              borderRadius: 999,
              background: "var(--dpf-accent-soft)",
              color: "var(--dpf-accent)",
            }}
          >
            {room.role}
          </span>
        </div>
      ))}
    </div>
  );
}
