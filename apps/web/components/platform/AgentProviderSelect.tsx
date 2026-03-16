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
      background: "#161625",
      borderRadius: "0 0 6px 6px",
      borderTop: "1px solid #2a2a40",
    }}>
      <span style={{ fontSize: 10, color: "#8888a0", whiteSpace: "nowrap" }}>Provider:</span>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        style={{
          flex: 1,
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          color: "#e0e0ff",
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
      {isPending && <span style={{ fontSize: 10, color: "#8888a0" }}>...</span>}
    </div>
  );
}
