// BI-EF42607A — versioned process spine + conformance test (spec §6.1).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PROCESS_SPINE_VERSION } from "../packages/dpf-skill-pack/process-spine-version.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("PROCESS_SPINE_VERSION is a dated semver-ish string", () => {
  assert.match(PROCESS_SPINE_VERSION, /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/);
});

test("surface pointers reference AGENTS.md", () => {
  const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf8");
  assert.match(claudeMd, /AGENTS\.md/);
});

test("plugin hooks.json wires uncommitted-work guard on SessionEnd and Stop", () => {
  const hooks = JSON.parse(
    readFileSync(join(repoRoot, "packages/dpf-skill-pack/hooks/hooks.json"), "utf8"),
  );
  for (const event of ["SessionEnd", "Stop"]) {
    const groups = hooks?.hooks?.[event] ?? [];
    const cmds = groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? ""));
    assert.ok(
      cmds.some((c) => c.includes("uncommitted-work-guard.mjs")),
      `${event} must run uncommitted-work-guard.mjs`,
    );
  }
  assert.ok(
    existsSync(join(repoRoot, "packages/dpf-skill-pack/hooks/uncommitted-work-guard.mjs")),
  );
});

test("settings.json wires uncommitted-work guard on SessionEnd (race-immune plane)", () => {
  const settingsPath = join(repoRoot, ".claude/settings.json");
  if (!existsSync(settingsPath)) return;
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const cmds = (settings?.hooks?.SessionEnd ?? []).flatMap((g) =>
    (g.hooks ?? []).map((h) => h.command ?? ""),
  );
  assert.ok(cmds.some((c) => c.includes("uncommitted-work-guard.mjs")));
});

test("tracked post-checkout chain invokes uncommitted-work guard", () => {
  const hook = readFileSync(join(repoRoot, ".githooks/lib/post-checkout-chained.sh"), "utf8");
  assert.match(hook, /uncommitted-work-guard\.mjs/);
});

test("Codex config planner stays native-first and repairs only duplicate DPF MCP tables", () => {
  const planner = readFileSync(
    join(repoRoot, "packages/dpf-bootstrap/src/agent-toolchain/codex-config.ts"),
    "utf8",
  );
  const plannerTest = readFileSync(
    join(repoRoot, "packages/dpf-bootstrap/src/agent-toolchain/__tests__/codex-config.test.ts"),
    "utf8",
  );
  const readme = readFileSync(join(repoRoot, "packages/dpf-bootstrap/README.md"), "utf8");

  assert.match(readme, /Client-native integration rule/);
  assert.match(planner, /import \{ parse, stringify \} from "smol-toml";/);
  assert.match(planner, /collapseDuplicateTomlTable\(normalizedTomlText, "mcp_servers\.dpf"\)/);
  assert.match(planner, /TOML parse error; refusing to write/);
  assert.match(plannerTest, /repairs a duplicate \[mcp_servers\.dpf\] table/);
});

test("typecheck gates include the bootstrap planning library", () => {
  const hook = readFileSync(join(repoRoot, ".githooks/pre-commit"), "utf8");
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  assert.match(hook, /RUN_BOOTSTRAP=0/);
  assert.match(hook, /packages\/dpf-bootstrap\/\*\)\s+RUN_BOOTSTRAP=1/);
  assert.match(hook, /run_typecheck "@dpf\/bootstrap"\s+"packages\/dpf-bootstrap"/);
  assert.match(rootPackage.scripts.typecheck, /--filter @dpf\/bootstrap typecheck/);
});
