"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureProvider, testProviderAuth } from "@/lib/actions/ai-providers";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";

type Props = { pw: ProviderWithCredential; canWrite: boolean };

export function ProviderDetailForm({ pw, canWrite }: Props) {
  const { provider, credential } = pw;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [secretRef, setSecretRef]                 = useState(credential?.secretRef ?? "");
  const [endpoint, setEndpoint]                   = useState(provider.endpoint ?? "");
  const [computeWatts, setComputeWatts]           = useState(String(provider.computeWatts ?? 150));
  const [electricityRate, setElectricityRate]     = useState(String(provider.electricityRateKwh ?? 0.12));
  const [enabledFamilies, setEnabledFamilies]     = useState<string[]>(provider.enabledFamilies);
  const [testResult, setTestResult]               = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMessage, setSaveMessage]             = useState<string | null>(null);

  const isKeyed      = provider.authHeader !== null;
  const needsEndpoint = provider.authEndpoint === null;
  const isCompute    = provider.costModel === "compute";

  function toggleFamily(family: string) {
    setEnabledFamilies((prev) =>
      prev.includes(family) ? prev.filter((f) => f !== family) : [...prev, family]
    );
  }

  function handleSave() {
    startTransition(async () => {
      const result = await configureProvider({
        providerId: provider.providerId,
        enabledFamilies,
        ...(isKeyed && secretRef ? { secretRef } : {}),
        ...(needsEndpoint && endpoint ? { endpoint } : {}),
        ...(isCompute ? { computeWatts: Number(computeWatts), electricityRateKwh: Number(electricityRate) } : {}),
      });
      setSaveMessage(result.error ? `Error: ${result.error}` : "Saved");
      router.refresh();
    });
  }

  function handleTest() {
    startTransition(async () => {
      const result = await testProviderAuth(provider.providerId);
      setTestResult(result);
      router.refresh();
    });
  }

  const statusColour = provider.status === "active" ? "#4ade80" : provider.status === "inactive" ? "#555566" : "#fbbf24";

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <span style={{ background: `${statusColour}20`, color: statusColour, fontSize: 9, padding: "2px 6px", borderRadius: 3 }}>
          {provider.status}
        </span>
        <span style={{ color: "#555566", fontSize: 10 }}>{provider.costModel === "compute" ? "compute-priced" : "token-priced"}</span>
      </div>

      {/* Enabled families */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: "#555566", fontSize: 10, marginBottom: 6 }}>Enabled model families</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {provider.families.map((f) => (
            <label key={f} style={{ display: "flex", alignItems: "center", gap: 4, cursor: canWrite ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={enabledFamilies.includes(f)}
                disabled={!canWrite || isPending}
                onChange={() => toggleFamily(f)}
              />
              <span style={{ fontSize: 10, color: "#e0e0ff" }}>{f}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom endpoint (Azure OpenAI etc.) */}
      {needsEndpoint && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>
            Custom endpoint URL
          </label>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder="https://my-resource.openai.azure.com"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
          />
        </div>
      )}

      {/* API key env var name */}
      {isKeyed && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>
            Environment variable name
          </label>
          <input
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder="ANTHROPIC_API_KEY"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4, fontFamily: "monospace" }}
          />
          <p style={{ color: "#555566", fontSize: 9, marginTop: 3 }}>
            Enter the name of the env var that holds the API key — not the key itself.
          </p>
        </div>
      )}

      {/* Compute settings */}
      {isCompute && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>GPU/CPU wattage</label>
            <input
              type="number"
              value={computeWatts}
              onChange={(e) => setComputeWatts(e.target.value)}
              disabled={!canWrite || isPending}
              style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
            />
          </div>
          <div>
            <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>Electricity rate ($/kWh)</label>
            <input
              type="number"
              step="0.01"
              value={electricityRate}
              onChange={(e) => setElectricityRate(e.target.value)}
              disabled={!canWrite || isPending}
              style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
            />
          </div>
        </div>
      )}

      {canWrite && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={handleSave}
            disabled={isPending}
            style={{ padding: "6px 14px", background: "#2a2a50", border: "1px solid #7c8cf8", color: "#7c8cf8", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >
            Save
          </button>
          <button
            onClick={handleTest}
            disabled={isPending}
            style={{ padding: "6px 14px", background: "transparent", border: "1px solid #2a2a40", color: "#e0e0ff", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >
            Test connection
          </button>
          {saveMessage && <span style={{ fontSize: 10, color: saveMessage.startsWith("Error") ? "#f87171" : "#4ade80" }}>{saveMessage}</span>}
          {testResult && (
            <span style={{ fontSize: 10, color: testResult.ok ? "#4ade80" : "#f87171" }}>
              {testResult.ok ? "✓" : "✗"} {testResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
