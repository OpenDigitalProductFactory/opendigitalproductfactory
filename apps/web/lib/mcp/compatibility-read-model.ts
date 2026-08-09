import { prisma } from "@dpf/db";

export const MCP_RETIREMENT_CONFIG_KEY = "mcp.protocol-2026.retirement-evidence";
export const MCP_RETIREMENT_OBSERVATION_DAYS = 30;

export type McpCompatibilityAggregate = {
  clientKind: string;
  clientVersion: string | null;
  protocolVersion: string;
  protocolEra: string;
  tasksExtensionUsed: boolean;
  resultClass: string;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  peakActiveRequests: number;
  peakSuspendedTasks: number | null;
  peakProcessRssBytes: bigint | null;
};

export type McpRetirementEvidence = {
  clientMatrixComplete: boolean;
  rollbackDrillCompletedAt: string | null;
  operatorApprovedAt: string | null;
};

export type McpCompatibilityReadModel = {
  generatedAt: string;
  observationDaysRequired: number;
  summary: {
    totalRequests: number;
    modernRequests: number;
    legacyRequests: number;
    compatibilityFailures: number;
    modernSharePercent: number;
  };
  clients: Array<{
    key: string;
    clientKind: string;
    surface: string;
    owner: string;
    currentVersion: string | null;
    currentProtocolVersion: string;
    currentProtocolEra: "modern" | "legacy" | "unknown";
    conformanceStatus: "conforming" | "legacy" | "unobserved" | "not-applicable" | "gated";
    blocker: string | null;
    tasksExtensionObserved: boolean;
    requestCount: number;
    compatibilityFailures: number;
    lastSeenAt: string | null;
  }>;
  resources: {
    peakActiveRequests: number;
    peakSuspendedTasks: number | null;
    peakProcessRssMiB: number | null;
  };
  retirement: {
    ready: boolean;
    blockers: string[];
    criteria: Array<{ key: string; label: string; satisfied: boolean; evidence: string }>;
  };
};

const SUCCESS_RESULT_CLASSES = new Set(["success", "task", "input_required"]);

const KNOWN_CLIENT_SURFACES = [
  { key: "codex", label: "Codex", surface: "External MCP client", owner: "Agent toolchain bootstrap" },
  { key: "claude-code", label: "Claude Code", surface: "External MCP client / Build Studio CLI", owner: "CLI adapter" },
  { key: "grok", label: "Grok", surface: "External MCP client", owner: "Agent toolchain bootstrap" },
  { key: "dpf-ux-audit", label: "DPF UX audit harness", surface: "Out-of-process MCP harness", owner: "UX audit harness" },
  { key: "dpf-ai-coworker-tool-script", label: "AI coworker tool script", surface: "In-platform AI coworker", owner: "AI coworker runtime" },
  { key: "adp-mcp", label: "ADP MCP service", surface: "Domain MCP service", owner: "ADP adapter" },
  { key: "build-studio-application-service", label: "Build Studio application service", surface: "Build Studio", owner: "Build pipeline", mode: "not-applicable" as const },
  { key: "a2a-entry-adapter", label: "Federated A2A entry adapter", surface: "Federated A2A", owner: "A2A adoption program", mode: "gated" as const },
] as const;

function validDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function parseRetirementEvidence(value: unknown): McpRetirementEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    clientMatrixComplete: row["clientMatrixComplete"] === true,
    rollbackDrillCompletedAt: validDateString(row["rollbackDrillCompletedAt"]),
    operatorApprovedAt: validDateString(row["operatorApprovedAt"]),
  };
}

function toEra(value: string): "modern" | "legacy" | "unknown" {
  return value === "modern" || value === "legacy" ? value : "unknown";
}

function failureCount(row: McpCompatibilityAggregate): number {
  return SUCCESS_RESULT_CLASSES.has(row.resultClass) ? 0 : row.count;
}

export function buildMcpCompatibilityReadModel(input: {
  now: Date;
  earliestObservedAt: Date | null;
  aggregates: McpCompatibilityAggregate[];
  retirementEvidence: McpRetirementEvidence | null;
}): McpCompatibilityReadModel {
  const totalRequests = input.aggregates.reduce((sum, row) => sum + row.count, 0);
  const modernRequests = input.aggregates
    .filter((row) => row.protocolEra === "modern")
    .reduce((sum, row) => sum + row.count, 0);
  const legacyRequests = input.aggregates
    .filter((row) => row.protocolEra === "legacy")
    .reduce((sum, row) => sum + row.count, 0);
  const compatibilityFailures = input.aggregates.reduce(
    (sum, row) => sum + failureCount(row),
    0,
  );

  const knownByKind = new Map<string, (typeof KNOWN_CLIENT_SURFACES)[number]>(
    KNOWN_CLIENT_SURFACES.map((entry) => [entry.key, entry]),
  );
  const clientsByKind = new Map<string, McpCompatibilityReadModel["clients"][number]>();
  for (const row of input.aggregates) {
    const existing = clientsByKind.get(row.clientKind);
    const isLatest = !existing || !existing.lastSeenAt || row.lastSeenAt.getTime() > Date.parse(existing.lastSeenAt);
    const known = knownByKind.get(row.clientKind);
    const next = existing ?? {
      key: row.clientKind,
      clientKind: known?.label ?? row.clientKind,
      surface: known?.surface ?? "Observed external MCP client",
      owner: known?.owner ?? "MCP platform",
      currentVersion: row.clientVersion,
      currentProtocolVersion: row.protocolVersion,
      currentProtocolEra: toEra(row.protocolEra),
      conformanceStatus: row.protocolEra === "modern" ? "conforming" as const : "legacy" as const,
      blocker: row.protocolEra === "modern" ? null : "Client upgrade or compatibility diagnosis required",
      tasksExtensionObserved: false,
      requestCount: 0,
      compatibilityFailures: 0,
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
    next.requestCount += row.count;
    next.compatibilityFailures += failureCount(row);
    next.tasksExtensionObserved ||= row.tasksExtensionUsed;
    if (isLatest) {
      next.currentVersion = row.clientVersion;
      next.currentProtocolVersion = row.protocolVersion;
      next.currentProtocolEra = toEra(row.protocolEra);
      next.conformanceStatus = row.protocolEra === "modern" ? "conforming" : "legacy";
      next.blocker = row.protocolEra === "modern"
        ? null
        : "Client upgrade or compatibility diagnosis required";
      next.lastSeenAt = row.lastSeenAt.toISOString();
    }
    clientsByKind.set(row.clientKind, next);
  }

  for (const known of KNOWN_CLIENT_SURFACES) {
    if (clientsByKind.has(known.key)) continue;
    const mode = "mode" in known ? known.mode : "unobserved";
    clientsByKind.set(known.key, {
      key: known.key,
      clientKind: known.label,
      surface: known.surface,
      owner: known.owner,
      currentVersion: null,
      currentProtocolVersion: mode === "not-applicable" ? "Application service" : "Not observed",
      currentProtocolEra: "unknown",
      conformanceStatus: mode,
      blocker: mode === "not-applicable"
        ? "Canonical-runtime direct-service acceptance pending"
        : mode === "gated"
          ? "A2A adapter remains gated on its governed slice"
          : "Canonical-runtime 2026 conformance observation pending",
      tasksExtensionObserved: false,
      requestCount: 0,
      compatibilityFailures: 0,
      lastSeenAt: null,
    });
  }
  const clients = [...clientsByKind.values()].sort((a, b) => {
    if (a.lastSeenAt && b.lastSeenAt) return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
    if (a.lastSeenAt) return -1;
    if (b.lastSeenAt) return 1;
    return a.clientKind.localeCompare(b.clientKind);
  });
  const observedForMs = input.earliestObservedAt
    ? Math.max(0, input.now.getTime() - input.earliestObservedAt.getTime())
    : 0;
  const observationWindowSatisfied =
    observedForMs >= MCP_RETIREMENT_OBSERVATION_DAYS * 24 * 60 * 60 * 1_000;
  const evidence = input.retirementEvidence;

  const criteria = [
    {
      key: "observations",
      label: "Compatibility traffic observed",
      satisfied: totalRequests > 0,
      evidence: totalRequests > 0 ? `${totalRequests} requests in the current window` : "No observations yet",
    },
    {
      key: "observation-window",
      label: `${MCP_RETIREMENT_OBSERVATION_DAYS}-day observation window complete`,
      satisfied: observationWindowSatisfied,
      evidence: input.earliestObservedAt
        ? `Observing since ${input.earliestObservedAt.toISOString()}`
        : "Observation has not started",
    },
    {
      key: "client-matrix",
      label: "Known-client matrix confirmed complete",
      satisfied: evidence?.clientMatrixComplete === true,
      evidence: evidence?.clientMatrixComplete
        ? "Operator-confirmed client inventory"
        : "Known clients have not been confirmed",
    },
    {
      key: "legacy-traffic",
      label: "No legacy protocol traffic in the window",
      satisfied: totalRequests > 0 && legacyRequests === 0,
      evidence: `${legacyRequests} legacy requests observed`,
    },
    {
      key: "compatibility-failures",
      label: "No compatibility failures in the window",
      satisfied: totalRequests > 0 && compatibilityFailures === 0,
      evidence: `${compatibilityFailures} compatibility failures observed`,
    },
    {
      key: "rollback-drill",
      label: "Legacy rollback drill recorded",
      satisfied: evidence?.rollbackDrillCompletedAt !== null && evidence?.rollbackDrillCompletedAt !== undefined,
      evidence: evidence?.rollbackDrillCompletedAt ?? "Rollback drill evidence is missing",
    },
    {
      key: "operator-approval",
      label: "Explicit operator retirement approval recorded",
      satisfied: evidence?.operatorApprovedAt !== null && evidence?.operatorApprovedAt !== undefined,
      evidence: evidence?.operatorApprovedAt ?? "Operator approval is missing",
    },
  ];
  const blockers = criteria.filter((criterion) => !criterion.satisfied).map((criterion) =>
    criterion.key === "observations"
      ? "No compatibility observations have been recorded."
      : criterion.label,
  );

  const peakRss = input.aggregates.reduce<bigint | null>((peak, row) => {
    if (row.peakProcessRssBytes === null) return peak;
    return peak === null || row.peakProcessRssBytes > peak ? row.peakProcessRssBytes : peak;
  }, null);
  const suspendedValues = input.aggregates
    .map((row) => row.peakSuspendedTasks)
    .filter((value): value is number => value !== null);

  return {
    generatedAt: input.now.toISOString(),
    observationDaysRequired: MCP_RETIREMENT_OBSERVATION_DAYS,
    summary: {
      totalRequests,
      modernRequests,
      legacyRequests,
      compatibilityFailures,
      modernSharePercent: totalRequests === 0
        ? 0
        : Number(((modernRequests / totalRequests) * 100).toFixed(1)),
    },
    clients,
    resources: {
      peakActiveRequests: input.aggregates.reduce(
        (peak, row) => Math.max(peak, row.peakActiveRequests),
        0,
      ),
      peakSuspendedTasks: suspendedValues.length > 0 ? Math.max(...suspendedValues) : null,
      peakProcessRssMiB: peakRss === null
        ? null
        : Number((Number(peakRss) / 1024 / 1024).toFixed(1)),
    },
    retirement: {
      ready: criteria.every((criterion) => criterion.satisfied),
      blockers,
      criteria,
    },
  };
}

type GroupRow = {
  clientKind: string;
  clientVersion: string | null;
  protocolVersion: string;
  protocolEra: string;
  tasksExtensionUsed: boolean;
  resultClass: string;
  _count: { _all: number };
  _min: { recordedAt: Date | null };
  _max: {
    recordedAt: Date | null;
    activeRequestCount: number | null;
    suspendedTaskCount: number | null;
    processRssBytes: bigint | null;
  };
};

export async function getMcpCompatibilityReadModel(
  now = new Date(),
): Promise<McpCompatibilityReadModel> {
  const cutoff = new Date(
    now.getTime() - MCP_RETIREMENT_OBSERVATION_DAYS * 24 * 60 * 60 * 1_000,
  );
  const db = prisma as unknown as {
    mcpProtocolTelemetry: {
      groupBy: (args: unknown) => Promise<GroupRow[]>;
      aggregate: (args: unknown) => Promise<{ _min: { recordedAt: Date | null } }>;
    };
    platformConfig: {
      findUnique: (args: unknown) => Promise<{ value: unknown } | null>;
    };
  };

  const [groups, earliest, config] = await Promise.all([
    db.mcpProtocolTelemetry.groupBy({
      by: [
        "clientKind",
        "clientVersion",
        "protocolVersion",
        "protocolEra",
        "tasksExtensionUsed",
        "resultClass",
      ],
      where: { recordedAt: { gte: cutoff } },
      _count: { _all: true },
      _min: { recordedAt: true },
      _max: {
        recordedAt: true,
        activeRequestCount: true,
        suspendedTaskCount: true,
        processRssBytes: true,
      },
    }),
    db.mcpProtocolTelemetry.aggregate({ _min: { recordedAt: true } }),
    db.platformConfig.findUnique({ where: { key: MCP_RETIREMENT_CONFIG_KEY } }),
  ]);

  const aggregates = groups.flatMap<McpCompatibilityAggregate>((row) => {
    if (!row._min.recordedAt || !row._max.recordedAt) return [];
    return [{
      clientKind: row.clientKind,
      clientVersion: row.clientVersion,
      protocolVersion: row.protocolVersion,
      protocolEra: row.protocolEra,
      tasksExtensionUsed: row.tasksExtensionUsed,
      resultClass: row.resultClass,
      count: row._count._all,
      firstSeenAt: row._min.recordedAt,
      lastSeenAt: row._max.recordedAt,
      peakActiveRequests: row._max.activeRequestCount ?? 0,
      peakSuspendedTasks: row._max.suspendedTaskCount,
      peakProcessRssBytes: row._max.processRssBytes,
    }];
  });

  return buildMcpCompatibilityReadModel({
    now,
    earliestObservedAt: earliest._min.recordedAt,
    aggregates,
    retirementEvidence: parseRetirementEvidence(config?.value),
  });
}
