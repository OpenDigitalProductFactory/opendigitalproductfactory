export const CONNECTOR_ERROR_KINDS = [
  "configuration",
  "authentication",
  "authorization",
  "rate_limited",
  "upstream_unavailable",
  "invalid_payload",
  "not_connected",
  "internal",
] as const;

export type ConnectorErrorKind = (typeof CONNECTOR_ERROR_KINDS)[number];

export type ConnectorErrorOptions = {
  cause?: unknown;
  retryAfterMs?: number;
};

export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly retryAfterMs?: number;

  constructor(kind: ConnectorErrorKind, message: string, options: ConnectorErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ConnectorError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export type ConnectorAttemptFailureKind = ConnectorErrorKind | "cancelled";
export interface ConnectorAttemptFailure {
  status: "failed";
  kind: ConnectorAttemptFailureKind;
  safeMessage: string;
}

export class ConnectorAttemptFailedError extends Error {
  constructor(readonly failure: ConnectorAttemptFailure, options: { cause?: unknown } = {}) {
    super(failure.safeMessage, { cause: options.cause });
    this.name = "ConnectorAttemptFailedError";
  }
}

const SAFE_FAILURE_MESSAGES: Record<ConnectorErrorKind, string> = {
  configuration: "Connector configuration failed.", authentication: "Connector authentication failed.",
  authorization: "Connector authorization failed.", rate_limited: "Connector request was rate limited.",
  upstream_unavailable: "Connector provider is unavailable.", invalid_payload: "Connector payload was invalid.",
  not_connected: "Connector is not connected.", internal: "Connector operation failed.",
};

export function toConnectorAttemptFailure(error: unknown): ConnectorAttemptFailure {
  if (error instanceof ConnectorAttemptFailedError) return error.failure;
  if (error instanceof ConnectorError) {
    return { status: "failed", kind: error.kind, safeMessage: SAFE_FAILURE_MESSAGES[error.kind] };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { status: "failed", kind: "cancelled", safeMessage: "Connector operation was cancelled." };
  }
  return { status: "failed", kind: "internal", safeMessage: SAFE_FAILURE_MESSAGES.internal };
}
