"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";

import type { SkillRevisionRow } from "@/lib/skills/proposals";
import { rollbackSkillAction } from "@/lib/actions/skill-proposal-actions";

type Props = {
  skillId: string;
  revisions: SkillRevisionRow[];
};

export function SkillRevisionHistoryPanel({ skillId, revisions }: Props) {
  if (revisions.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 6,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-2)",
          color: "var(--dpf-muted)",
          fontSize: 12,
        }}
      >
        No revisions yet — the first approved proposal (or rollback) writes v1.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {revisions.map((r) => (
        <RevisionRow key={r.revisionId} skillId={skillId} revision={r} />
      ))}
    </div>
  );
}

function RevisionRow({ skillId, revision }: { skillId: string; revision: SkillRevisionRow }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-2)",
        fontSize: 12,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          color: "var(--dpf-accent)",
          minWidth: 40,
        }}
      >
        v{revision.version}
      </span>
      <span style={{ flex: 1, color: "var(--dpf-text)" }}>
        {revision.changeReason ?? "—"}
        {revision.proposalId ? (
          <span style={{ color: "var(--dpf-muted)" }}>
            {" "}
            (proposal <code>{revision.proposalId}</code>)
          </span>
        ) : null}
      </span>
      <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
        {revision.changedBy ?? "—"} ·{" "}
        {new Date(revision.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
      </span>
      {confirming ? (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await rollbackSkillAction(skillId, revision.version);
                setFeedback(
                  result.ok ? `Rolled back to v${revision.version}.` : `Failed: ${result.error}`,
                );
                setConfirming(false);
              })
            }
            style={dangerBtn}
          >
            Confirm rollback
          </button>
          <button type="button" onClick={() => setConfirming(false)} style={secondaryBtn}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} style={ghostBtn}>
          Roll back here
        </button>
      )}
      {feedback && (
        <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>{feedback}</span>
      )}
    </div>
  );
}

const ghostBtn: CSSProperties = {
  fontSize: 11,
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid var(--dpf-border)",
  background: "transparent",
  color: "var(--dpf-muted)",
  cursor: "pointer",
};

const secondaryBtn: CSSProperties = {
  fontSize: 11,
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-text)",
  cursor: "pointer",
};

const dangerBtn: CSSProperties = {
  fontSize: 11,
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid var(--dpf-error)",
  background: "var(--dpf-error)",
  color: "white",
  cursor: "pointer",
};
