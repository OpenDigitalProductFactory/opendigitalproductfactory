// apps/web/lib/build/coding-agent.test.ts
// Regression tests for null-brief guard in buildCodeGenPrompt.
// FB-71FB3A53: builds whose FeatureBuild.brief is null (ideate phase never
// completed) crashed stepGenerateCode with "Cannot read properties of null
// (reading 'title')".

import { vi, describe, it, expect } from "vitest";
import type { FeatureBrief } from "@/lib/feature-build-types";

// Mock server-only dependencies that coding-agent.ts imports at module level
// so the pure buildCodeGenPrompt function can be exercised in isolation.
vi.mock("@/lib/sandbox", () => ({ execInSandbox: vi.fn() }));
vi.mock("@/lib/ai-provider-priority", () => ({ getProviderPriority: vi.fn() }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

const { buildCodeGenPrompt } = await import("./coding-agent");

describe("buildCodeGenPrompt", () => {
  it("does not throw when brief is null (FB-71FB3A53 regression)", () => {
    expect(() => buildCodeGenPrompt(null, {})).not.toThrow();
  });

  it("returns a non-empty prompt when brief is null", () => {
    const result = buildCodeGenPrompt(null, {});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses fallback placeholders when brief is null", () => {
    const result = buildCodeGenPrompt(null, {});
    expect(result).toContain("(no title)");
    expect(result).toContain("Not specified");
  });

  it("includes brief fields when brief is provided", () => {
    const brief: FeatureBrief = {
      title: "Ollama backend build",
      description: "Adds Ollama as a local AI provider",
      portfolioContext: "platform",
      targetRoles: ["Admin"],
      inputs: [],
      dataNeeds: "None",
      acceptanceCriteria: ["Ollama routes requests", "Health check passes"],
    };
    const result = buildCodeGenPrompt(brief, {});
    expect(result).toContain("Ollama backend build");
    expect(result).toContain("Adds Ollama as a local AI provider");
    expect(result).toContain("Ollama routes requests");
    expect(result).toContain("Health check passes");
  });

  it("handles an empty plan without throwing", () => {
    expect(() => buildCodeGenPrompt(null, {})).not.toThrow();
    expect(() => buildCodeGenPrompt(null, { fileStructure: [], tasks: [] })).not.toThrow();
  });
});

const { deriveScopedTestFiles, groupTestFilesByPackage } = await import("./coding-agent");

describe("deriveScopedTestFiles", () => {
  it("includes changed test files directly", () => {
    expect(deriveScopedTestFiles(["apps/web/lib/utils/string-helpers.test.ts"]))
      .toContain("apps/web/lib/utils/string-helpers.test.ts");
  });

  it("derives sibling test candidates for a changed source file", () => {
    const result = deriveScopedTestFiles(["apps/web/lib/utils/string-helpers.ts"]);
    expect(result).toContain("apps/web/lib/utils/string-helpers.test.ts");
    expect(result).toContain("apps/web/lib/utils/string-helpers.test.tsx");
  });

  it("returns an empty list when nothing testable changed", () => {
    expect(deriveScopedTestFiles(["README.md", "package.json", ""])).toEqual([]);
  });

  it("does not duplicate when both source and its test changed", () => {
    const result = deriveScopedTestFiles([
      "apps/web/lib/utils/string-helpers.ts",
      "apps/web/lib/utils/string-helpers.test.ts",
    ]);
    const occurrences = result.filter((p) => p === "apps/web/lib/utils/string-helpers.test.ts");
    expect(occurrences).toHaveLength(1);
  });
});

describe("groupTestFilesByPackage", () => {
  it("groups files by their apps/* or packages/* workspace root", () => {
    const grouped = groupTestFilesByPackage([
      "apps/web/lib/a.test.ts",
      "apps/web/lib/b.test.ts",
      "packages/db/src/c.test.ts",
    ]);
    expect(grouped.get("apps/web")).toEqual(["lib/a.test.ts", "lib/b.test.ts"]);
    expect(grouped.get("packages/db")).toEqual(["src/c.test.ts"]);
  });

  it("ignores paths outside a workspace package", () => {
    const grouped = groupTestFilesByPackage(["scripts/x.test.ts", "foo.test.ts"]);
    expect(grouped.size).toBe(0);
  });
});

const { outputIndicatesTestFailure } = await import("./coding-agent");

describe("outputIndicatesTestFailure", () => {
  it("detects failures in ANSI-colored vitest output (regression: color code defeats \\b)", () => {
    // The real bug: `\x1b[31m` ends in "m" (a word char) directly before the
    // digit, so `\b[1-9]` never matches a colored "3 failed". This exact string
    // returned false before the ANSI strip.
    const ansi = " Tests \x1b[22m \x1b[1m\x1b[31m3 failed\x1b[39m\x1b[2m | \x1b[22m\x1b[1m\x1b[32m2 passed\x1b[39m (5)";
    expect(outputIndicatesTestFailure(ansi)).toBe(true);
  });

  it("returns false for an all-passing ANSI summary", () => {
    const ansi = " Tests \x1b[1m\x1b[32m5 passed\x1b[39m (5)";
    expect(outputIndicatesTestFailure(ansi)).toBe(false);
  });

  it("detects an ANSI FAIL marker line", () => {
    const ansi = "\x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m lib/utils/string-helpers.test.ts";
    expect(outputIndicatesTestFailure(ansi)).toBe(true);
  });

  it("works on plain (non-colored) output too", () => {
    expect(outputIndicatesTestFailure("Tests  3 failed | 2 passed")).toBe(true);
    expect(outputIndicatesTestFailure("Tests  5 passed (5)")).toBe(false);
  });
});

// BI-CEE688D6: with changed files and no covering test, no suite runs and the
// result says so; the whole-suite fallback crashed in the sandbox and was
// recorded as passing tests.
describe("runSandboxTests without a covering test file", () => {
  it("runs no suite and reports scope none", async () => {
    const { execInSandbox } = await import("@/lib/sandbox");
    const exec = vi.mocked(execInSandbox);
    exec.mockReset();
    exec.mockImplementation(async (_id: string, cmd: string) => cmd.startsWith("test -f") ? "__no__" : "");
    const { runSandboxTests } = await import("./coding-agent");
    const out = await runSandboxTests("c1", { changedFiles: ["apps/mobile/src/capture.ts"], workdir: "/workspace/.builds/FB-1" });
    expect(out.scope).toBe("none");
    expect(out.testOutput).toMatch(/no tests ran/);
    expect(exec.mock.calls.map(([, cmd]) => cmd).some((cmd) => /pnpm test/.test(cmd))).toBe(false);
  });
});

// BI-6F67D5FA: FB-0C05A927's mobile tests were run with `npx vitest`, which
// cannot resolve apps/mobile's `@/` alias (Jest/jest-expo does), so every build
// touching the mobile app failed review whatever its code. Each package runs
// the runner its package.json declares, through pnpm exec.
describe("runSandboxTests picks each package's own test runner", () => {
  async function run(packageJsons: Record<string, string>, outputs: { jest?: string; vitest?: string; exit?: number }) {
    const { execInSandbox } = await import("@/lib/sandbox");
    const exec = vi.mocked(execInSandbox);
    exec.mockReset();
    exec.mockImplementation(async (_id: string, cmd: string) => {
      if (cmd.startsWith("test -f")) return "__yes__";
      const cat = /cat "([^"]+)\/package\.json"/.exec(cmd);
      if (cat) return packageJsons[cat[1]!] ?? "";
      if (/pnpm exec jest/.test(cmd)) return `${outputs.jest ?? "Tests: 2 passed, 2 total"}\n__dpf_exit=${outputs.exit ?? 0}`;
      if (/pnpm exec vitest run/.test(cmd)) return `${outputs.vitest ?? "Test Files  1 passed (1)"}\n__dpf_exit=${outputs.exit ?? 0}`;
      return "";
    });
    const { runSandboxTests } = await import("./coding-agent");
    const result = await runSandboxTests("c1", {
      changedFiles: ["apps/mobile/src/features/visitor/visitor.store.ts", "apps/web/lib/x.ts"],
      workdir: "/workspace/.builds/FB-1",
    });
    return { result, commands: exec.mock.calls.map(([, cmd]) => cmd) };
  }

  const mobile = JSON.stringify({ name: "mobile", scripts: { test: "jest" }, devDependencies: { jest: "~30.5.2", "jest-expo": "~57.0.5" } });
  const web = JSON.stringify({ name: "web", scripts: { test: "vitest run" }, devDependencies: { vitest: "4.1.11" } });
  const pkgs = { "/workspace/.builds/FB-1/apps/mobile": mobile, "/workspace/.builds/FB-1/apps/web": web };

  it("runs a Jest package under Jest and a Vitest package under Vitest, never through npx", async () => {
    const { result, commands } = await run(pkgs, {});
    expect(commands.some((cmd) => /cd \/workspace\/\.builds\/FB-1\/apps\/mobile && .*pnpm exec jest --ci .*visitor\.store\.test\.ts/.test(cmd))).toBe(true);
    expect(commands.some((cmd) => /cd \/workspace\/\.builds\/FB-1\/apps\/web && .*pnpm exec vitest run /.test(cmd))).toBe(true);
    expect(commands.filter((cmd) => /vitest|jest/.test(cmd)).some((cmd) => /npx /.test(cmd))).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("treats a non-zero runner exit as a failure even when the output names no failure", async () => {
    const { result } = await run(pkgs, { jest: "Error: Cannot find module 'jest-expo/jest-preset'", exit: 1 });
    expect(result.passed).toBe(false);
  });
});

// FB-0C05A927 (2026-10-07) was escalated because its mobile changes were never
// type-checked: verification ran `tsc` in apps/web only, so the review rightly
// found "Mobile TypeScript compilation not verified" and no repair could add it.
describe("runSandboxTests type-checks every package the change touches", () => {
  async function run(changedFiles: string[], tsc: Record<string, string> = {}) {
    const { execInSandbox } = await import("@/lib/sandbox");
    const exec = vi.mocked(execInSandbox);
    exec.mockReset();
    exec.mockImplementation(async (_id: string, cmd: string) => {
      if (cmd.startsWith("test -f")) return "__no__";
      const pkg = /cd \/workspace\/\.builds\/FB-1\/([^ ]+) && pnpm exec tsc --noEmit/.exec(cmd)?.[1];
      if (pkg) return tsc[pkg] ?? "";
      return "";
    });
    const { runSandboxTests } = await import("./coding-agent");
    const result = await runSandboxTests("c1", { changedFiles, workdir: "/workspace/.builds/FB-1" });
    return { result, commands: exec.mock.calls.map(([, cmd]) => cmd) };
  }

  it("checks apps/mobile as well as apps/web when mobile files change, never through npx", async () => {
    const { commands } = await run(["apps/mobile/src/features/visitor/visitor.store.ts"]);
    const tsc = commands.filter((cmd) => /tsc --noEmit/.test(cmd));
    expect(tsc.some((cmd) => cmd.includes("/apps/mobile && pnpm exec tsc --noEmit"))).toBe(true);
    expect(tsc.some((cmd) => cmd.includes("/apps/web && pnpm exec tsc --noEmit"))).toBe(true);
    expect(tsc.some((cmd) => /npx /.test(cmd))).toBe(false);
  });

  it("fails on a type error in a changed mobile file, reported relative to the package", async () => {
    const { result } = await run(["apps/mobile/src/features/visitor/visitor.store.ts"], {
      "apps/mobile": "src/features/visitor/visitor.store.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    });
    expect(result.typeCheckPassed).toBe(false);
    expect(result.typeCheckOutput).toMatch(/# apps\/mobile/);
  });

  it("ignores a pre-existing error in an unchanged file of a touched package", async () => {
    const { result } = await run(["apps/mobile/src/features/visitor/visitor.store.ts"], {
      "apps/mobile": "src/features/agent/agent.store.ts(3,1): error TS2304: Cannot find name 'x'.",
    });
    expect(result.typeCheckPassed).toBe(true);
  });
});

// apps/mobile is its own pnpm workspace (own lockfile; excluded from the root
// workspace), so the sandbox's root install never installs it: tsc and jest are
// "not found" there. Verification installs a separately-locked package first.
describe("runSandboxTests installs a separately-locked package before checking it", () => {
  it("installs apps/mobile from its own lockfile before type-checking and testing it", async () => {
    const { execInSandbox } = await import("@/lib/sandbox");
    const exec = vi.mocked(execInSandbox);
    exec.mockReset();
    exec.mockImplementation(async (_id: string, cmd: string) => {
      if (cmd.includes("apps/mobile/pnpm-lock.yaml")) return "__yes__";
      if (cmd.startsWith("test -f")) return cmd.includes(".test.") ? "__yes__" : "__no__";
      if (/cat "[^"]+apps\/mobile\/package\.json"/.test(cmd)) return JSON.stringify({ scripts: { test: "jest" } });
      if (/pnpm exec (jest|vitest)/.test(cmd)) return "Tests: 1 passed\n__dpf_exit=0";
      return "";
    });
    const { runSandboxTests } = await import("./coding-agent");
    await runSandboxTests("c1", { changedFiles: ["apps/mobile/src/cart/cart.ts"], workdir: "/workspace/.builds/FB-1" });
    const commands = exec.mock.calls.map(([, cmd]) => cmd);
    const install = commands.findIndex((cmd) => /apps\/mobile && .*pnpm install --offline --frozen-lockfile/.test(cmd));
    const tsc = commands.findIndex((cmd) => cmd.includes("/apps/mobile && pnpm exec tsc --noEmit"));
    const jest = commands.findIndex((cmd) => /apps\/mobile && .*pnpm exec jest/.test(cmd));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(tsc);
    expect(install).toBeLessThan(jest);
  });
});
