"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";

import {
  pinSkillAction,
  quarantineSkillAction,
  unpinSkillAction,
} from "@/lib/actions/skill-curator-actions";
import type { SkillLifecycleState } from "@/lib/skills/lifecycle";

type Props = {
  skillId: string;
  currentState: SkillLifecycleState;
};

export function SkillLifecycleControls({ skillId, currentState }: Props) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function call(action: () => Promise<{ ok: true } | { ok: false; error: string }>, label: string) {
    startTransition(async () => {
      const result = await action();
      setFeedback(result.ok ? `${label} — reload to see the updated state.` : `Failed: ${result.error}`);
    });
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "var(--dpf-surface-2)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
        Lifecycle: <strong style={{ color: badgeColor(currentState) }}>{currentState}</strong>
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        disabled={pending || currentState === "pinned"}
        onClick={() => call(() => pinSkillAction(skillId), "Pinned")}
        style={secondaryBtn}
      >
        Pin
      </button>
      <button
        type="button"
        disabled={pending || currentState === "quarantined"}
        onClick={() => call(() => quarantineSkillAction(skillId), "Quarantined")}
        style={secondaryBtn}
      >
        Quarantine
      </button>
      <button
        type="button"
        disabled={pending || currentState === "active"}
        onClick={() => call(() => unpinSkillAction(skillId), "Reset to active")}
        style={secondaryBtn}
      >
        Reset to active
      </button>
      {feedback && (
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0, width: "100%" }}>
          {feedback}
        </p>
      )}
    </div>
  );
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

const secondaryBtn: CSSProperties = {
  fontSize: 11,
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-text)",
  cursor: "pointer",
};
