// Software-platform category marketing playbook (BI-3101AED6, EP-5CC9C184).
//
// Split from marketing-playbooks.ts, which sits near its module-size ceiling.
// Until this existed the software-platform category fell through to the generic
// "inquiry" fallback, and a coworker with an empty business context filled the
// gap by inventing a venture-backed engineering-leader buyer the business did
// not serve. A software business sells to the people who RUN on its product —
// often owner-operated businesses, often through partners — and that is what
// this playbook starts from.
//
// When the business's own offer is the platform itself, the buyer-archetype
// value catalog (lib/marketing/buyer-archetype-value.ts) adds the per-archetype
// benefits; this playbook stays the voice and motion for any software platform.

import type { MarketingPlaybook } from "./marketing-playbook-types";

export const SOFTWARE_PLATFORM_PLAYBOOK: MarketingPlaybook = {
  primaryGoal:
    "Win and keep customers who run real work on the product: qualified evaluations, successful adoption, and partners who bring and support customers",
  stakeholders:
    "Business owners and operators evaluating the product, existing customers and their teams, channel and implementation partners",
  campaignTypes: [
    "Problem-led education for one buyer type at a time — their day, not the product's internals",
    "Customer outcome stories with the customer's permission",
    "Guided evaluation and pilot offers",
    "Onboarding and adoption sequences for new customers",
    "Release notes framed as what changed for the customer",
    "Partner recruitment and partner enablement",
    "Expansion and renewal check-ins",
  ],
  contentTone:
    "Plain-spoken, concrete and honest about what is available today versus planned. Show the owner's outcome; keep implementation detail for those who ask",
  keyMetrics: [
    "Qualified evaluations started",
    "Evaluation-to-customer conversion",
    "Time to first value for new customers",
    "Customer retention and expansion",
    "Partner-sourced pipeline",
  ],
  ctaLanguage: ["Book a walkthrough", "Start a pilot", "Talk to us", "Become a partner"],
  agentSkills: [
    "Buyer-specific campaign brief",
    "Customer outcome story prompt",
    "Onboarding sequence draft",
    "Partner recruitment outreach",
  ],
  channelVehicles: [
    {
      channel: "Partner and reseller networks (MSPs, regional IT providers, consultancies)",
      purpose:
        "Reach owner-operated businesses through the provider they already trust for technology; the partner owns the relationship and first-line support",
    },
    {
      channel: "Industry associations and trade communities for the buyer's archetype",
      purpose: "Meet a buyer type where its owners already compare notes, in that trade's language",
    },
    {
      channel: "Product-led evaluation (demo environment, guided pilot)",
      purpose: "Let a buyer see their own kind of work handled before any commitment",
    },
  ],
  channelConstraints: [
    {
      channel: "All channels",
      constraint: "Do not present planned capability as available, or synthetic personas as real customers",
      rationale:
        "Software buyers check claims against a pilot; an overclaim found in evaluation costs the deal and the reference",
    },
  ],
  seedSegments: [
    { name: "Owner-operators evaluating the product", description: "Want their own kind of work handled, shown plainly" },
    { name: "Existing customers", description: "Want value fast and no surprises at renewal" },
    { name: "Channel and implementation partners", description: "Want recurring revenue and a product they can support" },
  ],
};
