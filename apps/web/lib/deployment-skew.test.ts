// BI-D22D4607: stale-tab deployment-skew detection for the crash boundary.
import { describe, expect, it } from "vitest";
import { isDeploymentSkewError } from "./deployment-skew";

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
