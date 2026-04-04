"use client";

import { useState, useEffect, useCallback } from "react";

type HealthState = {
  inferenceUp: boolean;
  memoryUp: boolean;
  inferenceSlow: boolean;
  offline: boolean;
};

const HEALTHY: HealthState = { inferenceUp: true, memoryUp: true, inferenceSlow: false, offline: true };

type CoworkerHealthInputs = {
  monitoringOffline: boolean;
  modelRunnerUp: boolean;
  memoryUp: boolean;
  usableProviderCount: number;
  cloudProviderCount: number;
};

export function deriveCoworkerHealthState(input: CoworkerHealthInputs): HealthState {
  if (input.monitoringOffline) {
    return HEALTHY;
  }

  const inferenceUp = input.usableProviderCount > 0 || input.modelRunnerUp;
  return {
    inferenceUp,
    memoryUp: input.memoryUp,
    inferenceSlow: false,
    offline: false,
  };
}

export function CoworkerHealthStatus() {
  const [health, setHealth] = useState<HealthState>(HEALTHY);

  const fetchHealth = useCallback(async () => {
    try {
      const [probeRes, coworkerHealthRes] = await Promise.all([
        fetch(
          `/api/platform/metrics?query=${encodeURIComponent("up")}`,
          { signal: AbortSignal.timeout(3_000) },
        ),
        fetch("/api/agent/health", { signal: AbortSignal.timeout(3_000) }),
      ]);
      if (probeRes.status === 503) {
        setHealth(HEALTHY); // monitoring offline = don't show warnings
        return;
      }
      if (!coworkerHealthRes.ok) {
        setHealth(HEALTHY);
        return;
      }
      const probeJson = await probeRes.json();
      if (probeJson.status !== "success") {
        setHealth(HEALTHY);
        return;
      }
      const coworkerHealthJson = await coworkerHealthRes.json();

      // Parse all "up" results in one pass
      const results: Array<{ job: string; up: boolean }> = (probeJson.data?.result ?? []).map(
        (r: { metric: Record<string, string>; value: [number, string] }) => ({
          job: r.metric.job ?? "",
          up: parseFloat(r.value[1]) === 1,
        }),
      );

      const modelRunnerUp = results.find((r) => r.job === "model-runner")?.up ?? true;
      const memoryUp = results.find((r) => r.job === "qdrant")?.up ?? true;

      setHealth(
        deriveCoworkerHealthState({
          monitoringOffline: false,
          modelRunnerUp,
          memoryUp,
          usableProviderCount: coworkerHealthJson.usableProviderCount ?? 0,
          cloudProviderCount: coworkerHealthJson.cloudProviderCount ?? 0,
        }),
      );
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
          color: "var(--dpf-danger, #b91c1c)",
          background: "color-mix(in srgb, var(--dpf-danger, #b91c1c) 10%, transparent)",
          borderTop: "1px solid color-mix(in srgb, var(--dpf-danger, #b91c1c) 20%, transparent)",
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
        color: "var(--dpf-warning, #b45309)",
        background: "color-mix(in srgb, var(--dpf-warning, #b45309) 8%, transparent)",
        borderTop: "1px solid color-mix(in srgb, var(--dpf-warning, #b45309) 18%, transparent)",
      }}
    >
      {messages.join(" · ")}
    </div>
  );
}
