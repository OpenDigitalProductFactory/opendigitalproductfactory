#!/usr/bin/env node
// Docker authority cutover ratchet (BI-224F56F1).
//
// The immutable portal recipe (Dockerfile LABEL
// com.opendpf.scope-writer.recipe="portal-immutable-v1") runs the portal with
// no Docker socket; every Docker effect goes through typed operations on the
// private actuator. This guard keeps that cutover honest from source:
//
//   - every literal raw Docker call site (socketPath, the bounded socket
//     client, a "docker" argv, or a "docker <subcommand>" shell string) under
//     apps/web/lib, apps/web/app and packages/db/src must be registered here
//     with a class and an exact line count;
//   - a registered count may not grow, and a smaller count must be recorded,
//     so each migration ratchets the registry down;
//   - the recipe label is refused while any caller is still "pending".
//
// Classes: "actuator" runs only inside the private actuator; "routed" uses the
// actuator when its mount is present and keeps the raw path only for the
// legacy recipe; "message" is operator or remote-host text, not a portal call;
// "pending" is a writer-reachable call still to migrate.
//
// This is a literal-shape ratchet, not proof of absence: calls built through
// variables escape it. The qualified runtime's proof is the served writer
// probe, which refuses any portal mount outside the fixed profile.
//
//   node scripts/check-docker-authority-cutover.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gitText } from "./lib/git.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPES = ["apps/web/lib", "apps/web/app", "packages/db/src"];
const RECIPE_LABEL = /^\s*LABEL\b[^\n]*com\.opendpf\.scope-writer\.recipe\s*=\s*"?portal-immutable-v1"?/m;

export const DOCKER_AUTHORITY_REGISTRY = Object.freeze({
  "apps/web/lib/build/grok-device-login-core.ts": { class: "pending", count: 5, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/grok-dispatch.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/ideate-dispatch.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/sandbox/agent-cli-runtime.ts": { class: "pending", count: 4, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/sandbox/grok-governance-seed.ts": { class: "pending", count: 5, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/sandbox/sandbox-admin.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/sandbox/sandbox-db.ts": { class: "pending", count: 6, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/sandbox/sandbox-promotion.ts": { class: "pending", count: 4, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/sandbox/sandbox-recovery.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/build/sandbox/sandbox.ts": { class: "pending", count: 20, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/coworker/service-converge-report.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/documents/conversion/availability.ts": { class: "routed", count: 1, reason: "readActuatorDoctoolsHealth when the actuator mount is present." },
  "apps/web/lib/documents/conversion/command.ts": { class: "routed", count: 1, reason: "Builds converter argv shared by the actuator and the mount-absent fallback; spawns nothing itself." },
  "apps/web/lib/documents/conversion/doctools-actuator.ts": { class: "actuator", count: 3, reason: "Runs only inside the private actuator (imported by portal-actuator-entry.ts)." },
  "apps/web/lib/documents/generation/render.ts": { class: "routed", count: 1, reason: "runActuatorDoctools when the actuator mount is present." },
  "apps/web/lib/edge-node/remote-provisioning.ts": { class: "message", count: 2, reason: "Script text executed on a remote edge host, never by the portal." },
  "apps/web/lib/govern/preview-automation-sign-in.ts": { class: "pending", count: 3, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/mcp-task-reassessment-contract.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/mcp/build-lifecycle-handlers.ts": { class: "message", count: 2, reason: "Operator remediation text only." },
  "apps/web/lib/mcp/packs/admin-pack.ts": { class: "pending", count: 2, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/mcp/packs/public-web-design-pack.ts": { class: "message", count: 1, reason: "Operator remediation text only." },
  "apps/web/lib/mcp/packs/sandbox-pack.ts": { class: "pending", count: 4, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/nonprod/local-ci-capacity-broker.ts": { class: "routed", count: 1, reason: "readActuatorCiCapacity when the actuator mount is present; *AtDaemon runs in the actuator." },
  "apps/web/lib/operate/backups/extension-preflight.ts": { class: "pending", count: 2, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/operate/service-restart.ts": { class: "pending", count: 3, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/platform-runtime/runtime-capability-executor.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/queue/functions/infra-prune.ts": { class: "pending", count: 4, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/queue/functions/substrate-reconciler.ts": { class: "routed", count: 4, reason: "reconcileActuatorSubstrate when the actuator mount is present; the daemon path is the actuator's own owner." },
  "apps/web/lib/routing/capability-probes/probe-engine-readiness.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/routing/cli-adapter.ts": { class: "pending", count: 3, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/routing/codex-cli-adapter.ts": { class: "pending", count: 3, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/routing/codex-cli-capacity.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/routing/codex-cli-model-catalog.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/self-upgrade/build-failure-classifier.ts": { class: "message", count: 1, reason: "Operator remediation text only." },
  "apps/web/lib/self-upgrade/doctools-release-image.ts": { class: "pending", count: 2, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/self-upgrade/doctools-source-lineage.ts": { class: "message", count: 1, reason: "Error text only; the build runs through the promoter." },
  "apps/web/lib/self-upgrade/preflight.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/self-upgrade/promoter-launch.ts": { class: "pending", count: 2, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/self-upgrade/promoter-sweep.ts": { class: "routed", count: 2, reason: "reconcileActuatorPromoters when the mount is present; *AtDaemon runs in the actuator." },
  "apps/web/lib/self-upgrade/promoter.ts": { class: "pending", count: 5, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/self-upgrade/runtime-image-identity.ts": { class: "routed", count: 1, reason: "readActuatorPortalImage when the actuator mount is present." },
  "apps/web/lib/shared/run-process-with-budget.ts": { class: "pending", count: 1, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/teardown/dispatcher.ts": { class: "pending", count: 2, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
  "apps/web/lib/work-capsules/scope-epoch-enrollment.server.ts": { class: "routed", count: 1, reason: "prepareHardenedEnrollment reads the actuator observation when the mount is present." },
  "apps/web/lib/workroom-runtime/sandbox-launcher.ts": { class: "routed", count: 1, reason: "openActuatorRuntimeSession when the actuator mount is present." },
  "packages/db/src/discovery-collectors/docker.ts": { class: "pending", count: 4, reason: "Writer-reachable raw Docker call; migrate to a typed actuator operation before the immutable recipe." },
});

const PATTERNS = [
  /\bsocketPath\s*:/,
  /\b(?:bounded)?[dD]ockerSocket(?:Get|Stop)\s*\(/,
  /["']docker["']\s*,\s*(?:\[|\.{3}|[A-Za-z_$][\w$]*\s*[,)])/,
  /^\s*["']docker["'],\s*$/,
  /\bcommand:\s*["']docker["']/,
  /[`"']docker\s+(?:exec|run|compose|inspect|ps|rm|image|start|stop|restart|logs|info|cp|create|buildx|network|volume|pull|build|kill|container|system)\b/,
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** 1-based line numbers holding a literal raw Docker call shape. */
export function findRawDockerLines(source) {
  return stripComments(source).split("\n")
    .flatMap((line, index) => (PATTERNS.some((pattern) => pattern.test(line)) ? [index + 1] : []));
}

export function recipeEnabled(dockerfile) {
  return RECIPE_LABEL.test(dockerfile);
}

export function checkDockerAuthority({ observed, registry, recipeOn }) {
  const failures = [];
  for (const [path, lines] of Object.entries(observed)) {
    const entry = registry[path];
    const noun = lines.length === 1 ? "line" : "lines";
    if (!entry) {
      failures.push(`${path}: raw Docker call at line(s) ${lines.join(", ")} is not registered. Route it through a typed actuator operation, or register it with a class and reason.`);
    } else if (lines.length > entry.count) {
      failures.push(`${path}: ${lines.length} raw Docker ${noun} (${lines.join(", ")}), registered ${entry.count}. New raw calls are refused; use the private actuator.`);
    } else if (lines.length < entry.count) {
      failures.push(`${path}: ${lines.length} raw Docker ${noun}, registered ${entry.count}; lower the registered count to lock in the migration.`);
    }
  }
  for (const path of Object.keys(registry)) {
    if (!observed[path]) failures.push(`${path}: no longer calls Docker; remove it from the registry.`);
  }
  const pending = Object.entries(registry).filter(([path, entry]) => entry.class === "pending" && observed[path]);
  if (recipeOn && pending.length > 0) {
    failures.push(`Dockerfile enables portal-immutable-v1 with ${pending.length} pending raw Docker caller(s): ${pending.map(([path]) => path).join(", ")}.`);
  }
  return failures;
}

export function runInRepo(root = REPO_ROOT) {
  const files = gitText(["ls-files", ...SCOPES], { cwd: root })
    .split("\n")
    .filter((file) => /\.(?:ts|tsx|mjs|js)$/.test(file) && !/\.d\.ts$|\.test\.|test-support|__tests__/.test(file));
  const observed = {};
  for (const file of files) {
    let source;
    try { source = readFileSync(join(root, file), "utf8"); } catch { continue; }
    const lines = findRawDockerLines(source);
    if (lines.length > 0) observed[file] = lines;
  }
  const recipeOn = recipeEnabled(readFileSync(join(root, "Dockerfile"), "utf8"));
  return checkDockerAuthority({ observed, registry: DOCKER_AUTHORITY_REGISTRY, recipeOn });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const failures = runInRepo();
  const pending = Object.values(DOCKER_AUTHORITY_REGISTRY).filter((entry) => entry.class === "pending").length;
  if (failures.length > 0) {
    for (const failure of failures) console.error(`docker-authority: ${failure}`);
    process.exit(1);
  }
  console.log(`Docker authority OK — ${pending} pending writer-reachable caller file(s) before portal-immutable-v1.`);
}
