/** Resolved facts from the canonical investment/budget owner, never a reservation. */
export type AuthorStageFunding =
  | { funded: true; portfolioId: string; summary: string }
  | { funded: false; because: string };

export type AuthorStageAutonomy = {
  roleBindings: Record<string, string>;
  withheldBecause: string | null;
};

export type FundedAuthorInput = {
  /** Host-owned shape/stage applicability; this policy does not load a registry. */
  applicable: boolean;
  excludedBecause?: string | null;
  role: string;
  agentRef: string;
  /** The host has checked the current record and its current authorizing principal. */
  preauthorisation: { state: "in-force" } | { state: "not-in-force"; because: string };
  funding: AuthorStageFunding;
};

/**
 * Existing author-stage conjunction over supplied facts. The candidate binding
 * grants no permission and does not authenticate, reserve funds or dispatch.
 * Current authority, freshness and admission remain host obligations.
 */
export function decideFundedAuthor(input: FundedAuthorInput): AuthorStageAutonomy {
  if (!input.applicable) return { roleBindings: {}, withheldBecause: null };
  if (input.excludedBecause) return { roleBindings: {}, withheldBecause: input.excludedBecause };
  if (input.preauthorisation.state !== "in-force") return { roleBindings: {}, withheldBecause: input.preauthorisation.because };
  if (!input.funding.funded) return { roleBindings: {}, withheldBecause: input.funding.because };
  return { roleBindings: { [input.role]: input.agentRef }, withheldBecause: null };
}
