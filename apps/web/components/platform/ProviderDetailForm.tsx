"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureProvider, testProviderAuth, discoverModels, profileModels } from "@/lib/actions/ai-providers";
import type { ProviderWithCredential, DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";
import { ModelSection } from "@/components/platform/ModelSection";

type Props = {
  pw: ProviderWithCredential;
  canWrite: boolean;
  models: DiscoveredModelRow[];
  profiles: ModelProfileRow[];
  hasActiveProvider: boolean;
};

export function ProviderDetailForm({ pw, canWrite, models, profiles, hasActiveProvider }: Props) {
  const { provider, credential } = pw;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [secretRef, setSecretRef]                   = useState(credential?.secretRef ?? "");
  const [endpoint, setEndpoint]                     = useState(provider.endpoint ?? "");
  const [computeWatts, setComputeWatts]             = useState(String(provider.computeWatts ?? 150));
  const [electricityRate, setElectricityRate]       = useState(String(provider.electricityRateKwh ?? 0.12));
  const [enabledFamilies, setEnabledFamilies]       = useState<string[]>(provider.enabledFamilies);
  const [testResult, setTestResult]                 = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMessage, setSaveMessage]               = useState<string | null>(null);
  const [discoveryResult, setDiscoveryResult]       = useState<{ discovered: number; newCount: number; error?: string } | null>(null);
  const [profilingResult, setProfilingResult]       = useState<{ profiled: number; failed: number; error?: string } | null>(null);

  const [clientId, setClientId]                     = useState(credential?.clientId ?? "");
  const [clientSecret, setClientSecret]             = useState(credential?.clientSecret ?? "");
  const [tokenEndpoint, setTokenEndpoint]           = useState(credential?.tokenEndpoint ?? "");
  const [scope, setScope]                           = useState(credential?.scope ?? "");
  const [selectedAuthMethod, setSelectedAuthMethod] = useState(provider.authMethod);

  const needsEndpoint   = provider.baseUrl === null;
  const hasDualAuth     = provider.supportedAuthMethods.length > 1;
  const isCompute       = provider.costModel === "compute";

  function toggleFamily(family: string) {
    setEnabledFamilies((prev) =>
      prev.includes(family) ? prev.filter((f) => f !== family) : [...prev, family]
    );
  }

  function handleSave() {
    startTransition(async () => {
      const saveInput = {
        providerId: provider.providerId,
        enabledFamilies,
        ...(hasDualAuth && { authMethod: selectedAuthMethod }),
        ...(selectedAuthMethod === "api_key" && secretRef ? { secretRef } : {}),
        ...(selectedAuthMethod === "oauth2_client_credentials" && clientId       ? { clientId }       : {}),
        ...(selectedAuthMethod === "oauth2_client_credentials" && clientSecret   ? { clientSecret }   : {}),
        ...(selectedAuthMethod === "oauth2_client_credentials" && tokenEndpoint  ? { tokenEndpoint }  : {}),
        ...(selectedAuthMethod === "oauth2_client_credentials" && scope          ? { scope }          : {}),
        ...(needsEndpoint && endpoint ? { endpoint } : {}),
        ...(isCompute ? { computeWatts: Number(computeWatts), electricityRateKwh: Number(electricityRate) } : {}),
      };
      const result = await configureProvider(saveInput);
      setSaveMessage(result.error ? `Error: ${result.error}` : "Saved");
      router.refresh();
    });
  }

  function handleTest() {
    startTransition(async () => {
      const result = await testProviderAuth(provider.providerId);
      setTestResult(result);
      if (result.ok) {
        const discovery = await discoverModels(provider.providerId);
        setDiscoveryResult(discovery);
        if (discovery.newCount > 0 && hasActiveProvider) {
          const unprofiledCount = discovery.discovered - (profiles?.length ?? 0);
          if (unprofiledCount > 50) {
            const ok = window.confirm(
              `Profile ${unprofiledCount} models? This may take a moment and incur AI costs.`
            );
            if (!ok) {
              router.refresh();
              return;
            }
          }
          const profResult = await profileModels(provider.providerId);
          setProfilingResult(profResult);
        }
      }
      router.refresh();
    });
  }

  function handleRefreshModels() {
    startTransition(async () => {
      const discovery = await discoverModels(provider.providerId);
      setDiscoveryResult(discovery);
      if (discovery.newCount > 0 && hasActiveProvider) {
        const unprofiledCount = discovery.discovered - (profiles?.length ?? 0);
        if (unprofiledCount > 50) {
          const ok = window.confirm(
            `Profile ${unprofiledCount} models? This may take a moment and incur AI costs.`
          );
          if (!ok) {
            router.refresh();
            return;
          }
        }
        const profResult = await profileModels(provider.providerId);
        setProfilingResult(profResult);
      }
      router.refresh();
    });
  }

  const statusColour = provider.status === "active" ? "#4ade80" : provider.status === "inactive" ? "#555566" : "#fbbf24";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#1a1a2e",
    border: "1px solid #2a2a40",
    color: "#e0e0ff",
    fontSize: 11,
    padding: "6px 8px",
    borderRadius: 4,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    color: "#555566",
    fontSize: 10,
    marginBottom: 4,
  };

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
          <label style={labelStyle}>
            Custom endpoint URL
          </label>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder="https://my-resource.openai.azure.com"
            style={inputStyle}
          />
        </div>
      )}

      {/* Auth method selector (for dual-auth providers) */}
      {hasDualAuth && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Authentication method
          </label>
          <select
            value={selectedAuthMethod}
            onChange={(e) => setSelectedAuthMethod(e.target.value)}
            disabled={!canWrite || isPending}
            style={{ background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
          >
            {provider.supportedAuthMethods.map((m) => (
              <option key={m} value={m}>
                {m === "api_key" ? "API Key" : m === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : "None"}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* API key credential field */}
      {selectedAuthMethod === "api_key" && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            API Key
          </label>
          <input
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder="ANTHROPIC_API_KEY"
            style={{ ...inputStyle, fontFamily: "monospace" }}
          />
        </div>
      )}

      {/* OAuth2 Client Credentials fields */}
      {selectedAuthMethod === "oauth2_client_credentials" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Client ID
            </label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder="client_id"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Client Secret
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder="client_secret"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Token Endpoint
            </label>
            <input
              value={tokenEndpoint}
              onChange={(e) => setTokenEndpoint(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder="https://provider.example.com/oauth/token"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Scope
            </label>
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder="openid profile"
              style={inputStyle}
            />
          </div>
        </>
      )}

      {/* Compute settings */}
      {isCompute && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>GPU/CPU wattage</label>
            <input
              type="number"
              value={computeWatts}
              onChange={(e) => setComputeWatts(e.target.value)}
              disabled={!canWrite || isPending}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Electricity rate ($/kWh)</label>
            <input
              type="number"
              step="0.01"
              value={electricityRate}
              onChange={(e) => setElectricityRate(e.target.value)}
              disabled={!canWrite || isPending}
              style={inputStyle}
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

      {canWrite && provider.status === "active" && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={handleRefreshModels}
            disabled={isPending}
            style={{ background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 12px", borderRadius: 4, cursor: "pointer" }}
          >
            Refresh Models
          </button>
          {discoveryResult && (
            <span style={{ marginLeft: 8, fontSize: 10, color: discoveryResult.error ? "#f87171" : "#4ade80" }}>
              {discoveryResult.error
                ? `Error: ${discoveryResult.error}`
                : `${discoveryResult.discovered} model${discoveryResult.discovered !== 1 ? "s" : ""} discovered (${discoveryResult.newCount} new)`}
            </span>
          )}
          {profilingResult && (
            <span style={{ marginLeft: 8, fontSize: 10, color: profilingResult.error ? "#f87171" : "#4ade80" }}>
              {profilingResult.error
                ? `Profiling error: ${profilingResult.error}`
                : `${profilingResult.profiled} profiled, ${profilingResult.failed} failed`}
            </span>
          )}
        </div>
      )}

      {models.length > 0 && (
        <p style={{ color: "#555566", fontSize: 10, marginTop: 8 }}>
          {models.length} model{models.length !== 1 ? "s" : ""} discovered
        </p>
      )}

      {models.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
            Discovered Models
          </div>
          <ModelSection
            providerId={provider.providerId}
            models={models}
            profiles={profiles}
            canWrite={canWrite}
            hasActiveProvider={hasActiveProvider}
            latestDiscovery={models.length > 0 ? new Date(Math.max(...models.map(m => new Date(m.lastSeenAt).getTime()))) : null}
          />
        </div>
      )}
    </div>
  );
}
