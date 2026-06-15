import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    browserSessionBinding: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    toolExecution: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { M2PluginDriver, type SidecarTransport } from "./means-m2-plugin";
import { prisma } from "@dpf/db";
import type { BrowserOpenInput } from "./driver";

const ctx = { userId: "svc-1", agentId: "marketing", threadId: "th-1" };

const openInput = (over: Partial<BrowserOpenInput> = {}): BrowserOpenInput => ({
  profileKind: "service-account",
  profileRef: "/profiles/browser-svc:substack:default/substack/",
  actingPrincipalId: "browser-svc:substack:default",
  targetDomains: ["substack.com"],
  delegatingUserId: "user-1",
  agentId: ctx.agentId,
  threadId: ctx.threadId,
  ...over,
});

describe("M2PluginDriver (EP-BROWSER-DRIVE Phase 3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("open() passes profile + allowlist to the sidecar, creates a binding, and returns the sidecar session id", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const transport: SidecarTransport = async (tool, args) => {
      calls.push([tool, args]);
      return tool === "browse_open" ? { session_id: "abc123" } : {};
    };
    const driver = new M2PluginDriver(transport, ctx);

    const handle = await driver.open(openInput());

    expect(handle.sessionId).toBe("abc123");
    expect(handle.means).toBe("plugin");
    expect(calls[0][0]).toBe("browse_open");
    expect(calls[0][1].profile_path).toBe("/profiles/browser-svc:substack:default/substack/");
    expect(calls[0][1].target_domains).toEqual(["substack.com"]);
    expect(prisma.browserSessionBinding.create).toHaveBeenCalledTimes(1);
    expect(prisma.toolExecution.create).toHaveBeenCalledTimes(1);
  });

  it("act() with an approved envelope records executionMode 'proposal' + the envelope id", async () => {
    const transport: SidecarTransport = async (tool) =>
      tool === "browse_open" ? { session_id: "s1" } : { status: "completed", result: "clicked" };
    const driver = new M2PluginDriver(transport, ctx);
    const handle = await driver.open(openInput());
    vi.mocked(prisma.toolExecution.create).mockClear();

    const res = await driver.act(handle, "click the Publish button", { envelopeId: "env-9" });

    expect(res.status).toBe("completed");
    const data = vi.mocked(prisma.toolExecution.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.executionMode).toBe("proposal");
    expect(data.envelopeId).toBe("env-9");
    expect(data.toolName).toBe("mcp-browser-use__browse_act");
  });

  it("act() without an envelope on an unattended service-account session is executionMode 'immediate'", async () => {
    const transport: SidecarTransport = async (tool) =>
      tool === "browse_open" ? { session_id: "s2" } : { status: "completed" };
    const driver = new M2PluginDriver(transport, ctx);
    const handle = await driver.open(openInput({ attended: false }));
    vi.mocked(prisma.toolExecution.create).mockClear();

    await driver.act(handle, "scroll to the editor");
    const data = vi.mocked(prisma.toolExecution.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.executionMode).toBe("immediate");
  });

  it("act() surfaces a sidecar 'blocked' (off-allowlist) result without marking success", async () => {
    const transport: SidecarTransport = async (tool) =>
      tool === "browse_open" ? { session_id: "s3" } : { status: "blocked", error: "left the allowlist" };
    const driver = new M2PluginDriver(transport, ctx);
    const handle = await driver.open(openInput());
    vi.mocked(prisma.toolExecution.create).mockClear();

    const res = await driver.act(handle, "go to evil.com");
    expect(res.status).toBe("blocked");
    const data = vi.mocked(prisma.toolExecution.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.success).toBe(false);
  });
});
