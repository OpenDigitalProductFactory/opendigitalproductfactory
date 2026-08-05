import { beforeEach, describe, expect, it, vi } from "vitest";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { policyPack } from "./policy-pack";

const EXPECTED_TOOLS = [
  "list_policies",
  "get_policy",
  "create_policy",
  "update_policy",
  "request_policy_review",
] as const;

vi.mock("@dpf/db", () => ({
  prisma: {
    policy: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("policyPack (BI-3CDEC5F0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers expected tools and grant mirrors", () => {
    expect(policyPack.definitions.map((d) => d.name).sort()).toEqual(
      [...EXPECTED_TOOLS].sort(),
    );
    expect(Object.keys(policyPack.handlers).sort()).toEqual(
      [...EXPECTED_TOOLS].sort(),
    );
    expect(policyPack.grants.list_policies).toEqual(["policy_read"]);
    expect(policyPack.grants.get_policy).toEqual(["policy_read"]);
    expect(policyPack.grants.create_policy).toEqual(["policy_write"]);
    expect(policyPack.grants.update_policy).toEqual(["policy_write"]);
    expect(policyPack.grants.request_policy_review).toEqual(["policy_write"]);
    expect(isToolAllowedByGrants("create_policy", ["policy_write"])).toBe(true);
    expect(isToolAllowedByGrants("create_policy", ["policy_read"])).toBe(false);
    expect(isToolAllowedByGrants("list_policies", ["policy_read"])).toBe(true);
  });

  it("create_policy always creates draft and sets agentId", async () => {
    vi.mocked(prisma.policy.create).mockResolvedValue({
      id: "cuid1",
      policyId: "POL-TEST1234",
      title: "US Remote Work Policy",
      category: "hr",
      lifecycleStatus: "draft",
    } as never);

    const res = await policyPack.handlers.create_policy(
      {
        title: "US Remote Work Policy",
        category: "hr",
        body: "## Purpose\n…",
        notes: "Audience: US-based employees only",
      },
      "user-1",
      { agentId: "hr-specialist" },
    );

    expect(res.success).toBe(true);
    expect(res.message).toMatch(/DRAFT/i);
    expect(res.message).toMatch(/compliance\/policies/);
    expect(prisma.policy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "US Remote Work Policy",
          category: "hr",
          lifecycleStatus: "draft",
          agentId: "hr-specialist",
          notes: "Audience: US-based employees only",
        }),
      }),
    );
  });

  it("create_policy only claims a US audience when notes actually name one", async () => {
    // A substring test for "us" fires on "business", "must", "use" — and would
    // report an audience the operator never captured. Word boundaries only.
    vi.mocked(prisma.policy.create).mockResolvedValue({
      id: "cuid2",
      policyId: "POL-TEST5678",
      title: "Expense Policy",
      category: "operations",
      lifecycleStatus: "draft",
    } as never);

    const misleading = await policyPack.handlers.create_policy(
      {
        title: "Expense Policy",
        category: "operations",
        notes: "Applies to the whole business; users must use the portal.",
      },
      "user-1",
    );
    expect(misleading.success).toBe(true);
    expect(misleading.message).not.toMatch(/Intended US audience/i);
    expect(misleading.message).toMatch(/Add intended audience/i);

    const genuine = await policyPack.handlers.create_policy(
      {
        title: "Expense Policy",
        category: "operations",
        notes: "Audience: US employees only.",
      },
      "user-1",
    );
    expect(genuine.message).toMatch(/Intended US audience/i);
  });

  it("create_policy rejects bad category", async () => {
    const res = await policyPack.handlers.create_policy(
      { title: "X", category: "not-a-category" },
      "user-1",
    );
    expect(res.success).toBe(false);
    expect(prisma.policy.create).not.toHaveBeenCalled();
  });

  it("update_policy refuses published policies", async () => {
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      id: "cuid1",
      policyId: "POL-1",
      title: "Published",
      category: "hr",
      lifecycleStatus: "published",
      agentId: null,
    } as never);

    const res = await policyPack.handlers.update_policy(
      { policyId: "POL-1", body: "new" },
      "user-1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_state");
    expect(prisma.policy.update).not.toHaveBeenCalled();
  });

  it("request_policy_review moves draft to in-review only", async () => {
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      id: "cuid1",
      policyId: "POL-1",
      title: "Draft",
      category: "hr",
      lifecycleStatus: "draft",
    } as never);
    vi.mocked(prisma.policy.update).mockResolvedValue({
      id: "cuid1",
      policyId: "POL-1",
      lifecycleStatus: "in-review",
    } as never);

    const res = await policyPack.handlers.request_policy_review(
      { policyId: "POL-1" },
      "user-1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/in-review/);
    expect(res.message).toMatch(/cannot publish/i);
    expect(prisma.policy.update).toHaveBeenCalledWith({
      where: { id: "cuid1" },
      data: { lifecycleStatus: "in-review" },
    });
  });

  it("list_policies returns empty-friendly message", async () => {
    vi.mocked(prisma.policy.findMany).mockResolvedValue([]);
    const res = await policyPack.handlers.list_policies(
      { category: "hr" },
      "user-1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/No policies/);
  });
});
