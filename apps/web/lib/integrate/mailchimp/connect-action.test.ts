import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockProbeMailchimpAccount } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockProbeMailchimpAccount: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      upsert: mockUpsert,
    },
  },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("./client", () => ({
  MailchimpApiError: class MailchimpApiError extends Error {},
  probeMailchimpAccount: mockProbeMailchimpAccount,
}));

import { connectMailchimp } from "./connect-action";

describe("connectMailchimp", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockProbeMailchimpAccount.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it("persists encrypted credentials and account summary on success", async () => {
    mockProbeMailchimpAccount.mockResolvedValue({
      account: {
        accountName: "Acme Growth",
        loginName: "owner@example.com",
        email: "owner@example.com",
      },
      audiences: [],
      campaigns: [],
    });

    const result = await connectMailchimp({
      apiKey: "secret-us21",
      serverPrefix: "us21",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      serverPrefix: "us21",
      accountName: "Acme Growth",
    });
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("mailchimp-marketing");
    expect(call.create.provider).toBe("mailchimp");
    expect(call.create.status).toBe("connected");
  });

  it("stores error state when probing fails", async () => {
    mockProbeMailchimpAccount.mockRejectedValue(new Error("invalid Mailchimp credentials"));

    const result = await connectMailchimp({
      apiKey: "secret-us21",
      serverPrefix: "us21",
    });

    expect(result).toEqual({
      ok: false,
      status: "error",
      error: "invalid Mailchimp credentials",
      statusCode: 400,
    });
    expect(mockUpsert.mock.calls[0][0].create.status).toBe("error");
  });

  it("rejects invalid input before persistence", async () => {
    const result = await connectMailchimp({
      apiKey: "",
      serverPrefix: "",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: "error",
      statusCode: 400,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
