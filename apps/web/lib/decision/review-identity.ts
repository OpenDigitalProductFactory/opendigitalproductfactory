/**
 * Stable identity for one operator-review question while preserving every
 * DecisionInteraction as audit history. This is deliberately lexical rather
 * than "semantic": only questions the system can prove are the same are
 * collapsed and closed by one answer.
 */
export function normalizeDecisionReviewQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

export type DecisionReviewIdentityInput = {
  profileId: string;
  domainClass: string;
  question: string;
};

export function decisionReviewIdentity(input: DecisionReviewIdentityInput): string {
  return [
    input.profileId.trim().toLowerCase(),
    input.domainClass.trim().toLowerCase(),
    normalizeDecisionReviewQuestion(input.question),
  ].join("|");
}

/** Rows must be newest-first; the first row remains the representative. */
export function clusterDecisionReviewRows<T extends DecisionReviewIdentityInput>(
  rows: T[],
): Array<T & { occurrenceCount: number }> {
  const clustered = new Map<string, T & { occurrenceCount: number }>();
  for (const row of rows) {
    const key = decisionReviewIdentity(row);
    const current = clustered.get(key);
    if (current) {
      current.occurrenceCount += 1;
    } else {
      clustered.set(key, { ...row, occurrenceCount: 1 });
    }
  }
  return [...clustered.values()];
}
