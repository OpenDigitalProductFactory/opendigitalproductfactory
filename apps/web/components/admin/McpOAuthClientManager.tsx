"use client";

// McpOAuthClientManager — the operator surface for headless MCP clients
// (BI-EDB67A2B; design 2026-08-26 MCP client self-authentication, Slice 2b).
//
// A `client_credentials` client is the headless replacement for a dpfmcp_
// PAT: CI, the local-CI gate, cron and containers have no browser, so their
// authority is granted HERE, once, by an operator — the allowed scopes ARE the
// grant, and the owning human's role still caps every call. The secret is
// shown exactly once; what the client presents on the wire is a short-lived
// access token minted from it, which is what makes it safe to keep in a CI
// secret store.
//
// Sits beside the PAT manager on Admin > Platform Development (decision
// DI-03DA64D1850B) and composes the shared primitives only.

import { Copy, KeyRound, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/Dialog";
import { Surface } from "@/components/ui/Surface";
import { CheckboxField, FormStatus, SubmitButton, TextField } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { Notice } from "@/components/ui/report-kit/Notice";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import {
  createOAuthCredentialsClient,
  listOAuthClients,
  revokeOAuthClient,
  type CreatedCredentialsClient,
  type OAuthClientSummary,
} from "@/lib/actions/oauth-clients";
import { buildCredentialsClientSnippets } from "@/lib/auth/mcp-setup-snippets";
import { PUBLIC_SCOPES, PUBLIC_SCOPE_COPY, type PublicScope } from "@/lib/auth/oauth-scope-map";

type View = { kind: "idle" } | { kind: "form" } | { kind: "issued"; created: CreatedCredentialsClient };

function formatDate(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

const KIND_LABEL: Record<string, string> = {
  credentials: "Headless",
  dcr: "Browser (self-registered)",
  preregistered: "Browser (pre-registered)",
};

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      onClick={async () => {
        setDone(await copyText(value));
        setTimeout(() => setDone(false), 2000);
      }}
      aria-label={`Copy ${label}`}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

export function McpOAuthClientManager() {
  const [clients, setClients] = useState<OAuthClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const [formName, setFormName] = useState("");
  const [formScopes, setFormScopes] = useState<Set<PublicScope>>(() => new Set<PublicScope>(["dpf.read"]));
  const [formError, setFormError] = useState<string | null>(null);

  function refresh() {
    startTransition(async () => {
      const result = await listOAuthClients();
      if (result.ok) {
        setClients(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  useEffect(() => { refresh(); }, []);

  function openForm() {
    setFormName("");
    setFormScopes(new Set<PublicScope>(["dpf.read"]));
    setFormError(null);
    setNotice(null);
    setView({ kind: "form" });
  }

  function toggleScope(scope: PublicScope, checked: boolean) {
    setFormScopes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  function submit() {
    setFormError(null);
    startTransition(async () => {
      const result = await createOAuthCredentialsClient({ clientName: formName, scopes: [...formScopes] });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setView({ kind: "issued", created: result.data });
      refresh();
    });
  }

  async function revoke(client: OAuthClientSummary) {
    const live = client.liveTokenCount;
    if (
      !(await confirmDialog({
        title: "Revoke client",
        message:
          `Revoke "${client.clientName}"? ${live > 0 ? `${live} live access token${live === 1 ? "" : "s"} will stop working immediately.` : "It can no longer mint access tokens."} This cannot be undone; create a new client to replace it.`,
        tone: "danger",
        confirmLabel: "Revoke",
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await revokeOAuthClient({ clientId: client.clientId });
      setNotice(
        result.ok
          ? { kind: "success", message: `Revoked ${client.clientName} (${result.data.revokedTokens} live token${result.data.revokedTokens === 1 ? "" : "s"} revoked).` }
          : { kind: "error", message: result.error },
      );
      refresh();
    });
  }

  const columns: Column<OAuthClientSummary>[] = [
    { key: "name", header: "Client", cell: (row) => <span className="font-medium text-[var(--dpf-text)]">{row.clientName}</span> },
    { key: "id", header: "Client id", mono: true, cell: (row) => row.clientId },
    { key: "kind", header: "Kind", cell: (row) => KIND_LABEL[row.registrationKind] ?? row.registrationKind },
    { key: "scopes", header: "Scopes", cell: (row) => (row.allowedScopes.length ? row.allowedScopes.join(", ") : "consent-time") },
    { key: "lastUsed", header: "Last used", cell: (row) => formatDate(row.lastUsedAt), sortAccessor: (row) => row.lastUsedAt ?? "" },
    { key: "live", header: "Live tokens", align: "right", cell: (row) => row.liveTokenCount },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        row.revokedAt
          ? <StatusBadge intent="neutral" label="Revoked" size="sm" />
          : <StatusBadge intent="success" label="Active" size="sm" />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (row) => (
        row.revokedAt ? null : (
          <Button variant="danger" size="sm" type="button" onClick={() => revoke(row)} aria-label={`Revoke ${row.clientName}`}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Revoke
          </Button>
        )
      ),
    },
  ];

  return (
    <Surface as="section" level={1} padding="md" rounded="lg" className="mt-6" aria-labelledby="mcp-oauth-clients-heading">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 id="mcp-oauth-clients-heading" className="flex items-center gap-2 text-base font-semibold text-[var(--dpf-text)]">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            MCP OAuth clients
          </h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Headless clients for CI, the local-CI gate and other callers with no browser. Each one exchanges its
            secret for short-lived access tokens capped by the scopes you grant here and by your own role.
            Browser clients that authorized themselves are listed too.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={refresh} disabled={pending} aria-label="Refresh clients">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button variant="primary" size="sm" type="button" onClick={openForm} disabled={view.kind === "form"}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create headless client
          </Button>
        </div>
      </div>

      {notice ? (
        <Notice variant={notice.kind} className="mb-3">{notice.message}</Notice>
      ) : null}
      {loadError ? (
        <Notice variant="error" className="mb-3" title="Could not load clients">{loadError}</Notice>
      ) : null}

      {view.kind === "form" ? (
        <Surface level={2} padding="md" rounded="md" className="mb-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            aria-label="Create headless client"
          >
            <TextField
              name="clientName"
              label="Client name"
              value={formName}
              onValueChange={setFormName}
              required
              hint="Where it runs, e.g. “CI runner” or “Mark’s laptop gate”. Shown in this list and on every token it mints."
              autoComplete="off"
              maxLength={120}
            />
            <fieldset className="mt-3">
              <legend className="text-sm font-medium text-[var(--dpf-text)]">What it may do</legend>
              <p className="mb-2 text-xs text-[var(--dpf-muted)]">Grant only what the caller needs. The local-CI gate needs Do governed work.</p>
              <div className="flex flex-col gap-2">
                {PUBLIC_SCOPES.map((scope) => (
                  <CheckboxField
                    key={scope}
                    name={`scope-${scope}`}
                    label={`${PUBLIC_SCOPE_COPY[scope].title} (${scope})`}
                    hint={PUBLIC_SCOPE_COPY[scope].detail}
                    checked={formScopes.has(scope)}
                    onCheckedChange={(checked) => toggleScope(scope, checked)}
                  />
                ))}
              </div>
            </fieldset>
            <FormStatus error={formError} className="mt-3" />
            <div className="mt-3 flex gap-2">
              <SubmitButton pending={pending} pendingLabel="Creating…" disabled={!formName.trim() || formScopes.size === 0}>
                Create client
              </SubmitButton>
              <Button variant="ghost" size="md" type="button" onClick={() => setView({ kind: "idle" })} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {view.kind === "issued" ? (() => {
        const snippets = buildCredentialsClientSnippets(view.created.clientId, view.created.clientSecret);
        return (
          <Surface level={2} padding="md" rounded="md" className="mb-4" role="region" aria-label="New client credentials">
            <Notice variant="warn" title="Copy the secret now — it is shown once">
              The platform keeps only a hash. If it is lost, revoke this client and create another.
            </Notice>
            <dl className="mt-3 grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
              <dt className="text-sm font-medium text-[var(--dpf-text)]">Client id</dt>
              <dd className="break-all font-mono text-sm text-[var(--dpf-text)]">{view.created.clientId}</dd>
              <dd><CopyButton value={view.created.clientId} label="client id" /></dd>
              <dt className="text-sm font-medium text-[var(--dpf-text)]">Client secret</dt>
              <dd className="break-all font-mono text-sm text-[var(--dpf-text)]">{view.created.clientSecret}</dd>
              <dd><CopyButton value={view.created.clientSecret} label="client secret" /></dd>
            </dl>
            <p className="mt-4 text-sm text-[var(--dpf-muted)]">
              Put it where the gate looks — the file <code className="font-mono">{snippets.credentialsFilePath}</code> (one command below), or the two environment variables for a CI secret store.
            </p>
            <div className="mt-2 grid gap-2">
              {[
                { label: "macOS / Linux: write the file", value: snippets.writeFilePosix },
                { label: "Windows PowerShell: write the file", value: snippets.writeFilePowerShell },
                { label: "Environment variables (POSIX)", value: snippets.envPosix },
                { label: "Environment variables (PowerShell)", value: snippets.envPowerShell },
              ].map((entry) => (
                <div key={entry.label} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[var(--dpf-muted)]">{entry.label}</p>
                    <Surface level={1} padding="sm" rounded="md" className="mt-1">
                      <pre className="overflow-x-auto text-xs text-[var(--dpf-text)]">{entry.value}</pre>
                    </Surface>
                  </div>
                  <CopyButton value={entry.value} label={entry.label} />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button variant="secondary" size="sm" type="button" onClick={() => setView({ kind: "idle" })}>
                Done — I have saved it
              </Button>
            </div>
          </Surface>
        );
      })() : null}

      <DataTable
        columns={columns}
        rows={clients}
        getRowKey={(row) => row.clientId}
        loading={loading}
        dense
        ariaLabel="MCP OAuth clients"
        initialSort={{ key: "lastUsed", dir: "desc" }}
        empty={<span>No clients yet. Create a headless client to let the local-CI gate and CI authenticate without a personal token.</span>}
      />
    </Surface>
  );
}
