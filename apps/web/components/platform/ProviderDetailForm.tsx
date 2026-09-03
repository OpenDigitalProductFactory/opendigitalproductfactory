"use client";

import { useState, useTransition, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { configureProvider, testProviderAuth, discoverModels, profileModels } from "@/lib/actions/ai-providers";
import { startProviderOAuth, disconnectProviderOAuth } from "@/lib/actions/provider-oauth";
import { ConnectGrokCard } from "./ConnectGrokCard";
import type { ProviderWithCredential, DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";
import { ModelSection } from "@/components/platform/ModelSection";
import { ProviderStatusToggle } from "@/components/platform/ProviderStatusToggle";

// EP-INF-006: Routing profile shape passed through to ModelSection → ModelCard
type RoutingProfile = {
  modelId: string;
  friendlyName: string;
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowingScore: number;
  structuredOutputScore: number;
  conversational: number;
  contextRetention: number;
  profileSource: string;
  profileConfidence: string;
  evalCount: number;
  lastEvalAt: string | null;
  maxContextTokens: number | null;
  supportsToolUse: boolean;
  modelStatus: string;
  retiredAt: string | null;
};

type Props = {
  pw: ProviderWithCredential;
  canWrite: boolean;
  models: DiscoveredModelRow[];
  profiles: ModelProfileRow[];
  hasActiveProvider: boolean;
  // EP-INF-006: Routing profiles merged into model cards
  routingProfiles?: RoutingProfile[];
};

export function ProviderDetailForm({ pw, canWrite, models, profiles, hasActiveProvider, routingProfiles }: Props) {
  const { provider, credential } = pw;
  const router = useRouter();
  const fieldId = useId();
  const [isPending, startTransition] = useTransition();
  const isClaudeSubscription = provider.providerId === "anthropic-sub";
  const isZaiCodingProvider = provider.providerId === "zai-coding";

  // Secrets are write-only — never sent from server. Empty = no change on save.
  const [secretRef, setSecretRef]                   = useState("");
  const [endpoint, setEndpoint]                     = useState(provider.endpoint ?? "");
  const [computeWatts, setComputeWatts]             = useState(String(provider.computeWatts ?? 150));
  const [electricityRate, setElectricityRate]       = useState(String(provider.electricityRateKwh ?? 0.12));
  const [enabledFamilies, setEnabledFamilies]       = useState<string[]>(provider.enabledFamilies);
  const [testResult, setTestResult]                 = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMessage, setSaveMessage]               = useState<string | null>(null);
  const [discoveryResult, setDiscoveryResult]       = useState<{ discovered: number; newCount: number; error?: string; warning?: string } | null>(null);
  const [profilingResult, setProfilingResult]       = useState<{ profiled: number; failed: number; error?: string } | null>(null);
  const [disconnectConfirm, setDisconnectConfirm]   = useState(false);
  const [pipelineStatus, setPipelineStatus]         = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics]       = useState(false);

  const [clientId, setClientId]                     = useState(credential?.clientId ?? "");
  const [clientSecret, setClientSecret]             = useState("");  // write-only
  const [tokenEndpoint, setTokenEndpoint]           = useState(credential?.tokenEndpoint ?? "");
  const [scope, setScope]                           = useState(credential?.scope ?? "");
  const [selectedAuthMethod, setSelectedAuthMethod] = useState(
    isClaudeSubscription ? "oauth2_authorization_code" : provider.authMethod,
  );

  const searchParams = useSearchParams();
  const oauthResult = searchParams.get("oauth");
  const oauthReason = searchParams.get("reason");

  useEffect(() => {
    if (oauthResult === "success") {
      setSaveMessage("Successfully connected via OAuth");
    } else if (oauthResult === "error") {
      setTestResult({ ok: false, message: `OAuth failed: ${oauthReason ?? "unknown error"}` });
    }
  }, [oauthResult, oauthReason]);

  const needsEndpoint   = provider.baseUrl === null;
  const displayedAuthMethods = isClaudeSubscription
    ? provider.supportedAuthMethods.filter((method) => method === "oauth2_authorization_code")
    : provider.supportedAuthMethods;
  const hasDualAuth     = displayedAuthMethods.length > 1;
  const isCompute       = provider.costModel === "compute";

  function toggleFamily(family: string) {
    setEnabledFamilies((prev) =>
      prev.includes(family) ? prev.filter((f) => f !== family) : [...prev, family]
    );
  }

  function buildSaveInput() {
    const shouldPersistAuthMethod = hasDualAuth || selectedAuthMethod !== provider.authMethod;
    return {
      providerId: provider.providerId,
      enabledFamilies,
      ...(shouldPersistAuthMethod && { authMethod: selectedAuthMethod }),
      ...(selectedAuthMethod === "api_key" && secretRef ? { secretRef } : {}),
      ...(selectedAuthMethod === "oauth2_client_credentials" && clientId       ? { clientId }       : {}),
      ...(selectedAuthMethod === "oauth2_client_credentials" && clientSecret   ? { clientSecret }   : {}),
      ...(selectedAuthMethod === "oauth2_client_credentials" && tokenEndpoint  ? { tokenEndpoint }  : {}),
      ...(selectedAuthMethod === "oauth2_client_credentials" && scope          ? { scope }          : {}),
      ...(needsEndpoint && endpoint ? { endpoint } : {}),
      ...(isCompute ? { computeWatts: Number(computeWatts), electricityRateKwh: Number(electricityRate) } : {}),
    };
  }

  function handleReadyProvider() {
    startTransition(async () => {
      setPipelineStatus("Saving provider settings...");
      setTestResult(null);
      setDiscoveryResult(null);
      setProfilingResult(null);

      const result = await configureProvider(buildSaveInput());
      if (result.error) {
        setSaveMessage(`Error: ${result.error}`);
        setPipelineStatus(null);
        return;
      }
      setSaveMessage("Settings saved");

      setPipelineStatus("Checking connection...");
      const test = await testProviderAuth(provider.providerId);
      setTestResult(test);
      if (!test.ok) {
        setPipelineStatus(null);
        router.refresh();
        return;
      }

      setPipelineStatus("Refreshing model catalog...");
      const discovery = await discoverModels(provider.providerId);
      setDiscoveryResult(discovery);
      if (discovery.discovered > 0) {
        setPipelineStatus("Preparing routing metadata...");
        const profResult = await profileModels(provider.providerId);
        setProfilingResult(profResult);
      }

      setPipelineStatus(null);
      router.refresh();
    });
  }

  function handleRefreshModels() {
    startTransition(async () => {
      setPipelineStatus("Discovering models...");
      const discovery = await discoverModels(provider.providerId);
      setDiscoveryResult(discovery);

      if (discovery.discovered > 0) {
        setPipelineStatus("Syncing routing profiles...");
        const profResult = await profileModels(provider.providerId);
        setProfilingResult(profResult);
      }

      setPipelineStatus(null);
      router.refresh();
    });
  }

  const hasProfiles = profiles.length > 0 || (profilingResult != null && profilingResult.profiled > 0);
  const hasCredential = selectedAuthMethod === "none"
    || credential?.secretHint
    || (selectedAuthMethod === "oauth2_authorization_code" && credential?.status === "ok")
    || secretRef;
  const readinessState = provider.status === "active" && hasProfiles && hasCredential
    ? { label: "Ready", tone: "var(--dpf-success)", detail: "Connection, catalog, and routing metadata are prepared." }
    : hasCredential
      ? { label: "Needs readiness check", tone: "var(--dpf-warning)", detail: "Save once and DPF will test, discover, and prepare models automatically." }
      : { label: "Needs credentials", tone: "var(--dpf-muted)", detail: "Add credentials, then DPF will handle the readiness checks." };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--dpf-surface-1)",
    border: "1px solid var(--dpf-border)",
    color: "var(--dpf-text)",
    fontSize: 13,
    padding: "8px 10px",
    borderRadius: 4,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    color: "var(--dpf-muted)",
    fontSize: 12,
    marginBottom: 4,
  };

  return (
    <div>
      <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "var(--dpf-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
          Technical readiness
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: readinessState.tone,
            background: `color-mix(in srgb, ${readinessState.tone} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${readinessState.tone} 28%, transparent)`,
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 12,
            fontWeight: 600,
          }}>
            {readinessState.label}
          </span>
          <span style={{ color: "var(--dpf-muted)", fontSize: 12 }}>{readinessState.detail}</span>
        </div>
        <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "6px 0 0" }}>
          Data-use eligibility is evaluated separately for each workload and connected account.
        </p>
      </div>

      {/* Status + toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
        <span style={{ color: "var(--dpf-muted)", fontSize: 12 }}>{provider.costModel === "compute" ? "compute-priced" : "token-priced"}</span>
      </div>

      {/* Model families — hidden during initial setup, shown as advanced after profiling */}
      {showDiagnostics && hasProfiles && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ color: "var(--dpf-muted)", fontSize: 12, cursor: "pointer", marginBottom: 6 }}>
            Model families ({enabledFamilies.length}/{provider.families.length} enabled)
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
                <span style={{ fontSize: 12, color: "var(--dpf-text)" }}>{f}</span>
              </label>
            ))}
          </div>
        </details>
      )}

      {/* Custom endpoint (Azure OpenAI etc.) */}
      {needsEndpoint && (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={`${fieldId}-endpoint`} style={labelStyle}>
            Custom endpoint URL
          </label>
          <input
            id={`${fieldId}-endpoint`}
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
        <label htmlFor={`${fieldId}-auth-method`} style={labelStyle}>
          Authentication method
        </label>
        {hasDualAuth ? (
          <select
            id={`${fieldId}-auth-method`}
            value={selectedAuthMethod}
            onChange={(e) => setSelectedAuthMethod(e.target.value)}
            disabled={!canWrite || isPending}
            style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)", fontSize: 13, padding: "8px 10px", borderRadius: 4 }}
          >
            {displayedAuthMethods.map((m) => (
              <option key={m} value={m}>
                {m === "api_key" ? "API Key" : m === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : m === "oauth2_authorization_code" ? "OAuth (Sign in)" : "None"}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: "var(--dpf-text)", fontSize: 13 }}>
            {displayedAuthMethods[0] === "api_key" ? "API Key" : displayedAuthMethods[0] === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : displayedAuthMethods[0] === "oauth2_authorization_code" ? "OAuth (Sign in)" : "None"}
          </span>
        )}
      </div>

      {/* Grok (xAI) device-code OAuth — preferred "sign in with Google" path. Additive
          to the API-key field below, which stays available as a fallback. */}
      {provider.providerId === "xai" && provider.supportedAuthMethods?.includes("oauth2_device") && (
        <ConnectGrokCard canWrite={canWrite} />
      )}

      {/* API key / subscription token credential field */}
      {selectedAuthMethod === "api_key" && (() => {
        const isAnthropicApi = provider.providerId === "anthropic";
        const isAnthropicSub = provider.providerId === "anthropic-sub";
        const isAnyAnthropic = isAnthropicApi || isAnthropicSub;

        return (
        <div style={{ marginBottom: 16 }}>
          {isZaiCodingProvider && (
            <div style={{
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 6,
              padding: "10px 12px",
              marginBottom: 12,
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--dpf-muted)",
            }}>
              <div style={{ fontWeight: 600, color: "var(--dpf-accent)", marginBottom: 4 }}>Uses your main Z.ai account key</div>
              <div>Build Studio points OpenCode at this coding endpoint, but credentials are inherited from the main Z.ai provider. Add a separate key here only if Z.ai requires a distinct GLM Coding Plan key for your account.</div>
            </div>
          )}
          {isAnyAnthropic && (
            <div style={{
              background: "var(--dpf-surface-1)",
              border: `1px solid ${isAnthropicSub ? "color-mix(in srgb, var(--dpf-success) 19%, transparent)" : "var(--dpf-border)"}`,
              borderRadius: 6,
              padding: "10px 12px",
              marginBottom: 12,
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--dpf-muted)",
            }}>
              {isAnthropicSub ? (
                <>
                  <div style={{ fontWeight: 600, color: "var(--dpf-success)", marginBottom: 4 }}>Claude Code / Max Subscription</div>
                  <div>Uses your Claude Max subscription — no per-token cost.</div>
                  <div style={{ marginTop: 4 }}>
                    Run <code style={{ background: "var(--dpf-bg)", padding: "1px 4px", borderRadius: 2 }}>claude setup-token</code> in your terminal, then paste the token below.
                  </div>
                  <div style={{ marginTop: 4, color: "var(--dpf-muted)" }}>Limitations: no prompt caching, no 1M context window.</div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600, color: "var(--dpf-accent)", marginBottom: 4 }}>Anthropic API Key</div>
                  <div>Pay-per-token billing. Get your API key from <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: "var(--dpf-accent)", textDecoration: "none" }}>console.anthropic.com</a>.</div>
                  <div style={{ marginTop: 4, color: "var(--dpf-muted)" }}>Full API access including prompt caching and 1M context.</div>
                </>
              )}
            </div>
          )}
          <label htmlFor={`${fieldId}-secret`} style={labelStyle}>
            {isAnthropicSub ? "Subscription Token" : isAnthropicApi ? "API Key" : "API Key"}
            {credential?.secretHint && !secretRef && (
              <span style={{ color: isAnthropicSub ? "var(--dpf-success)" : "var(--dpf-accent)", marginLeft: 8 }}>
                {credential.secretHint}
              </span>
            )}
          </label>
          <input
            id={`${fieldId}-secret`}
            type="password"
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder={
              isAnthropicSub
                ? "Paste subscription token (sk-ant-oat...)"
                : isAnthropicApi
                  ? "Paste API key (sk-ant-api...)"
                  : isZaiCodingProvider && credential?.secretHint ? "Advanced override only"
                  : credential?.secretHint ? "Enter new key to replace" : "Enter API key"
            }
            style={{
              ...inputStyle,
              fontFamily: "monospace",
              ...(isAnthropicSub && secretRef ? { borderColor: "color-mix(in srgb, var(--dpf-success) 38%, transparent)" } : {}),
              ...(isAnthropicApi && secretRef ? { borderColor: "color-mix(in srgb, var(--dpf-accent) 38%, transparent)" } : {}),
            }}
          />
          {isAnyAnthropic && secretRef && (
            <div style={{ fontSize: 11, marginTop: 4, color:
              (isAnthropicSub && !secretRef.startsWith("sk-ant-oat")) || (isAnthropicApi && !secretRef.startsWith("sk-ant-api"))
                ? "var(--dpf-error)" : isAnthropicSub ? "var(--dpf-success)" : "var(--dpf-accent)"
            }}>
              {isAnthropicSub && secretRef.startsWith("sk-ant-oat")
                ? "Subscription token — uses your Max plan"
                : isAnthropicSub && secretRef.length > 5
                  ? "This looks like an API key, not a subscription token. Use the Anthropic (API Key) provider for API keys."
                  : isAnthropicApi && secretRef.startsWith("sk-ant-api")
                    ? "API key — pay-per-token billing"
                    : isAnthropicApi && secretRef.startsWith("sk-ant-oat") && secretRef.length > 5
                      ? "This looks like a subscription token. Use the Anthropic (Claude Code) provider for subscription tokens."
                      : ""}
            </div>
          )}
        </div>
        );
      })()}

      {/* OAuth2 Client Credentials fields */}
      {selectedAuthMethod === "oauth2_client_credentials" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor={`${fieldId}-client-id`} style={labelStyle}>
              Client ID
            </label>
            <input
              id={`${fieldId}-client-id`}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder="client_id"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor={`${fieldId}-client-secret`} style={labelStyle}>
              Client Secret
              {credential?.clientSecretHint && !clientSecret && (
                <span style={{ color: "var(--dpf-success)", marginLeft: 8 }}>{credential.clientSecretHint}</span>
              )}
            </label>
            <input
              id={`${fieldId}-client-secret`}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder={credential?.clientSecretHint ? "Enter new secret to replace" : "Enter client secret"}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor={`${fieldId}-token-endpoint`} style={labelStyle}>
              Token Endpoint
            </label>
            <input
              id={`${fieldId}-token-endpoint`}
              value={tokenEndpoint}
              onChange={(e) => setTokenEndpoint(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder="https://provider.example.com/oauth/token"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor={`${fieldId}-scope`} style={labelStyle}>
              Scope
            </label>
            <input
              id={`${fieldId}-scope`}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={!canWrite || isPending}
              placeholder="openid profile"
              style={inputStyle}
            />
          </div>
        </>
      )}

      {selectedAuthMethod === "oauth2_authorization_code" && (
        <div style={{ marginBottom: 16 }}>
          {/* BI-2DD7042A: judge connected/expired by the tokenExpiresAt TIMESTAMP,
              not the stored status enum — the enum only flips to "expired" when a
              refresh attempt fails, so an idle provider's lapsed token used to
              render green "Connected" here while the OAuth card above said
              "Token expired", and the working sign-in button stayed hidden. */}
          {credential?.status === "ok" && credential?.tokenExpiresAt &&
           new Date(credential.tokenExpiresAt).getTime() > Date.now() ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--dpf-success)", display: "inline-block" }} />
                <span style={{ color: "var(--dpf-text)", fontSize: 13 }}>
                  Connected · token expires {new Date(credential.tokenExpiresAt).toLocaleString()}
                </span>
              </div>
              {disconnectConfirm ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>
                    Disconnect this account? Linked services will be deactivated.
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => startTransition(async () => {
                      const result = await disconnectProviderOAuth(provider.providerId);
                      if (result.error) {
                        setTestResult({ ok: false, message: result.error });
                        setDisconnectConfirm(false);
                        return;
                      }
                      router.refresh();
                    })}
                    style={{ background: "color-mix(in srgb, var(--dpf-error) 15%, transparent)", border: "1px solid var(--dpf-error)", color: "var(--dpf-error)", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                  >
                    Confirm disconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisconnectConfirm(false)}
                    style={{ background: "transparent", border: "1px solid var(--dpf-border)", color: "var(--dpf-muted)", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setDisconnectConfirm(true)}
                  style={{ background: "transparent", border: "1px solid var(--dpf-error)", color: "var(--dpf-error)", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : credential?.status === "expired" ||
              (credential?.tokenExpiresAt && new Date(credential.tokenExpiresAt).getTime() <= Date.now()) ? (
            <div>
              <div style={{ color: "var(--dpf-warning)", fontSize: 13, marginBottom: 8 }}>
                {credential?.hasRefreshToken && credential?.status !== "expired"
                  ? "Access token expired — it refreshes automatically on next use, or sign in again now"
                  : "Token expired — sign in again"}
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => {
                  const result = await startProviderOAuth(provider.providerId);
                  if ("authorizeUrl" in result) {
                    window.open(result.authorizeUrl, "_self");
                  } else {
                    setTestResult({ ok: false, message: result.error });
                  }
                })}
                style={{ background: "var(--dpf-accent)", color: "#fff", border: "none", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                Sign in with {provider.name}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ color: "var(--dpf-muted)", fontSize: 13, marginBottom: 8 }}>
                No account linked
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => {
                  const result = await startProviderOAuth(provider.providerId);
                  if ("authorizeUrl" in result) {
                    window.open(result.authorizeUrl, "_self");
                  } else {
                    setTestResult({ ok: false, message: result.error });
                  }
                })}
                style={{ background: "var(--dpf-accent)", color: "#fff", border: "none", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                Sign in with {provider.name}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Compute settings */}
      {isCompute && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label htmlFor={`${fieldId}-compute-watts`} style={labelStyle}>GPU/CPU wattage</label>
            <input
              id={`${fieldId}-compute-watts`}
              type="number"
              value={computeWatts}
              onChange={(e) => setComputeWatts(e.target.value)}
              disabled={!canWrite || isPending}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor={`${fieldId}-electricity-rate`} style={labelStyle}>Electricity rate ($/kWh)</label>
            <input
              id={`${fieldId}-electricity-rate`}
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
            onClick={handleReadyProvider}
            disabled={isPending}
            style={{ padding: "8px 16px", background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-accent)", color: "var(--dpf-accent)", borderRadius: 4, fontSize: 13, cursor: "pointer" }}
          >
            {isPending ? "Preparing..." : "Save & ready provider"}
          </button>
          {saveMessage && <span style={{ fontSize: 12, color: saveMessage.startsWith("Error") ? "var(--dpf-error)" : "var(--dpf-success)" }}>{saveMessage}</span>}
          {testResult && (
            <span style={{ fontSize: 12, color: testResult.ok ? "var(--dpf-success)" : "var(--dpf-error)" }}>
              {testResult.ok ? "✓" : "✗"} {testResult.message}
            </span>
          )}
          {pipelineStatus && (
            <span style={{ fontSize: 12, color: "var(--dpf-accent)" }} className="animate-pulse">
              {pipelineStatus}
            </span>
          )}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setShowDiagnostics((value) => !value)}
          style={{ background: "transparent", border: "1px solid var(--dpf-border)", color: "var(--dpf-muted)", fontSize: 12, padding: "6px 10px", borderRadius: 4, cursor: "pointer" }}
        >
          {showDiagnostics ? "Hide diagnostics" : "Advanced diagnostics"}
        </button>
      </div>

      {showDiagnostics && canWrite && provider.status === "active" && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={handleRefreshModels}
            disabled={isPending}
            style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)", fontSize: 13, padding: "8px 14px", borderRadius: 4, cursor: isPending ? "not-allowed" : "pointer", opacity: isPending ? 0.6 : 1 }}
          >
            {isPending ? "Syncing..." : "Refresh model diagnostics"}
          </button>
          {isPending && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "var(--dpf-muted)" }} className="animate-pulse">
              This may take a minute for local models...
            </span>
          )}
          {discoveryResult && (
            <span style={{ marginLeft: 8, fontSize: 12, color: discoveryResult.error ? "var(--dpf-error)" : "var(--dpf-success)" }}>
              {discoveryResult.error
                ? `Error: ${discoveryResult.error}`
                : `${discoveryResult.discovered} model${discoveryResult.discovered !== 1 ? "s" : ""} discovered (${discoveryResult.newCount} new)`}
            </span>
          )}
          {discoveryResult?.warning && (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--dpf-muted)" }}>
              {discoveryResult.warning}
            </div>
          )}
          {profilingResult && (
            <span style={{ marginLeft: 8, fontSize: 12, color: profilingResult.error ? "var(--dpf-error)" : "var(--dpf-success)" }}>
              {profilingResult.error
                ? `Profiling error: ${profilingResult.error}`
                : `${profilingResult.profiled} profiled, ${profilingResult.failed} failed`}
            </span>
          )}
        </div>
      )}

      {models.length > 0 && (
        <p style={{ color: "var(--dpf-muted)", fontSize: 12, marginTop: 8 }}>
          {models.length} model{models.length !== 1 ? "s" : ""} discovered
        </p>
      )}

      </div>{/* end max-width form wrapper */}

      {models.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ color: "var(--dpf-accent)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
            Discovered Models
          </div>
          <ModelSection
            providerId={provider.providerId}
            models={models}
            profiles={profiles}
            canWrite={canWrite}
            hasActiveProvider={hasActiveProvider}
            latestDiscovery={models.length > 0 ? new Date(Math.max(...models.map(m => new Date(m.lastSeenAt).getTime()))) : null}
            routingProfiles={routingProfiles}
            endpointId={provider.providerId}
            showDiagnostics={showDiagnostics}
          />
        </div>
      )}
    </div>
  );
}
