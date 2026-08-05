#!/usr/bin/env tsx
// scripts/measure-implementation-scan.mts
//
// BI-1A1EC5EC — measure the filing-time implementation scan before anything
// depends on it.
//
// The scan is advisory by design. Whether it can ever become a MANDATORY dismissal
// step is a question about its hit rate, and that has to be answered with numbers
// on real backlog titles, not asserted. This replays titles through the scan
// against the real working tree and reports how often it fires and how loudly.
//
// The BI-3E5969DF lesson applies to this tool as much as anything else: a signal
// that fires on most items trains filers to dismiss it unread, at which point it
// is worse than nothing because it looks like a control.
//
// TypeScript (.mts, run under tsx) rather than the usual .mjs, because it imports
// the scanner from apps/web rather than reimplementing it. A second copy of the
// scoring rules would drift from the one that actually runs at filing time, and
// then this measurement would describe a tool nobody uses.
//
// Usage:
//   npx tsx scripts/measure-implementation-scan.mts --titles titles.json
//   echo '["Add a doc coverage gate"]' | npx tsx scripts/measure-implementation-scan.mts
//
// titles.json: ["title", ...] or [{"title": "...", "workType": "feature"}, ...]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findImplementationCandidates,
  type ImplementationCandidate,
} from "../apps/web/lib/operate/implementation-scan.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Directories that are never candidate implementations. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", "generated",
  ".turbo", ".pnpm-store", "out",
]);
const CODE_EXT = /\.(ts|tsx|mts|mjs|js|jsx|prisma|sql|sh|ps1|ya?ml)$/i;

/** Every candidate implementation file, repo-relative POSIX. */
function repoFiles(): string[] {
  const out: string[] = [];
  const walk = (absDir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // unreadable dir is not a measurement failure
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(absDir, e.name), childRel);
      else if (CODE_EXT.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) out.push(childRel);
    }
  };
  walk(REPO_ROOT, "");
  return out.sort();
}

function readTitles(): Array<{ title: string; workType?: string }> {
  const argIdx = process.argv.indexOf("--titles");
  const raw =
    argIdx !== -1 && process.argv[argIdx + 1]
      ? fs.readFileSync(path.resolve(process.argv[argIdx + 1]), "utf-8")
      : fs.readFileSync(0, "utf-8");
  const parsed = JSON.parse(raw) as Array<string | { title: string; workType?: string }>;
  return parsed.map((t) => (typeof t === "string" ? { title: t } : t));
}

function main(): void {
  const files = repoFiles();
  const titles = readTitles();
  if (titles.length === 0) {
    console.error("No titles supplied.");
    process.exit(1);
  }

  let fired = 0;
  const results: Array<{ title: string; hits: ImplementationCandidate[] }> = [];
  for (const { title, workType } of titles) {
    const hits = findImplementationCandidates(title, files, { workType });
    if (hits.length > 0) fired++;
    results.push({ title, hits });
  }

  console.log(`Scanned ${titles.length} title(s) against ${files.length} repo file(s).\n`);
  for (const { title, hits } of results) {
    if (hits.length === 0) {
      console.log(`  (silent)  ${title}`);
      continue;
    }
    console.log(`  FIRED     ${title}`);
    for (const h of hits) {
      console.log(`              ${h.score}  ${h.path}  [${h.matchedTerms.join(", ")}]`);
    }
  }

  const rate = Math.round((fired / titles.length) * 1000) / 10;
  console.log(`\nFired on ${fired}/${titles.length} (${rate}%).`);
  // Not a pass/fail — the number is the deliverable. A high fire rate means the
  // scan cannot be made mandatory as tuned, and says so rather than failing a job.
  if (rate > 50) {
    console.log(
      "NOTE: firing on more than half of items is too noisy to make mandatory — tune before requiring dismissal.",
    );
  }
}

main();
