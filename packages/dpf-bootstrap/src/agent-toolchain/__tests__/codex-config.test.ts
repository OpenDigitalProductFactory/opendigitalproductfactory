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

describe("planCodexConfig", () => {
  it("upserts [plugins.\"dpf-platform\"] enabled=true on the operator-current fixture", () => {
    const plan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);

    expect(plan.writes).toHaveLength(1);
    expect(plan.deletes).toEqual([]);
    expect(plan.preservedUserIntent).toBe(false);
    expect(plan.rationale).toMatch(/Upserting/);
    expect(plan.writes[0].path).toBe(CONFIG_PATH);

    const parsed = parse(plan.writes[0].content) as {
      plugins: Record<string, { enabled: boolean }>;
    };
    expect(parsed.plugins["dpf-platform"]).toEqual({ enabled: true });
  });

  it("preserves byte-equivalence of all other declared blocks across the upsert", () => {
    const plan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);
    const beforeParsed = parse(operatorRedacted) as Record<string, unknown>;
    const afterParsed = parse(plan.writes[0].content) as Record<string, unknown>;

    const top = ["approval_policy", "sandbox_mode", "model", "model_reasoning_effort"] as const;
    for (const key of top) {
      expect(afterParsed[key]).toEqual(beforeParsed[key]);
    }

    const blockKeys = ["mcp_servers", "windows", "features", "projects", "marketplaces", "tui", "desktop"] as const;
    for (const block of blockKeys) {
      expect(afterParsed[block]).toEqual(beforeParsed[block]);
    }

    const beforePlugins = beforeParsed.plugins as Record<string, unknown>;
    const afterPlugins = afterParsed.plugins as Record<string, unknown>;
    for (const otherPlugin of Object.keys(beforePlugins)) {
      expect(afterPlugins[otherPlugin]).toEqual(beforePlugins[otherPlugin]);
    }
  });

  it("is idempotent: re-running on the post-upsert text produces zero writes", () => {
    const firstPlan = planCodexConfig(operatorRedacted, REPO, CONFIG_PATH);
    const afterUpsert = firstPlan.writes[0].content;

    const secondPlan = planCodexConfig(afterUpsert, REPO, CONFIG_PATH);

    expect(secondPlan.writes).toEqual([]);
    expect(secondPlan.rationale).toMatch(/already enabled/);
  });

  it("preserves user intent when the plugin is explicitly disabled", () => {
    const plan = planCodexConfig(withUserDisable, REPO, CONFIG_PATH);

    expect(plan.writes).toEqual([]);
    expect(plan.preservedUserIntent).toBe(true);
    expect(plan.rationale).toMatch(/enabled=false/);
    expect(plan.rationale).toMatch(/preserving user intent/);
  });

  it("returns zero writes with a parse-error rationale on unparseable TOML", () => {
    const broken = "[unterminated\nkey = ";
    const plan = planCodexConfig(broken, REPO, CONFIG_PATH);

    expect(plan.writes).toEqual([]);
    expect(plan.rationale).toMatch(/TOML parse error/);
    expect(plan.preservedUserIntent).toBe(false);
  });

  it("handles empty existing config (fresh contributor)", () => {
    const plan = planCodexConfig("", REPO, CONFIG_PATH);

    expect(plan.writes).toHaveLength(1);
    const parsed = parse(plan.writes[0].content) as { plugins: Record<string, { enabled: boolean }> };
    expect(parsed.plugins["dpf-platform"]).toEqual({ enabled: true });
  });
});
