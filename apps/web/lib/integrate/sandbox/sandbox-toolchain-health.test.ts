import { describe, expect, it } from "vitest";
import {
  classifyToolchainFailure,
  interpretVersionProbe,
  isRestorableSignature,
} from "./sandbox-toolchain-health";

describe("classifyToolchainFailure", () => {
  it("recognizes a rolldown native-binding failure", () => {
    const out = "Error: failed to load native binding\n  at rolldown ...";
    const result = classifyToolchainFailure(out);
    expect(result.signature).toBe("native-binding");
    expect(result.diagnosis).toMatch(/native binding/i);
  });

  it("recognizes vitest-not-found", () => {
    expect(classifyToolchainFailure("sh: 1: vitest: not found").signature).toBe("vitest-missing");
    expect(classifyToolchainFailure("command not found: vitest").signature).toBe("vitest-missing");
  });

  it("recognizes a module-load failure", () => {
    expect(classifyToolchainFailure("Error [ERR_MODULE_NOT_FOUND]: ...").signature).toBe("module-load");
    expect(classifyToolchainFailure("Cannot find module 'tinypool'").signature).toBe("module-load");
  });

  it("recognizes out-of-memory", () => {
    expect(classifyToolchainFailure("FATAL ERROR: JavaScript heap out of memory").signature).toBe("out-of-memory");
  });

  it("returns null for a normal test pass", () => {
    expect(classifyToolchainFailure("Test Files  3 passed (3)\nTests  12 passed").signature).toBeNull();
  });

  it("returns null for an ordinary test failure (not a toolchain problem)", () => {
    expect(classifyToolchainFailure("FAIL src/foo.test.ts > does a thing\nexpected 1 to be 2").signature).toBeNull();
  });
});

describe("isRestorableSignature", () => {
  it("treats node_modules-corruption signatures as restorable", () => {
    expect(isRestorableSignature("native-binding")).toBe(true);
    expect(isRestorableSignature("vitest-missing")).toBe(true);
    expect(isRestorableSignature("module-load")).toBe(true);
  });

  it("does not restore for out-of-memory or no failure", () => {
    expect(isRestorableSignature("out-of-memory")).toBe(false);
    expect(isRestorableSignature(null)).toBe(false);
  });
});

describe("interpretVersionProbe", () => {
  it("is healthy when a version string is printed", () => {
    const probe = interpretVersionProbe("4.0.1");
    expect(probe.healthy).toBe(true);
    expect(probe.signature).toBeNull();
  });

  it("is unhealthy with a signature when the probe shows a load failure", () => {
    const probe = interpretVersionProbe("Error: failed to load native binding (rolldown)");
    expect(probe.healthy).toBe(false);
    expect(probe.signature).toBe("native-binding");
  });

  it("treats a version-less, signature-less probe as a module-load failure", () => {
    const probe = interpretVersionProbe("");
    expect(probe.healthy).toBe(false);
    expect(probe.signature).toBe("module-load");
  });
});
