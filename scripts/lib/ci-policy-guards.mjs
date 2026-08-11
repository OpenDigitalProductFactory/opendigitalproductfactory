import { spawnSync } from "node:child_process";

function guard(legacyJobId, name, commands) {
  return {
    id: legacyJobId,
    legacyJobId,
    name,
    commands,
  };
}

const node = (...args) => ["node", args];
const git = (...args) => ["git", args];
const pnpm = (...args) => ["pnpm", args];

export const LOCAL_READINESS_PROFILE_NAMES = Object.freeze([
  "source",
  "workspace",
  "pull-request",
]);

export function isPolicyGuardSelfTest([command, args]) {
  return command === "node" && args[0] === "--test"
    || command === "pnpm" && args[0] === "run" && args[1]?.endsWith(":test");
}

function quoteWindowsCommandToken(token) {
  const value = String(token);
  if (!/[\s"&|<>^()%]/.test(value)) return value;
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

export function resolvePolicyGuardInvocation(
  command,
  args,
  { platform = process.platform, env = process.env } = {},
) {
  if (platform !== "win32" || command !== "pnpm") {
    return { command, args };
  }
  return {
    command: env.ComSpec || env.COMSPEC || "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      [command, ...args].map(quoteWindowsCommandToken).join(" "),
    ],
  };
}

export const POLICY_GUARD_PROFILES = Object.freeze({
  source: Object.freeze([
    guard("repo-guard-loop", "Repo Guard Loop", [
      node("--test", "scripts/check-guards.test.mjs"),
      node("scripts/check-guards.mjs"),
      node("--test", "scripts/check-capability-compose-profiles.test.mjs"),
      node("scripts/check-capability-compose-profiles.mjs"),
    ]),
    guard("host-port-range-guard", "Host Port Range Guard", [
      node("--test", "scripts/check-host-port-range.test.mjs"),
    ]),
    guard("docs-link-integrity", "Docs Link Integrity", [
      node("scripts/gen-doc-index.mjs", "--check"),
      node(
        "--test",
        "scripts/check-doc-links.test.mjs",
        "scripts/public-docs-rendering.test.mjs",
      ),
      node("scripts/check-doc-links.mjs"),
      node("scripts/render-doc-diagrams.mjs", "--check"),
    ]),
    guard("derived-artifact-registry", "Derived Artifact Registry", [
      node(
        "--test",
        "scripts/lib/derived-artifacts-registry.test.mjs",
        "scripts/derived-artifacts-gate.test.mjs",
      ),
      node("scripts/derived-artifacts-gate.mjs", "check-all"),
    ]),
    guard("pr-health-test", "PR Health Logic", [
      node(
        "--test",
        "scripts/pr-health.test.mjs",
        "scripts/check-ci-build-cache.test.mjs",
        "scripts/lib/dev-preview-migrate-converge.test.mjs",
        "scripts/dev-postgres-pgvector-contract.test.mjs",
        "scripts/lib/ci-observation.test.mjs",
        "scripts/ci-observation.test.mjs",
        "scripts/ci-shadow-selection.test.mjs",
        "scripts/ci-coverage-config.test.mjs",
        "scripts/ci-change-scope.test.mjs",
        "scripts/ci-evidence-plan.test.mjs",
        "scripts/ci-evidence-workflow.test.mjs",
        "scripts/ci-build-artifact-workflow.test.mjs",
        "scripts/ci-build-artifact-discovery.test.mjs",
        "scripts/lib/ci-build-artifact.test.mjs",
        "scripts/lib/ci-evidence-plan.test.mjs",
        "scripts/ci-policy-guards.test.mjs",
        // BI-812C676D: every covered-root *.test.mjs must appear here or on the
        // deliberate allowlist — otherwise CI stays green while the test never runs.
        "scripts/lib/ci-policy-test-inventory.test.mjs",
        "scripts/pregate-preflight.test.mjs",
        "scripts/gate-context.test.mjs",
        "scripts/pre-push-dco-check.test.mjs",
      ),
      node("scripts/check-ci-policy-test-inventory.mjs"),
    ]),
    guard("mobile-jest-pin-guard", "Mobile Jest Pin Guard", [
      node("scripts/check-mobile-jest-pin.mjs"),
    ]),
    guard("diagram-dependency-pin-guard", "Diagram Dependency Pin Guard", [
      node("scripts/check-diagram-dependency-pins.mjs"),
    ]),
    guard("override-provenance-guard", "Workspace Supply-Chain Policy", [
      node("scripts/check-override-comments.mjs"),
      node("--test", "scripts/check-override-comments.test.mjs"),
      node("scripts/check-build-script-policy.mjs"),
      node("--test", "scripts/check-build-script-policy.test.mjs"),
      node("--test", "scripts/check-root-script-runtime.test.mjs"),
    ]),
    guard("bundle-boundary-guard", "Bundle Boundary Guard", [
      node("scripts/check-bundle-boundaries.mjs"),
    ]),
    guard("application-boundary-guard", "Application Boundary Guard", [
      node("--test", "scripts/check-application-boundaries.test.mjs"),
      node("scripts/check-application-boundaries.mjs"),
    ]),
    guard("style-drift-guard", "Style Drift Guard", [
      node("scripts/check-style-drift.mjs"),
    ]),
    guard("reporting-composition-guard", "Reporting Composition Guard", [
      node("scripts/check-reporting-composition.mjs"),
    ]),
    guard("compose-env-contract-guard", "Compose Env Contract Guard", [
      node("scripts/check-compose-env-contract.mjs"),
    ]),
    guard("compose-resource-budgets-guard", "Compose Resource Budgets Guard", [
      node("--test", "scripts/check-compose-resource-budgets.test.mjs"),
      node("scripts/check-compose-resource-budgets.mjs"),
    ]),
    guard("n-minus-one-caller-honesty", "N-1 Caller Honesty", [
      node("--test", "scripts/check-n-minus-one-caller-honesty.test.mjs"),
      node("scripts/check-n-minus-one-caller-honesty.mjs"),
    ]),
    guard("module-size-guard", "Module Size Guard", [
      node("scripts/check-module-size.mjs"),
    ]),
    // Diff-scoped by design: repo-wide, the pattern matches 255 fixtures across 125
    // files, nearly all legitimate (far-future sentinels, deliberately-expired rows).
    // Gating on that would need a 125-file baseline — the silent allowlist this is
    // meant to replace. It stops NEW bombs; the audit cleared the planted ones.
    guard("test-clock-bomb-guard", "Test Clock Bomb Guard", [
      node("--test", "scripts/check-test-clock-bombs.test.mjs"),
      node("scripts/check-test-clock-bombs.mjs"),
    ]),
    guard("instruction-plane-guard", "Instruction Plane Guard", [
      node("--test", "scripts/check-instruction-plane-size.test.mjs"),
      node("scripts/check-instruction-plane-size.mjs"),
    ]),
    // The size ratchet's twin: bytes measure the cut, this measures what the cut LOST.
    // A byte gate scores deleting a commandment identically to relocating it, so Phase 1
    // needs both or "58% smaller" is unfalsifiable (BI-0020D511 §12f).
    guard("instruction-plane-rule-coverage", "Instruction Plane Rule Coverage", [
      node("--test", "scripts/check-instruction-plane-rule-coverage.test.mjs"),
      node("scripts/check-instruction-plane-rule-coverage.mjs"),
    ]),
    // Plane-3 sibling of the instruction-plane guard, deliberately a SOFTER shape: it
    // never forbids growth in standing context cost, only growth recorded in silence.
    guard("context-economy-guard", "Context Economy Guard", [
      node("--test", "scripts/check-context-economy.test.mjs"),
      node("scripts/check-context-economy.mjs"),
    ]),
    // Plane 4 — the standing TOOL registry, same soft shape and reusing plane 3's claim
    // review. Dispatch-time caps are governed elsewhere; this is the part that accretes.
    guard("tool-surface-guard", "Tool Surface Guard", [
      node("--test", "scripts/check-tool-surface.test.mjs"),
      node("scripts/check-tool-surface.mjs"),
    ]),
    guard("archetype-completeness-guard", "Archetype Completeness Guard", [
      node("--test", "scripts/check-archetype-completeness.test.mjs"),
      node("scripts/check-archetype-completeness.mjs"),
    ]),
    guard("stewardship-scope-guard", "Stewardship Scope Guard", [
      node("--test", "scripts/check-stewardship-scope.test.mjs"),
      node("scripts/check-stewardship-scope.mjs"),
    ]),
    guard("capability-consumer-guard", "Capability Consumer Guard", [
      node("--test", "scripts/check-capability-consumers.test.mjs"),
      node("scripts/check-capability-consumers.mjs"),
    ]),
    guard("finding-substrate-guard", "Finding Substrate Guard", [
      node("--test", "scripts/check-finding-substrate.test.mjs"),
      node("scripts/check-finding-substrate.mjs"),
    ]),
    guard("docs-staleness-detector", "Docs Staleness Detector", [
      node("--test", "scripts/build-docs-staleness.test.mjs"),
    ]),
    // Catches the words, not the edges: a published page naming a service the
    // platform no longer runs. Complements the doc-impact graph, whose
    // `relatedCode:` edges only protect pages someone remembered to annotate.
    guard("retired-substrate-guard", "Retired Substrate Guard", [
      node("--test", "scripts/check-retired-substrate.test.mjs"),
      node("scripts/check-retired-substrate.mjs"),
    ]),
    guard("mcp-tool-pack-guard", "MCP Tool Pack Guard", [
      node("scripts/check-mcp-tool-pack.mjs"),
    ]),
    guard("package-boundary-guard", "Package Boundary Guard", [
      node("scripts/check-package-boundaries.mjs"),
    ]),
    guard("build-studio-namespace-guard", "Build Studio Namespace Guard", [
      node("scripts/check-build-namespace.mjs"),
    ]),
    guard("sbom-divergence-guard", "SBOM Divergence Guard", [
      node("scripts/sbom/check-sbom-drift.mjs"),
    ]),
    guard("new-dependency-gate", "New Dependency Gate", [
      node("scripts/sbom/check-new-dependencies.mjs"),
    ]),
    guard("singleton-safety-guard", "Singleton Safety Guard", [
      node("scripts/sbom/check-singleton-safety.mjs"),
    ]),
    guard("doc-reference-integrity", "Doc Reference Integrity", [
      node("--test", "scripts/check-doc-reference-integrity.test.mjs"),
      node("scripts/check-doc-reference-integrity.mjs"),
    ]),
    guard("janitor-tests", "Janitor Tests", [
      node(
        "--test",
        "scripts/lib/runtime-artifact-janitor.test.mjs",
        "scripts/runtime-artifact-janitor.cli.test.mjs",
        // BI-C85D1B0A: managed BuildKit cool-down / obsolete policy reap planner.
        "scripts/lib/local-ci-builder-lifecycle.test.mjs",
        "scripts/lib/junction-safe-worktree-remove.test.mjs",
        "scripts/lib/compose-safety.test.mjs",
        "scripts/lib/local-integration-ci.test.mjs",
        "scripts/lib/sandbox-freshness.test.mjs",
        "scripts/sandbox-freshness-preflight.test.mjs",
        "scripts/release/re-resolve-stt-digest.test.mjs",
        "scripts/lib/ensure-pre-push-hook.test.mjs",
        "scripts/lib/agent-identity.test.mjs",
        "tests/release/local-ci-gate-contract.test.mjs",
        "tests/release/pregate-node-gate-contract.test.mjs",
        // BI-B1065D41: the gate's console policy (what reaches stdout, EPIPE
        // tolerance, the bounded verdict block) and the pregate:status verdict
        // reader. This inventory is hand-enumerated — there is no glob — so a
        // test file omitted here simply never runs in CI, and a green PR says
        // nothing about it.
        "scripts/lib/pregate-console.test.mjs",
        "scripts/lib/pregate-status.test.mjs",
      ),
      node("scripts/runtime-artifact-janitor.mjs", "--help"),
    ]),
  ]),
  // Guards in this profile are still cheap and deterministic, but they import
  // workspace packages or use the workspace's pinned TypeScript executor.
  // Keeping them separate preserves the source profile's minimal install while
  // letting CI, pregate preflight, and pr:ready consume one canonical inventory.
  workspace: Object.freeze([
    guard("fpaw-standard-guard", "FPAW Standard Guard", [
      pnpm("run", "check:fpaw-standard:test"),
      pnpm("run", "check:fpaw-standard"),
    ]),
    guard("prose-lint-guard", "Prose Lint Guard", [
      pnpm("run", "check:prose-lint:test"),
      pnpm("run", "check:prose-lint"),
    ]),
  ]),
  "pull-request": Object.freeze([
    guard("ux-fit-gate", "UX-Fit Gate", [
      node("--test", "packages/dpf-skill-pack/hooks/ux-fit-precheck.test.mjs"),
      // BI-D967DEE0: the gate's own red/green fixtures run before the gate, so a
      // validator that stopped rejecting attestation theater fails loudly here rather
      // than silently passing every UI PR.
      node("--test", "scripts/check-ux-fit-decision.test.mjs"),
      node("scripts/check-ux-fit-decision.mjs"),
    ]),
    guard("docs-impact-gate", "Docs Impact Gate", [
      node(
        "--test",
        "scripts/check-docs-impact.test.mjs",
        "scripts/gen-doc-impact.test.mjs",
        // BI-3E5969DF. The coverage measurement is NOT run as a gate here (it is
        // advisory, refreshed weekly by refresh-docs-staleness.yml) but its
        // arithmetic is tested here, because a wrong coverage number argues for
        // the wrong gating decision. This list is hand-enumerated with no glob —
        // a test that is not named here never runs.
        "scripts/measure-doc-staleness-coverage.test.mjs",
      ),
      node("scripts/gen-doc-impact.mjs", "--check"),
      node("scripts/check-docs-impact.mjs"),
    ]),
    guard("seed-fit-gate", "Seed Contribution Fit Gate", [
      node("--test", "scripts/check-seed-fit-decision.test.mjs"),
      node("scripts/check-seed-fit-decision.mjs"),
    ]),
    guard("spec-plan-doc-gate", "Spec/Plan/Doc Gate", [
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/spec-plan-doc-precheck.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/plan-backlog-coverage-guard.test.mjs",
        "scripts/check-plan-backlog-coverage.test.mjs",
      ),
      node("--test", "packages/dpf-skill-pack/hooks/lease-guard.test.mjs"),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/lease-punt-guard.test.mjs",
        "packages/dpf-skill-pack/hooks/command-text.test.mjs",
      ),
      node("--test", "packages/dpf-skill-pack/hooks/root-clone-guard.test.mjs"),
      node("--test", "packages/dpf-skill-pack/hooks/compose-guard.test.mjs"),
      node("--test", "packages/dpf-skill-pack/hooks/worktree-create.test.mjs"),
      // BI-B1065D41 / BI-1C1483C6: the sixth PreToolUse guard and the
      // SessionStart readiness banner. Both are hand-added here for the same
      // reason as every entry above — an unlisted test file never runs.
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/pregate-invocation-guard.test.mjs",
        "packages/dpf-skill-pack/hooks/worktree-readiness-banner.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/plugin-hooks-wired.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/uncommitted-work-guard.test.mjs",
      ),
      node(
        "--test",
        "scripts/process-spine-conformance.test.mjs",
        "scripts/lib/ensure-post-checkout-hook.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/surface-manifest-paths.test.mjs",
      ),
      node("scripts/check-spec-plan-doc.mjs"),
      node("scripts/check-plan-backlog-coverage.mjs"),
    ]),
    guard("data-impact-gate", "Data-Impact Gate", [
      node("--test", "scripts/check-data-impact.test.mjs"),
      node("scripts/check-data-impact.mjs"),
    ]),
    guard("design-grounding-gate", "Design Grounding Gate", [
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/design-grounding-precheck.test.mjs",
      ),
      node("--test", "scripts/check-design-grounding-decision.test.mjs"),
      node("scripts/check-design-grounding-decision.mjs"),
    ]),
    guard("decision-baseline", "Decision Baseline", [
      git("config", "user.email", "dpf-ci@users.noreply.github.com"),
      git("config", "user.name", "dpf-ci"),
      git("fetch", "--no-tags", "--quiet", "origin", "main"),
      git("merge", "--no-edit", "origin/main"),
      node("scripts/check-golden-decisions.mjs"),
      node("--test", "scripts/check-golden-decisions.test.mjs"),
    ]),
  ]),
});

/**
 * Build the consolidated end-of-run summary for a policy-guard profile.
 *
 * The per-guard logger in the CLI only annotates a failure INSIDE the guard's
 * `::group::…::endgroup::` block, which GitHub collapses by default. Because
 * `runPolicyProfile` runs every guard even after one fails, the last guard's
 * output (for `source`, the janitor `--help` USAGE text) is what a reader sees
 * at the tail — with no hint of which earlier guard actually failed. That gap
 * caused a real misdiagnosis (a module-size ratchet failure read as a janitor
 * flake). This summary is printed OUTSIDE any group so the failing guard(s) and
 * their exact failing command are always the last thing in the log.
 *
 * Returns `{ text, annotation }`: `text` is the human block for the log tail;
 * `annotation` is a single `::error` workflow command (null when everything
 * passed) so the failing guards also surface as a GitHub annotation.
 */
export function formatRunSummary(profile, result) {
  const failed = result.entries.filter((entry) => entry.status === "failed");
  const total = result.entries.length;
  const passed = total - failed.length;

  if (failed.length === 0) {
    return {
      text: `Policy guards (${profile}): all ${total} guard(s) passed.`,
      annotation: null,
    };
  }

  const lines = [
    `Policy guards (${profile}): ${failed.length} of ${total} guard(s) FAILED (${passed} passed):`,
    ...failed.map(
      (entry) =>
        `  ✗ ${entry.name} — ${entry.failedCommand ?? "(command not recorded)"}`,
    ),
  ];
  return {
    text: lines.join("\n"),
    annotation: `::error title=Policy Guards (${profile})::${failed.length} guard(s) failed: ${failed
      .map((entry) => entry.name)
      .join(", ")}`,
  };
}

export async function runPolicyProfile({
  entries,
  execute = (command, args) => {
    const invocation = resolvePolicyGuardInvocation(command, args);
    return spawnSync(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: false,
    }).status ?? 1;
  },
  logger = () => {},
  now = () => Date.now(),
}) {
  const results = [];

  for (const entry of entries) {
    const startedAt = now();
    let status = "passed";
    let failedCommand = null;
    logger({ type: "start", entry });

    for (const [command, args] of entry.commands) {
      const exitCode = execute(command, args);
      if (exitCode !== 0) {
        status = "failed";
        failedCommand = [command, ...args].join(" ");
        break;
      }
    }

    const result = {
      id: entry.id,
      legacyJobId: entry.legacyJobId,
      name: entry.name,
      status,
      durationMs: Math.max(0, now() - startedAt),
      failedCommand,
    };
    results.push(result);
    logger({ type: "finish", entry, result });
  }

  return {
    ok: results.every((result) => result.status === "passed"),
    entries: results,
  };
}
