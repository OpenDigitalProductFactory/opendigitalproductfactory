export type StanceAuthoringExamples = {
  title: string;
  body: string;
  summary: string;
};

type NonprofitStanceKey =
  | "customer-goodwill"
  | "pricing-integrity"
  | "growth-vs-stability"
  | "quality-bar"
  | "spend-authority";

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
