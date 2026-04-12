"use client";

import { useState } from "react";
import { AdminTabNav } from "@/components/admin/AdminTabNav";

type StepResult = {
  step: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  detail?: Record<string, unknown>;
  durationMs: number;
};

type PreflightResult = {
  status: "pass" | "fail" | "warn";
  summary: string;
  steps: StepResult[];
  timestamp: string;
};

type ProbeResult = {
  route: string;
  agentId: string;
  agentName: string;
  status: "pass" | "fail" | "warn";
  message: string;
  providerId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  downgraded?: boolean;
  toolsStripped?: boolean;
  durationMs: number;
  error?: string;
};

type ProbeResponse = {
  status: "pass" | "fail" | "warn";
  summary: string;
  results: ProbeResult[];
  timestamp: string;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pass: { bg: "rgba(74, 222, 128, 0.15)", text: "#4ade80", label: "PASS" },
  fail: { bg: "rgba(248, 113, 113, 0.15)", text: "#f87171", label: "FAIL" },
  warn: { bg: "rgba(251, 191, 36, 0.15)", text: "#fbbf24", label: "WARN" },
  skip: { bg: "rgba(136, 136, 160, 0.15)", text: "#8888a0", label: "SKIP" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.skip;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  );
}

function SummaryBanner({ status, summary, timestamp }: { status: string; summary: string; timestamp: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.skip;
  return (
    <div
      className="p-3 rounded mb-4 flex items-center justify-between"
      style={{ background: style.bg, color: style.text }}
    >
      <span className="font-medium text-sm">{summary}</span>
      <span className="text-xs" style={{ color: "var(--dpf-muted)" }}>
        {new Date(timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

export default function DiagnosticsPage() {
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [loading, setLoading] = useState<"preflight" | "probe" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPreflight, setExpandedPreflight] = useState<number | null>(null);
  const [expandedProbe, setExpandedProbe] = useState<number | null>(null);
  const [includeTools, setIncludeTools] = useState(false);

  async function runPreflight() {
    setLoading("preflight");
    setError(null);
    setPreflight(null);
    setExpandedPreflight(null);
    try {
      const res = await fetch("/api/diagnostics/preflight");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setPreflight(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(null);
    }
  }

  async function runProbe() {
    setLoading("probe");
    setError(null);
    setProbe(null);
    setExpandedProbe(null);
    try {
      const params = new URLSearchParams();
      if (includeTools) params.set("includeTools", "true");
      const res = await fetch(`/api/diagnostics/probe?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setProbe(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Diagnostics</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Verify the full chain: providers, routing, tools, skills, sandbox
        </p>
      </div>

      <AdminTabNav />

      <div className="max-w-3xl space-y-8">
        {/* ─── Preflight (static) ──────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">Preflight Check</h2>
          <p className="text-xs text-[var(--dpf-muted)] mb-3">
            Verifies configuration is wired correctly. No AI calls, instant results.
          </p>
          <button
            onClick={runPreflight}
            disabled={loading !== null}
            className="px-4 py-2 text-sm font-medium rounded transition-colors"
            style={{
              background: loading ? "var(--dpf-border)" : "var(--dpf-accent)",
              color: loading ? "var(--dpf-muted)" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading === "preflight" ? "Running..." : "Run Preflight"}
          </button>

          {preflight && (
            <div className="mt-4">
              <SummaryBanner status={preflight.status} summary={preflight.summary} timestamp={preflight.timestamp} />
              <div className="space-y-2">
                {preflight.steps.map((step, i) => (
                  <div key={i}>
                    <button
                      onClick={() => setExpandedPreflight(expandedPreflight === i ? null : i)}
                      className="w-full text-left p-3 rounded"
                      style={{ background: "var(--dpf-surface)", border: "1px solid var(--dpf-border)" }}
                    >
                      <div className="flex items-center gap-3">
                        <StatusBadge status={step.status} />
                        <span className="text-sm font-medium text-[var(--dpf-text)] flex-1">{step.step}</span>
                        <span className="text-xs" style={{ color: "var(--dpf-muted)" }}>{step.durationMs}ms</span>
                      </div>
                      <p className="text-xs mt-1 ml-12" style={{ color: "var(--dpf-muted)" }}>{step.message}</p>
                    </button>
                    {expandedPreflight === i && step.detail && (
                      <div className="mx-3 p-3 text-xs rounded-b border border-t-0"
                        style={{ background: "var(--dpf-bg)", borderColor: "var(--dpf-border)", color: "var(--dpf-muted)" }}>
                        <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify(step.detail, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ─── Live Probe ──────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">Live Probe</h2>
          <p className="text-xs text-[var(--dpf-muted)] mb-3">
            Sends a real inference call through each coworker route. Tests actual provider auth,
            model response, routing decisions, and rate limits. Uses real tokens.
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={runProbe}
              disabled={loading !== null}
              className="px-4 py-2 text-sm font-medium rounded transition-colors"
              style={{
                background: loading ? "var(--dpf-border)" : "#6366f1",
                color: loading ? "var(--dpf-muted)" : "#fff",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading === "probe" ? "Probing routes..." : "Run Live Probe"}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-[var(--dpf-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={includeTools}
                onChange={(e) => setIncludeTools(e.target.checked)}
                className="rounded"
              />
              Include tool-use test (Build Studio)
            </label>
          </div>

          {probe && (
            <div className="mt-4">
              <SummaryBanner status={probe.status} summary={probe.summary} timestamp={probe.timestamp} />
              <div className="space-y-2">
                {probe.results.map((r, i) => (
                  <div key={i}>
                    <button
                      onClick={() => setExpandedProbe(expandedProbe === i ? null : i)}
                      className="w-full text-left p-3 rounded"
                      style={{ background: "var(--dpf-surface)", border: "1px solid var(--dpf-border)" }}
                    >
                      <div className="flex items-center gap-3">
                        <StatusBadge status={r.status} />
                        <span className="text-sm font-medium text-[var(--dpf-text)] flex-1">
                          {r.route}
                          <span className="text-xs font-normal ml-2" style={{ color: "var(--dpf-muted)" }}>
                            {r.agentName}
                          </span>
                        </span>
                        <span className="text-xs" style={{ color: "var(--dpf-muted)" }}>{r.durationMs}ms</span>
                      </div>
                      <p className="text-xs mt-1 ml-12" style={{ color: "var(--dpf-muted)" }}>
                        {r.message.slice(0, 200)}
                      </p>
                    </button>
                    {expandedProbe === i && (
                      <div className="mx-3 p-3 text-xs rounded-b border border-t-0"
                        style={{ background: "var(--dpf-bg)", borderColor: "var(--dpf-border)", color: "var(--dpf-muted)" }}>
                        <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify({
                          providerId: r.providerId,
                          modelId: r.modelId,
                          inputTokens: r.inputTokens,
                          outputTokens: r.outputTokens,
                          downgraded: r.downgraded,
                          toolsStripped: r.toolsStripped,
                          error: r.error,
                        }, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {error && (
          <div className="p-3 rounded text-sm" style={{ background: "rgba(248, 113, 113, 0.15)", color: "#f87171" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
