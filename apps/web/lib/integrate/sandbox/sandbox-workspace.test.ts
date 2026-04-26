// apps/web/lib/integrate/sandbox/sandbox-workspace.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecInSandbox, mockStartSandboxDevServer } = vi.hoisted(() => ({
  mockExecInSandbox: vi.fn(),
  mockStartSandboxDevServer: vi.fn(),
}));

vi.mock("@/lib/sandbox", () => ({
  execInSandbox: mockExecInSandbox,
  startSandboxDevServer: mockStartSandboxDevServer,
}));

import { buildInstallCommands, installDepsAndStart } from "./sandbox-workspace";

describe("buildInstallCommands", () => {
  it("returns the verified workspace install commands in order", () => {
    expect(buildInstallCommands()).toEqual([
      "cd /workspace && pnpm install",
      "cd /workspace && pnpm --filter @dpf/db exec prisma generate",
    ]);
  });

  it("returns a fresh copy each call", () => {
    const a = buildInstallCommands();
    const b = buildInstallCommands();
    expect(a).not.toBe(b);
  });
});

describe("installDepsAndStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecInSandbox.mockResolvedValue("");
    mockStartSandboxDevServer.mockResolvedValue(undefined);
  });

  it("runs workspace install and prisma generation before starting the preview server", async () => {
    await installDepsAndStart("dpf-sandbox-1");

    expect(mockExecInSandbox).toHaveBeenNthCalledWith(1, "dpf-sandbox-1", "cd /workspace && pnpm install");
    expect(mockExecInSandbox).toHaveBeenNthCalledWith(2, "dpf-sandbox-1", "cd /workspace && pnpm --filter @dpf/db exec prisma generate");
    expect(mockStartSandboxDevServer).toHaveBeenCalledWith("dpf-sandbox-1");
  });
});
