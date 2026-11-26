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
// The same ratchet covers portal writes to the install checkout, which the
// recipe mounts read-only (owner decision DI-250233FBDD9B): in any file that
// names a host source root, every literal git write, upgrade-source call or
// file write is registered in SOURCE_WRITE_REGISTRY. "routed" uses the
// authorized source writer, or skips, when the actuator is mounted; "pending"
// still writes from the portal and holds the recipe label.
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
  "apps/web/lib/build/grok-device-login-core.ts": { class: "routed", count: 5, reason: "Lines run through execSandboxCommandLine (directly or via sandboxExec()): exec into the observed sandbox when the actuator is mounted, anything else refused; a test checks every line passes the host command check." },
  "apps/web/lib/build/grok-dispatch.ts": { class: "routed", count: 1, reason: "sandboxExec() runs it through execSandboxCommandLine: the private actuator execs into its observed canonical sandbox when mounted; any other Docker call is refused." },
  "apps/web/lib/build/ideate-dispatch.ts": { class: "routed", count: 1, reason: "sandboxExec() runs it through execSandboxCommandLine: the private actuator execs into its observed canonical sandbox when mounted; any other Docker call is refused." },
  "apps/web/lib/build/sandbox/agent-cli-runtime.ts": { class: "routed", count: 2, reason: "spawnSandboxExec/execSandboxCommandLine: the private actuator execs into its observed canonical sandbox when mounted; any other Docker call is refused." },
  "apps/web/lib/build/sandbox/grok-governance-seed.ts": { class: "routed", count: 5, reason: "Lines run through execSandboxCommandLine (directly or via sandboxExec()): exec into the observed sandbox when the actuator is mounted, anything else refused; a test checks every line passes the host command check." },
  "apps/web/lib/build/sandbox/sandbox-admin.ts": { class: "routed", count: 1, reason: "readActuatorSandbox when the actuator mount is present; only the observed sandbox is reported and docker inspect stays the mount-absent path." },
  "apps/web/lib/build/sandbox/sandbox-db.ts": { class: "routed", count: 6, reason: "Readiness and seed go to the actuator's sandbox-db operation for the build's in-use slot; every other Docker line is refused by execSandboxCommandLine when the mount is present." },
  "apps/web/lib/build/sandbox/sandbox-promotion.ts": { class: "routed", count: 4, reason: "executePromotion refuses before any effect when the actuator is mounted (DI-062828328841: deliver through the protected PR and canonical self-upgrade), and every Docker line is refused by execSandboxCommandLine there." },
  "apps/web/lib/build/sandbox/sandbox-recovery.ts": { class: "routed", count: 2, reason: "runSandboxRecoveryCommand: exec through the actuator, start and restart through its catalog sandbox restart, anything else refused when the mount is present." },
  "apps/web/lib/build/sandbox/sandbox.ts": { class: "routed", count: 20, reason: "Every Docker line goes through execSandboxCommandLine (exec into the observed sandbox, anything else refused when the actuator is mounted); portal copies stream a local tar into the sandbox; start uses the catalog sandbox restart." },
  "apps/web/lib/coworker/service-converge-report.ts": { class: "message", count: 1, reason: "A literal matched against recorded admin_run_command parameters; it runs nothing (the executing tool is admin-pack)." },
  "apps/web/lib/documents/conversion/availability.ts": { class: "routed", count: 1, reason: "readActuatorDoctoolsHealth when the actuator mount is present." },
  "apps/web/lib/documents/conversion/command.ts": { class: "routed", count: 1, reason: "Builds converter argv shared by the actuator and the mount-absent fallback; spawns nothing itself." },
  "apps/web/lib/platform-runtime/portal-actuator-entry.ts": { class: "actuator", count: 7, reason: "The private actuator launches the authorized source writer, the candidate promoter stage, the fixed converter image operations, the candidate reassessment probe and a build's sandbox database steps after their launchers admit the request, and pins the installed promoter image (DI-250233FBDD9B, DI-B3171A8F09DC)." },
  "apps/web/lib/documents/conversion/doctools-actuator.ts": { class: "actuator", count: 3, reason: "Runs only inside the private actuator (imported by portal-actuator-entry.ts)." },
  "apps/web/lib/documents/generation/render.ts": { class: "routed", count: 1, reason: "runActuatorDoctools when the actuator mount is present." },
  "apps/web/lib/edge-node/remote-provisioning.ts": { class: "message", count: 2, reason: "Script text executed on a remote edge host, never by the portal." },
  "apps/web/lib/govern/preview-automation-sign-in.ts": { class: "routed", count: 3, reason: "Refused before the lease read or any Docker call when the actuator mount is present (no preview secret enters the qualified portal); actuator-side issuance awaits an owner decision." },
  "apps/web/lib/infra/docker-disk-prune.ts": { class: "routed", count: 7, reason: "pruneActuatorDockerDisk when the actuator mount is present; the AtDaemon body runs in the actuator and refusals never fall back." },
  "apps/web/lib/mcp-task-reassessment-contract.ts": { class: "routed", count: 1, reason: "readActuatorReassessmentProof when the actuator mount is present; the default runner refuses there and the actuator passes its own." },
  "apps/web/lib/mcp/build-lifecycle-handlers.ts": { class: "message", count: 2, reason: "Operator remediation text only." },
  "apps/web/lib/mcp/packs/admin-pack.ts": { class: "routed", count: 2, reason: "readActuatorServiceLogs and runActuatorDiagnostic when the mount is present, and migrate or seed run pnpm in /app without Docker; docker compose stays the mount-absent path." },
  "apps/web/lib/mcp/packs/public-web-design-pack.ts": { class: "message", count: 1, reason: "Operator remediation text only." },
  "apps/web/lib/nonprod/local-ci-capacity-broker.ts": { class: "routed", count: 1, reason: "readActuatorCiCapacity when the actuator mount is present; *AtDaemon runs in the actuator." },
  "apps/web/lib/operate/backups/extension-preflight.ts": { class: "routed", count: 2, reason: "Queries pg_extension over the configured database when the actuator mount is present; the other line is remediation text." },
  "apps/web/lib/operate/service-restart.ts": { class: "routed", count: 3, reason: "restartActuatorService when the actuator mount is present; a refusal never falls back to shell Docker." },
  "apps/web/lib/platform-runtime/runtime-capability-executor.ts": { class: "routed", count: 1, reason: "The release service image manifest goes to the actuator's fixed release image operation and the protocol probe runs inside the actuator when it is mounted; this runner serves installs without it." },
  "apps/web/lib/queue/functions/substrate-reconciler.ts": { class: "routed", count: 4, reason: "reconcileActuatorSubstrate when the actuator mount is present; the daemon path is the actuator's own owner." },
  "apps/web/lib/routing/capability-probes/probe-engine-readiness.ts": { class: "routed", count: 1, reason: "spawnSandboxExec/execSandboxCommandLine: the private actuator execs into its observed canonical sandbox when mounted; any other Docker call is refused." },
  "apps/web/lib/routing/cli-adapter.ts": { class: "routed", count: 2, reason: "spawnSandboxExec/execSandboxCommandLine: the private actuator execs into its observed canonical sandbox when mounted; any other Docker call is refused." },
  "apps/web/lib/routing/codex-cli-adapter.ts": { class: "routed", count: 3, reason: "spawnSandboxExec/execSandboxCommandLine: the private actuator execs into its observed canonical sandbox when mounted; any other Docker call is refused." },
  "apps/web/lib/self-upgrade/build-failure-classifier.ts": { class: "message", count: 1, reason: "Operator remediation text only." },
  "apps/web/lib/self-upgrade/doctools-release-image.ts": { class: "routed", count: 2, reason: "Converter image resolve, presence and pull go to the actuator's fixed operations for the install's own dpf-doctools repository when it is mounted; local builds are refused there." },
  "apps/web/lib/self-upgrade/doctools-source-lineage.ts": { class: "message", count: 1, reason: "Error text only; the build runs through the promoter." },
  "apps/web/lib/self-upgrade/preflight.ts": { class: "routed", count: 1, reason: "The candidate reassessment proof runs in the actuator, admitted for the running run, when it is mounted; this runner serves installs without it." },
  "apps/web/lib/self-upgrade/promoter-launch.ts": { class: "routed", count: 2, reason: "Admitted launches run inside the private actuator; with it mounted the portal refuses any launch it cannot route (routedOrLocalPromoter), so these calls serve only installs without it." },
  "apps/web/lib/self-upgrade/promoter-sweep.ts": { class: "routed", count: 4, reason: "reconcileActuatorPromoters when the mount is present (fail closed); *AtDaemon runs in the actuator; the original legacy sweep runs only when detection shows no actuator mount." },
  "apps/web/lib/self-upgrade/promoter.ts": { class: "routed", count: 5, reason: "runPromoter, runPromoterReadiness and isPromoterAvailable go through the actuator when the mount is present, the AtDaemon halves and artifact resolution run inside it, and ensurePromoterImage reports presence without building there (DI-B3171A8F09DC)." },
  "apps/web/lib/self-upgrade/runtime-image-identity.ts": { class: "routed", count: 1, reason: "readActuatorPortalImage when the actuator mount is present." },
  "apps/web/lib/shared/run-process-with-budget.ts": { class: "routed", count: 1, reason: "Best-effort cleanup half of a budgeted Docker call; with the actuator mounted every portal-side budgeted Docker caller is routed or refused before it starts, so only the actuator reaches it." },
  "apps/web/lib/teardown/dispatcher.ts": { class: "routed", count: 2, reason: "Its only caller, executeInstallationTeardown, refuses before any drain, backup or launch when the actuator mount is present; a governed actuator teardown owner awaits an owner decision." },
  "apps/web/lib/work-capsules/scope-epoch-enrollment.server.ts": { class: "routed", count: 1, reason: "prepareHardenedEnrollment reads the actuator observation when the mount is present." },
  "apps/web/lib/workroom-runtime/sandbox-exec-actuator.ts": { class: "actuator", count: 1, reason: "The private actuator execs a bounded command into the sandbox it observed (bound to the signed retirement), with a fixed client environment and caller values only in a private env file." },
  "apps/web/lib/workroom-runtime/sandbox-exec.ts": { class: "routed", count: 1, reason: "The mount-absent fallback of spawnSandboxExec; with the actuator mounted every exec goes to the observed sandbox and nothing spawns locally." },
  "apps/web/lib/workroom-runtime/sandbox-launcher.ts": { class: "routed", count: 1, reason: "openActuatorRuntimeSession when the actuator mount is present." },
  "apps/web/lib/workroom-runtime/sandbox-session-actuator.ts": { class: "actuator", count: 1, reason: "The private actuator opens a Workroom session in the sandbox it observed after the room token is resolved and still active; environment names are fixed server-side." },
  "packages/db/src/discovery-collectors/docker.ts": { class: "routed", count: 4, reason: "Spawns only when a Docker socket path exists; the qualified portal mounts none, so the collector reports docker_unavailable there. Actuator-backed discovery awaits an owner decision." },
});

export const SOURCE_WRITE_REGISTRY = {
  "apps/web/lib/auth/mcp-host-writer.ts": { class: "routed", count: 2, reason: "Returns before writing when the private actuator is mounted; the installer owns host client configuration." },
  "apps/web/lib/queue/functions/self-upgrade.ts": { class: "routed", count: 2, reason: "Upstream refresh and source preparation go through the authorized source writer when the actuator is mounted." },
  "apps/web/lib/self-upgrade/release-batch-status.ts": { class: "routed", count: 1, reason: "The fresh tally refreshes upstream through the authorized source writer when the actuator is mounted." },
  "apps/web/lib/self-upgrade/release-batch.ts": { class: "routed", count: 3, reason: "Argv builders, and the shallow deepen is skipped when the actuator is mounted (the tally fails open)." },
  "apps/web/lib/self-upgrade/version.ts": { class: "routed", count: 4, reason: "Argv builders, and the target freshen goes through the authorized source writer when the actuator is mounted." },
  "apps/web/lib/skills/seed-writeback.ts": { class: "routed", count: 1, reason: "Approved bodies go through the authorized source writer, keyed on the applied revision, when the actuator is mounted." },
  "apps/web/lib/work-capsules/git-scanner.ts": { class: "routed", count: 1, reason: "The /host-dpf trunk refresh goes through the authorized source writer; other clones are writable volumes." },
};

const HOST_SOURCE = /DPF_REPO_ROOT|DPF_HOST_SOURCE_ROOT|["'`]\/host-(?:dpf|worktrees)\b|hostSourcePath|hostSourceMountPath/;
const SOURCE_WRITE_PATTERNS = [
  /["'](?:fetch|checkout|merge|reset|commit|clean|stash|am|apply|cherry-pick|rebase|update-ref|switch|restore|gc|prune)["']\s*,/,
  /\b(?:prepareUpgradeSource|build(?:Fetch|Deepen)Command)\s*\(/,
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|copyFileSync|copyFile|cpSync|symlinkSync)\s*\(/,
];

// The Docker executable, by name or by absolute path (/usr/bin/docker): an
// absolute path is the same raw call and must not escape the ratchet.
const DOCKER_EXE = String.raw`(?:\/[\w.-]+)*\/?docker`;
const PATTERNS = [
  /\bsocketPath\s*:/,
  /\b(?:bounded)?[dD]ockerSocket(?:Get|Stop)\s*\(/,
  new RegExp(String.raw`\bcommand:\s*["']${DOCKER_EXE}["']`),
  /[`"'](?:\/[\w.-]+)*\/?docker\s+(?:exec|run|compose|inspect|ps|rm|rmi|image|images|start|stop|restart|logs|info|cp|create|buildx|builder|network|volume|pull|push|build|kill|container|system|tag|save|load|commit|wait|update|top|stats|port|attach|events|version|context|manifest|login|history|pause|unpause)\b/,
];

// Process launchers: child_process and execa, plus the local wrappers that take
// an executable first (runProcessWithBudget, injected run/runCommand seams).
const LAUNCHERS = ["spawn", "spawnSync", "execFile", "execFileSync", "execFileAsync", "exec", "execSync", "execa",
  "runProcessWithBudget", "run", "runCommand"];
// A launcher called with the literal executable as its first argument, matched
// over the whole source so line breaks, a missing comma or any argv expression
// cannot hide it, while a plain array such as ["docker", "podman"] never matches.
// A parenthesised callee, `(deps.spawn ?? spawn)("docker", …)`, is a launch too.
const DOCKER_CALL = new RegExp(String.raw`(?:(?<![\w$])(?:[\w$]+\.)*(?:${LAUNCHERS.join("|")})|\))\s*\(\s*["'\`]${DOCKER_EXE}["'\`]`, "gs");

const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

/** True when a `/` after this code token starts a regular expression literal. */
function regexAllowed(lastChar, lastWord) {
  if (lastChar === "") return true;
  if (/[\w$]/.test(lastChar)) return REGEX_AFTER_WORD.has(lastWord);
  return !/[)\]}"'`]/.test(lastChar);
}

/** Blanks comments (keeping line breaks) while leaving strings, template
 * literals and regular expression literals intact, so a `//` inside
 * "https://…" or a `/*` inside a shell glob never erases the code after it. */
function stripComments(source) {
  const blank = (text) => text.replace(/[^\n]/g, " ");
  const out = [];
  let lastChar = "";
  let lastWord = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    let end = -1;
    if (c === "/" && (next === "/" || next === "*")) {
      end = next === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
      end = end < 0 ? source.length : next === "/" ? end : end + 2;
      out.push(blank(source.slice(i, end)));
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      end = i + 1;
      while (end < source.length && source[end] !== c && (c === "`" || source[end] !== "\n")) end += source[end] === "\\" ? 2 : 1;
      end = Math.min(end + 1, source.length);
    } else if (c === "/" && regexAllowed(lastChar, lastWord)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n" && (inClass || source[j] !== "/")) {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        j += 1;
      }
      if (source[j] === "/") {
        end = j + 1;
        while (end < source.length && /[a-z]/i.test(source[end])) end += 1;
      }
    }
    if (end > i) {
      out.push(source.slice(i, end));
      lastChar = source[end - 1];
      lastWord = "";
      i = end;
      continue;
    }
    out.push(c);
    if (/[\w$]/.test(c)) {
      lastWord = /[\w$]/.test(lastChar) ? lastWord + c : c;
      lastChar = c;
    } else if (!/\s/.test(c)) {
      lastChar = c;
      lastWord = "";
    }
    i += 1;
  }
  return out.join("");
}

/** 1-based line numbers holding a literal raw Docker call shape. */
export function findRawDockerLines(source) {
  const code = stripComments(source);
  const lines = new Set(code.split("\n")
    .flatMap((line, index) => (PATTERNS.some((pattern) => pattern.test(line)) ? [index + 1] : [])));
  for (const match of code.matchAll(DOCKER_CALL)) lines.add(code.slice(0, match.index).split("\n").length);
  return [...lines].sort((a, b) => a - b);
}

/** 1-based lines writing to a host source checkout, in files that name one. */
export function findSourceWriteLines(source) {
  const code = stripComments(source);
  if (!HOST_SOURCE.test(code)) return [];
  return code.split("\n")
    .flatMap((line, index) => (SOURCE_WRITE_PATTERNS.some((pattern) => pattern.test(line)) ? [index + 1] : []));
}

export function recipeEnabled(dockerfile) {
  return RECIPE_LABEL.test(dockerfile);
}

function checkRegistry({ observed, registry, recipeOn, kind, refuse }) {
  const failures = [];
  for (const [path, lines] of Object.entries(observed)) {
    const entry = registry[path];
    const noun = lines.length === 1 ? "line" : "lines";
    if (!entry) {
      failures.push(`${path}: ${kind} at line(s) ${lines.join(", ")} is not registered. ${refuse}, or register it with a class and reason.`);
    } else if (lines.length > entry.count) {
      failures.push(`${path}: ${lines.length} ${kind} ${noun} (${lines.join(", ")}), registered ${entry.count}. New ones are refused; ${refuse.toLowerCase()}.`);
    } else if (lines.length < entry.count) {
      failures.push(`${path}: ${lines.length} ${kind} ${noun}, registered ${entry.count}; lower the registered count to lock in the migration.`);
    }
  }
  for (const path of Object.keys(registry)) {
    if (!observed[path]) failures.push(`${path}: no ${kind} remains; remove it from the registry.`);
  }
  const pending = Object.entries(registry).filter(([path, entry]) => entry.class === "pending" && observed[path]);
  if (recipeOn && pending.length > 0) {
    failures.push(`Dockerfile enables portal-immutable-v1 with ${pending.length} pending ${kind} file(s): ${pending.map(([path]) => path).join(", ")}.`);
  }
  return failures;
}

export function checkDockerAuthority({ observed, registry, recipeOn }) {
  return checkRegistry({ observed, registry, recipeOn, kind: "raw Docker call",
    refuse: "Route it through a typed actuator operation" });
}

export function checkSourceWriteAuthority({ observed, registry, recipeOn }) {
  return checkRegistry({ observed, registry, recipeOn, kind: "install checkout write",
    refuse: "Route it through the authorized source writer" });
}

export function runInRepo(root = REPO_ROOT) {
  const files = gitText(["ls-files", ...SCOPES], { cwd: root })
    .split("\n")
    .filter((file) => /\.(?:ts|tsx|mjs|js)$/.test(file) && !/\.d\.ts$|\.test\.|test-support|__tests__/.test(file));
  const observed = {};
  const writes = {};
  for (const file of files) {
    let source;
    try { source = readFileSync(join(root, file), "utf8"); } catch { continue; }
    const lines = findRawDockerLines(source);
    if (lines.length > 0) observed[file] = lines;
    const writeLines = findSourceWriteLines(source);
    if (writeLines.length > 0) writes[file] = writeLines;
  }
  const recipeOn = recipeEnabled(readFileSync(join(root, "Dockerfile"), "utf8"));
  return [
    ...checkDockerAuthority({ observed, registry: DOCKER_AUTHORITY_REGISTRY, recipeOn }),
    ...checkSourceWriteAuthority({ observed: writes, registry: SOURCE_WRITE_REGISTRY, recipeOn }),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const failures = runInRepo();
  const pending = Object.values(DOCKER_AUTHORITY_REGISTRY).filter((entry) => entry.class === "pending").length;
  if (failures.length > 0) {
    for (const failure of failures) console.error(`docker-authority: ${failure}`);
    process.exit(1);
  }
  const pendingWrites = Object.values(SOURCE_WRITE_REGISTRY).filter((entry) => entry.class === "pending").length;
  console.log(`Docker authority OK — ${pending} pending writer-reachable caller file(s) and ${pendingWrites} pending install checkout writer(s) before portal-immutable-v1.`);
}
