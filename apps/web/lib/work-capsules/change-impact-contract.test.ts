import { describe, expect, it, vi } from "vitest";

import { planCapsuleChangeImpact } from "./change-impact-contract";

const existingEdit = {
  kind: "path" as const,
  value: "apps/web/lib/existing.ts",
  intent: "edit" as const,
  recordedAt: "2026-08-08T00:00:00.000Z",
  recordedByPrincipalId: "PRN-1",
};

describe("planCapsuleChangeImpact", () => {
  it("refreshes from the complete edit-path scope and preserves verification state", async () => {
    const build = vi.fn(async (paths: string[]) => ({
      schemaVersion: 1,
      source: "gate-context",
      status: "resolved" as const,
      paths,
      instructions: ["resolve tests before Red"],
    }));
    const result = await planCapsuleChangeImpact({
      scopeClaims: [existingEdit, { ...existingEdit, value: "apps/web/lib/new.ts" }],
      incomingClaims: [{ kind: "path", value: "apps/web/lib/new.ts", intent: "edit" }],
      verificationState: { preserved: true },
      build,
    });

    expect(build).toHaveBeenCalledWith(["apps/web/lib/existing.ts", "apps/web/lib/new.ts"]);
    expect(result.verificationState).toEqual({
      preserved: true,
      changeImpactContract: expect.objectContaining({ status: "resolved" }),
    });
    expect(result.activity).toMatchObject({ kind: "change-impact-planned" });
  });

  it("does nothing for a read-only incoming claim", async () => {
    const build = vi.fn();
    const result = await planCapsuleChangeImpact({
      scopeClaims: [existingEdit],
      incomingClaims: [{ kind: "path", value: "apps/web/lib/read.ts", intent: "read" }],
      verificationState: {},
      build,
    });
    expect(build).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it("turns generator failure into an unresolved exhaustive contract", async () => {
    const result = await planCapsuleChangeImpact({
      scopeClaims: [existingEdit],
      incomingClaims: [{ kind: "path", value: existingEdit.value, intent: "edit" }],
      verificationState: {},
      build: async () => { throw new Error("generator offline"); },
    });
    expect(result.contract).toMatchObject({
      status: "unresolved",
      reason: "generator offline",
      paths: [existingEdit.value],
    });
    expect(result.contract?.instructions.join(" ")).toMatch(/exhaustive verification/i);
  });
});
