// Tests for the retry-classification helper used by runEnrollment().
// Behaviour: aborts and transient network errors are retryable;
// AuthorityHttpError (deterministic operator-action errors) is not.

import { describe, expect, it } from "vitest";

import { AuthorityHttpError } from "../api-client";
import { isRetryableEnrollError } from "../enroll";

describe("isRetryableEnrollError", () => {
  it("retries undici AbortError (per-call timeout fired)", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    expect(isRetryableEnrollError(err)).toBe(true);
  });

  it("retries undici socket / connect / body timeout", () => {
    for (const msg of [
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
    ]) {
      expect(isRetryableEnrollError(new Error(`fetch failed: ${msg}`))).toBe(true);
    }
  });

  it("retries common DNS / TCP transient errors", () => {
    for (const msg of [
      "ECONNREFUSED 127.0.0.1:3000",
      "ECONNRESET",
      "EAI_AGAIN authority.example",
      "ETIMEDOUT",
      "fetch failed",
    ]) {
      expect(isRetryableEnrollError(new Error(msg))).toBe(true);
    }
  });

  it("does NOT retry AuthorityHttpError — deterministic operator-action errors", () => {
    // token_already_consumed → wait-mode (handled in index.ts)
    expect(isRetryableEnrollError(
      new AuthorityHttpError(401, "token_already_consumed", "bootstrap token has already been consumed"),
    )).toBe(false);
    expect(isRetryableEnrollError(
      new AuthorityHttpError(403, "token_expired", "expired"),
    )).toBe(false);
    // Even a 500 from the portal is non-retryable here — the retry is
    // intended for client-side transients, not server-side errors that
    // the operator likely needs to investigate.
    expect(isRetryableEnrollError(
      new AuthorityHttpError(500, undefined, "internal server error"),
    )).toBe(false);
  });

  it("does NOT retry non-Error values", () => {
    expect(isRetryableEnrollError("boom")).toBe(false);
    expect(isRetryableEnrollError(null)).toBe(false);
    expect(isRetryableEnrollError(undefined)).toBe(false);
  });

  it("does NOT retry an unrecognized error message", () => {
    expect(isRetryableEnrollError(new Error("something else"))).toBe(false);
  });
});
