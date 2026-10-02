#!/usr/bin/env node
/**
 * BI-C0E8A9EC (EP-E76E81D1) — no hidden Unicode in files that instruct an agent.
 *
 * Rulebooks, skills, prompts, agent registries and kernel principles are read
 * by models as instructions. A character a reviewer cannot see can carry an
 * instruction a model will follow: Unicode Tags ("ASCII smuggling"),
 * zero-width keyword splitting, invisible-operator bits, chained variation
 * selectors and bidi controls. That is how the "Rules File Backdoor" (Pillar
 * Security, 2025) and "Scary Agent Skills" (Rehberger, 2026-02) attacks hid
 * commands in .cursorrules, Copilot instructions and SKILL.md files, past a
 * visual diff.
 *
 * The guard fails when sanitizing a tracked instruction file would change it.
 * It uses the runtime's own sanitizer (packages/validators/src/untrusted-text.ts),
 * so the keep rules are identical: emoji ZWJ sequences, subdivision flags,
 * Persian/Indic joiners and CJK variants pass; everything else is refused.
 *
 * Run: node scripts/check-hidden-unicode-instruction-files.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyInvisible, sanitizeUntrustedText } from "../packages/validators/src/untrusted-text.ts";
import { gitText } from "./lib/git.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Tracked paths a model reads as instructions. */
export const INSTRUCTION_FILE = new RegExp(
  [
    String.raw`^(AGENTS|CLAUDE|GEMINI|CONVENTIONS)\.md$`,
    String.raw`(^|/)AGENTS\.md$`,
    String.raw`^\.github/copilot-instructions\.md$`,
    String.raw`^\.(cursor|clinerules|continue|claude|codex|grok|agents)/`,
    String.raw`(^|/)SKILL\.md$`,
    String.raw`\.skill\.md$`,
    String.raw`\.prompt\.md$`,
    String.raw`^prompts/`,
    String.raw`^skills/`,
    String.raw`^packages/dpf-skill-pack/`,
    String.raw`(^|/)agent_registry\.json$`,
    String.raw`^packages/db/data/.*\.json$`,
    String.raw`^docs/founder-kernel/`,
    String.raw`^docs/professions/.*/wiki/`,
  ].join("|"),
);

const TEXT_FILE = /\.(md|mdx|txt|json|ya?ml|toml|mjs|cjs|js|ts|sh|ps1)$|(^|\/)[^.]+$/;

/** First offending code points in `text`, with 1-based line and column. */
export function findHiddenUnicode(text, limit = 5) {
  if (sanitizeUntrustedText(text).total === 0) return [];
  const hits = [];
  const lines = text.split("\n");
  for (let l = 0; l < lines.length && hits.length < limit; l++) {
    const line = lines[l];
    const clean = sanitizeUntrustedText(line).text;
    if (clean === line) continue;
    // Walk the line and report the code points the sanitizer drops.
    const kept = Array.from(clean);
    let k = 0;
    let col = 1;
    for (const ch of line) {
      if (kept[k] === ch) {
        k++;
      } else {
        const cp = ch.codePointAt(0);
        hits.push({ line: l + 1, column: col, codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`, class: classifyInvisible(cp) });
        if (hits.length >= limit) break;
      }
      col += ch.length;
    }
  }
  return hits;
}

export function trackedInstructionFiles(root = REPO_ROOT) {
  const out = gitText(["ls-files", "-z"], { cwd: root, trim: false });
  return out.split("\0").filter((path) => path && INSTRUCTION_FILE.test(path) && TEXT_FILE.test(path));
}

export function checkFiles(paths, root = REPO_ROOT) {
  const violations = [];
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue; // deleted in the working tree
    }
    const hits = findHiddenUnicode(text);
    if (hits.length > 0) violations.push({ path, hits });
  }
  return violations;
}

function main() {
  const files = trackedInstructionFiles();
  const violations = checkFiles(files);
  if (violations.length === 0) {
    console.log(`hidden-unicode-instruction-files: OK — ${files.length} instruction file(s), none carry hidden Unicode.`);
    return;
  }
  console.error("hidden-unicode-instruction-files: FAILED (BI-C0E8A9EC)\n");
  console.error("These files instruct agents and contain characters a reviewer cannot see but a model reads:\n");
  for (const { path, hits } of violations) {
    for (const h of hits) console.error(`  ${path}:${h.line}:${h.column}  ${h.codePoint} (${h.class})`);
  }
  console.error(
    "\nRemove them. If one arrived in a contribution you did not write, treat it as a possible\n" +
      "prompt-injection attempt and tell the maintainer before merging.",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
