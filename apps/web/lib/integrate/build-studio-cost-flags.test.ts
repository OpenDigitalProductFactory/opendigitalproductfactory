import { describe, it, expect } from "vitest";
import { resolveActivationFlag } from "./build-studio-config";

describe("resolveActivationFlag — cost-flag activation precedence (BI-9E0595E7)", () => {
  it("defaults ON when neither env nor config is set (activation)", () => {
    expect(resolveActivationFlag(undefined, null)).toBe(true);
  });

  it("env kill-switch (0/false) wins over everything, including a true config", () => {
    expect(resolveActivationFlag("0", true)).toBe(false);
    expect(resolveActivationFlag("false", "true")).toBe(false);
  });

  it("env force-on (1/true) wins over a false config", () => {
    expect(resolveActivationFlag("1", false)).toBe(true);
    expect(resolveActivationFlag("true", "false")).toBe(true);
  });

  it("PlatformConfig disables when env is unset and config is explicitly false", () => {
    expect(resolveActivationFlag(undefined, false)).toBe(false);
    expect(resolveActivationFlag(undefined, "false")).toBe(false);
    expect(resolveActivationFlag(undefined, "0")).toBe(false);
  });

  it("PlatformConfig can also explicitly enable", () => {
    expect(resolveActivationFlag(undefined, true)).toBe(true);
    expect(resolveActivationFlag(undefined, "1")).toBe(true);
  });

  it("fails open to the default (ON) on a malformed/absent config value", () => {
    expect(resolveActivationFlag(undefined, "garbage")).toBe(true);
    expect(resolveActivationFlag(undefined, {})).toBe(true);
    expect(resolveActivationFlag(undefined, null)).toBe(true);
  });

  it("respects an explicit non-default (off) baseline when requested", () => {
    expect(resolveActivationFlag(undefined, null, false)).toBe(false);
    // env/config still override the baseline.
    expect(resolveActivationFlag("1", null, false)).toBe(true);
    expect(resolveActivationFlag(undefined, true, false)).toBe(true);
  });
});
