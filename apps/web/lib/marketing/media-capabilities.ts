import type {
  ApprovedTool,
  EvaluationStatus,
} from "../evaluate/tool-evaluation";

/**
 * Vendor-neutral creative operations. Keep this list smaller than any one
 * provider's API: it is the stable routing boundary used by marketing.
 */
export const MEDIA_CAPABILITIES = [
  "image-generation",
  "video-generation",
  "text-to-speech",
  "captions",
  "editing",
  "reframing",
  "provenance",
] as const;

export type MarketingMediaCapability = (typeof MEDIA_CAPABILITIES)[number];
export type MediaCapabilitySupport =
  | "supported"
  | "conditional"
  | "unsupported";
export type MediaEnvironment = ApprovedTool["environments"][number];

export type MarketingMediaProviderDescriptor = {
  providerId: string;
  displayName: string;
  evaluationId: string;
  evaluationStatus: EvaluationStatus;
  environments: ReadonlyArray<MediaEnvironment>;
  capabilities: Readonly<Record<MarketingMediaCapability, MediaCapabilitySupport>>;
  deterministic: boolean;
  offline: boolean;
  conditions: ReadonlyArray<string>;
};

export type MarketingMediaOperationRequest = {
  capability: MarketingMediaCapability;
  environment: MediaEnvironment;
  requireDeterministic?: boolean;
  requireOffline?: boolean;
  requireProvenance?: boolean;
};

export type MediaOperationAccepted = {
  ok: true;
  providerId: string;
  capability: MarketingMediaCapability;
  evaluationId: string;
  conditions: ReadonlyArray<string>;
};

export type MediaOperationRefusalReason =
  | "evaluation-not-active"
  | "environment-not-approved"
  | "capability-not-supported"
  | "adapter-not-implemented"
  | "determinism-not-supported"
  | "offline-not-supported"
  | "provenance-not-supported";

export type MediaOperationUnsupported = {
  ok: false;
  code: "UNSUPPORTED_OPERATION";
  providerId: string;
  capability: MarketingMediaCapability;
  reason: MediaOperationRefusalReason;
  message: string;
};

export type MediaOperationResolution =
  | MediaOperationAccepted
  | MediaOperationUnsupported;

const ACTIVE_EVALUATION_STATUSES = new Set<EvaluationStatus>([
  "approved",
  "conditional",
]);

const REFUSAL_MESSAGES: Record<MediaOperationRefusalReason, string> = {
  "evaluation-not-active":
    "The provider does not have an active approved or conditional ToolEvaluation.",
  "environment-not-approved":
    "The provider was not evaluated for the requested environment.",
  "capability-not-supported":
    "The provider does not advertise the requested media capability.",
  "adapter-not-implemented":
    "The provider advertises this capability but has no executable adapter operation.",
  "determinism-not-supported":
    "The provider does not guarantee deterministic replay for this operation.",
  "offline-not-supported":
    "The provider cannot perform this operation without external data egress.",
  "provenance-not-supported":
    "The provider does not advertise provenance or Content Credentials support.",
};

function unsupported(
  provider: MarketingMediaProviderDescriptor,
  request: MarketingMediaOperationRequest,
  reason: MediaOperationRefusalReason,
): MediaOperationUnsupported {
  return {
    ok: false,
    code: "UNSUPPORTED_OPERATION",
    providerId: provider.providerId,
    capability: request.capability,
    reason,
    message: REFUSAL_MESSAGES[reason],
  };
}

/**
 * Resolve one provider before invoking vendor code. This function deliberately
 * has no fallback side effects: callers may try another evaluated descriptor,
 * while every refusal remains explainable and auditable.
 */
export function resolveMediaOperation(
  provider: MarketingMediaProviderDescriptor,
  request: MarketingMediaOperationRequest,
): MediaOperationResolution {
  if (!ACTIVE_EVALUATION_STATUSES.has(provider.evaluationStatus)) {
    return unsupported(provider, request, "evaluation-not-active");
  }

  if (!provider.environments.includes(request.environment)) {
    return unsupported(provider, request, "environment-not-approved");
  }

  if (provider.capabilities[request.capability] === "unsupported") {
    return unsupported(provider, request, "capability-not-supported");
  }

  if (request.requireDeterministic && !provider.deterministic) {
    return unsupported(provider, request, "determinism-not-supported");
  }

  if (request.requireOffline && !provider.offline) {
    return unsupported(provider, request, "offline-not-supported");
  }

  if (
    request.requireProvenance &&
    provider.capabilities.provenance === "unsupported"
  ) {
    return unsupported(provider, request, "provenance-not-supported");
  }

  return {
    ok: true,
    providerId: provider.providerId,
    capability: request.capability,
    evaluationId: provider.evaluationId,
    conditions: provider.conditions,
  };
}

export type MarketingMediaOperationInput = {
  organizationId: string;
  instructions: string;
  sourceAssetIds: ReadonlyArray<string>;
};

export type MarketingMediaOperationOutput = {
  assetId: string;
  mimeType: string;
  sha256: string;
  providerMetadata?: Readonly<Record<string, unknown>>;
};

export type MarketingMediaOperationHandler = (
  input: MarketingMediaOperationInput,
) => Promise<MarketingMediaOperationOutput>;

export interface MarketingMediaProviderAdapter {
  readonly descriptor: MarketingMediaProviderDescriptor;
  readonly operations: Readonly<
    Partial<Record<MarketingMediaCapability, MarketingMediaOperationHandler>>
  >;
}

export type MediaOperationExecution =
  | MediaOperationUnsupported
  | (MediaOperationAccepted & { output: MarketingMediaOperationOutput });

/**
 * The one side-effect boundary for media providers. A capability flag without
 * a matching handler fails closed, preventing registration drift from becoming
 * a runtime undefined-method failure.
 */
export async function invokeMediaOperation(
  adapter: MarketingMediaProviderAdapter,
  request: MarketingMediaOperationRequest,
  input: MarketingMediaOperationInput,
): Promise<MediaOperationExecution> {
  const resolution = resolveMediaOperation(adapter.descriptor, request);
  if (!resolution.ok) return resolution;

  const operation = adapter.operations[request.capability];
  if (!operation) {
    return unsupported(adapter.descriptor, request, "adapter-not-implemented");
  }

  return { ...resolution, output: await operation(input) };
}
