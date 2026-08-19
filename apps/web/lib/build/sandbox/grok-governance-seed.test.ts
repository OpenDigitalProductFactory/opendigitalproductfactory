import { describe, expect, it } from "vitest";
import { buildSandboxGrokHooksPayload } from "./grok-governance-seed";

describe("buildSandboxGrokHooksPayload (BI-C5F9A232)", () => {
  it("wires PreToolUse guards plus SessionStart and Stop/SessionEnd", () => {
    const payload = buildSandboxGrokHooksPayload("/home/node/.agents/plugins/plugins/dpf-platform/hooks");
    expect(payload.hooks.PreToolUse).toHaveLength(6);
    const cmds = payload.hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command));
    expect(cmds.some((c) => c.includes("lease-guard.mjs"))).toBe(true);
    expect(cmds.some((c) => c.includes("plan-backlog-coverage-guard.mjs"))).toBe(true);

    const session = payload.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    expect(session.some((c) => c.includes("grok-session-start.mjs"))).toBe(true);

    const stop = payload.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
    expect(stop.some((c) => c.includes("uncommitted-work-guard.mjs"))).toBe(true);
    expect(payload.hooks.SessionEnd).toEqual(payload.hooks.Stop);
  });

  it("uses absolute node commands against the managed hooks dir", () => {
    const dir = "/opt/dpf/hooks";
    const payload = buildSandboxGrokHooksPayload(dir);
    for (const group of payload.hooks.PreToolUse) {
      for (const hook of group.hooks) {
        expect(hook.command).toContain(`node "${dir}/`);
        expect(hook.type).toBe("command");
      }
    }
  });
});
