---
title: "Storefront"
area: storefront
order: 1
---

## Overview

The Storefront is the public-facing side of the platform — the interface your customers and visitors see. It is fully configurable and supports multiple engagement models: browsing a product catalogue, booking a service, making a donation, or submitting an enquiry.

The storefront is also the most visible expression of the selected market archetype. The same archetype should shape the public portal, the worker home, the marketing coworker, and the vocabulary used across the install.

## Key Concepts

- **Archetypes** — The type of business you are running. The archetype determines which sections, item templates, booking/enquiry flows, vocabulary, and marketing assumptions are available. It should be treated as the install's business-shape source of truth, not just a theme.
- **Sections** — Configurable blocks that make up the storefront pages: hero, featured items, booking calendar, checkout, testimonials, etc.
- **Items** — The products or services listed for sale or booking. Each item has a price, description, and availability settings.
- **Domain Routing** — The storefront serves your organization's public experience under its configured path or domain with its selected branding.
- **Inbox** — Messages and enquiries submitted by visitors through the storefront. Managed by staff from inside the platform.
- **Service readiness (food & hospitality)** — For restaurant and venue archetypes, the storefront home opens with a single owner-readable answer to *"Are we ready for the next service period, and what exactly needs me?"* It rolls up five things — new reservations and enquiries, confirmed reservations, tables/capacity and hours, staff on the roster, and money that needs you — and shows the one exact next action (for example, *Confirm 2 reservations for the next service*). Each line links to where the work is done. In **Simple mode** it shows only what needs you; switch to full mode for the complete breakdown and the underlying figures.
- **Setup status** — The storefront home groups getting-ready work into a few plain steps (brand & public profile, menu/items, tables/resources, hours & availability, reservations/inbox) and shows a simple status for each — *Done*, *Needs attention*, or *Not started* — so a non-technical owner can see what is left without reading every settings screen. The exact steps and their labels follow your archetype (a restaurant sees Menu, Tables, and Reservations).
- **Service lines** — A service line is a secondary business type layered onto your primary archetype (for example, a restaurant that also runs contract catering). Adding or removing one is an advanced action — it's collapsed behind an **Advanced: service lines** disclosure on the storefront home rather than sitting open next to everyday setup and status, because the "add a line" list spans every archetype the platform supports. Open it to see active lines and add a new one; every add asks you to confirm first, since it seeds new items and sections.
- **Generated content & recovery** — When you add a service line, the platform auto-creates items and sections for it. The storefront home lists this generated content grouped by what produced it. Removing a service line **retains** its items and sections (items are deactivated, sections hidden) rather than deleting them, so the removal is recoverable. From the collapsed **Generated content & recovery** panel you can **Restore** a removed line (reactivates its items) or **Remove permanently** (deletes the retained items and sections — this cannot be undone). Every recovery action first shows exactly how many items and sections it affects and asks you to confirm.
- **Healthcare intake** — Medical and dental archetypes add an internal **Intake** workspace for receptionists and care-practice staff. It summarizes visit readiness, missing steps, and open exceptions without displaying clinical answers. Patient references are pseudonymous in this workspace; detailed clinical records remain on their governed care surfaces.
- **Rental physical capacity** — Equipment rental, production-kit rental, and self-storage archetypes manage each physical unit from **Storefront → Units**. Record the unit's real site, zone, and position; its ready/inspection/maintenance state; and the detail appropriate to the asset. Equipment can carry serial, plate, meter, and pickup-readiness facts; production kits can track expected versus present pieces; storage units can track size, occupancy, access, move-in/out, and waitlist facts. Existing rental agreements remain the authority for who has a unit and when—the physical profile enriches that lifecycle rather than replacing it.

### Run the rental desk

Use **Business → Rental** for the in-the-moment operating view. The summary separates ready and blocked capacity from current commitments, then presents one highest-priority exception with one recommended action. Typical exceptions include an overdue return, a unit awaiting return inspection, a maintenance hold, an incomplete kit, storage move-in/out work, or demand that exceeds available stock.

Keep the physical record current whenever a unit changes yard bay, facility position, readiness, maintenance state, kit completeness, or storage access state. If the screen cannot identify one organization safely, it refuses to choose instead of showing or changing another organization's units. Historical utilization, return on assets, and owner trends belong in **Business → Performance**; they are deliberately kept off the counter and yard hot path.

## What You Can Do

- Set up or update your storefront using the guided setup wizard
- Configure which sections appear on each page and in what order
- Add, edit, or remove items available for purchase or booking
- Manage the booking calendar — set availability, block dates, assign service providers
- Review and respond to enquiries arriving in the storefront inbox
- Track setup progress from the storefront home and see what generated content exists
- Recover generated content after removing a service line — restore it, or remove the retained items and sections permanently
- For medical and dental practices, review active patient-intake readiness from **Portal → Intake** and identify packets that need attention before a visit
- For rental businesses, maintain physical placement and readiness in **Storefront → Units**, then work the single most important live exception from **Business → Rental**
- For animal rescues, open the **Waiting list** from **Storefront → Animals** to see every animal listed for adoption, longest wait first, with the days each has waited — the page for picking who goes in the newsletter

## Related

- [Market Archetypes And Coworkers](../market-archetypes.md) — how archetypes connect the storefront, worker home, marketing, and AI coworkers.
