import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/mcp-api-token", () => ({
  acknowledgeMcpTokenRefresh: vi.fn(),
}));

import { acknowledgeMcpTokenRefresh } from "@/lib/auth/mcp-api-token";
import { POST } from "./route";

const acknowledgeMock = acknowledgeMcpTokenRefresh as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/mcp/token/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/mcp/token/refresh", () => {
  it("acknowledges a valid replacement token", async () => {
    acknowledgeMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_new",
      prefix: "dpfmcp_NEWS",
      tokenSuffix: "A1B2",
      capability: "write",
      scopes: ["backlog_read", "backlog_write"],
    });

    const response = await POST(makeRequest({ token: "dpfmcp_NEWSECRET" }));

    expect(response.status).toBe(200);
    expect(acknowledgeMock).toHaveBeenCalledWith("dpfmcp_NEWSECRET");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      tokenId: "tok_new",
      prefix: "dpfmcp_NEWS",
      tokenSuffix: "A1B2",
      capability: "write",
      scopes: ["backlog_read", "backlog_write"],
    });
  });

  it("rejects missing token values", async () => {
    const response = await POST(makeRequest({ token: "" }));

    expect(response.status).toBe(400);
    expect(acknowledgeMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "missing_token",
    });
  });

  it("rejects invalid replacement tokens", async () => {
    acknowledgeMock.mockResolvedValue({ ok: false, error: "invalid_token" });

    const response = await POST(makeRequest({ token: "dpfmcp_BAD" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_token",
    });
  });
});
