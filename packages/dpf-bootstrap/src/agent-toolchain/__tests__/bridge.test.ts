import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeAgentToolchainPlan,
  summarizePlan,
  type AgentToolchainPlan,
  type ComputeAgentToolchainPlanOptions,
} from "../bridge";

const FIXTURES = join(__dirname, "fixtures");
const KERNEL_DIR = join(FIXTURES, "kernel-principles-subset");
const codexFixture = readFileSync(join(FIXTURES, "codex-config-operator-redacted.toml"), "utf8");
const claudeFreshFixture = readFileSync(join(FIXTURES, "installed-plugins-fresh.json"), "utf8");
const claudeAlreadyFixture = readFileSync(join(FIXTURES, "installed-plugins-already-installed.json"), "utf8");

// Matches the projectPath used in installed-plugins-already-installed.json so
// the idempotence test asserts a true noop rather than coincidentally diffing.
const REPO = "D:\\DPF\\.claude\\worktrees\\agent-toolchain-phase-1";
const CODEX_PATH = "C:\\Users\\Test\\.codex\\config.toml";
const CLAUDE_PATH = "C:\\Users\\Test\\.claude\\plugins\\installed_plugins.json";

/** Build an FS shim that satisfies the bridge's needs for a happy-path test. */
function buildFs(args: {
  codexText?: string;
  claudeJsonText?: string;
  liveDirs?: Set<string>;
}) {
  const codexText = args.codexText;
  const claudeJsonText = args.claudeJsonText;
  const liveDirs = args.liveDirs ?? new Set<string>([REPO]);

  return {
    readFileSync: (path: string, _encoding: BufferEncoding): string => {
      if (path === CODEX_PATH) return codexText ?? "";
      if (path === CLAUDE_PATH) return claudeJsonText ?? "";
      // Fall through to real FS for kernel principle fixtures.
      return readFileSync(path, "utf8");
    },
    existsSync: (path: string): boolean => {
      if (path === CODEX_PATH) return codexText !== undefined;
      if (path === CLAUDE_PATH) return claudeJsonText !== undefined;
      // Live-dirs whitelist for the stale-entry detection path.
      if (liveDirs.has(path)) return true;
      // Default: false (no contributor memory writes, no stale entries hit on disk).
      return false;
    },
    // statSync only matters for memory-edit preservation; not exercised here.
    statSync: (_path: string) => ({ mtime: new Date(0) }),
  };
}

function baseOptions(
  overrides: Partial<ComputeAgentToolchainPlanOptions> = {},
): ComputeAgentToolchainPlanOptions {
  return {
    repoRoot: REPO,
    codexConfigPath: CODEX_PATH,
    claudePluginsPath: CLAUDE_PATH,
    kernelPrinciplesDir: KERNEL_DIR,
    contributorMemoryDir: "/tmp/contributor-memory",
    projectSlug: "D--DPF",
    claudeCliPresent: true,
    codexCliPresent: true,
    hasToken: true,
    mcpEndpoint: "http://127.0.0.1:3000/api/mcp/v1",
    expectedDpfPlatformVersion: "0.1.0",
    commandmentTierOnly: true,
    fs: buildFs({ codexText: codexFixture, claudeJsonText: claudeFreshFixture }),
    ...overrides,
  };
}

describe("computeAgentToolchainPlan", () => {
  it("produces a full plan for a fully-present host with fresh configs", () => {
    const plan: AgentToolchainPlan = computeAgentToolchainPlan(baseOptions());

    expect(plan.repoRoot).toBe(REPO);
    expect(plan.claudeCliPresent).toBe(true);
    expect(plan.codexCliPresent).toBe(true);
    expect(plan.hasToken).toBe(true);
    expect(plan.codex).not.toBeNull();
    expect(plan.codex!.writes).toHaveLength(1);
    expect(plan.claude).not.toBeNull();
    expect(plan.claude!.writes).toHaveLength(1);
    expect(plan.memory.writes.length).toBeGreaterThan(0);
    expect("skipReason" in plan.mcpProbe).toBe(false);
    expect(plan.preview.readinessState).toBe("ready");
  });

  it("skips codex plan entirely when Codex CLI is absent", () => {
    const plan = computeAgentToolchainPlan(
      baseOptions({ codexCliPresent: false }),
    );

    expect(plan.codex).toBeNull();
    expect(plan.claude).not.toBeNull();
    expect(plan.preview.readinessState).toBe("partial");
  });

  it("skips claude plan entirely when Claude CLI is absent", () => {
    const plan = computeAgentToolchainPlan(
      baseOptions({ claudeCliPresent: false }),
    );

    expect(plan.claude).toBeNull();
    expect(plan.codex).not.toBeNull();
    expect(plan.preview.readinessState).toBe("partial");
  });

  it("returns missing_cli preview when neither CLI is present", () => {
    const plan = computeAgentToolchainPlan(
      baseOptions({ claudeCliPresent: false, codexCliPresent: false }),
    );

    expect(plan.codex).toBeNull();
    expect(plan.claude).toBeNull();
    // Memory + smoke scenario still computed (they don't need a CLI).
    expect(plan.memory.writes.length).toBeGreaterThan(0);
    expect(plan.preview.readinessState).toBe("missing_cli");
  });

  it("returns missing_token preview when no token is configured", () => {
    const plan = computeAgentToolchainPlan(baseOptions({ hasToken: false }));

    expect("skipReason" in plan.mcpProbe).toBe(true);
    if ("skipReason" in plan.mcpProbe) {
      expect(plan.mcpProbe.skipReason).toBe("no_token");
    }
    expect(plan.preview.readinessState).toBe("missing_token");
  });

  it("emits zero writes when Claude is already installed at the expected version (idempotent)", () => {
    const plan = computeAgentToolchainPlan(
      baseOptions({
        fs: buildFs({
          codexText: codexFixture,
          claudeJsonText: claudeAlreadyFixture,
        }),
      }),
    );

    expect(plan.claude).not.toBeNull();
    expect(plan.claude!.writes).toEqual([]);
    expect(plan.claude!.mode).toBe("noop");
  });

  it("handles missing claude plugins file by treating as fresh contributor", () => {
    const plan = computeAgentToolchainPlan(
      baseOptions({
        fs: buildFs({ codexText: codexFixture }), // no claudeJsonText -> existsSync(CLAUDE_PATH)=false
      }),
    );

    expect(plan.claude).not.toBeNull();
    expect(plan.claude!.writes).toHaveLength(1);
    expect(plan.claude!.mode).toBe("create");
  });

  it("handles missing codex config by treating as fresh contributor", () => {
    const plan = computeAgentToolchainPlan(
      baseOptions({
        fs: buildFs({ claudeJsonText: claudeFreshFixture }), // no codexText
      }),
    );

    expect(plan.codex).not.toBeNull();
    expect(plan.codex!.writes).toHaveLength(1);
  });
});

describe("summarizePlan", () => {
  it("produces a single bearer-free line covering plan shape", () => {
    const plan = computeAgentToolchainPlan(baseOptions());
    const summary = summarizePlan(plan);

    expect(summary).toMatch(/repo=D:/);
    expect(summary).toMatch(/claude=present/);
    expect(summary).toMatch(/codex=present/);
    expect(summary).toMatch(/token=present/);
    expect(summary).toMatch(/preview-state=ready/);

    // No bearer-shaped content.
    expect(summary).not.toMatch(/Bearer\s+\w/);
    expect(summary).not.toMatch(/dpfmcp_/);
  });

  it("flags missing pieces concisely", () => {
    const plan = computeAgentToolchainPlan(
      baseOptions({ claudeCliPresent: false, hasToken: false }),
    );
    const summary = summarizePlan(plan);

    expect(summary).toMatch(/claude=missing/);
    expect(summary).toMatch(/token=missing/);
    expect(summary).toMatch(/mcp-probe=skip:no_token/);
    expect(summary).toMatch(/preview-state=missing_token/);
  });
});
