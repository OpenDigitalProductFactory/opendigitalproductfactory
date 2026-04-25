import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockProbeMailchimpAccount } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockProbeMailchimpAccount: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
}));

vi.mock("./client", () => ({
  probeMailchimpAccount: mockProbeMailchimpAccount,
}));

import { loadMailchimpPreview } from "./preview";

describe("loadMailchimpPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockProbeMailchimpAccount.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns unavailable when no credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(loadMailchimpPreview()).resolves.toEqual({ state: "unavailable" });
  });

  it("refreshes preview data and updates the credential state", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "mailchimp-marketing",
      fieldsEnc: JSON.stringify({
        apiKey: "secret-us21",
        serverPrefix: "us21",
      }),
    });
    mockProbeMailchimpAccount.mockResolvedValue({
      account: { accountName: "Acme Growth" },
      audiences: [{ id: "list-1", name: "Austin Leads" }],
      campaigns: [{ id: "cmp-1", status: "save", settings: { title: "April Follow-up" } }],
    });

    const result = await loadMailchimpPreview();

    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected available preview");
    expect(result.preview.account.accountName).toBe("Acme Growth");
    expect(result.preview.audiences[0]?.id).toBe("list-1");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("connected");
  });
});
