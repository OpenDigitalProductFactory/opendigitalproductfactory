export type MatchCandidate = {
  paymentId: string;
  paymentRef: string;
  amount: number;
  date: Date | null;
  confidence: number; // 0-100
  matchReasons: string[];
};

type Transaction = {
  amount: number;
  date: Date;
  description: string;
  reference?: string;
};

type Payment = {
  id: string;
  paymentRef: string;
  amount: number;
  receivedAt: Date | null;
  counterpartyId: string | null;
  reference: string | null;
};

type BankRule = {
  matchField: string;
  matchType: string;
  matchValue: string;
  accountCode?: string | null;
  category?: string | null;
  taxRate?: number | null;
  description?: string | null;
  isActive: boolean;
};

type RuleMatch = {
  accountCode?: string | null;
  category?: string | null;
  taxRate?: number | null;
  description?: string | null;
};

/**
 * Calculate the absolute difference in days between two dates.
 */
function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.abs(a.getTime() - b.getTime()) / msPerDay;
}

/**
 * Find candidate payments that could match a given bank transaction.
 *
 * Scoring:
 *   +40  exact amount match (abs values equal)
 *   +30  amount within 1% (handles rounding/fees)
 *   +25  date within 3 days
 *   +15  date within 7 days
 *   +20  reference match (payment.reference found in tx reference or description)
 *
 * Only candidates with confidence > 30 are returned, sorted descending.
 */
export function findMatches(transaction: Transaction, payments: Payment[]): MatchCandidate[] {
  const results: MatchCandidate[] = [];

  for (const payment of payments) {
    const matchReasons: string[] = [];
    let confidence = 0;

    const txAbs = Math.abs(transaction.amount);
    const payAbs = Math.abs(payment.amount);

    // Amount scoring
    if (txAbs === payAbs) {
      confidence += 40;
      matchReasons.push("exact amount match");
    } else {
      const larger = Math.max(txAbs, payAbs);
      const diff = Math.abs(txAbs - payAbs);
      if (larger > 0 && diff / larger <= 0.01) {
        confidence += 30;
        matchReasons.push("amount within 1%");
      }
    }

    // Date scoring
    const days = payment.receivedAt ? daysBetween(transaction.date, payment.receivedAt) : Infinity;
    if (days <= 3) {
      confidence += 25;
      matchReasons.push(`date within ${Math.round(days)} day(s)`);
    } else if (days <= 7) {
      confidence += 15;
      matchReasons.push(`date within ${Math.round(days)} day(s)`);
    }

    // Reference scoring
    if (payment.reference) {
      const refLower = payment.reference.toLowerCase();
      const txRefLower = (transaction.reference ?? "").toLowerCase();
      const txDescLower = transaction.description.toLowerCase();
      if (txRefLower.includes(refLower) || txDescLower.includes(refLower)) {
        confidence += 20;
        matchReasons.push(`reference match: ${payment.reference}`);
      }
    }

    if (confidence > 30) {
      results.push({
        paymentId: payment.id,
        paymentRef: payment.paymentRef,
        amount: payment.amount,
        date: payment.receivedAt,
        confidence,
        matchReasons,
      });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  return results;
}

/**
 * Apply bank categorisation rules to a transaction.
 *
 * Returns the first active matching rule's output fields, or null if no rule matches.
 *
 * Match types:
 *   contains    — description includes matchValue (case-insensitive)
 *   exact       — description equals matchValue (case-insensitive)
 *   starts_with — description starts with matchValue (case-insensitive)
 */
export function applyBankRules(
  transaction: { description: string; reference?: string; amount: number },
  rules: BankRule[]
): RuleMatch | null {
  for (const rule of rules) {
    if (!rule.isActive) continue;

    let fieldValue: string;
    if (rule.matchField === "reference") {
      fieldValue = (transaction.reference ?? "").toLowerCase();
    } else {
      // description (default) or payee — use description
      fieldValue = transaction.description.toLowerCase();
    }

    const matchValue = rule.matchValue.toLowerCase();
    let matched = false;

    if (rule.matchType === "contains") {
      matched = fieldValue.includes(matchValue);
    } else if (rule.matchType === "exact") {
      matched = fieldValue === matchValue;
    } else if (rule.matchType === "starts_with") {
      matched = fieldValue.startsWith(matchValue);
    }

    if (matched) {
      return {
        accountCode: rule.accountCode,
        category: rule.category,
        taxRate: rule.taxRate,
        description: rule.description,
      };
    }
  }

  return null;
}
