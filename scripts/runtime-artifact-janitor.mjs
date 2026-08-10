#!/usr/bin/env node
// BI-DBF3F426 — Runtime-artifact janitor CLI.
//
// Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
//   §4.1 (worktree lifecycle + reaping) and §4.3 (sandbox & container discipline).
//
// COMPLEMENT to the worktree janitor (scripts/worktree-janitor.sh, PR #1443) and the
// RuntimeTarget heartbeat sweep (apps/web/lib/queue/functions/runtime-target-janitor.ts,
// PR #1443). Those reap stale *worktrees*, *branches*, and *RuntimeTarget*/lease records.
// This reaps the Docker side-effects that pile up alongside them:
//
//   (a) per-branch local-CI build images  — `dpf-local-integration-<slug>-build`
//       (~4GB each; 5 orphaned / ~20GB observed 2026-06-05). Runtime gates are supposed
//       to go through the shared `local-integration-ci` lease (spec §4.3), so these
//       images should not exist at all once they age out.
//   (b) stray compose projects — `dpf-<topic>` projects whose worktree is gone, plus any
//       foreign (non-`dpf`) compose project, idle past the staleness threshold.
//   (c) managed local-CI BuildKit builders — `dpf-local-ci-buildkit-vN-S` (BI-C85D1B0A):
//       STOP idle current-policy builders (cache kept); REAP obsolete policy versions.
//
// USAGE
//   node scripts/runtime-artifact-janitor.mjs [--apply] [--staleness-days N] [--json]
//
// FLAGS
//   --dry-run            (default) Report candidates only; do nothing destructive.
//   --apply              Actually remove REAP candidates (docker rmi / docker compose down).
//   --staleness-days N   Idle threshold in days before an artifact is a candidate
//                        (default: 7 — a full week, so operator travel never trips a reap).
//   --json               Emit a machine-readable JSON report instead of the text table.
//   -h, --help           Show this help.
//
// SAFETY
//   * DRY-RUN by default. --apply is the only thing that mutates Docker state.
//   * The root `dpf` compose project is NEVER touched.
//   * A `dpf-<topic>` project whose worktree is still present is NEVER touched.
//   * Only artifacts idle past the (generous) staleness threshold are candidates.
//   * Every candidate is reported — no silent truncation.
//
// EXAMPLES
//   node scripts/runtime-artifact-janitor.mjs                       # dry-run (safe)
//   node scripts/runtime-artifact-janitor.mjs --apply               # reap
//   node scripts/runtime-artifact-janitor.mjs --staleness-days 14   # conservative
//   node scripts/runtime-artifact-janitor.mjs --json                # CI/automation

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_STALENESS_DAYS, decideVolumeReclaim, planReap } from "./lib/runtime-artifact-janitor.mjs";
import { deriveWorktreeComposeProjectName } from "./lib/compose-safety.mjs";
import {
  DEFAULT_IDLE_GRACE_MS,
  buildxRmArgs,
  buildxStopArgs,
  isBuilderCoolDownEnabled,
  parseManagedBuilderContainer,
  planManagedBuilderLifecycle,
} from "./lib/local-ci-builder-lifecycle.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ── Arg parse ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { apply: false, stalenessDays: DEFAULT_STALENESS_DAYS, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.apply = false;
    else if (arg === "--apply" || arg === "--live") opts.apply = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--staleness-days") {
      opts.stalenessDays = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--staleness-days=")) {
      opts.stalenessDays = Number(arg.slice("--staleness-days=".length));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(opts.stalenessDays) || opts.stalenessDays <= 0) {
    throw new Error("--staleness-days must be a positive number");
  }
  return opts;
}

function printHelp() {
  // Print the leading comment block (the doc) so --help mirrors worktree-janitor.sh.
  console.log(
    [
      "Runtime-artifact janitor (BI-DBF3F426) — reaps orphaned per-branch CI build",
      "images (dpf-local-integration-*-build) and stray compose projects.",
      "",
      "USAGE",
      "  node scripts/runtime-artifact-janitor.mjs [--apply] [--staleness-days N] [--json]",
      "",
      "FLAGS",
      "  --dry-run            (default) Report candidates only; nothing destructive.",
      "  --apply / --live     Actually remove REAP candidates.",
      `  --staleness-days N   Idle threshold (default: ${DEFAULT_STALENESS_DAYS}).`,
      "  --json               Machine-readable JSON report.",
      "  -h, --help           This help.",
      "",
      "SAFETY: dry-run by default; never touches the root dpf project or a compose",
      "project backed by a live worktree; only artifacts idle past the threshold.",
    ].join("\n"),
  );
}

// ── Docker / git discovery (side-effecting; isolated from the pure library) ───
function runCapture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.error) {
    throw new Error(`${cmd} not available: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}: ${(res.stderr || "").trim()}`);
  }
  return res.stdout ?? "";
}

/** Discover `dpf-local-integration-*-build` images with their creation time. */
function discoverBuildImages() {
  // `docker image ls` prints repository + the unix-epoch creation timestamp.
  const out = runCapture("docker", [
    "image",
    "ls",
    "--format",
    "{{.Repository}}\t{{.CreatedAt}}",
  ]);
  const images = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [repository, createdAt] = trimmed.split("\t");
    if (!repository) continue;
    const createdMs = Date.parse(createdAt);
    images.push({ repository, createdMs: Number.isFinite(createdMs) ? createdMs : 0 });
  }
  return images;
}

/**
 * Discover compose projects and the newest activity timestamp of each.
 *
 * Two sources are unioned, because a stray project can outlive its containers:
 *   1. `docker ps -a` container labels — sees running AND stopped projects.
 *   2. `docker volume ls` volume labels + each volume's CreatedAt — sees projects
 *      whose containers are already gone (e.g. `docker container prune` ran) but
 *      whose named volumes still hold disk. Container-only discovery is blind to
 *      these, which is exactly how the observed volume bloat became invisible:
 *      dead dev stacks with no container but a lingering pgdata + node_modules.
 *
 * The staleness signal is the NEWEST timestamp seen across a project's containers
 * and volumes (so a project stays "fresh" while any part of it is recent).
 */
function discoverComposeProjects() {
  const newestByProject = new Map();
  const runningProjects = new Set();
  // NB: never `line.trim()` before splitting — when the project label is empty the
  // line begins with a tab, and trimming would shift the NEXT field into the project
  // slot (a container with no compose label would masquerade as a project named after
  // its CreatedAt). Split the raw line; trim individual fields.
  const bump = (projectName, ms) => {
    const key = (projectName ?? "").trim();
    if (!key) return;
    const value = Number.isFinite(ms) ? ms : 0;
    const prev = newestByProject.get(key);
    if (prev === undefined || value > prev) newestByProject.set(key, value);
  };

  const containers = runCapture("docker", [
    "ps",
    "-a",
    "--format",
    "{{.Label \"com.docker.compose.project\"}}\t{{.CreatedAt}}\t{{.State}}",
  ]);
  for (const line of containers.split("\n")) {
    if (!line) continue;
    const [projectName, createdAt, state] = line.split("\t");
    bump(projectName, Date.parse((createdAt || "").trim()));
    if ((state || "").trim() === "running") {
      const key = (projectName || "").trim();
      if (key) runningProjects.add(key);
    }
  }

  // Volume-labelled projects (may include ones with no surviving container).
  const volumes = runCapture("docker", [
    "volume",
    "ls",
    "--format",
    "{{.Name}}\t{{.Label \"com.docker.compose.project\"}}",
  ]);
  for (const line of volumes.split("\n")) {
    if (!line) continue;
    const [name, projectName] = line.split("\t");
    if (!(projectName || "").trim()) continue; // anonymous / non-compose volumes are out of scope
    // Fetch this volume's creation time so a volume-only project has a staleness signal.
    const inspect = spawnSync("docker", ["volume", "inspect", name, "--format", "{{.CreatedAt}}"], {
      encoding: "utf8",
    });
    bump(projectName, inspect.status === 0 ? Date.parse((inspect.stdout || "").trim()) : 0);
  }

  return [...newestByProject.entries()].map(([projectName, newestContainerCreatedMs]) => ({
    projectName,
    newestContainerCreatedMs,
    hasRunningContainer: runningProjects.has(projectName),
  }));
}

/** Derive the compose project name each live git worktree maps to. */
function discoverLiveWorktreeProjectNames() {
  const out = runCapture("git", ["worktree", "list", "--porcelain"]);
  const names = new Set();
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      const wtPath = line.slice("worktree ".length).trim();
      if (wtPath) names.add(deriveWorktreeComposeProjectName(wtPath));
    }
  }
  return names;
}

/**
 * Current builderPolicy.version from the checked-in slot resource manifest.
 * Fail-soft to 2 (the generation that introduced bounded builders) if unreadable.
 */
function readCurrentBuilderPolicyVersion() {
  try {
    const manifestPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "apps",
      "web",
      "lib",
      "nonprod",
      "local-ci-slot-resources.json",
    );
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const version = Number(raw?.builderPolicy?.version);
    if (Number.isInteger(version) && version > 0) return version;
  } catch {
    /* fall through */
  }
  return 2;
}

/**
 * True when any local-CI owner fence file claims a live PID (slot still building).
 * Fence paths live in the shared git dir: dpf-local-ci-owner-<slot>.json
 */
function discoverLocalCiFenceActive() {
  try {
    const common = runCapture("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
    if (!common) return false;
    const listing = spawnSync(
      process.platform === "win32" ? "cmd" : "ls",
      process.platform === "win32"
        ? ["/c", `dir /b "${common.replace(/\//g, "\\")}\\dpf-local-ci-owner-*.json" 2>nul`]
        : ["-1", common],
      { encoding: "utf8", shell: process.platform === "win32" },
    );
    const names = (listing.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^dpf-local-ci-owner-.+\.json$/i.test(line) || line.includes("dpf-local-ci-owner-"));
    // On non-Windows, filter the directory listing ourselves.
    const fenceFiles = process.platform === "win32"
      ? names
      : names.filter((line) => /^dpf-local-ci-owner-.+\.json$/i.test(line));
    for (const file of fenceFiles) {
      const base = file.includes("dpf-local-ci-owner-")
        ? file.slice(file.lastIndexOf("dpf-local-ci-owner-"))
        : file;
      try {
        const raw = JSON.parse(readFileSync(join(common, base), "utf8"));
        const pid = Number(raw?.pid ?? raw?.ownerPid);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          /* stale fence */
        }
      } catch {
        /* unreadable fence */
      }
    }
  } catch {
    /* no git / no fences */
  }
  return false;
}

/**
 * Discover managed BuildKit builders from running/stopped buildx containers.
 * Uses docker ps -a so stopped containers still appear for obsolete REAP.
 */
function discoverManagedBuilders(nowMs = Date.now()) {
  const out = runCapture("docker", [
    "ps",
    "-a",
    "--filter",
    "name=buildx_buildkit_dpf-local-ci-buildkit-",
    "--format",
    "{{.Names}}\t{{.Status}}\t{{.CreatedAt}}",
  ]);
  const builders = [];
  const seen = new Set();
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [containerName, status, createdAt] = trimmed.split("\t");
    const parsed = parseManagedBuilderContainer(containerName);
    if (!parsed || seen.has(parsed.builderName)) continue;
    seen.add(parsed.builderName);
    const createdMs = Date.parse(createdAt);
    const running = /^Up\b/i.test(String(status ?? ""));
    builders.push({
      name: parsed.builderName,
      container: containerName,
      status,
      running,
      idleMs: Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0,
    });
  }
  // Also list buildx names in case a builder is registered without a matching
  // filter hit (bootstrap race). Status defaults to stopped if unknown.
  try {
    const ls = runCapture("docker", ["buildx", "ls", "--format", "{{.Name}}\t{{.StatusEndpoint}}"]);
    for (const line of ls.split("\n")) {
      const name = line.split("\t")[0]?.trim();
      const parsed = parseManagedBuilderContainer(`buildx_buildkit_${name}0`)
        || (name && name.startsWith("dpf-local-ci-buildkit-")
          ? { builderName: name, policyVersion: 0, ordinal: 0 }
          : null);
      // Prefer parseManagedBuilderName via container helper only for containers;
      // for bare names, accept the name if it matches the builder pattern.
      const bare = name && /^dpf-local-ci-buildkit-v\d+-\d+$/i.test(name) ? name : null;
      if (!bare || seen.has(bare)) continue;
      seen.add(bare);
      const statusText = line.split("\t")[1] ?? "";
      builders.push({
        name: bare,
        status: statusText,
        running: /running/i.test(statusText),
        idleMs: 0,
      });
    }
  } catch {
    /* buildx ls optional */
  }
  return builders;
}

// ── Reaping (only under --apply) ──────────────────────────────────────────────
function reapImage(repository) {
  const res = spawnSync("docker", ["rmi", repository], { encoding: "utf8" });
  return { ok: res.status === 0, detail: (res.status === 0 ? res.stdout : res.stderr || "").trim() };
}

/** List the named volumes Docker labelled as belonging to `projectName`. */
function discoverProjectVolumes(projectName) {
  const res = spawnSync(
    "docker",
    ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${projectName}`],
    { encoding: "utf8" },
  );
  if (res.status !== 0) return [];
  return (res.stdout ?? "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

function reapComposeProject(projectName) {
  // `down` removes containers + networks for the project. We deliberately do NOT
  // pass --volumes here: a bare `docker compose -p <name> down` runs without the
  // project's compose file in context, so `--volumes` would not know its named
  // volumes anyway. Volume reclaim is a separate, label-scoped step below, gated
  // by decideVolumeReclaim() (the never-wipe-db rule). COMPOSE_PROJECT_NAME scopes
  // the teardown to exactly this stray project.
  const res = spawnSync("docker", ["compose", "-p", projectName, "down", "--remove-orphans"], {
    encoding: "utf8",
    env: { ...process.env, COMPOSE_PROJECT_NAME: projectName },
  });
  const down = { ok: res.status === 0, detail: (res.status === 0 ? res.stdout : res.stderr || "").trim() };

  // Reclaim the stray project's orphaned named volumes (pgdata / node_modules /
  // per-package caches). Without this the project's storage lingers after its
  // worktree is gone — the observed volume bloat. decideVolumeReclaim() refuses
  // the root `dpf` project as defense-in-depth; the project reached here only
  // because planReap already classified it a stray REAP candidate.
  const volumes = [];
  const gate = decideVolumeReclaim(projectName);
  if (gate.ok) {
    for (const name of discoverProjectVolumes(projectName)) {
      const rm = spawnSync("docker", ["volume", "rm", name], { encoding: "utf8" });
      volumes.push({
        name,
        ok: rm.status === 0,
        detail: (rm.status === 0 ? rm.stdout : rm.stderr || "").trim(),
      });
    }
  }

  return { ...down, volumesSkippedReason: gate.ok ? undefined : gate.reason, volumes };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[runtime-artifact-janitor] ${err.message}`);
    process.exit(64);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const nowMs = Date.now();
  let buildImages;
  let composeProjects;
  let liveWorktreeProjectNames;
  let managedBuilders;
  let fenceActive = false;
  try {
    buildImages = discoverBuildImages();
    composeProjects = discoverComposeProjects();
    liveWorktreeProjectNames = discoverLiveWorktreeProjectNames();
    managedBuilders = discoverManagedBuilders(nowMs);
    fenceActive = discoverLocalCiFenceActive();
  } catch (err) {
    console.error(`[runtime-artifact-janitor] discovery failed: ${err.message}`);
    console.error("[runtime-artifact-janitor] (docker + git must be on PATH)");
    process.exit(1);
  }

  const plan = planReap({
    buildImages,
    composeProjects,
    liveWorktreeProjectNames,
    nowMs,
    stalenessDays: opts.stalenessDays,
  });

  const builderPlan = planManagedBuilderLifecycle({
    builders: managedBuilders,
    currentPolicyVersion: readCurrentBuilderPolicyVersion(),
    leaseOrFenceActive: fenceActive,
    idleGraceMs: DEFAULT_IDLE_GRACE_MS,
    coolDownEnabled: isBuilderCoolDownEnabled(process.env),
  });

  const applied = { images: [], projects: [], builders: [] };
  if (opts.apply) {
    for (const d of plan.imagesToReap) {
      const r = reapImage(d.image.repository);
      applied.images.push({ repository: d.image.repository, ...r });
    }
    for (const d of plan.projectsToReap) {
      const r = reapComposeProject(d.project.projectName);
      applied.projects.push({ projectName: d.project.projectName, ...r });
    }
    for (const d of builderPlan.toStop) {
      const res = spawnSync("docker", buildxStopArgs(d.builder.name), { encoding: "utf8" });
      applied.builders.push({
        name: d.builder.name,
        action: "STOP",
        ok: res.status === 0,
        detail: (res.status === 0 ? res.stdout : res.stderr || "").trim(),
      });
    }
    for (const d of builderPlan.toReap) {
      const res = spawnSync("docker", buildxRmArgs(d.builder.name), { encoding: "utf8" });
      applied.builders.push({
        name: d.builder.name,
        action: "REAP",
        ok: res.status === 0,
        detail: (res.status === 0 ? res.stdout : res.stderr || "").trim(),
      });
    }
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          mode: opts.apply ? "apply" : "dry-run",
          stalenessDays: plan.stalenessDays,
          imageDecisions: plan.imageDecisions,
          projectDecisions: plan.projectDecisions,
          builderDecisions: builderPlan.decisions,
          localCiFenceActive: fenceActive,
          applied,
        },
        null,
        2,
      ),
    );
  } else {
    renderText(plan, builderPlan, opts, applied, fenceActive);
  }

  process.exit(0);
}

function renderText(plan, builderPlan, opts, applied, fenceActive) {
  const mode = opts.apply ? "APPLY" : "DRY RUN";
  console.log(
    `\nRuntime-artifact janitor — ${mode} (staleness=${plan.stalenessDays}d, ${new Date().toISOString()})\n`,
  );

  console.log("Per-branch CI build images (dpf-local-integration-*-build):");
  if (plan.imageDecisions.length === 0) console.log("  (none found)");
  for (const d of plan.imageDecisions) {
    console.log(`  ${d.verdict.padEnd(5)} ${d.image.repository}  (${d.reason})`);
  }

  console.log("\nCompose projects:");
  if (plan.projectDecisions.length === 0) console.log("  (none found)");
  for (const d of plan.projectDecisions) {
    console.log(`  ${d.verdict.padEnd(5)} ${d.project.projectName}  (${d.reason})`);
  }

  console.log(
    `\nManaged local-CI BuildKit builders (fence active=${fenceActive ? "yes" : "no"}):`,
  );
  if (builderPlan.decisions.length === 0) console.log("  (none found)");
  for (const d of builderPlan.decisions) {
    console.log(`  ${d.action.padEnd(5)} ${d.builder.name}  (${d.reason})`);
  }

  if (opts.apply) {
    console.log("\nApplied:");
    for (const r of applied.images) {
      console.log(`  ${r.ok ? "removed image " : "FAILED image "}${r.repository}  ${r.detail}`);
    }
    for (const r of applied.projects) {
      console.log(`  ${r.ok ? "tore down project " : "FAILED project "}${r.projectName}  ${r.detail}`);
      for (const v of r.volumes ?? []) {
        console.log(`    ${v.ok ? "reclaimed volume " : "FAILED volume "}${v.name}  ${v.detail}`);
      }
      if (r.volumesSkippedReason) {
        console.log(`    volumes kept — ${r.volumesSkippedReason}`);
      }
    }
    for (const r of applied.builders) {
      console.log(
        `  ${r.ok ? `${r.action.toLowerCase()} builder ` : `FAILED ${r.action} builder `}${r.name}  ${r.detail}`,
      );
    }
  }

  console.log(
    `\nSummary: ${plan.imagesToReap.length} image(s) + ${plan.projectsToReap.length} compose project(s) to reap; `
      + `${builderPlan.toStop.length} builder(s) to stop + ${builderPlan.toReap.length} obsolete builder(s) to remove.`,
  );
  if (!opts.apply) {
    console.log("(Dry run — nothing removed. Pass --apply to reap.)\n");
  }
}

// Only run when invoked directly (not when imported by a test). fileURLToPath
// normalizes the platform path (Windows drive letters, leading-slash quirk) so
// the comparison holds on win32 + posix alike.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const selfPath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath && invokedPath === selfPath) {
  main();
}

export { parseArgs };
