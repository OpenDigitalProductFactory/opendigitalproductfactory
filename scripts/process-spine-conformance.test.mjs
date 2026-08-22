// BI-EF42607A — versioned process spine + conformance test (spec §6.1).
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
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

  // The property is "root typecheck covers @dpf/bootstrap", not "root
  // typecheck names @dpf/bootstrap". A recursive sweep satisfies it for every
  // package at once, so pinning the explicit filter string would forbid the
  // stronger form — and an enumerated list is what let dpf-edge-node go
  // untypechecked until its release build failed.
  const rootTypecheck = rootPackage.scripts.typecheck;
  const sweepsWorkspace = /pnpm -r\b[^&|]*\btypecheck\b/.test(rootTypecheck);
  assert.ok(
    sweepsWorkspace || /--filter @dpf\/bootstrap typecheck/.test(rootTypecheck),
    `root typecheck must cover @dpf/bootstrap, got: ${rootTypecheck}`,
  );

  // A sweep only covers the package if the package actually defines the
  // script the sweep looks for, so assert that rather than assuming it.
  if (sweepsWorkspace) {
    const bootstrapPackage = JSON.parse(
      readFileSync(join(repoRoot, "packages/dpf-bootstrap/package.json"), "utf8"),
    );
    assert.ok(
      bootstrapPackage.scripts?.typecheck,
      "@dpf/bootstrap must define a typecheck script for the recursive sweep to pick it up",
    );
  }
});

test("every direct protected FeatureBuild phase writer references the canonical initiative gate", () => {
  const root = join(repoRoot, "apps/web/lib");
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(path);
    }
  };
  visit(root);
  const directWriter = /featureBuild\.(?:update|updateMany)\s*\([\s\S]{0,300}?data:\s*\{[\s\S]{0,160}?phase:\s*(?:"plan"|"build"|"ship"|"complete"|targetPhase)/;
  const writers = files
    .filter((path) => !path.includes(`${join("initiative-readiness")}\\`) && directWriter.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(repoRoot.length + 1).replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(writers, [
    "apps/web/lib/actions/build.ts",
    "apps/web/lib/build/build-on-plan-approval.ts",
    "apps/web/lib/build/plan-to-build-transition.ts",
    "apps/web/lib/build/ship-on-review-approval.ts",
    "apps/web/lib/mcp/build-design-review-handler.ts",
  ]);
  for (const path of writers) {
    const source = readFileSync(join(repoRoot, path), "utf8");
    assert.match(source, /from "@\/lib\/build\/build-entry-gate"/);
    assert.match(source, /(?:enforceBuildInitiativeReadiness|assertBuildPhaseInitiativeReadiness)/);
  }
});

test("protected terminal success rows are written only by initiative terminal repositories", () => {
  const root = join(repoRoot, "apps/web");
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(path);
    }
  };
  visit(root);

  const contracts = [
    {
      label: "BacklogItem done",
      pattern: /backlogItem\.(?:update|updateMany)\s*\([\s\S]{0,500}?data:\s*\{[\s\S]{0,260}?status:\s*"done"/,
      allowed: ["apps/web/lib/backlog/initiative-readiness/backlog-terminal-transition.ts"],
    },
    {
      label: "Epic done",
      pattern: /epic\.(?:update|updateMany)\s*\([\s\S]{0,500}?data:\s*\{[\s\S]{0,260}?status:\s*"done"/,
      allowed: ["apps/web/lib/backlog/initiative-readiness/epic-terminal-transition.ts"],
    },
    {
      label: "FeatureBuild complete",
      pattern: /featureBuild\.(?:update|updateMany)\s*\([\s\S]{0,500}?data:\s*\{[\s\S]{0,260}?phase:\s*"complete"/,
      allowed: ["apps/web/lib/backlog/initiative-readiness/build-terminal-transition.ts"],
    },
    {
      label: "Workroom complete",
      pattern: /workroom\.(?:update|updateMany)\s*\([\s\S]{0,500}?data:\s*\{[\s\S]{0,260}?status:\s*"complete"/,
      allowed: ["apps/web/lib/backlog/initiative-readiness/work-capsule-terminal-transition.ts"],
    },
  ];

  for (const contract of contracts) {
    const writers = files
      .filter((path) => contract.pattern.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(repoRoot.length + 1).replaceAll("\\", "/"))
      .sort();
    assert.deepEqual(writers, contract.allowed, `${contract.label} bypassed the canonical terminal boundary`);
  }

  const routedSurfaces = [
    "apps/web/app/api/v1/ops/backlog/[id]/route.ts",
    "apps/web/app/api/v1/ops/epics/[id]/route.ts",
    "apps/web/lib/actions/backlog.ts",
    "apps/web/lib/mcp/packs/backlog-pack.ts",
    "apps/web/lib/backlog/mcp-epic-tools.ts",
    "apps/web/lib/build-flow-state.ts",
    "apps/web/lib/actions/build.ts",
    "apps/web/lib/mcp/packs/build-evidence-extra-pack.ts",
    "apps/web/lib/work-capsules/work-capsule-store.ts",
  ];
  for (const path of routedSurfaces) {
    assert.match(
      readFileSync(join(repoRoot, path), "utf8"),
      /(?:complete(?:BacklogItem|Epic|FeatureBuild|WorkCapsule)Transition|assertFeatureBuildCompletion|completeGovernedWorkCapsuleStatus)/,
      `${path} must route terminal success through the canonical repository`,
    );
  }

  const backlogActions = readFileSync(join(repoRoot, "apps/web/lib/actions/backlog.ts"), "utf8");
  const epicTools = readFileSync(join(repoRoot, "apps/web/lib/backlog/mcp-epic-tools.ts"), "utf8");
  const capsuleStore = readFileSync(join(repoRoot, "apps/web/lib/work-capsules/work-capsule-store.ts"), "utf8");
  assert.match(backlogActions, /input\.status === "done"[\s\S]{0,180}?Create the item as open/);
  assert.match(backlogActions, /input\.status === "done"[\s\S]{0,180}?Create the Epic as open/);
  assert.match(epicTools, /statusResult\.status === "done"[\s\S]{0,220}?Create the Epic as open/);
  assert.match(capsuleStore, /input\.status === "complete"[\s\S]{0,220}?non-terminal state/);
});
