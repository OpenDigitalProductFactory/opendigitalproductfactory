"use client";

import { useState, useTransition } from "react";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/report-kit";

import {
  FleetHealthSummary,
  HealthBadge,
  MainInstallationReadiness,
  NEXT_ACTION_LABELS,
  formatHeartbeatAge,
  type EdgeFleetNode,
  type MainInstallationStatus,
} from "./EdgeFleetReadiness";

import {
  approveEdgeNodeAction,
  issueEdgeBootstrapTokenAction,
  prepareRemoteEdgeProvisioningAction,
  quarantineEdgeNodeAction,
  revokeEdgeNodeAction,
} from "@/lib/actions/edge-nodes";
import type {
  EdgeHostOs,
  RemoteProvisioningPlan,
} from "@/lib/edge-node/remote-provisioning";
type EdgeNodeRow = EdgeFleetNode & {
  id: string;
  nodeId: string;
  platform: string;
  installMode: string;
  version: string;
  status: string;
  trustState: string;
  lastSeenAt: string | null;
  enrolledAt: string | null;
  approvedAt: string | null;
  quarantinedAt: string | null;
  quarantineReason: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  displayName: string;
  capabilities: string[];
  hostHostname: string | null;
  hostIpAddresses: string[] | null;
  customerAccountId: string | null;
  customerAccountName: string | null;
  customerSiteId: string | null;
  customerSiteName: string | null;
  isMainInstallation: boolean;
};

type BootstrapTokenRow = {
  id: string;
  prefix: string;
  scope: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedByNodeId: string | null;
  revokedAt: string | null;
  targetCustomerAccountId: string | null;
  targetCustomerAccountName: string | null;
  targetCustomerSiteId: string | null;
  targetCustomerSiteName: string | null;
};

type CustomerSiteOption = {
  id: string;
  siteId: string;
  name: string;
  status: string;
};

type CustomerAccountOption = {
  id: string;
  accountId: string;
  name: string;
  status: string;
  sites: CustomerSiteOption[];
};

type Props = {
  nodes: EdgeNodeRow[];
  tokens: BootstrapTokenRow[];
  customerAccounts: CustomerAccountOption[];
  edgeEnabled?: boolean;
  mainInstallationStatus?: MainInstallationStatus;
};

type FlashMessage = {
  kind: "success" | "error";
  text: string;
};

// Display the just-issued plaintext token. Shown exactly once; the
// operator must copy it before navigating away.
type IssuedTokenView = {
  plaintext: string;
  prefix: string;
  expiresAt: string;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type ScopeBadgeInput = {
  customerAccountId: string | null;
  customerAccountName: string | null;
  customerSiteId: string | null;
  customerSiteName: string | null;
};

function formatScopeLabel(scope: ScopeBadgeInput): string {
  const accountLabel = scope.customerAccountName ?? scope.customerAccountId;
  const siteLabel = scope.customerSiteName ?? scope.customerSiteId;
  if (accountLabel && siteLabel) return `${accountLabel} / ${siteLabel}`;
  if (accountLabel) return accountLabel;
  if (siteLabel) return siteLabel;
  return "Organization";
}

function ScopeBadge({ scope }: { scope: ScopeBadgeInput }) {
  const isScoped = Boolean(scope.customerAccountId || scope.customerSiteId);
  return (
    <span
      className="inline-flex max-w-56 items-center rounded border px-2 py-0.5 text-xs font-medium"
      style={{
        borderColor: isScoped ? "var(--dpf-accent)" : "var(--dpf-border)",
        backgroundColor: "var(--dpf-surface-2)",
        color: isScoped ? "var(--dpf-accent)" : "var(--dpf-muted)",
      }}
      title={formatScopeLabel(scope)}
    >
      <span className="truncate">{formatScopeLabel(scope)}</span>
    </span>
  );
}

/**
 * Render hostname + LAN IP addresses for the Edge Node admin table.
 * Pure presentational — extracted so the row map stays readable AND
 * the cell is unit-testable in isolation.
 *
 * Renders:
 *   - "—" when neither field is populated (pre-T2.4 enrollment, or
 *     a node with only loopback)
 *   - "<hostname>" alone when only hostname is known
 *   - "<hostname> · <ip>[, <ip2>, ...]" when both are populated
 *     (first 2 IPs inline, rest collapse into a "(+N more)" badge
 *     so a 12-IP host doesn't break the row layout)
 *   - "<ip>[, <ip2>, ...]" alone when hostname is missing
 */
function HostAddressCell({
  hostname,
  ipAddresses,
}: {
  hostname: string | null;
  ipAddresses: string[] | null;
}) {
  const ips = ipAddresses ?? [];
  if (!hostname && ips.length === 0) {
    return <span className="text-[var(--dpf-muted)]">—</span>;
  }
  const visibleIps = ips.slice(0, 2);
  const overflowCount = Math.max(0, ips.length - visibleIps.length);
  return (
    <div className="flex flex-col gap-0.5">
      {hostname && (
        <span className="font-mono text-[var(--dpf-text)]">{hostname}</span>
      )}
      {visibleIps.length > 0 && (
        <span className="font-mono text-[var(--dpf-muted)]">
          {visibleIps.join(", ")}
          {overflowCount > 0 && (
            <span className="ml-1 italic">(+{overflowCount} more)</span>
          )}
        </span>
      )}
    </div>
  );
}

// Exported only so the route-level page tests can import it without
// the rest of the client surface. Production callers use the table
// above; this is not part of the public component API.
export { HostAddressCell as __test_HostAddressCell };

export function EdgeNodesAdminClient({
  nodes,
  tokens,
  customerAccounts,
  edgeEnabled = false,
  mainInstallationStatus = "missing",
}: Props) {
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [issuedToken, setIssuedToken] = useState<IssuedTokenView | null>(null);
  const [ttlMinutes, setTtlMinutes] = useState<number>(15);
  const [selectedCustomerAccountId, setSelectedCustomerAccountId] = useState<string>("");
  const [selectedCustomerSiteId, setSelectedCustomerSiteId] = useState<string>("");
  const [provisioningOs, setProvisioningOs] = useState<EdgeHostOs>("linux");
  const [remoteNodeName, setRemoteNodeName] = useState<string>("");
  const [remotePlan, setRemotePlan] = useState<
    { plan: RemoteProvisioningPlan; expiresAt: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const selectedCustomerAccount =
    customerAccounts.find((account) => account.id === selectedCustomerAccountId) ?? null;

  function clearFlash() {
    setFlash(null);
  }

  function onCustomerAccountChange(value: string) {
    setSelectedCustomerAccountId(value);
    setSelectedCustomerSiteId("");
  }

  function onIssueBootstrap() {
    clearFlash();
    setIssuedToken(null);
    startTransition(async () => {
      const result = await issueEdgeBootstrapTokenAction({
        ttlMs: Math.max(60_000, ttlMinutes * 60_000),
        targetCustomerAccountId: selectedCustomerAccountId || null,
        targetCustomerSiteId: selectedCustomerSiteId || null,
      });
      if (result.ok) {
        setIssuedToken({
          plaintext: result.plaintext,
          prefix: result.prefix,
          expiresAt: result.expiresAt,
        });
        setFlash({
          kind: "success",
          text: "Bootstrap token issued. Copy it now — it will not be shown again.",
        });
      } else {
        setFlash({
          kind: "error",
          text: `Bootstrap-token issuance failed: ${result.message}`,
        });
      }
    });
  }

  function onGenerateRemoteCommand() {
    clearFlash();
    setRemotePlan(null);
    setIssuedToken(null);
    startTransition(async () => {
      const result = await prepareRemoteEdgeProvisioningAction({
        os: provisioningOs,
        ttlMs: Math.max(60_000, ttlMinutes * 60_000),
        targetCustomerAccountId: selectedCustomerAccountId || null,
        targetCustomerSiteId: selectedCustomerSiteId || null,
        ...(remoteNodeName.trim() ? { nodeName: remoteNodeName.trim() } : {}),
      });
      if (result.ok) {
        setRemotePlan({ plan: result.plan, expiresAt: result.expiresAt });
        setFlash({
          kind: "success",
          text: "Install command ready. Copy it to the new machine — the token is shown once.",
        });
      } else {
        setFlash({
          kind: "error",
          text: `Could not prepare provisioning: ${result.message}`,
        });
      }
    });
  }

  async function onApprove(node: EdgeNodeRow) {
    clearFlash();
    if (
      !(await confirmDialog({
        title: "Approve Edge Node",
        message: `Approve Edge Node "${node.displayName}" (${node.nodeId})?`,
        confirmLabel: "Approve",
      }))
    )
      return;
    startTransition(async () => {
      const result = await approveEdgeNodeAction(node.id);
      setFlash(
        result.ok
          ? { kind: "success", text: `Approved ${node.displayName}` }
          : { kind: "error", text: `Approve failed: ${result.message}` },
      );
    });
  }

  async function onQuarantine(node: EdgeNodeRow) {
    clearFlash();
    const reason = await promptDialog({
      title: "Quarantine Edge Node",
      message: `Quarantine "${node.displayName}" — reason (will be recorded for audit):`,
      required: true,
      confirmLabel: "Quarantine",
    });
    if (!reason?.trim()) return;
    startTransition(async () => {
      const result = await quarantineEdgeNodeAction(node.id, reason.trim());
      setFlash(
        result.ok
          ? { kind: "success", text: `Quarantined ${node.displayName}` }
          : { kind: "error", text: `Quarantine failed: ${result.message}` },
      );
    });
  }

  async function onRevoke(node: EdgeNodeRow) {
    clearFlash();
    const reason = await promptDialog({
      title: "Revoke Edge Node",
      message: `REVOKE "${node.displayName}"? This invalidates its node token immediately. Re-enrollment requires a fresh bootstrap token. Reason:`,
      tone: "danger",
      required: true,
      confirmLabel: "Revoke",
    });
    if (!reason?.trim()) return;
    startTransition(async () => {
      const result = await revokeEdgeNodeAction(node.id, reason.trim());
      setFlash(
        result.ok
          ? { kind: "success", text: `Revoked ${node.displayName}` }
          : { kind: "error", text: `Revoke failed: ${result.message}` },
      );
    });
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div
          role="status"
          className="rounded border p-3 text-sm"
          style={{
            borderColor:
              flash.kind === "success" ? "var(--dpf-success)" : "var(--dpf-danger)",
            backgroundColor: "var(--dpf-surface-1)",
            color: "var(--dpf-text)",
          }}
        >
          {flash.text}
          <button
            type="button"
            onClick={clearFlash}
            className="ml-3 text-[var(--dpf-muted)] hover:underline"
          >
            dismiss
          </button>
        </div>
      )}

      {issuedToken && (
        <div
          className="rounded border-2 p-4 text-sm"
          style={{
            borderColor: "var(--dpf-warning)",
            backgroundColor: "var(--dpf-surface-1)",
          }}
        >
          <h3 className="mb-2 text-base font-semibold text-[var(--dpf-text)]">
            Bootstrap token issued — copy now
          </h3>
          <p className="mb-2 text-[var(--dpf-muted)]">
            This plaintext is shown <strong>exactly once</strong>. Paste it into the new Edge
            Node's installer with <code>DPF_BOOTSTRAP_TOKEN=...</code>. The token expires{" "}
            {formatTimestamp(issuedToken.expiresAt)}.
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 break-all rounded p-2 font-mono text-xs"
              style={{
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
              }}
            >
              {issuedToken.plaintext}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(issuedToken.plaintext)}
              className="rounded px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: "var(--dpf-accent)",
                color: "var(--dpf-on-accent, var(--dpf-surface-1))",
              }}
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setIssuedToken(null)}
              className="rounded px-3 py-1 text-xs"
              style={{
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {remotePlan && (
        <div
          className="rounded border-2 p-4 text-sm"
          style={{
            borderColor:
              remotePlan.plan.authorityUrlIssues.includes("loopback") ||
              remotePlan.plan.authorityUrlIssues.includes("missing")
                ? "var(--dpf-danger)"
                : "var(--dpf-accent)",
            backgroundColor: "var(--dpf-surface-1)",
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-[var(--dpf-text)]">
              Run this on the new machine
            </h3>
            <button
              type="button"
              onClick={() => setRemotePlan(null)}
              className="text-xs text-[var(--dpf-muted)] hover:underline"
            >
              Dismiss
            </button>
          </div>

          {(remotePlan.plan.authorityUrlIssues.includes("loopback") ||
            remotePlan.plan.authorityUrlIssues.includes("missing")) && (
            <p
              className="mb-3 rounded border px-3 py-2 text-[var(--dpf-text)]"
              style={{
                borderColor: "var(--dpf-danger)",
                backgroundColor: "var(--dpf-surface-2)",
              }}
            >
              This portal&apos;s address (<code>{remotePlan.plan.authorityUrl}</code>) is not
              reachable from another machine. Set <code>NEXT_PUBLIC_BASE_URL</code> to your
              portal&apos;s LAN or public URL and regenerate, or replace the host in the command
              below before running it.
            </p>
          )}
          {remotePlan.plan.authorityUrlIssues.includes("insecure-http") &&
            !remotePlan.plan.authorityUrlIssues.includes("loopback") &&
            !remotePlan.plan.authorityUrlIssues.includes("missing") && (
              <p
                className="mb-3 rounded border px-3 py-2 text-[var(--dpf-text)]"
                style={{
                  borderColor: "var(--dpf-warning)",
                  backgroundColor: "var(--dpf-surface-2)",
                }}
              >
                Heads up: this uses plain HTTP. On a shared network the token is sniffable —
                prefer an HTTPS portal address for anything past a private lab.
              </p>
            )}

          {remotePlan.plan.commands.map((cmd) => (
            <div key={cmd.id} className="mb-3">
              <p className="mb-1 text-xs font-medium text-[var(--dpf-muted)]">
                {cmd.label}
                {!cmd.worksToday && " (preview)"}
              </p>
              <div className="flex items-start gap-2">
                <pre
                  className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded p-2 font-mono text-xs"
                  style={{
                    backgroundColor: "var(--dpf-surface-2)",
                    color: "var(--dpf-text)",
                  }}
                >
                  {cmd.command}
                </pre>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(cmd.command)}
                  className="rounded px-3 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--dpf-accent)",
                    color: "var(--dpf-on-accent, var(--dpf-surface-1))",
                  }}
                >
                  Copy
                </button>
              </div>
              {cmd.note && (
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">{cmd.note}</p>
              )}
            </div>
          ))}

          <p className="text-[var(--dpf-muted)]">{remotePlan.plan.approveHint}</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {remotePlan.plan.nativeBinaryNote}
          </p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            The token expires {formatTimestamp(remotePlan.expiresAt)}.
          </p>
        </div>
      )}

      <MainInstallationReadiness
        node={nodes.find((node) => node.isMainInstallation) ?? null}
        edgeEnabled={edgeEnabled}
        status={mainInstallationStatus}
      />

      <FleetHealthSummary nodes={nodes} />

      <details
        className="rounded border p-4"
        style={{
          borderColor: "var(--dpf-border)",
          backgroundColor: "var(--dpf-surface-1)",
        }}
      >
        <summary className="cursor-pointer text-base font-semibold text-[var(--dpf-text)]">
          Add a node on another machine
        </summary>
        <p className="mb-3 mt-2 text-sm text-[var(--dpf-muted)]">
          Prepare a one-time install command for a remote Edge host. Remote nodes need approval
          before the Authority accepts their evidence.
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="edge-remote-os"
              className="text-xs font-medium text-[var(--dpf-muted)]"
            >
              Host operating system
            </label>
            <select
              id="edge-remote-os"
              value={provisioningOs}
              onChange={(e) => setProvisioningOs(e.target.value as EdgeHostOs)}
              className="w-full rounded border px-2 py-1.5 text-sm"
              style={{
                borderColor: "var(--dpf-border)",
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
              }}
            >
              <option value="linux" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                Linux — Docker (real LAN)
              </option>
              <option value="macos" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                macOS — Docker Desktop
              </option>
              <option value="windows" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                Windows — Docker Desktop
              </option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="edge-remote-name"
              className="text-xs font-medium text-[var(--dpf-muted)]"
            >
              Node name (optional)
            </label>
            <input
              id="edge-remote-name"
              type="text"
              value={remoteNodeName}
              onChange={(e) => setRemoteNodeName(e.target.value)}
              placeholder="e.g. warehouse-2"
              className="w-full rounded border px-2 py-1.5 text-sm"
              style={{
                borderColor: "var(--dpf-border)",
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="edge-bootstrap-ttl"
              className="text-xs font-medium text-[var(--dpf-muted)]"
            >
              TTL (minutes)
            </label>
            <input
              id="edge-bootstrap-ttl"
              type="number"
              min={1}
              max={24 * 60}
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(parseInt(e.target.value, 10) || 15)}
              className="w-full rounded border px-2 py-1.5 text-sm"
              style={{
                borderColor: "var(--dpf-border)",
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="edge-bootstrap-customer-account"
              className="text-xs font-medium text-[var(--dpf-muted)]"
            >
              Customer account
            </label>
            <select
              id="edge-bootstrap-customer-account"
              value={selectedCustomerAccountId}
              onChange={(e) => onCustomerAccountChange(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
              style={{
                borderColor: "var(--dpf-border)",
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
              }}
            >
              <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                Organization scope
              </option>
              {customerAccounts.map((account) => (
                <option
                  key={account.id}
                  value={account.id}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="edge-bootstrap-customer-site"
              className="text-xs font-medium text-[var(--dpf-muted)]"
            >
              Customer site
            </label>
            <select
              id="edge-bootstrap-customer-site"
              value={selectedCustomerSiteId}
              disabled={!selectedCustomerAccount}
              onChange={(e) => setSelectedCustomerSiteId(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm disabled:opacity-60"
              style={{
                borderColor: "var(--dpf-border)",
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
              }}
            >
              <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                Account-wide
              </option>
              {selectedCustomerAccount?.sites.map((site) => (
                <option
                  key={site.id}
                  value={site.id}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {site.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGenerateRemoteCommand}
            disabled={isPending}
            className="rounded px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{
              backgroundColor: "var(--dpf-accent)",
              color: "var(--dpf-on-accent, var(--dpf-surface-1))",
            }}
          >
            {isPending ? "Preparing…" : "Generate install command"}
          </button>
          <button
            type="button"
            onClick={onIssueBootstrap}
            disabled={isPending}
            className="rounded px-3 py-1.5 text-xs disabled:opacity-50"
            style={{
              backgroundColor: "var(--dpf-surface-2)",
              color: "var(--dpf-text)",
            }}
          >
            Issue raw token only
          </button>
        </div>
      </details>

      <section>
        <h2 className="mb-2 text-base font-semibold text-[var(--dpf-text)]">
          Edge fleet ({nodes.length})
        </h2>
        {nodes.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            No Edge Nodes have enrolled yet. Issue a bootstrap token above to onboard the first one.
          </p>
        ) : (
          <div
            className="overflow-x-auto rounded border"
            style={{
              borderColor: "var(--dpf-border)",
              backgroundColor: "var(--dpf-surface-1)",
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Display name</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Node ID</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Platform / mode</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Host / LAN address</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Scope</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Health</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Readiness</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Trust</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Last heartbeat</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr
                    key={n.id}
                    style={{ borderBottom: "1px solid var(--dpf-border)" }}
                  >
                    <td className="p-2 text-[var(--dpf-text)]">{n.displayName}</td>
                    <td className="p-2 font-mono text-xs text-[var(--dpf-muted)]">
                      {n.nodeId}
                    </td>
                    <td className="p-2 text-[var(--dpf-muted)]">
                      {n.platform} / {n.installMode}
                    </td>
                    <td className="p-2 text-xs text-[var(--dpf-muted)]">
                      <HostAddressCell
                        hostname={n.hostHostname}
                        ipAddresses={n.hostIpAddresses}
                      />
                    </td>
                    <td className="p-2">
                      <ScopeBadge
                        scope={{
                          customerAccountId: n.customerAccountId,
                          customerAccountName: n.customerAccountName,
                          customerSiteId: n.customerSiteId,
                          customerSiteName: n.customerSiteName,
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <HealthBadge health={n.health} />
                    </td>
                    <td className="max-w-72 p-2 text-xs">
                      <span className="block font-medium text-[var(--dpf-text)]">
                        {NEXT_ACTION_LABELS[n.nextAction]}
                      </span>
                      <span className="block text-[var(--dpf-muted)]">
                        {n.readinessChecks.find((check) => check.status !== "pass")?.detail ??
                          `Version ${n.version}; required checks pass.`}
                      </span>
                    </td>
                    <td className="p-2">
                      <StatusBadge
                        domain="edgeTrust"
                        status={n.trustState}
                        variant="soft"
                        uppercase={false}
                      />
                    </td>
                    <td className="p-2 text-xs text-[var(--dpf-muted)]">
                      <span className="block text-[var(--dpf-text)]">
                        {formatHeartbeatAge(n.heartbeatAgeMs)}
                      </span>
                      <span>{formatTimestamp(n.lastSeenAt)}</span>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {n.trustState === "pending" && (
                          <button
                            type="button"
                            onClick={() => onApprove(n)}
                            disabled={isPending}
                            className="rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--dpf-success)",
                              color: "var(--dpf-on-accent, var(--dpf-surface-1))",
                            }}
                          >
                            Approve
                          </button>
                        )}
                        {n.trustState === "quarantined" && (
                          <button
                            type="button"
                            onClick={() => onApprove(n)}
                            disabled={isPending}
                            className="rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--dpf-success)",
                              color: "var(--dpf-on-accent, var(--dpf-surface-1))",
                            }}
                          >
                            Restore (clear quarantine)
                          </button>
                        )}
                        {(n.trustState === "trusted" || n.trustState === "pending") && (
                          <button
                            type="button"
                            onClick={() => onQuarantine(n)}
                            disabled={isPending}
                            className="rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--dpf-warning)",
                              color: "var(--dpf-on-accent, var(--dpf-surface-1))",
                            }}
                          >
                            Quarantine
                          </button>
                        )}
                        {n.trustState !== "revoked" && (
                          <button
                            type="button"
                            onClick={() => onRevoke(n)}
                            disabled={isPending}
                            className="rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--dpf-danger)",
                              color: "var(--dpf-on-accent, var(--dpf-surface-1))",
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-[var(--dpf-text)]">
          Recent bootstrap tokens ({tokens.length})
        </h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No bootstrap tokens issued yet.</p>
        ) : (
          <div
            className="overflow-x-auto rounded border"
            style={{
              borderColor: "var(--dpf-border)",
              backgroundColor: "var(--dpf-surface-1)",
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Prefix</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Target</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Issued</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Expires</th>
                  <th className="p-2 text-left text-[var(--dpf-muted)]">Status</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const expired = !t.consumedAt && new Date(t.expiresAt) < new Date();
                  const status = t.consumedAt
                    ? `consumed by ${t.consumedByNodeId ?? "?"}`
                    : expired
                      ? "expired"
                      : "available";
                  return (
                    <tr key={t.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                      <td className="p-2 font-mono text-xs text-[var(--dpf-muted)]">
                        {t.prefix}
                      </td>
                      <td className="p-2">
                        <ScopeBadge
                          scope={{
                            customerAccountId: t.targetCustomerAccountId,
                            customerAccountName: t.targetCustomerAccountName,
                            customerSiteId: t.targetCustomerSiteId,
                            customerSiteName: t.targetCustomerSiteName,
                          }}
                        />
                      </td>
                      <td className="p-2 text-xs text-[var(--dpf-muted)]">
                        {formatTimestamp(t.issuedAt)}
                      </td>
                      <td className="p-2 text-xs text-[var(--dpf-muted)]">
                        {formatTimestamp(t.expiresAt)}
                      </td>
                      <td className="p-2 text-xs text-[var(--dpf-muted)]">{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
