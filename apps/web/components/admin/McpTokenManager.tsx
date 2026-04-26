"use client";

import { useEffect, useState, useTransition } from "react";

import {
  issueMyMcpToken,
  listAvailableMcpScopes,
  listMyMcpTokens,
  revokeMyMcpToken,
} from "@/lib/actions/mcp-tokens";

export interface McpTokenManagerProps {
  contributionModelConfigured: boolean;
  baseUrl: string;
}

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  capability: "read" | "write";
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Issued = {
  tokenId: string;
  plaintext: string;
  prefix: string;
  expiresAt: string | null;
  setupSnippets: { claudeCode: string; codex: string; vscode: string };
};

type View =
  | { kind: "idle" }
  | { kind: "form"; error: string | null }
  | { kind: "issued"; payload: Issued; activeTab: "claudeCode" | "vscode" | "codex" };

export function McpTokenManager(props: McpTokenManagerProps) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  // Form state
  const [formName, setFormName] = useState("");
  const [formCapability, setFormCapability] = useState<"read" | "write">("read");
  const [formScopes, setFormScopes] = useState<Set<string>>(new Set(["backlog_read"]));
  const [formExpires, setFormExpires] = useState<string>("90");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tokensResult, scopesResult] = await Promise.all([
        listMyMcpTokens(),
        listAvailableMcpScopes(),
      ]);
      if (cancelled) return;
      if (tokensResult.ok) setTokens(tokensResult.tokens);
      setScopes(scopesResult.scopes);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function refresh() {
    startTransition(async () => {
      const result = await listMyMcpTokens();
      if (result.ok) setTokens(result.tokens);
    });
  }

  function openForm() {
    setFormName("");
    setFormCapability("read");
    setFormScopes(new Set(["backlog_read"]));
    setFormExpires("90");
    setView({ kind: "form", error: null });
  }

  function toggleScope(s: string) {
    setFormScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const expiresInDays = formExpires === "never" ? null : parseInt(formExpires, 10);
      const result = await issueMyMcpToken({
        name: formName.trim(),
        capability: formCapability,
        scopes: [...formScopes],
        expiresInDays,
        baseUrl: props.baseUrl,
      });
      if (!result.ok) {
        setView({ kind: "form", error: result.message });
        return;
      }
      setView({ kind: "issued", payload: result, activeTab: "claudeCode" });
      refresh();
    });
  }

  function revoke(tokenId: string) {
    if (!confirm("Revoke this token? Any client using it will be disconnected on next call.")) {
      return;
    }
    startTransition(async () => {
      await revokeMyMcpToken({ tokenId, reason: "revoked from admin UI" });
      refresh();
    });
  }

  return (
    <section className="mt-6 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)]">External Coding Agent Access</h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Personal access tokens for the MCP endpoint at <code>/api/mcp/v1</code>.
            Use these to point Claude Code, Codex CLI, or VS Code MCP at this DPF install.
          </p>
        </div>
        <button
          type="button"
          onClick={openForm}
          disabled={pending}
          className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Generate token
        </button>
      </div>

      {!props.contributionModelConfigured && (
        <div className="mt-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs text-[var(--dpf-muted)]">
          Write-capable tokens require contribution mode to be configured first
          (so any external write that becomes a code contribution is traceable
          to a real GitHub identity). Read-only tokens can issue freely.
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">No tokens yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {tokens.map((t) => {
            const revoked = t.revokedAt != null;
            const expired = t.expiresAt != null && new Date(t.expiresAt).getTime() < Date.now();
            return (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--dpf-text)]">{t.name}</span>
                    <code className="rounded bg-[var(--dpf-surface-1)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
                      {t.prefix}…
                    </code>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        t.capability === "write"
                          ? "bg-[var(--dpf-accent)] text-white"
                          : "border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
                      }`}
                    >
                      {t.capability}
                    </span>
                    {revoked && (
                      <span className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
                        revoked
                      </span>
                    )}
                    {expired && !revoked && (
                      <span className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
                        expired
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[var(--dpf-muted)]">
                    Scopes: {t.scopes.join(", ") || "none"} · Last used:{" "}
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"} ·
                    Expires: {t.expiresAt ? new Date(t.expiresAt).toLocaleString() : "never"}
                  </div>
                </div>
                {!revoked && (
                  <button
                    type="button"
                    onClick={() => revoke(t.id)}
                    disabled={pending}
                    className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {view.kind === "form" && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setView({ kind: "idle" })}
        >
          <div
            className="w-full max-w-md rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-[var(--dpf-text)]">Generate MCP token</h3>

            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-[var(--dpf-text)]">Name</span>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Mark's laptop (Claude Code)"
                  className="mt-1 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)]"
                />
              </label>

              <fieldset className="text-sm">
                <legend className="text-[var(--dpf-text)]">Capability</legend>
                <label className="mt-1 mr-4 inline-flex items-center gap-1.5 text-[var(--dpf-text)]">
                  <input
                    type="radio"
                    name="cap"
                    value="read"
                    checked={formCapability === "read"}
                    onChange={() => setFormCapability("read")}
                  />
                  Read-only
                </label>
                <label
                  className={`mt-1 inline-flex items-center gap-1.5 ${
                    props.contributionModelConfigured
                      ? "text-[var(--dpf-text)]"
                      : "text-[var(--dpf-muted)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="cap"
                    value="write"
                    checked={formCapability === "write"}
                    disabled={!props.contributionModelConfigured}
                    onChange={() => setFormCapability("write")}
                  />
                  Write
                  {!props.contributionModelConfigured && (
                    <span className="text-xs">(configure contribution mode first)</span>
                  )}
                </label>
              </fieldset>

              <fieldset className="text-sm">
                <legend className="text-[var(--dpf-text)]">Scopes</legend>
                <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
                  {scopes.map((s) => (
                    <label key={s} className="inline-flex items-center gap-1.5 text-xs text-[var(--dpf-text)]">
                      <input
                        type="checkbox"
                        checked={formScopes.has(s)}
                        onChange={() => toggleScope(s)}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="block text-sm">
                <span className="text-[var(--dpf-text)]">Expires</span>
                <select
                  value={formExpires}
                  onChange={(e) => setFormExpires(e.target.value)}
                  className="mt-1 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)]"
                >
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="30">In 30 days</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="60">In 60 days</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="90">In 90 days</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="180">In 180 days</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="never">Never</option>
                </select>
              </label>

              {view.error && (
                <p className="text-sm text-[var(--dpf-accent)]">{view.error}</p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setView({ kind: "idle" })}
                className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !formName.trim() || formScopes.size === 0}
                className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view.kind === "issued" && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-2xl rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h3 className="text-base font-semibold text-[var(--dpf-text)]">Token issued — copy now</h3>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              The full secret is shown <strong>once</strong>. After you close this dialog, only the prefix is recoverable.
            </p>

            <div className="mt-3 break-all rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 font-mono text-xs text-[var(--dpf-text)]">
              {view.payload.plaintext}
            </div>

            <div className="mt-5">
              <div className="flex gap-2 border-b border-[var(--dpf-border)]">
                {(["claudeCode", "vscode", "codex"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setView({ kind: "issued", payload: view.payload, activeTab: tab })}
                    className={`px-3 py-1.5 text-xs ${
                      view.activeTab === tab
                        ? "border-b-2 border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                        : "text-[var(--dpf-muted)]"
                    }`}
                  >
                    {tab === "claudeCode" ? "Claude Code" : tab === "vscode" ? "VS Code" : "Codex"}
                  </button>
                ))}
              </div>
              <pre className="mt-2 overflow-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs text-[var(--dpf-text)]">
                {view.payload.setupSnippets[view.activeTab]}
              </pre>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setView({ kind: "idle" })}
                className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
