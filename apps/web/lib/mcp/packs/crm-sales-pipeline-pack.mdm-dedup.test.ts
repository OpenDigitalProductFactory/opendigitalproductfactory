import { beforeEach, describe, expect, it, vi } from "vitest";

vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "info").mockImplementation(() => undefined);

// The create_customer_account handler dynamically imports @/lib/actions/crm;
// mock the action so these tests pin the TOOL contract (duplicate handling,
// resolution parsing), not the action internals (covered in dedup-gate tests).
const { mockCreateCustomerAccount } = vi.hoisted(() => ({
  mockCreateCustomerAccount: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {},
}));

vi.mock("@/lib/actions/crm", () => ({
  createCustomerAccount: mockCreateCustomerAccount,
}));

import { executeTool } from "@/lib/mcp-tools";

const CANDIDATE = {
  id: "acct-1",
  label: "Emma3D",
  detail: "prospect",
  score: 0.75,
  reasons: [{ attribute: "name", kind: "strong", detail: "~0.85" }],
  recommendation: "likely-duplicate",
};

describe("create_customer_account dedup contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns duplicates_found with compact candidates instead of creating", async () => {
    mockCreateCustomerAccount.mockResolvedValue({
      outcome: "duplicates-found",
      check: { verdict: "likely-duplicate", candidates: [CANDIDATE] },
    });
    const result = await executeTool("create_customer_account", { name: "Emma 3D" }, "user-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("duplicates_found");
    expect(result.message).toContain("Emma3D");
    expect(result.message).toContain("use-existing");
    const data = result.data as { candidates: Array<{ accountId: string; matchedOn: string }> };
    expect(data.candidates[0]?.accountId).toBe("acct-1");
    expect(data.candidates[0]?.matchedOn).toBe("name");
    // No dedup resolution was passed through.
    expect(mockCreateCustomerAccount).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it("passes use-existing through and reports the reused account", async () => {
    mockCreateCustomerAccount.mockResolvedValue({
      outcome: "existing",
      account: { id: "acct-1", accountId: "ACCT-1", name: "Emma3D" },
    });
    const result = await executeTool(
      "create_customer_account",
      { name: "Emma 3D", duplicateResolution: "use-existing:acct-1" },
      "user-1",
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Reused existing");
    expect(mockCreateCustomerAccount).toHaveBeenCalledWith(expect.anything(), {
      kind: "use-existing",
      existingId: "acct-1",
    });
    expect((result.data as { reusedExisting?: boolean }).reusedExisting).toBe(true);
  });

  it("rejects confirm-new without a duplicateReason before touching the action", async () => {
    const result = await executeTool(
      "create_customer_account",
      { name: "Emma 3D", duplicateResolution: "confirm-new" },
      "user-1",
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_duplicate_reason");
    expect(mockCreateCustomerAccount).not.toHaveBeenCalled();
  });

  it("passes confirm-new with its reason through to the action", async () => {
    mockCreateCustomerAccount.mockResolvedValue({
      outcome: "created",
      account: { id: "acct-2", accountId: "ACCT-2", name: "Emma 3D Films" },
    });
    const result = await executeTool(
      "create_customer_account",
      {
        name: "Emma 3D Films",
        duplicateResolution: "confirm-new",
        duplicateReason: "user confirmed different company",
      },
      "user-1",
    );
    expect(result.success).toBe(true);
    expect(mockCreateCustomerAccount).toHaveBeenCalledWith(expect.anything(), {
      kind: "confirm-new",
      reason: "user confirmed different company",
    });
  });
});
