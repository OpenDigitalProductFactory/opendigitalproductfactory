"use client";

import { useState, useTransition } from "react";
import { updateAgentPreferredProvider } from "@/lib/actions/ai-providers";

type Props = {
  agentId: string;
  currentProviderId: string | null;
  providers: Array<{ providerId: string; name: string; status: string }>;
};

export function AgentProviderSelect({ agentId, currentProviderId, providers }: Props) {
  const [value, setValue] = useState(currentProviderId ?? "");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleChange(newValue: string) {
    setValue(newValue);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAgentPreferredProvider(agentId, newValue || null);
      if (result.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      background: "var(--dpf-surface-1)",
      borderRadius: "0 0 6px 6px",
      borderTop: "1px solid var(--dpf-border)",
    }}>
      <span style={{ fontSize: 10, color: "var(--dpf-muted)", whiteSpace: "nowrap" }}>Provider:</span>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        style={{
          flex: 1,
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          color: "var(--dpf-text)",
          fontSize: 11,
          padding: "3px 6px",
          borderRadius: 4,
        }}
      >
        <option value="">Auto (best available)</option>
        {providers.map((p) => (
          <option key={p.providerId} value={p.providerId}>
            {p.name}{p.status !== "active" ? ` (${p.status})` : ""}
          </option>
        ))}
      </select>
      {saved && <span style={{ fontSize: 10, color: "#4ade80" }}>Saved</span>}
      {isPending && <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>...</span>}
    </div>
  );
}
