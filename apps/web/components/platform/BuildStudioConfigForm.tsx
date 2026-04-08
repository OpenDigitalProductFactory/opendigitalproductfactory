"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveBuildStudioConfig } from "@/lib/actions/build-studio";
import type { BuildStudioDispatchConfig } from "@/lib/integrate/build-studio-config";

type ProviderOption = {
  providerId: string;
  name: string;
  status: string;
  billingLabel: string | null;
  costNotes: string | null;
};

type Props = {
  config: BuildStudioDispatchConfig;
  claudeProviders: ProviderOption[];
  codexProviders: ProviderOption[];
  canWrite: boolean;
};

// Credential status lifecycle: unconfigured -> pending (on save) -> ok (after OAuth/exchange) -> expired (on failure)
const STATUS_COLORS: Record<string, string> = {
  ok:           "var(--dpf-success)",
  configured:   "var(--dpf-success)",
  pending:      "var(--dpf-warning)",
  unconfigured: "var(--dpf-muted)",
  auth_failed:  "var(--dpf-error)",
  expired:      "var(--dpf-error)",
};

const STATUS_LABELS: Record<string, string> = {
  ok:           "Connected",
  configured:   "Configured",
  pending:      "Credentials saved, not yet verified",
  unconfigured: "Not configured",
  auth_failed:  "Auth failed",
  expired:      "Token expired",
};

const CLAUDE_MODELS = [
  { value: "haiku", label: "Haiku", desc: "fastest, cheapest" },
  { value: "sonnet", label: "Sonnet", desc: "best balance", recommended: true },
  { value: "opus", label: "Opus", desc: "most capable, slower" },
];

const SUBSCRIPTION_PROVIDERS = new Set(["anthropic-sub", "chatgpt"]);

function isConfigured(status: string): boolean {
  return status === "ok" || status === "configured" || status === "pending";
}

export function BuildStudioConfigForm({ config, claudeProviders, codexProviders, canWrite }: Props) {
  const [provider, setProvider] = useState(config.provider);
  const [claudeProviderId, setClaudeProviderId] = useState(config.claudeProviderId);
  const [codexProviderId, setCodexProviderId] = useState(config.codexProviderId);
  const [claudeModel, setClaudeModel] = useState(config.claudeModel);
  const [codexModel, setCodexModel] = useState(config.codexModel);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasClaudeCreds = claudeProviders.some(p => isConfigured(p.status));
  const hasCodexCreds = codexProviders.some(p => isConfigured(p.status));

  function handleSave() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await saveBuildStudioConfig({
          provider,
          claudeProviderId,
          codexProviderId,
          claudeModel,
          codexModel,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Section 1: Active CLI Provider */}
      <section style={{ background: "var(--dpf-card)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
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
      </section>

      {/* Section 2: Provider Assignments */}
      <section style={{ background: "var(--dpf-card)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
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
        </div>
      </section>

      {/* Section 3: Model Preferences */}
      {provider !== "agentic" && (
        <section style={{ background: "var(--dpf-card)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProviderRadio({ name, value, checked, onChange, disabled, label, desc, unconfiguredMsg }: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  label: string;
  desc: string;
  unconfiguredMsg?: string;
}) {
  return (
    <label style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      padding: "8px 10px",
      borderRadius: 6,
      border: checked ? "1px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
      background: checked ? "color-mix(in srgb, var(--dpf-accent) 5%, transparent)" : "transparent",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
    }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{desc}</div>
        {unconfiguredMsg && (
          <div style={{ fontSize: 10, color: "var(--dpf-warning)", marginTop: 2 }}>
            {unconfiguredMsg}{" "}
            <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}>
              Set up in External Services
            </Link>
          </div>
        )}
      </div>
    </label>
  );
}

function CredentialCard({ title, providers, selectedId, onSelect, active, canWrite }: {
  title: string;
  providers: ProviderOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  active: boolean;
  canWrite: boolean;
}) {
  return (
    <div style={{
      flex: "1 1 280px",
      minWidth: 280,
      padding: 12,
      borderRadius: 6,
      border: "1px solid var(--dpf-border)",
      opacity: active ? 1 : 0.5,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 8 }}>{title}</div>

      {providers.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
          No credentials configured.{" "}
          <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}>
            Set up in External Services
          </Link>
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {providers.map(p => {
            const isSubscription = SUBSCRIPTION_PROVIDERS.has(p.providerId);
            const credConfigured = isConfigured(p.status);
            return (
              <label
                key={p.providerId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 4,
                  border: selectedId === p.providerId ? "1px solid var(--dpf-accent)" : "1px solid transparent",
                  cursor: canWrite && credConfigured ? "pointer" : "not-allowed",
                  opacity: credConfigured ? 1 : 0.5,
                }}
              >
                <input
                  type="radio"
                  name={`${title}-cred`}
                  value={p.providerId}
                  checked={selectedId === p.providerId}
                  onChange={() => onSelect(p.providerId)}
                  disabled={!canWrite || !credConfigured}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--dpf-text)" }}>{p.name}</span>
                    {isSubscription && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)",
                        color: "var(--dpf-success)",
                      }}>
                        Recommended
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: STATUS_COLORS[p.status] ?? "var(--dpf-muted)",
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                      {p.providerId} · {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.billingLabel && (
                    <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 2 }}>{p.billingLabel}</div>
                  )}
                  {isSubscription && p.costNotes && (
                    <div style={{ fontSize: 10, color: "var(--dpf-success)", marginTop: 2 }}>{p.costNotes}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <Link href="/platform/ai/providers" style={{ fontSize: 10, color: "var(--dpf-accent)", textDecoration: "underline" }}>
          Manage credentials in External Services
        </Link>
      </div>
    </div>
  );
}
