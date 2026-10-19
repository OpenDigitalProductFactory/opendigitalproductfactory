import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The identifier trap this test exists for (BI-9C384562).
 *
 * `Principal` carries two identifiers:
 *   - `id`           the relational cuid, what foreign keys reference
 *   - `principalId`  the public semantic id
 *
 * Both are `string`, so TypeScript cannot tell them apart, and
 * `principal-linking.ts` says so directly above the two resolvers:
 * "the relational Principal.id used by ... foreign keys ... distinct from the
 * public Principal.principalId returned by resolvePrincipalIdForUser".
 *
 * `DecisionPerspectiveProfileVersion.promotedByPrincipalId` references
 * `Principal.id`. The first build of this action wrote the public id. It
 * typechecked, its unit tests passed against a stubbed store, and the first
 * live click produced a foreign-key violation, a 500 from the server action,
 * and React #441 replacing the page with a crash screen. Nothing was ratified.
 *
 * A stubbed store can never catch that, because the constraint lives in
 * Postgres. What a unit test CAN pin is which resolver the action reaches for,
 * so this asserts exactly that and nothing more.
 */

const resolvePrincipalRecordIdForSessionIdentity = vi.fn();
const resolvePrincipalIdForUser = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/identity/principal-linking", () => ({
  resolvePrincipalRecordIdForSessionIdentity,
  resolvePrincipalIdForUser,
}));
vi.mock("@/lib/actions/shared/guards", () => ({
  requireCapability: vi.fn().mockResolvedValue({ userId: "user-mark" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    decisionPerspectiveProfile: {
      findUnique: vi.fn().mockResolvedValue({
        profileId: "mark-dpf-platform",
        kind: "platform",
        currentVersionId: "mark-dpf-platform-v1",
        status: "active",
      }),
    },
    decisionPerspectiveProfileVersion: {
      findUnique: vi.fn().mockResolvedValue({
        versionId: "mark-dpf-platform-v1",
        promotedByPrincipalId: null,
      }),
      updateMany,
    },
  },
}));

describe("ratifyPolicyVersion writes the relational Principal.id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("resolves the FK-safe identifier, never the public semantic id", async () => {
    resolvePrincipalRecordIdForSessionIdentity.mockResolvedValue("cmt6ejt2909n76mnw1x58fqj1");
    const { ratifyPolicyVersion } = await import("./decision-perspective-ratify");

    const result = await ratifyPolicyVersion({ profileId: "mark-dpf-platform" });

    expect(resolvePrincipalRecordIdForSessionIdentity).toHaveBeenCalledWith({
      type: "admin",
      id: "user-mark",
    });
    // The resolver that returns Principal.principalId must not be the source of
    // a value destined for a Principal.id foreign key.
    expect(resolvePrincipalIdForUser).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { versionId: "mark-dpf-platform-v1", promotedByPrincipalId: null },
      data: { promotedByPrincipalId: "cmt6ejt2909n76mnw1x58fqj1" },
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("refuses rather than writing null when the account has no principal", async () => {
    resolvePrincipalRecordIdForSessionIdentity.mockResolvedValue(null);
    const { ratifyPolicyVersion } = await import("./decision-perspective-ratify");

    const result = await ratifyPolicyVersion({ profileId: "mark-dpf-platform" });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("no principal identity") });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
