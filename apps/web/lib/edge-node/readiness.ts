export const EDGE_HEARTBEAT_DEGRADED_AFTER_MS = 3 * 60 * 1000;
export const EDGE_HEARTBEAT_OFFLINE_AFTER_MS = 10 * 60 * 1000;

export type EdgeHealth =
  | "setup-required"
  | "starting"
  | "healthy"
  | "degraded"
  | "offline"
  | "quarantined"
  | "revoked";

export type EdgeTrust = "pending" | "trusted" | "quarantined" | "revoked";

export type EdgeReadinessNextAction =
  | "activate-edge"
  | "repair-service"
  | "approve-node"
  | "investigate-node"
  | "repair-capability"
  | "review-quarantine"
  | "replace-node"
  | "upgrade-node"
  | "none";

export type EdgeReadinessCheckStatus = "pass" | "warning" | "waiting" | "fail";

export interface EdgeReadinessCapability {
  capability: string;
  mode: string;
  status: string;
  reportedAt: Date | string;
}

export interface EdgeReadinessNode {
  id: string;
  nodeId: string;
  platform: string;
  installMode: string;
  version: string;
  storedStatus: string;
  trustState: string;
  lastSeenAt: Date | string | null;
  enrolledAt: Date | string | null;
  customerAccountId: string | null;
  customerSiteId: string | null;
  installerManaged: boolean;
  capabilities: EdgeReadinessCapability[];
}

export interface EdgeReadinessCheck {
  key: "service" | "enrollment" | "trust" | "heartbeat" | "version" | `capability:${string}`;
  label: string;
  status: EdgeReadinessCheckStatus;
  detail: string;
}

export interface EdgeNodeReadiness {
  health: EdgeHealth;
  trust: EdgeTrust | "unknown";
  heartbeatAgeMs: number | null;
  checks: EdgeReadinessCheck[];
  nextAction: EdgeReadinessNextAction;
}

export interface DeriveEdgeReadinessOptions {
  now?: Date;
  edgeEnabled?: boolean;
  requiredCapabilities?: string[];
  currentVersion?: string | null;
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ageMs(value: Date | string | null, now: Date): number | null {
  const date = asDate(value);
  return date ? Math.max(0, now.getTime() - date.getTime()) : null;
}

function normalizeTrust(value: string): EdgeTrust | "unknown" {
  return value === "pending" || value === "trusted" || value === "quarantined" || value === "revoked"
    ? value
    : "unknown";
}

function missingNodeReadiness(edgeEnabled: boolean): EdgeNodeReadiness {
  return {
    health: "setup-required",
    trust: "unknown",
    heartbeatAgeMs: null,
    nextAction: edgeEnabled ? "repair-service" : "activate-edge",
    checks: [
      {
        key: "service",
        label: "Host service",
        status: "fail",
        detail: edgeEnabled
          ? "Edge is enabled, but this installation has not enrolled a host service."
          : "Edge has not been enabled for this installation.",
      },
    ],
  };
}

export function deriveEdgeNodeReadiness(
  node: EdgeReadinessNode | null,
  options: DeriveEdgeReadinessOptions = {},
): EdgeNodeReadiness {
  const now = options.now ?? new Date();
  if (!node) return missingNodeReadiness(options.edgeEnabled ?? false);

  const trust = normalizeTrust(node.trustState);
  const heartbeatAgeMs = ageMs(node.lastSeenAt, now);
  const enrollmentAgeMs = ageMs(node.enrolledAt, now);
  const checks: EdgeReadinessCheck[] = [
    {
      key: "service",
      label: "Host service",
      status: "pass",
      detail: `${node.platform} / ${node.installMode} enrolled as ${node.nodeId}.`,
    },
    {
      key: "enrollment",
      label: "Enrollment",
      status: node.enrolledAt ? "pass" : "warning",
      detail: node.enrolledAt ? "The Authority recognizes this node." : "Enrollment time is missing on this legacy row.",
    },
    {
      key: "trust",
      label: "Trust",
      status: trust === "trusted" ? "pass" : trust === "pending" ? "waiting" : "fail",
      detail:
        trust === "trusted"
          ? "Submissions from this node are accepted."
          : trust === "pending"
            ? "This node is waiting for operator approval."
            : trust === "quarantined"
              ? "The node may heartbeat, but its submissions are blocked."
              : trust === "revoked"
                ? "This node's credentials have been revoked."
                : "The node has an unrecognized trust state.",
    },
  ];

  let heartbeatStatus: EdgeReadinessCheckStatus;
  let heartbeatDetail: string;
  if (heartbeatAgeMs === null) {
    const recentlyEnrolled = enrollmentAgeMs !== null && enrollmentAgeMs <= EDGE_HEARTBEAT_OFFLINE_AFTER_MS;
    heartbeatStatus = recentlyEnrolled ? "waiting" : "fail";
    heartbeatDetail = recentlyEnrolled
      ? "Waiting for the first heartbeat."
      : "No heartbeat has been recorded.";
  } else if (heartbeatAgeMs > EDGE_HEARTBEAT_OFFLINE_AFTER_MS) {
    heartbeatStatus = "fail";
    heartbeatDetail = "The host service has missed the offline threshold.";
  } else if (heartbeatAgeMs > EDGE_HEARTBEAT_DEGRADED_AFTER_MS) {
    heartbeatStatus = "warning";
    heartbeatDetail = "The latest heartbeat is outside the healthy window.";
  } else {
    heartbeatStatus = "pass";
    heartbeatDetail = "Heartbeat is current.";
  }
  checks.push({ key: "heartbeat", label: "Heartbeat", status: heartbeatStatus, detail: heartbeatDetail });

  let versionProblem = false;
  if (options.currentVersion) {
    versionProblem = node.version !== options.currentVersion;
    checks.push({
      key: "version",
      label: "Version",
      status: versionProblem ? "warning" : "pass",
      detail: versionProblem
        ? `Node ${node.version} differs from the current installation ${options.currentVersion}.`
        : `Node version ${node.version} matches this installation.`,
    });
  }

  let capabilityProblem = false;
  for (const required of options.requiredCapabilities ?? []) {
    const capability = node.capabilities.find((row) => row.capability === required);
    const reportAge = capability ? ageMs(capability.reportedAt, now) : null;
    const accepted = capability?.mode === "enabled" || capability?.mode === "reporting-only";
    const fresh = reportAge !== null && reportAge <= EDGE_HEARTBEAT_OFFLINE_AFTER_MS;
    const healthy = capability?.status === "healthy";
    const passed = Boolean(capability && accepted && fresh && healthy);
    capabilityProblem ||= !passed;
    checks.push({
      key: `capability:${required}`,
      label: required === "federation.discovery" ? "Nearby DPF discovery" : required,
      status: passed ? "pass" : capability?.status === "unknown" ? "waiting" : "fail",
      detail: !capability
        ? "The node has not registered this required capability."
        : !accepted
          ? "The Authority has not enabled this capability."
          : !fresh
            ? "The capability health report is stale."
            : !healthy
              ? `The node reports ${capability.status}.`
              : "Capability is enabled and healthy.",
    });
  }

  if (trust === "revoked") {
    return { health: "revoked", trust, heartbeatAgeMs, checks, nextAction: "replace-node" };
  }
  if (trust === "quarantined") {
    return { health: "quarantined", trust, heartbeatAgeMs, checks, nextAction: "review-quarantine" };
  }
  if (heartbeatStatus === "fail") {
    return { health: "offline", trust, heartbeatAgeMs, checks, nextAction: "repair-service" };
  }
  if (trust === "pending") {
    return { health: "starting", trust, heartbeatAgeMs, checks, nextAction: "approve-node" };
  }
  if (capabilityProblem) {
    return { health: "degraded", trust, heartbeatAgeMs, checks, nextAction: "repair-capability" };
  }
  if (versionProblem) {
    return { health: "degraded", trust, heartbeatAgeMs, checks, nextAction: "upgrade-node" };
  }
  if (heartbeatStatus === "warning" || trust === "unknown") {
    return { health: "degraded", trust, heartbeatAgeMs, checks, nextAction: "investigate-node" };
  }
  if (heartbeatStatus === "waiting") {
    return { health: "starting", trust, heartbeatAgeMs, checks, nextAction: "investigate-node" };
  }
  return { health: "healthy", trust, heartbeatAgeMs, checks, nextAction: "none" };
}

export interface MainInstallationNodeSelection {
  status: "found" | "missing" | "ambiguous";
  basis: "installer-managed" | "legacy-unscoped" | "none";
  node: EdgeReadinessNode | null;
  candidateNodeIds: string[];
}

export interface NearbyDiscoveryHealth {
  status: "healthy" | "degraded" | "waiting" | "disabled" | "unavailable";
  label: string;
  detail: string;
}

export function deriveNearbyDiscoveryHealth({
  selection,
  readiness,
  discoveryCapability,
}: {
  selection: MainInstallationNodeSelection;
  readiness: EdgeNodeReadiness | null;
  discoveryCapability: EdgeReadinessCapability | null;
}): NearbyDiscoveryHealth {
  if (selection.status === "ambiguous") {
    return {
      status: "unavailable",
      label: "Enrollment conflict",
      detail:
        "Multiple installer-managed Edge Nodes claim this installation. One that has been silent for a week beside a live one retires itself within the hour; two live ones need a person to review Edge Nodes.",
    };
  }
  if (selection.status !== "found" || !readiness || !discoveryCapability) {
    return {
      status: "unavailable",
      label: "Not set up",
      detail: "The native Edge Node has not registered nearby discovery.",
    };
  }
  if (discoveryCapability.mode !== "enabled" && discoveryCapability.mode !== "reporting-only") {
    return {
      status: "disabled",
      label: "Paused",
      detail: "Nearby discovery is disabled by the Authority.",
    };
  }
  if (readiness.health === "healthy") {
    return {
      status: "healthy",
      label: "Listening",
      detail: "This installation is announcing and looking for nearby DPF installations.",
    };
  }
  if (readiness.health === "starting") {
    return {
      status: "waiting",
      label: "Starting",
      detail: "Nearby discovery is enabled and waiting for its first health report.",
    };
  }
  return {
    status: "degraded",
    label: "Needs attention",
    detail: "Nearby discovery or its host service is stale or failing. Check the Edge fleet for the specific failed readiness check.",
  };
}

function selection(
  candidates: EdgeReadinessNode[],
  basis: MainInstallationNodeSelection["basis"],
): MainInstallationNodeSelection {
  if (candidates.length === 1) {
    return { status: "found", basis, node: candidates[0] ?? null, candidateNodeIds: candidates.map((node) => node.nodeId) };
  }
  if (candidates.length > 1) {
    return { status: "ambiguous", basis, node: null, candidateNodeIds: candidates.map((node) => node.nodeId) };
  }
  return { status: "missing", basis: "none", node: null, candidateNodeIds: [] };
}

export function selectMainInstallationNode(nodes: EdgeReadinessNode[]): MainInstallationNodeSelection {
  const installerManaged = nodes.filter((node) => node.installerManaged && node.trustState !== "revoked");
  if (installerManaged.length > 0) return selection(installerManaged, "installer-managed");

  const legacyUnscoped = nodes.filter(
    (node) =>
      node.customerAccountId === null &&
      node.customerSiteId === null &&
      node.trustState !== "revoked",
  );
  return selection(legacyUnscoped, "legacy-unscoped");
}
