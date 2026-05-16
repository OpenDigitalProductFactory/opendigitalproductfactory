"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";

import { runSkillCuratorAction } from "@/lib/actions/skill-curator-actions";

import type { CuratorFinding } from "@/lib/skills/curator";
import type { SkillLifecycleState } from "@/lib/skills/lifecycle";

type Props = {
  /** null when no curator has ever run on this install. */
  report:
    | {
        artifactId: string;
        scannedAt: string;
        totals: Record<SkillLifecycleState, number>;
        findings: CuratorFinding[];
        createdAt: string;
      }
    | null;
};

export function SkillCuratorReportPanel({ report }: Props) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleRunNow() {
    startTransition(async () => {
      const result = await runSkillCuratorAction();
      if (result.ok) {
        setFeedback(
          `Curator ran: ${result.report.findings.length} skills classified. Reload the page to see the new report.`,
        );
      } else {
        setFeedback(`Failed: ${result.error}`);
      }
    });
  }

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
            Curator report
          </h3>
          {report ? (
            <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "4px 0 0 0" }}>
              Last run {new Date(report.scannedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "4px 0 0 0" }}>
              The curator has not run yet on this install.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleRunNow}
          disabled={pending}
          style={primaryBtn}
        >
          {pending ? "Running…" : "Run curator now"}
        </button>
      </div>

      {feedback && (
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 8 }}>{feedback}</p>
      )}

      {report && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {(Object.entries(report.totals) as Array<[SkillLifecycleState, number]>).map(([state, count]) => (
              <span
                key={state}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: badgeBg(state),
                  color: badgeColor(state),
                  fontWeight: 500,
                }}
              >
                {state}: {count}
              </span>
            ))}
          </div>

          {report.findings.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: 0 }}>No findings.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--dpf-muted)", textAlign: "left" }}>
                  <th style={thStyle}>Skill</th>
                  <th style={thStyle}>From</th>
                  <th style={thStyle}>To</th>
                  <th style={thStyle}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {report.findings.map((f) => (
                  <tr key={f.skillId}>
                    <td style={tdStyle}>
                      <code style={{ color: "var(--dpf-accent)" }}>{f.skillId}</code>
                    </td>
                    <td style={tdStyle}>{f.fromState}</td>
                    <td style={{ ...tdStyle, fontWeight: f.changed ? 600 : 400 }}>{f.toState}</td>
                    <td style={{ ...tdStyle, color: "var(--dpf-muted)" }}>{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function badgeBg(state: SkillLifecycleState): string {
  switch (state) {
    case "active":
      return "color-mix(in srgb, var(--dpf-success) 12%, transparent)";
    case "stale":
      return "color-mix(in srgb, var(--dpf-warning) 12%, transparent)";
    case "pinned":
      return "color-mix(in srgb, var(--dpf-accent) 12%, transparent)";
    case "quarantined":
      return "color-mix(in srgb, var(--dpf-error) 12%, transparent)";
    case "archived":
      return "var(--dpf-surface-2)";
  }
}

function badgeColor(state: SkillLifecycleState): string {
  switch (state) {
    case "active":
      return "var(--dpf-success)";
    case "stale":
      return "var(--dpf-warning)";
    case "pinned":
      return "var(--dpf-accent)";
    case "quarantined":
      return "var(--dpf-error)";
    case "archived":
      return "var(--dpf-muted)";
  }
}

const primaryBtn: CSSProperties = {
  fontSize: 12,
  padding: "6px 12px",
  borderRadius: 4,
  border: "1px solid var(--dpf-accent)",
  background: "var(--dpf-accent)",
  color: "white",
  cursor: "pointer",
};

const thStyle: CSSProperties = {
  fontWeight: 500,
  padding: "4px 8px",
  borderBottom: "1px solid var(--dpf-border)",
};

const tdStyle: CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--dpf-border)",
  color: "var(--dpf-text)",
};
