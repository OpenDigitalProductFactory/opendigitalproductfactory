#!/usr/bin/env tsx
// scripts/build-kernel-embeddings.ts
// EP-WIKI-001 Phase 5 maintainer script — generates embeddings for every
// wiki page under docs/founder-kernel/wiki/ and writes them to
// docs/founder-kernel/embeddings.jsonl. Updates manifest.json with the
// embedding model and built timestamp.
//
// Run: pnpm --filter web tsx scripts/build-kernel-embeddings.ts
// Or:  tsx scripts/build-kernel-embeddings.ts
//
// Talks to a Docker Model Runner / Ollama-compatible /v1/embeddings
// endpoint. Defaults to the same nomic-embed-text-v1.5 model used by
// the runtime embedding helper at apps/web/lib/inference/embedding.ts.
//
// Sidecar exists so installs don't have to re-embed on first boot —
// seedWikiKernel() loads embeddings.jsonl directly into Qdrant when
// the manifest.embeddingModel matches the deployment's configured
// embedding model. On mismatch, the seed falls back to live embed.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseFrontmatter, deriveSlug } from "../packages/db/src/seed-wiki-kernel";
import type { WikiPageFrontmatter } from "../packages/db/src/seed-wiki-kernel";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KERNEL_DIR = join(REPO_ROOT, "docs", "founder-kernel");
const WIKI_DIR = join(KERNEL_DIR, "wiki");
const SIDECAR_PATH = join(KERNEL_DIR, "embeddings.jsonl");
const MANIFEST_PATH = join(KERNEL_DIR, "manifest.json");

const EMBEDDING_MODEL = process.env["EMBEDDING_MODEL"] ?? "ai/nomic-embed-text-v1.5";
const LLM_BASE_URL =
  process.env["LLM_BASE_URL"] ??
  process.env["OLLAMA_INTERNAL_URL"] ??
  "http://model-runner.docker.internal/v1";
const MAX_INPUT_LENGTH = 8192;

type EmbeddingRecord = {
  slug: string;
  vector: number[];
  model: string;
};

function walkMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
    } else if (st.isFile() && entry.endsWith(".md") && !entry.startsWith("README")) {
      out.push(full);
    }
  }
  return out;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, MAX_INPUT_LENGTH);
  const res = await fetch(`${LLM_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: truncated }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error("No embedding returned from model");
  }
  return embedding;
}

async function main(): Promise<void> {
  const files = walkMarkdownFiles(WIKI_DIR);
  if (files.length === 0) {
    console.log(`[build-kernel-embeddings] no wiki pages under ${WIKI_DIR} — nothing to embed.`);
    return;
  }

  console.log(`[build-kernel-embeddings] embedding ${files.length} pages with ${EMBEDDING_MODEL} via ${LLM_BASE_URL}`);

  const records: EmbeddingRecord[] = [];
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    const slug = frontmatter.slug ?? deriveSlug(file, WIKI_DIR);
    const text = `${frontmatter.title}\n\n${frontmatter.abstract ?? ""}\n\n${body}`;

    process.stdout.write(`  ${slug} … `);
    const vector = await generateEmbedding(text);
    records.push({ slug, vector, model: EMBEDDING_MODEL });
    process.stdout.write(`ok (${vector.length} dims)\n`);
  }

  const sidecar = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(SIDECAR_PATH, sidecar, "utf8");
  console.log(`[build-kernel-embeddings] wrote ${records.length} records to ${SIDECAR_PATH}`);

  // Update manifest with embedding model + built timestamp.
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, unknown>;
  manifest["embeddingModel"] = EMBEDDING_MODEL;
  manifest["builtAt"] = new Date().toISOString();
  manifest["pageCount"] = records.length;
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[build-kernel-embeddings] updated ${MANIFEST_PATH} (embeddingModel=${EMBEDDING_MODEL})`);
}

main().catch((err) => {
  console.error("[build-kernel-embeddings] failed:", err);
  process.exit(1);
});
