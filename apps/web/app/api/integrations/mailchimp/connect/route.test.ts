import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConnectMailchimp } = vi.hoisted(() => ({
  mockConnectMailchimp: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { platformRole: "superadmin", isSuperuser: true },
  })),
}));

vi.mock("@/lib/integrate/mailchimp/connect-action", () => ({
  connectMailchimp: mockConnectMailchimp,
}));

function createRequest(body: unknown) {
  return new Request("http://test/api/integrations/mailchimp/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/integrations/mailchimp/connect", () => {
  beforeEach(() => {
    mockConnectMailchimp.mockReset();
  });

  it("returns a connected response when the connect action succeeds", async () => {
    mockConnectMailchimp.mockResolvedValue({
      ok: true,
      status: "connected",
      serverPrefix: "us21",
      accountName: "Acme Growth",
      lastTestedAt: "2026-04-24T20:00:00.000Z",
    });

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        apiKey: "secret-us21",
        serverPrefix: "us21",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "connected",
      serverPrefix: "us21",
    });
  });

  it("returns an error response when the connect action fails", async () => {
    mockConnectMailchimp.mockResolvedValue({
      ok: false,
      status: "error",
      error: "invalid Mailchimp credentials",
      statusCode: 400,
    });

    const { POST } = await import("./route");
    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid Mailchimp credentials",
    });
  });
});
