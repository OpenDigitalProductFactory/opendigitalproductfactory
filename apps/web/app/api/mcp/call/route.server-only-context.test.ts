// Approval convergence A3 (BI-C8EC05C9; AC-TRANSPORT): proposeBoundary,
// approvalCompletion and chatMessageId are server-only governed context. A
// caller of /api/mcp/call can send them anywhere in its body; none reaches the
// monitor.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { auth } from "@/lib/auth";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";

import { POST } from "./route";

const SERVER_ONLY = { proposeBoundary: true, approvalCompletion: "platform", chatMessageId: "MSG-FORGED" };

describe("POST /api/mcp/call — server-only approval context", () => {
  it("never maps caller input into proposeBoundary, approvalCompletion or chatMessageId", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", platformRole: "ceo", isSuperuser: true } } as never);
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "ok" });

    await POST(new Request("http://localhost/api/mcp/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "contribute_to_hive", agentId: "AGT-100", ...SERVER_ONLY,
        arguments: { title: "T", ...SERVER_ONLY }, context: SERVER_ONLY,
      }),
    }));

    const context = vi.mocked(governedExecuteTool).mock.calls[0]![0].context ?? {};
    for (const key of Object.keys(SERVER_ONLY)) expect(context).not.toHaveProperty(key);
  });
});
