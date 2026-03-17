"use client";

import { AGENT_NAME_MAP } from "@/lib/agent-routing";

type Props = {
  agentId: string | null;
  claimStatus: string | null;
  claimedAt: Date | null;
};

export function ClaimBadge({ agentId, claimStatus, claimedAt }: Props) {
  if (!agentId || claimStatus !== "active") return null;

  const agentName = AGENT_NAME_MAP[agentId] ?? agentId;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] text-white font-medium" style={{ background: "rgba(124,140,248,0.15)", color: "#7c8cf8" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
      {agentName} working
    </span>
  );
}
