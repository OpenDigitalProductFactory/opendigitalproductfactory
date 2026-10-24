import { describe, expect, it, vi } from "vitest";

import {
  boundOutput,
  parseFailedGuards,
  readWorktreeTreeSha,
  runGuardGauntlet,
} from "./guard-gauntlet";

const TREE = "a".repeat(40);

/** A fake sandbox exec: matches on substrings of the command it is given. */
function fakeExec(routes: Array<{ when: string; reply: string | Error }>) {
  return vi.fn(async (_containerId: string, command: string) => {
    for (const route of routes) {
      if (command.includes(route.when)) {
        if (route.reply instanceof Error) throw route.reply;
        return route.reply;
      }
    }
    throw new Error(`unexpected command: ${command}`);
  });
}

const PREFLIGHT_FAILURE = `
[pregate-preflight] Module Size Guard…
[pregate-preflight] Prose Lint Guard…
[pregate-preflight] 2 guard(s) FAILED in 67.6s — these are deterministic CI failures; fix them before the sandbox gate runs:
  - Module Size Guard: node scripts/check-module-size.mjs
  - Prose Lint Guard: node scripts/check-prose-lint.mjs
[pregate-preflight] see every constraint that applies to this diff: pnpm gate:context
`;

describe("parseFailedGuards", () => {
  it("names every failing guard from the summary block", () => {
    expect(parseFailedGuards(PREFLIGHT_FAILURE)).toEqual(["Module Size Guard", "Prose Lint Guard"]);
  });

  it("returns nothing for a clean run", () => {
    expect(parseFailedGuards("[pregate-preflight] OK — 67 guards clean in 64.9s")).toEqual([]);
  });

  it("reads the LAST summary when a log contains more than one", () => {
    const twice = `1 guard(s) FAILED\n  - Old Guard: x\n` + PREFLIGHT_FAILURE;
    expect(parseFailedGuards(twice)).toEqual(["Module Size Guard", "Prose Lint Guard"]);
  });
});

describe("boundOutput", () => {
  it("keeps short output verbatim", () => {
    expect(boundOutput("short", 100)).toBe("short");
  });

  it("keeps the TAIL, because the verdict is at the end", () => {
    const bounded = boundOutput("x".repeat(50) + "VERDICT", 10);
    expect(bounded.endsWith("VERDICT")).toBe(true);
    expect(bounded).toContain("earlier characters omitted");
  });
});

describe("readWorktreeTreeSha", () => {
  it("returns the tree sha", async () => {
    const exec = fakeExec([{ when: "rev-parse", reply: `${TREE}\n` }]);
    await expect(readWorktreeTreeSha(exec, "c1", "/workspace/.builds/b1")).resolves.toBe(TREE);
  });

  it("returns null rather than throwing when the worktree has no commit yet", async () => {
    // A legitimate early-build state. Reporting it as a failure would be a
    // verdict about something that was never checked.
    const exec = fakeExec([{ when: "rev-parse", reply: "" }]);
    await expect(readWorktreeTreeSha(exec, "c1", "/w")).resolves.toBeNull();
  });

  it("returns null when git errors", async () => {
    const exec = fakeExec([{ when: "rev-parse", reply: new Error("not a git repository") }]);
    await expect(readWorktreeTreeSha(exec, "c1", "/w")).resolves.toBeNull();
  });
});

describe("runGuardGauntlet", () => {
  const workdir = "/workspace/.builds/b1";

  it("runs in the BUILD's worktree, not the shared root", async () => {
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: "OK — 67 guards clean\n__DPF_GAUNTLET_EXIT__=0" },
    ]);
    await runGuardGauntlet({ exec, containerId: "c1", workdir });

    const gauntletCall = exec.mock.calls.find(([, cmd]) => cmd.includes("pregate-preflight"));
    expect(gauntletCall?.[1]).toContain(`cd '${workdir}'`);
    expect(gauntletCall?.[1]).not.toContain("cd '/workspace' &&");
  });

  it("passes a clean run", async () => {
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: "OK — 67 guards clean\n__DPF_GAUNTLET_EXIT__=0" },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    expect(result).toMatchObject({ ran: true, passed: true, failedGuards: [], treeSha: TREE });
  });

  it("fails with the guards named", async () => {
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: `${PREFLIGHT_FAILURE}\n__DPF_GAUNTLET_EXIT__=1` },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    expect(result).toMatchObject({ ran: true, passed: false });
    expect(result).toHaveProperty("failedGuards", ["Module Size Guard", "Prose Lint Guard"]);
  });

  it("reports a crash as NOT-RUN, never as a failing guard", async () => {
    // A non-zero exit that names no guard is a crash. Rendering it as a finding
    // is the mistake report-only-the-verdict-you-reached exists to prevent.
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: "Error: Cannot find module\n__DPF_GAUNTLET_EXIT__=1" },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    expect(result.ran).toBe(false);
    if (!result.ran) expect(result.reason).toContain("crash");
  });

  it("reports a timeout as NOT-RUN", async () => {
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: "…\n__DPF_GAUNTLET_EXIT__=124" },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    expect(result.ran).toBe(false);
    if (!result.ran) expect(result.reason).toContain("no verdict");
  });

  it("reports a sandbox that could not start the command as NOT-RUN", async () => {
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: new Error("container is not running") },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    expect(result.ran).toBe(false);
    if (!result.ran) expect(result.reason).toContain("could not be started");
  });

  it("reports missing exit status as NOT-RUN rather than guessing", async () => {
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: "output with no sentinel" },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    expect(result.ran).toBe(false);
    if (!result.ran) expect(result.reason).toContain("unknown");
  });

  it("still reaches a verdict when the tree sha cannot be read", async () => {
    // No commit yet is not a reason to withhold the guards' result.
    const exec = fakeExec([
      { when: "rev-parse", reply: new Error("no HEAD") },
      { when: "pregate-preflight", reply: "OK\n__DPF_GAUNTLET_EXIT__=0" },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    expect(result).toMatchObject({ ran: true, passed: true, treeSha: null });
  });

  it("strips the exit sentinel from the kept output", async () => {
    const exec = fakeExec([
      { when: "rev-parse", reply: TREE },
      { when: "pregate-preflight", reply: "clean\n__DPF_GAUNTLET_EXIT__=0" },
    ]);
    const result = await runGuardGauntlet({ exec, containerId: "c1", workdir });
    if (result.ran) expect(result.output).not.toContain("__DPF_GAUNTLET_EXIT__");
  });
});

describe("guardPlanDigest", () => {
  it("depends ONLY on the plan, never on the outcome", async () => {
    // A consumer has to derive the same key before it knows the result, in order
    // to look the record up. Hashing the outcome in would make the key
    // derivable only by the producer, which defeats keying it at all.
    const { guardPlanDigest } = await import("./guard-gauntlet");
    expect(guardPlanDigest("scripts/pregate-preflight.mjs"))
      .toBe(guardPlanDigest("scripts/pregate-preflight.mjs"));
  });

  it("distinguishes different plans", async () => {
    const { guardPlanDigest } = await import("./guard-gauntlet");
    expect(guardPlanDigest("scripts/a.mjs")).not.toBe(guardPlanDigest("scripts/b.mjs"));
  });

  it("is a 64-hex digest the gate identity will accept", async () => {
    const { guardPlanDigest } = await import("./guard-gauntlet");
    expect(guardPlanDigest("scripts/pregate-preflight.mjs")).toMatch(/^[0-9a-f]{64}$/);
  });
});
