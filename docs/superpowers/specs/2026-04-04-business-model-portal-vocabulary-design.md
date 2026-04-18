# EP-STORE-006: Business Model Portal Vocabulary & Stakeholder Adaptation

**Epic:** Storefront Foundation  
**Status:** Draft  
**Date:** 2026-04-04  
**Author:** AI-assisted (Claude)  
**IT4IT Alignment:** SS5.5 Release (service catalog), SS5.6 Consume (customer delivery)  
**Dependencies:** EP-STORE-001, EP-STORE-005, EP-BIZ-ROLES

---

## 1. Problem Statement

The platform uses "Storefront" as the universal label for its customer-facing portal, but this is a retail-centric metaphor that breaks down for most business models:

- An **HOA** doesn't have a "storefront" — it has a Community Portal serving homeowners, managing assessments, subcontractor scheduling, and bylaw communications
- A **consulting firm** has a Client Portal, not a storefront
- A **nonprofit** has a Supporter Hub, not a store
- A **healthcare practice** has a Patient Portal
- A **trades business** has a Service Portal for job requests

Beyond naming, each business model has fundamentally different:

1. **Stakeholder relationships** — who are the parties and what roles do they play?
2. **Marketing objectives** — what does "marketing" even mean for this business?
3. **Engagement patterns** — how does the business interact with its stakeholders?
4. **Agent skills** — what should the AI coworker help with?

The current marketing playbooks differentiate by CTA type (booking/purchase/inquiry/donation), but this is insufficient. An HOA and a plumber are both "inquiry" businesses, but their marketing objectives are completely different.

## 2. Design: Three-Layer Vocabulary

### Layer 1: Portal Identity (per archetype category)

The top-level name for the entire customer-facing capability.

| Archetype Category | Portal Label | Workspace Tile | Agent Name | Stakeholder Label |
|---|---|---|---|---|
| `retail-goods` | Storefront | Storefront | Marketing Specialist | Customers |
| `food-hospitality` | Venue Portal | Venue | Venue Manager | Guests |
| `education-training` | Academy Portal | Academy | Enrolment Manager | Students |
| `healthcare-wellness` | Patient Portal | Patients | Patient Engagement | Patients |
| `beauty-personal-care` | Booking Portal | Bookings | Client Engagement | Clients |
| `trades-maintenance` | Service Portal | Services | Lead Manager | Property Owners |
| `professional-services` | Client Portal | Client Portal | Client Engagement | Clients |
| `pet-services` | Booking Portal | Bookings | Client Engagement | Pet Owners |
| `fitness-recreation` | Member Portal | Members | Member Engagement | Members |
| `nonprofit-community` | Supporter Hub | Supporters | Community Manager | Supporters |
| `hoa-property-management` | Community Portal | Community | Community Manager | Homeowners |

### Layer 2: Tab Labels (per archetype category)

The admin navigation tabs adapt to the business model.

| Tab Slot | Retail | Restaurant | Training | Healthcare | Trades | HOA | Nonprofit |
|---|---|---|---|---|---|---|---|
| Dashboard | Dashboard | Dashboard | Dashboard | Dashboard | Dashboard | Dashboard | Dashboard |
| Sections | Sections | Sections | Sections | Sections | Sections | Sections | Sections |
| Items | Products | Menu | Courses | Services | Services | Assessments | Campaigns |
| Team | Team | Staff | Instructors | Practitioners | Crew | Board & Contractors | Team |
| Inbox | Inbox | Reservations | Enrolments | Appointments | Job Requests | Requests | Messages |
| Settings | Settings | Settings | Settings | Settings | Settings | Settings | Settings |

### Layer 3: Marketing Playbooks (per archetype category, not just CTA type)

The current playbooks group by CTA type (booking/purchase/inquiry/donation). This misses critical distinctions:

| CTA Type | Business A | Business B | Marketing is fundamentally different |
|---|---|---|---|
| inquiry | Plumber | Law Firm | Emergency response vs trust-building |
| inquiry | HOA | IT Services | Community governance vs B2B lead gen |
| booking | Dentist | Restaurant | Recall campaigns vs seasonal menus |
| booking | Yoga Studio | Tutoring | Membership retention vs academic progress |
| donation | Charity | Pet Rescue | Cause advocacy vs animal stories |

**Solution**: Marketing playbooks keyed by archetype category (11 playbooks), not CTA type (5 playbooks). The CTA type still shapes form fields and transaction types, but marketing strategy comes from the business model.

## 3. Category-Level Marketing Playbooks

### 3.1 HOA / Property Management

**Marketing objective**: Community governance communications and homeowner engagement — not customer acquisition.

| Dimension | Value |
|---|---|
| Primary goal | Homeowner engagement, bylaw compliance, and community satisfaction |
| Stakeholders | Homeowners, board members, subcontractors, property managers |
| Campaign types | Bylaw change announcements, special assessment notices, community meeting invitations, seasonal maintenance reminders, amenity reservation promotions, subcontractor introductions, annual budget communications, emergency notifications |
| Content tone | Official, transparent, community-minded, action-oriented |
| Key metrics | Assessment collection rate, meeting attendance, maintenance request response time, homeowner satisfaction, communication open rate |
| CTA language | Submit request, Reserve amenity, View announcement, Pay assessment |
| Agent skills | Draft community announcement, Prepare assessment notice, Summarise maintenance requests, Board meeting agenda |

### 3.2 Professional Services (Consulting, Legal, Accounting, IT, Marketing Agency)

**Marketing objective**: Establish authority and nurture long-term client relationships.

| Dimension | Value |
|---|---|
| Primary goal | Build authority pipeline through expertise demonstration |
| Stakeholders | Clients, prospects, referral partners, industry contacts |
| Campaign types | Thought leadership articles, client case studies, regulatory update alerts, webinar invitations, industry benchmark reports, referral partner programmes, client satisfaction surveys, retainer renewal reminders |
| Content tone | Authoritative, consultative, insight-driven |
| Key metrics | Inquiry-to-engagement conversion, average engagement value, client retention rate, referral rate, content engagement |
| CTA language | Book a consultation, Request a proposal, Download our guide, Refer a colleague |
| Agent skills | Draft case study brief, Client retention review, Pipeline health check, Referral programme ideas |

### 3.3 Trades & Maintenance (Plumber, Electrician, Cleaning, Landscaping)

**Marketing objective**: Local reputation and emergency availability awareness.

| Dimension | Value |
|---|---|
| Primary goal | Be the first call for emergency and planned work in the local area |
| Stakeholders | Property owners, landlords, letting agents, commercial property managers |
| Campaign types | Emergency availability reminders, seasonal maintenance checklists (boiler before winter, gutter clearing in autumn), before-and-after project showcases, landlord certificate reminders (gas safety, EICR), loyalty discounts for repeat customers, local area leaflet campaigns |
| Content tone | Practical, trustworthy, local, responsive |
| Key metrics | Response time to inquiries, quote-to-job conversion rate, repeat customer rate, average job value, review/rating score |
| CTA language | Request a quote, Emergency call-out, Book a service, Get a free estimate |
| Agent skills | Seasonal campaign ideas, Review response drafting, Landlord certificate reminder list, Quote follow-up suggestions |

### 3.4 Healthcare & Wellness (Vet, Dental, Physio, Counselling, Optician)

**Marketing objective**: Patient recall, preventive care education, and practice growth.

| Dimension | Value |
|---|---|
| Primary goal | Maximise patient recall compliance and preventive care uptake |
| Stakeholders | Patients, carers/guardians, referring practitioners, insurers |
| Campaign types | Recall reminders (dental check-up overdue, vaccination due), new patient welcome sequences, seasonal health advice (flu season, summer injuries), new service/practitioner announcements, practice milestone celebrations, patient survey and feedback requests |
| Content tone | Reassuring, professional, health-focused, empathetic |
| Key metrics | Recall compliance rate, new patient acquisition, appointment fill rate, cancellation/DNA rate, patient satisfaction |
| CTA language | Book your check-up, Schedule your appointment, Register as a patient, Book now |
| Agent skills | Recall campaign setup, New patient welcome sequence, Seasonal health content, Practice growth review |

### 3.5 Food & Hospitality (Restaurant, Catering, Bakery)

**Marketing objective**: Covers and reservations, seasonal menu promotion, event bookings.

| Dimension | Value |
|---|---|
| Primary goal | Fill covers during quiet periods and promote seasonal offerings |
| Stakeholders | Diners, event organisers, corporate clients, food critics/reviewers |
| Campaign types | Seasonal menu launches, special event promotions (Valentine's, Mother's Day), midweek/lunchtime offers, private dining and event packages, loyalty/regulars programme, review response and reputation management, local food event participation |
| Content tone | Warm, appetising, social, experiential |
| Key metrics | Covers per service, booking fill rate (lunch vs dinner), no-show rate, average spend per head, repeat visit rate |
| CTA language | Reserve a table, View our menu, Book an event, Order now |
| Agent skills | Seasonal menu promotion ideas, Event package marketing, Quiet period campaign, Review response drafting |

### 3.6 Education & Training (Tutoring, Corporate Training, Music School, Driving School)

**Marketing objective**: Course enrolment, student retention, and academic outcome marketing.

| Dimension | Value |
|---|---|
| Primary goal | Drive enrolments and demonstrate learning outcomes |
| Stakeholders | Students, parents/guardians (for minors), employers (corporate), schools (referral) |
| Campaign types | New term/course launch announcements, early-bird enrolment discounts, student success stories and results, open day and taster session invitations, corporate training ROI case studies, exam season preparation campaigns, sibling/group discounts, alumni network engagement |
| Content tone | Encouraging, achievement-focused, credible, supportive |
| Key metrics | Enrolment rate, student retention term-over-term, course completion rate, student satisfaction/NPS, referral rate |
| CTA language | Enrol now, Book a taster session, View courses, Register your interest |
| Agent skills | Term launch campaign, Student success content brief, Open day promotion, Retention analysis |

### 3.7 Nonprofit & Community (Charity, Pet Rescue, Shelter, Sports Club)

**Marketing objective**: Donor stewardship, volunteer engagement, and cause awareness.

| Dimension | Value |
|---|---|
| Primary goal | Grow and retain donor base while engaging volunteers and raising awareness |
| Stakeholders | Donors (one-off, recurring, major), volunteers, beneficiaries, corporate sponsors, grant makers |
| Campaign types | Impact stories (your donation provided...), donor thank-you and stewardship, fundraising event promotion, recurring giving programme launch, volunteer recruitment and appreciation, corporate sponsorship proposals, grant application awareness, annual report and impact summary |
| Content tone | Emotive, transparent, mission-focused, gratitude-first |
| Key metrics | Donor retention rate, recurring donor count, average gift size, volunteer hours, fundraising event ROI, grant success rate |
| CTA language | Donate now, Volunteer with us, Support our mission, Give monthly |
| Agent skills | Impact story drafting, Donor stewardship sequence, Fundraising event ideas, Grant opportunity research |

### 3.8 Beauty & Personal Care (Hair Salon, Barber, Nail, Spa, Personal Trainer)

**Marketing objective**: Client retention, upselling services, and local reputation.

| Dimension | Value |
|---|---|
| Primary goal | Maximise rebooking rate and service mix revenue |
| Stakeholders | Clients, stylists/therapists (provider assignment matters) |
| Campaign types | Rebooking reminders, new treatment/product launches, seasonal style guides, loyalty programmes (10th visit free), referral rewards, social media before-and-after content, gift voucher promotions, stylist/therapist spotlight features |
| Content tone | Stylish, personal, aspirational, trend-aware |
| Key metrics | Rebooking rate, average ticket value, retail attachment rate, new client acquisition, stylist utilisation |
| CTA language | Book now, Rebook your appointment, Try our new treatment, Gift a voucher |
| Agent skills | Rebooking campaign, New treatment launch, Seasonal style guide, Gift voucher promotion |

### 3.9 Fitness & Recreation (Gym, Yoga, Dance)

**Marketing objective**: Membership growth, class attendance, and member retention.

| Dimension | Value |
|---|---|
| Primary goal | Grow membership base and reduce churn |
| Stakeholders | Members, prospects (trial), instructors, corporate wellness contacts |
| Campaign types | New member offers and trial promotions, class schedule highlights, member milestone celebrations, corporate wellness partnerships, seasonal challenges (New Year, summer body), instructor spotlight features, referral-a-friend programmes, early renewal incentives |
| Content tone | Motivational, inclusive, community-driven, energetic |
| Key metrics | New member sign-ups, member churn rate, class attendance rate, trial-to-member conversion, average member lifetime |
| CTA language | Join now, Start your trial, Book a class, Become a member |
| Agent skills | New member campaign, Class promotion, Retention analysis, Corporate wellness pitch |

### 3.10 Pet Services (Grooming, Boarding, Training)

**Marketing objective**: Rebooking and seasonal demand management.

| Dimension | Value |
|---|---|
| Primary goal | Maximise rebooking and fill seasonal capacity (holiday boarding) |
| Stakeholders | Pet owners, referring vets |
| Campaign types | Rebooking reminders, seasonal grooming packages, holiday boarding early-bird offers, puppy programme launches, vaccination/health reminders, pet birthday celebrations, referral rewards |
| Content tone | Caring, playful, trustworthy |
| Key metrics | Rebooking rate, boarding occupancy, seasonal fill rate, new client rate |
| CTA language | Book grooming, Reserve boarding, Enrol in training, Book now |
| Agent skills | Holiday boarding campaign, Puppy programme launch, Rebooking reminders, Seasonal grooming promotion |

### 3.11 Retail Goods (Shop, Artisan, Florist)

**Marketing objective**: Product promotion, seasonal campaigns, and customer loyalty.

| Dimension | Value |
|---|---|
| Primary goal | Increase order frequency and average order value |
| Stakeholders | Customers, wholesale/trade buyers, event organisers |
| Campaign types | New product launches, seasonal collections, flash sales, loyalty programmes, gift guides, pre-order campaigns, trade/wholesale programme, maker/artisan story features |
| Content tone | Aspirational, visual-first, trend-aware |
| Key metrics | Order volume, AOV, repeat purchase rate, product mix |
| CTA language | Shop now, Order today, Browse collection, Pre-order |
| Agent skills | Product launch campaign, Seasonal collection promotion, Gift guide creation, Loyalty programme ideas |

## 4. Implementation Plan

### Phase 1: Extend Vocabulary (Current Session)

**Extend `archetype-vocabulary.ts`** to include portal-level labels:

```typescript
export type ArchetypeVocabulary = {
  // Existing (item-level)
  itemsLabel: string;
  singleItemLabel: string;
  addButtonLabel: string;
  categoryLabel: string;
  priceLabel: string;
  // New (portal-level)
  portalLabel: string;        // "Storefront" | "Community Portal" | "Client Portal"
  stakeholderLabel: string;   // "Customers" | "Homeowners" | "Clients" | "Members"
  teamLabel: string;          // "Team" | "Staff" | "Instructors" | "Board & Contractors"
  inboxLabel: string;         // "Inbox" | "Reservations" | "Job Requests" | "Requests"
  agentName: string;          // "Marketing Specialist" | "Community Manager" | "Enrolment Manager"
};
```

### Phase 2: Dynamic Layout Labels

- Update `storefront/layout.tsx` heading to load archetype and use `vocabulary.portalLabel`
- Update `StorefrontAdminTabNav.tsx` to accept vocabulary prop and render dynamic tab labels
- Update workspace tile label in `permissions.ts` to be archetype-aware (or add a dynamic tile label resolver)

### Phase 3: Category-Level Marketing Playbooks

**Replace CTA-based playbooks with category-based playbooks** in `marketing-playbooks.ts`:

- Key changes from 5 playbooks (by ctaType) to 11 playbooks (by archetypeCategory)
- Each playbook includes category-specific agent skills
- Keep `getPlaybookForCtaType()` as fallback for unknown categories
- Add `getPlaybookForCategory()` as primary lookup

### Phase 4: Agent Prompt Adaptation

- Update the Marketing Specialist's system prompt to reference the portal label and stakeholder label dynamically
- Update agent skills to be category-specific (e.g., HOA gets "Draft community announcement" not "Campaign ideas")
- Route context map domain label changes from static "Storefront & Marketing" to dynamic based on archetype

### Phase 5: Stakeholder Awareness in CRM Integration

- Add stakeholder type hints to the `getStorefrontMarketingContext()` route context provider
- Include stakeholder labels in the PAGE DATA so the agent uses the right language
- Future: extend `ContactAccountRole.roleTitle` with archetype-specific stakeholder role suggestions

## 5. Files to Modify

| File | Change |
|---|---|
| `apps/web/lib/storefront/archetype-vocabulary.ts` | Add portal-level labels (portalLabel, stakeholderLabel, teamLabel, inboxLabel, agentName) |
| `apps/web/lib/tak/marketing-playbooks.ts` | Replace 5 CTA-based playbooks with 11 category-based playbooks including agent skills |
| `apps/web/app/(shell)/storefront/layout.tsx` | Dynamic heading from archetype vocabulary |
| `apps/web/components/storefront-admin/StorefrontAdminTabNav.tsx` | Accept vocabulary prop for dynamic tab labels |
| `apps/web/lib/tak/agent-routing.ts` | Update agent system prompt to reference portal/stakeholder labels from PAGE DATA |
| `apps/web/lib/tak/route-context-map.ts` | Update domain label; add category-specific skills |
| `apps/web/lib/tak/route-context.ts` | Include portal label and stakeholder label in PAGE DATA |
| `apps/web/lib/govern/permissions.ts` | Consider dynamic workspace tile label |
| `apps/web/app/(shell)/storefront/page.tsx` | Use portal label in dashboard heading |

## 6. HOA Deep Dive — What Makes It Fundamentally Different

The HOA archetype illustrates why this isn't just label swapping:

**Stakeholder complexity:**
- **Homeowners**: Pay assessments, submit maintenance requests, vote on bylaws, reserve amenities
- **Board members**: Set assessments, approve work, communicate policy changes, manage budgets
- **Subcontractors**: Bid on work, submit invoices, report progress, manage schedules

**Marketing = governance communications:**
- Bylaw changes require homeowner notification and sometimes voting
- Special assessments need justification and community support
- Maintenance schedules affect everyone and need advance notice
- Amenity policies (pool hours, gym rules) need clear communication

**The "Marketing Specialist" becomes a "Community Manager":**
- Instead of "campaign ideas", it drafts "community announcements"
- Instead of "funnel analysis", it tracks "assessment collection rate"
- Instead of "content briefs", it writes "bylaw change notices"
- Instead of "review inbox for marketing opportunities", it monitors "maintenance request patterns"

This level of adaptation cannot be achieved by CTA type alone — it requires category-level business model awareness.

## 7. Verification Plan

1. **HOA**: Navigate to storefront — heading shows "Community Portal", tab shows "Assessments" not "Items", inbox shows "Requests", agent introduces itself as "Community Manager"
2. **Restaurant**: Heading shows "Venue Portal", tab shows "Menu", inbox shows "Reservations", agent is "Venue Manager"
3. **Consulting firm**: Heading shows "Client Portal", tab shows "Services", agent is "Client Engagement"
4. **Charity**: Heading shows "Supporter Hub", tab shows "Campaigns", agent is "Community Manager"
5. **Marketing agent**: Agent suggests HOA-specific campaigns (bylaw notices, assessment reminders), not generic "product launches"
6. **Agent skills**: HOA route shows "Draft community announcement" skill, not "Campaign ideas"

## 8. Out of Scope (Future Epics)

- **Stakeholder type model**: Adding `StakeholderType` enum or `PartyType` to CRM models (requires schema migration and CRM spec update)
- **Subcontractor portal**: Separate interface for HOA subcontractors (contract management, scheduling, billing)
- **Board member access control**: Role-based access within the community portal for board-level functions
- **Route renaming**: Changing `/storefront` to `/portal` in URL paths (breaking change, deferred)
- **Database renaming**: Renaming `StorefrontConfig` to `PortalConfig` (requires migration, deferred)
- **Voting/polling**: HOA bylaw voting features
- **Document sharing**: Board minutes, bylaws, community documents
