import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluate,
  findRetiredMentions,
  isScannable,
  isUnderHistoricalRoot,
  loadRegistry,
} from "./check-retired-substrate.mjs";
import { gitText } from "./lib/git.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = [
  { term: "neo4j", retiredBy: "BET-5", replacement: "the Postgres graph mirror" },
  { term: "qdrant", retiredBy: "BET-5", replacement: "pgvector" },
];

function registry({ allowed = {}, historicalRoots = {} } = {}) {
  return { entries: ENTRIES, allowed, historicalRoots };
}

test("finds a retired term regardless of case", () => {
  assert.deepEqual(findRetiredMentions("We run Neo4j here.\n", ENTRIES), [{ term: "neo4j", line: 1 }]);
  assert.deepEqual(findRetiredMentions("NEO4J_URL=bolt://x\n", ENTRIES), [{ term: "neo4j", line: 1 }]);
});

test("finds mentions INSIDE fenced code blocks — the runbook-command case", () => {
  // The most dangerous real instance was a copy-pasteable command in an incident
  // runbook. A gate that skipped code fences would miss exactly that.
  const md = ["# Recovery", "", "```bash", "docker compose up -d postgres qdrant", "```", ""].join("\n");
  assert.deepEqual(findRetiredMentions(md, ENTRIES), [{ term: "qdrant", line: 4 }]);
});

test("reports the first line per term, and each term at most once", () => {
  const md = ["intro", "neo4j again", "neo4j once more", "and qdrant"].join("\n");
  assert.deepEqual(findRetiredMentions(md, ENTRIES), [
    { term: "neo4j", line: 2 },
    { term: "qdrant", line: 4 },
  ]);
});

test("does not fire on a term embedded in a larger word", () => {
  // "neo4js" / "qdrantic" are not the retired services.
  assert.deepEqual(findRetiredMentions("neo4jsomething and qdrantic\n", ENTRIES), []);
  // ...but punctuation-delimited forms ARE the service.
  assert.equal(findRetiredMentions("see neo4j-driver\n", ENTRIES).length, 1);
  assert.equal(findRetiredMentions("(qdrant)\n", ENTRIES).length, 1);
});

test("stays silent on a clean file", () => {
  assert.deepEqual(findRetiredMentions("All state lives in PostgreSQL.\n", ENTRIES), []);
});

test("loadRegistry rejects an entry with no term rather than silently skipping it", () => {
  assert.throws(() => loadRegistry({ retired: [{ retiredBy: "x" }] }), /missing a "term"/);
  assert.deepEqual(loadRegistry({ retired: [] }).entries, []);
});

test("loadRegistry refuses an allowlist or historical-root entry with no reason", () => {
  assert.throws(() => loadRegistry({ retired: [], allowed: { "a.ts": "" } }), /allowed entry "a.ts" has no reason/);
  assert.throws(
    () => loadRegistry({ retired: [], historicalRoots: { "docs/old/": "  " } }),
    /historicalRoots entry "docs\/old\/" has no reason/,
  );
  assert.throws(() => loadRegistry({ retired: [], historicalRoots: { "docs/old": "x" } }), /must end with "\/"/);
});

test("forbids a mention in any file that is neither allowlisted nor historical", () => {
  const contents = { "apps/x.ts": "// write to neo4j\n", "docs/clean.md": "postgres only\n" };
  const result = evaluate(Object.keys(contents), registry(), (p) => contents[p]);
  assert.deepEqual(result.forbidden, [{ filePath: "apps/x.ts", term: "neo4j", line: 1 }]);
  assert.deepEqual(result.stale, []);
});

test("an allowlisted file and a file under a historical root pass", () => {
  const contents = { "scripts/guard.mjs": "qdrant\n", "docs/superpowers/plan.md": "neo4j\n" };
  const result = evaluate(
    Object.keys(contents),
    registry({ allowed: { "scripts/guard.mjs": "guard" }, historicalRoots: { "docs/superpowers/": "history" } }),
    (p) => contents[p],
  );
  assert.deepEqual(result, { forbidden: [], stale: [], redundant: [] });
});

test("an allowlist entry whose file no longer names a retired term is stale", () => {
  // The list only shrinks: once a file is fixed its entry must go, so the
  // mention cannot quietly come back.
  const contents = { "apps/fixed.ts": "pgvector\n" };
  const result = evaluate(
    Object.keys(contents),
    registry({ allowed: { "apps/fixed.ts": "was a guard", "apps/deleted.ts": "gone" } }),
    (p) => contents[p] ?? null,
  );
  assert.deepEqual(result.stale.sort(), ["apps/deleted.ts", "apps/fixed.ts"]);
});

test("an allowlist entry under a historical root is redundant", () => {
  const result = evaluate(
    [],
    registry({ allowed: { "docs/superpowers/x.md": "dup" }, historicalRoots: { "docs/superpowers/": "history" } }),
    () => null,
  );
  assert.deepEqual(result.redundant, ["docs/superpowers/x.md"]);
});

test("binary formats are not scanned; source and config are", () => {
  assert.equal(isScannable("docs/diagram.png"), false);
  assert.equal(isScannable("reference/model.xlsx"), false);
  assert.equal(isScannable(".env.example"), true);
  assert.equal(isScannable("docker-compose.yml"), true);
  assert.equal(isUnderHistoricalRoot("changes/x.json", { "changes/": "r" }), true);
  assert.equal(isUnderHistoricalRoot("changesets/x.json", { "changes/": "r" }), false);
});

test("the committed registry holds the repo exactly: nothing forbidden, nothing stale", () => {
  const reg = loadRegistry(fs.readFileSync(path.join(REPO_ROOT, "scripts", "retired-substrate.json"), "utf-8"));
  assert.ok(reg.entries.length > 0, "registry should declare at least one retired term");
  const files = gitText(["ls-files", "-z"], { trim: false, maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  assert.ok(files.length > 1000, "expected the real tracked tree, not an empty list");
  const read = (p) => {
    try {
      return fs.readFileSync(path.join(REPO_ROOT, p), "utf-8");
    } catch {
      return null;
    }
  };
  const result = evaluate(files, reg, read);
  assert.deepEqual(result.forbidden, [], `retired-substrate mentions: ${JSON.stringify(result.forbidden)}`);
  assert.deepEqual(result.stale, [], `stale allowlist entries: ${JSON.stringify(result.stale)}`);
  assert.deepEqual(result.redundant, []);
});

test("the two pages this gate was built for describe live substrate, not retired services", () => {
  // Regression lock: platform-overview and the DR runbook may reference Neo4j
  // only as history. Neither may present it as something you can operate.
  for (const p of ["docs/architecture/platform-overview.md", "docs/operations/disaster-recovery.md"]) {
    const text = fs.readFileSync(path.join(REPO_ROOT, p), "utf-8");
    assert.doesNotMatch(text, /docker compose up -d[^\n]*\b(neo4j|qdrant)\b/i, `${p} still starts a retired service`);
    assert.doesNotMatch(text, /\brestore-(neo4j|qdrant)\.sh\b(?![^\n]*pre-BET-5)/i, `${p} still restores a retired service`);
  }
});
