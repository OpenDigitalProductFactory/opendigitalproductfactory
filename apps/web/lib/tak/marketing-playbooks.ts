// apps/web/lib/tak/marketing-playbooks.ts
// Archetype-aware marketing strategies keyed by storefront CTA type.
// Injected into the Marketing Specialist agent's PAGE DATA via route-context.ts.

export type MarketingPlaybook = {
  primaryGoal: string;
  campaignTypes: string[];
  contentTone: string;
  keyMetrics: string[];
  ctaLanguage: string[];
};

export const ARCHETYPE_PLAYBOOKS: Record<string, MarketingPlaybook> = {
  booking: {
    primaryGoal: "Maximize appointment fill rate and customer recall",
    campaignTypes: [
      "Recall campaigns (follow-up for overdue visits)",
      "Referral programs (bring a friend)",
      "Seasonal capacity optimization (fill quiet periods)",
      "New service announcements",
      "Waitlist conversion (notify when slots open)",
      "No-show follow-up and rebooking",
    ],
    contentTone: "Reassuring, professional, health/wellness-oriented",
    keyMetrics: [
      "Appointment fill rate",
      "Recall rate (returning customers)",
      "Cancellation rate",
      "Average time between visits",
      "New vs returning customer ratio",
    ],
    ctaLanguage: ["Book now", "Schedule your appointment", "Reserve your slot"],
  },

  purchase: {
    primaryGoal: "Increase order frequency and average order value",
    campaignTypes: [
      "Product launches and new arrivals",
      "Seasonal collections and themed promotions",
      "Flash sales and limited-time offers",
      "Loyalty and repeat-buyer programs",
      "Bundle promotions and upsell offers",
      "Gift guides and seasonal gifting",
    ],
    contentTone: "Aspirational, trend-aware, visual-first",
    keyMetrics: [
      "Order volume (daily/weekly trend)",
      "Average order value (AOV)",
      "Repeat purchase rate",
      "Product mix (top sellers vs slow movers)",
      "Revenue per customer",
    ],
    ctaLanguage: ["Shop now", "Add to basket", "Order today", "Browse collection"],
  },

  inquiry: {
    primaryGoal: "Generate qualified leads through trust and thought leadership",
    campaignTypes: [
      "Case studies and success stories",
      "Testimonial spotlights",
      "Before-and-after showcases",
      "Educational content and how-to guides",
      "Lead magnets (free consultations, assessments)",
      "FAQ content addressing common questions",
    ],
    contentTone: "Authoritative, trust-building, problem-solution oriented",
    keyMetrics: [
      "Inquiry volume (weekly trend)",
      "Response time to inquiries",
      "Inquiry-to-opportunity conversion rate",
      "Content engagement (views, shares)",
      "Quote request rate",
    ],
    ctaLanguage: ["Get a quote", "Book a consultation", "Contact us", "Request a callback"],
  },

  donation: {
    primaryGoal: "Grow donor base and increase gift frequency",
    campaignTypes: [
      "Impact stories (your donation provided...)",
      "Donor stewardship and thank-you campaigns",
      "Fundraising events and appeals",
      "Recurring giving drives (monthly donor programs)",
      "Corporate partnership outreach",
      "Seasonal giving campaigns (end-of-year, holidays)",
    ],
    contentTone: "Emotive, transparent, mission-focused, gratitude-first",
    keyMetrics: [
      "Donation volume (monthly trend)",
      "Donor retention rate",
      "Average gift size",
      "Recurring donor count",
      "Campaign goal progress (%)",
    ],
    ctaLanguage: ["Donate now", "Support our mission", "Give monthly", "Make a difference"],
  },

  mixed: {
    primaryGoal: "Balance booking fill with product/service promotion",
    campaignTypes: [
      "Workshop and class enrollments",
      "Table reservations and event bookings",
      "Product and course material promotion",
      "Gift voucher and package deals",
      "Community events and open days",
      "Seasonal menus or course schedules",
    ],
    contentTone: "Engaging, informative, community-oriented",
    keyMetrics: [
      "Booking fill rate",
      "Order volume",
      "Combined revenue trend",
      "New customer acquisition",
      "Cross-sell rate (bookers who also purchase)",
    ],
    ctaLanguage: ["Book now", "Order today", "Join us", "Reserve your place"],
  },
};

/** Look up the playbook for a given CTA type, defaulting to inquiry. */
export function getPlaybookForCtaType(ctaType: string | null | undefined): MarketingPlaybook {
  return ARCHETYPE_PLAYBOOKS[ctaType ?? "inquiry"] ?? ARCHETYPE_PLAYBOOKS["inquiry"]!;
}
