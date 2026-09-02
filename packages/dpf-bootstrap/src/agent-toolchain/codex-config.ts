/**
 * Plan idempotent edits to `~/.codex/config.toml` so the DPF skill pack is
 * enabled for the Codex CLI without clobbering any unrelated user config.
 *
 * Round-trips through `smol-toml` -- never regex. Every other declared block
 * is byte-equivalent across plan applications. User intent (`enabled = false`
 * set manually by the operator) is preserved.
 *
 * Convergence scope (per docs/superpowers/specs/2026-06-05-unified-delivery-
 * surfaces-execution-alignment-design.md S4.5):
 *   - ensure `[plugins."dpf-platform@personal"]` + `[mcp_servers.dpf]` (the DPF baseline);
 *   - DISABLE generic, non-DPF clients that auto-spawn orphaned npx/node
 *     sidecars (`superpowers@openai-curated`, `build-ios-apps@openai-curated`
 *     plugins; `nanobanana-mcp`, `youtube_transcript` MCP servers). The decision
 *     is conservative: DISABLE, not delete, so the operator can re-enable and we
 *     never destroy unrelated config. `superpowers@openai-curated` directly
 *     conflicts with `dpf-platform`; per the spec DPF wins, so it is disabled in
 *     the DPF working profile;
 *   - TRUST the canonical worktree base + this worktree so Codex sessions in
 *     `D:/DPF-worktrees/<topic>` do not hit trust friction (S4.1 decision #1).
 *
 * What this convergence does NOT touch: the MCP servers / plugins the operator
 * legitimately uses outside DPF (`github@openai-curated`, `gmail@openai-curated`,
 * `chrome@openai-bundled`, the document runtimes, the `node_repl` REPL
 * transport, etc.) -- only the spec-named generic clients whose orphaned
 * children pin the WindowsApps Store package against upgrade.
 */

import { parse, stringify } from "smol-toml";
import { withDpfMcpCatalogTier } from "@dpf/integration-shared/mcp-catalog-tier";

export type CodexConfigConvergenceChange = {
  /** Substrate kind that changed. */
  kind: "plugin-disabled" | "mcp-server-disabled" | "project-trusted";
  /** The config key affected (e.g. plugin id, mcp server name, trust path). */
  key: string;
};

export type CodexConfigPlan = {
  /** Path/content pairs to write. Empty when the file already converged. */
  writes: Array<{ path: string; content: string }>;
  /** Path entries to delete. Empty in this BI; reserved for future use. */
  deletes: Array<{ path: string }>;
  /** Human-readable explanation surfaced in install-state for diagnostics. */
  rationale: string;
  /** True when the user has explicitly disabled the plugin and the plan respects it. */
  preservedUserIntent: boolean;
  /**
   * Convergence changes beyond the plugin + MCP baseline (generic-client
   * disable + worktree trust). Surfaced at the readiness banner so drift is
   * reported, not silently tolerated. Empty when the profile already conforms.
   */
  convergence: CodexConfigConvergenceChange[];
};

const DPF_PLUGIN_KEY = "dpf-platform@personal";
const LEGACY_DPF_PLUGIN_KEY = "dpf-platform";
// Mirrors MCP_BEARER_TOKEN_ENV_VAR in apps/web/lib/auth/mcp-setup-snippets.ts.
// Duplicated as a stable literal because this installer-side package must not
// depend on the web bundle. Keep the two in lockstep.
const MCP_BEARER_TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN";

/**
 * Generic, non-DPF Codex plugins that auto-spawn orphaned npx/node sidecars and
 * are not project-default per AGENTS.md S16. Disabled (not deleted) in the DPF
 * working profile. `superpowers@openai-curated` additionally conflicts with
 * `dpf-platform`; DPF wins. Matched by the bare name before any `@marketplace`
 * suffix so a beta-channel install is still caught.
 */
const GENERIC_PLUGINS_TO_DISABLE = ["superpowers", "build-ios-apps"] as const;

/**
 * Generic, non-DPF Codex MCP servers that auto-spawn orphaned npx children and
 * are irrelevant to DPF development. Disabled (not deleted) in the DPF working
 * profile by clearing the spawn command so the session does not launch them.
 */
const GENERIC_MCP_SERVERS_TO_DISABLE = ["nanobanana-mcp", "youtube_transcript"] as const;

/**
 * Canonical worktree base directory for the two interactive host surfaces
 * (S4.1 decision #1). Worktree sessions live under `D:/DPF-worktrees/<topic>`;
 * trusting the base avoids per-worktree trust friction in Codex.
 */
/**
 * Fallback ONLY. The worktree base is platform-owned and is passed in by the
 * caller, which resolves it through `scripts/lib/worktree-base.mjs`. This
 * constant used to BE the definition — a client planner deciding where DPF
 * does its work — which is why the platform could not see its own worktrees
 * (BI-0B2F0546, BI-99395B29). It survives only so an older caller that passes
 * nothing behaves exactly as it did before.
 *
 * Spec: docs/superpowers/specs/2026-09-02-platform-owned-client-configuration-design.md §1
 */
const LEGACY_WORKTREE_BASE_FALLBACK = "D:\\DPF-worktrees";

/** Desired `[mcp_servers.dpf]` shape (secret-free -- references the env var). */
function desiredMcpServerBlock(mcpEndpoint: string): Record<string, string> {
  return { url: mcpEndpoint, bearer_token_env_var: MCP_BEARER_TOKEN_ENV_VAR };
}

function mcpBlockConverged(
  existing: { url?: string; bearer_token_env_var?: string } | undefined,
  mcpEndpoint: string,
): boolean {
  return (
    existing?.url === mcpEndpoint &&
    existing?.bearer_token_env_var === MCP_BEARER_TOKEN_ENV_VAR
  );
}

type TomlRepairResult = {
  text: string;
  repairs: string[];
};

function splitTomlDottedKey(key: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escape = false;

  for (const char of key.trim()) {
    if (quoted) {
      if (escape) {
        current += char;
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ".") {
      const part = current.trim();
      if (!part) return null;
      parts.push(part);
      current = "";
    } else {
      current += char;
    }
  }

  if (quoted || escape) return null;
  const part = current.trim();
  if (!part) return null;
  parts.push(part);
  return parts;
}

function canonicalTomlTableHeader(line: string): string | null {
  const stripped = line.trim();
  if (!stripped.startsWith("[") || !stripped.endsWith("]") || stripped.startsWith("[[")) {
    return null;
  }
  const parts = splitTomlDottedKey(stripped.slice(1, -1));
  return parts?.join(".") ?? null;
}

function isTomlTableBoundary(line: string): boolean {
  const stripped = line.trim();
  return canonicalTomlTableHeader(stripped) !== null || (stripped.startsWith("[[") && stripped.endsWith("]]"));
}

function collapseDuplicateTomlTable(text: string, canonicalKey: string): TomlRepairResult {
  const lines = text.split(/\r?\n/);
  const ranges: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < lines.length) {
    if (canonicalTomlTableHeader(lines[index]) === canonicalKey) {
      let end = index + 1;
      while (end < lines.length && !isTomlTableBoundary(lines[end])) end += 1;
      ranges.push({ start: index, end });
      index = end;
    } else {
      index += 1;
    }
  }

  if (ranges.length <= 1) return { text, repairs: [] };

  const first = ranges[0];
  const block = lines.slice(first.start, first.end);
  const removed = new Set<number>();
  for (const range of ranges) {
    for (let lineNo = range.start; lineNo < range.end; lineNo += 1) removed.add(lineNo);
  }

  const rebuilt: string[] = [];
  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    if (lineNo === first.start) rebuilt.push(...block);
    if (!removed.has(lineNo)) rebuilt.push(lines[lineNo]);
  }

  const trailingNewline = text.endsWith("\n") ? "\n" : "";
  return {
    text: rebuilt.join("\n").replace(/\n+$/u, "") + trailingNewline,
    repairs: [`repair duplicate [${canonicalKey}]`],
  };
}

/** Does this plugin id (possibly `name@marketplace`) match a generic id? */
function isGenericPlugin(pluginId: string): boolean {
  const bare = pluginId.split("@")[0];
  return (GENERIC_PLUGINS_TO_DISABLE as readonly string[]).includes(bare);
}

/**
 * Plan the Codex `config.toml` upsert for this contributor and repo.
 *
 * Converges the DPF working profile:
 *   - `[plugins."dpf-platform@personal"]` enabled = true (the DPF skill pack)
 *   - `[mcp_servers.dpf]` url + bearer_token_env_var (the governed MCP transport),
 *     written only when `mcpEndpoint` is supplied.
 *   - generic, non-DPF plugins (`superpowers`, `build-ios-apps`) disabled.
 *   - generic, non-DPF MCP servers (`nanobanana-mcp`, `youtube_transcript`)
 *     disabled (spawn command cleared) so their orphaned children stop pinning
 *     the WindowsApps Store package against upgrade.
 *   - the canonical worktree base (`D:/DPF-worktrees`) and this worktree
 *     (`repoRoot`) added to the project trust list.
 *
 * - `existingTomlText` is the file's current text (or "" for a fresh contributor).
 * - `repoRoot` is the absolute path of the contributor's DPF clone/worktree.
 *   Added to the trust list and recorded in the rationale.
 * - `configPath` is the absolute path where the plan would write back.
 * - `mcpEndpoint` is the base `/api/mcp/v1` URL. Codex is a known lazy host, so
 *   the planner converges it to the explicit `tier=full` programmatic catalog;
 *   the host still decides which tools attach to the model. When omitted, the
 *   MCP block is left untouched (back-compat with plugin-only callers).
 *
 * Returns zero writes when the file is unparseable, zero writes when the whole
 * profile already conforms, and a single full-file write otherwise. Every block
 * outside the convergence scope is preserved byte-for-byte via smol-toml
 * round-tripping. A user-set `enabled = false` on the DPF plugin is honored
 * (never silently re-enabled); MCP wiring is independent of that intent.
 */
export function planCodexConfig(
  existingTomlText: string,
  repoRoot: string,
  configPath: string,
  mcpEndpoint?: string,
  /**
   * The platform's canonical worktree base, resolved by the caller. Passed in
   * rather than owned here: the platform declares where work happens and tells
   * its clients, never the reverse.
   */
  worktreeBase?: string,
): CodexConfigPlan {
  const canonicalWorktreeBase =
    worktreeBase && worktreeBase.trim().length > 0
      ? worktreeBase.trim()
      : LEGACY_WORKTREE_BASE_FALLBACK;
  let normalizedTomlText = existingTomlText.replace(/^\uFEFF/, "");
  const repaired = collapseDuplicateTomlTable(normalizedTomlText, "mcp_servers.dpf");
  normalizedTomlText = repaired.text;
  let parsed: Record<string, unknown>;
  try {
    parsed = (normalizedTomlText.length > 0 ? parse(normalizedTomlText) : {}) as Record<string, unknown>;
  } catch (err) {
    return {
      writes: [],
      deletes: [],
      rationale: `TOML parse error; refusing to write. (${(err as Error).message})`,
      preservedUserIntent: false,
      convergence: [],
    };
  }

  const plugins = (parsed["plugins"] as Record<string, unknown> | undefined) ?? {};
  const currentBlock = plugins[DPF_PLUGIN_KEY] as { enabled?: boolean } | undefined;
  const legacyBlock = plugins[LEGACY_DPF_PLUGIN_KEY] as { enabled?: boolean } | undefined;
  const existingBlock = currentBlock ?? legacyBlock;
  const legacyPluginPresent = Object.prototype.hasOwnProperty.call(plugins, LEGACY_DPF_PLUGIN_KEY);
  const userDisabledPlugin = existingBlock?.enabled === false;
  const pluginConverged =
    !legacyPluginPresent && (currentBlock?.enabled === true || currentBlock?.enabled === false);

  const mcpServers = (parsed["mcp_servers"] as Record<string, unknown> | undefined) ?? {};
  const existingMcp = mcpServers["dpf"] as
    | { url?: string; bearer_token_env_var?: string }
    | undefined;
  const wantMcp = typeof mcpEndpoint === "string" && mcpEndpoint.length > 0;
  const desiredMcpEndpoint = wantMcp
    ? withDpfMcpCatalogTier(mcpEndpoint!, "full")
    : undefined;
  const mcpConverged =
    !wantMcp || mcpBlockConverged(existingMcp, desiredMcpEndpoint!);

  // --- Compute convergence deltas (idempotent, conservative) ----------------

  const convergence: CodexConfigConvergenceChange[] = [];

  // Generic plugins to disable: any present + still-enabled generic plugin.
  const genericPluginsToDisable = Object.keys(plugins).filter((id) => {
    if (!isGenericPlugin(id)) return false;
    const blk = plugins[id] as { enabled?: boolean } | undefined;
    // Already disabled (enabled === false) -> nothing to do.
    return blk?.enabled !== false;
  });

  // Generic MCP servers to disable: present and still has a spawn command.
  const genericMcpToDisable = (GENERIC_MCP_SERVERS_TO_DISABLE as readonly string[]).filter((name) => {
    const blk = mcpServers[name] as { command?: unknown; enabled?: unknown } | undefined;
    if (!blk || typeof blk !== "object") return false;
    // Treat as needing convergence if it still has a spawn command or is not
    // explicitly disabled.
    return blk.command !== undefined || blk.enabled === true;
  });

  // Trust entries to add: the canonical worktree base and this worktree.
  const projects = (parsed["projects"] as Record<string, unknown> | undefined) ?? {};
  const trustTargets = [canonicalWorktreeBase, repoRoot];
  const trustToAdd = trustTargets.filter((p) => {
    const blk = projects[p] as { trust_level?: unknown } | undefined;
    return blk?.trust_level !== "trusted";
  });

  const needsConvergence =
    legacyPluginPresent ||
    genericPluginsToDisable.length > 0 ||
    genericMcpToDisable.length > 0 ||
    trustToAdd.length > 0;

  // Nothing to do anywhere -- baseline + convergence both already conform.
  if (pluginConverged && mcpConverged && !needsConvergence && repaired.repairs.length === 0) {
    return {
      writes: [],
      deletes: [],
      rationale: userDisabledPlugin
        ? `Codex plugin disabled by user (preserved); MCP + DPF profile already converged.`
        : "Codex DPF profile already converged; no write needed.",
      preservedUserIntent: userDisabledPlugin,
      convergence: [],
    };
  }

  const nextParsed: Record<string, unknown> = { ...parsed };
  const rationaleParts: string[] = [...repaired.repairs];

  // Plugin block: add/enable DPF unless the user explicitly disabled it.
  // We also disable the generic plugins in the same plugins map.
  if (!pluginConverged || legacyPluginPresent || genericPluginsToDisable.length > 0) {
    const nextPlugins: Record<string, unknown> = { ...plugins };
    if (legacyPluginPresent) {
      delete nextPlugins[LEGACY_DPF_PLUGIN_KEY];
      rationaleParts.push(`migrate legacy [plugins."${LEGACY_DPF_PLUGIN_KEY}"]`);
    }
    if (!pluginConverged || legacyPluginPresent) {
      nextPlugins[DPF_PLUGIN_KEY] = {
        ...(existingBlock ?? {}),
        enabled: userDisabledPlugin ? false : true,
      };
      rationaleParts.push(
        `${userDisabledPlugin ? "preserve disabled" : "enable"} [plugins."${DPF_PLUGIN_KEY}"]`,
      );
    }
    for (const id of genericPluginsToDisable) {
      const blk = (plugins[id] as Record<string, unknown> | undefined) ?? {};
      nextPlugins[id] = { ...blk, enabled: false };
      convergence.push({ kind: "plugin-disabled", key: id });
      rationaleParts.push(`disable generic plugin "${id}"`);
    }
    nextParsed["plugins"] = nextPlugins;
  }

  // MCP servers: upsert the DPF transport; disable generic servers by clearing
  // their spawn command (preserving any other keys) so the session stops
  // launching their orphaned children.
  if ((wantMcp && !mcpConverged) || genericMcpToDisable.length > 0) {
    const nextMcpServers: Record<string, unknown> = { ...mcpServers };
    if (wantMcp && !mcpConverged) {
      nextMcpServers["dpf"] = {
        ...(existingMcp ?? {}),
        ...desiredMcpServerBlock(desiredMcpEndpoint!),
      };
      rationaleParts.push("upsert [mcp_servers.dpf]");
    }
    for (const name of genericMcpToDisable) {
      const blk = (mcpServers[name] as Record<string, unknown> | undefined) ?? {};
      // Remove the spawn command + args and mark disabled. Keeping the block
      // (rather than deleting it) is the conservative choice: the operator can
      // re-enable by restoring a command, and we never destroy unrelated keys.
      const { command: _command, args: _args, ...rest } = blk;
      nextMcpServers[name] = { ...rest, enabled: false };
      convergence.push({ kind: "mcp-server-disabled", key: name });
      rationaleParts.push(`disable generic MCP server "${name}"`);
    }
    nextParsed["mcp_servers"] = nextMcpServers;
  }

  // Project trust: add the canonical worktree base + this worktree.
  if (trustToAdd.length > 0) {
    const nextProjects: Record<string, unknown> = { ...projects };
    for (const p of trustToAdd) {
      const blk = (projects[p] as Record<string, unknown> | undefined) ?? {};
      nextProjects[p] = { ...blk, trust_level: "trusted" };
      convergence.push({ kind: "project-trusted", key: p });
      rationaleParts.push(`trust project "${p}"`);
    }
    nextParsed["projects"] = nextProjects;
  }

  return {
    writes: [{ path: configPath, content: stringify(nextParsed) }],
    deletes: [],
    rationale: `${rationaleParts.join(" + ")} for ${repoRoot}.`,
    preservedUserIntent: userDisabledPlugin,
    convergence,
  };
}
