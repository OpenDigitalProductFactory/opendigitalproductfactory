// apps/web/lib/actions/hive-scout/ingest-500-agents.ts
//
// Hive Scout — periodic ingestion of the MIT-licensed 500-AI-Agents-Projects
// catalog into DPF as archetype-suggestion BacklogItems.
//
// Contract:
// - Read-only scouting. No repo is forked, cloned, or vendored.
// - Re-parses the live upstream README on every run (no hardcoded catalog).
// - Idempotent: re-runs never create duplicate BacklogItems. Dedupe key is
//   a stable hash of the source URL encoded into BacklogItem.itemId.
// - Canonical enums (see CLAUDE.md): type "portfolio", status "open"|"deferred".

import { createHash } from "crypto";
import { prisma } from "@dpf/db";
import { loadPrompt } from "@/lib/tak/prompt-loader";
import { sendQueueNotification } from "@/lib/queue/notification-adapter";

// ─── Constants ──────────────────────────────────────────────────────────────

const CATALOG_NAME = "500-AI-Agents-Projects";
const CATALOG_LICENSE = "MIT";
const CATALOG_README_URL =
  "https://raw.githubusercontent.com/ashishpatel26/500-AI-Agents-Projects/main/README.md";
const BACKLOG_SOURCE = "hive-scout";
const ITEM_ID_PREFIX = "HS";
// Backlog-item body template (not a coworker persona). Lives under
// prompts/templates/ to keep prompts/specialist/ scoped to actual specialists.
const PROMPT_CATEGORY = "templates";
const PROMPT_SLUG = "hive-scout-archetype-gap";
const DEEP_LINK = "/portfolio/backlog?source=hive-scout";

// A starter mapping from catalog-industry labels to IT4IT value-stream names
// as seeded into `EaReferenceModelElement` (kind="value_stream"). Entries are
// only included when the industry clearly aligns with an IT4IT stream. Any
// industry not found here is filed as status="deferred" with
// VALUE_STREAM_CONFIDENCE="needs-mapping" so a human completes the mapping
// before the item is prioritised — per the spec's ambiguity rule.
const INDUSTRY_TO_VALUE_STREAM: Record<string, string> = {
  "devops": "Operate",
  "it operations": "Operate",
  "sre": "Operate",
  "site reliability": "Operate",
  "cybersecurity": "Operate",
  "security": "Operate",
  "monitoring": "Operate",
  "observability": "Operate",
  "developer tools": "Integrate",
  "development": "Integrate",
  "software engineering": "Integrate",
  "coding": "Integrate",
  "data engineering": "Integrate",
  "qa": "Integrate",
  "testing": "Integrate",
  "research": "Evaluate",
  "portfolio": "Evaluate",
  "strategy": "Evaluate",
  "product management": "Evaluate",
  "product": "Evaluate",
  "discovery": "Explore",
  "ideation": "Explore",
  "ai integration": "Explore",
  "knowledge management": "Explore",
  "deployment": "Deploy",
  "infrastructure": "Deploy",
  "release management": "Release",
  "devrel": "Release",
  "documentation": "Release",
  "customer service": "Consume",
  "customer support": "Consume",
  "support": "Consume",
  "marketing": "Consume",
  "sales": "Consume",
  "e-commerce": "Consume",
  "retail": "Consume",
};

// ─── Types ──────────────────────────────────────────────────────────────────

export type Framework = "crewai" | "autogen" | "agno" | "langgraph";

export interface CatalogEntry {
  name: string;
  industry: string;
  description: string;
  sourceUrl: string;
  framework?: Framework;
}

export interface ValueStreamMatch {
  stream: string | null;
  confidence: "mapped" | "needs-mapping";
}

export interface IngestResult {
  catalogEntries: number;
  gaps: number;
  created: number;
  duplicates: number;
  deferred: number;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Strip leading emoji / punctuation / markdown-bold wrappers from a table cell.
 * The upstream README prefixes many cells with emoji (e.g. "🗣️ Communication").
 */
function cleanCell(raw: string): string {
  return raw
    .trim()
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^\*|\*$/g, "")
    .replace(/^[^\w(]+/, "") // drop leading emoji / symbol runs
    .trim();
}

/**
 * Extract the first http(s) URL from a cell (cells contain badge images
 * followed by the real link in markdown: [![badge](img)](URL)).
 */
function firstUrl(cell: string): string | null {
  // Look for the closing paren of the outer link: `](URL)` at end of cell
  const matches = cell.match(/\(https?:\/\/[^\s)]+\)/g);
  if (!matches || matches.length === 0) return null;
  // The last match is the outer link's target (innermost is the badge image)
  const last = matches[matches.length - 1];
  return last.slice(1, -1);
}

/**
 * Parse a single markdown table into rows of 4 string cells.
 * Returns rows in the order they appear; skips header and separator.
 */
function parseMarkdownTable(block: string): string[][] {
  const lines = block.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 3) return []; // need header + separator + at least one row

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    // Separator rows look like "| --- | --- | ... |" — skip just in case they
    // appear mid-table (rare but possible)
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 4) rows.push(cells);
  }
  return rows;
}

/**
 * Extract a contiguous block of markdown-table lines starting at `startIdx`.
 * Returns the block as a single string and the index after the block ends.
 */
function extractTable(lines: string[], startIdx: number): { block: string; next: number } {
  let i = startIdx;
  const blockLines: string[] = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    blockLines.push(lines[i]);
    i++;
  }
  return { block: blockLines.join("\n"), next: i };
}

/**
 * Parse the upstream README markdown into catalog entries.
 * Recognises the main "Use Case Table" and each framework sub-table.
 *
 * Throws if no entries are found — upstream format drift should fail loud
 * rather than silently return empty results.
 */
export function parseReadme(markdown: string): CatalogEntry[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries: CatalogEntry[] = [];
  let currentFramework: Framework | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track framework section headings like:
    //   ### **Framework Name**: **CrewAI**
    const fwMatch = line.match(/Framework Name[^*]*\*\*:\s*\*\*([A-Za-z]+)/);
    if (fwMatch) {
      const raw = fwMatch[1].toLowerCase();
      if (raw === "crewai") currentFramework = "crewai";
      else if (raw === "autogen") currentFramework = "autogen";
      else if (raw === "agno") currentFramework = "agno";
      else if (raw === "langgraph") currentFramework = "langgraph";
      else currentFramework = undefined;
      continue;
    }

    // When we hit a table row, slurp the whole contiguous block
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().startsWith("|")) {
      const { block, next } = extractTable(lines, i);
      for (const row of parseMarkdownTable(block)) {
        const [nameCell, industryCell, descCell, linkCell] = row;
        const url = firstUrl(linkCell);
        if (!url) continue;
        const name = cleanCell(nameCell);
        const industry = cleanCell(industryCell);
        const description = cleanCell(descCell);
        if (!name || !industry || !description) continue;

        entries.push({
          name,
          industry,
          description,
          sourceUrl: url,
          ...(currentFramework ? { framework: currentFramework } : {}),
        });
      }
      i = next - 1;
    }
  }

  if (entries.length === 0) {
    throw new Error(
      "Hive Scout parser produced zero catalog entries — upstream README format may have changed. " +
        "Refusing to write partial results.",
    );
  }

  return entries;
}

// ─── Value-stream mapping ───────────────────────────────────────────────────

/**
 * Map a catalog-industry label to a seeded IT4IT value-stream name.
 * Returns `confidence: "mapped"` when a starter-mapping entry exists AND the
 * stream is present in the seeded `EaReferenceModelElement` catalog.
 * Otherwise `confidence: "needs-mapping"`, which forces the BacklogItem into
 * the `deferred` status for human review.
 */
export function mapIndustryToStream(
  industry: string,
  seededStreamNames: Set<string>,
): ValueStreamMatch {
  const candidate = INDUSTRY_TO_VALUE_STREAM[industry.trim().toLowerCase()];
  if (!candidate) return { stream: null, confidence: "needs-mapping" };
  if (!seededStreamNames.has(candidate)) {
    // Mapping exists in code but the stream isn't in the DB yet — treat as
    // needs-mapping rather than silently linking to a nonexistent stream.
    return { stream: null, confidence: "needs-mapping" };
  }
  return { stream: candidate, confidence: "mapped" };
}

// ─── Dedupe / idempotency ───────────────────────────────────────────────────

/**
 * Deterministic BacklogItem.itemId derived from the source URL.
 * 16 hex chars of SHA-256 keeps collisions astronomically unlikely across the
 * ~500 entries while staying short enough to read in the UI.
 */
export function itemIdForSource(sourceUrl: string): string {
  const digest = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
  return `${ITEM_ID_PREFIX}-${digest.toUpperCase()}`;
}

// ─── Gap detection ──────────────────────────────────────────────────────────

function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when no existing skill or coworker archetype plausibly covers
 * the catalog entry. Matching is deliberately conservative — we'd rather file
 * a duplicate-looking suggestion than silently discard a real gap; humans
 * can reject it in one click.
 */
function isGap(
  entry: CatalogEntry,
  existingSkillNames: string[],
  existingCoworkerNames: string[],
): boolean {
  const needle = normaliseForMatch(entry.name);
  if (!needle) return false;

  const tokens = needle.split(" ").filter((t) => t.length >= 4);
  if (tokens.length === 0) return true;

  const haystacks = [...existingSkillNames, ...existingCoworkerNames].map(normaliseForMatch);

  // A skill/coworker "covers" the entry if any single long token from the
  // entry name appears verbatim in its name. This is coarse but prevents the
  // trivial "Trading Bot"/"Trading" collisions while letting genuinely new
  // archetypes through.
  return !haystacks.some((h) => tokens.some((t) => h.includes(t)));
}

// ─── Description rendering ──────────────────────────────────────────────────

const FALLBACK_BODY_TEMPLATE = `**Use case:** {{NAME}}

**Industry (as labelled upstream):** {{INDUSTRY}}

**Upstream description:** {{DESCRIPTION}}

**Source:** {{SOURCE_URL}}
**Catalog:** {{CATALOG_NAME}} ({{CATALOG_LICENSE}})
**Framework (if any):** {{FRAMEWORK}}

**Candidate IT4IT value stream:** {{VALUE_STREAM}} ({{VALUE_STREAM_CONFIDENCE}})

---

Reference only — not vendored. The linked repository is MIT-licensed
inspiration for a DPF-native archetype; we do not import its code.`;

function renderBody(
  template: string,
  entry: CatalogEntry,
  match: ValueStreamMatch,
): string {
  const substitutions: Record<string, string> = {
    NAME: entry.name,
    INDUSTRY: entry.industry,
    DESCRIPTION: entry.description,
    SOURCE_URL: entry.sourceUrl,
    VALUE_STREAM: match.stream ?? "(none)",
    VALUE_STREAM_CONFIDENCE: match.confidence,
    FRAMEWORK: entry.framework ?? "(none)",
    CATALOG_NAME,
    CATALOG_LICENSE,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    substitutions[key] ?? `{{${key}}}`,
  );
}

// ─── Main entry point ───────────────────────────────────────────────────────

export interface IngestOptions {
  /** Override the upstream URL (used in tests). */
  readmeUrl?: string;
  /** Override the fetcher (used in tests). */
  fetcher?: (url: string) => Promise<string>;
}

async function defaultFetcher(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "dpf-hive-scout/1.0" } });
  if (!res.ok) {
    throw new Error(`Hive Scout: upstream fetch failed (${res.status} ${res.statusText})`);
  }
  return res.text();
}

export async function runHiveScoutIngest(
  options: IngestOptions = {},
): Promise<IngestResult> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const url = options.readmeUrl ?? CATALOG_README_URL;

  const markdown = await fetcher(url);
  const entries = parseReadme(markdown);

  const [seededStreams, existingSkills, agentRows] = await Promise.all([
    prisma.eaReferenceModelElement.findMany({
      where: { kind: "value_stream" },
      select: { name: true },
    }),
    prisma.skillDefinition.findMany({ select: { name: true } }),
    prisma.agent.findMany({
      where: { archived: false },
      select: { name: true },
    }),
  ]);

  const streamNames = new Set(seededStreams.map((s: { name: string }) => s.name));
  const skillNames = existingSkills.map((s: { name: string }) => s.name);
  const coworkerNames = agentRows.map((a: { name: string }) => a.name);

  const bodyTemplate = await loadPrompt(
    PROMPT_CATEGORY,
    PROMPT_SLUG,
    FALLBACK_BODY_TEMPLATE,
  );

  let gaps = 0;
  let created = 0;
  let duplicates = 0;
  let deferred = 0;

  for (const entry of entries) {
    if (!isGap(entry, skillNames, coworkerNames)) continue;
    gaps++;

    const itemId = itemIdForSource(entry.sourceUrl);
    const existing = await prisma.backlogItem.findUnique({ where: { itemId } });
    if (existing) {
      duplicates++;
      continue;
    }

    const match = mapIndustryToStream(entry.industry, streamNames);
    const status = match.confidence === "mapped" ? "open" : "deferred";
    if (status === "deferred") deferred++;

    await prisma.backlogItem.create({
      data: {
        itemId,
        title: `Coworker archetype: ${entry.name} (${entry.industry})`,
        type: "portfolio",
        status,
        body: renderBody(bodyTemplate, entry, match),
        source: BACKLOG_SOURCE,
      },
    });
    created++;
  }

  await notifyAdmins(created);

  return {
    catalogEntries: entries.length,
    gaps,
    created,
    duplicates,
    deferred,
  };
}

async function notifyAdmins(created: number): Promise<void> {
  if (created === 0) return;
  const admins = await prisma.user.findMany({
    where: { isSuperuser: true, isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;

  await Promise.all(
    admins.map((admin: { id: string }) =>
      sendQueueNotification({
        recipientUserId: admin.id,
        workItemId: `hive-scout-${Date.now()}`,
        title: "Hive Scout — new archetype suggestions",
        body: `${created} new archetype suggestions from external catalogs.`,
        urgency: "low",
        deepLink: DEEP_LINK,
      }),
    ),
  );
}
