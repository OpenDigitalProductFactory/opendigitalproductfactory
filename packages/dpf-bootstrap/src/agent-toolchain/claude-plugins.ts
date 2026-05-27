/**
 * Plan idempotent edits to `~/.claude/plugins/installed_plugins.json` so the
 * `dpf-platform@dpf-platform-local` plugin is installed for the current repo
 * root, with optional reconciliation of stale entries pointing at deleted
 * worktrees.
 *
 * Pure JSON arithmetic — no `claude plugin install` invocation. Shell adapter
 * applies the plan (or invokes `claude plugin install ... --scope local` if
 * the plan calls for it).
 */

import { existsSync } from "node:fs";

import type { PlanWriteMode } from "./types";

export type InstalledPluginEntry = {
  scope: "local" | "project" | "user";
  projectPath?: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha?: string;
};

export type InstalledPluginsFile = {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
};

export type ClaudePluginConfigPlan = {
  writes: Array<{ path: string; content: string }>;
  /** Stale plugin entries detected (projectPath no longer exists). */
  staleEntriesToReconcile: Array<{ plugin: string; projectPath: string }>;
  /** Whether the plan represents a fresh install, an upgrade, or a no-op. */
  mode: PlanWriteMode | "noop";
  rationale: string;
};

export type PlanClaudePluginOptions = {
  /** Caller-supplied detector for stale paths. Defaults to `node:fs.existsSync`. */
  pathExists?: (path: string) => boolean;
  /** If true, plan includes write to remove stale entries. Default: warn-only. */
  reconcileStaleEntries?: boolean;
  /** Expected plugin version pinned by the skill pack manifest. Triggers upgrade. */
  expectedVersion?: string;
  /** Path the plan would write back to. Required for any write plan. */
  pluginsFilePath?: string;
};

const PLUGIN_KEY = "dpf-platform@dpf-platform-local";
const MARKETPLACE = "dpf-platform-local";

export function planClaudePluginConfig(
  repoRoot: string,
  existingPluginsJson: unknown,
  options: PlanClaudePluginOptions = {},
): ClaudePluginConfigPlan {
  const pathExists = options.pathExists ?? existsSync;
  const reconcile = options.reconcileStaleEntries === true;
  const expectedVersion = options.expectedVersion ?? "0.1.0";
  const pluginsFilePath = options.pluginsFilePath;

  const file: InstalledPluginsFile =
    existingPluginsJson && typeof existingPluginsJson === "object"
      ? (existingPluginsJson as InstalledPluginsFile)
      : { version: 2, plugins: {} };

  if (!file.plugins) {
    file.plugins = {};
  }

  const entries = file.plugins[PLUGIN_KEY] ?? [];

  // Identify stale entries (projectPath no longer on disk).
  const staleEntriesToReconcile: Array<{ plugin: string; projectPath: string }> = [];
  for (const entry of entries) {
    if (entry.projectPath && !pathExists(entry.projectPath)) {
      staleEntriesToReconcile.push({
        plugin: PLUGIN_KEY,
        projectPath: entry.projectPath,
      });
    }
  }

  // Find any entry pinning the current repo root.
  const existingForRepo = entries.find((e) => e.projectPath === repoRoot);

  // Decide the mode.
  let mode: PlanWriteMode | "noop" = "noop";
  let nextEntries = entries.slice();

  if (!existingForRepo) {
    mode = "create";
  } else if (existingForRepo.version !== expectedVersion) {
    mode = "update";
  }

  if (reconcile && staleEntriesToReconcile.length > 0) {
    // The stale-removal write happens whether or not we also add/upgrade.
    nextEntries = nextEntries.filter(
      (e) => !e.projectPath || pathExists(e.projectPath),
    );
    if (mode === "noop") {
      mode = "update";
    }
  }

  if (mode === "create" || mode === "update") {
    const now = new Date().toISOString();
    const nextEntry: InstalledPluginEntry = {
      scope: "local",
      projectPath: repoRoot,
      installPath: `<cache>/${MARKETPLACE}/dpf-platform/${expectedVersion}`,
      version: expectedVersion,
      installedAt: existingForRepo?.installedAt ?? now,
      lastUpdated: now,
    };
    nextEntries = nextEntries.filter((e) => e.projectPath !== repoRoot);
    nextEntries.push(nextEntry);
  }

  if (mode === "noop") {
    return {
      writes: [],
      staleEntriesToReconcile,
      mode,
      rationale: staleEntriesToReconcile.length > 0
        ? `dpf-platform already installed for ${repoRoot}; ${staleEntriesToReconcile.length} stale entries detected (warn-only)`
        : `dpf-platform already installed for ${repoRoot} at ${expectedVersion}`,
    };
  }

  if (!pluginsFilePath) {
    throw new Error(
      "planClaudePluginConfig: pluginsFilePath required when plan has writes",
    );
  }

  const nextFile: InstalledPluginsFile = {
    ...file,
    plugins: { ...file.plugins, [PLUGIN_KEY]: nextEntries },
  };

  let rationale: string;
  if (mode === "create") {
    rationale = `Install dpf-platform@${expectedVersion} (scope=local) for ${repoRoot}.`;
  } else {
    rationale = existingForRepo
      ? `Upgrade dpf-platform from ${existingForRepo.version} -> ${expectedVersion} for ${repoRoot}.`
      : `Reconcile stale entries (${staleEntriesToReconcile.length}) for ${repoRoot}.`;
  }

  return {
    writes: [{ path: pluginsFilePath, content: JSON.stringify(nextFile, null, 2) }],
    staleEntriesToReconcile,
    mode,
    rationale,
  };
}
