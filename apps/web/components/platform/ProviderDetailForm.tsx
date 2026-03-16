"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureProvider, testProviderAuth, discoverModels, profileModels } from "@/lib/actions/ai-providers";
import type { ProviderWithCredential, DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";
import { ModelSection } from "@/components/platform/ModelSection";
import { ProviderStatusToggle } from "@/components/platform/ProviderStatusToggle";

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

  // Secrets are write-only — never sent from server. Empty = no change on save.
  const [secretRef, setSecretRef]                   = useState("");
  const [endpoint, setEndpoint]                     = useState(provider.endpoint ?? "");
  const [computeWatts, setComputeWatts]             = useState(String(provider.computeWatts ?? 150));
  const [electricityRate, setElectricityRate]       = useState(String(provider.electricityRateKwh ?? 0.12));
  const [enabledFamilies, setEnabledFamilies]       = useState<string[]>(provider.enabledFamilies);
  const [testResult, setTestResult]                 = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMessage, setSaveMessage]               = useState<string | null>(null);
  const [discoveryResult, setDiscoveryResult]       = useState<{ discovered: number; newCount: number; error?: string } | null>(null);
  const [profilingResult, setProfilingResult]       = useState<{ profiled: number; failed: number; error?: string } | null>(null);

  const [clientId, setClientId]                     = useState(credential?.clientId ?? "");
  const [clientSecret, setClientSecret]             = useState("");  // write-only
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
        // Auto-profile only for Ollama (instant metadata-based profiling).
        // Cloud providers have too many models — user profiles individually.
        if (provider.providerId === "ollama" && discovery.discovered > 0) {
          const unprofiled = discovery.discovered - profiles.length;
          if (unprofiled > 0) {
            const profResult = await profileModels(provider.providerId);
            setProfilingResult(profResult);
          }
        }
      }
      router.refresh();
    });
  }

  function handleRefreshModels() {
    startTransition(async () => {
      const discovery = await discoverModels(provider.providerId);
      setDiscoveryResult(discovery);
      // Don't auto-profile — user can profile individually from the model list.
      router.refresh();
    });
  }

  // Guided setup: determine which step the user is on
  const hasProfiles = profiles.length > 0 || (profilingResult != null && profilingResult.profiled > 0);
  const step = provider.status === "active" && hasProfiles ? 5
    : provider.status === "active" ? 4
    : testResult?.ok ? 3
    : (secretRef || credential?.secretHint || selectedAuthMethod === "none") ? 2
    : 1;

  const STEPS = [
    { n: 1, label: "Credentials" },
    { n: 2, label: "Connect" },
    { n: 3, label: "Discover" },
    { n: 4, label: "Profile" },
    { n: 5, label: "Ready" },
  ];

  const statusColour = provider.status === "active" ? "#4ade80" : provider.status === "inactive" ? "#8888a0" : "#fbbf24";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#1a1a2e",
    border: "1px solid #2a2a40",
    color: "#e0e0ff",
    fontSize: 13,
    padding: "8px 10px",
    borderRadius: 4,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    color: "#c0c0d8",
    fontSize: 12,
    marginBottom: 4,
  };

  return (
    <div>
      <div style={{ maxWidth: 560 }}>
      {/* Setup progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24 }}>
        {STEPS.map((s, i) => {
          const isLastStep = s.n === STEPS.length;
          const done = step > s.n || (isLastStep && step === s.n);
          const current = step === s.n && !isLastStep;
          const colour = done ? "#4ade80" : current ? "#7c8cf8" : "#2a2a40";
          return (
            <div key={s.n} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 60 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: done ? "#4ade8030" : current ? "#7c8cf830" : "#1a1a2e",
                  border: `2px solid ${colour}`,
                  display: "grid", placeItems: "center",
                  fontSize: 11, fontWeight: 600, color: colour,
                }}>
                  {done ? "\u2713" : s.n}
                </div>
                <span style={{ fontSize: 10, color: current ? "#e0e0ff" : "#8888a0", marginTop: 4 }}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: 32, height: 2, background: done ? "#4ade8060" : "#2a2a40", marginBottom: 16 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Status + toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
        <span style={{ color: "#b0b0c8", fontSize: 12 }}>{provider.costModel === "compute" ? "compute-priced" : "token-priced"}</span>
      </div>

      {/* Model families — hidden during initial setup, shown as advanced after profiling */}
      {hasProfiles && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ color: "#8888a0", fontSize: 12, cursor: "pointer", marginBottom: 6 }}>
            Advanced: model families ({enabledFamilies.length}/{provider.families.length} enabled)
          </summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {provider.families.map((f) => (
              <label key={f} style={{ display: "flex", alignItems: "center", gap: 4, cursor: canWrite ? "pointer" : "default" }}>
                <input
                  type="checkbox"
                  checked={enabledFamilies.includes(f)}
                  disabled={!canWrite || isPending}
                  onChange={() => toggleFamily(f)}
                />
                <span style={{ fontSize: 12, color: "#e0e0ff" }}>{f}</span>
              </label>
            ))}
          </div>
        </details>
      )}

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

      {/* Auth method */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>
          Authentication method
        </label>
        {hasDualAuth ? (
          <select
            value={selectedAuthMethod}
            onChange={(e) => setSelectedAuthMethod(e.target.value)}
            disabled={!canWrite || isPending}
            style={{ background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 13, padding: "8px 10px", borderRadius: 4 }}
          >
            {provider.supportedAuthMethods.map((m) => (
              <option key={m} value={m}>
                {m === "api_key" ? "API Key" : m === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : "None"}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: "#e0e0ff", fontSize: 13 }}>
            {selectedAuthMethod === "api_key" ? "API Key" : selectedAuthMethod === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : "None"}
          </span>
        )}
      </div>

      {/* API key credential field */}
      {selectedAuthMethod === "api_key" && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            API Key
            {credential?.secretHint && !secretRef && (
              <span style={{ color: "#4ade80", marginLeft: 8 }}>{credential.secretHint}</span>
            )}
          </label>
          <input
            type="password"
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder={credential?.secretHint ? "Enter new key to replace" : "Enter API key"}
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
              {credential?.clientSecretHint && !clientSecret && (
                <span style={{ color: "#4ade80", marginLeft: 8 }}>{credential.clientSecretHint}</span>
              )}
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder={credential?.clientSecretHint ? "Enter new secret to replace" : "Enter client secret"}
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
            style={{ padding: "8px 16px", background: "#2a2a50", border: "1px solid #7c8cf8", color: "#7c8cf8", borderRadius: 4, fontSize: 13, cursor: "pointer" }}
          >
            Save
          </button>
          <button
            onClick={handleTest}
            disabled={isPending}
            style={{ padding: "8px 16px", background: "transparent", border: "1px solid #2a2a40", color: "#e0e0ff", borderRadius: 4, fontSize: 13, cursor: "pointer" }}
          >
            Test connection
          </button>
          {saveMessage && <span style={{ fontSize: 12, color: saveMessage.startsWith("Error") ? "#f87171" : "#4ade80" }}>{saveMessage}</span>}
          {testResult && (
            <span style={{ fontSize: 12, color: testResult.ok ? "#4ade80" : "#f87171" }}>
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
            style={{ background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 13, padding: "8px 14px", borderRadius: 4, cursor: isPending ? "not-allowed" : "pointer", opacity: isPending ? 0.6 : 1 }}
          >
            {isPending ? "Discovering models..." : "Refresh Models"}
          </button>
          {isPending && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "var(--dpf-muted)" }} className="animate-pulse">
              This may take a minute for local models...
            </span>
          )}
          {discoveryResult && (
            <span style={{ marginLeft: 8, fontSize: 12, color: discoveryResult.error ? "#f87171" : "#4ade80" }}>
              {discoveryResult.error
                ? `Error: ${discoveryResult.error}`
                : `${discoveryResult.discovered} model${discoveryResult.discovered !== 1 ? "s" : ""} discovered (${discoveryResult.newCount} new)`}
            </span>
          )}
          {profilingResult && (
            <span style={{ marginLeft: 8, fontSize: 12, color: profilingResult.error ? "#f87171" : "#4ade80" }}>
              {profilingResult.error
                ? `Profiling error: ${profilingResult.error}`
                : `${profilingResult.profiled} profiled, ${profilingResult.failed} failed`}
            </span>
          )}
        </div>
      )}

      {models.length > 0 && (
        <p style={{ color: "#b0b0c8", fontSize: 12, marginTop: 8 }}>
          {models.length} model{models.length !== 1 ? "s" : ""} discovered
        </p>
      )}

      </div>{/* end max-width form wrapper */}

      {models.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ color: "#7c8cf8", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
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
