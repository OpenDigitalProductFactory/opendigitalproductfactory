export type ConnectorSetupStatus = "unconfigured" | "connected" | "error" | "degraded";

export type ConnectorSafeScalar = string | number | boolean | null;
export type ConnectorSafeValue =
  | ConnectorSafeScalar
  | ConnectorSafeValue[]
  | { [key: string]: ConnectorSafeValue };
export type ConnectorSafeProjection = { [key: string]: ConnectorSafeValue };

export interface ConnectorSetupState {
  integrationId: string;
  provider: string | null;
  status: ConnectorSetupStatus;
  safeProjection: ConnectorSafeProjection;
  lastErrorMsg: string | null;
  lastTestedAt: Date | null;
}

export interface ConnectorSetupStateSource {
  integrationId: string;
  provider: string;
  status: string;
  safeProjection: ConnectorSafeProjection;
  lastErrorMsg: string | null;
  lastTestedAt: Date | null;
}

export interface ConnectorHealthInput {
  latestProbeFailed?: boolean;
}

export function projectConnectorSetupState(
  source: ConnectorSetupStateSource | null,
  integrationId: string,
  health: ConnectorHealthInput = {},
): ConnectorSetupState {
  if (!source) {
    return {
      integrationId,
      provider: null,
      status: "unconfigured",
      safeProjection: {},
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }

  const status: ConnectorSetupStatus =
    source.status === "connected"
      ? health.latestProbeFailed
        ? "degraded"
        : "connected"
      : source.status === "unconfigured"
        ? "unconfigured"
        : "error";

  return { ...source, status };
}
