// BI-D22D4607: stale-tab deployment-skew detection for the crash boundary.
// BI-F381D902: identity comparison + event-aware matcher for the global sentinel.
import { describe, expect, it } from "vitest";
import {
  isBundleMismatch,
  isDeploymentSkewError,
  isDeploymentSkewReason,
  skewMessageFromReason,
} from "./deployment-skew";

describe("isDeploymentSkewError", () => {
  it.each([
    // The sanitized client message for a server-action POST from a stale build
    // (observed live 2026-07-06 on /platform/ai/providers).
    "An unexpected response was received from the server.",
    // The unsanitized/dev variant.
    'Failed to find Server Action "40438dc2ee5ee1121df725ff060ef501218f794264". This request might be from an older or newer deployment.',
    // Stale hashed assets after the image swap.
    "Loading chunk 4523 failed. (error: https://portal/_next/static/chunks/4523.js)",
    "ChunkLoadError: Loading chunk app/layout failed.",
    "Failed to fetch dynamically imported module: https://portal/_next/x.js",
    "Importing a module script failed.",
  ])("matches skew signature: %s", (msg) => {
    expect(isDeploymentSkewError(msg)).toBe(true);
  });

  it.each([
    // Generic network failures must NOT trigger a reload — reloading doesn't
    // fix an offline portal, and it would loop against the sessionStorage
    // guard's window on every navigation.
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "connect ECONNREFUSED 127.0.0.1:3000",
    // Ordinary crashes stay on the crash screen.
    "Cannot read properties of undefined (reading 'split')",
    "",
  ])("does not match non-skew error: %s", (msg) => {
    expect(isDeploymentSkewError(msg)).toBe(false);
  });

  it("handles null/undefined", () => {
    expect(isDeploymentSkewError(null)).toBe(false);
    expect(isDeploymentSkewError(undefined)).toBe(false);
  });
});

describe("skewMessageFromReason", () => {
  it("extracts a message from Error, string, ErrorEvent-like, and rejection-like objects", () => {
    expect(skewMessageFromReason("plain string")).toBe("plain string");
    expect(skewMessageFromReason(new Error("boom"))).toBe("boom");
    // ErrorEvent shape.
    expect(skewMessageFromReason({ message: "evented" })).toBe("evented");
    // PromiseRejectionEvent shape → unwrap .reason.
    expect(skewMessageFromReason({ reason: new Error("rejected") })).toBe("rejected");
    // Wrapped .error.
    expect(skewMessageFromReason({ error: "wrapped" })).toBe("wrapped");
  });

  it("returns empty string for values it cannot read", () => {
    expect(skewMessageFromReason(null)).toBe("");
    expect(skewMessageFromReason(undefined)).toBe("");
    expect(skewMessageFromReason(42)).toBe("");
    expect(skewMessageFromReason({})).toBe("");
  });
});

describe("isDeploymentSkewReason", () => {
  it("matches skew inside Error, ErrorEvent, and PromiseRejectionEvent shapes", () => {
    expect(
      isDeploymentSkewReason(new Error("An unexpected response was received from the server.")),
    ).toBe(true);
    // ErrorEvent.
    expect(isDeploymentSkewReason({ message: "ChunkLoadError: Loading chunk 4 failed." })).toBe(true);
    // PromiseRejectionEvent.reason as an Error.
    expect(
      isDeploymentSkewReason({
        reason: new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'),
      }),
    ).toBe(true);
  });

  it("ignores non-skew reasons", () => {
    expect(isDeploymentSkewReason(new Error("Failed to fetch"))).toBe(false);
    expect(isDeploymentSkewReason({ message: "Cannot read properties of undefined" })).toBe(false);
    expect(isDeploymentSkewReason(null)).toBe(false);
  });
});

describe("isBundleMismatch", () => {
  it("is true when a known bundleHash or version changed", () => {
    expect(
      isBundleMismatch({ version: "1", bundleHash: "aaa" }, { version: "1", bundleHash: "bbb" }),
    ).toBe(true);
    expect(
      isBundleMismatch({ version: "1", bundleHash: "aaa" }, { version: "2", bundleHash: "aaa" }),
    ).toBe(true);
  });

  it("is false when identities match", () => {
    expect(
      isBundleMismatch({ version: "1", bundleHash: "aaa" }, { version: "1", bundleHash: "aaa" }),
    ).toBe(false);
  });

  it("never treats 'unknown' or missing values as a mismatch (anti-loop invariant)", () => {
    // `next dev` reports "unknown" on both sides — must not loop-reload.
    expect(
      isBundleMismatch({ version: "unknown", bundleHash: "unknown" }, { version: "unknown", bundleHash: "unknown" }),
    ).toBe(false);
    // One side unknown → indeterminate, not a mismatch.
    expect(
      isBundleMismatch({ version: "1", bundleHash: "unknown" }, { version: "1", bundleHash: "bbb" }),
    ).toBe(false);
    expect(
      isBundleMismatch({ bundleHash: "aaa" }, { bundleHash: null }),
    ).toBe(false);
    expect(isBundleMismatch(null, { bundleHash: "aaa" })).toBe(false);
    expect(isBundleMismatch({ bundleHash: "aaa" }, null)).toBe(false);
  });
});
