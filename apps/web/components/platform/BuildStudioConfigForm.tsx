"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { saveBuildStudioConfig, checkLocalEndpoint, applyLocalModelContext } from "@/lib/actions/build-studio";
import { probeBuildEnginesAction } from "@/lib/actions/build-engine-actions";
import type { LocalEndpointPreflight } from "@/lib/build/opencode-dispatch";
import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "./build-studio-route-copy";
import { ContributorMcpReadinessCard } from "./ContributorMcpReadinessCard";
import { ServedContextSummary } from "./ServedContextSummary";
import {
  CredentialCard,
  isConfigured,
  ProviderRadio,
  type EngineReadinessBadge,
} from "./BuildStudioProviderControls";
import { CLAUDE_MODELS, describeBuildEngineSelection, describeOpenCodeProvider, shouldShowPinnedEngineMissingWarning, type BuildStudioConfigFormProps } from "./build-studio-config-form-model";

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
}: BuildStudioConfigFormProps) {
  const [provider, setProvider] = useState(config.provider);
  const [enginePolicy, setEnginePolicy] = useState<"auto" | "pinned">(
    config.enginePolicy === "pinned" ? "pinned" : "auto",
  );
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
  const [showModelAdvanced, setShowModelAdvanced] = useState(false);
  // Tracks the last opencode providerId we preflighted, so switching the
  // selected local provider (e.g. local → Ollama) re-probes the new endpoint
  // instead of showing the previous provider's stale readiness.
  const autoCheckedRef = useRef<string | null>(null);

  // BI-805D01E4: live sandbox readiness for the dispatch engines. Seeded from
  // the server's last-known state (BuildEngineState), then kept fresh by a
  // proactive probe on mount, an explicit "Probe all engines" click, and a
  // re-probe of the selected engine after Save — so the operator sees which
  // engine will actually work BEFORE starting a build, not when it fails
  // mid-flight.
  const engineIds = Object.keys(engineReadiness ?? {});
  const [readiness, setReadiness] = useState<Record<string, EngineReadinessBadge>>(
    engineReadiness ?? {},
  );
  const [probingIds, setProbingIds] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const autoProbedRef = useRef(false);

  async function probeEngines(ids?: string[]) {
    if (!canWrite) return;
    const targets = ids && ids.length > 0 ? ids : engineIds;
    setProbeError(null);
    setProbing(true);
    setProbingIds(targets);
    try {
      const rows = await probeBuildEnginesAction(ids && ids.length > 0 ? ids : undefined);
      setReadiness((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          next[row.engineId] = {
            present: row.present,
            version: row.version,
            lastProbedAt: row.lastProbedAt,
            error: row.error,
          };
        }
        return next;
      });
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : "Could not probe build engines.");
    } finally {
      setProbing(false);
      setProbingIds([]);
    }
  }

  // Per-engine badge for a ProviderRadio: the live readiness plus whether a
  // probe is currently in flight for that engine.
  function badgeFor(id: string): EngineReadinessBadge | undefined {
    const base = readiness[id];
    const isProbing = probingIds.includes(id);
    if (!base && !isProbing) return undefined;
    return {
      present: base?.present ?? null,
      version: base?.version ?? null,
      lastProbedAt: base?.lastProbedAt ?? null,
      error: base?.error ?? null,
      probing: isProbing,
    };
  }

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
        const result = await checkLocalEndpoint(opencodeModel, opencodeProviderId);
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
          enginePolicy,
          pinnedEngine: enginePolicy === "pinned" ? provider : null,
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
        // Re-probe the just-saved engine so its badge reflects the current
        // sandbox after a config change (BI-805D01E4). Agentic has no sandbox
        // binary to probe.
        if (provider !== "agentic") void probeEngines([provider]);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  // BI-E06BB38A: auto-preflight the local endpoint when OpenCode is the
  // selected engine, so the default view shows the auto-sized context + model
  // read-only — the operator never has to click "Test" or type a token count.
  // Re-runs when the selected local provider changes so switching e.g. from the
  // Docker Model Runner provider to a distinct "Ollama" provider probes the new
  // endpoint rather than leaving the previous provider's readiness on screen.
  useEffect(() => {
    if (
      provider === "opencode" &&
      hasOpencodeProvider &&
      openCodeDescription.isLocal &&
      autoCheckedRef.current !== opencodeProviderId
    ) {
      autoCheckedRef.current = opencodeProviderId;
      runEndpointCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, opencodeProviderId, openCodeDescription.isLocal]);

  // BI-805D01E4: proactively probe every dispatch engine once on mount so the
  // config page never shows all engines as "not yet probed" — the operator can
  // pick a known-good engine up front instead of selecting blind and finding
  // out mid-build. Gated on canWrite (a probe runs docker exec in the sandbox).
  useEffect(() => {
    if (canWrite && !autoProbedRef.current && engineIds.length > 0) {
      autoProbedRef.current = true;
      void probeEngines();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite]);

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Build Dispatch Engine
            </div>
            <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
              Auto selects the best healthy engine for each task inside your policy boundaries.
            </p>
          </div>
          {canWrite && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <button
                type="button"
                onClick={() => probeEngines()}
                disabled={probing}
                title="Run a live --version probe of every engine in the sandbox"
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: "var(--dpf-surface-2)",
                  color: "var(--dpf-text)",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 6,
                  cursor: probing ? "wait" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {probing ? "Probing…" : "Probe all engines"}
              </button>
              {probeError && (
                <span role="alert" style={{ fontSize: 10, color: "var(--dpf-error)", maxWidth: "16rem", textAlign: "right" }}>
                  {probeError}
                </span>
              )}
            </div>
          )}
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", border: `1px solid ${enginePolicy === "auto" ? "var(--dpf-accent)" : "var(--dpf-border)"}`, borderRadius: 8, cursor: canWrite ? "pointer" : "default" }}>
          <input
            type="radio"
            name="enginePolicy"
            value="auto"
            checked={enginePolicy === "auto"}
            onChange={() => setEnginePolicy("auto")}
            disabled={!canWrite}
          />
          <span>
            <strong style={{ color: "var(--dpf-text)", fontSize: 12 }}>Auto (recommended)</strong>
            <span style={{ display: "block", color: "var(--dpf-muted)", fontSize: 11, marginTop: 2 }}>
              Selected now: {config.selection?.selected?.engine ?? config.provider}. {describeBuildEngineSelection(config.selection)}
            </span>
            {config.selection && config.selection.fallbackChain.length > 0 && (
              <span style={{ display: "block", color: "var(--dpf-muted)", fontSize: 10, marginTop: 2 }}>
                Fallback: {config.selection.fallbackChain.map((entry) => entry.engine).join(" → ")}
              </span>
            )}
          </span>
        </label>
        <button
          type="button"
          onClick={() => setShowAdvanced((shown) => !shown)}
          aria-expanded={showAdvanced}
          style={{ marginTop: 8, padding: 0, border: 0, background: "transparent", color: "var(--dpf-accent)", fontSize: 11, cursor: "pointer" }}
        >
          {showAdvanced ? "Hide advanced execution policy" : "Advanced execution policy"}
        </button>

        {showAdvanced && <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <p style={{ margin: 0, color: "var(--dpf-warning)", fontSize: 10 }}>
            Hard pinning disables automatic fallback. Use it only for deliberate diagnostics or controlled tests.
          </p>
          <ProviderRadio
            name="provider"
            value="claude"
            checked={provider === "claude"}
            onChange={() => { setProvider("claude"); setEnginePolicy("pinned"); }}
            disabled={!canWrite || !hasClaudeCreds}
            label="Claude Code CLI"
            desc="Anthropic models"
            unconfiguredMsg={!hasClaudeCreds ? "No Anthropic credentials found." : undefined}
            readiness={badgeFor("claude")}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="codex"
            checked={provider === "codex"}
            onChange={() => { setProvider("codex"); setEnginePolicy("pinned"); }}
            disabled={!canWrite || !hasCodexCreds}
            label="Codex CLI"
            desc="OpenAI models"
            unconfiguredMsg={!hasCodexCreds ? "No OpenAI credentials found." : undefined}
            readiness={badgeFor("codex")}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="grok"
            checked={provider === "grok"}
            onChange={() => { setProvider("grok"); setEnginePolicy("pinned"); }}
            disabled={!canWrite || !hasGrokCreds}
            label="Grok CLI (Preview)"
            desc="xAI models · headless grok -p"
            unconfiguredMsg={!hasGrokCreds ? "No xAI credentials found." : undefined}
            readiness={badgeFor("grok")}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="opencode"
            checked={provider === "opencode"}
            onChange={() => { setProvider("opencode"); setEnginePolicy("pinned"); }}
            disabled={!canWrite || !hasOpencodeProvider}
            label={openCodeDescription.label}
            desc={openCodeDescription.desc}
            unconfiguredMsg={!hasOpencodeProvider ? "No OpenCode provider found." : undefined}
            readiness={badgeFor("opencode")}
            canProvision={canWrite}
          />
          <ProviderRadio
            name="provider"
            value="agentic"
            checked={provider === "agentic"}
            onChange={() => { setProvider("agentic"); setEnginePolicy("pinned"); }}
            disabled={!canWrite}
            label="Agentic Loop (Legacy)"
            desc="Built-in tool-calling loop"
          />
        </div>}
        {shouldShowPinnedEngineMissingWarning({
          enginePolicy,
          provider,
          probing: probingIds.includes(provider),
          present: readiness[provider]?.present,
        }) && (
            <div role="status" style={{ marginTop: 10, fontSize: 11, color: "var(--dpf-warning)" }}>
              ⚠ {provider.charAt(0).toUpperCase() + provider.slice(1)} is selected but not installed in the sandbox —
              builds dispatched to it will fail until you provision it (use the “Provision … in sandbox” button above).
              {readiness[provider]?.error && (
                <div style={{ marginTop: 2, color: "var(--dpf-muted)", fontWeight: 400 }}>
                  {readiness[provider]?.error}
                </div>
              )}
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
                    onClick={() => setShowModelAdvanced(v => !v)}
                    aria-expanded={showModelAdvanced}
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
                      marginBottom: showModelAdvanced ? 8 : 0,
                    }}
                  >
                    <span>{showModelAdvanced ? "▾" : "▸"}</span> Advanced
                  </button>
                  {showModelAdvanced && (
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
                      {openCodeDescription.isLocal && <ServedContextSummary refreshKey={endpointCheck} />}
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
