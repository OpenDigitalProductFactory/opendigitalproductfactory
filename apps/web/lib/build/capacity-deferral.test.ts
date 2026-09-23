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
});
