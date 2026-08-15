import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

// EP-27FD96BC · P5 (BI-223E55DA) — JIT-retrieval discipline guard.
//
// Operational / system-of-record data — orders, invoices, customer accounts,
// quotes, token-usage and tool-execution ledgers, build activity — is fetched
// LIVE via Prisma at the moment of need. It is NEVER copied into the vector
// store: memorizing live records means a coworker reasons over a stale snapshot
// and the "truth" drifts from the database. Only durable KNOWLEDGE is embedded:
// the WWMD/WWWD decision corpus, uploaded documents, and conversation / platform
// / capability memory.
//
// The audit for this epic confirmed the discipline is currently intact — no
// operational table is embedded. This guard FREEZES that: `generateEmbedding` is
// the single embedding choke point (every storeWikiPage / storeConversationMemory
// / document-embed path calls it), so freezing the set of modules allowed to call
// it means any NEW caller trips this test and forces a reviewer to confirm the new
// source is knowledge, not a live operational record, before adding it below.

const ALLOWED_EMBEDDING_CALLERS: ReadonlySet<string> = new Set([
  // The embedding backend itself.
  "apps/web/lib/inference/embedding.ts",
  // Health probe — embeds a fixed diagnostic string, no record.
  "apps/web/app/api/diagnostics/preflight/route.ts",
  // Durable KNOWLEDGE sources:
  "apps/web/lib/inference/semantic-memory.ts", // conversation / platform / capability memory
  "apps/web/lib/documents/embeddings.ts", // uploaded documents
  "apps/web/lib/wiki/embeddings.ts", // WWMD/WWWD corpus pages
  "apps/web/lib/wiki/embed-published-overlay.ts", // BI-D4C1E05E: the shared publish-path embed seam — embeds published wiki-overlay KNOWLEDGE pages (stances/overlays) via storeWikiPage, never an operational record
  "apps/web/lib/wiki/lint.ts", // corpus dedup similarity
  "apps/web/lib/wiki/principle-similarity.ts", // principle-vector similarity
  "apps/web/lib/mcp/packs/principle-decide-pack.ts", // principle-direction + semantic-decision knowledge
  "apps/web/lib/decision/evidence-grounding.ts", // embeds the option DESCRIPTION (transient decision input) for principle_decide's semantic fallback — same purpose as the pack entry, extracted here for module size; embeds no operational record (EP-VERIFICATION-INTEGRITY)
  "apps/web/lib/decision-perspective/stance-relevance.ts", // embeds the decision QUESTION (transient input) + WWWD stance SUMMARIES (durable knowledge corpus) to score question↔stance relevance for the org business-decision gate; nothing is persisted to the vector store, no operational record (BI-7E1F128A)
]);

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

/** Every non-test .ts under apps/web that references generateEmbedding, repo-relative. */
function embeddingCallers(root: string): string[] {
  const out = execFileSync(
    "git",
    ["grep", "-l", "generateEmbedding", "--", "apps/web/**/*.ts", ":!*.test.ts"],
    { cwd: root, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("JIT-retrieval discipline", () => {
  it("only knowledge modules embed into the vector store — operational records stay live", () => {
    const root = repoRoot();
    const callers = embeddingCallers(root);

    // Every allow-listed caller must still exist (keeps the list from rotting).
    const missing = [...ALLOWED_EMBEDDING_CALLERS].filter((c) => !callers.includes(c));
    expect(missing, `Allow-listed embedding caller(s) no longer call generateEmbedding — prune the list: ${missing.join(", ")}`).toEqual([]);

    // No NEW caller may embed without review.
    const unexpected = callers.filter((c) => !ALLOWED_EMBEDDING_CALLERS.has(c));
    expect(
      unexpected,
      `New generateEmbedding caller(s) detected. JIT-retrieval discipline: confirm each embeds durable KNOWLEDGE (corpus / document / memory), NOT a live operational record (order, invoice, ledger, tool execution), then add it to ALLOWED_EMBEDDING_CALLERS: ${unexpected.join(", ")}`,
    ).toEqual([]);
  });
});
