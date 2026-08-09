import { describe, expect, it } from "vitest";

import { normalizeRecoveryAuthority } from "./recovery-authority";

describe("normalizeRecoveryAuthority", () => {
  it.each([
    ["peer.example", "https://peer.example"],
    ["peer.example:3443", "https://peer.example:3443"],
    ["192.168.0.200", "https://192.168.0.200"],
    ["https://peer.example/", "https://peer.example"],
  ])("normalizes the common operator form %s", (input, expected) => {
    expect(normalizeRecoveryAuthority(input)).toEqual({ ok: true, authorityUrl: expected });
  });

  it("returns field-specific guidance without discarding the entered value", () => {
    expect(normalizeRecoveryAuthority("https://peer.example/connect?token=secret")).toEqual({
      ok: false,
      enteredValue: "https://peer.example/connect?token=secret",
      message: "Enter only the installation host or origin, without a path, query, or fragment.",
    });
  });

  it("refuses credentials and non-HTTP protocols", () => {
    expect(normalizeRecoveryAuthority("https://name:password@peer.example").ok).toBe(false);
    expect(normalizeRecoveryAuthority("file:///etc/passwd").ok).toBe(false);
  });
});
