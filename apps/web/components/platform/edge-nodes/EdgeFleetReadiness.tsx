import Link from "next/link";

import { StatusBadge, intentStyle, resolveIntent } from "@/components/ui/report-kit";
import type {
  EdgeHealth,
  EdgeReadinessCheck,
  EdgeReadinessNextAction,
} from "@/lib/edge-node/readiness";

export type EdgeFleetNode = {
  platform: string;
  installMode: string;
  version: string;
  trustState: string;
  health: EdgeHealth;
  heartbeatAgeMs: number | null;
  nextAction: EdgeReadinessNextAction;
  readinessChecks: EdgeReadinessCheck[];
};

export type MainInstallationStatus = "found" | "missing" | "ambiguous";

export const NEXT_ACTION_LABELS: Record<EdgeReadinessNextAction, string> = {
  "activate-edge": "Enable Edge",
  "repair-service": "Repair service",
  "approve-node": "Approve node",
  "investigate-node": "Investigate node",
  "repair-capability": "Repair capability",
  "review-quarantine": "Review quarantine",
  "replace-node": "Replace node",
  "upgrade-node": "Upgrade node",
  none: "Ready",
};

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function HealthBadge({ health }: { health: EdgeHealth }) {
  return (
    <StatusBadge
      domain="edgeHealth"
      status={health}
      label={health === "setup-required" ? "Setup required" : titleCase(health)}
      variant="soft"
      uppercase={false}
    />
  );
}

export function formatHeartbeatAge(ageMs: number | null): string {
  if (ageMs === null) return "No heartbeat";
  if (ageMs < 60_000) return "Just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function FleetHealthSummary({ nodes }: { nodes: EdgeFleetNode[] }) {
  const trusted = nodes.filter((node) => node.trustState === "trusted").length;
  const pending = nodes.filter((node) => node.trustState === "pending").length;
  const healthCounts = new Map<EdgeHealth, number>();
  for (const node of nodes) {
    healthCounts.set(node.health, (healthCounts.get(node.health) ?? 0) + 1);
  }
  const runtimeModes = Array.from(
    new Set(nodes.map((node) => `${node.platform} / ${node.installMode}`)),
  ).sort();
  const hasContainerRuntime = nodes.some(
    (node) => node.installMode === "container-host" || node.installMode === "container-vm",
  );

  return (
    <section
      className="rounded border p-4"
      style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-1)" }}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">Fleet health</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {Array.from(healthCounts.entries()).map(([health, count]) => (
              <span
                key={health}
                className="rounded border px-2 py-1 text-[var(--dpf-text)]"
                style={{ borderColor: intentStyle(resolveIntent("edgeHealth", health)).border }}
              >
                {formatCount(count, health, health)}
              </span>
            ))}
            <span className="rounded border px-2 py-1 text-[var(--dpf-text)]" style={{ borderColor: "var(--dpf-border)" }}>
              {formatCount(trusted, "trusted", "trusted")}
            </span>
            <span className="rounded border px-2 py-1 text-[var(--dpf-text)]" style={{ borderColor: "var(--dpf-border)" }}>
              {formatCount(pending, "pending", "pending")}
            </span>
          </div>
        </div>
        <div className="min-w-0 lg:max-w-xl">
          <p className="text-xs font-medium uppercase text-[var(--dpf-muted)]">Runtime modes</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {runtimeModes.length > 0 ? (
              runtimeModes.map((mode) => (
                <span key={mode} className="rounded border px-2 py-1 font-mono text-xs text-[var(--dpf-muted)]" style={{ borderColor: "var(--dpf-border)" }}>
                  {mode}
                </span>
              ))
            ) : (
              <span className="text-sm text-[var(--dpf-muted)]">No enrolled nodes</span>
            )}
          </div>
        </div>
      </div>
      {hasContainerRuntime && (
        <p
          className="mt-3 rounded border px-3 py-2 text-sm text-[var(--dpf-text)]"
          style={{ borderColor: "var(--dpf-warning)", backgroundColor: "var(--dpf-surface-2)" }}
        >
          Container runtime is connected to Authority Core, but can have limited host-LAN
          visibility on Docker Desktop. Native Windows/macOS service mode is the full host-LAN
          discovery target.
        </p>
      )}
    </section>
  );
}

export function MainInstallationReadiness({
  node,
  edgeEnabled,
  status,
}: {
  node: EdgeFleetNode | null;
  edgeEnabled: boolean;
  status: MainInstallationStatus;
}) {
  const health: EdgeHealth = node?.health ?? "setup-required";
  const setupDetail = !edgeEnabled
    ? "Edge is not enabled for this installation. Re-run the governed installer with Edge enabled."
    : status === "ambiguous"
      ? "More than one installer-managed node claims this installation. Review the fleet before relying on discovery."
      : "Edge is enabled, but its supervised host service has not enrolled. Run the governed repair or self-upgrade path.";

  return (
    <section
      className="rounded border p-4"
      style={{
        borderColor: intentStyle(resolveIntent("edgeHealth", health)).border,
        backgroundColor: "var(--dpf-surface-1)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">This DPF installation</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <HealthBadge health={health} />
            {node && (
              <span className="text-sm text-[var(--dpf-muted)]">
                {node.platform} / {node.installMode} · {node.version} · {formatHeartbeatAge(node.heartbeatAgeMs)}
              </span>
            )}
          </div>
        </div>
        <Link
          href="/platform/federation-links"
          className="rounded border px-3 py-1.5 text-sm font-medium text-[var(--dpf-accent)]"
          style={{ borderColor: "var(--dpf-accent)" }}
        >
          Open Connections
        </Link>
      </div>

      {node ? (
        <ul className="mt-4 grid gap-2 md:grid-cols-2">
          {node.readinessChecks.map((check) => (
            <li key={check.key} className="rounded border p-3" style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--dpf-text)]">{check.label}</span>
                <span className="text-xs text-[var(--dpf-muted)]">{titleCase(check.status)}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">{check.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--dpf-muted)]">{setupDetail}</p>
      )}
    </section>
  );
}
