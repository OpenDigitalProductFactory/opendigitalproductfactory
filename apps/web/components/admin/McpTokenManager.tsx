"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState, useTransition } from "react";
import { confirmDialog } from "@/components/ui/Dialog";
import {
  type McpTokenRow as TokenRow,
  useMcpTokenManagerInitialState,
} from "@/lib/mcp/use-token-manager-initial-state";

import {
  bulkRevokeMyMcpTokens,
  copyMyMcpToken,
  getMyContributorMcpReadiness,
  issueMyMcpToken,
  issueMyTemplateMcpToken,
  issueMyWriteMcpToken,
  listActingCoworkerOptions,
  listMyMcpTokens,
  revokeMyMcpToken,
  rotateMyMcpToken,
  rotateMyMcpTokenWithEdit,
  type ActingCoworkerOption,
  type McpTokenTemplateSummary,
  upgradeMyMcpTokenForCodingAgent,
} from "@/lib/actions/mcp-tokens";
import {
  defaultMcpTokenScopes,
  MCP_TOKEN_DEFAULT_STALE_DAYS,
  MCP_TOKEN_REVOKED_ARCHIVE_DAYS,
  type McpTokenScopeTier,
  type McpTokenTemplateId,
} from "@/lib/mcp-token-scopes";
import type { ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";

export interface McpTokenManagerProps {
  baseUrl: string;
}

// Convenience predicate — anything with kind != "operator" is managed by a
// lifecycle hook somewhere (today only the ship phase). The UI uses this
// to suppress manual rotate / revoke / bulk-select controls on rows the
// operator is not supposed to touch by hand.
function isLifecycleManaged(token: TokenRow): boolean {
  return token.kind !== "operator";
}

// Alias the shared constants from mcp-token-scopes for use inside the JSX —
// keeps the source of truth out of "use server" modules per Next.js rules.
const STALE_THRESHOLD_DAYS = MCP_TOKEN_DEFAULT_STALE_DAYS;
const REVOKED_ARCHIVE_DAYS = MCP_TOKEN_REVOKED_ARCHIVE_DAYS;

type Issued = {
  mode: "issued" | "rotated" | "copied" | "rotated-with-edit";
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
  // Surfaced from rotateMyMcpTokenWithEdit when the new token issued OK but
  // the underlying revoke of the old token failed. The operator needs to
  // manually revoke the old row in this case.
  oldTokenRevokeError?: string;
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

function contributorReadinessCopy(readiness: ContributorMcpReadiness): {
  tone: "ready" | "attention";
  message: string;
  guidance: string;
} {
  switch (readiness.status) {
    case "ready":
      return {
        tone: "ready",
        message: "Claude/Codex MCP readiness is satisfied.",
        guidance: "Build Studio can use the current development token.",
      };
    case "needs_grants":
      if (readiness.missingGrants.length === 0) {
        return {
          tone: "attention",
          message: "Development token needs attention: read-only token.",
          guidance: "Use Rotate with edit on the token row to apply development write access.",
        };
      }
      return {
        tone: "attention",
        message: `Development token needs attention: missing ${readiness.missingGrants.length} ${readiness.missingGrants.length === 1 ? "grant" : "grants"}.`,
        guidance: "Use Rotate with edit on the token row to apply the development grant set.",
      };
    case "needs_reissue":
      return {
        tone: "attention",
        message: "Development token needs attention: expired or revoked token.",
        guidance: "Issue a development token to replace the unusable row.",
      };
    case "needs_identity_binding":
      return {
        tone: "attention",
        message: "Development token needs attention: peer identity is not GAID-bound.",
        guidance: "Token grants still gate MCP calls while the identity binding work lands.",
      };
    case "needs_authorization":
      return {
        tone: "attention",
        message: "Development token needs attention: no usable development token.",
        guidance: "Issue a development token above before connecting Claude Code or Codex.",
      };
  }
}

function ContributorReadinessBanner(props: { readiness: ContributorMcpReadiness | null }) {
  if (!props.readiness) return null;

  const copy = contributorReadinessCopy(props.readiness);
  const ready = copy.tone === "ready";

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        {ready ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--dpf-success)]" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--dpf-warning)]" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="font-medium text-[var(--dpf-text)]">{copy.message}</p>
          <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">{copy.guidance}</p>
        </div>
      </div>
      <Link
        href="/platform/ai/build-studio"
        className="shrink-0 text-xs font-medium text-[var(--dpf-accent)] underline-offset-2 hover:underline"
      >
        Build Studio readiness
      </Link>
    </div>
  );
}

export function McpTokenManager(props: McpTokenManagerProps) {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [inlineError, setInlineError] = useState<string | null>(null);
  const {
    archivedCount,
    contributorReadiness,
    formScopes,
    initialLoadPending,
    scopes,
    setArchivedCount,
    setContributorReadiness,
    setFormScopes,
    setTokens,
    templates,
    tokens,
  } = useMcpTokenManagerInitialState(setInlineError);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingTokenId, setPendingTokenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [formName, setFormName] = useState("");
  const [formTemplateId, setFormTemplateId] = useState<McpTokenTemplateId>("development");
  // Acting-coworker binding (BI-B986A18B). Empty string = anonymous, which is
  // the historical behaviour and leaves every Work Room tool refusing the token.
  const [formAgentId, setFormAgentId] = useState<string>("");
  const [actingCoworkers, setActingCoworkers] = useState<ActingCoworkerOption[]>([]);
  const [formScope, setFormScope] = useState<McpTokenScopeTier>("read");
  const [formExpires, setFormExpires] = useState<string>("90");
  // null = "issue new token" mode (default). When set to a tokenId, the
  // form's submit runs rotateMyMcpTokenWithEdit against that token instead
  // — the modal feels like editing the live row but the security model
  // stays immutable (new token issued, old revoked atomically).
  const [formRotateTargetId, setFormRotateTargetId] = useState<string | null>(null);

  // Idle hygiene: filter to stale-only and multi-select for bulk revoke.
  const [staleOnly, setStaleOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Revoked tokens are hidden by default to keep the active-token list
  // legible. Operator toggles this on for triage / cleanup work.
  const [showRevoked, setShowRevoked] = useState(false);
  const defaultScopes = useMemo(() => defaultMcpTokenScopes(scopes), [scopes]);

  function refresh() {
    startTransition(async () => {
      const [tokensResult, readinessResult, coworkerResult] = await Promise.all([
        listMyMcpTokens(),
        getMyContributorMcpReadiness({ probe: false }),
        listActingCoworkerOptions(),
      ]);
      if (tokensResult.ok) {
        setTokens(tokensResult.tokens);
        setArchivedCount(tokensResult.archivedCount);
      }
      if (readinessResult.ok) {
        setContributorReadiness(readinessResult.readiness);
      }
      setActingCoworkers(coworkerResult.options);
    });
  }

  function applyTemplate(templateId: McpTokenTemplateId) {
    setFormTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setFormScope(template.tier);
    if (templateId === "custom") {
      // Preserve whatever the user had ticked; fall back to read defaults
      // if they switched to custom from a clean form.
      setFormScopes((prev) =>
        prev.size > 0 ? prev : new Set(defaultMcpTokenScopes(scopes)),
      );
    } else {
      setFormScopes(new Set(template.grants));
    }
  }

  function openForm(templateId: McpTokenTemplateId = "development") {
    setInlineError(null);
    setFormName("");
    setFormExpires("90");
    setNotice(null);
    setFormTemplateId(templateId);
    setFormRotateTargetId(null);
    const template = templates.find((t) => t.id === templateId);
    if (template && templateId !== "custom") {
      setFormScope(template.tier);
      setFormScopes(new Set(template.grants));
    } else {
      // Custom or templates-not-yet-loaded → fall back to read defaults.
      setFormScope("read");
      setFormScopes(new Set(defaultMcpTokenScopes(scopes)));
    }
    setView({ kind: "form", error: null });
  }

  // Open the same form modal pre-populated with the row's current grants
  // and tier, in Custom mode so the operator sees the flat checkbox picker
  // and can add/remove grants. Submit branches to rotateMyMcpTokenWithEdit
  // so the underlying McpToken row stays immutable — new token issued, old
  // revoked atomically.
  function openRotateWithEditForm(token: TokenRow) {
    setInlineError(null);
    setNotice(null);
    setFormName(token.name);
    setFormExpires("90");
    setFormTemplateId("custom");
    setFormScope(token.scope);
    setFormScopes(new Set(token.scopes));
    setFormRotateTargetId(token.id);
    setView({ kind: "form", error: null });
  }

  function toggleScope(scope: string) {
    setFormScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
    // Manually toggling a scope means the operator has diverged from the
    // template — drop them into "custom" so the picker label stays honest.
    setFormTemplateId("custom");
  }

  function submit() {
    startTransition(async () => {
      const expiresInDays = formExpires === "never" ? null : parseInt(formExpires, 10);

      // Rotate-with-edit branch: the form was opened against an existing
      // row. Issue new + revoke old via the dedicated action so the
      // operator sees a single atomic outcome.
      if (formRotateTargetId != null) {
        const result = await rotateMyMcpTokenWithEdit({
          tokenId: formRotateTargetId,
          name: formName.trim(),
          scope: formScope,
          scopes: [...formScopes],
          expiresInDays,
          baseUrl: props.baseUrl,
        });
        if (!result.ok) {
          setView({ kind: "form", error: result.message });
          return;
        }
        setView({
          kind: "issued",
          payload: {
            ...result,
            mode: "rotated-with-edit",
            oldTokenRevokeError: result.oldTokenRevokeError,
          },
        });
        refresh();
        return;
      }

      if (formTemplateId !== "custom") {
        const result = await issueMyTemplateMcpToken({
          templateId: formTemplateId,
          name: formName.trim(),
          expiresInDays,
          agentId: formAgentId || null,
          baseUrl: props.baseUrl,
        });
        if (!result.ok) {
          setView({ kind: "form", error: result.message });
          return;
        }
        setView({ kind: "issued", payload: { ...result, mode: "issued" } });
        refresh();
        return;
      }
      const result = await issueMyMcpToken({
        name: formName.trim(),
        capability: formScope === "read" ? "read" : "write",
        scope: formScope,
        scopes: [...formScopes],
        expiresInDays,
        agentId: formAgentId || null,
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

  async function revoke(tokenId: string) {
    if (
      !(await confirmDialog({
        title: "Revoke token",
        message: "Revoke this token? Clients using it will fail on their next MCP call.",
        tone: "danger",
        confirmLabel: "Revoke",
      }))
    ) {
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

  function isActive(token: TokenRow): boolean {
    return token.revokedAt == null && !isExpired(token);
  }

  function isStale(token: TokenRow): boolean {
    if (!isActive(token)) return false;
    // Never-used tokens that are also older than the threshold count as
    // stale — issued but never picked up by anything.
    if (token.idleDays != null) return token.idleDays >= STALE_THRESHOLD_DAYS;
    const createdAt = new Date(token.createdAt).getTime();
    return Date.now() - createdAt >= STALE_THRESHOLD_DAYS * 86_400_000;
  }

  function toggleSelect(tokenId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tokenId)) next.delete(tokenId);
      else next.add(tokenId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkRevokeSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (
      !(await confirmDialog({
        title: "Revoke tokens",
        message: `Revoke ${ids.length} token${ids.length === 1 ? "" : "s"}? Clients using them will fail on their next MCP call.`,
        tone: "danger",
        confirmLabel: "Revoke",
      }))
    ) {
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const result = await bulkRevokeMyMcpTokens({
        tokenIds: ids,
        reason: "bulk revoke from admin UI",
      });
      if (!result.ok) {
        setNotice({ kind: "error", message: result.error });
        return;
      }
      const parts = [`${result.revokedCount} revoked`];
      if (result.failedCount > 0) parts.push(`${result.failedCount} failed`);
      setNotice({
        kind: result.failedCount > 0 ? "error" : "success",
        message: parts.join(", ") + ".",
      });
      clearSelection();
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
    <section
      aria-busy={initialLoadPending || undefined}
      data-dpf-ux-settle={initialLoadPending ? "pending" : undefined}
      className="mt-6 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--dpf-border)] p-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--dpf-text)]">MCP access tokens</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-[var(--dpf-muted)]">
            External coding-agent access for <code>/api/mcp/v1</code>. Pick a
            role template (Admin, Development, Employee, Observer) or compose
            a custom grant set.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={issueWriteToken}
            disabled={pending}
            className={buttonClass("primary")}
            title="One-click: issues a development-template token (read code/specs, write backlog/workrooms, sandbox + iac_execute) valid for 90 days."
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Issue development token
          </button>
          <button
            type="button"
            onClick={() => openForm("development")}
            disabled={pending}
            className={buttonClass()}
          >
            <Plus className={iconClass()} aria-hidden="true" />
            Issue token from template
          </button>
        </div>
      </div>

      <div className="p-5">
        <ContributorReadinessBanner readiness={contributorReadiness} />

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
          <TokenList
            tokens={tokens}
            pending={pending}
            pendingTokenId={pendingTokenId}
            defaultScopes={defaultScopes}
            selectedIds={selectedIds}
            staleOnly={staleOnly}
            showRevoked={showRevoked}
            archivedCount={archivedCount}
            onCopy={copyCurrentToken}
            onRotate={rotateToken}
            onRotateWithEdit={openRotateWithEditForm}
            onRevoke={revoke}
            onUpgrade={upgradeForCodeIntelligence}
            onToggleSelect={toggleSelect}
            onToggleStaleOnly={() => setStaleOnly((v) => !v)}
            onToggleShowRevoked={() => setShowRevoked((v) => !v)}
            onBulkRevoke={bulkRevokeSelected}
            onClearSelection={clearSelection}
            isActive={isActive}
            isStale={isStale}
          />
        )}
      </div>

      {view.kind === "form" && (
        <TokenFormDialog
          error={view.error}
          formExpires={formExpires}
          formName={formName}
          formScope={formScope}
          formScopes={formScopes}
          formTemplateId={formTemplateId}
          formAgentId={formAgentId}
          actingCoworkers={actingCoworkers}
          rotateTargetId={formRotateTargetId}
          pending={pending}
          scopes={scopes}
          templates={templates}
          onCancel={() => setView({ kind: "idle" })}
          onExpiresChange={setFormExpires}
          onNameChange={setFormName}
          onSubmit={submit}
          onTemplateChange={applyTemplate}
          onAgentChange={setFormAgentId}
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

function TokenList(props: {
  tokens: TokenRow[];
  pending: boolean;
  pendingTokenId: string | null;
  defaultScopes: string[];
  selectedIds: Set<string>;
  staleOnly: boolean;
  showRevoked: boolean;
  archivedCount: number;
  onCopy: (token: TokenRow) => void;
  onRotate: (token: TokenRow) => void;
  onRotateWithEdit: (token: TokenRow) => void;
  onRevoke: (tokenId: string) => void;
  onUpgrade: (tokenId: string) => void;
  onToggleSelect: (tokenId: string) => void;
  onToggleStaleOnly: () => void;
  onToggleShowRevoked: () => void;
  onBulkRevoke: () => void;
  onClearSelection: () => void;
  isActive: (token: TokenRow) => boolean;
  isStale: (token: TokenRow) => boolean;
}) {
  const revokedCount = props.tokens.filter((t) => t.revokedAt != null).length;
  const staleCount = props.tokens.filter(props.isStale).length;
  // Filter chain: hide-revoked first (default), then stale-only.
  let visible = props.showRevoked
    ? props.tokens
    : props.tokens.filter((t) => t.revokedAt == null);
  if (props.staleOnly) visible = visible.filter(props.isStale);
  const selectedCount = props.selectedIds.size;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--dpf-text)]">
            <input
              type="checkbox"
              checked={props.staleOnly}
              onChange={props.onToggleStaleOnly}
              aria-label={`Show only tokens idle for at least ${STALE_THRESHOLD_DAYS} days`}
            />
            <Clock className="h-3.5 w-3.5 text-[var(--dpf-muted)]" aria-hidden="true" />
            <span>
              Show stale only
              <span className="ml-1 text-xs text-[var(--dpf-muted)]">
                (≥ {STALE_THRESHOLD_DAYS} days idle — {staleCount} of {props.tokens.length})
              </span>
            </span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--dpf-text)]">
            <input
              type="checkbox"
              checked={props.showRevoked}
              onChange={props.onToggleShowRevoked}
              aria-label="Show revoked tokens"
            />
            <Ban className="h-3.5 w-3.5 text-[var(--dpf-muted)]" aria-hidden="true" />
            <span>
              Show revoked
              <span className="ml-1 text-xs text-[var(--dpf-muted)]">
                ({revokedCount} hidden by default)
              </span>
            </span>
          </label>
        </div>
        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--dpf-muted)]">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={props.onClearSelection}
              disabled={props.pending}
              className={buttonClass()}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={props.onBulkRevoke}
              disabled={props.pending}
              className={buttonClass("danger")}
            >
              <Ban className={iconClass()} aria-hidden="true" />
              Revoke {selectedCount} selected
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-5 text-sm text-[var(--dpf-muted)]">
          {props.staleOnly
            ? `No tokens are idle for ${STALE_THRESHOLD_DAYS}+ days. Uncheck "Show stale only" to see all tokens.`
            : !props.showRevoked && revokedCount > 0
              ? `All ${revokedCount} of your tokens are revoked. Toggle "Show revoked" above to view them.`
              : "No MCP tokens have been issued yet."}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((token) => (
            <TokenListItem
              key={token.id}
              token={token}
              pending={props.pending || props.pendingTokenId === token.id}
              defaultScopes={props.defaultScopes}
              selected={props.selectedIds.has(token.id)}
              selectable={props.isActive(token)}
              stale={props.isStale(token)}
              onToggleSelect={props.onToggleSelect}
              onCopy={props.onCopy}
              onRotate={props.onRotate}
              onRotateWithEdit={props.onRotateWithEdit}
              onRevoke={props.onRevoke}
              onUpgrade={props.onUpgrade}
            />
          ))}
        </ul>
      )}

      {props.archivedCount > 0 && (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          <strong>{props.archivedCount}</strong>{" "}
          {props.archivedCount === 1 ? "token" : "tokens"} auto-archived
          (revoked &gt; {REVOKED_ARCHIVE_DAYS} days). They remain in the
          database for audit FK integrity and are queryable via{" "}
          <code>/platform/ai/authority</code>; hidden from this list to keep
          it legible.
        </p>
      )}
    </div>
  );
}

function TokenListItem(props: {
  token: TokenRow;
  pending: boolean;
  defaultScopes: string[];
  selected: boolean;
  selectable: boolean;
  stale: boolean;
  onToggleSelect: (tokenId: string) => void;
  onCopy: (token: TokenRow) => void;
  onRotate: (token: TokenRow) => void;
  onRotateWithEdit: (token: TokenRow) => void;
  onRevoke: (tokenId: string) => void;
  onUpgrade: (tokenId: string) => void;
}) {
  const { token } = props;
  const revoked = token.revokedAt != null;
  const expired = isExpired(token);
  const disabled = props.pending || revoked || expired;
  const lifecycleManaged = isLifecycleManaged(token);
  const missingCodingScopes = props.defaultScopes.filter((scope) => !token.scopes.includes(scope));

  return (
    <li className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          {/* Lifecycle-managed rows (ephemeral_ship, etc) are never
              selectable for bulk revoke — they're owned by the phase
              transition hook and the operator shouldn't fight it. */}
          {props.selectable && !lifecycleManaged && (
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={props.selected}
              onChange={() => props.onToggleSelect(token.id)}
              disabled={props.pending}
              aria-label={`Select token ${token.name} for bulk revoke`}
            />
          )}
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
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                token.agentId
                  ? "border border-[var(--dpf-border)] text-[var(--dpf-text)]"
                  : "border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
              }`}
              title={
                token.agentId
                  ? `Acts as ${token.agentId}. Can join Work Rooms it is admitted to.`
                  : "No acting coworker. Work Room tools refuse this token."
              }
            >
              {token.agentId ?? "no coworker"}
            </span>
            {token.kind === "ephemeral_ship" && (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-xs font-medium text-[var(--dpf-accent)]"
                title={
                  token.buildId
                    ? `Auto-issued for ship phase of FeatureBuild ${token.buildId}. Auto-revokes on phase exit.`
                    : "Auto-managed by Build Studio ship-phase lifecycle."
                }
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                ephemeral
                {token.buildId && (
                  <span className="font-mono opacity-80">· {token.buildId.slice(-8)}</span>
                )}
              </span>
            )}
            {revoked && <StatusPill label="revoked" tone="error" />}
            {expired && !revoked && <StatusPill label="expired" tone="warning" />}
            {props.stale && (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-warning)] px-2 py-0.5 text-xs font-medium text-[var(--dpf-warning)]"
                title={`Idle ${formatIdle(token)} — exceeds ${STALE_THRESHOLD_DAYS}-day threshold`}
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                stale {formatIdle(token)}
              </span>
            )}
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
              <dd className="inline">
                {formatDate(token.lastUsedAt)}
                {token.idleDays != null && (
                  <span className="ml-1 text-[var(--dpf-muted)]">
                    ({token.idleDays === 0 ? "today" : `${token.idleDays}d idle`})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-[var(--dpf-text)]">Expires: </dt>
              <dd className="inline">{formatDate(token.expiresAt)}</dd>
            </div>
          </dl>
          </div>
        </div>

        {!revoked && !lifecycleManaged && (
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
              title="Issue a new token with the SAME grants, revoke this one"
              className={buttonClass()}
            >
              <RefreshCw className={iconClass()} aria-hidden="true" />
              Rotate token
            </button>
            <button
              type="button"
              onClick={() => props.onRotateWithEdit(token)}
              disabled={disabled}
              title="Open this token's grants in the form for editing, then issue + revoke atomically"
              className={buttonClass()}
            >
              <RefreshCw className={iconClass()} aria-hidden="true" />
              Rotate with edit
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
        {!revoked && lifecycleManaged && (
          <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--dpf-muted)] lg:justify-end">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              Lifecycle-managed — auto-revokes on ship-phase exit
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

// Human-readable idle duration for the stale pill. Falls back to
// "never used" for tokens with no lastUsedAt — the stale predicate already
// gated whether to show this, so we only need a short label.
function formatIdle(token: TokenRow): string {
  if (token.idleDays == null) return "never used";
  return token.idleDays === 1 ? "1d" : `${token.idleDays}d`;
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
  formTemplateId: McpTokenTemplateId;
  formAgentId: string;
  actingCoworkers: ActingCoworkerOption[];
  rotateTargetId: string | null;
  pending: boolean;
  scopes: string[];
  templates: McpTokenTemplateSummary[];
  onCancel: () => void;
  onExpiresChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onTemplateChange: (value: McpTokenTemplateId) => void;
  onAgentChange: (value: string) => void;
  onToggleScope: (scope: string) => void;
}) {
  const activeTemplate = props.templates.find((t) => t.id === props.formTemplateId);
  const showCustomGrants = props.formTemplateId === "custom";
  const groupedTemplates = useMemo(() => groupTemplatesByCategory(props.templates), [props.templates]);
  const isRotateMode = props.rotateTargetId != null;

  return (
    <DialogFrame onClose={props.onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-xl rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--dpf-text)]">
              {isRotateMode ? "Rotate token with edited grants" : "Issue MCP token"}
            </h3>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              {isRotateMode
                ? "Add or remove grants. On submit, a new token is issued with these grants and the original token is revoked — atomically."
                : "Pick the role this token is for. Grants and audit tier come from the template; switch to Custom to compose them by hand."}
            </p>
          </div>
          <button type="button" onClick={props.onCancel} className={buttonClass()}>
            <X className={iconClass()} aria-hidden="true" />
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-[var(--dpf-text)]">Role template</span>
            <select
              value={props.formTemplateId}
              onChange={(event) => props.onTemplateChange(event.target.value as McpTokenTemplateId)}
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)]"
            >
              {groupedTemplates.map((group) => (
                <optgroup
                  key={group.category}
                  label={categoryLabel(group.category)}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {group.templates.map((template) => (
                    <option
                      key={template.id}
                      value={template.id}
                      className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                    >
                      {template.label} ({template.tier})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-[var(--dpf-text)]">Acts as coworker</span>
            <select
              value={props.formAgentId}
              onChange={(event) => props.onAgentChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)]"
            >
              <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                None — cannot join Work Rooms
              </option>
              {props.actingCoworkers.map((option) => (
                <option
                  key={option.agentId}
                  value={option.agentId}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--dpf-muted)]">
              Pick the coworker this token speaks as. Work Room tools need one — a
              token with none is refused. It grants identity, not room access:
              each room still admits people and coworkers one at a time.
            </span>
            {activeTemplate && (
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">{activeTemplate.description}</p>
            )}
          </label>

          {!showCustomGrants && activeTemplate && (
            <fieldset className="text-sm">
              <legend className="font-medium text-[var(--dpf-text)]">
                Grants ({activeTemplate.grants.length})
              </legend>
              <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
                {activeTemplate.grants.length === 0 ? (
                  <span className="text-xs text-[var(--dpf-muted)]">
                    No grants from this template are registered on this install.
                  </span>
                ) : (
                  activeTemplate.grants.map((grant) => (
                    <span
                      key={grant}
                      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 font-mono text-[11px] text-[var(--dpf-text)]"
                    >
                      {grant}
                    </span>
                  ))
                )}
              </div>
            </fieldset>
          )}

          {showCustomGrants && (
            <fieldset className="text-sm">
              <legend className="font-medium text-[var(--dpf-text)]">
                Scopes ({props.formScopes.size} selected)
              </legend>
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
          )}

          <label className="block text-sm">
            <span className="font-medium text-[var(--dpf-text)]">Name</span>
            <input
              type="text"
              value={props.formName}
              onChange={(event) => props.onNameChange(event.target.value)}
              placeholder={activeTemplate?.label ?? "Mark laptop"}
              className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
            />
          </label>

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
            disabled={
              props.pending ||
              (showCustomGrants && props.formScopes.size === 0) ||
              (!showCustomGrants && (activeTemplate?.grants.length ?? 0) === 0)
            }
            className={buttonClass("primary")}
          >
            {isRotateMode ? (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            )}
            {props.pending
              ? isRotateMode ? "Rotating..." : "Generating..."
              : isRotateMode ? "Rotate with edit" : "Issue token"}
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

function categoryLabel(category: McpTokenTemplateSummary["category"]): string {
  switch (category) {
    case "admin":
      return "Admin";
    case "development":
      return "Development";
    case "employee":
      return "Employee surfaces";
    case "observer":
      return "Observers";
    case "custom":
      return "Custom";
  }
}

function groupTemplatesByCategory(
  templates: McpTokenTemplateSummary[],
): Array<{ category: McpTokenTemplateSummary["category"]; templates: McpTokenTemplateSummary[] }> {
  const order: McpTokenTemplateSummary["category"][] = [
    "admin",
    "development",
    "employee",
    "observer",
    "custom",
  ];
  return order
    .map((category) => ({
      category,
      templates: templates.filter((t) => t.category === category),
    }))
    .filter((g) => g.templates.length > 0);
}

function IssuedTokenDialog(props: { payload: Issued; onClose: () => void }) {
  const title =
    props.payload.mode === "rotated"
      ? "Replacement token issued"
      : props.payload.mode === "rotated-with-edit"
        ? "Rotated with edited grants"
        : props.payload.mode === "copied"
          ? "Current token"
          : "Token issued";
  const description =
    props.payload.mode === "copied"
      ? "Clipboard access was blocked. Select the current token or setup command below."
      : props.payload.mode === "rotated-with-edit"
        ? "New token is live with the edited grants. The original token has been revoked. Copy the plaintext below before closing — you won't see it again."
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

        {props.payload.oldTokenRevokeError && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-warning)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">New token issued, but old token revoke failed.</p>
              <p className="mt-1 text-xs">
                Reason: <code>{props.payload.oldTokenRevokeError}</code>. The new token below is live; manually revoke the original row from the token list to complete the rotation.
              </p>
            </div>
          </div>
        )}

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
