import { describe, expect, it, vi } from "vitest";

// Every Grok sandbox line must read as a canonical-sandbox exec request in the
// qualified portal (BI-224F56F1); a line the host check refuses would fail there.
const lines = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/workroom-runtime/sandbox-exec", async (load) => ({
  ...await load<object>(),
  execSandboxCommandLine: async (line: string) => { lines.push(line); return { stdout: line.includes("test -d") ? "OK\n" : "SYNCED\n", stderr: "" }; },
}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { grokDeviceLoginComplete, grokDeviceLoginStart } from "@/lib/build/grok-device-login-core";
import { ensureSandboxGrokGovernance } from "./grok-governance-seed";

describe("Grok sandbox lines under the host command check", () => {
  it("each line splits into plain words and a canonical sandbox exec", async () => {
    vi.useFakeTimers();
    const started = grokDeviceLoginStart();
    await vi.runAllTimersAsync();
    await started;
    vi.useRealTimers();
    await grokDeviceLoginComplete();
    await ensureSandboxGrokGovernance({ containerId: "dpf-sandbox-1" }).catch(() => undefined);
    const { sandboxExecOwnerFor, splitHostCommand } = await vi.importActual<typeof import("@/lib/workroom-runtime/sandbox-exec")>("@/lib/workroom-runtime/sandbox-exec");
    expect(lines.length).toBeGreaterThan(5);
    for (const line of new Set(lines)) {
      const argv = splitHostCommand(line);
      expect(argv, line).not.toBeNull();
      expect(sandboxExecOwnerFor(argv!.slice(1)), line).not.toBeNull();
    }
  });
});
