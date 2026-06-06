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

import { DEFAULT_STALENESS_DAYS, planReap } from "./lib/runtime-artifact-janitor.mjs";
import { deriveWorktreeComposeProjectName } from "./lib/compose-safety.mjs";

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
 * Discover compose projects and the creation time of their newest container.
 * Uses `docker ps -a` with the compose project label so we see stopped projects too.
 */
function discoverComposeProjects() {
  const out = runCapture("docker", [
    "ps",
    "-a",
    "--format",
    "{{.Label \"com.docker.compose.project\"}}\t{{.CreatedAt}}",
  ]);
  const newestByProject = new Map();
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [projectName, createdAt] = trimmed.split("\t");
    if (!projectName) continue; // containers not part of a compose project
    const createdMs = Date.parse(createdAt);
    const ms = Number.isFinite(createdMs) ? createdMs : 0;
    const prev = newestByProject.get(projectName);
    if (prev === undefined || ms > prev) newestByProject.set(projectName, ms);
  }
  return [...newestByProject.entries()].map(([projectName, newestContainerCreatedMs]) => ({
    projectName,
    newestContainerCreatedMs,
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

// ── Reaping (only under --apply) ──────────────────────────────────────────────
function reapImage(repository) {
  const res = spawnSync("docker", ["rmi", repository], { encoding: "utf8" });
  return { ok: res.status === 0, detail: (res.status === 0 ? res.stdout : res.stderr || "").trim() };
}

function reapComposeProject(projectName) {
  // `down` removes containers + networks for the project. We do NOT pass --volumes:
  // volumes are explicitly out of scope (never-wipe-db rule). COMPOSE_PROJECT_NAME
  // scopes the teardown to exactly this stray project.
  const res = spawnSync("docker", ["compose", "-p", projectName, "down", "--remove-orphans"], {
    encoding: "utf8",
    env: { ...process.env, COMPOSE_PROJECT_NAME: projectName },
  });
  return { ok: res.status === 0, detail: (res.status === 0 ? res.stdout : res.stderr || "").trim() };
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

  let buildImages;
  let composeProjects;
  let liveWorktreeProjectNames;
  try {
    buildImages = discoverBuildImages();
    composeProjects = discoverComposeProjects();
    liveWorktreeProjectNames = discoverLiveWorktreeProjectNames();
  } catch (err) {
    console.error(`[runtime-artifact-janitor] discovery failed: ${err.message}`);
    console.error("[runtime-artifact-janitor] (docker + git must be on PATH)");
    process.exit(1);
  }

  const plan = planReap({
    buildImages,
    composeProjects,
    liveWorktreeProjectNames,
    nowMs: Date.now(),
    stalenessDays: opts.stalenessDays,
  });

  const applied = { images: [], projects: [] };
  if (opts.apply) {
    for (const d of plan.imagesToReap) {
      const r = reapImage(d.image.repository);
      applied.images.push({ repository: d.image.repository, ...r });
    }
    for (const d of plan.projectsToReap) {
      const r = reapComposeProject(d.project.projectName);
      applied.projects.push({ projectName: d.project.projectName, ...r });
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
          applied,
        },
        null,
        2,
      ),
    );
  } else {
    renderText(plan, opts, applied);
  }

  process.exit(0);
}

function renderText(plan, opts, applied) {
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

  if (opts.apply) {
    console.log("\nApplied:");
    for (const r of applied.images) {
      console.log(`  ${r.ok ? "removed image " : "FAILED image "}${r.repository}  ${r.detail}`);
    }
    for (const r of applied.projects) {
      console.log(`  ${r.ok ? "tore down project " : "FAILED project "}${r.projectName}  ${r.detail}`);
    }
  }

  console.log(
    `\nSummary: ${plan.imagesToReap.length} image(s) + ${plan.projectsToReap.length} compose project(s) to reap.`,
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
