"use client";

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react";

import {
  copyMyMcpToken,
  issueMyMcpToken,
  issueMyWriteMcpToken,
  listAvailableMcpScopes,
  listMyMcpTokens,
  revokeMyMcpToken,
  rotateMyMcpToken,
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
  tokenSuffix: string;
  canCopy: boolean;
  capability: "read" | "write";
  scope: McpTokenScopeTier;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Issued = {
  mode: "issued" | "rotated" | "copied";
  tokenId: string;
  plaintext: string;
  prefix: string;
  tokenSuffix: string;
  expiresAt: string | null;
  setupSnippets: {
    claudeCode: string;
    codex: string;
    vscode: string;
    syncCommand: string;
    envPowerShell: string;
    runtimeRefreshPowerShell: string;
  };
};

type View =
  | { kind: "idle" }
  | { kind: "form"; error: string | null }
  | { kind: "issued"; payload: Issued };

type Notice = { kind: "success" | "error"; message: string } | null;

function formatDate(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

function isExpired(token: TokenRow): boolean {
  return token.expiresAt != null && new Date(token.expiresAt).getTime() < Date.now();
}

function tokenDisplay(token: TokenRow): string {
  return `${token.prefix}...${token.tokenSuffix ?? token.prefix.slice(-4)}`;
}

function buttonClass(kind: "primary" | "secondary" | "danger" = "secondary"): string {
  if (kind === "primary") {
    return "inline-flex items-center gap-1.5 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
  }
  if (kind === "danger") {
    return "inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--dpf-error)] hover:border-[var(--dpf-error)] disabled:opacity-50";
  }
  return "inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50";
}

function iconClass(): string {
  return "h-3.5 w-3.5";
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function McpTokenManager(props: McpTokenManagerProps) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingTokenId, setPendingTokenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [formName, setFormName] = useState("");
  const [formScope, setFormScope] = useState<McpTokenScopeTier>("read");
  const [formScopes, setFormScopes] = useState<Set<string>>(() => new Set());
  const [formExpires, setFormExpires] = useState<string>("90");

  const defaultScopes = useMemo(() => defaultMcpTokenScopes(scopes), [scopes]);

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
    setNotice(null);
    setView({ kind: "form", error: null });
  }

  function toggleScope(scope: string) {
    setFormScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
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
      setView({ kind: "issued", payload: { ...result, mode: "issued" } });
      refresh();
    });
  }

  function copyCurrentToken(token: TokenRow) {
    setNotice(null);
    setPendingTokenId(token.id);
    startTransition(async () => {
      const result = await copyMyMcpToken({ tokenId: token.id, baseUrl: props.baseUrl });
      setPendingTokenId(null);
      if (!result.ok) {
        setNotice({ kind: "error", message: result.message });
        return;
      }
      const copied = await writeClipboardText(result.plaintext);
      if (!copied) {
        setView({ kind: "issued", payload: { ...result, mode: "copied" } });
        return;
      }
      setNotice({ kind: "success", message: "Current token copied to clipboard." });
    });
  }

  function rotateToken(token: TokenRow) {
    setNotice(null);
    setPendingTokenId(token.id);
    startTransition(async () => {
      const result = await rotateMyMcpToken({ tokenId: token.id, baseUrl: props.baseUrl });
      setPendingTokenId(null);
      if (!result.ok) {
        setNotice({ kind: "error", message: result.message });
        return;
      }
      setView({ kind: "issued", payload: { ...result, mode: "rotated" } });
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
      setView({ kind: "issued", payload: { ...result, mode: "issued" } });
      refresh();
    });
  }

  function revoke(tokenId: string) {
    if (!confirm("Revoke this token? Clients using it will fail on their next MCP call.")) {
      return;
    }
    setNotice(null);
    setPendingTokenId(tokenId);
    startTransition(async () => {
      const result = await revokeMyMcpToken({ tokenId, reason: "revoked from admin UI" });
      setPendingTokenId(null);
      if (!result.ok) {
        setNotice({ kind: "error", message: result.error ?? "Could not revoke token." });
        return;
      }
      setNotice({ kind: "success", message: "Token revoked." });
      refresh();
    });
  }

  function upgradeForCodeIntelligence(tokenId: string) {
    setNotice(null);
    setPendingTokenId(tokenId);
    startTransition(async () => {
      const result = await upgradeMyMcpTokenForCodingAgent({ tokenId });
      setPendingTokenId(null);
      if (!result.ok) {
        setNotice({ kind: "error", message: result.message });
        return;
      }
      setNotice({ kind: "success", message: "Coding-agent scopes enabled." });
      refresh();
    });
  }

  return (
    <section className="mt-6 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <div className="flex flex-col gap-3 border-b border-[var(--dpf-border)] p-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--dpf-text)]">MCP access tokens</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-[var(--dpf-muted)]">
            External coding-agent access for <code>/api/mcp/v1</code>.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={issueWriteToken}
            disabled={pending}
            className={buttonClass("primary")}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Issue write token
          </button>
          <button
            type="button"
            onClick={() => openForm("read")}
            disabled={pending}
            className={buttonClass()}
          >
            <Plus className={iconClass()} aria-hidden="true" />
            Generate token
          </button>
        </div>
      </div>

      <div className="p-5">
        {inlineError && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-error)]">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>{inlineError}</span>
          </div>
        )}

        {notice && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm ${
              notice.kind === "success" ? "text-[var(--dpf-success)]" : "text-[var(--dpf-error)]"
            }`}
          >
            {notice.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{notice.message}</span>
          </div>
        )}

        {tokens.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-5 text-sm text-[var(--dpf-muted)]">
            No MCP tokens have been issued yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {tokens.map((token) => (
              <TokenListItem
                key={token.id}
                token={token}
                pending={pending || pendingTokenId === token.id}
                defaultScopes={defaultScopes}
                onCopy={copyCurrentToken}
                onRotate={rotateToken}
                onRevoke={revoke}
                onUpgrade={upgradeForCodeIntelligence}
              />
            ))}
          </ul>
        )}
      </div>

      {view.kind === "form" && (
        <TokenFormDialog
          error={view.error}
          formExpires={formExpires}
          formName={formName}
          formScope={formScope}
          formScopes={formScopes}
          pending={pending}
          scopes={scopes}
          onCancel={() => setView({ kind: "idle" })}
          onExpiresChange={setFormExpires}
          onNameChange={setFormName}
          onScopeChange={applyScopeDefaults}
          onSubmit={submit}
          onToggleScope={toggleScope}
        />
      )}

      {view.kind === "issued" && (
        <IssuedTokenDialog
          payload={view.payload}
          onClose={() => setView({ kind: "idle" })}
        />
      )}
    </section>
  );
}

function TokenListItem(props: {
  token: TokenRow;
  pending: boolean;
  defaultScopes: string[];
  onCopy: (token: TokenRow) => void;
  onRotate: (token: TokenRow) => void;
  onRevoke: (tokenId: string) => void;
  onUpgrade: (tokenId: string) => void;
}) {
  const { token } = props;
  const revoked = token.revokedAt != null;
  const expired = isExpired(token);
  const disabled = props.pending || revoked || expired;
  const missingCodingScopes = props.defaultScopes.filter((scope) => !token.scopes.includes(scope));

  return (
    <li className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--dpf-text)]">{token.name}</span>
            <code className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-xs text-[var(--dpf-text)]">
              {tokenDisplay(token)}
            </code>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                token.scope !== "read"
                  ? "bg-[var(--dpf-accent)] text-white"
                  : "border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
              }`}
            >
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {token.scope}
            </span>
            {revoked && <StatusPill label="revoked" tone="error" />}
            {expired && !revoked && <StatusPill label="expired" tone="warning" />}
          </div>

          <dl className="mt-2 grid gap-1 text-xs text-[var(--dpf-muted)] md:grid-cols-2">
            <div className="md:col-span-2">
              <dt className="inline font-medium text-[var(--dpf-text)]">Scope: </dt>
              <dd className="inline">{token.scopes.join(", ") || "none"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-[var(--dpf-text)]">Issued: </dt>
              <dd className="inline">{formatDate(token.createdAt)}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-[var(--dpf-text)]">Last used: </dt>
              <dd className="inline">{formatDate(token.lastUsedAt)}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-[var(--dpf-text)]">Expires: </dt>
              <dd className="inline">{formatDate(token.expiresAt)}</dd>
            </div>
          </dl>
        </div>

        {!revoked && (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {!expired && missingCodingScopes.length > 0 && (
              <button
                type="button"
                onClick={() => props.onUpgrade(token.id)}
                disabled={props.pending}
                className={buttonClass()}
              >
                <ShieldCheck className={iconClass()} aria-hidden="true" />
                Enable code intelligence
              </button>
            )}
            <button
              type="button"
              onClick={() => props.onCopy(token)}
              disabled={disabled || !token.canCopy}
              title={token.canCopy ? "Copy current token" : "Legacy tokens must be rotated before they can be copied"}
              className={buttonClass()}
            >
              <Copy className={iconClass()} aria-hidden="true" />
              Copy current token
            </button>
            <button
              type="button"
              onClick={() => props.onRotate(token)}
              disabled={disabled}
              className={buttonClass()}
            >
              <RefreshCw className={iconClass()} aria-hidden="true" />
              Rotate token
            </button>
            <button
              type="button"
              onClick={() => props.onRevoke(token.id)}
              disabled={props.pending}
              className={buttonClass("danger")}
            >
              <Ban className={iconClass()} aria-hidden="true" />
              Revoke
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function StatusPill(props: { label: string; tone: "warning" | "error" }) {
  return (
    <span
      className={`rounded-md border border-[var(--dpf-border)] px-2 py-0.5 text-xs font-medium ${
        props.tone === "warning" ? "text-[var(--dpf-warning)]" : "text-[var(--dpf-error)]"
      }`}
    >
      {props.label}
    </span>
  );
}

function DialogFrame(props: { children: ReactNode; onClose?: () => void }) {
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--dpf-bg) 74%, transparent)" }}
      onClick={props.onClose}
    >
      {props.children}
    </div>
  );
}

function TokenFormDialog(props: {
  error: string | null;
  formExpires: string;
  formName: string;
  formScope: McpTokenScopeTier;
  formScopes: Set<string>;
  pending: boolean;
  scopes: string[];
  onCancel: () => void;
  onExpiresChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onScopeChange: (value: McpTokenScopeTier) => void;
  onSubmit: () => void;
  onToggleScope: (scope: string) => void;
}) {
  return (
    <DialogFrame onClose={props.onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--dpf-text)]">Generate MCP token</h3>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">Choose authority, scopes, and expiry for this client.</p>
          </div>
          <button type="button" onClick={props.onCancel} className={buttonClass()}>
            <X className={iconClass()} aria-hidden="true" />
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-[var(--dpf-text)]">Name</span>
            <input
              type="text"
              value={props.formName}
              onChange={(event) => props.onNameChange(event.target.value)}
              placeholder="Mark laptop"
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
            />
          </label>

          <fieldset className="text-sm">
            <legend className="font-medium text-[var(--dpf-text)]">Scope tier</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(["read", "write", "admin"] as const).map((scope) => (
                <ScopeTierOption
                  key={scope}
                  checked={props.formScope === scope}
                  label={scope}
                  value={scope}
                  onChange={() => props.onScopeChange(scope)}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="text-sm">
            <legend className="font-medium text-[var(--dpf-text)]">Scopes</legend>
            <div className="mt-2 grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 sm:grid-cols-2">
              {props.scopes.map((scope) => (
                <label key={scope} className="inline-flex items-center gap-2 text-xs text-[var(--dpf-text)]">
                  <input
                    type="checkbox"
                    checked={props.formScopes.has(scope)}
                    onChange={() => props.onToggleScope(scope)}
                  />
                  <span className="break-all">{scope}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm">
            <span className="font-medium text-[var(--dpf-text)]">Expires</span>
            <select
              value={props.formExpires}
              onChange={(event) => props.onExpiresChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)]"
            >
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="30">In 30 days</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="60">In 60 days</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="90">In 90 days</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="180">In 180 days</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="never">Never</option>
            </select>
          </label>

          {props.error && (
            <p className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-error)]">
              {props.error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={props.onCancel} className={buttonClass()}>
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={props.pending || !props.formName.trim() || props.formScopes.size === 0}
            className={buttonClass("primary")}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {props.pending ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

function ScopeTierOption(props: {
  checked: boolean;
  label: string;
  value: McpTokenScopeTier;
  onChange: () => void;
}) {
  return (
    <label
      className="flex items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-[var(--dpf-text)]"
    >
      <input
        type="radio"
        name="scope-tier"
        value={props.value}
        checked={props.checked}
        onChange={props.onChange}
      />
      <span className="text-sm">{props.label}</span>
    </label>
  );
}

function IssuedTokenDialog(props: { payload: Issued; onClose: () => void }) {
  const title =
    props.payload.mode === "rotated"
      ? "Replacement token issued"
      : props.payload.mode === "copied"
        ? "Current token"
        : "Token issued";
  const description =
    props.payload.mode === "copied"
      ? "Clipboard access was blocked. Select the current token or setup command below."
      : "Copy the token or refresh payload before closing.";

  return (
    <DialogFrame>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--dpf-text)]">{title}</h3>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">{description}</p>
          </div>
          <button type="button" onClick={props.onClose} className={buttonClass()}>
            <X className={iconClass()} aria-hidden="true" />
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <SnippetBlock
            label="Token"
            value={props.payload.plaintext}
          />
          <SnippetBlock label="Client env" value={props.payload.setupSnippets.envPowerShell} />
          <SnippetBlock label="Session refresh" value={props.payload.setupSnippets.runtimeRefreshPowerShell} />
          <SnippetBlock label="Claude config" value={props.payload.setupSnippets.claudeCode} />
          <SnippetBlock label="Codex config" value={props.payload.setupSnippets.codex} />
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={props.onClose} className={buttonClass("primary")}>
            Done
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

function SnippetBlock(props: { label: string; value: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "blocked">("idle");

  async function copy() {
    const copied = await writeClipboardText(props.value);
    setCopyState(copied ? "copied" : "blocked");
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--dpf-text)]">{props.label}</p>
          {copyState !== "idle" && (
            <p
              className={`mt-0.5 text-xs ${
                copyState === "copied" ? "text-[var(--dpf-success)]" : "text-[var(--dpf-warning)]"
              }`}
            >
              {copyState === "copied" ? "Copied" : "Clipboard blocked"}
            </p>
          )}
        </div>
        <button type="button" onClick={copy} className={buttonClass()}>
          <Copy className={iconClass()} aria-hidden="true" />
          Copy
        </button>
      </div>
      <div className="max-h-32 overflow-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 font-mono text-xs text-[var(--dpf-text)]">
        <code className="break-all whitespace-pre-wrap">{props.value}</code>
      </div>
    </div>
  );
}
