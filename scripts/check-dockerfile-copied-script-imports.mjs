#!/usr/bin/env node
// check-dockerfile-copied-script-imports.mjs — BI-9B490215.
//
// The Dockerfile copies individual scripts by name, never `scripts/` wholesale:
//
//   COPY scripts/set-hooks-path.mjs ./scripts/
//
// That keeps the image small, but it silently couples the image to the import
// graph of every file it names. Extract a helper out of one of those scripts and
// the image loses it: the module still resolves in a developer clone and in every
// `next build`, so PR CI stays green, and the break only appears when the image
// is actually built — in local-CI, in the release publish, or in a self-upgrade.
//
// Measured instance: `scripts/set-hooks-path.mjs` gained a top-level
// `import { resolveHooksDir } from './lib/hooks-dir.mjs'`, which the Dockerfile
// never copied. Root `postinstall` runs that script, so
// `RUN pnpm install --frozen-lockfile` died with
// `ERR_MODULE_NOT_FOUND file:///app/scripts/lib/hooks-dir.mjs` and the whole
// image build failed — breaking the release/self-upgrade chain for every install.
//
// A STATIC import fails at module-link time, so a try/catch inside the script
// cannot contain it. Dynamic `await import(...)` inside a try/catch degrades
// instead, which is why the sibling `ensure-pre-push-hook.mjs` /
// `ensure-post-checkout-hook.mjs` imports in that same file never broke anything.
// This guard therefore only inspects STATIC imports.
//
// Invariant: if the Dockerfile copies a `.mjs` file into a stage, every file it
// statically imports must also land in that stage — copied there directly, or
// inherited from a stage it is built FROM.
//
// The check asserts a floor on how many copied scripts it read, so a parse
// that silently finds nothing (a renamed Dockerfile, a COPY shape the parser
// no longer recognises) fails instead of passing vacuously.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT_CONTEXT_DOCKERFILES } from "./check-docker-patch-context.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(new URL(import.meta.url))), "..");

/**
 * Static `import ... from "x"` / `export ... from "x"`, plus bare `import "x"`.
 * A `{ ... }` binding list may span lines: a multi-line import of
 * ../lib/pnpm-lock.mjs once slipped past a single-line-only pattern.
 */
const STATIC_IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\b(?:[^;\n{]|\{[^}]*\})*?\bfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

/**
 * Fewest Dockerfile-copied scripts a healthy parse reads. Measured 2026-10-07:
 * 82 across the root-context Dockerfiles. Set well below that so deleting a
 * script is not a guard edit, and well above zero so an empty parse fails.
 */
export const MIN_DOCKERFILE_COPIED_SCRIPTS = 40;

/** Flags that may precede COPY operands. */
const COPY_FLAG_RE = /^--(from|chown|chmod|link|parents)=?/;

/**
 * Collapse backslash line-continuations and drop comments/blank lines.
 * @param {string} text
 * @returns {string[]}
 */
export function logicalLines(text) {
  const out = [];
  let buffer = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const isComment = /^\s*#/.test(line);
    if (buffer === "" && (isComment || line.trim() === "")) continue;
    // Continuation fragments carry their own indentation; normalise to single
    // spaces so callers can split operands on /\s+/ without surprises.
    const fragment = buffer === "" ? line : line.trimStart();
    if (line.endsWith("\\")) {
      buffer += fragment.slice(0, -1).trimEnd() + " ";
      continue;
    }
    out.push((buffer + fragment).trim());
    buffer = "";
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

/**
 * Parse a Dockerfile into stages with their COPY destinations resolved to
 * absolute in-image paths.
 *
 * @param {string} text
 * @returns {{ name: string, parent: string|null, workdir: string,
 *             copies: Array<{ src: string, imagePath: string, fromStage: string|null }> }[]}
 */
export function parseStages(text) {
  const stages = [];
  const byName = new Map();
  let current = null;

  for (const line of logicalLines(text)) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      const base = from[1];
      const name = from[2] ?? `stage${stages.length}`;
      const parent = byName.has(base) ? base : null;
      current = {
        name,
        parent,
        workdir: parent ? byName.get(parent).workdir : "/",
        copies: [],
      };
      stages.push(current);
      byName.set(name, current);
      continue;
    }
    if (!current) continue;

    const workdir = /^WORKDIR\s+(\S+)/i.exec(line);
    if (workdir) {
      current.workdir = path.posix.resolve(current.workdir, workdir[1]);
      continue;
    }

    if (!/^COPY\s/i.test(line)) continue;
    const operands = line.slice(4).trim().split(/\s+/);
    let fromStage = null;
    while (operands.length && COPY_FLAG_RE.test(operands[0])) {
      const flag = operands.shift();
      const m = /^--from=(.+)$/.exec(flag);
      if (m) fromStage = m[1];
    }
    if (operands.length < 2) continue;
    const dest = operands.pop();
    const absDest = dest.startsWith("/") ? dest : path.posix.resolve(current.workdir, dest);
    const destIsDir = dest.endsWith("/") || operands.length > 1;

    for (const src of operands) {
      const imagePath = destIsDir
        ? path.posix.join(absDest, path.posix.basename(src))
        : absDest;
      current.copies.push({ src, imagePath, fromStage });
    }
  }
  return stages;
}

/**
 * Every in-image path a stage can see: its own COPYs plus those of every stage
 * it is built FROM.
 *
 * @param {ReturnType<typeof parseStages>} stages
 * @param {string} name
 * @returns {Set<string>}
 */
export function visiblePaths(stages, name) {
  const byName = new Map(stages.map((s) => [s.name, s]));
  const seen = new Set();
  let stage = byName.get(name);
  while (stage) {
    for (const copy of stage.copies) seen.add(copy.imagePath);
    stage = stage.parent ? byName.get(stage.parent) : null;
  }
  return seen;
}

/**
 * Relative specifiers statically imported by a module.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function staticRelativeImports(source) {
  const specs = [];
  for (const match of source.matchAll(STATIC_IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (spec && (spec.startsWith("./") || spec.startsWith("../"))) specs.push(spec);
  }
  return specs;
}

/**
 * @param {string} dockerfileText
 * @param {(repoRelativePath: string) => string|null} readSource
 *        Returns file contents, or null when the path is not a readable repo file.
 * @param {{ checked: number }} [stats]  incremented once per copied script read
 * @returns {Array<{ stage: string, importer: string, importerSrc: string,
 *                   specifier: string, missing: string }>}
 */
export function findMissingCopiedImports(dockerfileText, readSource, stats = { checked: 0 }) {
  const stages = parseStages(dockerfileText);
  const violations = [];

  for (const stage of stages) {
    const visible = visiblePaths(stages, stage.name);
    for (const copy of stage.copies) {
      // Artifacts lifted from another stage are produced there, not by this
      // repo path; their import graph is that stage's problem, not ours.
      if (copy.fromStage) continue;
      if (!copy.imagePath.endsWith(".mjs")) continue;
      const source = readSource(copy.src);
      if (source == null) continue;
      stats.checked++;

      for (const spec of staticRelativeImports(source)) {
        const target = path.posix.resolve(path.posix.dirname(copy.imagePath), spec);
        if (visible.has(target)) continue;
        violations.push({
          stage: stage.name,
          importer: copy.imagePath,
          importerSrc: copy.src,
          specifier: spec,
          missing: target,
        });
      }
    }
  }
  return violations;
}

/**
 * Violations across every Dockerfile built from the repo root (the service
 * images copy scripts by name too: each service image runs the deploy-lockfile
 * assertion), tagged with the Dockerfile they came from.
 *
 * @param {string} [root]
 * @param {{ checked: number }} [stats]
 */
export function findMissingCopiedImportsInRepo(root = REPO_ROOT, stats = { checked: 0 }) {
  const readSource = (src) => {
    const abs = path.join(root, src);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  };
  const violations = [];
  for (const dockerfile of ROOT_CONTEXT_DOCKERFILES) {
    const text = readSource(dockerfile);
    if (text == null) continue;
    for (const v of findMissingCopiedImports(text, readSource, stats)) violations.push({ dockerfile, ...v });
  }
  return violations;
}

function main() {
  const dockerfilePath = path.join(REPO_ROOT, "Dockerfile");
  if (!existsSync(dockerfilePath)) {
    console.error(`[dockerfile-script-imports] cannot read ${dockerfilePath}`);
    process.exit(1);
  }
  const stats = { checked: 0 };
  const violations = findMissingCopiedImportsInRepo(REPO_ROOT, stats);

  if (stats.checked < MIN_DOCKERFILE_COPIED_SCRIPTS) {
    console.error(
      `[dockerfile-script-imports] FAILED — read ${stats.checked} Dockerfile-copied scripts, floor ${MIN_DOCKERFILE_COPIED_SCRIPTS}.`,
    );
    console.error(
      "The parse found too little to vouch for anything: a Dockerfile path or COPY shape changed under it.",
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      `[dockerfile-script-imports] OK — ${stats.checked} Dockerfile-copied scripts read; every statically imported module is copied too.`,
    );
    return;
  }

  console.error(
    "[dockerfile-script-imports] FAILED — a Dockerfile-copied script statically imports a file the image never receives.",
  );
  console.error(
    "The image build dies at `pnpm install` / first run with ERR_MODULE_NOT_FOUND. `next build` and PR CI cannot see this.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.dockerfile} stage ${v.stage}: ${v.importer}`);
    console.error(`    imports ${v.specifier} -> ${v.missing} (not copied)`);
    console.error(`    add: COPY ${path.posix.join(path.posix.dirname(v.importerSrc), v.specifier)} <dest>\n`);
  }
  console.error(
    "Fix by copying the imported file into the same stage, or make the import a dynamic\n" +
      "`await import(...)` inside a try/catch so the image degrades instead of failing to build.",
  );
  process.exit(1);
}

if (isEntryModule(import.meta.url)) main();
