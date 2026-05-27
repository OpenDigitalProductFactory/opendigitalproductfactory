import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  planClaudePluginConfig,
  type InstalledPluginsFile,
} from "../claude-plugins";

const FIXTURES = join(__dirname, "fixtures");
const read = (name: string): InstalledPluginsFile =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as InstalledPluginsFile;

const REPO_LIVE = "D:\\DPF\\.claude\\worktrees\\agent-toolchain-phase-1";
const REPO_STALE_1 = "D:\\DPF-source-bootstrap-pnpm-ci";
const REPO_STALE_2 = "D:\\DPF-source-bootstrap-ignore-scripts";
const PLUGINS_FILE = "C:\\Users\\Test\\.claude\\plugins\\installed_plugins.json";

/** Deterministic pathExists for tests — live repo + arbitrary controlled paths. */
const buildPathExists = (live: Set<string>) => (path: string) => live.has(path);

describe("planClaudePluginConfig", () => {
  it("plans a fresh install when no DPF entries exist", () => {
    const file = read("installed-plugins-fresh.json");
    const plan = planClaudePluginConfig(REPO_LIVE, file, {
      pathExists: buildPathExists(new Set([REPO_LIVE])),
      pluginsFilePath: PLUGINS_FILE,
    });

    expect(plan.mode).toBe("create");
    expect(plan.writes).toHaveLength(1);
    expect(plan.staleEntriesToReconcile).toEqual([]);

    const next = JSON.parse(plan.writes[0].content) as InstalledPluginsFile;
    const entries = next.plugins["dpf-platform@dpf-platform-local"];
    expect(entries).toHaveLength(1);
    expect(entries[0].projectPath).toBe(REPO_LIVE);
    expect(entries[0].version).toBe("0.1.0");
    expect(entries[0].scope).toBe("local");
  });

  it("is a no-op when the plugin is already installed at the expected version", () => {
    const file = read("installed-plugins-already-installed.json");
    const plan = planClaudePluginConfig(REPO_LIVE, file, {
      pathExists: buildPathExists(new Set([REPO_LIVE])),
      pluginsFilePath: PLUGINS_FILE,
    });

    expect(plan.mode).toBe("noop");
    expect(plan.writes).toEqual([]);
    expect(plan.rationale).toMatch(/already installed/);
  });

  it("plans an upgrade when the installed version is older than expected", () => {
    const file = read("installed-plugins-version-drift.json");
    const plan = planClaudePluginConfig(REPO_LIVE, file, {
      pathExists: buildPathExists(new Set([REPO_LIVE])),
      pluginsFilePath: PLUGINS_FILE,
      expectedVersion: "0.1.0",
    });

    expect(plan.mode).toBe("update");
    expect(plan.writes).toHaveLength(1);

    const next = JSON.parse(plan.writes[0].content) as InstalledPluginsFile;
    const entries = next.plugins["dpf-platform@dpf-platform-local"];
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe("0.1.0");
    expect(plan.rationale).toMatch(/Upgrade .* 0\.0\.9 -> 0\.1\.0/);
  });

  it("warns about stale entries by default without removing them", () => {
    const file = read("installed-plugins-stale-entries.json");
    const plan = planClaudePluginConfig(REPO_LIVE, file, {
      pathExists: buildPathExists(new Set([REPO_LIVE])),
      pluginsFilePath: PLUGINS_FILE,
    });

    expect(plan.mode).toBe("noop");
    expect(plan.writes).toEqual([]);
    expect(plan.staleEntriesToReconcile).toHaveLength(2);
    const stalePaths = plan.staleEntriesToReconcile.map((s) => s.projectPath).sort();
    expect(stalePaths).toEqual([REPO_STALE_2, REPO_STALE_1].sort());
  });

  it("removes stale entries when reconcileStaleEntries is true", () => {
    const file = read("installed-plugins-stale-entries.json");
    const plan = planClaudePluginConfig(REPO_LIVE, file, {
      pathExists: buildPathExists(new Set([REPO_LIVE])),
      reconcileStaleEntries: true,
      pluginsFilePath: PLUGINS_FILE,
    });

    expect(plan.mode).toBe("update");
    expect(plan.writes).toHaveLength(1);

    const next = JSON.parse(plan.writes[0].content) as InstalledPluginsFile;
    const entries = next.plugins["dpf-platform@dpf-platform-local"];
    expect(entries).toHaveLength(1);
    expect(entries[0].projectPath).toBe(REPO_LIVE);
  });

  it("throws when a write plan is required but pluginsFilePath is missing", () => {
    const file = read("installed-plugins-fresh.json");
    expect(() =>
      planClaudePluginConfig(REPO_LIVE, file, {
        pathExists: buildPathExists(new Set([REPO_LIVE])),
      }),
    ).toThrow(/pluginsFilePath required/);
  });
});
