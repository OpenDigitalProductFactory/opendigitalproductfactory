/**
 * Voice Input Slice 2 — server-side vocabulary bias builder.
 *
 * Spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.7, §8 Slice 2
 * Plan: docs/superpowers/plans/2026-05-17-voice-input-slice-2-cleanup-and-bias.md
 *
 * Builds a `BiasClassificationToken[]` to seed Whisper's `initial_prompt`,
 * pulling from Org name + brand voice + recent published wiki page titles
 * + recent thread message identifier tokens. Each token is classified so
 * the existing Slice 1 `classifyBiasPrompt` gate redacts off-org-unsafe
 * tokens automatically — this builder does NOT enforce gating, it only
 * labels.
 *
 * Pure server-only. Reads from Prisma. Never trust client-supplied org id;
 * the caller passes the org id resolved from the auth session.
 */

import { prisma } from "@dpf/db";

import type {
  BiasClassificationToken,
  BiasTokenClassification,
} from "./bias-classification-gate";

export interface VocabularyBiasArgs {
  /** Org id resolved server-side from the auth session. */
  organizationId?: string;
  /** Active thread for the `coworker_panel` context; null for other contexts. */
  threadId?: string;
  /** Max wiki page titles to mine. Default 20. */
  wikiLimit?: number;
  /** Max recent thread messages to mine. Default 10. */
  threadMessageLimit?: number;
  /** Hard cap on returned token count (Whisper initial_prompt budget). */
  totalTokenCap?: number;
}

/** Classification severity ordering — higher is more sensitive. */
const CLASSIFICATION_RANK: Record<BiasTokenClassification, number> = {
  public: 0,
  "internal-low": 1,
  "internal-high": 2,
  confidential: 3,
  restricted: 4,
  unclassified: 5,
};

const DEFAULT_WIKI_LIMIT = 20;
const DEFAULT_THREAD_MESSAGE_LIMIT = 10;
const DEFAULT_TOTAL_TOKEN_CAP = 200;
const MIN_TOKEN_LENGTH = 3;

/**
 * Stopwords that the title-token miner skips. Whisper's `initial_prompt` is a
 * vocabulary hint — feeding it common words wastes the budget and can even
 * degrade quality by biasing toward unnatural phrasing.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "their",
  "have",
  "what",
  "when",
  "where",
  "which",
  "while",
  "about",
  "after",
  "before",
  "again",
  "page",
  "guide",
  "intro",
  "introduction",
  "overview",
  "summary",
  "doc",
  "docs",
  "note",
  "notes",
  "post",
  "article",
  "wiki",
  "home",
  "index",
]);

/**
 * Identifier-shape regex — catches the kinds of tokens worth biasing on:
 * - CamelCase / PascalCase identifiers (BuildStudio, BackupRun)
 * - SCREAMING_SNAKE_CASE constants (POSTGRES_DB)
 * - acronyms ≥3 chars (all-caps with optional digits)
 *
 * Crucially does NOT match sentence-start words like "Let", "Send", "Make"
 * (single-capital then all-lowercase), which the regex prior to this version
 * leaked. We require AT LEAST ONE of: an internal uppercase letter (CamelCase
 * distinguishing), a digit, or an underscore. That admits BuildStudio,
 * BackupRun, V2, POSTGRES_DB while rejecting Plain.
 *
 * Plain English first-word title-case is filtered downstream by the
 * stopword list in tokenizeTitle.
 */
const IDENTIFIER_RE =
  /\b[A-Z][a-z0-9]*(?:[A-Z][a-zA-Z0-9]*|[0-9]+[a-zA-Z0-9]*)+\b|\b[A-Z]{2,}(?:[A-Z0-9_]+)?\b/g;

/** Split a title into title-cased words ≥ MIN_TOKEN_LENGTH, minus stopwords. */
function tokenizeTitle(title: string): string[] {
  const cleaned = title.replace(/[^\w\s'-]/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(
      (w) =>
        w.length >= MIN_TOKEN_LENGTH &&
        !STOPWORDS.has(w.toLowerCase()) &&
        /[A-Z]/.test(w[0] ?? ""), // proper noun heuristic
    );
}

/**
 * Extract identifier-shape tokens from free-form text (thread message content).
 * Returns unique tokens. Conservative on length to avoid mid-sentence noise.
 */
function extractIdentifiers(text: string): string[] {
  const matches = text.match(IDENTIFIER_RE) ?? [];
  return Array.from(new Set(matches)).filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

/**
 * Dedupe + classification escalation: when a token appears in multiple
 * sources with different classifications, the highest-severity one wins.
 * Per `BiasClassificationToken` contract, classification informs the gate's
 * decision to strip on off-org dispatch — be conservative.
 */
function mergeTokens(tokens: BiasClassificationToken[]): BiasClassificationToken[] {
  const merged = new Map<string, BiasClassificationToken>();
  for (const t of tokens) {
    const existing = merged.get(t.text);
    if (!existing) {
      merged.set(t.text, t);
      continue;
    }
    const winnerRank = CLASSIFICATION_RANK[t.classification];
    const existingRank = CLASSIFICATION_RANK[existing.classification];
    if (winnerRank > existingRank) {
      merged.set(t.text, t);
    }
  }
  return Array.from(merged.values());
}

/**
 * Build a vocabulary bias for transcription. Returns an empty array (not
 * null) when there's nothing useful — the caller can pass [] to transcribe()
 * which then routes through the Slice 1 gate as `classification: "empty"`.
 */
export async function buildVocabularyBias(
  args: VocabularyBiasArgs,
): Promise<BiasClassificationToken[]> {
  const wikiLimit = args.wikiLimit ?? DEFAULT_WIKI_LIMIT;
  const threadMessageLimit = args.threadMessageLimit ?? DEFAULT_THREAD_MESSAGE_LIMIT;
  const totalTokenCap = args.totalTokenCap ?? DEFAULT_TOTAL_TOKEN_CAP;

  const tokens: BiasClassificationToken[] = [];

  // ── 1. Organization.name and label — public ───────────────────────────────
  if (args.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: args.organizationId },
      select: { name: true, legalName: true, brandingConfig: { select: { label: true } } },
    });
    if (org?.name) {
      // The org's own brand name is public knowledge by definition.
      tokens.push({ text: org.name, classification: "public" });
    }
    if (org?.legalName && org.legalName !== org.name) {
      tokens.push({ text: org.legalName, classification: "public" });
    }
    if (org?.brandingConfig?.label && org.brandingConfig.label !== org.name) {
      tokens.push({
        text: org.brandingConfig.label,
        classification: "public",
      });
    }
  }

  // ── 2. Recent published wiki page titles — internal-low ───────────────────
  if (args.organizationId) {
    const pages = await prisma.wikiPage.findMany({
      where: {
        organizationId: args.organizationId,
        status: "published",
      },
      orderBy: { updatedAt: "desc" },
      take: wikiLimit,
      select: { title: true },
    });
    for (const page of pages) {
      for (const token of tokenizeTitle(page.title)) {
        tokens.push({ text: token, classification: "internal-low" });
      }
    }
  }

  // ── 3. Recent thread message identifier tokens — internal-high ────────────
  // Identifier-shape tokens in recent AgentMessage.content can include
  // proprietary names ("BuildStudio", "BackupRun", project codenames). Mark
  // them internal-high so the Slice 1 gate strips them on off-org dispatch.
  if (args.threadId) {
    const messages = await prisma.agentMessage.findMany({
      where: { threadId: args.threadId },
      orderBy: { createdAt: "desc" },
      take: threadMessageLimit,
      select: { content: true },
    });
    for (const message of messages) {
      for (const id of extractIdentifiers(message.content)) {
        tokens.push({ text: id, classification: "internal-high" });
      }
    }
  }

  const merged = mergeTokens(tokens);

  // Cap to the total budget — Whisper `initial_prompt` is bounded and
  // over-long prompts hurt latency more than they help. Prefer keeping
  // higher-classification (more specific) tokens since they're more likely
  // to be domain-specific identifiers the STT model wouldn't otherwise know.
  if (merged.length <= totalTokenCap) return merged;
  return merged
    .slice()
    .sort(
      (a, b) =>
        CLASSIFICATION_RANK[b.classification] -
        CLASSIFICATION_RANK[a.classification],
    )
    .slice(0, totalTokenCap);
}

// Exports for testing only — not part of the public API.
export const __test__ = {
  tokenizeTitle,
  extractIdentifiers,
  mergeTokens,
};
