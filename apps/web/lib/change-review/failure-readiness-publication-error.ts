export type FailureReadinessPublicationCode =
  | "no-source-commit" | "repository-mismatch" | "credential-unavailable" | "source-changed" | "http-status";

/**
 * A typed publication refusal, so a retained publication (BI-2A8A8FC8) can tell
 * a fact that will not change by itself (denied, moved source) from a transient
 * one (rate limit, provider error). Messages stay as callers already read them.
 */
export class FailureReadinessPublicationError extends Error {
  readonly httpStatus: number | null;
  readonly rateLimited: boolean;
  constructor(readonly code: FailureReadinessPublicationCode, message: string,
    detail: { httpStatus?: number; rateLimited?: boolean } = {}) {
    super(message);
    this.name = "FailureReadinessPublicationError";
    this.httpStatus = detail.httpStatus ?? null;
    this.rateLimited = detail.rateLimited ?? false;
  }
}
