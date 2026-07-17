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
