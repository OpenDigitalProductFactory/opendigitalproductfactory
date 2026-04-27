import type { ArchetypeDefinition } from "../types";

const PLATFORM_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Work email", type: "email" as const, required: true },
  { name: "companyName", label: "Company name", type: "text" as const, required: false },
  {
    name: "teamSize",
    label: "Team size",
    type: "select" as const,
    required: false,
    options: ["1-10", "11-50", "51-200", "201-1000", "1000+"],
  },
  {
    name: "currentSituation",
    label: "What are you trying to improve?",
    type: "textarea" as const,
    required: false,
  },
];

export const softwarePlatformArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "software-platform",
    name: "Software Platform",
    category: "software-platform",
    ctaType: "inquiry",
    tags: ["software", "platform", "operations", "ai", "workflow"],
    itemTemplates: [
      {
        name: "Open Digital Product Factory",
        description: "AI-native platform for operating, improving, and governing digital product delivery.",
        priceType: "quote",
        ctaType: "inquiry",
        ctaLabel: "Start a conversation",
      },
      {
        name: "DPF Customer-Zero Workshop",
        description: "Map your runtime, delivery, and customer-zero operating model before rollout.",
        priceType: "quote",
        ctaType: "inquiry",
        ctaLabel: "Plan adoption",
      },
      {
        name: "Governed Build Studio Enablement",
        description: "Stand up isolated build, verification, and promotion flow for your product teams.",
        priceType: "quote",
        ctaType: "inquiry",
        ctaLabel: "Review workflow",
      },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Platform Offers", sortOrder: 1 },
      { type: "about", title: "How DPF Runs DPF", sortOrder: 2 },
      { type: "testimonials", title: "Proof & Outcomes", sortOrder: 3 },
      { type: "contact", title: "Talk to Us", sortOrder: 4 },
    ],
    formSchema: PLATFORM_CONTACT_FIELDS,
  },
];
