---
title: "Market Archetypes And Coworkers"
area: getting-started
order: 2
---

## Why This Page Exists

DPF should be explained from the business outward. A shop owner, clinic scheduler, retail merchandiser, or nonprofit coordinator should first see how the platform helps their kind of business run better. The internal platform machinery matters, but it belongs underneath the work people came to do.

The practical model is:

1. Pick a market archetype.
2. Get a customer-facing portal and internal workspace that use the right vocabulary.
3. Work with purposed AI coworkers for the daily jobs that business actually has.
4. Grow the install through governed improvements when the business needs something new.

## Owner-First Promise

Most DPF customers should hear the archetype story through the owner first. In many archetypes, the owner is still a key practitioner: the plumber doing call-outs, the salon owner cutting hair, the clinician reviewing forms, the venue owner managing holds, or the nonprofit director writing donor updates. DPF is most compelling when it protects that core work and gives the surrounding necessary-evil jobs to governed AI coworkers.

For marketing and testing, each archetype should answer four plain questions:

1. What core job does the owner want more time to do?
2. Which surrounding jobs steal time after hours?
3. Which AI coworker can draft, chase, prepare, summarize, or route that work?
4. Which platform behavior proves the promise is real?

The category-level owner positioning, visual-story guidance, and test-priority matrix live in [Archetype Owner Positioning](../architecture/archetype-owner-positioning.md). Use that document when writing marketing copy, choosing images, drafting diagrams, or deciding which archetype-specific use cases deserve the strictest audit attention.

## What An Archetype Controls

An archetype is more than a storefront template. It is the business shape selected for the install.

- **Customer portal shape**: public sections, item/service templates, booking or enquiry flows, form fields, calls to action, and brandable copy.
- **Internal workspace shape**: the daily board workers should see first, such as dispatch, appointment readiness, merchandising, or program operations.
- **Vocabulary**: the words people use in that business. HVAC users see jobs, trucks, parts, techs, and restock; clinics see appointments, forms, patients, practitioners, and follow-ups.
- **Coworker emphasis**: which AI coworkers should be prominent, which skills they can offer, and which handoffs should appear on the daily board.
- **Marketing posture**: the offers, proof points, content prompts, and campaign ideas should inherit from the same archetype that shaped the customer portal.
- **Contribution applicability**: reusable features should be recommended to matching archetypes first, not sprayed across every install.

Implementation source of truth: `StorefrontConfig.archetypeId` selects the install's `StorefrontArchetype`. The archetype catalog lives in `packages/storefront-templates/src/archetypes/`.

## Current Market Coverage

The source catalog currently contains 23 market categories and 103 leaf archetype templates. The public docs should usually describe the categories first, then use leaf archetypes when a concrete example helps.

For a fast owner-facing summary of every category and leaf, use the [Archetype Owner Quick Guide](../marketing/archetype-owner-quick-guide.md). It is the skimmable layer for sales, marketing, and test planning before reading the deeper positioning or audit documents.

| Category | Example shape |
| --- | --- |
| Healthcare and wellness | medical practice, dental practice, physiotherapy, optician, therapy, mobile clinical services |
| Beauty and personal care | salon, barber, nail salon, spa, personal training, mobile beauty |
| Trades and maintenance | facilities maintenance, plumber, electrician, cleaning, landscaping, HVAC, pest control, roofing, appliance repair |
| Professional services | consultants, agencies, advisors, legal, accounting, inspection, surveying, notary/process serving |
| Software platform | software products and SaaS-style businesses |
| Education and training | tutoring, training providers, schools, instructors |
| Pet services | veterinary, grooming, walking, boarding |
| Food and hospitality | restaurants, catering, reservations, events |
| Retail and goods | retail shops, artisan goods, florist-style selling |
| Fitness and recreation | gyms, yoga studios, dance studios, classes |
| Nonprofit and community | donations, programs, volunteers, membership; agricultural shared-machinery co-op |
| HOA and property management | residents, dues, violations, service requests |
| Banking and financial services | community bank, credit union, mortgage lending — BIAN-grounded, jurisdiction-specific regulatory governance |
| Public sector and civic | small-town municipality, municipal utility (water/electric), law enforcement — resident/ratepayer skins, open-meetings governance, records requests, 311 |
| Rental and shared assets | equipment/tool rental, self-storage, production equipment rental — the reserve → use → return & inspect → re-pool value stream over a pooled asset |
| Real estate and construction | production builders, custom home builders, model-home tours, design consultations, milestone projects |
| Automotive services | auto glass, mobile mechanics, detailing, tire service, roadside assistance, locksmith |
| Moving and logistics | moving, junk removal, courier delivery, last-mile freight |
| Security services | guard patrol, alarm/CCTV install, licensed monitoring-adjacent service |
| Media production | film/video production, post-production, event production and staging |
| Live events and venues | event venues, tour promoters, talent booking agencies |
| Fabric care services | dry-cleaning plant/store networks, wash-and-fold laundry, alterations and tailoring |

The first three persona anchors are:

- [Dale, HVAC owner](../personas/dale-hvac.md): dispatch, truck stock, technician readiness, customer update exceptions.
- [Linda, dental scheduler](../personas/linda-clinic.md): appointment readiness, missing forms, reminder follow-up, practitioner load.
- [Marisol, retail merchandiser](../personas/marisol-retail.md): order tasks, low stock, receiving, returns, location signals.

## Coworkers Are The Work Surface

DPF should not feel like a pile of admin modules with a chatbot bolted on. The intended experience is that a small business gets a set of purposed coworkers around the work it already understands.

- The onboarding coworker helps with first-run setup and explains provider, identity, branding, and finance choices in plain language.
- The storefront and marketing coworkers help turn the selected archetype into offers, content, campaigns, and proof assets.
- Operations, finance, compliance, customer, HR, and platform coworkers help with the areas they own.
- Future vertical coworkers should be named by the work they perform: dispatcher, clinic scheduler, merchandising assistant, program coordinator, service desk, or similar.

Every coworker remains governed. User role, agent grants, tool scopes, approval requirements, and audit logging still apply. "Purposed" means the coworker knows the job; it does not mean the coworker gets unbounded authority.

## Voice Fits Here

Voice is part of making the coworker surface natural, not a separate product promise.

- Speech-to-text is the default input path for coworker dictation where voice input is enabled.
- Text-to-speech is opt-in enrichment for narrated decision rationales and profile output.
- Persona voice never changes authority. The same approval, confidence, escalation, and audit rules apply whether a rationale is read as text or spoken aloud.
- Real-person voice profiles require explicit consent before training.

See [Decision Perspective & Persona Voice](ai-workforce/decision-perspective.md) for the implementation and governance details.

## Build Studio Boundary

Build Studio is the governed self-development surface for changing the platform, but it is not the first thing every small-business user should have to understand. The customer story should lead with archetypes, daily work, and coworkers.

Current truth as of 2026-05-24: Build Studio is being actively hardened. Recent work added plan-review trajectory, design-time decomposition for oversized builds, activity quiescence for safer portal upgrades, and voice playback/follow-up guards. The platform should be honest that complex source changes may still use VS Code in customizable installs while Build Studio continues maturing.

## Documentation Rule

When writing user-facing docs:

- Lead with the business archetype and the person doing the work.
- Use the operator's vocabulary before platform vocabulary.
- Explain AI coworkers as role-bound helpers at the center of the workflow.
- Keep internal architecture, Build Studio mechanics, MCP, schema, and IDs below the fold or in contributor docs.
- Link to persona files for proof and testing, but do not invent customer stories without evidence.
