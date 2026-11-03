// Edge build-input closure. Reuses the Docker parser and lockfile traversal.
import { readFileSync, existsSync } from "node:fs";
import { posix, join } from "node:path";
import { parseStages, isDockerignored } from "./lib/docker-stage-graph.mjs";
import { loadGraph, collectWorkspaceClosure } from "./sbom/runtime-surface.mjs";

function workdir(stage, byName, seen = new Set()) {
  if (seen.has(stage.name)) throw new Error(`Cyclic Docker stage: ${stage.name}`);
  seen.add(stage.name);
  return stage.workdir ?? (byName.has(stage.parent) ? workdir(byName.get(stage.parent), byName, seen) : "/");
}

function provides(stage, file, byName, seen = new Set(), wanted = posix.resolve(workdir(stage, byName), file)) {
  if (!stage || seen.has(stage.name)) return false;
  seen.add(stage.name);
  for (const copy of stage.copies) {
    if (copy.fromStage) continue; // An arbitrary stage copy is not a repository input proof.
    const cwd = copy.workdir ?? (byName.has(stage.parent) ? workdir(byName.get(stage.parent), byName) : "/");
    for (const raw of copy.sources) {
      const source = posix.normalize(raw).replace(/\/$/, "");
      const dest = posix.resolve(cwd, copy.dest);
      if (source === file) {
        const target = copy.dest.endsWith("/") || copy.sources.length > 1
          ? posix.join(dest, posix.basename(source)) : dest;
        if (target === wanted) return true;
      } else if (source === "." || file.startsWith(`${source}/`)) {
        const suffix = source === "." ? file : file.slice(source.length + 1);
        if (posix.join(dest, suffix) === wanted) return true;
      }
    }
  }
  return provides(byName.get(stage.parent), file, byName, seen, wanted);
}

export function findMissingWorkspaceContext(text, importers, roots, dockerignore = "") {
  const closure = collectWorkspaceClosure(importers, roots);
  const stages = parseStages(text);
  const byName = new Map(stages.map(stage => [stage.name, stage]));
  const problems = [];
  let installCount = 0;
  for (const stage of stages) for (const snapshot of stage.installs) {
    installCount++;
    const atInstall = { ...stage, ...snapshot };
    for (const ws of closure) {
      const manifest = `${ws}/package.json`;
      if (isDockerignored(manifest, dockerignore) || !provides(atInstall, manifest, byName)) {
        problems.push(`stage ${stage.name} requires workspace ${ws} before pnpm install`);
      }
    }
  }
  if (!installCount) problems.push("No pnpm install found; workspace context is unproven");
  return problems;
}

export function checkEdgeWorkspaceContext(root = process.cwd()) {
  const image = "services/edge-node/Dockerfile";
  try {
    const problems = findMissingWorkspaceContext(
      readFileSync(join(root, image), "utf8"), loadGraph(root).importers,
      ["services/edge-node"], readFileSync(join(root, ".dockerignore"), "utf8"),
    ).map(problem => `${image}: ${problem}`);
    return { ok: problems.length === 0, problems };
  } catch (error) {
    return { ok: false, problems: [`${image}: ${error.message}`] };
  }
}

// pnpm can fetch root file dependencies even when --filter selects another
// importer. Prove the archive exists at every install snapshot, not a later COPY.
export function findMissingFileContext(text, files, dockerignore = "") {
  const stages = parseStages(text), byName = new Map(stages.map(stage => [stage.name, stage]));
  const problems = [];
  for (const stage of stages) for (const snapshot of stage.installs) for (const file of files) {
    if (isDockerignored(file, dockerignore) || !provides({ ...stage, ...snapshot }, file, byName)) {
      problems.push(`stage ${stage.name} requires file dependency ${file} before pnpm install`);
    }
  }
  return problems;
}

export function checkFileDependencyContext(root, images) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const files = [...new Set(Object.values({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies })
      .filter(value => typeof value === "string" && value.startsWith("file:") && value.endsWith(".tgz"))
      .map(value => value.slice(5)))];
    const problems = [];
    for (const file of files) {
      if (posix.isAbsolute(file) || file.split(/[\\/]/).includes("..") || !existsSync(join(root, file))) {
        problems.push(`Missing or unsafe root file dependency: ${file}`);
      }
    }
    const ignore = readFileSync(join(root, ".dockerignore"), "utf8");
    for (const image of images) {
      if (!existsSync(join(root, image))) continue;
      problems.push(...findMissingFileContext(readFileSync(join(root, image), "utf8"), files, ignore)
        .map(problem => `${image}: ${problem}`));
    }
    return { ok: problems.length === 0, problems, files };
  } catch (error) { return { ok: false, problems: [error.message] }; }
}
