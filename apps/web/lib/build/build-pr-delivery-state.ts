import type { GithubPrReadiness } from "@/lib/build/github-pr-readiness";

export const BUILD_PR_DELIVERY_STATUSES = [
  "created",
  "checking",
  "updating",
  "queued",
  "awaiting-release",
  "deployed",
  "escalated",
  "closed",
] as const;

export type BuildPrDeliveryStatus = (typeof BUILD_PR_DELIVERY_STATUSES)[number];

export type BuildPrDeliveryStateV1 = {
  schemaVersion: 1;
  status: BuildPrDeliveryStatus;
  repository: string;
  prNumber: number;
  prUrl: string;
  lastObservedHeadSha: string | null;
  lastActuatedHeadSha: string | null;
  staleUpdateAttempts: number;
  reconciliationAttempts: number;
  lastReadiness: GithubPrReadiness["kind"] | null;
  lastObservedAt: string | null;
  escalationKey: string | null;
  lastError: string | null;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

export function createBuildPrDeliveryState(input: {
  repository: string;
  prNumber: number;
  prUrl: string;
}): BuildPrDeliveryStateV1 {
  return {
    schemaVersion: 1,
    status: "created",
    repository: input.repository,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    lastObservedHeadSha: null,
    lastActuatedHeadSha: null,
    staleUpdateAttempts: 0,
    reconciliationAttempts: 0,
    lastReadiness: null,
    lastObservedAt: null,
    escalationKey: null,
    lastError: null,
  };
}

export function readBuildPrDeliveryState(workspaceState: unknown): BuildPrDeliveryStateV1 | null {
  const root = asObject(workspaceState);
  const buildStudio = asObject(root.buildStudio);
  const value = asObject(buildStudio.delivery);
  if (value.schemaVersion !== 1) return null;
  if (
    typeof value.status !== "string" ||
    !BUILD_PR_DELIVERY_STATUSES.includes(value.status as BuildPrDeliveryStatus) ||
    typeof value.repository !== "string" ||
    typeof value.prNumber !== "number" ||
    !Number.isInteger(value.prNumber) ||
    value.prNumber <= 0 ||
    typeof value.prUrl !== "string" ||
    !value.repository ||
    !value.prUrl
  ) {
    return null;
  }
  const integer = (candidate: unknown) =>
    typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
  return {
    schemaVersion: 1,
    status: value.status as BuildPrDeliveryStatus,
    repository: value.repository,
    prNumber: value.prNumber,
    prUrl: value.prUrl,
    lastObservedHeadSha: typeof value.lastObservedHeadSha === "string" ? value.lastObservedHeadSha : null,
    lastActuatedHeadSha: typeof value.lastActuatedHeadSha === "string" ? value.lastActuatedHeadSha : null,
    staleUpdateAttempts: integer(value.staleUpdateAttempts),
    reconciliationAttempts: integer(value.reconciliationAttempts),
    lastReadiness: typeof value.lastReadiness === "string"
      ? value.lastReadiness as GithubPrReadiness["kind"]
      : null,
    lastObservedAt: typeof value.lastObservedAt === "string" ? value.lastObservedAt : null,
    escalationKey: typeof value.escalationKey === "string" ? value.escalationKey : null,
    lastError: typeof value.lastError === "string" ? value.lastError : null,
  };
}

export function writeBuildPrDeliveryState(
  workspaceState: unknown,
  delivery: BuildPrDeliveryStateV1,
): JsonObject {
  const root = { ...asObject(workspaceState) };
  root.buildStudio = { ...asObject(root.buildStudio), delivery };
  return root;
}
