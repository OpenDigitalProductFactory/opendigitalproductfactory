import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  baselineKey,
  computeFindings,
  findRetiredMentions,
  loadRegistry,
  parseBaseline,
  serializeBaseline,
} from "./check-retired-substrate.mjs";
import { publishedDocFiles } from "./lib/published-doc-roots.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = [
  { term: "neo4j", retiredBy: "BET-5", replacement: "the Postgres graph mirror" },
  { term: "qdrant", retiredBy: "BET-5", replacement: "pgvector" },
];

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

test("stays silent on a clean document", () => {
  assert.deepEqual(findRetiredMentions("All state lives in PostgreSQL.\n", ENTRIES), []);
});

test("loadRegistry rejects an entry with no term rather than silently skipping it", () => {
  assert.throws(() => loadRegistry({ retired: [{ retiredBy: "x" }] }), /missing a "term"/);
  assert.deepEqual(loadRegistry({ retired: [] }), []);
});

test("baseline round-trips and tolerates space-separated legacy lines", () => {
  const keys = new Set([baselineKey("docs/a.md", "neo4j"), baselineKey("docs/b.md", "qdrant")]);
  assert.deepEqual(parseBaseline(serializeBaseline(keys)), keys);
  // Comments and blank lines are ignored; spaces normalize to the tab form.
  assert.deepEqual(
    parseBaseline("# header\n\ndocs/a.md   neo4j\n"),
    new Set([baselineKey("docs/a.md", "neo4j")]),
  );
});

test("computeFindings pairs every doc with every term it mentions", () => {
  const docs = ["docs/one.md", "docs/two.md", "docs/clean.md"];
  const contents = {
    "docs/one.md": "neo4j and qdrant\n",
    "docs/two.md": "just qdrant\n",
    "docs/clean.md": "postgres only\n",
  };
  const findings = computeFindings(docs, ENTRIES, (p) => contents[p]);
  assert.deepEqual(
    findings.map((f) => baselineKey(f.docPath, f.term)).sort(),
    [
      baselineKey("docs/one.md", "neo4j"),
      baselineKey("docs/one.md", "qdrant"),
      baselineKey("docs/two.md", "qdrant"),
    ].sort(),
  );
});

test("the committed baseline covers every current mention, so the gate is green", () => {
  const entries = loadRegistry(fs.readFileSync(path.join(REPO_ROOT, "scripts", "retired-substrate.json"), "utf-8"));
  assert.ok(entries.length > 0, "registry should declare at least one retired term");

  const baseline = parseBaseline(
    fs.readFileSync(path.join(REPO_ROOT, "scripts", "retired-substrate-baseline.txt"), "utf-8"),
  );
  // Reuse the real corpus so this test fails if a page regresses.
  const docs = publishedDocFiles(REPO_ROOT);
  assert.ok(docs.length > 100, "expected the real published corpus, not an empty list");

  const findings = computeFindings(docs, entries, (p) => fs.readFileSync(path.join(REPO_ROOT, p), "utf-8"));
  assert.ok(findings.length > 0, "expected the grandfathered mentions to still be found");

  const netNew = findings.filter((f) => !baseline.has(baselineKey(f.docPath, f.term)));
  assert.deepEqual(netNew, [], `net-new retired-substrate mentions: ${JSON.stringify(netNew)}`);
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
