import { spawnSync } from "node:child_process";
import { resolveHostCommandInvocation } from "./host-command-invocation.mjs";

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

/**
 * A `node --test` command that asserts LIVE REPOSITORY STATE rather than guard
 * logic — a CONFORMANCE ASSERTION, not a self-test (BI-7B249AFE).
 *
 * The host-side preflight strips `node --test` commands because a guard's unit
 * tests prove the guard and CI runs them anyway. That reasoning does not reach a
 * test whose assertion is about the repository: stripping it removes the only
 * check on that tree, so the preflight reports clean where CI fails
 * deterministically. Marking the command keeps it in the host-side plan.
 *
 * The mark is not a matter of taste. `scripts/check-guard-conformance-marks.mjs`
 * detects the shape statically and fails when a detected file is unmarked, so a
 * new repository-reading self-test cannot quietly rejoin the stripped set.
 */
const conformanceTest = (...args) => ["node", ["--test", ...args], { conformance: true }];

export const LOCAL_READINESS_PROFILE_NAMES = Object.freeze([
  "source",
  "workspace",
  "pull-request",
]);

/** A guard command explicitly marked as a conformance assertion over repo state. */
export function isPolicyGuardConformanceCommand(command) {
  return Array.isArray(command) && command[2]?.conformance === true;
}

export function isPolicyGuardSelfTest([command, args, options]) {
  // A conformance assertion is written with `node --test` but is not a self-test:
  // it reads the repository, so the host is the only place its answer is about
  // the tree being pushed. Never strip it (BI-7B249AFE).
  if (options?.conformance === true) return false;
  return command === "node" && args[0] === "--test"
    || command === "pnpm" && args[0] === "run" && args[1]?.endsWith(":test");
}

export function resolvePolicyGuardInvocation(
  command,
  args,
  { platform = process.platform, env = process.env } = {},
) {
  return resolveHostCommandInvocation(command, args, { platform, env });
}

export const POLICY_GUARD_PROFILES = Object.freeze({
  source: Object.freeze([
    guard("repo-guard-loop", "Repo Guard Loop", [
      node("--test", "scripts/check-guards.test.mjs"),
      // BI-3B6DC1DC: the TaskRun working-write guard now scopes by model, so its
      // own behaviour is under test rather than trusted.
      node("--test", "scripts/check-no-bare-working-write.test.mjs"),
      node("--test", "scripts/host-resource-runner.test.mjs"),
      node("scripts/check-guards.mjs"),
      node("--test", "scripts/check-capability-compose-profiles.test.mjs"),
      node("scripts/check-capability-compose-profiles.mjs"),
      // BI-334CB7DE: doc-diagram fence extraction must stay line-ending
      // invariant. A CRLF working copy re-hashed every fence in a page and
      // demanded a re-render no diagram needed — invisible in `git diff`
      // because git normalises on commit, so only a test pins it.
      node("--test", "scripts/render-doc-diagrams.test.mjs"),
    ]),
    // BI-40230C6F: the gate must stop waiting on an executor that is gone, and must
    // NOT read an unreachable control plane as proof of death. Registered here rather
    // than added to ci-policy-test-inventory-allowlist.txt, where it would never run.
    guard("gate-executor-liveness", "Gate Executor Liveness", [
      node("--test", "scripts/gate-worktree-executor-liveness.test.mjs"),
      // BI-46B03CAE: the lease-queue calls cost more than mcpCall's 10s default,
      // and abandoning one that was about to succeed strands a lease the gate
      // then cannot release — each failure deepening a single-slot queue until
      // no gate on the box can claim. Registered here for the same reason as the
      // liveness test above: in ci-policy-test-inventory-allowlist.txt it would
      // never run.
      node("--test", "scripts/gate-worktree-lease-timeout.test.mjs"),
      // BI-24D5D7C2: the control-plane watchdog aborts a 13-minute build after
      // two consecutive probe failures, and an inner mcpCall deadline was
      // classified as "request-failed" — an operator reads that as a broken
      // endpoint and hunts a connection fault that never happened.
      node("--test", "scripts/local-ci-control-plane-probe.test.mjs"),
    ]),
    guard("host-port-range-guard", "Host Port Range Guard", [
      node("--test", "scripts/check-host-port-range.test.mjs"),
    ]),
    // BI-7B249AFE: the preflight strips `node --test` commands, which silently
    // removed the ONLY check for guards whose ".test.mjs" reads the repository
    // rather than the guard. #4558 fixed one instance by hand and the class
    // recurred on #4737. This guard closes it: it detects the shape and refuses
    // an unmarked one, so the next such test cannot rejoin the stripped set.
    guard("guard-conformance-marks", "Guard Conformance Marks", [
      node("--test", "scripts/check-guard-conformance-marks.test.mjs"),
      node("scripts/check-guard-conformance-marks.mjs"),
    ]),
    guard("shell-guard-shim-contract", "Shell Guard Shim Contract", [
      node("--test", "scripts/check-shell-guard-shim-contract.test.mjs"),
      // Drives the real POSIX guard under bash: a cached binary path goes stale on
      // every toolchain upgrade (Docker Desktop relocated its CLI mid-install here),
      // and the guard must re-resolve rather than bricking `docker` for the account.
      node("--test", "scripts/safety/shell-guard-stale-cache.test.mjs"),
    ]),
    guard("release-compose-pins", "Release Compose Pins", [
      conformanceTest("scripts/check-release-compose-pins.test.mjs"),
    ]),
    guard("release-asset-contract", "Release Asset Contract", [
      // The consumer install has no git checkout: whatever the installer copies
      // out of the install dir must ship in the image's /dpf-release-assets.
      conformanceTest("scripts/check-release-asset-contract.test.mjs"),
      node("--test", "scripts/installer/local-model-policy-contract.test.mjs"),
    ]),
    guard("db-commandment-coverage", "DB Commandment Coverage", [
      // The never-wipe-db commandment guarded two spellings and allowed three
      // equivalents, including `docker system prune -a --volumes` and every
      // `compose -f ... down -v` -- i.e. how the platform's own scripts invoke it.
      // Nothing tested the guard's own coverage; this does, for both the
      // commandment frontmatter and the offline fallback.
      node("--test", "scripts/check-db-commandment-coverage.test.mjs"),
    ]),
    guard("installer-help-contract", "Installer Help Contract", [
      // docs/install/windows.md documented `install-dpf.ps1 -Help`, which had no
      // -Help parameter -- a simple param() block ignored it and ran a full
      // unattended install. Asserts documented installer flags actually exist.
      conformanceTest("scripts/check-installer-help-contract.test.mjs"),
    ]),
    guard("installer-skip-visibility", "Installer Skip Visibility", [
      // A guarded install step that skips in silence reads as success, and is
      // then recorded as done by Save-Progress. Optional-script guards must say so.
      conformanceTest("scripts/check-installer-skip-visibility.test.mjs"),
    ]),
    guard("installer-state-contract", "Installer State Contract", [
      // Drives real bash: install-dpf.sh runs under `set -euo pipefail`, and the
      // failure mode here is shell exit-status semantics, not source text.
      node(
        "--test",
        "scripts/installer/lib/state-cleanup-temps.test.mjs",
        "scripts/installer/lib/state-lock-timeout.test.mjs",
        "scripts/installer/lib/doctor-redaction.test.mjs",
        "scripts/installer/install-release-assets.test.mjs",
      ),
    ]),
    guard("fresh-install-reliability", "Fresh Install Reliability", [
      conformanceTest("scripts/installer/powershell-compose-chain.test.mjs"),
      node(
        "--test",
        "scripts/installer-image-identity.test.mjs",
        "scripts/salvage-sweep.test.mjs",
      ),
    ]),
    guard("governed-teardown-guard", "Governed Teardown Contract", [
      node("--test", "scripts/check-governed-teardown-contract.test.mjs", "scripts/governed-teardown.test.mjs"),
      node("scripts/check-governed-teardown-contract.mjs"),
    ]),
    guard("published-image-freshness", "Published Image Freshness", [
      // Decision logic only — the live registry check needs Docker and runs on a
      // schedule (.github/workflows/published-image-freshness.yml).
      node(
        "--test",
        "scripts/lib/published-image-freshness.test.mjs",
        "scripts/publish-image-release-identity.test.mjs",
      ),
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
        "scripts/lib/documentation-evidence-lane.test.mjs",
        "scripts/ci-policy-guards.test.mjs",
        "scripts/lib/host-command-invocation.test.mjs",
        // BI-812C676D: every covered-root *.test.mjs must appear here or on the
        // deliberate allowlist — otherwise CI stays green while the test never runs.
        "scripts/lib/ci-policy-test-inventory.test.mjs",
        "scripts/lib/git-shallow-preflight.test.mjs",
        "scripts/lib/ensure-compile-ready.test.mjs",
        "scripts/pregate-preflight.test.mjs",
        "scripts/gate-context.test.mjs",
        "scripts/pre-push-dco-check.test.mjs",
      ),
      // Split out of the command above because these three read the real
      // repository — the compose files, the Dockerfile, the pregate scripts —
      // and assert on what they find. Stripping them host-side is exactly the
      // false green BI-7B249AFE describes.
      conformanceTest(
        "scripts/lib/dev-preview-migrate-converge.test.mjs",
        "scripts/pregate-exit-honesty.test.mjs",
        "scripts/lib/gate-context-runtime-contract.test.mjs",
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
      conformanceTest("scripts/check-override-comments.test.mjs"),
      node("scripts/check-build-script-policy.mjs"),
      conformanceTest("scripts/check-build-script-policy.test.mjs"),
      node("--test", "scripts/check-root-script-runtime.test.mjs"),
      // A `patchedDependencies` entry whose patch file never reaches the Docker
      // build context fails `pnpm install` with ENOENT and breaks every image
      // build (SUR-8AB3353C, regression from #4321).
      node("scripts/check-docker-patch-context.mjs"),
      node("--test", "scripts/check-docker-patch-context.test.mjs"),
      // Same failure family, different input: the Dockerfile copies scripts by
      // name, so extracting a helper out of one silently drops it from the image
      // and `pnpm install` dies on ERR_MODULE_NOT_FOUND in postinstall
      // (BI-9B490215). `next build` and PR CI cannot see it — no PR check builds
      // the image — so it reaches main green and breaks the release chain.
      node("scripts/check-dockerfile-copied-script-imports.mjs"),
      node("--test", "scripts/check-dockerfile-copied-script-imports.test.mjs"),
      // AGENTS.md §11 Principal convergence covered Users but not agents, so a
      // seeded install left 71 of 76 AGT-* agents with no identity. Every
      // `independent: true` readiness lane then attributed its receipt to the
      // delegating human — the artifact author — and could never pass
      // (BI-53C26E60). Nothing at source level can prove the DATA converged;
      // this guards that the seed still runs the convergence, after every
      // agent seeder.
      node("scripts/check-agent-principal-convergence-wired.mjs"),
      node("--test", "scripts/check-agent-principal-convergence-wired.test.mjs"),
    ]),
    guard("bundle-boundary-guard", "Bundle Boundary Guard", [
      node("--test", "scripts/check-bundle-boundaries.test.mjs"),
      node("scripts/check-bundle-boundaries.mjs"),
    ]),
    guard("application-boundary-guard", "Application Boundary Guard", [
      node("--test", "scripts/check-application-boundaries.test.mjs"),
      node("scripts/check-application-boundaries.mjs"),
    ]),
    guard("label-association-guard", "Label Association Guard", [
      // A <label> bound to nothing renders, screenshots and inspects correctly
      // while a screen reader announces an unlabelled field — every human check
      // passes. Ratchet: blocks NET-NEW orphans, retightens as surfaces migrate.
      node("scripts/check-label-association.mjs"),
    ]),
    guard("style-drift-guard", "Style Drift Guard", [
      node("scripts/check-style-drift.mjs"),
    ]),
    guard("reporting-composition-guard", "Reporting Composition Guard", [
      node("scripts/check-reporting-composition.mjs"),
    ]),
    guard("platform-composition-single-home", "Platform Composition Single-Home Guard", [
      node("--test", "scripts/check-platform-composition-single-home.test.mjs"),
      node("scripts/check-platform-composition-single-home.mjs"),
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
    // BI-640B011D: schema FK budgets (declared FKs without a leading index +
    // bare unbacked *Id columns) may only shrink against the owned baseline.
    guard("fk-index-coverage-guard", "FK Index Coverage Guard", [
      node("--test", "scripts/check-fk-index-coverage.test.mjs"),
      node("scripts/check-fk-index-coverage.mjs"),
    ]),
    // BI-D25ED55D: UX primitive-adoption budgets (inline accent-button/card
    // strings outside components/ui + text-white) may only shrink against the
    // owned baseline — the ratchet half of the W5 UX foundation pack.
    guard("ux-primitive-adoption-guard", "UX Primitive Adoption Guard", [
      node("--test", "scripts/check-ux-primitive-adoption.test.mjs"),
      node("scripts/check-ux-primitive-adoption.mjs"),
    ]),
    // BI-101C107C: the Build Studio operator UI surface (component count +
    // non-test LOC under apps/web/components/build) may only shrink against
    // the owned baseline. Five months of additive "simplification" produced 74
    // components and one deletion because every UX gate was a presence check;
    // this is the ratchet that makes a net-additive simplification fail.
    guard("build-studio-surface-guard", "Build Studio Surface Guard", [
      node("--test", "scripts/check-build-studio-surface-budget.test.mjs"),
      node("scripts/check-build-studio-surface-budget.mjs"),
    ]),
    // BI-3F17B16B: an EP-/BI- id cited in a CHANGED doc must exist in the live
    // backlog (diff-scoped; grandfather baseline; degrades to warn-pass when no
    // live install is reachable). Closes the unbacked-doc-anchor pattern (P3).
    guard("doc-anchor-existence", "Doc Anchor Existence", [
      node("--test", "scripts/check-doc-anchor-existence.test.mjs"),
      node("scripts/check-doc-anchor-existence.mjs"),
    ]),
    // BI-38A353B2: doc-anchor-existence proves a cited id EXISTS; nothing
    // proved it was still OPEN. A closed id cited from user-facing runtime
    // text names a fixed defect as a live blocker. Same diff scope, same
    // grandfather baseline, same warn-pass degradation.
    guard("live-blocker-references", "Live Blocker References", [
      node("--test", "scripts/check-live-blocker-references.test.mjs"),
      node("scripts/check-live-blocker-references.mjs"),
    ]),
    // BI-79BCE3F2: ONE status/supersession frontmatter convention across
    // docs/superpowers/{specs,plans} — new/changed files must carry
    // status: draft|active|binding|superseded; supersededBy only on superseded.
    guard("spec-status-frontmatter", "Spec Status Frontmatter", [
      node("--test", "scripts/check-spec-status-frontmatter.test.mjs"),
      node("scripts/check-spec-status-frontmatter.mjs"),
    ]),
    // BI-873F3C48: every growth-shaped (event/log/telemetry) model must be
    // retention-enrolled (purge or retained) or deliberately allowlisted.
    guard("retention-enrollment-guard", "Retention Enrollment Guard", [
      node("--test", "scripts/check-retention-enrollment.test.mjs"),
      node("scripts/check-retention-enrollment.mjs"),
    ]),
    // Diff-scoped by design: repo-wide, the pattern matches 255 fixtures across 125
    // files, nearly all legitimate (far-future sentinels, deliberately-expired rows).
    // Gating on that would need a 125-file baseline — the silent allowlist this is
    // meant to replace. It stops NEW bombs; the audit cleared the planted ones.
    guard("test-clock-bomb-guard", "Test Clock Bomb Guard", [
      node("--test", "scripts/check-test-clock-bombs.test.mjs"),
      node("scripts/check-test-clock-bombs.mjs"),
    ]),
    guard("work-unit-conformance-guard", "WorkUnit Conformance Guard", [
      node("--test", "scripts/check-work-unit-conformance.test.mjs"),
      node("scripts/check-work-unit-conformance.mjs"),
    ]),
    guard("instruction-plane-guard", "Instruction Plane Guard", [
      conformanceTest("scripts/check-instruction-plane-size.test.mjs"),
      node("scripts/check-instruction-plane-size.mjs"),
    ]),
    // The size ratchet's twin: bytes measure the cut, this measures what the cut LOST.
    // A byte gate scores deleting a commandment identically to relocating it, so Phase 1
    // needs both or "58% smaller" is unfalsifiable (BI-0020D511 §12f).
    guard("instruction-plane-rule-coverage", "Instruction Plane Rule Coverage", [
      conformanceTest("scripts/check-instruction-plane-rule-coverage.test.mjs"),
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
    // W17 (BI-810BEC9C): every route handler under apps/web/app/api declares its
    // exposure class at birth (@exposure pragma collected into route-manifest.json);
    // the A2A cohort may never be grandfathered; "public" claims must agree with
    // the proxy's path-segmentation allowlist.
    guard("endpoint-classification-guard", "Endpoint Classification Guard", [
      conformanceTest("scripts/check-endpoint-classification.test.mjs"),
      node("scripts/check-endpoint-classification.mjs"),
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
      conformanceTest("scripts/check-retired-substrate.test.mjs"),
      node("scripts/check-retired-substrate.mjs"),
    ]),
    guard("mcp-tool-pack-guard", "MCP Tool Pack Guard", [
      node("scripts/check-mcp-tool-pack.mjs"),
    ]),
    guard("package-boundary-guard", "Package Boundary Guard", [
      node("scripts/check-package-boundaries.mjs"),
    ]),
    // BI-96033E25 — a vitest test must resolve repo paths from __dirname, not
    // process.cwd(), or `vitest run --root <pkg>` reads outside the repo and
    // fails as a misleading missing file.
    guard("test-cwd-independence-guard", "Test Cwd Independence Guard", [
      node("--test", "scripts/check-test-cwd-independence.test.mjs"),
      node("scripts/check-test-cwd-independence.mjs"),
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
        // Worktree lifecycle hygiene (plan 2026-08-11): the reaping classifier
        // (now with the liveness + abandoned-merge verdicts), the session
        // heartbeat liveness signal, and the root-clone fast-forward remedy.
        "scripts/lib/worktree-janitor-core.test.mjs",
        "scripts/worktree-janitor.test.mjs",
        "scripts/lib/worktree-session-heartbeat.test.mjs",
        // BI-DBAD1A1B: SessionEnd process matching accepts only the canonical
        // worktree itself or descendants, never sibling worktrees/CI runners.
        "scripts/hooks/session-reaper.test.mjs",
        "scripts/lib/root-clone-refresh.test.mjs",
        "scripts/lib/compose-safety.test.mjs",
        "scripts/lib/local-integration-ci.test.mjs",
        "scripts/lib/local-convergence-lock.test.mjs",
        "scripts/lib/sandbox-freshness.test.mjs",
        "scripts/sandbox-freshness-preflight.test.mjs",
        "scripts/release/re-resolve-stt-digest.test.mjs",
        "scripts/lib/ensure-pre-push-hook.test.mjs",
        // BI-5CBDC146: hook directories must resolve through fileURLToPath.
        // URL.pathname yields "/D:/..." on Windows, so the shim never
        // converged and a clean push meant the gate never ran. Linux CI cannot
        // reproduce it — these guards are the only thing that catches it.
        "scripts/lib/hooks-dir.test.mjs",
        // BI-9B490215: the root postinstall must keep ZERO static local imports.
        // The Docker deps stage copies only set-hooks-path.mjs, so a static
        // ./lib import throws ERR_MODULE_NOT_FOUND and breaks the image build,
        // and with it the release / self-upgrade chain for every install.
        "scripts/set-hooks-path.no-static-imports.test.mjs",
        // BI-0B292D84 layer 1+4: a worktree is bound to a Workroom when it is
        // created, and the branches that predate that are reconciled. Binding
        // coverage was stuck at 65% for as long as the rule relied on memory.
        "scripts/lib/workroom-bind.test.mjs",
        "scripts/reconcile-workroom-bindings.test.mjs",
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
        // Symlink-robust entry guard shared by the pregate script family: a
        // guard that misses makes the gate exit 0 silently (false pass).
        "scripts/lib/entry-module.test.mjs",
      ),
      // BI-3727106F: the gate must converge at SESSION START and sweep sibling
      // worktrees. Convergence used to run only in postinstall, and only from
      // the tree's own copy — so a tree on a stale base could never repair
      // itself (68 of 85 worktrees were ungated when this was measured). It
      // reads the repository's own hook files, so it is a conformance assertion
      // and must not be stripped from the host-side preflight (BI-7B249AFE).
      conformanceTest("scripts/hooks/converge-git-hooks.test.mjs"),
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
    // Proves the locally-owned image-size fix is still applied. image-size is
    // archived upstream with no patched release, so patches/image-size@1.2.1.patch
    // is the only thing standing between metro's asset pipeline and CVE-2025-71330.
    // Lives in the WORKSPACE profile because it imports the installed package —
    // the Dependency Scan workflow only reads the lockfile and never installs.
    // Fails loudly when a metro bump moves image-size off the patched version.
    guard("owned-patch-regression", "Owned Patch Regression", [
      node("--test", "scripts/sbom/image-size-icns-loop.test.mjs"),
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
        // Doc cadence contract: same rule — the counts are advisory, but the
        // detection is tested, because an over-reporting checklist claims work
        // is done when it is not.
        "scripts/measure-doc-cadence-coverage.test.mjs",
        // Same rule for the capability measure: the report is advisory, but its
        // parsing and scoring are tested here because a mis-parsed registry
        // under-reports gaps, and an under-reported gap reads as an all-clear.
        "scripts/measure-capability-completeness.test.mjs",
        // Archetype obligation coverage: same rule again, plus a lockstep check
        // that this measure classifies a frequency exactly as the runtime sweep
        // does — a report that disagrees with the ledger it reports on is worse
        // than no report.
        "scripts/measure-obligation-cadence-coverage.test.mjs",
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
      node("--test", "packages/dpf-skill-pack/hooks/portal-image-guard.test.mjs"),
      node("--test", "packages/dpf-skill-pack/hooks/worktree-create.test.mjs"),
      // BI-B1065D41 / BI-1C1483C6: the sixth PreToolUse guard and the
      // SessionStart readiness banner. Both are hand-added here for the same
      // reason as every entry above — an unlisted test file never runs.
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/pregate-invocation-guard.test.mjs",
        "packages/dpf-skill-pack/hooks/worktree-readiness-banner.test.mjs",
        // Worktree lifecycle hygiene hooks (plan 2026-08-11): the session
        // heartbeat (liveness marker) and the SessionStart root-clone
        // fast-forward. Hand-enumerated like every entry here — unlisted = unrun.
        "packages/dpf-skill-pack/hooks/worktree-session-heartbeat.test.mjs",
        "packages/dpf-skill-pack/hooks/root-clone-freshness.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/plugin-hooks-wired.test.mjs",
      ),
      // BI-0B292D84: AGENTS.md 12 requires a Workroom claim before work on
      // every surface. It was prose - 30 of 79 live worktree branches carried
      // no WorkCapsule binding when measured 2026-08-26. Hand-enumerated like
      // every entry here: unlisted = never run.
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/workroom-claim-guard.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/uncommitted-work-guard.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/shared-clone-occupancy.test.mjs",
      ),
      node(
        "--test",
        "scripts/lib/dev-portal-lease-claim-key.test.mjs",
      ),
      node(
        "--test",
        "scripts/process-spine-conformance.test.mjs",
        "scripts/lib/ensure-post-checkout-hook.test.mjs",
      ),
      node(
        "--test",
        "packages/dpf-skill-pack/hooks/mcp-catalog-profile.test.mjs",
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
      git("fetch", "--no-tags", "--quiet", "origin", "main"),
      node("scripts/check-golden-decisions.mjs", "--merge-with", "origin/main"),
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
