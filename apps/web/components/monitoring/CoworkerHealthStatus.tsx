"use client";

import { useState, useEffect, useCallback } from "react";

type HealthState = {
  inferenceUp: boolean;
  memoryUp: boolean;
  inferenceSlow: boolean;
  offline: boolean;
};

export function CoworkerHealthStatus() {
  const [health, setHealth] = useState<HealthState>({
    inferenceUp: true,
    memoryUp: true,
    inferenceSlow: false,
    offline: true, // start offline until first successful poll
  });

  const fetchHealth = useCallback(async () => {
    try {
      // Check inference availability
      const inferenceRes = await fetch(
        `/api/platform/metrics?query=${encodeURIComponent('up{job="model-runner"}')}`,
      );
      if (inferenceRes.status === 503) {
        setHealth({ inferenceUp: true, memoryUp: true, inferenceSlow: false, offline: true });
        return;
      }
      const inferenceJson = await inferenceRes.json();
      const inferenceUp =
        parseFloat(inferenceJson.data?.result?.[0]?.value?.[1] ?? "1") === 1;

      // Check memory availability
      const memRes = await fetch(
        `/api/platform/metrics?query=${encodeURIComponent('up{job="qdrant"}')}`,
      );
      const memJson = await memRes.json();
      const memoryUp =
        parseFloat(memJson.data?.result?.[0]?.value?.[1] ?? "1") === 1;

      // Check inference latency
      const latencyRes = await fetch(
        `/api/platform/metrics?query=${encodeURIComponent(
          "histogram_quantile(0.95, rate(dpf_ai_inference_duration_seconds_bucket[5m]))",
        )}`,
      );
      const latencyJson = await latencyRes.json();
      const p95 = parseFloat(latencyJson.data?.result?.[0]?.value?.[1] ?? "0");
      const inferenceSlow = p95 > 15;

      setHealth({ inferenceUp, memoryUp, inferenceSlow, offline: false });
    } catch {
      setHealth({ inferenceUp: true, memoryUp: true, inferenceSlow: false, offline: true });
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

  // Inference completely offline — replace input area hint
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

  // Memory offline or inference slow — subtle warning
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
