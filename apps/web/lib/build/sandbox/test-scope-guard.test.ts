// BI-F5D4FA50: an agent's unscoped test run in the sandbox is refused, a scoped
// one is allowed, and every decision inside the sandbox is recorded.
import { describe, expect, it } from "vitest";
import {
  classifyShellTestCommand,
  classifyTestArgs,
  enforceSandboxTestScope,
  unscopedTestRefusal,
} from "./test-scope-guard";

describe("classifyShellTestCommand", () => {
  it.each([
    // The FB-86FAED68 command.
    "pnpm exec vitest run --reporter=dot | tee /tmp/vitest_full.log",
    "pnpm exec vitest run --reporter dot",
    "cd apps/web && npx vitest run",
    "pnpm --filter web exec vitest run",
    "pnpm vitest",
    "pnpm test",
    "pnpm run test",
    "pnpm --filter web test",
    "npm test -- --reporter=verbose",
    "CI=true pnpm exec jest --ci",
    "cd apps/mobile && pnpm exec jest --ci --maxWorkers 2",
    "pnpm exec vitest run -t 'creates a build'",
    "pnpm exec vitest run --shard=1/4",
  ])("refuses unscoped: %s", (command) => {
    expect(classifyShellTestCommand(command).kind).toBe("unscoped");
  });

  it.each([
    'pnpm exec vitest run "lib/build/coding-agent.test.ts"',
    "cd apps/web && pnpm exec vitest run lib/build/coding-agent.test.ts --reporter=verbose",
    "pnpm --filter web exec vitest run lib/x.test.ts",
    "pnpm exec vitest related lib/build/coding-agent.ts",
    "pnpm exec vitest run --changed",
    "pnpm test -- lib/x.test.ts",
    "pnpm exec jest --ci src/capture.test.ts",
    "pnpm exec jest --findRelatedTests src/capture.ts",
  ])("allows scoped: %s", (command) => {
    expect(classifyShellTestCommand(command).kind).toBe("scoped");
  });

  it.each([
    "pnpm exec tsc --noEmit",
    "git diff",
    "NODE_ENV=production pnpm --filter web build",
    "pnpm exec vitest --version",
    "pnpm exec vitest list",
    "grep -rn vitest apps/web/package.json",
  ])("ignores non-test commands: %s", (command) => {
    expect(classifyShellTestCommand(command).kind).toBe("not-a-test-run");
  });

  it("finds an unscoped run chained after a scoped one", () => {
    expect(classifyShellTestCommand("pnpm exec vitest run lib/a.test.ts && pnpm exec vitest run").kind).toBe("unscoped");
  });
});

describe("classifyTestArgs", () => {
  it("does not read an option value as a file filter", () => {
    expect(classifyTestArgs("vitest", ["run", "--project", "web"]).kind).toBe("unscoped");
    expect(classifyTestArgs("vitest", ["run", "--project=web", "lib/a.test.ts"]).kind).toBe("scoped");
  });
});

describe("enforceSandboxTestScope", () => {
  const vitestArgv = (...args: string[]) => ["/usr/local/bin/node", "/workspace/node_modules/vitest/vitest.mjs", ...args];

  it("is a no-op outside the sandbox", () => {
    const lines: string[] = [];
    const out = enforceSandboxTestScope({ runner: "vitest", argv: vitestArgv("run"), env: {}, cwd: "/repo", appendRecord: (_p, l) => lines.push(l) });
    expect(out).toBeNull();
    expect(lines).toEqual([]);
  });

  it("refuses an unscoped run in the sandbox and records the refusal", () => {
    const lines: string[] = [];
    const env = { DPF_SANDBOX_TEST_SCOPE: "enforce", DPF_SANDBOX_TEST_SCOPE_LOG: "/tmp/guard.jsonl" };
    expect(() =>
      enforceSandboxTestScope({ runner: "vitest", argv: vitestArgv("run", "--reporter=dot"), env, cwd: "/workspace/.builds/FB-1/apps/web", appendRecord: (p, l) => lines.push(`${p}\t${l}`), now: () => new Date("2026-10-08T03:40:00Z") }),
    ).toThrow(/run_sandbox_tests/);
    expect(lines).toHaveLength(1);
    const [path, json] = lines[0].split("\t");
    expect(path).toBe("/tmp/guard.jsonl");
    expect(JSON.parse(json)).toEqual({ at: "2026-10-08T03:40:00.000Z", runner: "vitest", decision: "refused", cwd: "/workspace/.builds/FB-1/apps/web", args: ["run", "--reporter=dot"] });
  });

  it("recognises the vitest bin on a Windows path", () => {
    const argv = ["C:\\Program Files\\nodejs\\node.exe", "D:\\w\\node_modules\\.bin\\..\\vitest\\vitest.mjs", "run", "--reporter=dot"];
    expect(() => enforceSandboxTestScope({ runner: "vitest", argv, env: { DPF_SANDBOX_TEST_SCOPE: "enforce" }, cwd: "D:\\w", appendRecord: () => {} })).toThrow(/Refused/);
  });

  it("allows and records a scoped run in the sandbox", () => {
    const lines: string[] = [];
    const out = enforceSandboxTestScope({ runner: "vitest", argv: vitestArgv("run", "lib/a.test.ts"), env: { DPF_SANDBOX_TEST_SCOPE: "enforce" }, cwd: "/w", appendRecord: (_p, l) => lines.push(l) });
    expect(out?.kind).toBe("scoped");
    expect(JSON.parse(lines[0]).decision).toBe("allowed");
  });

  it("still refuses when the record cannot be written", () => {
    expect(() =>
      enforceSandboxTestScope({ runner: "vitest", argv: vitestArgv("run"), env: { DPF_SANDBOX_TEST_SCOPE: "enforce" }, cwd: "/w", appendRecord: () => { throw new Error("EROFS"); } }),
    ).toThrow(/Refused/);
  });
});

describe("unscopedTestRefusal", () => {
  it("names the scoped tool and the scoped command", () => {
    expect(unscopedTestRefusal("jest")).toMatch(/run_sandbox_tests.*pnpm exec jest --ci <test files>/);
    expect(unscopedTestRefusal("vitest")).toMatch(/cloud CI and the merge queue/);
  });
});

describe("sandbox tool descriptions", () => {
  it("describe run_sandbox_tests as scoped", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const pack = readFileSync(resolve(__dirname, "../../mcp/packs/sandbox-pack.ts"), "utf8");
    const line = pack.split("\n").find((l, i, all) => all[i - 1]?.includes('name: "run_sandbox_tests"'));
    expect(line).toMatch(/SCOPED tests/);
    expect(line).not.toMatch(/full test suite/i);
  });
});
