"use client";

import { useEffect, useState, useTransition } from "react";

import {
  issueMyMcpToken,
  issueMyWriteMcpToken,
  listAvailableMcpScopes,
  listMyMcpTokens,
  revokeMyMcpToken,
  upgradeMyMcpTokenForCodingAgent,
} from "@/lib/actions/mcp-tokens";
import {
  defaultMcpTokenScopes,
  type McpTokenScopeTier,
} from "@/lib/mcp-token-scopes";

export interface McpTokenManagerProps {
  baseUrl: string;
}

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  capability: "read" | "write";
  scope: McpTokenScopeTier;
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
  setupSnippets: { claudeCode: string; codex: string; vscode: string; syncCommand: string };
};

type View =
  | { kind: "idle" }
  | { kind: "form"; error: string | null }
  | { kind: "issued"; payload: Issued };

export function McpTokenManager(props: McpTokenManagerProps) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Form state
  const [formName, setFormName] = useState("");
  const [formScope, setFormScope] = useState<McpTokenScopeTier>("read");
  const [formScopes, setFormScopes] = useState<Set<string>>(() => new Set());
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
      const availableScopes = scopesResult.scopes;
      setScopes(availableScopes);
      setFormScopes((current) =>
        current.size > 0 ? current : new Set(defaultMcpTokenScopes(availableScopes)),
      );
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

  function applyScopeDefaults(scope: McpTokenScopeTier) {
    setFormScope(scope);
    setFormScopes(new Set(defaultMcpTokenScopes(scopes, scope)));
  }

  function openForm(scope: McpTokenScopeTier = "read") {
    setInlineError(null);
    setFormName("");
    setFormScope(scope);
    setFormScopes(new Set(defaultMcpTokenScopes(scopes, scope)));
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
        capability: formScope === "read" ? "read" : "write",
        scope: formScope,
        scopes: [...formScopes],
        expiresInDays,
        baseUrl: props.baseUrl,
      });
      if (!result.ok) {
        setView({ kind: "form", error: result.message });
        return;
      }
      setView({ kind: "issued", payload: result });
      refresh();
    });
  }

  function issueWriteToken() {
    setInlineError(null);
    startTransition(async () => {
      const result = await issueMyWriteMcpToken({
        baseUrl: props.baseUrl,
      });
      if (!result.ok) {
        setInlineError(result.message);
        return;
      }
      setView({ kind: "issued", payload: result });
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

  function upgradeForCodeIntelligence(tokenId: string) {
    startTransition(async () => {
      await upgradeMyMcpTokenForCodingAgent({ tokenId });
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={issueWriteToken}
            disabled={pending}
            className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Issue write token
          </button>
          <button
            type="button"
            onClick={() => openForm("read")}
            disabled={pending}
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
          >
            Generate token
          </button>
        </div>
      </div>

      {inlineError && (
        <div className="mt-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs text-[var(--dpf-accent)]">
          {inlineError}
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">No tokens yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {tokens.map((t) => {
            const revoked = t.revokedAt != null;
            const expired = t.expiresAt != null && new Date(t.expiresAt).getTime() < Date.now();
            const missingCodingScopes = defaultMcpTokenScopes(scopes).filter((scope) => !t.scopes.includes(scope));
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
                        t.scope !== "read"
                          ? "bg-[var(--dpf-accent)] text-white"
                          : "border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
                      }`}
                    >
                      {t.scope}
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
                  <div className="flex shrink-0 items-center gap-2">
                    {!expired && missingCodingScopes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => upgradeForCodeIntelligence(t.id)}
                        disabled={pending}
                        className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                      >
                        Enable code intelligence
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => revoke(t.id)}
                      disabled={pending}
                      className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "color-mix(in srgb, var(--dpf-text) 55%, transparent)" }}
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
                <legend className="text-[var(--dpf-text)]">Token scope</legend>
                <div className="mt-1 grid grid-cols-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-1">
                  {(["read", "write", "admin"] as const).map((scope) => (
                    <label
                      key={scope}
                      className={`flex cursor-pointer items-center justify-center rounded px-2 py-1.5 text-xs font-medium ${
                        formScope === scope
                          ? "bg-[var(--dpf-accent)] text-white"
                          : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="scope"
                        value={scope}
                        checked={formScope === scope}
                        onChange={() => applyScopeDefaults(scope)}
                        className="sr-only"
                      />
                      {scope}
                    </label>
                  ))}
                </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "color-mix(in srgb, var(--dpf-text) 55%, transparent)" }}
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
              <p className="mb-1 text-xs font-medium text-[var(--dpf-text)]">
                Run this command to configure Claude Code automatically:
              </p>
              <div className="flex items-start gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
                <code className="flex-1 break-all text-xs text-[var(--dpf-text)]">
                  {view.payload.setupSnippets.syncCommand}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(view.payload.setupSnippets.syncCommand)}
                  className="shrink-0 rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                >
                  Copy
                </button>
              </div>
              <p className="mt-2 text-xs text-[var(--dpf-muted)]">
                Restart Claude Code after running the command for it to pick up the new token.
              </p>
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
