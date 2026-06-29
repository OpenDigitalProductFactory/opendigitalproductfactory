"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { saveBuildStudioConfig, checkLocalEndpoint, applyLocalModelContext } from "@/lib/actions/build-studio";
import type { BuildStudioDispatchConfig } from "@/lib/integrate/build-studio-config";
import type { LocalEndpointPreflight } from "@/lib/integrate/opencode-dispatch";
import type { ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "./build-studio-route-copy";
import { ContributorMcpReadinessCard } from "./ContributorMcpReadinessCard";
import {
  CredentialCard,
  isConfigured,
  ProviderRadio,
  type EngineReadinessBadge,
  type ProviderOption,
} from "./BuildStudioProviderControls";

type Props = {
  config: BuildStudioDispatchConfig;
  claudeProviders: ProviderOption[];
  codexProviders: ProviderOption[];
  grokProviders: ProviderOption[];
  opencodeProviders: ProviderOption[];
  contributorMcpReadiness: ContributorMcpReadiness;
  /** Per-engine sandbox readiness (engineId → last probe), keyed "claude"|"codex"|"grok". */
  engineReadiness?: Record<string, EngineReadinessBadge>;
  baseUrl: string;
  canWrite: boolean;
};

const CLAUDE_MODELS = [
  { value: "haiku", label: "Haiku", desc: "fastest, cheapest" },
  { value: "sonnet", label: "Sonnet", desc: "best balance", recommended: true },
  { value: "opus", label: "Opus", desc: "most capable, slower" },
];

function describeOpenCodeProvider(providerId: string, providers: ProviderOption[]): {
  label: string;
  desc: string;
  isLocal: boolean;
  providerName: string;
} {
  const selected = providers.find((p) => p.providerId === providerId) ?? providers[0];
  const selectedId = selected?.providerId ?? providerId;
  const isLocal = selectedId === "local" || selectedId === "ollama" || selectedId === "";
  const providerName = selected?.name ?? "OpenCode";
  return {
    label: isLocal ? "Local model (OpenCode) (Preview)" : `${providerName} (OpenCode) (Preview)`,
    desc: isLocal
      ? "Your own local LLM · no credential, runs offline"
      : `${providerName} via OpenCode · uses inherited provider credentials`,
    isLocal,
    providerName,
  };
}

export function BuildStudioConfigForm({
  config,
  claudeProviders,
  codexProviders,
  grokProviders,
  opencodeProviders,
  contributorMcpReadiness,
  engineReadiness,
  baseUrl,
  canWrite,
}: Props) {
  const [provider, setProvider] = useState(config.provider);
  const [claudeProviderId, setClaudeProviderId] = useState(config.claudeProviderId);
  const [codexProviderId, setCodexProviderId] = useState(config.codexProviderId);
  const [grokProviderId, setGrokProviderId] = useState(config.grokProviderId);
  const [claudeModel, setClaudeModel] = useState(config.claudeModel);
  const [codexModel, setCodexModel] = useState(config.codexModel);
  const [grokModel, setGrokModel] = useState(config.grokModel);
  // opencode = local model via the install's own OpenAI-compatible endpoint.
  // No credential to pick; the operator chooses which local provider (usually
  // one) and optionally a model, then preflights the endpoint here.
  const [opencodeProviderId, setOpencodeProviderId] = useState(
    config.opencodeProviderId || opencodeProviders[0]?.providerId || "",
  );
  const [opencodeModel, setOpencodeModel] = useState(config.opencodeModel);
  const [endpointCheck, setEndpointCheck] = useState<LocalEndpointPreflight | null>(null);
  const [checkingEndpoint, setCheckingEndpoint] = useState(false);
  // (a) Per-model served context window (tokens) the operator applies to the
  // local runtime without touching Docker.
  const [contextTokens, setContextTokens] = useState("");
  const [applyingContext, setApplyingContext] = useState(false);
  const [contextResult, setContextResult] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BI-E06BB38A: technical knobs (raw context window, manual model, Apply/Test)
  // live behind this disclosure so the default view never asks for a token count.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const autoCheckedRef = useRef(false);

  const hasClaudeCreds = claudeProviders.some(p => isConfigured(p.status));
  const hasCodexCreds = codexProviders.some(p => isConfigured(p.status));
  const hasGrokCreds = grokProviders.some(p => isConfigured(p.status));
  const hasOpencodeProvider = opencodeProviders.length > 0;
  const openCodeDescription = describeOpenCodeProvider(opencodeProviderId, opencodeProviders);

  function runEndpointCheck() {
    if (!openCodeDescription.isLocal) {
      setEndpointCheck(null);
      setContextResult(null);
      return;
    }
    setCheckingEndpoint(true);
    setEndpointCheck(null);
    setContextResult(null);
    startTransition(async () => {
      try {
        const result = await checkLocalEndpoint(opencodeModel);
        setEndpointCheck(result);
        // Prefill the context input with the real served size (or the floor) so
        // the operator edits from the truth, not a blank box.
        if (typeof result.servedContextTokens === "number" && result.servedContextTokens > 0) {
          setContextTokens(String(result.servedContextTokens));
        } else if (!contextTokens) {
          setContextTokens("22000");
        }
      } catch (err) {
        setEndpointCheck({ ok: false, resolvedModel: null, models: [], contextOk: false, reason: (err as Error).message, reportedContextTokens: null });
      } finally {
        setCheckingEndpoint(false);
      }
    });
  }

  function applyContext() {
    const model = endpointCheck?.resolvedModel || opencodeModel.trim();
    const tokens = Number(contextTokens);
    setContextResult(null);
    setApplyingContext(true);
    startTransition(async () => {
      try {
        const res = await applyLocalModelContext(model, tokens);
        setContextResult({ ok: res.ok, reason: res.reason });
        if (res.preflight) setEndpointCheck(res.preflight);
      } catch (err) {
        setContextResult({ ok: false, reason: (err as Error).message });
      } finally {
        setApplyingContext(false);
      }
    });
  }

  function handleSave() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await saveBuildStudioConfig({
          provider,
          claudeProviderId,
          codexProviderId,
          grokProviderId,
          opencodeProviderId,
          claudeModel,
          codexModel,
          grokModel,
          opencodeModel,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  // BI-E06BB38A: auto-preflight the local endpoint once when OpenCode is the
  // selected engine, so the default view shows the auto-sized context + model
  // read-only — the operator never has to click "Test" or type a token count.
  useEffect(() => {
    if (provider === "opencode" && hasOpencodeProvider && openCodeDescription.isLocal && !autoCheckedRef.current) {
      autoCheckedRef.current = true;
      runEndpointCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, openCodeDescription.isLocal]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section
        style={{
          background: "var(--dpf-surface-2)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 640 }}>
            <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Runtime Setup
            </div>
            <p style={{ fontSize: 12, color: "var(--dpf-text)", margin: 0 }}>
              {BUILD_STUDIO_CONFIG_ROUTE_COPY.description}
            </p>
          </div>
          <Link
            href={BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioHref}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--dpf-accent)",
              color: "white",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioLabel}
          </Link>
        </div>
      </section>

      <ContributorMcpReadinessCard
        initialReadiness={contributorMcpReadiness}
        baseUrl={baseUrl}
        canWrite={canWrite}
      />

      {/* Section 1: Active CLI Provider */}
      <section style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
        <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Build Dispatch Engine
        </div>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Choose which CLI agent executes build tasks in the sandbox.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ProviderRadio
            name="provider"
            value="claude"
            checked={provider === "claude"}
            onChange={() => setProvider("claude")}
            disabled={!canWrite || !hasClaudeCreds}
            label="Claude Code CLI"
            desc="Anthropic models"
            unconfiguredMsg={!hasClaudeCreds ? "No Anthropic credentials found." : undefined}
            readiness={engineReadiness?.claude}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="codex"
            checked={provider === "codex"}
            onChange={() => setProvider("codex")}
            disabled={!canWrite || !hasCodexCreds}
            label="Codex CLI"
            desc="OpenAI models"
            unconfiguredMsg={!hasCodexCreds ? "No OpenAI credentials found." : undefined}
            readiness={engineReadiness?.codex}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="grok"
            checked={provider === "grok"}
            onChange={() => setProvider("grok")}
            disabled={!canWrite || !hasGrokCreds}
            label="Grok CLI (Preview)"
            desc="xAI models · headless grok -p"
            unconfiguredMsg={!hasGrokCreds ? "No xAI credentials found." : undefined}
            readiness={engineReadiness?.grok}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="opencode"
            checked={provider === "opencode"}
            onChange={() => setProvider("opencode")}
            disabled={!canWrite || !hasOpencodeProvider}
            label={openCodeDescription.label}
            desc={openCodeDescription.desc}
            unconfiguredMsg={!hasOpencodeProvider ? "No OpenCode provider found." : undefined}
            readiness={engineReadiness?.opencode}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="agentic"
            checked={provider === "agentic"}
            onChange={() => setProvider("agentic")}
            disabled={!canWrite}
            label="Agentic Loop (Legacy)"
            desc="Built-in tool-calling loop"
          />
        </div>
        {(provider === "claude" || provider === "codex" || provider === "grok" || provider === "opencode") &&
          engineReadiness?.[provider]?.present === false && (
            <div role="status" style={{ marginTop: 10, fontSize: 11, color: "var(--dpf-warning)" }}>
              ⚠ {provider.charAt(0).toUpperCase() + provider.slice(1)} is selected but not installed in the sandbox —
              builds dispatched to it will fail until you provision it (use the “Provision … in sandbox” button above).
            </div>
          )}
      </section>

      {/* Section 2: Provider Assignments */}
      <section style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
        <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Credential Source
        </div>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Which configured credential should each CLI use for builds?
        </p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <CredentialCard
            title="Claude Code"
            providers={claudeProviders}
            selectedId={claudeProviderId}
            onSelect={setClaudeProviderId}
            active={provider === "claude"}
            canWrite={canWrite}
          />
          <CredentialCard
            title="Codex"
            providers={codexProviders}
            selectedId={codexProviderId}
            onSelect={setCodexProviderId}
            active={provider === "codex"}
            canWrite={canWrite}
          />
          <CredentialCard
            title="Grok"
            providers={grokProviders}
            selectedId={grokProviderId}
            onSelect={setGrokProviderId}
            active={provider === "grok"}
            canWrite={canWrite}
          />
        </div>
      </section>

      {/* Section 3: Model Preferences */}
      {provider !== "agentic" && (
        <section style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
          <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Model Preferences
          </div>

          {provider === "claude" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 4 }}>Claude Code model</p>
              {CLAUDE_MODELS.map(m => (
                <label key={m.value} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)", cursor: canWrite ? "pointer" : "default" }}>
                  <input
                    type="radio"
                    name="claudeModel"
                    value={m.value}
                    checked={claudeModel === m.value}
                    onChange={() => setClaudeModel(m.value)}
                    disabled={!canWrite}
                  />
                  <span>{m.label}</span>
                  <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                    {m.desc}{m.recommended ? " (recommended)" : ""}
                  </span>
                </label>
              ))}
            </div>
          )}

          {provider === "codex" && (
            <div>
              <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 4 }}>Codex model</p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)", marginBottom: 6 }}>
                <input
                  type="radio"
                  name="codexModel"
                  value=""
                  checked={codexModel === ""}
                  onChange={() => setCodexModel("")}
                  disabled={!canWrite}
                />
                Server default (assigned by ChatGPT backend)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)" }}>
                <input
                  type="radio"
                  name="codexModel"
                  value="custom"
                  checked={codexModel !== ""}
                  onChange={() => setCodexModel("o4-mini")}
                  disabled={!canWrite}
                />
                Custom:
                <input
                  type="text"
                  value={codexModel}
                  onChange={e => setCodexModel(e.target.value)}
                  disabled={!canWrite || codexModel === ""}
                  placeholder="o4-mini"
                  style={{
                    width: 120,
                    fontSize: 11,
                    padding: "2px 6px",
                    border: "1px solid var(--dpf-border)",
                    borderRadius: 4,
                    background: "var(--dpf-bg)",
                    color: "var(--dpf-text)",
                  }}
                />
              </label>
            </div>
          )}

          {provider === "grok" && (
            <div>
              <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 4 }}>Grok model</p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)", marginBottom: 6 }}>
                <input
                  type="radio"
                  name="grokModel"
                  value=""
                  checked={grokModel === ""}
                  onChange={() => setGrokModel("")}
                  disabled={!canWrite}
                />
                Server default (assigned by xAI)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)" }}>
                <input
                  type="radio"
                  name="grokModel"
                  value="custom"
                  checked={grokModel !== ""}
                  onChange={() => setGrokModel("grok-build-0.1")}
                  disabled={!canWrite}
                />
                Custom:
                <input
                  type="text"
                  value={grokModel}
                  onChange={e => setGrokModel(e.target.value)}
                  disabled={!canWrite || grokModel === ""}
                  placeholder="grok-build-0.1"
                  style={{
                    width: 140,
                    fontSize: 11,
                    padding: "2px 6px",
                    border: "1px solid var(--dpf-border)",
                    borderRadius: 4,
                    background: "var(--dpf-bg)",
                    color: "var(--dpf-text)",
                  }}
                />
              </label>
            </div>
          )}

          {provider === "opencode" && (
            <div>
              {opencodeProviders.length > 1 && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)", marginBottom: 8 }}>
                  OpenCode provider:
                  <select
                    value={opencodeProviderId}
                    onChange={(e) => setOpencodeProviderId(e.target.value)}
                    disabled={!canWrite}
                    style={{
                      background: "var(--dpf-surface-2)",
                      border: "1px solid var(--dpf-border)",
                      borderRadius: 4,
                      color: "var(--dpf-text)",
                      fontSize: 12,
                      padding: "4px 8px",
                    }}
                  >
                    {opencodeProviders.map((p) => (
                      <option key={p.providerId} value={p.providerId}>{p.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 8 }}>
                {openCodeDescription.isLocal
                  ? "Runs the open-source OpenCode agent against your install's own local model - no API key, nothing leaves your machine. DPF picks a coding model and sizes its context automatically from your hardware."
                  : `Runs the open-source OpenCode agent against ${openCodeDescription.providerName}. It uses the inherited provider credential and the provider's coding endpoint for build tasks.`}
              </p>

              {/* BI-E06BB38A: default view is one plain, read-only readiness line. The
                  context window is auto-derived from the served model — the operator is
                  never asked to type a token count (progressive disclosure, AGENTS.md §12). */}
              <div
                role="status"
                style={{
                  fontSize: 12,
                  color: endpointCheck && !endpointCheck.ok ? "var(--dpf-error)" : "var(--dpf-text)",
                  background: "var(--dpf-surface-2)",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  marginBottom: 8,
                }}
              >
                {!openCodeDescription.isLocal ? (
                  <>
                    OpenCode provider: <strong>{openCodeDescription.providerName}</strong>
                    <span style={{ color: "var(--dpf-muted)" }}> · model {opencodeModel.trim() || "auto"}</span>
                  </>
                ) : checkingEndpoint ? (
                  "Checking your local model…"
                ) : endpointCheck?.ok ? (
                  <>
                    ✓ Ready — <strong>{endpointCheck.resolvedModel}</strong>
                    {typeof endpointCheck.servedContextTokens === "number" && endpointCheck.servedContextTokens > 0 ? (
                      <span style={{ color: "var(--dpf-muted)" }}>
                        {" "}· context {Math.round(endpointCheck.servedContextTokens / 1000)}k — auto-sized
                      </span>
                    ) : (
                      <span style={{ color: "var(--dpf-muted)" }}>{" "}· context auto-sized</span>
                    )}
                  </>
                ) : endpointCheck && !endpointCheck.ok ? (
                  <>⚠ {endpointCheck.reason}</>
                ) : (
                  <>
                    Local model: <strong>auto</strong> — your best coding model · context auto-sized
                  </>
                )}
              </div>
              {/* Non-fatal advisories (e.g. embedding model selected) stay on the default
                  view because they need operator attention. */}
              {openCodeDescription.isLocal && endpointCheck?.warnings?.map((w, i) => (
                <div key={i} role="status" style={{ marginBottom: 6, fontSize: 11, color: "var(--dpf-warning)" }}>
                  ⚠ {w}
                </div>
              ))}

              {openCodeDescription.isLocal && (
                <p style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 8 }}>
                  Running fully offline? Turn on{" "}
                  <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}>
                    local-only inference
                  </Link>{" "}
                  so every build phase stays on local with no silent cloud fallback.
                </p>
              )}

              {/* Advanced: the technical knobs (manual model, raw context window, Apply,
                  Test) live here for the rare operator who needs them — off the default
                  view so non-technical users aren&apos;t asked to type token counts. */}
              {canWrite && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    aria-expanded={showAdvanced}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--dpf-muted)",
                      fontSize: 11,
                      padding: 0,
                      marginBottom: showAdvanced ? 8 : 0,
                    }}
                  >
                    <span>{showAdvanced ? "▾" : "▸"}</span> Advanced
                  </button>
                  {showAdvanced && (
                    <div style={{ borderLeft: "2px solid var(--dpf-border)", paddingLeft: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)" }}>
                        Model:
                        <input
                          type="text"
                          value={opencodeModel}
                          onChange={e => setOpencodeModel(e.target.value)}
                          disabled={!canWrite}
                          placeholder="auto (first coding model)"
                          style={{ width: 200, fontSize: 11, padding: "2px 6px", border: "1px solid var(--dpf-border)", borderRadius: 4, background: "var(--dpf-bg)", color: "var(--dpf-text)" }}
                        />
                      </label>
                      <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: 0 }}>
                        {openCodeDescription.isLocal
                          ? <>Leave blank to use the first <strong>coding</strong> model your endpoint serves (embedding models are skipped). ≥22k context recommended.</>
                          : "Leave blank to use the provider's default coding model for OpenCode dispatch."}
                      </p>
                      {openCodeDescription.isLocal && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)" }}>
                          Context window:
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            value={contextTokens}
                            onChange={e => setContextTokens(e.target.value)}
                            disabled={!canWrite}
                            placeholder="auto"
                            style={{ width: 110, fontSize: 11, padding: "2px 6px", border: "1px solid var(--dpf-border)", borderRadius: 4, background: "var(--dpf-bg)", color: "var(--dpf-text)" }}
                          />
                          <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>tokens</span>
                        </label>
                        <button
                          type="button"
                          onClick={applyContext}
                          disabled={applyingContext || !contextTokens}
                          style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, background: "var(--dpf-surface-2)", color: "var(--dpf-text)", border: "1px solid var(--dpf-border)", borderRadius: 6, cursor: applyingContext ? "wait" : "pointer" }}
                        >
                          {applyingContext ? "Applying…" : "Apply to local runtime"}
                        </button>
                        <button
                          type="button"
                          onClick={runEndpointCheck}
                          disabled={checkingEndpoint}
                          style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, background: "var(--dpf-surface-2)", color: "var(--dpf-text)", border: "1px solid var(--dpf-border)", borderRadius: 6, cursor: checkingEndpoint ? "wait" : "pointer" }}
                        >
                          {checkingEndpoint ? "Checking…" : "Test local endpoint"}
                        </button>
                      </div>
                      )}
                      {contextResult && (
                        <div role="status" style={{ fontSize: 11, color: contextResult.ok ? "var(--dpf-success)" : "var(--dpf-error)" }}>
                          {contextResult.ok
                            ? "✓ Context window applied to the local runtime. It takes effect the next time the model loads."
                            : <>⚠ {contextResult.reason}</>}
                        </div>
                      )}
                      {endpointCheck?.ok && endpointCheck.models.length > 0 && (
                        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                          Models served: {endpointCheck.models.join(", ")}.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* Save button */}
      {canWrite && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleSave}
            disabled={isPending}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              background: "var(--dpf-accent)",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? "Saving..." : "Save Configuration"}
          </button>
          {saved && <span style={{ fontSize: 11, color: "var(--dpf-success)" }}>Saved</span>}
          {error && <span style={{ fontSize: 11, color: "var(--dpf-error)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
