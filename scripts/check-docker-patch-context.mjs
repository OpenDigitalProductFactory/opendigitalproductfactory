#!/usr/bin/env node
// Docker Patch Context Guard.
//
// pnpm-workspace.yaml `patchedDependencies` names patch files by repo-relative
// path, and pnpm resolves them against the workspace root at install time. A
// missing patch file is not a warning — `pnpm install` exits 254 with ENOENT and
// takes the whole image build (or the runtime workspace bootstrap) down with it.
//
// PR #4321 added the first such directive without adding the matching COPY, so
// every self-upgrade after it failed deterministically (SUR-8AB3353C). This
// guard closes the class: for each declared patch it proves the file exists, is
// not excluded from the Docker build context, reaches every image stage that
// runs `pnpm install`, and travels with the root manifests that the runtime
// workspace bootstrap copies before installing.
//
// Fails closed: an unparseable Dockerfile stage graph is a failure, not a skip.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = process.cwd();

// Dockerfiles whose stages may run `pnpm install`. Every Dockerfile in the repo
// is inspected; this list only records which ones are EXPECTED to be checked, so
// a newly added Dockerfile cannot quietly opt out.
const DOCKERFILES = ["Dockerfile", "Dockerfile.sandbox", "Dockerfile.promoter"];

// Shell entrypoints baked into an image that run `pnpm install` against a
// directory they populate themselves, rather than against the build context.
const RUNTIME_BOOTSTRAP_SCRIPTS = ["docker-entrypoint.sh"];

/**
 * Parse the `patchedDependencies:` block of pnpm-workspace.yaml.
 * Line-oriented on purpose — the other workspace guards in this directory read
 * the same file the same way, and it avoids a YAML dependency in the guard path.
 *
 * @returns {{ spec: string, patchPath: string }[]}
 */
export function parsePatchedDependencies(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^patchedDependencies:\s*$/.test(l));
  if (start === -1) return [];

  const entries = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    // Any non-indented, non-comment line ends the block.
    if (!/^\s/.test(line)) break;

    const match = line.match(/^\s+(?:"([^"]+)"|'([^']+)'|(\S+?)):\s*(\S.*?)\s*$/);
    if (!match) {
      throw new Error(
        `check-docker-patch-context: unparseable patchedDependencies entry: ${line}`,
      );
    }
    const spec = match[1] ?? match[2] ?? match[3];
    const patchPath = match[4].replace(/^["']|["']$/g, "");
    entries.push({ spec, patchPath });
  }
  return entries;
}

/**
 * Would `.dockerignore` exclude this path from the build context?
 * Deliberately conservative: it only understands the plain prefix and
 * single-segment-glob forms this repo actually uses, and reports a pattern it
 * cannot classify as exclusion so the guard errs toward failing.
 */
export function isDockerignored(patchPath, dockerignoreText) {
  let excluded = false;
  for (const raw of dockerignoreText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line).replace(/\/+$/, "");
    if (pattern === "") continue;

    const regex = new RegExp(
      `^${pattern
        .split("/")
        .map((seg) =>
          seg === "**"
            ? ".*"
            : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
        )
        .join("/")}(/.*)?$`,
    );
    if (regex.test(patchPath)) excluded = !negated;
  }
  return excluded;
}

/**
 * Build the stage graph of a Dockerfile.
 *
 * Each stage records its parent (for `FROM <stage>`), its WORKDIR, the COPY
 * instructions it issues, and whether it runs `pnpm install`.
 */
export function parseStages(dockerfileText) {
  const stages = [];
  let current = null;
  // Join line continuations so a wrapped COPY/RUN is seen whole.
  const text = dockerfileText.replace(/\\\r?\n\s*/g, " ");

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const from = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      current = {
        name: from[2] ?? `#${stages.length}`,
        parent: from[1],
        workdir: null,
        copies: [],
        runsPnpmInstall: false,
      };
      stages.push(current);
      continue;
    }
    if (!current) continue;

    const workdir = line.match(/^WORKDIR\s+(\S+)/i);
    if (workdir) {
      current.workdir = workdir[1];
      continue;
    }

    const copy = line.match(/^COPY\s+(.*)$/i);
    if (copy) {
      const parts = copy[1].split(/\s+/).filter(Boolean);
      const flags = parts.filter((p) => p.startsWith("--"));
      const operands = parts.filter((p) => !p.startsWith("--"));
      if (operands.length >= 2) {
        current.copies.push({
          sources: operands.slice(0, -1),
          dest: operands[operands.length - 1],
          fromStage:
            flags
              .find((f) => f.toLowerCase().startsWith("--from="))
              ?.slice("--from=".length) ?? null,
        });
      }
      continue;
    }

    if (/^RUN\b/i.test(line) && /\bpnpm\s+install\b/.test(line)) {
      current.runsPnpmInstall = true;
    }
  }
  return stages;
}

function resolveWorkdir(stage, byName) {
  let node = stage;
  const seen = new Set();
  while (node && !seen.has(node.name)) {
    if (node.workdir) return node.workdir;
    seen.add(node.name);
    node = byName.get(node.parent) ?? null;
  }
  return "/";
}

/**
 * Does `stage` (or any stage it inherits from) place `patchPath` at the location
 * pnpm will look for it — i.e. under the stage's workdir, preserving the
 * repo-relative path?
 */
function stageProvidesPatch(stage, patchPath, byName, seen = new Set()) {
  if (!stage || seen.has(stage.name)) return false;
  seen.add(stage.name);

  const workdir = resolveWorkdir(stage, byName);
  const patchDir = dirname(patchPath); // e.g. "patches"

  for (const copy of stage.copies) {
    const dest = copy.dest.replace(/^\.\//, "").replace(/\/+$/, "");
    const destAbs = dest.startsWith("/") ? dest : `${workdir.replace(/\/+$/, "")}/${dest}`;
    const wantAbs = `${workdir.replace(/\/+$/, "")}/${patchDir}`;
    if (destAbs !== wantAbs) continue;

    for (const src of copy.sources) {
      const normalized = src.replace(/^\.\//, "").replace(/\/+$/, "");
      // Either the patch directory itself, or the exact patch file.
      if (
        normalized === patchDir ||
        normalized === patchPath ||
        normalized.endsWith(`/${patchDir}`)
      ) {
        return true;
      }
    }
  }

  // Inherited from the parent stage (same workdir chain), but NOT across a
  // `--from=` copy boundary, which starts a fresh filesystem.
  return stageProvidesPatch(byName.get(stage.parent), patchPath, byName, seen);
}

export function checkPatchContext(root = REPO_ROOT) {
  const problems = [];

  const workspacePath = join(root, "pnpm-workspace.yaml");
  const entries = parsePatchedDependencies(readFileSync(workspacePath, "utf8"));
  if (entries.length === 0) {
    return { ok: true, entries, problems, checkedStages: [] };
  }

  const dockerignore = existsSync(join(root, ".dockerignore"))
    ? readFileSync(join(root, ".dockerignore"), "utf8")
    : "";

  const checkedStages = [];

  for (const { spec, patchPath } of entries) {
    if (!existsSync(join(root, patchPath))) {
      problems.push(
        `pnpm-workspace.yaml patches ${spec} with ${patchPath}, but that file does not exist.`,
      );
      continue;
    }

    if (isDockerignored(patchPath, dockerignore)) {
      problems.push(
        `${patchPath} is excluded by .dockerignore, so it never reaches any Docker build context. ` +
          `Add a negation (\`!${dirname(patchPath)}/\`) or drop the excluding pattern.`,
      );
    }

    for (const dockerfile of DOCKERFILES) {
      const dockerfilePath = join(root, dockerfile);
      if (!existsSync(dockerfilePath)) continue;

      const stages = parseStages(readFileSync(dockerfilePath, "utf8"));
      const byName = new Map(stages.map((s) => [s.name, s]));

      for (const stage of stages) {
        if (!stage.runsPnpmInstall) continue;
        checkedStages.push(`${dockerfile}:${stage.name}`);
        if (!stageProvidesPatch(stage, patchPath, byName)) {
          problems.push(
            `${dockerfile} stage \`${stage.name}\` runs \`pnpm install\` but never COPYs ${patchPath} ` +
              `into ${resolveWorkdir(stage, byName)}. pnpm resolves patchedDependencies against the ` +
              `workspace root and exits 254 (ENOENT) when the patch is absent. ` +
              `Add \`COPY ${dirname(patchPath)}/ ./${dirname(patchPath)}/\` before the install.`,
          );
        }
      }
    }

    // Runtime bootstrap: an entrypoint that populates a workspace directory and
    // installs into it must carry the patches there too. The build context is
    // irrelevant at that point — only what the entrypoint copies exists.
    for (const script of RUNTIME_BOOTSTRAP_SCRIPTS) {
      const scriptPath = join(root, script);
      if (!existsSync(scriptPath)) continue;
      const text = readFileSync(scriptPath, "utf8");
      if (!/\bpnpm\s+install\b/.test(text)) continue;
      checkedStages.push(`${script}:runtime-bootstrap`);
      if (!text.includes(`/${dirname(patchPath)}`)) {
        problems.push(
          `${script} runs \`pnpm install\` against a workspace it populates itself, but never copies ` +
            `${dirname(patchPath)}/ into it. The runtime install fails with the same ENOENT the ` +
            `image build does.`,
        );
      }
    }
  }

  return { ok: problems.length === 0, entries, problems, checkedStages };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const result = checkPatchContext();
  if (!result.ok) {
    console.error("Docker Patch Context Guard: FAIL\n");
    console.error(result.problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(
    `Docker Patch Context Guard: ${result.entries.length} patched ` +
      `${result.entries.length === 1 ? "dependency" : "dependencies"} reachable from ` +
      `${new Set(result.checkedStages).size} installing stage(s) — ok.`,
  );
}
