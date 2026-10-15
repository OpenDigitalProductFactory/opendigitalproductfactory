import { describe, expect, it } from "vitest";
import { ADMISSION_TIMEOUT_CODE } from "@/lib/inference/inference-admission";
import { describeCapacityDeferral } from "./capacity-deferral";

describe("describeCapacityDeferral (BI-5098ECEC)", () => {
  it("names a local-CI reservation and its expected free time", () => {
    const err = Object.assign(new Error("Local provider dispatch deferred: local-ci-active-capacity-reservation"), {
      name: "LocalProviderCapacityDeferredError",
      expectedFreeAt: new Date("2026-09-22T23:34:06.940Z"),
    });
    const d = describeCapacityDeferral(err);
    expect(d?.expectedFreeAt?.toISOString()).toBe("2026-09-22T23:34:06.940Z");
    expect(d?.message).toMatch(/not a model verdict/);
    expect(d?.message).toMatch(/2026-09-22T23:34:06/);
  });

  it("recognises an inference admission timeout", () => {
    const err = Object.assign(new Error("inference admission timeout"), { code: ADMISSION_TIMEOUT_CODE });
    expect(describeCapacityDeferral(err)?.message).toMatch(/slot/);
  });

  it("leaves a real engine failure alone", () => {
    expect(describeCapacityDeferral(new Error("Codex CLI exit code 1: boom"))).toBeNull();
    expect(describeCapacityDeferral("string")).toBeNull();
  });

  it("names a busy host GPU without the local-CI sentence", () => {
    const err = Object.assign(new Error("Local provider dispatch deferred: host-gpu-busy"), {
      name: "LocalProviderCapacityDeferredError",
      reason: "host-gpu-busy",
    });
    const message = describeCapacityDeferral(err)?.message ?? "";
    expect(message).toMatch(/another program/);
    expect(message).toMatch(/not a model verdict/);
    expect(message).not.toMatch(/local-CI/);
  });

  it("names another local request that already holds the GPU", () => {
    const err = Object.assign(new Error("Local provider dispatch deferred: local-runner-busy"), {
      name: "LocalProviderCapacityDeferredError",
      reason: "local-runner-busy",
    });
    expect(describeCapacityDeferral(err)?.message).toMatch(/already holds the GPU/);
  });

  it("unwraps a mixed fallback chain whose cause is the GPU deferral", () => {
    const cause = Object.assign(new Error("Local provider dispatch deferred: host-gpu-busy"), {
      name: "LocalProviderCapacityDeferredError",
      reason: "host-gpu-busy",
    });
    const wrapped = new Error("All endpoints failed for code-gen. Attempts: []", { cause });
    expect(describeCapacityDeferral(wrapped)?.message).toMatch(/another program/);
  });
});
