#!/usr/bin/env node
/**
 * BI-5D412E3C (EP-E76E81D1) — no hidden Unicode in commit messages or PR text.
 *
 * The instruction-file guard (check-hidden-unicode-instruction-files.mjs)
 * covers files agents read as instructions. Commit messages and PR text are
 * read by agents too, and this repo squash-merges with the branch's commit
 * messages, so a hidden character in any commit on a branch lands in main's
 * history. One did: a U+200B in an example word in PR #5861's commits reached
 * main as 418eaac44, written by agent tooling that decoded an escape into the
 * literal character. History on main is not rewritten; this refuses the next.
 *
 * Scans every commit message in BASE_SHA..HEAD and, in CI, the PR title and
 * body (PR_TITLE / PR_BODY). Uses the same rule as runtime and the
 * instruction-file guard (findHiddenUnicode → the shared sanitizer), so
 * emoji, flags, joiners and Arabic/Hebrew direction marks pass.
 *
 * Run: node scripts/check-hidden-unicode-commit-text.mjs
 */
import { pathToFileURL } from "node:url";
import { findHiddenUnicode } from "./check-hidden-unicode-instruction-files.mjs";
import { gitTextOrNull } from "./lib/git.mjs";

const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const FIELD = String.fromCharCode(0x1f);
const RECORD = String.fromCharCode(0x1e);

function assertSafeRef(ref) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error(`[hidden-unicode-commit-text] refusing unsafe BASE_SHA: ${JSON.stringify(ref)}`);
  }
  return ref;
}

/** Parse `git log --format=%H<US>%B<RS>` output into { sha, message } entries. */
export function parseCommitLog(logText) {
  return logText
    .split(RECORD)
    .map((record) => record.replace(/^\s+/, ""))
    .filter((record) => record.includes(FIELD))
    .map((record) => {
      const [sha, ...rest] = record.split(FIELD);
      return { sha: sha.trim(), message: rest.join(FIELD) };
    });
}

/** Every hidden-Unicode hit across commit messages and PR text, labelled by source. */
export function findHiddenInCommitText({ commits = [], prTitle = "", prBody = "" }) {
  const findings = [];
  for (const { sha, message } of commits) {
    const hits = findHiddenUnicode(message);
    if (hits.length > 0) findings.push({ source: `commit ${sha.slice(0, 12)} message`, hits });
  }
  for (const [source, text] of [["PR title", prTitle], ["PR body", prBody]]) {
    const hits = findHiddenUnicode(text ?? "");
    if (hits.length > 0) findings.push({ source, hits });
  }
  return findings;
}

function main() {
  const base = assertSafeRef(process.env.BASE_SHA || "origin/main");
  const log = gitTextOrNull(["log", `--format=%H${FIELD}%B${RECORD}`, `${base}..HEAD`], { trim: false });
  if (log === null) {
    // Fail closed on safety, open on infrastructure: an unresolvable base is
    // not a verdict on the text, so say so instead of claiming a pass.
    console.log(`[hidden-unicode-commit-text] could not read commits for ${base}..HEAD — not evaluated.`);
    return;
  }
  const commits = parseCommitLog(log);
  const findings = findHiddenInCommitText({
    commits,
    prTitle: process.env.PR_TITLE || "",
    prBody: process.env.PR_BODY || "",
  });
  const scope = `${commits.length} commit message(s)${process.env.PR_BODY || process.env.PR_TITLE ? " and the PR title/body" : ""}`;
  if (findings.length === 0) {
    console.log(`[hidden-unicode-commit-text] OK — ${scope}, none carry hidden Unicode.`);
    return;
  }
  console.error("[hidden-unicode-commit-text] FAILED (BI-5D412E3C)\n");
  console.error("Characters a reviewer cannot see but a model reads, in text that would land in main:\n");
  for (const { source, hits } of findings) {
    for (const h of hits) console.error(`  ${source} ${h.line}:${h.column}  ${h.codePoint} (${h.class})`);
  }
  console.error(
    "\nRewrite the text with the character removed (or written as a \\u{XXXX} escape inside code).\n" +
      "Agent tooling can decode a backslash-u escape into the literal character; check what was written.",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
