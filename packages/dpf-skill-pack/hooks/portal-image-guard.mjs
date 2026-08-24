#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/portal-image-guard.mjs
//
// PreToolUse guard: refuse a HAND-BUILT canonical portal image.
//
// AGENTS.md §1/§4 already say it plainly — "never rebuild the live portal by
// hand; /ops/self-upgrade owns quiescence, recovery points and rollback" — and
// on 2026-08-22 an agent did it three times anyway, because nothing stopped it.
// compose-guard.mjs deliberately allows `build` (its header says so: "What
// stays ALLOWED: build, image pulls, ps, logs"), since building is harmless.
// Building is not the harm. TAGGING THE CANONICAL NAME is: `-t dpf-portal:latest`
// overwrites the image the live install runs, and because an image carries the
// identity of its bytes, the previous canonical image is then gone. There is no
// clean revert, and /ops/self-upgrade can no longer roll back to it.
//
// So this guard is narrow on purpose. It blocks writing the canonical portal
// TAG, not building:
//   DENIED   docker build -t dpf-portal:latest .
//   DENIED   docker tag <anything> dpf-portal:latest
//   DENIED   docker compose -p dpf build portal      (writes the canonical tag)
//   ALLOWED  docker build -t dpf-portal:my-experiment .   (not canonical)
//   ALLOWED  docker build … on an isolated project (-p dpf-<topic>)
//   ALLOWED  everything the sanctioned scripts do (see SANCTIONED below)
//
// The point is to leave the diagnostic loop intact — you can still build and
// inspect an image — while making the destructive step the one that stops you.
//
// Decision protocol matches its siblings: to DENY, emit the PreToolUse envelope
// and exit 0; to ALLOW, exit 0 silently. Fails OPEN on any parse/IO error — a
// guard must never wedge a session.
//
// Bypass (recorded, not silent): DPF_ALLOW_PORTAL_IMAGE_BUILD=1, for the
// install/recovery case where no running portal exists to self-upgrade yet.

import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";

// The repository names the live install runs from, and the tags it runs.
// Parsed rather than pattern-matched: `dpf-portal:latest` is canonical while
// `dpf-portal:scratch` is a local experiment, and a regex over the whole string
// gets that wrong in the over-blocking direction.
const CANONICAL_REPOS = new Set(["portal", "dpf-portal", "dpf_portal"]);
const CANONICAL_TAGS = new Set(["latest", "stable", "current"]);

/** Does this tag name the image the live install actually runs? */
export function isCanonicalTag(ref) {
  const raw = String(ref || "").trim();
  if (!raw) return false;

  // Split repo:tag on the LAST colon, but only when it is a tag rather than a
  // registry port (`registry:5000/portal` has no tag at all).
  const lastColon = raw.lastIndexOf(":");
  const lastSlash = raw.lastIndexOf("/");
  const hasTag = lastColon > lastSlash;
  const repoPath = hasTag ? raw.slice(0, lastColon) : raw;
  const tag = hasTag ? raw.slice(lastColon + 1) : "";

  const repo = repoPath.split("/").pop()?.toLowerCase() ?? "";
  if (!CANONICAL_REPOS.has(repo)) return false;

  // No tag means :latest, which is canonical.
  return tag === "" || CANONICAL_TAGS.has(tag.toLowerCase());
}

// Scripts that own the sanctioned path. promote.sh and redeploy-portal.* build
// and swap the portal deliberately, under /ops/self-upgrade's quiescence and
// recovery-point handling — that is the whole point of routing through them.
const DEFAULT_PROJECT = "dpf";

const SANCTIONED = [
  "scripts/promote.sh",
  "scripts/redeploy-portal",
  "scripts/self-upgrade",
  "scripts/local-ci-runner",
  "ops/self-upgrade",
];

const GUIDANCE = [
  "Refusing to hand-build the canonical portal image.",
  "",
  "AGENTS.md §1/§4: never rebuild the live portal by hand — /ops/self-upgrade",
  "owns quiescence, recovery points and rollback.",
  "",
  "Writing the canonical tag (dpf-portal:latest) OVERWRITES the image the live",
  "install runs. An image carries the identity of its bytes, so the previous",
  "canonical image is destroyed and there is no clean revert.",
  "",
  "Instead:",
  "  - to ship a change: land it via PR, then /ops/self-upgrade rebuilds from main",
  "  - to exercise an unmerged change: claim the contributor preview",
  "      sh scripts/dev-portal-lease.sh claim   (then :3001)",
  "  - to inspect an image locally: build it under a NON-canonical tag,",
  "      docker build -t dpf-portal:scratch .",
  "",
  "If the preview is unobtainable and you cannot verify, that is a finding to",
  "report — not a reason to rebuild the live runtime. See BI-5A3DFF40.",
  "",
  "Install/recovery bypass (recorded): DPF_ALLOW_PORTAL_IMAGE_BUILD=1 <command>",
].join("\n");

/** Strip quoting so `-t "dpf-portal:latest"` is seen the same as bare. */
function normalize(command) {
  return String(command || "").replace(/["']/g, " ");
}

/** Tags this command would WRITE: -t/--tag values, and `docker tag <src> <dst>`. */
export function writtenTags(command) {
  const text = normalize(command);
  const tags = [];

  for (const m of text.matchAll(/(?:^|\s)(?:-t|--tag)[\s=]+(\S+)/g)) {
    tags.push(m[1]);
  }

  // `docker tag SOURCE TARGET` — only TARGET is written.
  const tagCmd = text.match(/\bdocker\s+(?:image\s+)?tag\s+(\S+)\s+(\S+)/);
  if (tagCmd) tags.push(tagCmd[2]);

  return tags;
}

/**
 * A `docker compose build portal` (or a bare `compose build` on the root
 * project) writes the canonical tag without ever naming it, because the tag
 * lives in the compose file. Treat the root project as canonical unless an
 * isolated project is selected.
 */
function composeBuildsCanonicalPortal(command) {
  const text = normalize(command);
  if (!/\bdocker\s+compose\b/.test(text)) return false;
  if (!/\bbuild\b/.test(text)) return false;

  // Only the EXACT root project owns the live install's images; `dpf-<topic>`
  // is an isolated project and cannot.
  const project = text.match(/(?:^|\s)(?:-p|--project-name)[\s=]+(\S+)/);
  if (project && project[1] !== DEFAULT_PROJECT) return false;
  const envProject = text.match(/COMPOSE_PROJECT_NAME=(\S+)/);
  if (envProject && envProject[1] !== DEFAULT_PROJECT) return false;

  // `compose build` with no service operand builds everything, portal included.
  const services = text
    .split(/\s+/)
    .slice(text.split(/\s+/).indexOf("build") + 1)
    .filter((t) => t && !t.startsWith("-"));
  if (services.length === 0) return true;
  return services.some((s) => /portal/i.test(s));
}

export function decide({ command, env = {} }) {
  const text = normalize(command);
  if (!text.trim()) return { block: false };
  if (env.DPF_ALLOW_PORTAL_IMAGE_BUILD === "1") return { block: false };

  // The sanctioned scripts ARE the governed path; never block them.
  if (SANCTIONED.some((s) => text.includes(s))) return { block: false };

  const writesCanonicalTag = writtenTags(text).some(isCanonicalTag);
  if (writesCanonicalTag || composeBuildsCanonicalPortal(text)) {
    return { block: true, reason: GUIDANCE };
  }

  return { block: false };
}

// ── runtime entry ────────────────────────────────────────────────────────────

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open
  if (!inDpfWorkspace(payload.cwd)) process.exit(0);
  if (!isShellTool(payload.toolName)) process.exit(0);

  const verdict = decide({
    command: shellCommandFromInput(payload.toolInput),
    env: process.env,
  });
  if (!verdict.block) process.exit(0);

  emitDeny(verdict.reason);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("portal-image-guard.mjs")) {
  main();
}
