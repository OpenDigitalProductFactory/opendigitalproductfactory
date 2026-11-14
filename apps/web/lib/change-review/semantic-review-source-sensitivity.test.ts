import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveBacklogSensitivity } from "@/lib/federation/cross-org-sharing";
import {
  REPOSITORY_VISIBILITY_TTL_MS,
  repositoryVisibility,
  resetSemanticReviewVisibilityCache,
  resolveSemanticReviewRoomSensitivity,
  resolveSemanticReviewRoute,
  semanticReviewRouteSensitivity,
  type SemanticReviewRoomDeps,
} from "./semantic-review-source-sensitivity";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
beforeEach(() => resetSemanticReviewVisibilityCache());

describe("semantic review routing follows the reviewed Workroom (BI-9F620FE1)", () => {
  it.each([
    ["public", "public", "development"],
    ["public", "private", "internal"],
    ["public", "unknown", "internal"],
    ["internal", "public", "internal"],
    ["confidential", "public", "confidential"],
    ["restricted", "public", "restricted"],
    [null, "public", "internal"],
    ["unexpected", "public", "internal"],
  ] as const)("maps room ceiling %s with a %s repository to %s", (ceiling, visibility, expected) => {
    expect(semanticReviewRouteSensitivity(ceiling, visibility)).toBe(expected);
  });

  it("treats platform work as public source and an explicitly confidential platform item as confidential", () => {
    // The room ceiling for a backlog-item room is this rule (room-sensitivity-ceiling.server.ts).
    const platform = effectiveBacklogSensitivity({ sensitivity: "internal", scopeKind: "platform", digitalProductId: null });
    expect(semanticReviewRouteSensitivity(platform, "public")).toBe("development");
    const confidential = effectiveBacklogSensitivity({ sensitivity: "confidential", scopeKind: "platform", digitalProductId: null });
    expect(semanticReviewRouteSensitivity(confidential, "public")).toBe("confidential");
  });

  it("resolves the reviewed room's own ceiling and its own repository", async () => {
    const room = { scopeClaims: [], backlogItemId: "BI-9F620FE1", repositoryFullName: REPO };
    const readRoom = vi.fn(async () => room);
    const ceiling = vi.fn(async () => "public");
    const visibility = vi.fn(async () => "public" as const);
    await expect(resolveSemanticReviewRoomSensitivity("WC-5EA616F6", { readRoom, ceiling, visibility })).resolves.toBe("development");
    expect(readRoom).toHaveBeenCalledWith("WC-5EA616F6");
    expect(ceiling).toHaveBeenCalledWith(room);
    expect(visibility).toHaveBeenCalledWith(REPO);
  });

  it("never asks GitHub for a room that is not public", async () => {
    const visibility = vi.fn(async () => "public" as const);
    await expect(resolveSemanticReviewRoomSensitivity("WC-C", {
      readRoom: async () => ({ scopeClaims: [], backlogItemId: "BI-1", repositoryFullName: REPO }), ceiling: async () => "confidential", visibility,
    })).resolves.toBe("confidential");
    expect(visibility).not.toHaveBeenCalled();
  });

  type ReadRoom = NonNullable<SemanticReviewRoomDeps["readRoom"]>;
  type Ceiling = NonNullable<SemanticReviewRoomDeps["ceiling"]>;
  const fail = async (): Promise<never> => { throw new Error("db down"); };
  const room = async () => ({ scopeClaims: [], backlogItemId: "BI-1", repositoryFullName: REPO });
  const cases: Array<[string, string | undefined, ReadRoom, Ceiling]> = [
    ["no room id", undefined, room, async () => "public"],
    ["a missing room", "WC-GONE", async () => null, async () => "public"],
    ["an unreadable room", "WC-X", fail, async () => "public"],
    ["an unreadable ceiling", "WC-X", room, fail],
  ];
  it.each(cases)("keeps the internal floor for %s", async (_label, capsuleId, readRoom, ceiling) => {
    await expect(resolveSemanticReviewRoomSensitivity(capsuleId, { readRoom, ceiling, visibility: async () => "public" })).resolves.toBe("internal");
  });

  it("keeps the internal floor for a platform room on a private or unreadable repository", async () => {
    for (const answer of ["private", "unknown"] as const) {
      await expect(resolveSemanticReviewRoomSensitivity("WC-FORK", { readRoom: room, ceiling: async () => "public", visibility: async () => answer }))
        .resolves.toBe("internal");
    }
  });
});

describe("the review carries its room's repository record to the payload screen (BI-FC94F754)", () => {
  const room = async () => ({ scopeClaims: [], backlogItemId: "BI-FC94F754", repositoryFullName: REPO });

  it.each([
    ["public", "development"],
    ["private", "internal"],
    ["unknown", "internal"],
  ] as const)("records a %s repository on a public room's route", async (visibility, sensitivity) => {
    await expect(resolveSemanticReviewRoute("WC-1", { readRoom: room, ceiling: async () => "public", visibility: async () => visibility }))
      .resolves.toEqual({ sensitivity, sourceCodeProvenance: { repository: REPO, visibility } });
  });

  it("carries no repository record when the room is not public or names no repository", async () => {
    const visibility = vi.fn(async () => "public" as const);
    await expect(resolveSemanticReviewRoute("WC-1", { readRoom: room, ceiling: async () => "confidential", visibility }))
      .resolves.toEqual({ sensitivity: "confidential" });
    expect(visibility).not.toHaveBeenCalled();
    await expect(resolveSemanticReviewRoute("WC-1", {
      readRoom: async () => ({ scopeClaims: [], backlogItemId: null, repositoryFullName: null }),
      ceiling: async () => "public", visibility,
    })).resolves.toEqual({ sensitivity: "internal" });
  });
});

describe("repository visibility for review provenance", () => {
  it("reuses a public answer within the TTL, asks again after it, and never caches a failed read", async () => {
    const read = vi.fn().mockResolvedValueOnce("unknown").mockResolvedValueOnce("public").mockResolvedValueOnce("private");
    let now = 1_000;
    await expect(repositoryVisibility(REPO, read, () => now)).resolves.toBe("unknown");
    await expect(repositoryVisibility(REPO, read, () => now)).resolves.toBe("public");
    now += REPOSITORY_VISIBILITY_TTL_MS - 1;
    await expect(repositoryVisibility(REPO, read, () => now)).resolves.toBe("public");
    expect(read).toHaveBeenCalledTimes(2);
    now += 2;
    await expect(repositoryVisibility(REPO, read, () => now)).resolves.toBe("private");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("is unknown for a room with no parseable repository", async () => {
    const read = vi.fn();
    await expect(repositoryVisibility(null, read)).resolves.toBe("unknown");
    await expect(repositoryVisibility("not a repo", read)).resolves.toBe("unknown");
    expect(read).not.toHaveBeenCalled();
  });
});
