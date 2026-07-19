"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState, useTransition } from "react";

import {
  getMyContributorMcpReadiness,
  issueMyWriteMcpToken,
  rotateMyMcpTokenWithEdit,
  type IssueTokenActionResult,
} from "@/lib/actions/mcp-tokens";
import { LocalTime } from "@/components/ui/LocalTime";
import type {
  ContributorMcpProbe,
  ContributorMcpReadiness,
} from "@/lib/mcp/contributor-readiness";

type Props = {
  initialReadiness: ContributorMcpReadiness;
  baseUrl: string;
  canWrite: boolean;
};

type IssuedPayload = Extract<IssueTokenActionResult, { ok: true }>;

type LocalNotice =
  | { kind: "error"; message: string }
  | { kind: "success"; message: string }
  | null;

function primaryButtonClass(): string {
  return "inline-flex items-center gap-1.5 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
}

function secondaryButtonClass(): string {
  return "inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-50";
}

function iconClass(): string {
  return "h-4 w-4";
}

function statusMessage(readiness: ContributorMcpReadiness): string {
  switch (readiness.status) {
    case "ready":
      return "Claude Code and Codex can use DPF MCP for Build Studio work.";
    case "needs_authorization":
      return "No usable development token yet. Issue a development token to enable Build Studio MCP.";
    case "needs_reissue":
      return "Current token is expired or revoked. Issue a replacement development token.";
    case "needs_grants":
      if (readiness.missingGrants.length === 0) {
        return "Current token is read-only. Rotate it with development write access for Build Studio MCP.";
      }
      return `Current token is missing ${readiness.missingGrants.length} grants needed for Build Studio work.`;
    case "needs_identity_binding":
      return "Token access is not GAID-bound yet. RBAC and token grants still gate the peer.";
  }
}

function primaryActionLabel(readiness: ContributorMcpReadiness): string {
  switch (readiness.recommendedAction) {
    case "test_connection":
      return "Test connection";
    case "issue_development_token":
      return "Issue development token";
    case "rotate_development_token":
      return "Rotate development token";
    case "none":
      return "View details";
  }
}

function probeMessage(probe: ContributorMcpProbe): string | null {
  switch (probe.status) {
    case "success":
      return `Probe returned ${probe.toolCount} MCP tools.`;
    case "failed":
      return `Probe failed: ${probe.message}`;
    case "unavailable":
      return `Probe unavailable: ${probe.message}`;
    case "not_run":
      return null;
  }
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ContributorMcpReadinessCard({
  initialReadiness,
  baseUrl,
  canWrite,
}: Props) {
  const [readiness, setReadiness] = useState(initialReadiness);
  const [issued, setIssued] = useState<IssuedPayload | null>(null);
  const [notice, setNotice] = useState<LocalNotice>(null);
  const [isPending, startTransition] = useTransition();

  const ready = readiness.status === "ready";
  const attention = readiness.status !== "ready";
  const probeCopy = probeMessage(readiness.probe);
  const actionLabel = primaryActionLabel(readiness);
  const disablePrimary =
    isPending ||
    !canWrite ||
    readiness.recommendedAction === "none" ||
    (readiness.recommendedAction === "rotate_development_token" && !readiness.token);

  function runPrimaryAction() {
    setNotice(null);
    setIssued(null);

    if (readiness.recommendedAction === "test_connection") {
      startTransition(async () => {
        const result = await getMyContributorMcpReadiness({ probe: true });
        if (!result.ok) {
          setNotice({ kind: "error", message: "Sign in before testing MCP readiness." });
          return;
        }
        setReadiness(result.readiness);
      });
      return;
    }

    if (readiness.recommendedAction === "issue_development_token") {
      startTransition(async () => {
        const result = await issueMyWriteMcpToken({ baseUrl });
        if (!result.ok) {
          setNotice({ kind: "error", message: result.message });
          return;
        }
        setIssued(result);
        setNotice({
          kind: "success",
          message: "Refresh the running Claude/Codex session before retrying.",
        });
      });
      return;
    }

    if (readiness.recommendedAction === "rotate_development_token" && readiness.token) {
      startTransition(async () => {
        const result = await rotateMyMcpTokenWithEdit({
          tokenId: readiness.token!.id,
          name: readiness.token!.name,
          scope: "write",
          scopes: readiness.recommendedScopes,
          expiresInDays: 90,
          baseUrl,
        });
        if (!result.ok) {
          setNotice({ kind: "error", message: result.message });
          return;
        }
        setIssued(result);
        setNotice({
          kind: "success",
          message: "Refresh the running Claude/Codex session before retrying.",
        });
      });
    }
  }

  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {ready ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--dpf-success)]" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-[var(--dpf-warning)]" aria-hidden="true" />
            )}
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
              Claude/Codex MCP readiness
            </h2>
          </div>
          <p className="mt-1 text-sm leading-5 text-[var(--dpf-text)]">
            {statusMessage(readiness)}
          </p>
          {readiness.token && (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Last used:{" "}
              <LocalTime value={readiness.token.lastUsedAt} fallback="never" /> · Expires:{" "}
              <LocalTime value={readiness.token.expiresAt} fallback="never" />
            </p>
          )}
          {probeCopy && (
            <p
              className={`mt-1 text-xs ${
                readiness.probe.status === "success"
                  ? "text-[var(--dpf-success)]"
                  : "text-[var(--dpf-warning)]"
              }`}
            >
              {probeCopy}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runPrimaryAction}
            disabled={disablePrimary}
            className={attention ? primaryButtonClass() : secondaryButtonClass()}
          >
            {readiness.recommendedAction === "test_connection" ? (
              <RefreshCw className={iconClass()} aria-hidden="true" />
            ) : (
              <ShieldCheck className={iconClass()} aria-hidden="true" />
            )}
            {isPending ? "Working..." : actionLabel}
          </button>
          <Link
            href="/admin/platform-development"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          >
            <KeyRound className={iconClass()} aria-hidden="true" />
            Manage tokens
          </Link>
        </div>
      </div>

      {!canWrite && (
        <div className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-muted)]">
          Token remediation requires provider-management permission.
        </div>
      )}

      {notice && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm ${
            notice.kind === "success" ? "text-[var(--dpf-success)]" : "text-[var(--dpf-error)]"
          }`}
        >
          {notice.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      <details className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-[var(--dpf-text)]">
          <ChevronDown className="h-3.5 w-3.5 text-[var(--dpf-muted)]" aria-hidden="true" />
          Details
        </summary>
        <div className="mt-3 grid gap-3 text-xs text-[var(--dpf-muted)] md:grid-cols-2">
          <ReadinessList title="Required grants" items={readiness.requiredGrants} />
          <ReadinessList
            title="Missing grants"
            items={readiness.missingGrants.length > 0 ? readiness.missingGrants : ["none"]}
          />
          <div>
            <p className="font-medium text-[var(--dpf-text)]">Peer identity</p>
            <p className="mt-1">
              {readiness.identityBinding === "bound"
                ? "GAID-bound"
                : "GAID binding is not available in this slice."}
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--dpf-text)]">Endpoint</p>
            <p className="mt-1 break-all">{baseUrl}/api/mcp/v1</p>
          </div>
        </div>
      </details>

      {issued && <IssuedTokenSetupPanel payload={issued} />}
    </section>
  );
}

function ReadinessList(props: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-medium text-[var(--dpf-text)]">{props.title}</p>
      <p className="mt-1 break-words">{props.items.join(", ")}</p>
    </div>
  );
}

function IssuedTokenSetupPanel(props: { payload: IssuedPayload }) {
  return (
    <div className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-[var(--dpf-success)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">New token issued</h3>
      </div>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        Bind this token to Claude Code and Codex, then refresh the running client session.
      </p>
      <div className="mt-3 space-y-3">
        <SnippetBlock label="Client env" value={props.payload.setupSnippets.envPowerShell} />
        <SnippetBlock
          label="Session refresh"
          value={props.payload.setupSnippets.runtimeRefreshPowerShell}
        />
        <SnippetBlock label="Claude config" value={props.payload.setupSnippets.claudeCode} />
        <SnippetBlock label="Codex config" value={props.payload.setupSnippets.codex} />
      </div>
    </div>
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
        <button type="button" onClick={copy} className={secondaryButtonClass()}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy
        </button>
      </div>
      <div className="max-h-28 overflow-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 font-mono text-xs text-[var(--dpf-text)]">
        <code className="break-all whitespace-pre-wrap">{props.value}</code>
      </div>
    </div>
  );
}
