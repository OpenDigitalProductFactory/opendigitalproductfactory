import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

import { planCodexConfig } from "../codex-config";

const FIXTURES = join(__dirname, "fixtures");
const operatorRedacted = readFileSync(
  join(FIXTURES, "codex-config-operator-redacted.toml"),
  "utf8",
);
const withUserDisable = readFileSync(
  join(FIXTURES, "codex-config-with-user-disable.toml"),
  "utf8",
);

const REPO = "D:\\DPF";
const CONFIG_PATH = "C:\\Users\\Test\\.codex\\config.toml";
const LOCAL_ENDPOINT = "http://127.0.0.1:3000/api/mcp/v1";
const LOCAL_FULL_ENDPOINT = `${LOCAL_ENDPOINT}?tier=full`;

describe("planCodexConfig", () => {
  it("upserts [plugins.\"dpf-platform@personal\"] enabled=true on the operator-current fixture", () => {
    const plan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);

    expect(plan.writes).toHaveLength(1);
    expect(plan.deletes).toEqual([]);
    expect(plan.preservedUserIntent).toBe(false);
    expect(plan.rationale).toMatch(/enable \[plugins/);
    expect(plan.writes[0].path).toBe(CONFIG_PATH);

    const parsed = parse(plan.writes[0].content) as {
      plugins: Record<string, { enabled: boolean }>;
    };
    expect(parsed.plugins["dpf-platform@personal"]).toEqual({ enabled: true });
  });

  it("preserves byte-equivalence of all blocks OUTSIDE the convergence scope", () => {
    const plan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);
    const beforeParsed = parse(operatorRedacted) as Record<string, unknown>;
    const afterParsed = parse(plan.writes[0].content) as Record<string, unknown>;

    const top = ["approval_policy", "sandbox_mode", "model", "model_reasoning_effort"] as const;
    for (const key of top) {
      expect(afterParsed[key]).toEqual(beforeParsed[key]);
    }

    // `mcp_servers` and `projects` are now within the convergence scope (generic
    // servers disabled, worktree paths trusted) so they are asserted separately.
    const blockKeys = ["windows", "features", "marketplaces", "tui", "desktop"] as const;
    for (const block of blockKeys) {
      expect(afterParsed[block]).toEqual(beforeParsed[block]);
    }

    // Non-DPF, non-generic plugins are preserved byte-for-byte.
    const beforePlugins = beforeParsed.plugins as Record<string, { enabled?: boolean }>;
    const afterPlugins = afterParsed.plugins as Record<string, { enabled?: boolean }>;
    const generic = ["dpf-platform", "superpowers@openai-curated", "build-ios-apps@openai-curated"];
    for (const otherPlugin of Object.keys(beforePlugins)) {
      if (generic.includes(otherPlugin)) continue;
      expect(afterPlugins[otherPlugin]).toEqual(beforePlugins[otherPlugin]);
    }

    // The DPF MCP server + non-generic servers are preserved; the generic
    // `node_repl` REPL transport is explicitly out of scope (not disabled).
    const beforeMcp = beforeParsed.mcp_servers as Record<string, unknown>;
    const afterMcp = afterParsed.mcp_servers as Record<string, unknown>;
    const genericMcp = ["nanobanana-mcp", "youtube_transcript"];
    for (const name of Object.keys(beforeMcp)) {
      if (genericMcp.includes(name)) continue;
      expect(afterMcp[name]).toEqual(beforeMcp[name]);
    }
    // Pre-existing trust entries survive.
    const beforeProjects = beforeParsed.projects as Record<string, unknown>;
    const afterProjects = afterParsed.projects as Record<string, unknown>;
    for (const p of Object.keys(beforeProjects)) {
      expect(afterProjects[p]).toEqual(beforeProjects[p]);
    }
  });

  it("disables generic plugins (superpowers, build-ios-apps) in the DPF profile", () => {
    const plan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);
    const parsed = parse(plan.writes[0].content) as {
      plugins: Record<string, { enabled?: boolean }>;
    };
    expect(parsed.plugins["superpowers@openai-curated"].enabled).toBe(false);
    expect(parsed.plugins["build-ios-apps@openai-curated"].enabled).toBe(false);
    // Unrelated plugins stay enabled.
    expect(parsed.plugins["github@openai-curated"].enabled).toBe(true);
    expect(parsed.plugins["gmail@openai-curated"].enabled).toBe(true);

    const disabled = plan.convergence
      .filter((c) => c.kind === "plugin-disabled")
      .map((c) => c.key);
    expect(disabled).toContain("superpowers@openai-curated");
    expect(disabled).toContain("build-ios-apps@openai-curated");
    expect(plan.rationale).toMatch(/disable generic plugin/);
  });

  it("disables generic MCP servers (nanobanana-mcp, youtube_transcript) by clearing their spawn command", () => {
    const plan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);
    const parsed = parse(plan.writes[0].content) as {
      mcp_servers: Record<string, { command?: unknown; args?: unknown; enabled?: boolean }>;
    };
    expect(parsed.mcp_servers["nanobanana-mcp"].command).toBeUndefined();
    expect(parsed.mcp_servers["nanobanana-mcp"].enabled).toBe(false);
    expect(parsed.mcp_servers["youtube_transcript"].command).toBeUndefined();
    expect(parsed.mcp_servers["youtube_transcript"].enabled).toBe(false);
    // The DPF server keeps its transport.
    expect(parsed.mcp_servers["dpf"]).toMatchObject({ bearer_token_env_var: "DPF_MCP_BEARER_TOKEN" });

    const disabledMcp = plan.convergence
      .filter((c) => c.kind === "mcp-server-disabled")
      .map((c) => c.key);
    expect(disabledMcp).toEqual(expect.arrayContaining(["nanobanana-mcp", "youtube_transcript"]));
  });

  it("adds the canonical worktree base + this worktree to the trust list", () => {
    const worktree = "D:\\DPF-worktrees\\host-tooling-convergence";
    const plan = planCodexConfig(operatorRedacted, worktree, CONFIG_PATH);
    const parsed = parse(plan.writes[0].content) as {
      projects: Record<string, { trust_level?: string }>;
    };
    expect(parsed.projects["D:\\DPF-worktrees"].trust_level).toBe("trusted");
    expect(parsed.projects[worktree].trust_level).toBe("trusted");
    // The pre-existing D:\DPF trust survives.
    expect(parsed.projects["D:\\DPF"].trust_level).toBe("trusted");

    const trusted = plan.convergence
      .filter((c) => c.kind === "project-trusted")
      .map((c) => c.key);
    expect(trusted).toEqual(expect.arrayContaining(["D:\\DPF-worktrees", worktree]));
  });

  it("is idempotent across the full convergence: re-running produces zero writes", () => {
    const worktree = "D:\\DPF-worktrees\\host-tooling-convergence";
    const first = planCodexConfig(operatorRedacted, worktree, CONFIG_PATH, LOCAL_ENDPOINT);
    expect(first.writes).toHaveLength(1);

    const second = planCodexConfig(first.writes[0].content, worktree, CONFIG_PATH, LOCAL_ENDPOINT);
    expect(second.writes).toEqual([]);
    expect(second.convergence).toEqual([]);
    expect(second.rationale).toMatch(/already converged/);
  });

  it("is idempotent: re-running on the post-upsert text produces zero writes", () => {
    const firstPlan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);
    const afterUpsert = firstPlan.writes[0].content;

    const secondPlan = planCodexConfig(afterUpsert, REPO, CONFIG_PATH);

    expect(secondPlan.writes).toEqual([]);
    expect(secondPlan.rationale).toMatch(/already converged/);
  });

  it("preserves the DPF-plugin-disable intent while still converging generic clients + trust", () => {
    // The withUserDisable fixture has the DPF plugin disabled AND a generic
    // `superpowers` plugin enabled AND no worktree trust, so a write IS
    // produced now — but it must NOT re-enable the DPF plugin.
    const plan = planCodexConfig(withUserDisable, REPO, CONFIG_PATH);

    expect(plan.preservedUserIntent).toBe(true);
    const parsed = parse(plan.writes[0].content) as {
      plugins: Record<string, { enabled?: boolean }>;
    };
    expect(parsed.plugins["dpf-platform@personal"].enabled).toBe(false); // intent preserved
    expect(parsed.plugins["dpf-platform"]).toBeUndefined(); // legacy key migrated
    expect(parsed.plugins["superpowers@openai-curated"].enabled).toBe(false); // generic disabled
    expect(plan.convergence.some((c) => c.kind === "plugin-disabled")).toBe(true);
  });

  it("preserves user intent AND already-converged generic/trust state as a no-op", () => {
    // A fully-converged profile (DPF disabled by user, generics disabled,
    // worktree trusted) produces zero writes.
    const first = planCodexConfig(withUserDisable, REPO, CONFIG_PATH);
    const second = planCodexConfig(first.writes[0].content, REPO, CONFIG_PATH);

    expect(second.writes).toEqual([]);
    expect(second.preservedUserIntent).toBe(true);
    expect(second.rationale).toMatch(/disabled by user/);
  });

  it("returns zero writes with a parse-error rationale on unparseable TOML", () => {
    const broken = "[unterminated\nkey = ";
    const plan = planCodexConfig(broken, REPO, CONFIG_PATH);

    expect(plan.writes).toEqual([]);
    expect(plan.rationale).toMatch(/TOML parse error/);
    expect(plan.preservedUserIntent).toBe(false);
  });

  it("repairs a duplicate [mcp_servers.dpf] table before parsing so Codex is functional again", () => {
    const duplicatedDpfMcp = [
      'model = "gpt-5.5"',
      "",
      "[mcp_servers.dpf]",
      'url = "http://old.example.test/api/mcp/v1"',
      'bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"',
      "",
      "[mcp_servers.node_repl]",
      'command = "node"',
      "",
      "[mcp_servers.dpf]",
      'url = "http://duplicate.example.test/api/mcp/v1"',
      'bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"',
      "",
    ].join("\n");

    expect(() => parse(duplicatedDpfMcp)).toThrow();

    const plan = planCodexConfig(duplicatedDpfMcp, REPO, CONFIG_PATH, LOCAL_ENDPOINT);

    expect(plan.writes).toHaveLength(1);
    expect(plan.rationale).toMatch(/repair duplicate \[mcp_servers\.dpf\]/);
    expect(plan.writes[0].content.match(/\[mcp_servers\.dpf\]/g)).toHaveLength(1);

    const parsed = parse(plan.writes[0].content) as {
      mcp_servers: Record<string, { url?: string; bearer_token_env_var?: string; command?: string }>;
    };
    expect(parsed.mcp_servers.dpf).toEqual({
      url: LOCAL_FULL_ENDPOINT,
      bearer_token_env_var: "DPF_MCP_BEARER_TOKEN",
    });
    expect(parsed.mcp_servers.node_repl.command).toBe("node");
  });

  it("accepts a UTF-8 BOM at the start of a Windows-written config", () => {
    const plan = planCodexConfig(`\uFEFF${operatorRedacted}`, REPO, CONFIG_PATH);

    expect(plan.writes).toHaveLength(1);
    expect(plan.rationale).not.toMatch(/TOML parse error/);
    const parsed = parse(plan.writes[0].content) as {
      plugins: Record<string, { enabled?: boolean }>;
    };
    expect(parsed.plugins["dpf-platform@personal"].enabled).toBe(true);
  });

  it("handles empty existing config (fresh contributor)", () => {
    const plan = planCodexConfig("", REPO, CONFIG_PATH);

    expect(plan.writes).toHaveLength(1);
    const parsed = parse(plan.writes[0].content) as { plugins: Record<string, { enabled: boolean }> };
    expect(parsed.plugins["dpf-platform@personal"]).toEqual({ enabled: true });
  });

  it("upserts [mcp_servers.dpf] alongside the plugin when an endpoint is supplied", () => {
    const plan = planCodexConfig("", REPO, CONFIG_PATH, LOCAL_ENDPOINT);

    expect(plan.writes).toHaveLength(1);
    expect(plan.rationale).toMatch(/upsert \[mcp_servers\.dpf\]/);
    const parsed = parse(plan.writes[0].content) as {
      plugins: Record<string, { enabled: boolean }>;
      mcp_servers: Record<string, { url: string; bearer_token_env_var: string }>;
    };
    expect(parsed.plugins["dpf-platform@personal"]).toEqual({ enabled: true });
    expect(parsed.mcp_servers["dpf"]).toEqual({
      url: LOCAL_FULL_ENDPOINT,
      bearer_token_env_var: "DPF_MCP_BEARER_TOKEN",
    });
  });

  it("migrates a legacy no-tier Codex endpoint while disabling generic servers", () => {
    // A no-tier endpoint strands deferred tools in current Codex because its
    // Streamable HTTP transport sends no User-Agent and does not refresh the
    // top-level registry after list_changed. Bootstrap must converge it.
    const first = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH, LOCAL_ENDPOINT);
    expect(first.writes).toHaveLength(1);
    expect(first.rationale).toMatch(/upsert \[mcp_servers\.dpf\]/);
    const after = parse(first.writes[0].content) as {
      mcp_servers: Record<string, { url?: string; enabled?: boolean }>;
    };
    expect(after.mcp_servers["dpf"].url).toBe(LOCAL_FULL_ENDPOINT);
    expect((after.mcp_servers["nanobanana-mcp"] as { enabled?: boolean }).enabled).toBe(false);

    const second = planCodexConfig(first.writes[0].content, REPO, CONFIG_PATH, LOCAL_ENDPOINT);
    expect(second.writes).toEqual([]);
    expect(second.rationale).toMatch(/already converged/);
  });

  it("wires [mcp_servers.dpf] even when the user disabled the plugin (MCP is independent)", () => {
    const novelEndpoint = "http://127.0.0.1:9999/api/mcp/v1";
    const plan = planCodexConfig(withUserDisable, REPO, CONFIG_PATH, novelEndpoint);

    expect(plan.writes).toHaveLength(1);
    expect(plan.preservedUserIntent).toBe(true);
    const parsed = parse(plan.writes[0].content) as {
      plugins: Record<string, { enabled: boolean }>;
      mcp_servers: Record<string, { url: string; bearer_token_env_var: string }>;
    };
    // Plugin intent preserved (still disabled), MCP block written.
    expect(parsed.plugins["dpf-platform@personal"].enabled).toBe(false);
    expect(parsed.mcp_servers["dpf"]).toEqual({
      url: `${novelEndpoint}?tier=full`,
      bearer_token_env_var: "DPF_MCP_BEARER_TOKEN",
    });
  });
});
