/**
 * Node bridge for the agent-toolchain bootstrap planning library.
 *
 * Reads existing contributor configs from disk, calls every planning function,
 * and returns one combined `AgentToolchainPlan` object the shell adapter
 * applies. No filesystem writes happen here — `apply` is the adapter's job.
 *
 * The bridge is the only module in this package that touches the filesystem
 * for non-test code. Planning modules remain data-in / data-out so they can
 * be tested without FS mocks; the bridge tests use FS shims for the same.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { planCodexConfig, type CodexConfigPlan } from "./codex-config";
import {
  planMcpClientConfig,
  mcpClientConfigPaths,
  type McpClientConfigPlan,
} from "./mcp-client-config";
import {
  planClaudePluginConfig,
  type ClaudePluginConfigPlan,
} from "./claude-plugins";
import { planGrokConfig, type GrokConfigPlan } from "./grok-config";
import { planKernelMemorySeed, type MemorySeedPlan } from "./memory-seed";
import {
  planMcpReadinessProbe,
  type McpReadinessProbePlan,
} from "./mcp-readiness-probe";
import { renderSmokeTestScenario, type SmokeTestScenario } from "./smoke-test";
import {
  computeReadinessState,
  readinessCopy,
  type ReadinessCopy,
} from "./readiness-state";
import {
  detectSuperpowersDrift,
  renderUpstreamDriftAdvisory,
  type UpstreamVersionDrift,
} from "./upstream-versions";
import type { ReadinessState } from "./types";

export type AgentToolchainPlan = {
  /** Repo root the plan was computed against (echo for adapter diagnostics). */
  repoRoot: string;
  /** Whether the host has Claude CLI on PATH (caller-supplied detection). */
  claudeCliPresent: boolean;
  /** Whether the host has Codex CLI on PATH (caller-supplied detection). */
  codexCliPresent: boolean;
  /** Whether the host has Grok CLI on PATH (caller-supplied detection). */
  grokCliPresent: boolean;
  /** Whether the host has Antigravity CLI (`agy`) on PATH (caller-supplied detection). */
  antigravityCliPresent: boolean;
  /** Whether a DPF MCP token was discovered (e.g. via DPF_MCP_BEARER_TOKEN). */
  hasToken: boolean;
  /** Grok presence + optional dedicated config plan (TOML [mcp_servers.dpf] wiring).
   * Main MCP client config is still via the generic mcpClientConfig for .mcp.json etc.
   */
  grok: { present: boolean; config?: GrokConfigPlan } | null;
  /** Antigravity (`agy`) presence. The MCP-config write itself is applied
   * best-effort by the shell/Python adapters against agy's JSON mcpServers
   * config (path pending live confirmation per EP-ANTIGRAVITY-001 / BI-ECAE3494),
   * so no typed config-write plan is emitted here yet — recognition only. */
  antigravity: { present: boolean } | null;
  /** TOML upsert plan for the contributor's Codex config (null when Codex CLI absent). */
  codex: CodexConfigPlan | null;
  /** Repo-root .mcp.json + .vscode/mcp.json writes (env-backed, secret-free). */
  mcpClientConfig: McpClientConfigPlan;
  /** JSON upsert plan for installed_plugins.json (null when Claude CLI absent). */
  claude: ClaudePluginConfigPlan | null;
  /** Kernel-memory seed plan. */
  memory: MemorySeedPlan;
  /** MCP read-only probe plan, or a skip rationale. */
  mcpProbe: McpReadinessProbePlan | { skipReason: "no_token" };
  /** Smoke test scenario the adapter should drive (Phase 5 implements the CLI invocation). */
  smokeScenario: SmokeTestScenario;
  /**
   * Upstream-plugin version drift advisory (Phase 6). Surfaced as a sub-line
   * under the readiness banner when status === "different"; absent / null
   * otherwise. Advisory only — the bootstrap does not auto-upgrade
   * upstream-owned plugins.
   */
  upstreamDrift: {
    superpowers: UpstreamVersionDrift;
    advisory: string | null;
  };
  /**
   * Pre-applied readiness preview the adapter shows to the operator
   * BEFORE running side effects, so the install banner can warn that
   * convergence is incomplete even if every write succeeds.
   */
  preview: {
    readinessState: ReadinessState;
    copy: ReadinessCopy;
  };
};

export type ComputeAgentToolchainPlanOptions = {
  /** Absolute path to the contributor's DPF repo root (this worktree). */
  repoRoot: string;
  /** Path to `~/.codex/config.toml`. */
  codexConfigPath: string;
  /**
   * The platform's canonical worktree base, resolved by the caller through
   * `scripts/lib/worktree-base.mjs`. Optional so existing callers keep working:
   * when absent each planner falls back to the behaviour it had before the base
   * became platform-owned (spec
   * 2026-09-02-platform-owned-client-configuration-design.md §1).
   */
  worktreeBase?: string;
  /** Path to `~/.claude/plugins/installed_plugins.json`. */
  claudePluginsPath: string;
  /** Directory holding the canonical kernel principles (origin: repo). */
  kernelPrinciplesDir: string;
  /** Directory to write contributor memory into (e.g. `~/.claude/projects`). */
  contributorMemoryDir: string;
  /** Project slug for the memory subdirectory (e.g. `D--DPF`). */
  projectSlug: string;
  /** Caller-detected presence of `claude` CLI on PATH. */
  claudeCliPresent: boolean;
  /** Caller-detected presence of `codex` CLI on PATH. */
  codexCliPresent: boolean;
  /** Caller-detected presence of `grok` CLI on PATH. */
  grokCliPresent: boolean;
  /** Caller-detected presence of Antigravity `agy` CLI on PATH. */
  antigravityCliPresent?: boolean;
  /** Caller-detected presence of a DPF MCP bearer token. */
  hasToken: boolean;
  /** Path to Grok config.toml (e.g. ~/.grok/config.toml). Wired for Grok-specific MCP. */
  grokConfigPath?: string;
  /** Path to Antigravity's MCP config (e.g. ~/.antigravity/mcp_config.json). The
   * shell/Python adapters write the DPF mcpServers block here best-effort; the
   * exact path is pending confirmation on a live agy install (BI-ECAE3494). */
  antigravityConfigPath?: string;
  /** Endpoint to probe for MCP `tools/list`. */
  mcpEndpoint: string;
  /** Expected dpf-platform plugin version (from packages/dpf-skill-pack/.claude-plugin/plugin.json). */
  expectedDpfPlatformVersion: string;
  /** If true, plan will include removal of stale `installed_plugins.json` entries. */
  reconcileStaleEntries?: boolean;
  /** If true, project commandment-tier kernel principles only. */
  commandmentTierOnly?: boolean;
  /** ISO timestamp baseline for memory-edit preservation. */
  installTimeBaseline?: string;
  /** Optional FS shim for tests; falls back to node:fs. */
  fs?: {
    readFileSync?: (path: string, encoding: BufferEncoding) => string;
    existsSync?: (path: string) => boolean;
    statSync?: (path: string) => { mtime: Date };
    readdirSync?: (path: string) => string[];
  };
};

export function computeAgentToolchainPlan(
  options: ComputeAgentToolchainPlanOptions,
): AgentToolchainPlan {
  const fs = options.fs ?? {};
  const _readFile =
    fs.readFileSync ?? ((p: string, e: BufferEncoding) => readFileSync(p, e));
  const _exists = fs.existsSync ?? existsSync;
  const _stat = fs.statSync ?? statSync;
  const _readdir = fs.readdirSync;

  // Codex plan (skipped when Codex CLI absent — no point planning writes the
  // contributor would never load).
  let codex: CodexConfigPlan | null = null;
  if (options.codexCliPresent) {
    const codexText = _exists(options.codexConfigPath)
      ? _readFile(options.codexConfigPath, "utf8")
      : "";
    codex = planCodexConfig(
      codexText,
      options.repoRoot,
      options.codexConfigPath,
      options.mcpEndpoint,
      // Platform-owned, not planner-owned: the base is resolved once and handed
      // to each client (spec 2026-09-02-platform-owned-client-configuration §1).
      options.worktreeBase,
    );
  }

  // Claude plan (skipped when Claude CLI absent).
  let claude: ClaudePluginConfigPlan | null = null;
  if (options.claudeCliPresent) {
    const claudeJson = _exists(options.claudePluginsPath)
      ? (JSON.parse(_readFile(options.claudePluginsPath, "utf8")) as unknown)
      : { version: 2, plugins: {} };
    claude = planClaudePluginConfig(options.repoRoot, claudeJson, {
      pathExists: _exists,
      reconcileStaleEntries: options.reconcileStaleEntries === true,
      expectedVersion: options.expectedDpfPlatformVersion,
      pluginsFilePath: options.claudePluginsPath,
    });
  }

  // Grok plan (skipped when Grok CLI absent). Dedicated TOML wiring for
  // [mcp_servers.dpf] using the grok.mcp.json descriptor (env-var token).
  let grok: { present: boolean; config?: GrokConfigPlan } | null = null;
  if (options.grokCliPresent && options.grokConfigPath) {
    const grokText = _exists(options.grokConfigPath)
      ? _readFile(options.grokConfigPath, "utf8")
      : "";
    const grokConfig = planGrokConfig(
      grokText,
      options.repoRoot,
      options.grokConfigPath,
      options.mcpEndpoint,
    );
    grok = { present: true, config: grokConfig };
  } else if (options.grokCliPresent) {
    grok = { present: true };
  }

  // Antigravity (`agy`) recognition. Additive, optional client — recognition
  // only; the MCP-config write is applied best-effort by the adapters against
  // agy's JSON config path (unconfirmed publicly, so no typed write plan yet).
  const antigravity: { present: boolean } | null = options.antigravityCliPresent
    ? { present: true }
    : null;

  // Kernel memory seed (always planned — the contributor benefits from local
  // memory whether or not the CLI is installed yet).
  const memory = planKernelMemorySeed(
    options.kernelPrinciplesDir,
    options.contributorMemoryDir,
    options.projectSlug,
    {
      commandmentTierOnly: options.commandmentTierOnly !== false,
      installTimeBaseline: options.installTimeBaseline,
      fs: {
        readFileSync: _readFile,
        existsSync: _exists,
        statSync: _stat,
        readdirSync: _readdir,
      },
    },
  );

  // MCP client config (.mcp.json + .vscode/mcp.json) — always planned: the
  // files are env-backed (no secret), so they converge whether or not a token
  // exists yet. The clients read the token from DPF_MCP_BEARER_TOKEN at runtime.
  const { mcpJsonPath, vscodeJsonPath } = mcpClientConfigPaths(options.repoRoot);
  const mcpClientConfig = planMcpClientConfig(
    options.repoRoot,
    options.mcpEndpoint,
    _exists(mcpJsonPath) ? _readFile(mcpJsonPath, "utf8") : null,
    _exists(vscodeJsonPath) ? _readFile(vscodeJsonPath, "utf8") : null,
  );

  const mcpProbe = planMcpReadinessProbe(options.mcpEndpoint, options.hasToken);
  const smokeScenario = renderSmokeTestScenario();

  // Phase 6: detect upstream-plugin version drift. We read the Codex config
  // text (re-using the same load above when present) and compare against the
  // DPF-pinned version. Advisory only; no auto-upgrade.
  const codexTextForDrift = options.codexCliPresent && _exists(options.codexConfigPath)
    ? _readFile(options.codexConfigPath, "utf8")
    : "";
  const superpowersDrift = detectSuperpowersDrift(codexTextForDrift);
  const upstreamDrift = {
    superpowers: superpowersDrift,
    advisory: renderUpstreamDriftAdvisory(superpowersDrift),
  };

  // Pre-apply readiness preview: compute the state the adapter would see if
  // every write applies cleanly but probes haven't run yet. This lets the
  // install banner pre-warn for missing CLIs / tokens.
  const previewReadiness = computeReadinessState({
    claudeCodeWired: options.claudeCliPresent,
    codexWired: options.codexCliPresent,
    grokWired: options.grokCliPresent,
    antigravityWired: options.antigravityCliPresent === true,
    mcpReadiness: options.hasToken
      ? { ok: true, toolCount: 0, observedAt: new Date().toISOString() }
      : { ok: false, reason: "no_token", httpStatus: null },
    smokeTest: { result: "skipped", reason: "no_token" },
  });

  return {
    repoRoot: options.repoRoot,
    claudeCliPresent: options.claudeCliPresent,
    codexCliPresent: options.codexCliPresent,
    grokCliPresent: options.grokCliPresent,
    antigravityCliPresent: options.antigravityCliPresent === true,
    hasToken: options.hasToken,
    codex,
    claude,
    grok,
    antigravity,
    mcpClientConfig,
    memory,
    mcpProbe,
    smokeScenario,
    upstreamDrift,
    preview: {
      readinessState: previewReadiness,
      copy: readinessCopy(previewReadiness),
    },
  };
}

/**
 * For diagnostics: produce a one-line, bearer-free summary of the plan
 * the adapter is about to apply. Used by the PowerShell + Bash adapters
 * to log a single "what we are about to do" line.
 */
export function summarizePlan(plan: AgentToolchainPlan): string {
  const parts: string[] = [];
  parts.push(`repo=${plan.repoRoot}`);
  parts.push(`claude=${plan.claudeCliPresent ? "present" : "missing"}`);
  parts.push(`codex=${plan.codexCliPresent ? "present" : "missing"}`);
  parts.push(`antigravity=${plan.antigravityCliPresent ? "present" : "missing"}`);
  parts.push(`token=${plan.hasToken ? "present" : "missing"}`);
  parts.push(`codex-writes=${plan.codex?.writes.length ?? 0}`);
  parts.push(`codex-convergence=${plan.codex?.convergence.length ?? 0}`);
  parts.push(`mcp-client-writes=${plan.mcpClientConfig.writes.length}`);
  parts.push(`claude-writes=${plan.claude?.writes.length ?? 0}`);
  parts.push(`grok-writes=${plan.grok?.config?.writes?.length ?? 0}`);
  parts.push(`memory-writes=${plan.memory.writes.length}`);
  parts.push(`stale-claude-entries=${plan.claude?.staleEntriesToReconcile.length ?? 0}`);
  parts.push(`mcp-probe=${"skipReason" in plan.mcpProbe ? "skip:no_token" : "planned"}`);
  parts.push(`preview-state=${plan.preview.readinessState}`);
  return parts.join(" ");
}
