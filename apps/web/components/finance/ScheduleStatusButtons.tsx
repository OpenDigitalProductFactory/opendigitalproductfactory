"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateScheduleStatus } from "@/lib/actions/recurring";

type Status = "active" | "paused" | "cancelled" | "completed";

interface Props {
  scheduleId: string;
  currentStatus: string;
}

export function ScheduleStatusButtons({ scheduleId, currentStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleAction(newStatus: Status) {
    setLoading(true);
    try {
      await updateScheduleStatus(scheduleId, newStatus);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex gap-2">
      {currentStatus === "active" && (
        <button
          onClick={() => handleAction("paused")}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-warning)]/40 text-[var(--dpf-warning)] hover:bg-[var(--dpf-warning)]/10 disabled:opacity-50 transition-colors"
        >
          Pause
        </button>
      )}
      {currentStatus === "paused" && (
        <button
          onClick={() => handleAction("active")}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-success)]/40 text-[var(--dpf-success)] hover:bg-[var(--dpf-success)]/10 disabled:opacity-50 transition-colors"
        >
          Reactivate
        </button>
      )}
      {(currentStatus === "active" || currentStatus === "paused") && (
        <button
          onClick={() => handleAction("cancelled")}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-error)]/40 text-[var(--dpf-error)] hover:bg-[var(--dpf-error)]/10 disabled:opacity-50 transition-colors"
        >
          Cancel Schedule
        </button>
      )}
    </div>
  );
}
