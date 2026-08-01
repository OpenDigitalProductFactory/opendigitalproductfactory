// Marketing archetype-fit engine.
//
// Customer marketing artifacts (campaign briefs, proof prompts, drafts) must
// speak in the language of the organization's OWN business archetype — a
// restaurant markets covers, bookings, menus and seasonal offers, never
// "Build Studio", "technical founders", or "AI workflow". Early bootstrap and
// imported/test data can leak software-platform (DPF) vocabulary into a
// customer's marketing surfaces; this module detects that leak deterministically
// so the UI can warn, badge it as imported/test data, and the server can block
// it from ever publishing to a real audience.
//
// Two finding kinds:
//   - platform-leak  → software-platform / DPF-internal artifacts that are
//                       foreign to EVERY customer archetype. Always a hard
//                       BLOCK (must not publish, badge as imported/test data).
//   - off-archetype  → vocabulary that clearly belongs to a DIFFERENT customer
//                       archetype than the active one. A WARN — confirm before
//                       sending — because cross-sell copy can be legitimate.
//
// Reference: docs/platform-usability-standards.md (archetype-scoped surfaces).

export type ArchetypeFitSeverity = "ok" | "warn" | "block";

export type ArchetypeFitFindingKind = "platform-leak" | "off-archetype";

export type ArchetypeFitFinding = {
  kind: ArchetypeFitFindingKind;
  severity: "warn" | "block";
  term: string;
  message: string;
  /** For off-archetype findings, the category the term looks like it belongs to. */
  looksLikeCategory?: string | null;
};

export type ArchetypeFitAssessment = {
  severity: ArchetypeFitSeverity;
  /** True when severity === "block": content must not publish to a real audience. */
  blocked: boolean;
  findings: ArchetypeFitFinding[];
  summary: string;
};

export const IMPORTED_TEST_BADGE_LABEL = "Imported / test data — blocked from publish";

const MAX_FINDINGS = 6;

type TermSpec = {
  term: string;
  pattern: RegExp;
  message: string;
};

// Escape a literal and allow flexible internal whitespace, matched on word-ish
// boundaries so "menus" does not trip a "menu" foreign match but "SaaS-first"
// still trips "saas".
function termPattern(literal: string): RegExp {
  const escaped = literal
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i");
}

function spec(term: string, message: string): TermSpec {
  return { term, pattern: termPattern(term), message };
}

// ─── Platform-leak terms (universal hard block) ────────────────────────────
// Software-platform / DPF-internal artifacts. These do not belong in ANY
// customer's marketing, regardless of archetype, so they always block.
const PLATFORM_LEAK_TERMS: TermSpec[] = [
  spec("Build Studio", "“Build Studio” is a software-platform build tool, not a customer marketing concept."),
  spec("Digital Product Factory", "“Digital Product Factory” is the internal platform name and must not reach a customer audience."),
  spec("technical founder", "“technical founder” is software-startup language, foreign to this business's audience."),
  spec("technical co-founder", "“technical co-founder” is software-startup language, foreign to this business's audience."),
  spec("technical founders", "“technical founders” is software-startup language, foreign to this business's audience."),
  spec("AI workflow", "“AI workflow” exposes internal platform mechanics rather than a customer benefit."),
  spec("agentic", "“agentic” is internal platform jargon, not customer marketing language."),
  spec("AI coworker", "“AI coworker” is internal platform tooling, not something to market to customers."),
  spec("software platform", "“software platform” is not what this business sells to its customers."),
  spec("SaaS", "“SaaS” is software-industry positioning, foreign to this business's audience."),
  spec("self-upgrade", "“self-upgrade” is internal platform machinery, not a customer message."),
  spec("MCP server", "“MCP server” is internal platform plumbing and must not appear in marketing."),
  spec("MCP tool", "“MCP tool” is internal platform plumbing and must not appear in marketing."),
  spec("backlog item", "“backlog item” is internal delivery jargon, not a customer marketing concept."),
  spec("work capsule", "“work capsule” is internal platform jargon, not a customer marketing concept."),
  spec("Prisma", "“Prisma” is an internal database detail that must never appear in marketing copy."),
  spec("codebase", "“codebase” is software-engineering language, foreign to this business's marketing."),
];

// ─── Off-archetype signatures (warn) ────────────────────────────────────────
// Distinctive vocabulary per customer archetype category. When content carries
// signatures from a category OTHER than the active one, warn the operator to
// confirm the copy fits before it is approved or sent. Kept deliberately
// high-precision (domain-specific, multi-word where possible) to avoid noise.
const CATEGORY_SIGNATURES: Record<string, string[]> = {
  // Distinctive food-hospitality terms only. Generic words ("menu", "covers",
  // "dining") are omitted so they don't falsely warn OTHER archetypes' copy —
  // each term here only matters when a different archetype's draft uses it.
  "food-hospitality": [
    "reserve a table", "tasting menu", "prix fixe", "no-show", "private dining",
    "diners", "covers per service", "reservation",
  ],
  "banking-financial-services": ["apy", "apr", "fdic", "ncua", "open an account", "mortgage", "member fdic"],
  "healthcare-wellness": ["recall reminder", "vaccination", "screening", "preventive care", "patient recall"],
  "education-training": ["enrolment", "enrollment", "taster session", "term launch", "open day", "course completion"],
  "real-estate-construction": ["display home", "floor plan", "handover", "purchase agreement", "stage release"],
  "trades-maintenance": ["gas safety", "eicr", "boiler", "call-out", "pat testing"],
  "pet-services": ["grooming", "boarding", "puppy programme", "kennel"],
  "automotive-services": ["adas calibration", "windscreen", "windshield", "fleet account"],
  "fitness-recreation": ["class schedule", "membership churn", "trial pass", "personal training"],
  "nonprofit-community": ["donor", "fundraising", "recurring giving", "volunteer recruitment"],
  "warehousing-fulfilment": ["pallet", "3pl", "despatch", "rate card", "committed capacity"],
  "fabric-care-services": ["claim ticket", "dry cleaning", "wash and fold", "ready for pickup", "garment care"],
  "agriculture-ranching": ["cattle", "hay", "forage", "grazing", "harvest", "farm-direct", "breeding stock"],
  "beauty-personal-care": ["rebooking", "stylist", "gift voucher", "colour service"],
  "asset-rental": ["off-peak", "rentable pool", "return-due", "deposit policy"],
  "live-events-venues": ["on-sale", "presale", "line-up reveal", "season-pass"],
  "hoa-property-management": ["bylaw", "special assessment", "amenity reservation", "board meeting"],
  "public-sector": ["public hearing", "council meeting", "permit deadline", "levy"],
  "professional-services": ["retainer renewal", "thought leadership", "engagement value"],
  "media-production": ["showreel", "reel", "commission", "behind-the-scenes"],
  "security-services": ["monitoring plan", "rfp response", "response-time sla"],
  "moving-and-logistics": ["packing service", "moving quote", "b2b route"],
  "retail-goods": ["average order value", "flash sale", "pre-order", "gift guide"],
};

type CompiledSignature = { category: string; term: string; pattern: RegExp };

const COMPILED_SIGNATURES: CompiledSignature[] = Object.entries(CATEGORY_SIGNATURES).flatMap(
  ([category, terms]) => terms.map((term) => ({ category, term, pattern: termPattern(term) })),
);

function humanCategory(category: string): string {
  return category
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function severityRank(severity: ArchetypeFitSeverity): number {
  return severity === "block" ? 2 : severity === "warn" ? 1 : 0;
}

/**
 * Assess whether marketing content fits the active archetype.
 *
 * @param text     the content to check (title + body + notes, joined)
 * @param category the active storefront archetype category (e.g. "food-hospitality")
 */
export function assessArchetypeFit(input: {
  text: string | null | undefined;
  category: string | null | undefined;
}): ArchetypeFitAssessment {
  const text = (input.text ?? "").toString();
  const category = (input.category ?? "").trim().toLowerCase();
  const findings: ArchetypeFitFinding[] = [];

  if (text.trim().length === 0) {
    return { severity: "ok", blocked: false, findings: [], summary: "No content to check." };
  }

  const seen = new Set<string>();

  // 1) Platform leaks — always block.
  for (const leak of PLATFORM_LEAK_TERMS) {
    if (leak.pattern.test(text)) {
      const key = `leak:${leak.term.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ kind: "platform-leak", severity: "block", term: leak.term, message: leak.message });
    }
  }

  // 2) Off-archetype signatures — warn. Skip the active category's own terms.
  for (const sig of COMPILED_SIGNATURES) {
    if (sig.category === category) continue;
    if (!sig.pattern.test(text)) continue;
    const key = `sig:${sig.term.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      kind: "off-archetype",
      severity: "warn",
      term: sig.term,
      looksLikeCategory: sig.category,
      message: `“${sig.term}” reads like ${humanCategory(sig.category)} marketing, not this business's.`,
    });
  }

  const trimmed = findings.slice(0, MAX_FINDINGS);
  const severity: ArchetypeFitSeverity = trimmed.some((f) => f.severity === "block")
    ? "block"
    : trimmed.some((f) => f.severity === "warn")
      ? "warn"
      : "ok";

  return {
    severity,
    blocked: severity === "block",
    findings: trimmed,
    summary: summarize(severity, trimmed),
  };
}

function summarize(severity: ArchetypeFitSeverity, findings: ArchetypeFitFinding[]): string {
  if (severity === "block") {
    const terms = findings.filter((f) => f.kind === "platform-leak").map((f) => `“${f.term}”`);
    return `Blocked: software-platform content (${terms.join(", ")}) does not belong in this business's marketing. Treat as imported/test data — it cannot be published.`;
  }
  if (severity === "warn") {
    const cats = [
      ...new Set(
        findings
          .filter((f) => f.kind === "off-archetype" && f.looksLikeCategory)
          .map((f) => humanCategory(f.looksLikeCategory as string)),
      ),
    ];
    return `Heads up: this copy uses ${cats.join(" / ")} language. Confirm it fits this business before you approve or send it.`;
  }
  return "Content fits this business's archetype.";
}

/** True when a fit assessment should hard-block Approve / Send / Publish. */
export function isPublishBlockedByFit(assessment: ArchetypeFitAssessment): boolean {
  return assessment.blocked;
}

/** True when a saved artifact should be badged as imported/test data. */
export function isImportedTestArtifact(assessment: ArchetypeFitAssessment): boolean {
  return assessment.blocked;
}

/** Worst severity across several assessments (for aggregate badges). */
export function worstFitSeverity(assessments: ArchetypeFitAssessment[]): ArchetypeFitSeverity {
  return assessments.reduce<ArchetypeFitSeverity>((worst, a) => {
    return severityRank(a.severity) > severityRank(worst) ? a.severity : worst;
  }, "ok");
}
