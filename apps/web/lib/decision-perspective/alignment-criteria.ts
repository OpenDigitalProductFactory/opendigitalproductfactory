export const ALIGNMENT_CORPORA = ["wwwd", "portfolio", "gtm"] as const;
export type AlignmentCorpus = (typeof ALIGNMENT_CORPORA)[number];

export type AlignmentCriteria = {
  market: string | null;
  segment: string | null;
  product: string | null;
  motion: string | null;
  geography: string | null;
  customerType: string | null;
};

export type ExtractedAlignmentCriteria = {
  status: "complete" | "ambiguous";
  criteria: AlignmentCriteria;
  evidence: string[];
  missing: Array<keyof AlignmentCriteria>;
};

export type AlignmentEvidence = { ref: string; text: string };
export type AlignmentCorpora = Record<AlignmentCorpus, AlignmentEvidence[]>;

export type AlignmentCheck = {
  corpus: AlignmentCorpus;
  criterion: "mission" | "market" | "product" | "motion";
  verdict: "aligned" | "rejected" | "unknown";
  rationale: string;
  evidenceRefs: string[];
};

export type ConstitutionalAlignmentResult = {
  verdict: "approve" | "decline" | "escalate";
  criteria: ExtractedAlignmentCriteria;
  checks: AlignmentCheck[];
  veto: AlignmentCheck | null;
};

function normalized(value: string): string {
  return value.toLowerCase().replace(/alaskan/g, "alaska").replace(/[^a-z0-9-]+/g, " ").trim();
}

function firstMatch(text: string, patterns: Array<[RegExp, string]>): string | null {
  return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function extractAlignmentCriteria(statement: string): ExtractedAlignmentCriteria {
  const text = normalized(statement);
  const product = firstMatch(text, [
    [/\btoasters?\b/, "toasters"],
    [/\bcoffee[ -]shops?\b|\bcoffee shop chain\b/, "coffee-shop chain"],
    [/\bself-host(?:ed)?\b.*\bsupport\b.*\bsubscriptions?\b|\bsupport\b.*\bsubscriptions?\b/, "self-host support subscription"],
    [/\bsubscriptions?\b/, "subscription"],
    [/\bsoftware\b|\bplatform\b/, "software"],
  ]);
  const geography = firstMatch(text, [[/\balaska\b/, "alaska"]]);
  const customerType = firstMatch(text, [
    [/\bfisherm(?:a|e)n\b/, "fishermen"],
    [/\bmsp\b.*\bpartners?\b|\bpartners?\b.*\bmsp\b/, "msp partner"],
    [/\bsoftware teams?\b/, "software teams"],
    [/\bconsumers?\b/, "consumer"],
  ]);
  const motion = firstMatch(text, [
    [/\bkiosks?\b/, "kiosk retail"],
    [/\bshopping malls?\b|\bretail\b|\bchain\b/, "retail chain"],
    [/\bpartners?\b/, "partner channel"],
    [/\bsubscriptions?\b/, "subscription"],
  ]);
  const segment = firstMatch(text, [
    [/\btoasters?\b|\bcoffee[ -]shops?\b|\bkiosks?\b|\bshopping malls?\b/, "consumer physical retail"],
    [/\bmsp\b|\bself-host(?:ed)?\b|\bsoftware\b/, "b2b software"],
  ]);
  const market = [segment, customerType, geography].filter(Boolean).join(" / ") || null;
  const criteria = { market, segment, product, motion, geography, customerType };
  const evidence = Object.entries(criteria)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${value}`);
  const missing = (Object.keys(criteria) as Array<keyof AlignmentCriteria>)
    .filter((key) => criteria[key] === null);
  const complete = Boolean(product && (market || motion));
  return { status: complete ? "complete" : "ambiguous", criteria, evidence, missing };
}

const PHYSICAL_RETAIL = /\b(toaster|appliance|coffee shop|kiosk|shopping mall|physical retail|fisherm)/;
const SOFTWARE_BUSINESS = /\b(software|platform|self-host|subscription|msp|open-source|assurance|digital product)/;
const REJECTION = /\b(decline|reject|never|not serve|do not|don t|outside|exclude)/;

function criterionFor(corpus: AlignmentCorpus): AlignmentCheck["criterion"] {
  return corpus === "wwwd" ? "market" : corpus === "portfolio" ? "product" : "motion";
}

function salientTokens(criteria: AlignmentCriteria): string[] {
  return Object.values(criteria)
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalized(value).split(" "))
    .filter((token) => token.length > 3 && !["consumer", "physical", "retail", "software"].includes(token));
}

function checkCorpus(
  corpus: AlignmentCorpus,
  evidence: AlignmentEvidence[],
  criteria: AlignmentCriteria,
  statement: string,
): AlignmentCheck {
  const criterion = criterionFor(corpus);
  if (evidence.length === 0) {
    return { corpus, criterion, verdict: "unknown", rationale: `No ${corpus} evidence was available.`, evidenceRefs: [] };
  }
  const action = normalized(statement);
  const refs = evidence.map((item) => item.ref);
  const documents = evidence.map((item) => normalized(item.text));
  const tokens = salientTokens(criteria);
  const explicitBoundary = evidence.filter((item) => {
    return item.text.split(/[.;!?]/).some((rawSentence) => {
      const sentence = normalized(rawSentence);
      const overlap = tokens.filter((token) => sentence.includes(token)).length;
      return REJECTION.test(sentence) && overlap >= 2;
    });
  });
  if (explicitBoundary.length > 0) {
    return {
      corpus,
      criterion,
      verdict: "rejected",
      rationale: `${corpus} contains an explicit boundary matching the proposed ${criterion}.`,
      evidenceRefs: explicitBoundary.map((item) => item.ref),
    };
  }
  const corpusText = documents.join(" ");
  if (PHYSICAL_RETAIL.test(action) && SOFTWARE_BUSINESS.test(corpusText) && !PHYSICAL_RETAIL.test(corpusText)) {
    return {
      corpus,
      criterion,
      verdict: "rejected",
      rationale: `${criterion} is physical-retail shaped while the cited ${corpus} is software-business shaped.`,
      evidenceRefs: refs,
    };
  }
  const overlap = tokens.some((token) => corpusText.includes(token));
  const sameSoftwareDomain = SOFTWARE_BUSINESS.test(action) && SOFTWARE_BUSINESS.test(corpusText);
  if (overlap || sameSoftwareDomain) {
    return {
      corpus,
      criterion,
      verdict: "aligned",
      rationale: `${criterion} is supported by the cited ${corpus} evidence.`,
      evidenceRefs: refs,
    };
  }
  return {
    corpus,
    criterion,
    verdict: "unknown",
    rationale: `${corpus} does not provide enough evidence to establish ${criterion}.`,
    evidenceRefs: refs,
  };
}

export function evaluateConstitutionalAlignment(input: {
  statement: string;
  corpora: AlignmentCorpora;
}): ConstitutionalAlignmentResult {
  const criteria = extractAlignmentCriteria(input.statement);
  if (criteria.status === "ambiguous") {
    return { verdict: "escalate", criteria, checks: [], veto: null };
  }
  const checks = ALIGNMENT_CORPORA.map((corpus) =>
    checkCorpus(corpus, input.corpora[corpus], criteria.criteria, input.statement),
  );
  const veto = checks.find((check) => check.verdict === "rejected") ?? null;
  if (veto) return { verdict: "decline", criteria, checks, veto };
  if (checks.some((check) => check.verdict === "unknown")) {
    return { verdict: "escalate", criteria, checks, veto: null };
  }
  return { verdict: "approve", criteria, checks, veto: null };
}
