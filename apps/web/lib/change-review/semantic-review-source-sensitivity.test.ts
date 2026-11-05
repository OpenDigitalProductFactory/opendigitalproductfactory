import { describe, expect, it, vi } from "vitest";
import { effectiveBacklogSensitivity } from "@/lib/federation/cross-org-sharing";
import { resolveSemanticReviewRoomSensitivity, semanticReviewRouteSensitivity, type SemanticReviewRoomDeps } from "./semantic-review-source-sensitivity";

describe("semantic review routing follows the reviewed Workroom (BI-9F620FE1)", () => {
  it.each([
    ["public", "development"],
    ["internal", "internal"],
    ["confidential", "confidential"],
    ["restricted", "restricted"],
    [null, "internal"],
    ["unexpected", "internal"],
  ] as const)("maps room ceiling %s to %s", (ceiling, expected) => {
    expect(semanticReviewRouteSensitivity(ceiling)).toBe(expected);
  });

  it("treats platform work as public source and an explicitly confidential platform item as confidential", () => {
    // The room ceiling for a backlog-item room is this rule (room-sensitivity-ceiling.server.ts).
    const platform = effectiveBacklogSensitivity({ sensitivity: "internal", scopeKind: "platform", digitalProductId: null });
    expect(semanticReviewRouteSensitivity(platform)).toBe("development");
    const confidential = effectiveBacklogSensitivity({ sensitivity: "confidential", scopeKind: "platform", digitalProductId: null });
    expect(semanticReviewRouteSensitivity(confidential)).toBe("confidential");
  });

  it("resolves the reviewed room's own ceiling", async () => {
    const room = { scopeClaims: [], backlogItemId: "BI-9F620FE1" };
    const readRoom = vi.fn(async () => room);
    const ceiling = vi.fn(async () => "public");
    await expect(resolveSemanticReviewRoomSensitivity("WC-5EA616F6", { readRoom, ceiling })).resolves.toBe("development");
    expect(readRoom).toHaveBeenCalledWith("WC-5EA616F6");
    expect(ceiling).toHaveBeenCalledWith(room);
  });

  type ReadRoom = NonNullable<SemanticReviewRoomDeps["readRoom"]>;
  type Ceiling = NonNullable<SemanticReviewRoomDeps["ceiling"]>;
  const fail = async (): Promise<never> => { throw new Error("db down"); };
  const cases: Array<[string, string | undefined, ReadRoom, Ceiling]> = [
    ["no room id", undefined, async () => ({ scopeClaims: [], backlogItemId: null }), async () => "public"],
    ["a missing room", "WC-GONE", async () => null, async () => "public"],
    ["an unreadable room", "WC-X", fail, async () => "public"],
    ["an unreadable ceiling", "WC-X", async () => ({ scopeClaims: [], backlogItemId: "BI-1" }), fail],
  ];
  it.each(cases)("keeps the internal floor for %s", async (_label, capsuleId, readRoom, ceiling) => {
    await expect(resolveSemanticReviewRoomSensitivity(capsuleId, { readRoom, ceiling })).resolves.toBe("internal");
  });
});
