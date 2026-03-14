const NORMALIZATION_THRESHOLD = 0.7;

export type SoftwareIdentityCandidate = {
  id: string;
  normalizedVendor?: string | null;
  normalizedProductName: string;
  normalizedEdition?: string | null;
  canonicalVersion?: string | null;
  aliases?: string[];
};

export type SoftwareNormalizationRuleInput = {
  ruleKey: string;
  matchType: "package_name" | "product_name";
  rawSignature: string;
  source: string;
  softwareIdentity: SoftwareIdentityCandidate;
};

export type SoftwareEvidenceInput = {
  evidenceKey: string;
  evidenceSource: string;
  rawVendor?: string | null;
  rawProductName?: string | null;
  rawPackageName?: string | null;
  rawVersion?: string | null;
};

export type RankedSoftwareIdentityCandidate = SoftwareIdentityCandidate & {
  score: number;
};

export type SoftwareNormalizationResult = {
  normalizationStatus: "normalized" | "needs_review";
  method: "rule" | "heuristic";
  confidence: number;
  identity: (SoftwareIdentityCandidate & { canonicalVersion?: string | null }) | null;
  candidates: RankedSoftwareIdentityCandidate[];
};

export type RuleCandidateInput = {
  rawProductName?: string | null;
  rawPackageName?: string | null;
};

export type SoftwareNormalizationRuleCandidate = {
  ruleKey: string;
  matchType: "package_name" | "product_name";
  rawSignature: string;
  source: string;
  softwareIdentityId: string;
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.replace(/s$/, ""))
    .filter((token) => token.length > 1);
}

function canonicalizeVersion(rawVersion?: string | null): string | null {
  if (!rawVersion) {
    return null;
  }

  const match = rawVersion.match(/\d+(?:\.\d+){0,2}/);
  return match?.[0] ?? null;
}

export function matchSoftwareIdentityByRule(
  evidence: SoftwareEvidenceInput,
  rules: SoftwareNormalizationRuleInput[],
): SoftwareNormalizationResult | null {
  const packageName = normalizeText(evidence.rawPackageName ?? "");
  const productName = normalizeText(evidence.rawProductName ?? "");

  for (const rule of rules) {
    const signature = normalizeText(rule.rawSignature);
    const haystack = rule.matchType === "package_name" ? packageName : productName;
    if (!haystack || !signature || !haystack.includes(signature)) {
      continue;
    }

    return {
      normalizationStatus: "normalized",
      method: "rule",
      confidence: 0.99,
      identity: {
        ...rule.softwareIdentity,
        canonicalVersion: canonicalizeVersion(evidence.rawVersion),
      },
      candidates: [
        {
          ...rule.softwareIdentity,
          canonicalVersion: canonicalizeVersion(evidence.rawVersion),
          score: 0.99,
        },
      ],
    };
  }

  return null;
}

export function scoreSoftwareIdentityCandidates(
  evidence: SoftwareEvidenceInput,
  identities: SoftwareIdentityCandidate[],
): RankedSoftwareIdentityCandidate[] {
  const evidenceText = normalizeText([
    evidence.rawVendor,
    evidence.rawProductName,
    evidence.rawPackageName,
  ].filter(Boolean).join(" "));
  const evidenceTokens = new Set(tokenize(evidenceText));

  return identities
    .map((identity) => {
      const aliasText = [identity.normalizedProductName, identity.normalizedVendor, ...(identity.aliases ?? [])]
        .filter(Boolean)
        .join(" ");
      const identityTokens = tokenize(aliasText);
      const overlap = identityTokens.filter((token) => evidenceTokens.has(token));
      const coverage = identityTokens.length > 0 ? overlap.length / identityTokens.length : 0;
      const evidenceCoverage = evidenceTokens.size > 0 ? overlap.length / evidenceTokens.size : 0;
      const phraseBonus = evidenceText.includes(normalizeText(identity.normalizedProductName)) ? 0.25 : 0;
      const score = Math.min(0.95, Number((coverage * 0.7 + evidenceCoverage * 0.3 + phraseBonus).toFixed(3)));

      return {
        ...identity,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

export function normalizeSoftwareEvidence(
  evidence: SoftwareEvidenceInput,
  identities: SoftwareIdentityCandidate[],
  rules: SoftwareNormalizationRuleInput[],
): SoftwareNormalizationResult {
  const ruleMatch = matchSoftwareIdentityByRule(evidence, rules);
  if (ruleMatch) {
    return ruleMatch;
  }

  const candidates = scoreSoftwareIdentityCandidates(evidence, identities);
  const best = candidates[0] ?? null;

  if (!best || best.score < NORMALIZATION_THRESHOLD) {
    return {
      normalizationStatus: "needs_review",
      method: "heuristic",
      confidence: best?.score ?? 0,
      identity: null,
      candidates,
    };
  }

  return {
    normalizationStatus: "normalized",
    method: "heuristic",
    confidence: best.score,
    identity: {
      ...best,
      canonicalVersion: canonicalizeVersion(evidence.rawVersion),
    },
    candidates,
  };
}

export function buildNormalizationRuleCandidate(
  input: RuleCandidateInput,
  result: SoftwareNormalizationResult,
  source: string,
): SoftwareNormalizationRuleCandidate {
  if (!result.identity) {
    throw new Error("Cannot build a normalization rule candidate without a normalized identity");
  }

  const rawSignatureSource = input.rawPackageName ?? input.rawProductName ?? "";
  const rawSignature = normalizeText(rawSignatureSource);
  const matchType = input.rawPackageName ? "package_name" : "product_name";
  const slug = rawSignature.replace(/\s+/g, "-");

  return {
    ruleKey: `${matchType}:${slug}`,
    matchType,
    rawSignature,
    source,
    softwareIdentityId: result.identity.id,
  };
}

