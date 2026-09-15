export type StanceAuthoringExamples = {
  title: string;
  body: string;
  summary: string;
};

// Kept as a local union rather than reusing StanceVectorKey so this module
// stays free of a circular import; the parity test pins the two together, so a
// vector added upstream fails here loudly instead of silently falling back to
// the commercial generic wording (BI-7728C3B7).
type NonprofitStanceKey =
  | "customer-goodwill"
  | "pricing-integrity"
  | "growth-vs-stability"
  | "quality-bar"
  | "spend-authority"
  | "data-handling"
  | "routine-operations"
  | "decision-scope";

type StancePresentation = {
  title: string;
  stance: string;
  ceilingUsd?: number;
};

export const NONPROFIT_STANCE_VECTORS: Record<NonprofitStanceKey, StancePresentation> = {
  "customer-goodwill": {
    title: "When we let someone we serve down",
    stance:
      "When our organization lets down people we serve, supporters, volunteers, or partners, we acknowledge it quickly and make a practical repair without making them fight for it. Safety, safeguarding, or material trust concerns go to the director immediately.",
  },
  "pricing-integrity": {
    title: "Access, eligibility, and contributions",
    stance:
      "We state eligibility, suggested contributions, and what our programs provide clearly. Ability to contribute never buys priority, bends mission criteria, or quietly changes a commitment.",
  },
  "growth-vs-stability": {
    title: "New opportunities vs existing commitments",
    stance:
      "Commitments to people we already serve and the cause at the heart of our mission get first call on capacity. We accept new opportunities only at the pace our people, funding, and duty of care can sustain.",
  },
  "quality-bar": {
    title: "Our service and stewardship standard",
    stance:
      "Our work protects the wellbeing, dignity, and trust of the people and cause we serve. If delivery or stewardship falls below that standard, we correct it openly and learn before repeating it.",
  },
  "spend-authority": {
    title: "Spending donors' money without asking",
    stance:
      "Program supplies within the approved budget proceed up to the ceiling per purchase. Anything outside budget or above it goes to the director — every dollar carries a donor's trust.",
    ceilingUsd: 150,
  },
  // BI-7728C3B7. The three vectors onboarding now seeds, in this sector's own
  // vocabulary — the generic wording is written for a commercial business and
  // would put "customer" in front of an organisation that has none.
  "data-handling": {
    title: "Personal information about the people we serve",
    stance:
      "Information about the people we serve, our volunteers, and our supporters is held in trust and treated as sensitive by default. We collect the least the programme actually needs, tell people what we hold and why, and use it only for the purpose it was given for. Information about someone we serve is never turned to fundraising unless they agreed to that separately, and any new purpose for information we already hold is a fresh decision.",
  },
  "routine-operations": {
    title: "What the team just gets on with",
    stance:
      "The ordinary running of our programmes proceeds without asking: scheduling, record-keeping, internal reporting, and the normal steps of work already agreed. Asking about these spends the time our mission is funded for. Anything that reaches a supporter, a funder, or the public for the first time, commits restricted funds or a promise, or is hard to undo is not routine.",
  },
  "decision-scope": {
    title: "Which decisions are ours to make",
    stance:
      "We decide what this organisation owns: which needs we take on, who we serve, what we promise, how we steward the funds entrusted to us, and how we treat the people in our care. Questions of professional or legal craft go to the person qualified in that craft, and a funder's own requirements are theirs to set. When a question is not ours, the answer is to route it, not to guess — and a question we cannot answer yet because the facts are missing needs the research first, not a decision.",
  },
};

const GENERIC_STANCE_AUTHORING_EXAMPLES: StanceAuthoringExamples = {
  title: "How we decide refunds",
  body: "We refund within 30 days, no questions asked. Beyond 30 days a manager decides based on the account relationship.",
  summary: "30-day no-questions refunds; manager discretion after",
};

const NONPROFIT_STANCE_AUTHORING_EXAMPLES: StanceAuthoringExamples = {
  title: "How we prioritize limited support",
  body: "We use our published mission and eligibility criteria consistently. Urgent need comes first; a larger contribution never buys priority. When capacity is full, the director decides and we explain the constraint plainly.",
  summary: "Mission and need set priority; contributions do not",
};

export function resolveStanceAuthoringExamples(input: {
  industry?: string | null;
}): StanceAuthoringExamples {
  return input.industry === "nonprofit-community"
    ? NONPROFIT_STANCE_AUTHORING_EXAMPLES
    : GENERIC_STANCE_AUTHORING_EXAMPLES;
}

/**
 * Software-platform stance wordings. Lifted out of archetype-business-context
 * alongside the nonprofit set so that file stays under the module-size ceiling
 * and each sector's voice lives with the other presentation copy.
 */
export const SOFTWARE_PLATFORM_STANCE_VECTORS: Partial<Record<NonprofitStanceKey, StancePresentation>> = {
    "customer-goodwill": {
      title: "When our product or billing fails a customer",
      stance:
        "Outages, bugs, and billing errors on our side are credited or refunded without friction within the ceiling, and we say plainly what went wrong. A long-time customer harmed by our mistake is restored first, reconciled second.",
      ceilingUsd: 200,
    },
    "growth-vs-stability": {
      title: "New features vs reliability",
      stance:
        "Reliability and existing-customer success outrank new-feature velocity — churn from broken trust costs more than a delayed launch. We ship new capability at the pace uptime and support quality allow.",
    },
      "data-handling": {
      title: "Customer data we run on",
      stance:
        "Customer data is held in trust: we use it to run and support the product they bought, never as a side input to something they did not agree to. We collect the minimum the feature needs, scope access to the people doing the work rather than the whole organization, and keep derived results rather than raw personal data when the derivation was the point. A new use of existing data is a fresh decision, and the lawful basis is resolved for the jurisdiction we are actually in, not assumed globally.",
    },
    "routine-operations": {
      title: "What ships without asking",
      stance:
        "Ordinary product and platform work proceeds without the owner: development, testing, deployment through the normal gates, monitoring, and support responses within documented behaviour. These are how the business runs, not decisions it needs to weigh. Anything that changes what customers are promised, touches their data in a new way, spends beyond budget, or communicates outward on the company's behalf is not routine.",
    },
    "decision-scope": {
      title: "Which decisions are ours to make",
      stance:
        "We decide our own product direction, pricing, who we serve, what we promise about reliability and data, and how we treat customers. We do not decide on our customers' behalf how their business should run — a question about a customer's own operations belongs to that customer. Platform engineering trade-offs are settled on engineering merit, and legal, privacy, or regulatory questions go to the qualified craft rather than to business preference. When the facts needed to answer are not established, the next step is the research, not a ruling.",
    },
};
