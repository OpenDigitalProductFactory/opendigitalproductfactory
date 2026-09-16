import type { ArchetypeStanceVectors } from "./archetype-business-context";
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
  | "decision-scope"
  | "on-site-work-conduct";

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
  "on-site-work-conduct": {
    title: "Our people visiting someone we serve",
    stance:
      "Visiting someone where they live puts us in the most private place they have, often when they are least able to object. We know where a worker or volunteer is while they are on shift and on a visit — so a visit can be evidenced and so someone alone in a stranger's home can be reached — and never beyond it. Photographs are taken only when the programme genuinely requires them, never for fundraising unless that person agreed separately, and what we see of a household is not repeated outside the team.",
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

/**
 * Trade-specific wordings for the activity-triggered on-site stance
 * (BI-0902BAE9). Seeded only where the archetype actually sends people to a
 * customer's place, so none of these ever reaches a business it would puzzle.
 *
 * Written in each trade's own terms rather than paraphrasing one generic
 * paragraph: an owner should recognise their own working week in the words,
 * which is the difference between a platform that knows about AI coworkers and
 * one that knows about their business.
 */
export const ON_SITE_CONDUCT_BY_INDUSTRY: Record<string, StancePresentation> = {
  "trades-maintenance": {
    title: "Our people working in a customer's home",
    stance:
      "A customer lets us into their home on trust, and how we behave there is most of what they will say about us afterwards. We know where a job is and who is on it while they are clocked in and on that job — enough to dispatch, to prove we arrived, and to know a lone engineer got out safely — and not otherwise. Off shift we do not track anyone. Photos document the work and the condition we found it in, protect us both in a dispute, and go no further than the people doing and billing the job. What we see of someone's household stays in their household.",
  },
  "hoa-property-management": {
    title: "Working in shared property and residents' homes",
    stance:
      "Most people we encounter on a site never signed anything with us — they live there. Residents' details, unit histories and inspection photos are held for running and maintaining the property and for nothing else, and are never handed to a board member, a vendor or another resident because they asked. We record where our people are while they are on shift and on a job so we can dispatch and evidence attendance, not to watch them. A photo of a communal defect is a work record; a photo into someone's home is not taken at all unless the work requires it and they know.",
  },
  "security-services": {
    title: "Officers on a client's site",
    stance:
      "Patrol positions, checkpoint scans and incident footage exist to prove the service was delivered and to protect people, and they are held to that purpose. We know where an officer is while they are on shift and on post — that is the job, and it is also how we keep a lone officer safe — and we do not follow anyone off duty. Incident recordings capture people who are not our client and never agreed to anything, so they are kept as long as the incident needs and released only to someone entitled to them.",
  },
  "moving-and-logistics": {
    title: "Crews at a customer's address",
    stance:
      "We are in someone's house on the hardest day of their year, handling everything they own. We know where a vehicle and crew are while the job runs, so we can tell a customer the truth about timing and settle a dispute about what happened — not to score drivers after hours. Condition photos protect both sides and stay with the job file. What we learn about a household while emptying it is not a story we tell.",
  },
  "media-production": {
    title: "Shooting on location",
    stance:
      "A shoot captures people who never signed anything with us — passers-by, a venue's staff, someone's family. We film what the production needs, we tell people when we can, and footage of anyone incidental is not reused for something else because it happened to be in frame. Crew locations are known while a call sheet is running and not beyond it. Rushes stay inside the production until the client has them.",
  },
  "real-estate-construction": {
    title: "Our people on a client's site",
    stance:
      "Site presence is known while a crew is on shift and on that site — for dispatch, for proof of attendance, and because knowing who is on a site matters when something goes wrong. Not after hours. Progress photos evidence the work and the conditions, and go to the client and the file, not anywhere else. What we see of an occupied property stays with the job.",
  },
  "healthcare-wellness": {
    title: "Visiting someone at home",
    stance:
      "A home visit puts us in the most private place a person has, often when they are least able to object. We know where a visiting clinician is while they are on shift and on a visit — for scheduling and for their safety alone in someone's house — and never beyond it. Anything recorded is clinical record first and is governed as such; a photograph is taken only when care requires it. What we see of a household, a family member or a living situation is not repeated outside the care team.",
  },
  "pet-services": {
    title: "In a client's home with their animal",
    stance:
      "A key to someone's home and the care of their animal are the two things they trust us with most. We know where a walker or sitter is while a visit is running, so we can evidence the visit happened and reach them if something goes wrong — not otherwise. Photos and updates are for the owner's reassurance and the animal's record, and are not posted anywhere without them saying yes. What we notice about someone's home stays unmentioned.",
  },
};

export const INDUSTRY_STANCE_VECTORS: Record<string, Partial<ArchetypeStanceVectors>> = {
  "healthcare-wellness": {
    "customer-goodwill": {
      title: "When a patient's experience goes wrong",
      stance:
        "A failure in a patient's experience gets a same-day response and a genuine fix — rebook first, waive or comp where we fell short, and tell the owner the same day. Never argue with a patient over a fee we caused.",
      ceilingUsd: 150,
    },
    "quality-bar": {
      title: "Our care standard",
      stance:
        "Patient safety and clinical quality are never traded for speed or margin. If care or service slips below our standard, we correct it at our cost and say so plainly.",
    },
    "spend-authority": {
      title: "Spending without asking",
      stance:
        "Recurring clinical and office supplies reorder without the owner up to the ceiling per purchase — a stock-out can delay care. New equipment, new vendors, or anything above the ceiling goes to the owner.",
      ceilingUsd: 500,
    },
  },
  "food-hospitality": {
    "customer-goodwill": {
      title: "When a guest's visit goes wrong",
      stance:
        "Fix the visit while the guest is still at the table: remake or comp the dish, not the argument. Staff resolve it on the spot within the ceiling; a comped meal that wins the next three visits is cheap.",
      ceilingUsd: 60,
    },
    "quality-bar": {
      title: "What leaves the pass",
      stance:
        "Food safety and cleanliness are never negotiable. If a plate isn't right, it doesn't leave the pass — and if it did, we remake it without debate.",
    },
  },
  "retail-goods": {
    "customer-goodwill": {
      title: "Returns, damage, and our mistakes",
      stance:
        "If we shipped it wrong, late, or broken, we replace or refund without friction within the ceiling — the customer should not pay for our mistake. Habitual-abuse cases go to the owner rather than becoming policy.",
      ceilingUsd: 75,
    },
    "spend-authority": {
      title: "Restocking without asking",
      stance:
        "Reorders of proven sellers within budget proceed without the owner up to the ceiling per order. New lines, new suppliers, or bulk buys above it are the owner's call — stock ties up cash.",
      ceilingUsd: 200,
    },
  },
  "professional-services": {
    "customer-goodwill": {
      title: "When our work misses the mark",
      stance:
        "When our advice or work falls short, we remediate with more of our own work first, a credit second, and a refund only when trust demands it. The relationship compounds over years; the fix should protect it.",
      ceilingUsd: 250,
    },
    "pricing-integrity": {
      title: "Fees, scope, and discounts",
      stance:
        "We honor quoted fees and absorb our own estimating mistakes on the current engagement while correcting them for the next one. We do not discount below the cost of doing the work well — a cheap engagement done badly costs the reputation.",
    },
  },
  "banking-financial-services": {
    "customer-goodwill": {
      title: "When we make an account error",
      stance:
        "Fees or charges caused by our error are reversed promptly within the ceiling and documented. Anything touching disclosures, rates, or regulated terms goes to the owner — goodwill never bends compliance.",
      ceilingUsd: 100,
    },
    "pricing-integrity": {
      title: "Rates, terms, and exceptions",
      stance:
        "Rate and term claims always match what we actually offer, and required disclosures stay attached. There are no improvised pricing exceptions — every exception is an owner decision with a record.",
    },
  },
  "trades-maintenance": {
    "customer-goodwill": {
      title: "Callbacks and our mistakes",
      stance:
        "A callback on our own work is priority scheduling and free within the ceiling — we stand behind the work. If the fault is genuinely not ours, we say so honestly and quote the real job.",
      ceilingUsd: 150,
    },
    "spend-authority": {
      title: "Parts and van stock without asking",
      stance:
        "Parts and materials needed to finish a booked job proceed without the owner up to the ceiling — a second trip costs more than the part. Tools, equipment, and new suppliers are the owner's call.",
      ceilingUsd: 300,
    },
  },
  "fabric-care-services": {
    "customer-goodwill": {
      title: "When a garment order goes wrong",
      stance:
        "If we lose, damage, delay, or misroute a customer's garment through our mistake, we respond quickly, explain plainly, and make it right with redo, repair, credit, or refund within the ceiling. Anything involving a high-value or sentimental item goes to the owner.",
      ceilingUsd: 150,
    },
    "growth-vs-stability": {
      title: "New volume vs ready promises",
      stance:
        "Existing claim tickets and ready promises get first call on plant capacity. We take new volume at the pace the plant and workroom can process accurately, not faster.",
    },
    "quality-bar": {
      title: "Our garment-care standard",
      stance:
        "A garment does not leave below our standard. If cleaning, pressing, folding, repair, tagging, or packaging is wrong, we fix it before handoff or tell the customer early.",
    },
    "spend-authority": {
      title: "Spending without asking",
      stance:
        "Routine cleaning supplies, tags, hangers, bags, and urgent minor equipment fixes can proceed without the owner up to the ceiling. New equipment, new vendors, or anything above it goes to the owner.",
      ceilingUsd: 300,
    },
  },
  "agriculture-ranching": {
    "customer-goodwill": {
      title: "When our product or handling falls short",
      stance:
        "If our description, handling, timing, or quality is wrong, we say so promptly and offer a practical correction within the ceiling. Animal-welfare, food-safety, title, or high-value disputes go to the owner immediately.",
      ceilingUsd: 250,
    },
    "pricing-integrity": {
      title: "Quotes in a moving market",
      stance:
        "We state what a quote covers, how long it is valid, and which weight, grade, quality, delivery, or market facts can change it. We do not hide uncertainty or rewrite agreed terms after the fact.",
      ceilingUsd: 250,
    },
    "growth-vs-stability": {
      title: "More acres or animals vs resilient capacity",
      stance:
        "Land condition, feed and water, animal care, labor, equipment, cash, and outside-service capacity set the safe growth rate. We do not add production faster than those systems can carry it through a poor-weather year.",
    },
    "quality-bar": {
      title: "Our stewardship and welfare standard",
      stance:
        "Animal welfare, label compliance, traceable records, safe equipment, and honest product condition are never traded for speed or a sale. Stop and escalate when the record, label, withdrawal interval, forecast, or qualified advice is missing.",
    },
    "spend-authority": {
      title: "Routine seasonal spending without asking",
      stance:
        "Budgeted feed, seed, consumables, routine parts, and scheduled animal or equipment care may proceed within the ceiling. New chemicals, major repairs, new vendors, capital equipment, and unbudgeted commitments go to the owner.",
      ceilingUsd: 500,
    },
  },
  "manufacturing": {
    "customer-goodwill": {
      title: "When our product or delivery falls short",
      stance:
        "We contain the issue, protect the customer's operation, and preserve the evidence before debating fault. Routine freight, replacement, or rework remedies may proceed within the ceiling; safety, systemic, or material warranty exposure goes to the owner and quality authority.",
      ceilingUsd: 500,
    },
    "pricing-integrity": {
      title: "Quotes, configurations, and change control",
      stance:
        "A quote states configuration, quantity, lead time, validity, exclusions, and acceptance basis. Scope or revision changes become an explicit change, never a quiet reduction in what was promised.",
    },
    "growth-vs-stability": {
      title: "New orders vs released capacity",
      stance:
        "Released customer commitments get first call on qualified material, people, equipment, and test capacity. We accept new demand at the rate the constraint and quality system can carry, not the rate the order book can hide.",
    },
    "quality-bar": {
      title: "Our release standard",
      stance:
        "Nonconforming work is identified, contained, and dispositioned by authorized people. Missing, stale, or uncertain evidence is not a pass, and schedule pressure never authorizes an unrecorded deviation.",
    },
    "spend-authority": {
      title: "Routine production spending without asking",
      stance:
        "Approved replenishment, ordinary consumables, calibration, and routine maintenance may proceed within budget and the ceiling. New suppliers, tooling, capital equipment, design changes, and unplanned commitments go to the owner.",
      ceilingUsd: 1000,
    },
  },
  "automotive-services": {
    "customer-goodwill": {
      title: "When our repair doesn't hold",
      stance:
        "If our part or work fails, we return and make it right free within the ceiling, at the customer's location, at the next available slot. Safety-related comebacks jump the queue.",
      ceilingUsd: 150,
    },
  },
  "software-platform": SOFTWARE_PLATFORM_STANCE_VECTORS,
  "education-training": {
    "customer-goodwill": {
      title: "When we fail a learner or family",
      stance:
        "If we cancel, misschedule, or under-deliver, we make the learner whole first — a make-up session or credit within the ceiling — and tell the family before they ask.",
      ceilingUsd: 100,
    },
  },
  "public-sector": {
    "customer-goodwill": {
      title: "When we get it wrong with a resident",
      stance:
        "Errors are corrected through the published process, equally for every resident — fee waivers and remedies follow the schedule, not discretion. Transparency about the mistake is part of the remedy.",
    },
    "pricing-integrity": {
      title: "Fees and charges",
      stance:
        "Fees are set in public session and applied uniformly. There are no discounts or improvised exceptions — changing a fee is a public decision, not a service gesture.",
    },
  },
  "nonprofit-community": NONPROFIT_STANCE_VECTORS,
};
