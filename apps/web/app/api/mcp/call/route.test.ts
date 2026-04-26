import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { POST } from "./route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const govMock = governedExecuteTool as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/mcp/call", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  authMock.mockReset();
  govMock.mockReset();
});

afterEach(() => {
  authMock.mockReset();
  govMock.mockReset();
});

describe("POST /api/mcp/call", () => {
  it("returns 401 when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ name: "query_backlog" }));
    expect(res.status).toBe(401);
    expect(govMock).not.toHaveBeenCalled();
  });

  it("returns 400 when tool name is missing", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", platformRole: "ceo", isSuperuser: true },
    });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(govMock).not.toHaveBeenCalled();
  });

  it("calls governedExecuteTool with source='rest' and the user's identity", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", platformRole: "ceo", isSuperuser: true },
    });
    govMock.mockResolvedValue({ success: true, message: "ok" });

    const res = await POST(
      makeRequest({
        name: "query_backlog",
        arguments: { status: "open" },
        agentId: "AGT-100",
      }),
    );
    expect(res.status).toBe(200);
    expect(govMock).toHaveBeenCalledOnce();
    const callArg = govMock.mock.calls[0]![0];
    expect(callArg.toolName).toBe("query_backlog");
    expect(callArg.userId).toBe("u1");
    expect(callArg.source).toBe("rest");
    expect(callArg.context.agentId).toBe("AGT-100");
  });

  it("maps unknown_tool to 404", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", platformRole: "ceo", isSuperuser: true },
    });
    govMock.mockResolvedValue({
      success: false,
      error: "unknown_tool",
      message: "Unknown tool: bogus",
      governance: { rejected: "unknown_tool" },
    });
    const res = await POST(makeRequest({ name: "bogus" }));
    expect(res.status).toBe(404);
  });

  it("maps forbidden_capability to 403", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", platformRole: "viewer", isSuperuser: false },
    });
    govMock.mockResolvedValue({
      success: false,
      error: "forbidden_capability",
      message: "rejected",
      governance: { rejected: "forbidden_capability" },
    });
    const res = await POST(makeRequest({ name: "create_backlog_item" }));
    expect(res.status).toBe(403);
  });

  it("maps forbidden_grant to 403", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", platformRole: "ceo", isSuperuser: true },
    });
    govMock.mockResolvedValue({
      success: false,
      error: "forbidden_grant",
      message: "rejected",
      governance: { rejected: "forbidden_grant" },
    });
    const res = await POST(
      makeRequest({ name: "create_backlog_item", agentId: "AGT-NoGrant" }),
    );
    expect(res.status).toBe(403);
  });
});
