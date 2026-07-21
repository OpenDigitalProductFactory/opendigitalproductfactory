// apps/web/lib/tak/marketing-playbooks.ts
// Category-level marketing strategies keyed by archetype category.
// Each business model has distinct marketing objectives, stakeholders, and engagement patterns.

export type MarketingPlaybook = {
  primaryGoal: string;
  stakeholders: string;
  campaignTypes: string[];
  contentTone: string;
  keyMetrics: string[];
  ctaLanguage: string[];
  agentSkills: string[];
};

// ─── Category-Based Playbooks (primary lookup) ─────────────────────────────

const CATEGORY_PLAYBOOKS: Record<string, MarketingPlaybook> = {
  "hoa-property-management": {
    primaryGoal: "Homeowner engagement, bylaw compliance, and community satisfaction",
    stakeholders: "Homeowners, board members, subcontractors, property managers",
    campaignTypes: [
      "Bylaw change announcements and community voting notices",
      "Special assessment notices with justification",
      "Community meeting invitations and agenda previews",
      "Seasonal maintenance reminders (landscaping, pool opening, snow removal)",
      "Amenity reservation promotions and rule updates",
      "Subcontractor introduction and work schedule notices",
      "Annual budget communications and financial transparency reports",
      "Emergency notifications (weather, safety, utility)",
    ],
    contentTone: "Official, transparent, community-minded, action-oriented",
    keyMetrics: [
      "Assessment collection rate",
      "Meeting attendance rate",
      "Maintenance request response time",
      "Homeowner satisfaction score",
      "Communication open/read rate",
    ],
    ctaLanguage: ["Submit request", "Reserve amenity", "View announcement", "Pay assessment"],
    agentSkills: ["Draft community announcement", "Prepare assessment notice", "Summarise maintenance requests", "Board meeting agenda"],
  },

  "banking-financial-services": {
    primaryGoal: "Deepen customer and member relationships through trust, financial education, and product awareness — within regulated-communication boundaries",
    stakeholders: "Customers/members, local businesses, community organizations, regulators",
    campaignTypes: [
      "Rate and product announcements (APY/APR figures must match current published rates — Reg DD / Reg Z accuracy)",
      "Financial education series (budgeting, fraud awareness, first-home buying)",
      "Branch and service updates (hours, new services, appointment availability)",
      "Community involvement and local sponsorship stories",
      "New account and membership onboarding sequences",
      "Security and fraud-alert notices",
      "Required-disclosure-bearing product promotions (Member FDIC / NCUA insurance, Equal Housing)",
    ],
    contentTone: "Trustworthy, clear, factual, community-anchored — never urgency-pressure or unverifiable claims",
    keyMetrics: [
      "New account / membership applications",
      "Appointment bookings with bankers or advisors",
      "Product inquiry conversion rate",
      "Financial education engagement",
      "Customer/member retention rate",
    ],
    ctaLanguage: ["Open an account", "Apply now", "Check today's rates", "Meet with a banker", "Become a member"],
    agentSkills: ["Draft rate announcement", "Financial education article", "Branch notice", "Fraud awareness alert"],
  },

  "asset-rental": {
    primaryGoal: "Keep the rentable pool utilized — drive reservations, fill off-peak, and recover repeat renters",
    stakeholders: "Renters (contractors, event organizers, households), members (co-op), local trade networks",
    campaignTypes: [
      "Seasonal availability pushes (event season, harvest, moving season)",
      "Off-peak / midweek promotions to lift utilization",
      "New-equipment-in-the-pool announcements",
      "Reservation reminders and return-due nudges",
      "Deposit/damage-policy and how-it-works explainers",
      "Repeat-renter loyalty and membership offers",
      "Last-minute availability alerts for high-demand items",
    ],
    contentTone: "Practical, availability-forward, trustworthy about condition and deposits",
    keyMetrics: [
      "Asset-utilization %",
      "Reservation conversion rate",
      "Turnaround time between rentals",
      "Overdue-return rate",
      "Repeat-renter rate",
    ],
    ctaLanguage: ["Reserve now", "Check availability", "Book your dates", "Join the waitlist"],
    agentSkills: ["Draft availability push", "Off-peak promotion", "Return-due reminder", "New-equipment announcement"],
  },

  "public-sector": {
    primaryGoal: "Resident awareness, participation, and trust through transparent civic communication",
    stakeholders: "Residents, council members, town staff, local businesses, neighboring jurisdictions",
    campaignTypes: [
      "Council and board meeting notices with agenda previews",
      "Public hearing and comment-period announcements",
      "Service disruption and road work notices",
      "Seasonal reminders (leaf pickup, snow routes, hydrant flushing)",
      "Budget season and levy communications with plain-language summaries",
      "Permit and licensing deadline reminders",
      "Community event and parks programming announcements",
      "Emergency notifications (weather, water, public safety)",
    ],
    contentTone: "Official, plain-language, neutral, accessible to every resident",
    keyMetrics: [
      "Meeting attendance and public-comment participation",
      "Service request response time",
      "Records request on-time completion rate",
      "Notice reach (open/read rate)",
      "Resident satisfaction",
    ],
    ctaLanguage: ["Report an issue", "View the agenda", "Request records", "Apply for a permit"],
    agentSkills: ["Draft meeting notice", "Plain-language budget summary", "Service disruption notice", "Public hearing announcement"],
  },

  "professional-services": {
    primaryGoal: "Build authority pipeline through expertise demonstration and client nurture",
    stakeholders: "Clients, prospects, referral partners, industry contacts",
    campaignTypes: [
      "Thought leadership articles and industry insights",
      "Client case studies and success stories",
      "Regulatory and compliance update alerts",
      "Webinar and event invitations",
      "Industry benchmark reports",
      "Referral partner programme communications",
      "Client satisfaction surveys",
      "Retainer renewal reminders",
    ],
    contentTone: "Authoritative, consultative, insight-driven",
    keyMetrics: [
      "Inquiry-to-engagement conversion rate",
      "Average engagement value",
      "Client retention rate",
      "Referral rate",
      "Content engagement (views, downloads, shares)",
    ],
    ctaLanguage: ["Book a consultation", "Request a proposal", "Download our guide", "Refer a colleague"],
    agentSkills: ["Draft case study brief", "Client retention review", "Pipeline health check", "Referral programme ideas"],
  },

  "trades-maintenance": {
    primaryGoal: "Be the first call for emergency and planned work in the local area",
    stakeholders: "Property owners, landlords, letting agents, commercial property managers",
    campaignTypes: [
      "Emergency availability reminders",
      "Seasonal maintenance checklists (boiler before winter, gutter clearing in autumn)",
      "Before-and-after project showcases",
      "Landlord certificate reminders (gas safety, EICR, PAT testing)",
      "Loyalty discounts for repeat customers",
      "Local area leaflet and social media campaigns",
    ],
    contentTone: "Practical, trustworthy, local, responsive",
    keyMetrics: [
      "Response time to inquiries",
      "Quote-to-job conversion rate",
      "Repeat customer rate",
      "Average job value",
      "Review/rating score",
    ],
    ctaLanguage: ["Request a quote", "Emergency call-out", "Book a service", "Get a free estimate"],
    agentSkills: ["Seasonal campaign ideas", "Review response drafting", "Landlord certificate reminder list", "Quote follow-up suggestions"],
  },

  "healthcare-wellness": {
    primaryGoal: "Maximise patient recall compliance and preventive care uptake",
    stakeholders: "Patients, carers/guardians, referring practitioners, insurers",
    campaignTypes: [
      "Recall reminders (check-up overdue, vaccination due, annual screening)",
      "New patient welcome sequences",
      "Seasonal health advice (flu season, summer injuries, allergy season)",
      "New service or practitioner announcements",
      "Practice milestone celebrations",
      "Patient survey and feedback requests",
    ],
    contentTone: "Reassuring, professional, health-focused, empathetic",
    keyMetrics: [
      "Recall compliance rate",
      "New patient acquisition",
      "Appointment fill rate",
      "Cancellation/DNA rate",
      "Patient satisfaction score",
    ],
    ctaLanguage: ["Book your check-up", "Schedule your appointment", "Register as a patient", "Book now"],
    agentSkills: ["Recall campaign setup", "New patient welcome sequence", "Seasonal health content", "Practice growth review"],
  },

  "food-hospitality": {
    primaryGoal: "Fill covers during quiet periods and promote seasonal offerings",
    stakeholders: "Diners, event organisers, corporate clients, food critics/reviewers",
    campaignTypes: [
      "Seasonal menu launches and tasting events",
      "Special event promotions (Valentine's, Mother's Day, Christmas)",
      "Midweek and lunchtime offers to fill quiet periods",
      "Private dining and event packages",
      "Loyalty and regulars programme",
      "Review response and reputation management",
      "Local food event and festival participation",
    ],
    contentTone: "Warm, appetising, social, experiential",
    keyMetrics: [
      "Covers per service (lunch vs dinner)",
      "Booking fill rate",
      "No-show rate",
      "Average spend per head",
      "Repeat visit rate",
    ],
    ctaLanguage: ["Reserve a table", "View our menu", "Book an event", "Order now"],
    agentSkills: ["Seasonal menu promotion ideas", "Event package marketing", "Quiet period campaign", "Review response drafting"],
  },

  "education-training": {
    primaryGoal: "Drive enrolments and demonstrate learning outcomes",
    stakeholders: "Students, parents/guardians (for minors), employers (corporate), schools (referral)",
    campaignTypes: [
      "New term and course launch announcements",
      "Early-bird enrolment discounts",
      "Student success stories and exam results",
      "Open day and taster session invitations",
      "Corporate training ROI case studies",
      "Exam season preparation campaigns",
      "Sibling and group discounts",
      "Alumni network engagement",
    ],
    contentTone: "Encouraging, achievement-focused, credible, supportive",
    keyMetrics: [
      "Enrolment rate per term",
      "Student retention term-over-term",
      "Course completion rate",
      "Student satisfaction/NPS",
      "Referral rate",
    ],
    ctaLanguage: ["Enrol now", "Book a taster session", "View courses", "Register your interest"],
    agentSkills: ["Term launch campaign", "Student success content brief", "Open day promotion", "Retention analysis"],
  },

  "nonprofit-community": {
    primaryGoal: "Grow and retain donor base while engaging volunteers and raising awareness",
    stakeholders: "Donors (one-off, recurring, major), volunteers, beneficiaries, corporate sponsors, grant makers",
    campaignTypes: [
      "Impact stories (your donation provided...)",
      "Donor thank-you and stewardship sequences",
      "Fundraising event promotion and ticket sales",
      "Recurring giving programme launch",
      "Volunteer recruitment and appreciation",
      "Corporate sponsorship proposals",
      "Grant application awareness",
      "Annual report and impact summary",
    ],
    contentTone: "Emotive, transparent, mission-focused, gratitude-first",
    keyMetrics: [
      "Donor retention rate",
      "Recurring donor count",
      "Average gift size",
      "Volunteer hours contributed",
      "Fundraising event ROI",
    ],
    ctaLanguage: ["Donate now", "Volunteer with us", "Support our mission", "Give monthly"],
    agentSkills: ["Impact story drafting", "Donor stewardship sequence", "Fundraising event ideas", "Volunteer recruitment campaign"],
  },

  "beauty-personal-care": {
    primaryGoal: "Maximise rebooking rate and service mix revenue",
    stakeholders: "Clients, stylists/therapists",
    campaignTypes: [
      "Rebooking reminders (time for your next appointment)",
      "New treatment and product launches",
      "Seasonal style and trend guides",
      "Loyalty programmes (10th visit free)",
      "Referral rewards (bring a friend)",
      "Before-and-after social media content",
      "Gift voucher promotions",
      "Stylist and therapist spotlight features",
    ],
    contentTone: "Stylish, personal, aspirational, trend-aware",
    keyMetrics: [
      "Rebooking rate",
      "Average ticket value",
      "Retail product attachment rate",
      "New client acquisition",
      "Stylist utilisation rate",
    ],
    ctaLanguage: ["Book now", "Rebook your appointment", "Try our new treatment", "Gift a voucher"],
    agentSkills: ["Rebooking campaign", "New treatment launch", "Seasonal style guide", "Gift voucher promotion"],
  },

  "fitness-recreation": {
    primaryGoal: "Grow membership base and reduce churn",
    stakeholders: "Members, prospects (trial), instructors, corporate wellness contacts",
    campaignTypes: [
      "New member offers and trial promotions",
      "Class schedule highlights and new class launches",
      "Member milestone celebrations",
      "Corporate wellness partnerships",
      "Seasonal challenges (New Year, summer body)",
      "Instructor spotlight features",
      "Referral-a-friend programmes",
      "Early renewal incentives",
    ],
    contentTone: "Motivational, inclusive, community-driven, energetic",
    keyMetrics: [
      "New member sign-ups",
      "Member churn rate",
      "Class attendance rate",
      "Trial-to-member conversion",
      "Average member lifetime",
    ],
    ctaLanguage: ["Join now", "Start your trial", "Book a class", "Become a member"],
    agentSkills: ["New member campaign", "Class promotion", "Retention analysis", "Corporate wellness pitch"],
  },

  "pet-services": {
    primaryGoal: "Maximise rebooking and fill seasonal capacity (holiday boarding)",
    stakeholders: "Pet owners, referring vets",
    campaignTypes: [
      "Rebooking reminders (grooming schedule)",
      "Seasonal grooming packages",
      "Holiday boarding early-bird offers",
      "Puppy programme launches",
      "Vaccination and health reminders",
      "Pet birthday celebrations",
      "Referral rewards",
    ],
    contentTone: "Caring, playful, trustworthy",
    keyMetrics: [
      "Rebooking rate",
      "Boarding occupancy rate",
      "Seasonal fill rate",
      "New client acquisition",
    ],
    ctaLanguage: ["Book grooming", "Reserve boarding", "Enrol in training", "Book now"],
    agentSkills: ["Holiday boarding campaign", "Puppy programme launch", "Rebooking reminders", "Seasonal grooming promotion"],
  },

  "real-estate-construction": {
    primaryGoal: "Generate qualified buyer enquiries and display-home appointments that convert to purchase agreements",
    stakeholders: "Home buyers (first-time, upsizing, downsizing, investing), real estate agents, mortgage brokers, subcontractors",
    campaignTypes: [
      "Community and stage release announcements",
      "Display home open-weekend promotions",
      "Design centre event invitations (colour palette reveals, upgrade showcases)",
      "First-home buyer education content (the build journey explained)",
      "Construction milestone updates for under-contract buyers",
      "Post-handover warranty follow-up sequences (30 / 60 / 90 days)",
      "Before-and-after project showcases for custom builds",
      "Referral programmes for settled buyers",
      "Build timeline and progress updates for custom clients",
    ],
    contentTone: "Aspirational, milestone-driven, trustworthy — homes are the largest purchase buyers will make; tone must project permanence and quality",
    keyMetrics: [
      "Display home appointments booked",
      "Enquiry-to-appointment conversion rate",
      "Purchase agreements signed",
      "Days from first enquiry to contract",
      "Buyer referral rate",
      "Warranty call rate at 90 days post-handover",
    ],
    ctaLanguage: [
      "Schedule a tour", "Book a display home visit", "Enquire now",
      "View floor plans", "Register your interest", "Download the community guide",
    ],
    agentSkills: [
      "Community release announcement", "Display home open-day promotion",
      "Buyer journey explainer", "Construction milestone update template",
    ],
  },

  "retail-goods": {
    primaryGoal: "Increase order frequency and average order value",
    stakeholders: "Customers, wholesale/trade buyers, event organisers",
    campaignTypes: [
      "New product launches and arrivals",
      "Seasonal collections and themed promotions",
      "Flash sales and limited-time offers",
      "Loyalty and repeat-buyer programmes",
      "Bundle promotions and upsell offers",
      "Gift guides and seasonal gifting",
      "Pre-order campaigns",
      "Maker/artisan story features",
    ],
    contentTone: "Aspirational, visual-first, trend-aware",
    keyMetrics: [
      "Order volume (daily/weekly trend)",
      "Average order value (AOV)",
      "Repeat purchase rate",
      "Product mix (top sellers vs slow movers)",
      "Revenue per customer",
    ],
    ctaLanguage: ["Shop now", "Order today", "Browse collection", "Pre-order"],
    agentSkills: ["Product launch campaign", "Seasonal collection promotion", "Gift guide creation", "Loyalty programme ideas"],
  },

  "automotive-services": {
    primaryGoal: "Win same-day jobs and keep service vans full — fast quotes, local search visibility, and repeat/fleet relationships",
    stakeholders: "Drivers, fleet managers, insurers, dealerships, local trade networks",
    campaignTypes: [
      "Fix-the-chip-before-it-cracks reminders",
      "Seasonal service pushes (winter batteries and tires, summer A/C)",
      "Fleet and dealership account acquisition",
      "Insurance-claim assistance messaging (glass)",
      "Mobile-convenience promotion (we come to you)",
      "Review and referral drives",
      "ADAS-calibration safety awareness",
    ],
    contentTone: "Reassuring and fast-response — safety first, honest pricing, no upsell pressure",
    keyMetrics: [
      "Same-day booking rate",
      "Quote-to-job conversion",
      "Fleet / account growth",
      "Repeat and referral rate",
      "Average response time",
    ],
    ctaLanguage: ["Get a quote", "Book mobile service", "Request help now", "Add your fleet"],
    agentSkills: ["Seasonal service reminder", "Fleet outreach", "Review request", "Insurance-claim explainer"],
  },

  "moving-and-logistics": {
    primaryGoal: "Fill the calendar in peak season and win recurring B2B routes — fast quotes and trust on careful handling",
    stakeholders: "Households relocating, businesses, real-estate agents, property managers",
    campaignTypes: [
      "Peak-season pushes (summer and month-end)",
      "Off-peak midweek discounts to smooth demand",
      "Realtor and property-manager referral partnerships",
      "Packing and storage add-on upsell",
      "B2B route and account acquisition",
      "Review and referral drives",
      "Moving-checklist and how-to content",
    ],
    contentTone: "Reassuring, reliable, stress-reducing",
    keyMetrics: [
      "Quote-to-booking conversion",
      "Calendar fill rate (peak vs off-peak)",
      "B2B account growth",
      "Average job value",
      "Referral rate",
    ],
    ctaLanguage: ["Get a moving quote", "Book a pickup", "Open a business account", "Request a route"],
    agentSkills: ["Peak-season campaign", "Realtor referral outreach", "Review request", "B2B account proposal"],
  },

  "warehousing-fulfilment": {
    primaryGoal: "Win contract accounts that fill the racks and keep them full — proof of accuracy and on-time despatch beats a headline rate",
    stakeholders: "E-commerce brands, importers and distributors, manufacturers, freight forwarders",
    campaignTypes: [
      "Capacity-available campaigns when space frees up",
      "Peak-season readiness offers ahead of Q4",
      "Switching campaigns targeting brands outgrowing their current 3PL",
      "Freight forwarder and broker referral partnerships",
      "Facility tour and open-day invitations",
      "Case studies on accuracy and despatch performance",
      "Integration-led content for the platforms clients sell on",
    ],
    contentTone: "Dependable, precise, evidence-led",
    keyMetrics: [
      "Enquiry-to-contract conversion",
      "Space utilisation and committed capacity",
      "Revenue per pallet and per order",
      "Client retention and account growth",
      "On-time despatch and order accuracy cited in wins",
    ],
    ctaLanguage: ["Request a quote", "Book a facility tour", "Get a rate card", "Check available capacity"],
    agentSkills: ["Capacity-available campaign", "Peak-season readiness outreach", "Forwarder referral outreach", "Client performance review"],
  },

  "security-services": {
    primaryGoal: "Win and renew recurring contracts — built on credibility, a response track record, and compliance assurance",
    stakeholders: "Businesses, property managers, event organizers, residents, insurers",
    campaignTypes: [
      "Contract-renewal nurture sequences",
      "B2B proposal and RFP responses",
      "Event-security seasonal outreach",
      "Alarm and monitoring upsell to install customers",
      "Compliance, licensing, and vetting trust content",
      "Incident-response case studies",
      "Residential security awareness",
    ],
    contentTone: "Credible, reassuring, professional — safety and trust, never fear-mongering",
    keyMetrics: [
      "Contract win rate",
      "Renewal / retention rate",
      "Monitoring-plan attach rate",
      "Response-time SLA adherence",
      "Proposal conversion",
    ],
    ctaLanguage: ["Request a proposal", "Get a security assessment", "Add monitoring", "Talk to us"],
    agentSkills: ["Contract renewal nurture", "RFP / proposal draft", "Monitoring upsell campaign", "Incident-response case study"],
  },

  "media-production": {
    primaryGoal: "Win project commissions on the strength of the reel — showcase work, credibility, and repeatable process",
    stakeholders: "Brands, agencies, marketing teams, artists, producers",
    campaignTypes: [
      "New showreel and case-study releases",
      "Behind-the-scenes and process content",
      "Client testimonial and results stories",
      "Capability and service-line announcements",
      "Awards, festival, and press features",
      "Seasonal / campaign-cycle outreach to agencies and brands",
      "Referral and repeat-client nurture",
    ],
    contentTone: "Creative, confident, craft-led — let the work speak",
    keyMetrics: [
      "Project enquiries",
      "Proposal-to-win rate",
      "Average project value",
      "Reel / portfolio engagement",
      "Repeat-client rate",
    ],
    ctaLanguage: ["Start a project", "See our work", "Request a quote", "Book a discovery call"],
    agentSkills: ["Showreel launch campaign", "Case-study draft", "Agency outreach sequence", "Proposal follow-up nurture"],
  },

  "live-events-venues": {
    primaryGoal: "Sell out shows and grow a returning audience — drive ticket sales at on-sale and fill the room by event date",
    stakeholders: "Ticket buyers, fans, artists, agents, sponsors, local community",
    campaignTypes: [
      "On-sale and presale announcements",
      "Line-up reveals and event countdowns",
      "Low-ticket-warning and last-chance pushes",
      "Membership / season-pass and loyalty campaigns",
      "Post-event recap and next-event cross-sell",
      "Private-hire and group-booking promotion",
      "Sponsor and partner activation",
    ],
    contentTone: "Energetic, exciting, community-driven — build anticipation",
    keyMetrics: [
      "Tickets sold / sell-through rate",
      "On-sale conversion",
      "Average tickets per buyer",
      "Repeat-attendee rate",
      "Secondary spend (bar / merch / hospitality)",
    ],
    ctaLanguage: ["Buy tickets", "Get on the list", "Reserve your seat", "Book the venue"],
    agentSkills: ["On-sale announcement campaign", "Countdown / last-chance sequence", "Post-event cross-sell", "Private-hire promotion"],
  },
};

// ─── CTA-Based Fallback (for unknown categories) ───────────────────────────

const CTA_FALLBACKS: Record<string, MarketingPlaybook> = {
  booking: {
    primaryGoal: "Maximize appointment fill rate and customer recall",
    stakeholders: "Clients, prospects",
    campaignTypes: ["Recall campaigns", "Referral programs", "Seasonal capacity optimization", "New service announcements", "Waitlist conversion", "No-show follow-up"],
    contentTone: "Reassuring, professional",
    keyMetrics: ["Appointment fill rate", "Recall rate", "Cancellation rate", "Average time between visits", "New vs returning ratio"],
    ctaLanguage: ["Book now", "Schedule your appointment", "Reserve your slot"],
    agentSkills: ["Campaign ideas", "Content brief", "Review inbox", "Marketing health check"],
  },
  purchase: {
    primaryGoal: "Increase order frequency and average order value",
    stakeholders: "Customers",
    campaignTypes: ["Product launches", "Seasonal promotions", "Flash sales", "Loyalty programs", "Bundle offers", "Gift guides"],
    contentTone: "Aspirational, trend-aware, visual-first",
    keyMetrics: ["Order volume", "AOV", "Repeat purchase rate", "Product mix", "Revenue per customer"],
    ctaLanguage: ["Shop now", "Order today", "Browse collection"],
    agentSkills: ["Campaign ideas", "Content brief", "Review inbox", "Marketing health check"],
  },
  inquiry: {
    primaryGoal: "Generate qualified leads through trust and thought leadership",
    stakeholders: "Prospects, clients",
    campaignTypes: ["Case studies", "Testimonials", "Educational content", "Lead magnets", "FAQ content"],
    contentTone: "Authoritative, trust-building, problem-solution oriented",
    keyMetrics: ["Inquiry volume", "Response time", "Inquiry-to-opportunity conversion", "Content engagement", "Quote request rate"],
    ctaLanguage: ["Get a quote", "Book a consultation", "Contact us", "Request a callback"],
    agentSkills: ["Campaign ideas", "Content brief", "Review inbox", "Marketing health check"],
  },
  donation: {
    primaryGoal: "Grow donor base and increase gift frequency",
    stakeholders: "Donors, volunteers, beneficiaries",
    campaignTypes: ["Impact stories", "Donor stewardship", "Fundraising events", "Recurring giving drives", "Corporate partnerships"],
    contentTone: "Emotive, transparent, mission-focused, gratitude-first",
    keyMetrics: ["Donation volume", "Donor retention", "Average gift size", "Recurring donor count", "Campaign goal progress"],
    ctaLanguage: ["Donate now", "Support our mission", "Give monthly", "Make a difference"],
    agentSkills: ["Campaign ideas", "Content brief", "Review inbox", "Marketing health check"],
  },
  mixed: {
    primaryGoal: "Balance booking fill with product/service promotion",
    stakeholders: "Clients, customers",
    campaignTypes: ["Workshop enrollments", "Event bookings", "Product promotion", "Gift vouchers", "Community events"],
    contentTone: "Engaging, informative, community-oriented",
    keyMetrics: ["Booking fill rate", "Order volume", "Combined revenue trend", "New customer acquisition", "Cross-sell rate"],
    ctaLanguage: ["Book now", "Order today", "Join us", "Reserve your place"],
    agentSkills: ["Campaign ideas", "Content brief", "Review inbox", "Marketing health check"],
  },
};

/** Primary lookup: get playbook by archetype category. */
export function getPlaybookForCategory(category: string | null | undefined): MarketingPlaybook {
  return CATEGORY_PLAYBOOKS[category ?? ""] ?? CTA_FALLBACKS["inquiry"]!;
}

/** Fallback lookup: get playbook by CTA type (for unknown categories). */
export function getPlaybookForCtaType(ctaType: string | null | undefined): MarketingPlaybook {
  return CTA_FALLBACKS[ctaType ?? "inquiry"] ?? CTA_FALLBACKS["inquiry"]!;
}

/** Best-effort lookup: try category first, fall back to CTA type. */
export function getPlaybook(category: string | null | undefined, ctaType: string | null | undefined): MarketingPlaybook {
  return CATEGORY_PLAYBOOKS[category ?? ""] ?? CTA_FALLBACKS[ctaType ?? "inquiry"] ?? CTA_FALLBACKS["inquiry"]!;
}

/**
 * Composite playbook for multi-archetype storefronts.
 *
 * Primary drives identity (primaryGoal, stakeholders, contentTone,
 * keyMetrics, ctaLanguage). Secondary categories contribute unique
 * campaignTypes and agentSkills as supplemental context — so the AI
 * coworker can suggest service-line-specific campaigns without losing the
 * primary business's voice.
 */
export function getCompositePlaybook(
  primaryCategory: string | null | undefined,
  secondaryCategories: Array<string | null | undefined>,
  primaryCtaType?: string | null,
): MarketingPlaybook {
  const primary = getPlaybook(primaryCategory, primaryCtaType);

  if (secondaryCategories.length === 0) return primary;

  const seenCampaigns = new Set(primary.campaignTypes);
  const seenSkills = new Set(primary.agentSkills);

  const addedCampaigns: string[] = [];
  const addedSkills: string[] = [];

  for (const cat of secondaryCategories) {
    const secondary = getPlaybookForCategory(cat);
    for (const c of secondary.campaignTypes) {
      if (!seenCampaigns.has(c)) {
        seenCampaigns.add(c);
        addedCampaigns.push(c);
      }
    }
    for (const s of secondary.agentSkills) {
      if (!seenSkills.has(s)) {
        seenSkills.add(s);
        addedSkills.push(s);
      }
    }
  }

  if (addedCampaigns.length === 0 && addedSkills.length === 0) return primary;

  return {
    ...primary,
    campaignTypes: [...primary.campaignTypes, ...addedCampaigns],
    agentSkills: [...primary.agentSkills, ...addedSkills],
  };
}
