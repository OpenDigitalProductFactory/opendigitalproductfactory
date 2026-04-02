"use client";

import { useState, useEffect, useCallback } from "react";

type HealthState = {
  inferenceUp: boolean;
  memoryUp: boolean;
  inferenceSlow: boolean;
  offline: boolean;
};

const HEALTHY: HealthState = { inferenceUp: true, memoryUp: true, inferenceSlow: false, offline: true };

export function CoworkerHealthStatus() {
  const [health, setHealth] = useState<HealthState>(HEALTHY);

  const fetchHealth = useCallback(async () => {
    try {
      // Single probe to check if monitoring is reachable at all
      const probeRes = await fetch(
        `/api/platform/metrics?query=${encodeURIComponent("up")}`,
        { signal: AbortSignal.timeout(3_000) },
      );
      if (probeRes.status === 503) {
        setHealth(HEALTHY); // monitoring offline = don't show warnings
        return;
      }
      const probeJson = await probeRes.json();
      if (probeJson.status !== "success") {
        setHealth(HEALTHY);
        return;
      }

      // Parse all "up" results in one pass
      const results: Array<{ job: string; up: boolean }> = (probeJson.data?.result ?? []).map(
        (r: { metric: Record<string, string>; value: [number, string] }) => ({
          job: r.metric.job ?? "",
          up: parseFloat(r.value[1]) === 1,
        }),
      );

      const inferenceUp = results.find((r) => r.job === "model-runner")?.up ?? true;
      const memoryUp = results.find((r) => r.job === "qdrant")?.up ?? true;

      setHealth({ inferenceUp, memoryUp, inferenceSlow: false, offline: false });
    } catch {
      setHealth(HEALTHY); // network error = don't show warnings
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 30_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  // Don't show anything when monitoring is offline or everything is healthy
  if (health.offline) return null;
  if (health.inferenceUp && health.memoryUp && !health.inferenceSlow) return null;

  if (!health.inferenceUp) {
    return (
      <div
        style={{
          padding: "8px 12px",
          fontSize: 11,
          color: "#ef4444",
          background: "rgba(239, 68, 68, 0.08)",
          borderTop: "1px solid rgba(239, 68, 68, 0.2)",
          textAlign: "center",
        }}
      >
        AI Coworker unavailable — check System Health
      </div>
    );
  }

  const messages: string[] = [];
  if (!health.memoryUp) {
    messages.push("Memory offline — responses won't recall prior context");
  }
  if (health.inferenceSlow) {
    messages.push("AI responses may be slower than usual");
  }

  return (
    <div
      style={{
        padding: "4px 12px",
        fontSize: 10,
        color: "#f59e0b",
        background: "rgba(245, 158, 11, 0.06)",
        borderTop: "1px solid rgba(245, 158, 11, 0.15)",
      }}
    >
      {messages.join(" · ")}
    </div>
  );
}
