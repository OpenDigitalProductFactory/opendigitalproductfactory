import type { ArchetypeDefinition } from "../types";

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "notes", label: "Message", type: "textarea" as const, required: false },
];

const DONATION_FORM_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "donationAmount", label: "Donation amount", type: "select" as const, required: true, options: ["£5", "£10", "£25", "£50", "£100", "Other"] },
  { name: "customAmount", label: "Custom amount (£)", type: "text" as const, required: false, placeholder: "e.g. 30" },
  { name: "campaignId", label: "Campaign", type: "text" as const, required: false },
  { name: "isAnonymous", label: "Make donation anonymous?", type: "select" as const, required: false, options: ["No", "Yes"] },
  { name: "notes", label: "Message", type: "textarea" as const, required: false },
];

export const nonprofitCommunityArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "pet-rescue",
    name: "Pet Rescue",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["rescue", "animals", "charity", "adoption"],
    itemTemplates: [
      { name: "Sponsor an Animal", description: "Monthly sponsorship to support an animal in our care", priceType: "donation", ctaType: "donation" },
      { name: "One-off Donation", description: "A one-time gift to help us care for rescued animals", priceType: "donation", ctaType: "donation" },
      { name: "Monthly Giving", description: "Set up a regular monthly donation", priceType: "donation", ctaType: "donation" },
      { name: "Adopt a Pet", description: "Give a rescued animal a forever home", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "animals-available", title: "Animals Available for Adoption", sortOrder: 1 },
      { type: "items", title: "Support Us", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "donate", title: "Make a Donation", sortOrder: 4 },
      { type: "contact", title: "Get in Touch", sortOrder: 5 },
    ],
    formSchema: DONATION_FORM_FIELDS,
  },
  {
    archetypeId: "animal-shelter",
    name: "Animal Shelter",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["shelter", "animals", "charity", "adoption"],
    itemTemplates: [
      { name: "Sponsor an Animal", description: "Support a specific animal in our shelter monthly", priceType: "donation", ctaType: "donation" },
      { name: "One-off Donation", description: "Help us cover food, vet bills, and care costs", priceType: "donation", ctaType: "donation" },
      { name: "Monthly Giving", description: "Set up a regular monthly gift", priceType: "donation", ctaType: "donation" },
      { name: "Volunteer Sign-up", description: "Give your time to help animals in need", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "animals-available", title: "Find Your Perfect Pet", sortOrder: 1 },
      { type: "items", title: "Ways to Help", sortOrder: 2 },
      { type: "about", title: "About the Shelter", sortOrder: 3 },
      { type: "donate", title: "Donate Now", sortOrder: 4 },
      { type: "contact", title: "Contact Us", sortOrder: 5 },
    ],
    formSchema: DONATION_FORM_FIELDS,
  },
  {
    archetypeId: "community-shelter",
    name: "Community Shelter",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["shelter", "homelessness", "community", "charity"],
    itemTemplates: [
      { name: "Emergency Fund Donation", description: "Help provide immediate support to those in crisis", priceType: "donation", ctaType: "donation" },
      { name: "Volunteer Sign-up", description: "Give your time to support shelter residents", priceType: "free", ctaType: "inquiry" },
      { name: "Supply Donation", description: "Donate clothing, food, or essential supplies", priceType: "donation", ctaType: "donation" },
      { name: "Corporate Partnership", description: "Partner with us to support our community mission", priceType: "quote", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "How You Can Help", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "donate", title: "Donate", sortOrder: 3 },
      { type: "contact", title: "Get Involved", sortOrder: 4 },
    ],
    formSchema: DONATION_FORM_FIELDS,
  },
  {
    archetypeId: "charity",
    name: "Charity",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["charity", "donation", "fundraising", "nonprofit"],
    itemTemplates: [
      { name: "Make a Donation", description: "Your gift makes a real difference", priceType: "donation", ctaType: "donation" },
      { name: "Become a Regular Donor", description: "Set up a monthly gift and multiply your impact", priceType: "donation", ctaType: "donation" },
      { name: "Fundraising Pack", description: "Get everything you need to fundraise on our behalf", priceType: "free", ctaType: "inquiry" },
      { name: "In Memory Giving", description: "Donate in memory of a loved one", priceType: "donation", ctaType: "donation" },
      { name: "Corporate Giving", description: "Partner with us for a charity of the year campaign", priceType: "quote", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "Our Mission", sortOrder: 1 },
      { type: "items", title: "Ways to Give", sortOrder: 2 },
      { type: "donate", title: "Donate Now", sortOrder: 3 },
      { type: "contact", title: "Get in Touch", sortOrder: 4 },
    ],
    formSchema: DONATION_FORM_FIELDS,
  },
  {
    archetypeId: "sports-club",
    name: "Sports Club",
    category: "nonprofit-community",
    ctaType: "purchase",
    tags: ["sports", "club", "membership", "community"],
    itemTemplates: [
      { name: "Annual Membership", description: "Full club membership for one year", priceType: "fixed", ctaType: "purchase" },
      { name: "Family Membership", description: "Membership for up to 2 adults and 3 children", priceType: "fixed", ctaType: "purchase" },
      { name: "Junior Membership", description: "Membership for under-18s", priceType: "fixed", ctaType: "purchase" },
      { name: "Match Day Ticket", description: "Single match admission ticket", priceType: "fixed", ctaType: "purchase" },
      { name: "Social Membership", description: "Non-playing social membership", priceType: "fixed", ctaType: "purchase" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Memberships", sortOrder: 1 },
      { type: "about", title: "About the Club", sortOrder: 2 },
      { type: "team", title: "Club Officials", sortOrder: 3 },
      { type: "contact", title: "Join the Club", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "membershipType", label: "Membership type", type: "select" as const, required: true, options: ["Adult", "Family", "Junior", "Social", "Student"] },
      { name: "position", label: "Playing position / role (if applicable)", type: "text" as const, required: false },
    ],
  },
];
