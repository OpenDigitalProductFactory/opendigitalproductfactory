import type { RuntimeTargetInput, RuntimeTargetStatus } from "./types";

type FeatureBuildReference = {
  id: string;
  buildId: string;
};

type SandboxReference = {
  id: string;
  buildId: string;
  providerId: string;
  state: string;
  previewUrl?: string | null;
};

type SandboxSlotReference = {
  id: string;
  slotIndex: number;
  containerId: string;
  port: number;
  status: string;
  buildId?: string | null;
};

type GitPromotionCandidateReference = {
  id: string;
  candidateId: string;
  status: string;
  sandboxId?: string | null;
};

export function buildRootPortalTargetInput(args: {
  appUrl?: string | null;
  serviceVersion?: string | null;
}): RuntimeTargetInput {
  return {
    targetId: "RT-ROOT-PORTAL",
    kind: "root-portal",
    status: "running",
    serviceName: "portal",
    containerName: "dpf-portal-1",
    hostUrl: args.appUrl?.trim() || "http://localhost:3000",
    port: 3000,
    serviceVersion: args.serviceVersion ?? null,
  };
}

export function buildDevPortalTargetInput(): RuntimeTargetInput {
  return {
    targetId: "RT-DEV-PORTAL",
    kind: "dev-portal",
    status: "planned",
    serviceName: "dev-portal",
    containerName: "dpf-dev-portal-1",
    hostUrl: "http://localhost:3001",
    port: 3001,
  };
}

function sandboxStatus(state: string): RuntimeTargetStatus {
  switch (state) {
    case "running":
    case "ready":
      return "running";
    case "starting":
    case "initializing":
      return "starting";
    case "destroyed":
    case "released":
      return "released";
    case "failed":
      return "failed";
    default:
      return "assigned";
  }
}

function gitPromotionStatus(status: string): RuntimeTargetStatus {
  switch (status) {
    case "verifying":
    case "in_progress":
      return "verifying";
    case "verified":
    case "success":
      return "verified";
    case "failed":
    case "failure":
      return "failed";
    case "blocked":
      return "blocked";
    default:
      return "planned";
  }
}

function addIfMissing(
  inputs: RuntimeTargetInput[],
  existingTargetIds: Set<string>,
  input: RuntimeTargetInput,
) {
  if (!existingTargetIds.has(input.targetId)) inputs.push(input);
}

export function buildRuntimeTargetBackfillInputs(args: {
  existingTargetIds?: Set<string>;
  featureBuildsByBuildId?: Map<string, FeatureBuildReference>;
  runningContainerIds?: Set<string>;
  sandboxes?: SandboxReference[];
  sandboxSlots?: SandboxSlotReference[];
  gitPromotionCandidates?: GitPromotionCandidateReference[];
}): RuntimeTargetInput[] {
  const existingTargetIds = args.existingTargetIds ?? new Set<string>();
  const runningContainerIds = args.runningContainerIds ?? new Set<string>();
  const featureBuildsByBuildId = args.featureBuildsByBuildId ?? new Map<string, FeatureBuildReference>();
  const inputs: RuntimeTargetInput[] = [];

  for (const sandbox of args.sandboxes ?? []) {
    addIfMissing(inputs, existingTargetIds, {
      targetId: `RT-SANDBOX-${sandbox.id}`,
      kind: "build-sandbox",
      status: sandboxStatus(sandbox.state),
      sandboxId: sandbox.id,
      featureBuildId: featureBuildsByBuildId.get(sandbox.buildId)?.id ?? null,
      hostUrl: sandbox.previewUrl ?? null,
      metadata: {
        buildId: sandbox.buildId,
        providerId: sandbox.providerId,
      },
    });
  }

  for (const slot of args.sandboxSlots ?? []) {
    if (runningContainerIds.has(slot.containerId)) continue;
    addIfMissing(inputs, existingTargetIds, {
      targetId: `RT-SANDBOX-SLOT-${slot.id}`,
      kind: "build-sandbox",
      status: "misconfigured",
      slotId: slot.id,
      serviceName: "sandbox",
      containerName: slot.containerId,
      hostUrl: `http://localhost:${slot.port}`,
      port: slot.port,
      metadata: {
        slotIndex: slot.slotIndex,
        priorStatus: slot.status,
        buildId: slot.buildId ?? null,
        reason: "SandboxSlot row exists without a matching running Compose service.",
      },
    });
  }

  for (const candidate of args.gitPromotionCandidates ?? []) {
    addIfMissing(inputs, existingTargetIds, {
      targetId: `RT-GIT-PROMOTION-${candidate.id}`,
      kind: "git-promotion-sandbox",
      status: gitPromotionStatus(candidate.status),
      sandboxId: candidate.sandboxId ?? null,
      metadata: {
        candidateId: candidate.candidateId,
      },
    });
  }

  return inputs;
}
