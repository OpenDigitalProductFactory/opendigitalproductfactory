// EP-WIKI-001 Phase 2.2: LLM proposal pipeline (three-pass extraction).
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 2.2)
//
// Pure engine — no inference provider, no DB, no MCP wiring. Callers pass
// in an `InferenceCallable` so the engine can be exercised under test with
// stubs and in production with `routeAndCall` / `utilityInfer`. The thin
// production adapter and CLI / MCP integration land in Phase 2.3.
//
// Three passes, in order:
//
//   1. ABSTRACT (utility tier)
//      One-paragraph summary of the source. Persisted on the RawSource
//      row by Phase 2.1's `ingestRawSourceFromFile`; the proposal pipeline
//      regenerates it if blank so the LLM has a compact handle on the
//      source in passes 2 and 3.
//
//   2. CLAIM EXTRACTION (reasoning tier, schema-grounded)
//      For each substantive factual claim in the source, the LLM returns
//      a structured row pointing at an existing wiki page (or proposing a
//      new one). Outputs include a supporting excerpt so the human
//      reviewer can verify the claim against the source.
//
//   3. STANCE / HEURISTIC EXTRACTION (reasoning tier, judgment kernel)
//      Separate pass with a different prompt. The LLM identifies positions
//      ("X is better than Y"), tradeoffs, and rules of thumb the author
//      formalises. These become `stance` and `heuristic` pages — the
//      "what would Mark do?" surface that summary-only pages defeat.
//
// Parsing is robust: the engine accepts JSON in code fences, surrounding
// prose, or trailing commentary — anything an LLM might produce. It does
// NOT silently drop malformed rows; partial parses surface as a typed
// `parseErrors` array on the result so reviewers see what was rejected.

import {
  SCHEMA_PROMPT_PREAMBLE,
  formatExistingSlugsForPrompt,
  type ExistingSlugSnapshot,
} from "./schema-context";

// Re-export so downstream consumers (proposal.test, Phase 2.3 commit step)
// can import the snapshot type alongside the proposal types from one module.
export type { ExistingSlugSnapshot } from "./schema-context";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Page kinds the proposal pipeline is allowed to target. */
export const PROPOSABLE_KINDS = [
  "entity",
  "stance",
  "heuristic",
  "principle",
  "summary",
  "decision",
  "runbook",
] as const;
export type ProposableKind = (typeof PROPOSABLE_KINDS)[number];

/** A single claim-extraction row from Pass 2. */
export type ClaimProposal = {
  /** The factual claim in the author's voice, distilled to one sentence. */
  claim: string;
  /** Slug being targeted. Resolves to an existing page, or is a new-page proposal. */
  targetSlug: string;
  /** Kind of the target. */
  pageKind: ProposableKind;
  /**
   * True when the target slug does not currently exist and the LLM is
   * proposing a new page. Validated against `existingSlugs.all` at parse
   * time — if a model returns `propose_new: false` for a slug we don't
   * know about, the parser corrects it to `true` and adds a parseError so
   * reviewers see the mismatch.
   */
  proposeNew: boolean;
  /** Author's confidence, normalised to [0,1]. */
  confidence: number;
  /** Verbatim excerpt from the source supporting the claim. */
  supportingExcerpt: string;
  /** Free-form rationale, optional. */
  rationale?: string;
};

/** A stance-extraction row from Pass 3. */
export type StanceProposal = {
  /** One-sentence statement of the position ("X is better than Y because Z"). */
  statement: string;
  /** Proposed slug for the stance page. Always under `stances/`. */
  targetSlug: string;
  /** True when proposing a new stance page; false when extending an existing one. */
  proposeNew: boolean;
  /** Verbatim excerpt from the source where the position is articulated. */
  supportingExcerpt: string;
};

/** A heuristic-extraction row from Pass 3. */
export type HeuristicProposal = {
  /** The rule of thumb in "when X, do Y" form. */
  rule: string;
  /** Proposed slug for the heuristic page. Always under `heuristics/`. */
  targetSlug: string;
  proposeNew: boolean;
  supportingExcerpt: string;
};

export type WikiDiffProposal = {
  abstract: string;
  claims: ClaimProposal[];
  stances: StanceProposal[];
  heuristics: HeuristicProposal[];
  /** Non-fatal parse issues from passes 2 and 3. Empty when everything parsed cleanly. */
  parseErrors: string[];
};

/** Source material handed to the proposal pipeline. */
export type ProposalSource = {
  /** Stable key from RawSource.sourceKey. */
  sourceKey: string;
  title: string;
  /** Full body text the LLM extracts against. */
  body: string;
  /** Existing abstract if one is already on the RawSource row; the engine reuses it. */
  abstract?: string | null;
};

/** Per-tier inference hint passed through to the adapter. */
export type InferenceTier = "utility" | "reasoning";

/** What the engine asks the production adapter (or test stub) to do. */
export type InferenceRequest = {
  tier: InferenceTier;
  systemPrompt: string;
  userPrompt: string;
};

export type InferenceCallable = (
  request: InferenceRequest,
) => Promise<string>;

// ─── Prompt builders ────────────────────────────────────────────────────────

const MAX_BODY_CHARS = 12_000;

function clampBody(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body;
  return `${body.slice(0, MAX_BODY_CHARS)}\n\n[…truncated for prompt; full text in RawSource.fullTextPath…]`;
}

/**
 * Build the user prompt for pass 1 (abstract). The system prompt is the
 * static utility-tier abstract instruction; this just hands the source
 * body to the model.
 */
export function buildAbstractPrompt(source: ProposalSource): InferenceRequest {
  return {
    tier: "utility",
    systemPrompt:
      "Write a one-paragraph abstract (2–4 sentences, under 80 words) capturing the source's central claim and why it matters. Output only the abstract — no preamble, no markdown headers.",
    userPrompt: `Title: ${source.title}\n\nBody:\n${clampBody(source.body)}`,
  };
}

/**
 * Build the system + user prompt for pass 2 (claim extraction). The LLM
 * is shown the schema preamble, the existing slug snapshot, and the
 * source. Output contract: a single JSON object with a `claims: [...]`
 * array.
 */
export function buildClaimsPrompt(
  source: ProposalSource,
  snapshot: ExistingSlugSnapshot,
): InferenceRequest {
  const systemPrompt = `${SCHEMA_PROMPT_PREAMBLE}

You are running PASS 2 of three: CLAIM EXTRACTION. Identify factual claims the source makes; map each to one wiki page (existing or new); emit a JSON object with a "claims" array.

OUTPUT SHAPE (strict JSON, no prose around it):
{
  "claims": [
    {
      "claim": "<single-sentence factual claim>",
      "target_slug": "<kind>/<slug>",
      "page_kind": "entity|stance|heuristic|principle|summary|decision|runbook",
      "propose_new": true|false,
      "confidence": 0.0..1.0,
      "supporting_excerpt": "<verbatim quote from source>",
      "rationale": "<optional, one short sentence>"
    }
  ]
}

RULES:
- Every target_slug must match the kind/slug shape (e.g. "entities/digital-product").
- If the slug appears in EXISTING SLUGS below, set propose_new=false. Otherwise propose_new=true.
- supporting_excerpt MUST appear verbatim in the source body. Do not paraphrase.
- Skip claims the source does not actually make. Better to emit fewer high-confidence rows than many low-confidence ones.
- Maximum 20 claims per pass. Pick the most substantive.`;

  const userPrompt = `EXISTING SLUGS:

${formatExistingSlugsForPrompt(snapshot)}

SOURCE TITLE: ${source.title}
SOURCE ABSTRACT: ${source.abstract ?? "(none yet)"}

SOURCE BODY:
${clampBody(source.body)}`;

  return { tier: "reasoning", systemPrompt, userPrompt };
}

/**
 * Build the system + user prompt for pass 3 (stance + heuristic extraction).
 * Output contract: a single JSON object with `stances` and `heuristics`
 * arrays. The "what would Mark do?" surface — never bury these in summary
 * pages.
 */
export function buildStanceHeuristicsPrompt(
  source: ProposalSource,
  snapshot: ExistingSlugSnapshot,
): InferenceRequest {
  const systemPrompt = `${SCHEMA_PROMPT_PREAMBLE}

You are running PASS 3 of three: STANCE + HEURISTIC EXTRACTION. This is the "what would the author do?" surface. Look for positions the author takes, tradeoffs they call out, and rules of thumb they formalise. These NEVER belong inside a summary page.

OUTPUT SHAPE (strict JSON, no prose around it):
{
  "stances": [
    {
      "statement": "<one-sentence position, 'X is better than Y because Z'>",
      "target_slug": "stances/<slug>",
      "propose_new": true|false,
      "supporting_excerpt": "<verbatim quote from source>"
    }
  ],
  "heuristics": [
    {
      "rule": "<rule of thumb, 'when X, do Y'>",
      "target_slug": "heuristics/<slug>",
      "propose_new": true|false,
      "supporting_excerpt": "<verbatim quote from source>"
    }
  ]
}

RULES:
- Stances are positions; heuristics are actions. If you can't word it as "when X, do Y", it is a stance.
- Slugs MUST start with stances/ or heuristics/ respectively.
- Excerpts must be verbatim.
- Skip restatements of common knowledge. Capture only what the author distinctively takes a position on.
- Maximum 12 total rows across both arrays. Quality over quantity.`;

  const userPrompt = `EXISTING STANCES:
${
    snapshot.byKind.stance.length === 0
      ? "(none yet)"
      : snapshot.byKind.stance.map((s) => `  - ${s}`).join("\n")
  }

EXISTING HEURISTICS:
${
    snapshot.byKind.heuristic.length === 0
      ? "(none yet)"
      : snapshot.byKind.heuristic.map((s) => `  - ${s}`).join("\n")
  }

SOURCE TITLE: ${source.title}
SOURCE ABSTRACT: ${source.abstract ?? "(none yet)"}

SOURCE BODY:
${clampBody(source.body)}`;

  return { tier: "reasoning", systemPrompt, userPrompt };
}

// ─── Response parsers ───────────────────────────────────────────────────────

/**
 * Pull the JSON object out of an LLM response. Handles:
 * - Raw JSON ("{ ... }")
 * - JSON in a ```json fenced block
 * - JSON in a bare ``` fenced block
 * - JSON preceded or followed by prose (extracts the first balanced { ... })
 *
 * Returns null when no JSON object can be recovered.
 */
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  const trimmed = text.trim();

  // Fenced code block first — most reliable shape.
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  // Bare JSON object — find the first balanced { ... } in the text.
  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampConfidence(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isProposableKind(value: unknown): value is ProposableKind {
  return (
    typeof value === "string" &&
    (PROPOSABLE_KINDS as readonly string[]).includes(value)
  );
}

function isValidSlugShape(slug: string): boolean {
  return /^[a-z][a-z0-9-]*\/[a-z0-9-]+$/.test(slug);
}

function slugPrefix(slug: string): string | null {
  const idx = slug.indexOf("/");
  return idx === -1 ? null : slug.slice(0, idx);
}

const KIND_TO_SLUG_PREFIX: Record<ProposableKind, string> = {
  entity: "entities",
  stance: "stances",
  heuristic: "heuristics",
  principle: "principles",
  summary: "summaries",
  decision: "decisions",
  runbook: "runbooks",
};

/**
 * Parse pass 2's response into `ClaimProposal[]`. Emits human-readable
 * parse errors for rows that were rejected so reviewers see what the LLM
 * actually produced; never silently drops content.
 */
export function parseClaimsResponse(
  text: string,
  snapshot: ExistingSlugSnapshot,
): { claims: ClaimProposal[]; parseErrors: string[] } {
  const errors: string[] = [];
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    errors.push("pass-2: could not extract a JSON object from model output");
    return { claims: [], parseErrors: errors };
  }
  const rows = (parsed as { claims?: unknown }).claims;
  if (!Array.isArray(rows)) {
    errors.push("pass-2: response missing a `claims` array");
    return { claims: [], parseErrors: errors };
  }

  const accepted: ClaimProposal[] = [];
  const existingSet = new Set(snapshot.all);
  for (const [idx, raw] of rows.entries()) {
    if (!raw || typeof raw !== "object") {
      errors.push(`pass-2 claim[${idx}]: not an object`);
      continue;
    }
    const row = raw as Record<string, unknown>;
    const claim = asString(row.claim);
    const targetSlug = asString(row.target_slug);
    const pageKindRaw = row.page_kind;
    const supportingExcerpt = asString(row.supporting_excerpt);
    const rationale = asString(row.rationale) ?? undefined;
    const confidenceRaw = asNumber(row.confidence);

    if (!claim) {
      errors.push(`pass-2 claim[${idx}]: missing claim text`);
      continue;
    }
    if (!targetSlug || !isValidSlugShape(targetSlug)) {
      errors.push(
        `pass-2 claim[${idx}]: invalid target_slug ${JSON.stringify(targetSlug)}`,
      );
      continue;
    }
    if (!isProposableKind(pageKindRaw)) {
      errors.push(
        `pass-2 claim[${idx}]: invalid page_kind ${JSON.stringify(pageKindRaw)}`,
      );
      continue;
    }
    const pageKind = pageKindRaw;
    const expectedPrefix = KIND_TO_SLUG_PREFIX[pageKind];
    if (slugPrefix(targetSlug) !== expectedPrefix) {
      errors.push(
        `pass-2 claim[${idx}]: target_slug ${targetSlug} does not match page_kind ${pageKind} (expected prefix "${expectedPrefix}/")`,
      );
      continue;
    }
    if (!supportingExcerpt) {
      errors.push(`pass-2 claim[${idx}]: missing supporting_excerpt`);
      continue;
    }
    if (confidenceRaw === null) {
      errors.push(`pass-2 claim[${idx}]: missing or non-numeric confidence`);
      continue;
    }

    const exists = existingSet.has(targetSlug);
    const proposeNewRaw = Boolean(row.propose_new);
    const proposeNew = !exists;
    if (proposeNewRaw !== proposeNew) {
      errors.push(
        `pass-2 claim[${idx}]: propose_new=${proposeNewRaw} disagrees with existence check (${exists ? "exists" : "new"}); correcting`,
      );
    }

    accepted.push({
      claim,
      targetSlug,
      pageKind,
      proposeNew,
      confidence: clampConfidence(confidenceRaw),
      supportingExcerpt,
      rationale,
    });
  }

  return { claims: accepted, parseErrors: errors };
}

/**
 * Parse pass 3's response into `StanceProposal[]` + `HeuristicProposal[]`.
 */
export function parseStanceHeuristicsResponse(
  text: string,
  snapshot: ExistingSlugSnapshot,
): {
  stances: StanceProposal[];
  heuristics: HeuristicProposal[];
  parseErrors: string[];
} {
  const errors: string[] = [];
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    errors.push("pass-3: could not extract a JSON object from model output");
    return { stances: [], heuristics: [], parseErrors: errors };
  }
  const obj = parsed as { stances?: unknown; heuristics?: unknown };

  const stanceSet = new Set(snapshot.byKind.stance);
  const heuristicSet = new Set(snapshot.byKind.heuristic);

  const stances: StanceProposal[] = [];
  if (Array.isArray(obj.stances)) {
    for (const [idx, raw] of obj.stances.entries()) {
      if (!raw || typeof raw !== "object") {
        errors.push(`pass-3 stance[${idx}]: not an object`);
        continue;
      }
      const row = raw as Record<string, unknown>;
      const statement = asString(row.statement);
      const targetSlug = asString(row.target_slug);
      const supportingExcerpt = asString(row.supporting_excerpt);
      if (!statement) {
        errors.push(`pass-3 stance[${idx}]: missing statement`);
        continue;
      }
      if (!targetSlug || !isValidSlugShape(targetSlug)) {
        errors.push(
          `pass-3 stance[${idx}]: invalid target_slug ${JSON.stringify(targetSlug)}`,
        );
        continue;
      }
      if (slugPrefix(targetSlug) !== "stances") {
        errors.push(
          `pass-3 stance[${idx}]: target_slug ${targetSlug} must start with "stances/"`,
        );
        continue;
      }
      if (!supportingExcerpt) {
        errors.push(`pass-3 stance[${idx}]: missing supporting_excerpt`);
        continue;
      }

      const proposeNew = !stanceSet.has(targetSlug);
      stances.push({ statement, targetSlug, proposeNew, supportingExcerpt });
    }
  } else {
    errors.push("pass-3: response missing a `stances` array");
  }

  const heuristics: HeuristicProposal[] = [];
  if (Array.isArray(obj.heuristics)) {
    for (const [idx, raw] of obj.heuristics.entries()) {
      if (!raw || typeof raw !== "object") {
        errors.push(`pass-3 heuristic[${idx}]: not an object`);
        continue;
      }
      const row = raw as Record<string, unknown>;
      const rule = asString(row.rule);
      const targetSlug = asString(row.target_slug);
      const supportingExcerpt = asString(row.supporting_excerpt);
      if (!rule) {
        errors.push(`pass-3 heuristic[${idx}]: missing rule`);
        continue;
      }
      if (!targetSlug || !isValidSlugShape(targetSlug)) {
        errors.push(
          `pass-3 heuristic[${idx}]: invalid target_slug ${JSON.stringify(targetSlug)}`,
        );
        continue;
      }
      if (slugPrefix(targetSlug) !== "heuristics") {
        errors.push(
          `pass-3 heuristic[${idx}]: target_slug ${targetSlug} must start with "heuristics/"`,
        );
        continue;
      }
      if (!supportingExcerpt) {
        errors.push(`pass-3 heuristic[${idx}]: missing supporting_excerpt`);
        continue;
      }
      const proposeNew = !heuristicSet.has(targetSlug);
      heuristics.push({ rule, targetSlug, proposeNew, supportingExcerpt });
    }
  } else {
    errors.push("pass-3: response missing a `heuristics` array");
  }

  return { stances, heuristics, parseErrors: errors };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export type ProposeWikiDiffInput = {
  source: ProposalSource;
  snapshot: ExistingSlugSnapshot;
  /** Inference callable — injected so tests can stub deterministically. */
  infer: InferenceCallable;
  /**
   * Skip pass 1 (abstract) when the source already carries an abstract.
   * Default: true. Set to false to force regeneration.
   */
  reuseExistingAbstract?: boolean;
};

/**
 * Run all three passes against a source. Returns a `WikiDiffProposal`
 * with the structured rows the reviewer / Phase 2.3 commit step will act
 * on. Pass failures surface as `parseErrors`; the orchestrator never
 * throws on individual-pass content errors so the reviewer always gets
 * the partial result.
 */
export async function proposeWikiDiff(
  input: ProposeWikiDiffInput,
): Promise<WikiDiffProposal> {
  const errors: string[] = [];

  let abstract = input.source.abstract ?? "";
  const shouldReuse = input.reuseExistingAbstract ?? true;
  if (!shouldReuse || !abstract) {
    try {
      const abstractRequest = buildAbstractPrompt(input.source);
      const raw = await input.infer(abstractRequest);
      abstract = raw.trim();
    } catch (err) {
      errors.push(`pass-1: ${(err as Error).message}`);
    }
  }

  let claims: ClaimProposal[] = [];
  try {
    const claimsRequest = buildClaimsPrompt(input.source, input.snapshot);
    const raw = await input.infer(claimsRequest);
    const parsed = parseClaimsResponse(raw, input.snapshot);
    claims = parsed.claims;
    errors.push(...parsed.parseErrors);
  } catch (err) {
    errors.push(`pass-2: ${(err as Error).message}`);
  }

  let stances: StanceProposal[] = [];
  let heuristics: HeuristicProposal[] = [];
  try {
    const shRequest = buildStanceHeuristicsPrompt(input.source, input.snapshot);
    const raw = await input.infer(shRequest);
    const parsed = parseStanceHeuristicsResponse(raw, input.snapshot);
    stances = parsed.stances;
    heuristics = parsed.heuristics;
    errors.push(...parsed.parseErrors);
  } catch (err) {
    errors.push(`pass-3: ${(err as Error).message}`);
  }

  return {
    abstract,
    claims,
    stances,
    heuristics,
    parseErrors: errors,
  };
}
