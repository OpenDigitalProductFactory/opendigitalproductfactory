"use client";

import { useState, useTransition } from "react";
import { toggleProviderStatus } from "@/lib/actions/ai-providers";
import { useRouter } from "next/navigation";

const STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  unconfigured: "#8888a0",
  inactive: "#fbbf24",
};

type Props = {
  providerId: string;
  initialStatus: string;
};

export function ProviderStatusToggle({ providerId, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const colour = STATUS_COLOURS[status] ?? "#8888a0";
  const isUnconfigured = status === "unconfigured";

  function handleToggle() {
    if (isUnconfigured) return; // Can't toggle unconfigured — needs setup first
    startTransition(async () => {
      const result = await toggleProviderStatus(providerId);
      setStatus(result.status);
      router.refresh();
    });
  }

  return (
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
  );
}
