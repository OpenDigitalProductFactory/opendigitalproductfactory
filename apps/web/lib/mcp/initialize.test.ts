import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readInstallHostProfile: vi.fn() }));

vi.mock("@/lib/install/host-profile", () => ({
  readInstallHostProfile: mocks.readInstallHostProfile,
}));
vi.mock("@/lib/mcp/org-context-bundle", () => ({
  buildOrgContextBundle: vi.fn().mockResolvedValue({}),
  formatOrgContextInstructions: vi.fn((base: string) => `${base}\n\nORGANIZATION CONTEXT`),
}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { buildMcpInitializeResult } from "./initialize";

describe("buildMcpInitializeResult", () => {
  beforeEach(() => {
    mocks.readInstallHostProfile.mockResolvedValue({
      kind: "consumer",
      installMode: "consumer",
      sourceCapable: false,
      releaseImage: true,
      reason: "consumer-release-install",
    });
  });

  it("orders progressive disclosure, host boundaries, then organization context", async () => {
    const result = await buildMcpInitializeResult({
      authority: {
        scope: "write",
        scopes: ["sandbox_execute", "work_capsule_adopt"],
      },
    });
    const instructions = String(result.instructions);

    expect(instructions).toContain("CONSUMER RUNTIME HOST");
    expect(instructions).toContain("effective authority: development");
    expect(instructions.indexOf("DPF discloses MCP tools progressively")).toBeLessThan(
      instructions.indexOf("CONSUMER RUNTIME HOST"),
    );
    expect(instructions.indexOf("CONSUMER RUNTIME HOST")).toBeLessThan(
      instructions.indexOf("ORGANIZATION CONTEXT"),
    );
  });
});
