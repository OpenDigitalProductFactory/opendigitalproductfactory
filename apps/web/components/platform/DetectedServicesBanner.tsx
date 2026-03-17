"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerMcpService, type DetectedMcpService } from "@/lib/actions/ai-providers";

type Props = {
  detected: DetectedMcpService[];
};

export function DetectedServicesBanner({ detected }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [registered, setRegistered] = useState<Set<string>>(new Set());

  const remaining = detected.filter((d) => !registered.has(d.serverId));
  if (remaining.length === 0) return null;

  function handleRegister(service: DetectedMcpService) {
    startTransition(async () => {
      await registerMcpService({
        providerId: service.serverId,
        name: service.name,
        sensitivityClearance: ["public", "internal"],
        capabilityTier: "basic",
        costBand: "free",
        taskTags: [],
      });
      setRegistered((prev) => new Set([...prev, service.serverId]));
      router.refresh();
    });
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-[#38bdf8] bg-[#38bdf808]">
      <p className="text-xs text-[#38bdf8] font-medium mb-2">
        {remaining.length} new MCP service{remaining.length !== 1 ? "s" : ""} detected. Review and register.
      </p>
      <div className="space-y-2">
        {remaining.map((service) => (
          <div key={service.serverId} className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-[#38bdf8] shrink-0" title="detected" />
            <span className="text-xs text-white flex-1 truncate">{service.name}</span>
            <span className="text-[9px] text-[var(--dpf-muted)]">{service.source}</span>
            <button
              type="button"
              onClick={() => handleRegister(service)}
              disabled={isPending}
              className="text-[10px] px-2 py-1 rounded bg-[var(--dpf-accent)] text-white font-medium disabled:opacity-50"
            >
              Register
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
