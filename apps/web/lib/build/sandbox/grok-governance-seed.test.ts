import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sandboxGrokHooksCommand } from "./grok-governance-seed";

const PACK = resolve(__dirname, "../../../../../packages/dpf-skill-pack");

describe("sandboxGrokHooksCommand (BI-413882E5)", () => {
  it("runs the pack's own generator against the managed copy and writes the sandbox hook file", () => {
    const command = sandboxGrokHooksCommand("/home/node/pack", "/home/node/.grok/hooks/dpf-guards.json");
    expect(command).toContain('node "/home/node/pack/hooks/lib/grok-hook-plane.mjs" "/home/node/pack" "/home/node/pack/hooks"');
    expect(command).toContain('--out "/home/node/.grok/hooks/dpf-guards.json"');
    expect(command).toContain("NO-GENERATOR");
  });

  it("carries no single quote, so docker exec sh -c '...' expands nothing outside the sandbox", () => {
    expect(sandboxGrokHooksCommand()).not.toContain("'");
    expect(sandboxGrokHooksCommand()).not.toContain("$(");
  });
});

describe("grok-hook-plane.mjs --out (the generator the sandbox runs)", () => {
  it("writes hooks.json's Grok plane, not a hand-kept list", () => {
    const out = join(mkdtempSync(join(tmpdir(), "grok-plane-")), "hooks", "dpf-guards.json");
    const printed = execFileSync(
      process.execPath,
      [join(PACK, "hooks", "lib", "grok-hook-plane.mjs"), PACK, "/home/node/pack/hooks", "--out", out],
      { encoding: "utf8" },
    );
    const payload = JSON.parse(readFileSync(out, "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    const count = Object.values(payload.hooks).flat().reduce((n, g) => n + g.hooks.length, 0);
    expect(printed.trim()).toBe(`WIRED ${count}`);

    const shell = payload.hooks.PreToolUse.find((g) => g.matcher?.includes("run_terminal_command"));
    const write = payload.hooks.PreToolUse.find((g) => g.matcher?.includes("search_replace"));
    const names = (g?: { hooks: Array<{ command: string }> }) => (g?.hooks ?? []).map((h) => h.command);
    // The two guards the hand-kept lists dropped, and the heartbeat the janitor needs.
    expect(names(shell).some((c) => c.includes("raw-tool-guard.mjs"))).toBe(true);
    expect(names(write).some((c) => c.includes("root-clone-guard.mjs"))).toBe(true);
    expect(names(payload.hooks.Stop[0]).length + names(payload.hooks.Stop[1]).length).toBe(2);
    expect(JSON.stringify(payload)).toContain("worktree-session-heartbeat.mjs");
    expect(JSON.stringify(payload)).not.toContain("${CLAUDE_PLUGIN_ROOT}");
  });
});
