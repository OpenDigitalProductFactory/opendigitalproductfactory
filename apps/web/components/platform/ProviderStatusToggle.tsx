"use client";

import { useState, useTransition } from "react";
import { toggleProviderStatus } from "@/lib/actions/ai-providers";
import { useRouter } from "next/navigation";

const STATUS_COLOURS: Record<string, string> = {
  active: "var(--dpf-success)",
  unconfigured: "var(--dpf-muted)",
  inactive: "var(--dpf-warning)",
};

type Props = {
  providerId: string;
  initialStatus: string;
};

export function ProviderStatusToggle({ providerId, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  // EP-AGENT-CAP-002: surface capability gap warning after activation
  const [capabilityWarning, setCapabilityWarning] = useState<string | null>(null);
  const router = useRouter();
  const colour = STATUS_COLOURS[status] ?? "var(--dpf-muted)";
  const isUnconfigured = status === "unconfigured";

  function handleToggle() {
    if (isUnconfigured) return; // Can't toggle unconfigured — needs setup first
    setCapabilityWarning(null);
    startTransition(async () => {
      const result = await toggleProviderStatus(providerId);
      setStatus(result.status);
      if (result.warning) {
        setCapabilityWarning(result.warning);
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending || isUnconfigured}
        title={isUnconfigured ? "Configure this provider first" : `Click to ${status === "active" ? "disable" : "enable"}`}
        className="transition-opacity"
        style={{
          background: `${colour}20`,
          color: colour,
          fontSize: 10,
          padding: "1px 5px",
          borderRadius: 3,
          border: "none",
          cursor: isUnconfigured ? "default" : "pointer",
          opacity: isPending ? 0.5 : 1,
        }}
      >
        {isPending ? "..." : status}
      </button>
      {capabilityWarning && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--dpf-warning)",
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          {capabilityWarning}
        </div>
      )}
    </div>
  );
}
