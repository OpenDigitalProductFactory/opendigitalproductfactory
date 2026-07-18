# Archetype Persona Creative Narratives

**Status:** Draft - 2026-07-18  
**Scope:** Narrative-first creative briefs for DPF owner-facing archetype marketing: 3 high-fidelity pilot personas, 21 source-category cards, and 1 required MSP spotlight card. Use these before generating still images, graphics, or short videos.  
**Related:** [Archetype Owner Positioning](../architecture/archetype-owner-positioning.md), [Archetype Audit Plan](../testing/archetype-audit-plan.md), [Archetype Persona Creative Assets Design](../superpowers/specs/2026-07-18-archetype-persona-creative-assets-design.md)

## 1. Creative Backbone

The customer-facing story is owner-first:

> Keep doing the work customers pay you for. Give the work around the work to governed AI coworkers.

Every visual should show a real owner or key employee in the business, with DPF as a practical work surface. The recognizable DPF UX anchor is the live portal `/workspace` pattern: a "Living business" identity, a single "What needs you now" attention rail, coworker-prepared actions, and an operational twin or owner cockpit below it.

## 2. Shared Visual Style

Use realistic, documentary-style business scenes. The AI coworker appears through the DPF interface: a calm side panel, a decision card, a prepared draft, a highlighted exception, or an owner-approval action. The owner stays visually central. Avoid robot mascots, generic AI glow, fantasy dashboards, and abstract stock imagery.

Each narrative card is paired with the claim/proof register in Section 5. That register is part of the card system: it names the safe current-state claim, planned-state claim, live DPF UI anchor, source/proof references, and permission status for every persona, source category, or required spotlight. The MSP spotlight is a `professional-services` leaf spotlight, not a 22nd source category.

## 3. Pilot Persona Narratives

### Dale - HVAC Owner

**Owner moment:** Dale has four trucks on the road and is still close enough to the work that he knows which technician is likely to call about a missing capacitor, filter, or control board. The phones are busy, the weather is driving emergency demand, and every warehouse run steals time from the next customer.

**Necessary-evil jobs:** job triage, urgency sorting, truck stock, customer ETA updates, restock signals, technician readiness, quote follow-up.

**DPF coworker help:** the field-service coworker keeps the "What needs you now" rail focused on unscheduled urgent jobs, trucks missing parts, customers needing updates, and restock actions. Dale approves the sensitive calls: reschedule a customer, prioritize an emergency, or start a small truck-stock feature request.

**Before/after block:** Before DPF, Dale finds out a truck is missing a part when the technician is already in the driveway. After DPF, the coworker turns parts-used updates into restock signals and shows which jobs, trucks, and customers need attention before the day slips.

**Short-video narrative:**  
Beat 1: Dale closes a furnace panel while his phone shows two missed office calls.  
Beat 2: DPF opens to "Living business: HVAC repair" and "What needs you now."  
Beat 3: Coworker cards show "Emergency no heat: needs dispatch," "Truck 3 low on ignitors," and "Customer update drafted for 2:00 PM delay."  
Beat 4: Dale approves the customer update and assigns the emergency job to the nearest technician.  
Beat 5: The truck-stock board shows a restock task for the warehouse.  
Beat 6: Dale gets back to the job with the line: "DPF keeps the shop moving while you keep homes running."

**Still-image prompt:** Realistic documentary photo of a small HVAC shop owner in a service van bay, work jacket, phone and tablet visible, DPF workspace UI on the tablet showing "What needs you now" cards for urgent jobs, truck parts, technician readiness, and customer updates; warm practical lighting, believable small business environment, no robot, no sci-fi glow.

**Storyboard frame prompts:**  
1. HVAC owner beside open van doors checking a DPF tablet before the morning route.  
2. Close-up of DPF workspace with urgent job, truck-stock, and customer-update cards.  
3. Technician marking a part used from a mobile job screen.  
4. Owner approving a customer ETA update in the coworker panel.  
5. Calm shop scene with trucks leaving and restock task visible.

**UX substitution note:** Use the real `/workspace` "What needs you now" rail. Replace generic demo activity with urgent job triage, truck-stock exceptions, technician load, restock tasks, and customer-delay drafts.

**Test emphasis:** urgent job intake must capture job type, urgency, property type, technician/dispatch context, and truck-stock/restock signals without leaking platform language.

### Linda - Dental Scheduler

**Owner moment:** Linda is at the front desk before the first patient arrives. She is not only looking at a calendar; she is checking whether the day will hold together: missing forms, bounced reminders, overloaded hygienists, new-patient intake, emergency slots, and follow-up calls.

**Necessary-evil jobs:** appointment readiness, missing-form chasing, confirmation follow-up, practitioner load, no-show risk, privacy-safe patient communication.

**DPF coworker help:** the clinic coworker scans tomorrow's schedule, turns missing forms into ready-to-send reminders, flags failed confirmations, and shows which appointments need human judgment. Linda approves messages and adjusts overloaded blocks before the waiting room backs up.

**Before/after block:** Before DPF, Linda pieces readiness together from forms, reminder logs, and memory. After DPF, the coworker gives her a clean readiness board: ready visits, missing forms, failed reminders, no-show risk, and overloaded chairs.

**Short-video narrative:**  
Beat 1: Linda unlocks the clinic and sees a full appointment day.  
Beat 2: DPF opens to "Living business: Dental practice" with "What needs you now."  
Beat 3: Coworker cards show "New patient missing intake," "Reminder bounced," and "Hygienist load high after 2:00 PM."  
Beat 4: Linda approves a form reminder and moves one follow-up call into the queue.  
Beat 5: The schedule view shifts from red warnings to ready/needs action.  
Beat 6: Close on Linda greeting the first patient: "DPF helps the front desk fix tomorrow's problems today."

**Still-image prompt:** Realistic dental front desk scene, scheduler reviewing a clean DPF workspace on a desktop monitor, appointment readiness board visible with missing forms, confirmations, practitioner load, and privacy-safe coworker suggestions; bright neighborhood clinic, calm professional mood, no patient private details, no robot.

**Storyboard frame prompts:**  
1. Dental scheduler reviewing tomorrow's packed schedule before opening.  
2. DPF coworker panel highlighting missing forms and failed reminders.  
3. Scheduler approving a patient reminder draft with privacy-safe copy.  
4. Practitioner-load indicator showing an overloaded hygiene block.  
5. Scheduler welcoming a patient while the readiness board stays calm.

**UX substitution note:** Use "What needs you now" for readiness exceptions and the operational twin for schedule health. Replace generic decision cards with missing forms, reminder failures, no-show risk, and practitioner load.

**Test emphasis:** patient/appointment fields, readiness states, reminder follow-up, practitioner load, and clinical refusal/privacy boundaries must be verifiable.

### Marisol - Retail Merchandiser

**Owner moment:** Marisol walks into one store while the other location is already selling through a different mix. Online orders are waiting, a delivery arrived late, a return needs a decision, and one shelf looks full in the system but thin in real life.

**Necessary-evil jobs:** order task triage, low-stock checks, receiving, returns, location transfer decisions, repeat-buyer follow-up, local campaign ideas.

**DPF coworker help:** the merchandising coworker turns the morning into a short action list: pickup order waiting, SKU low in Location A, incoming receipt needs count confirmation, return needs resale/refund decision, and a campaign draft for the products actually moving.

**Before/after block:** Before DPF, Marisol checks POS, ecommerce, stock notes, and receiving separately. After DPF, the coworker surfaces the few actions that protect sales today: orders, stock, receiving, returns, and location signals.

**Short-video narrative:**  
Beat 1: Marisol straightens a display and notices a gap on a best-selling shelf.  
Beat 2: DPF opens to "Living business: Specialty retail" with owner attention cards.  
Beat 3: Coworker cards show "Pickup order waiting," "Low stock: ceramic planter," "Return needs resale decision," and "Transfer suggested from North store."  
Beat 4: Marisol approves the transfer task and edits a customer pickup message.  
Beat 5: The coworker drafts a weekend campaign around the products with demand.  
Beat 6: Close on the store floor: "DPF turns retail noise into today's action list."

**Still-image prompt:** Realistic specialty retail shop with a merchandiser holding a tablet near a curated home-goods display, DPF workspace visible with order tasks, low-stock alerts, receiving, return exceptions, and location transfer suggestion; natural retail lighting, warm but operational, no generic ecommerce stock imagery.

**Storyboard frame prompts:**  
1. Retail merchandiser noticing a shelf gap in a beautiful small shop.  
2. DPF workspace showing low stock, open order, receiving, and return cards.  
3. Associate scanning incoming inventory while coworker updates receiving status.  
4. Merchandiser approving a transfer from the second location.  
5. Coworker draft for a weekend campaign tied to current stock.

**UX substitution note:** Use the owner attention cards for retail exceptions and the twin panel for location/store activity. Replace generic activity with order tasks, low-stock SKUs, receiving tasks, returns, and transfer suggestions.

**Test emphasis:** order tasks, product/SKU/location vocabulary, low-stock state, receiving task, return exception, and customer/order linkage must be verified.

## 4. Category Expansion Narratives

### Trades And Maintenance

**Owner moment:** The trade owner is often quoting, dispatching, chasing parts, and doing the work personally. Demand spikes when something breaks, and a weak intake or late update can cost the job.

**Necessary-evil jobs:** urgent inquiry triage, quote readiness, technician assignment, parts/stock signals, customer ETA updates, recurring maintenance follow-up.

**DPF coworker help:** the coworker keeps job details, urgency, technician readiness, and customer updates visible so the owner can approve the calls that affect trust and schedule.

**Before/after block:** Before DPF, the owner sorts vague messages while the crew waits for direction. After DPF, urgent jobs, quote details, and customer updates are already organized for action.

**Short-video narrative:** Owner finishes a service call; DPF shows urgent inquiry, missing quote detail, technician load, and customer update draft; owner approves dispatch and gets back to the next job.

**Still-image prompt:** Realistic trades business owner in a van or small office with DPF workspace showing urgent job requests, property details, technician load, quote follow-up, and customer update cards.

**Storyboard frame prompts:** emergency inquiry, job-detail card, technician assignment, customer ETA approval, owner returning to work.

**UX substitution note:** `WorkspaceTwinHero` + `OperatorCockpit` + `OwnerDecisionCards`: replace generic decisions with urgent job intake, quote readiness, technician load, parts/restock signals, and customer-delay drafts.

**Test emphasis:** job type, urgency, property type, dispatch context, quote language, and licensed-work framing must be verified.

### Beauty And Personal Care

**Owner moment:** The salon or spa owner earns money in the chair or treatment room, but the business leaks time through no-shows, gaps, rebooking, practitioner availability, and seasonal promotions.

**Necessary-evil jobs:** booking gaps, repeat-client follow-up, provider-specific availability, package reminders, campaign drafting.

**DPF coworker help:** the coworker watches the calendar, flags gaps, drafts reactivation messages, and prepares offer ideas without taking over final client communication.

**Before/after block:** Before DPF, quiet slots and missed rebookings hide in the calendar. After DPF, the coworker surfaces who to follow up with and which openings can still be filled.

**Short-video narrative:** Owner finishes a client service; DPF shows tomorrow's gaps, a bridal-package follow-up draft, and a provider availability conflict; owner approves the follow-up and returns to the floor.

**Still-image prompt:** Realistic salon owner at a styling station with DPF calendar and coworker cards showing open slots, repeat-client reminders, and seasonal campaign draft; natural salon lighting, no robot.

**Storyboard frame prompts:** calendar gap, coworker rebooking draft, provider-specific slot check, owner approving client message.

**UX substitution note:** Replace generic attention cards with open appointment slots, no-show risk, rebooking reminders, and provider availability.

**Test emphasis:** provider-specific scheduling, duration variants, client vocabulary, and no account-balance language.

### Healthcare And Wellness

**Owner moment:** A practitioner-owner wants the encounter to be ready and safe, not buried in missing paperwork, unclear appointment reasons, or risky AI advice.

**Necessary-evil jobs:** intake readiness, reminders, follow-up tasks, practitioner load, compliance prompts, safe escalation.

**DPF coworker help:** the coworker prepares operational readiness and refuses clinical judgment, crisis advice, or diagnosis.

**Before/after block:** Before DPF, clinical readiness depends on memory and manual checking. After DPF, operational exceptions surface early while professional judgment stays with the practitioner.

**Short-video narrative:** Practitioner reviews the day; DPF flags missing intake, a follow-up queue, and a compliance-safe escalation; owner approves admin actions and keeps care decisions human.

**Still-image prompt:** Realistic small healthcare practice office, practitioner reviewing DPF readiness board with appointment reasons, missing forms, follow-ups, and safe boundary note; no private patient details.

**Storyboard frame prompts:** readiness board, missing intake card, safe refusal/escalation card, practitioner approving admin follow-up.

**UX substitution note:** Replace generic cards with patient readiness, forms, appointment reason, follow-up, and privacy boundary prompts.

**Test emphasis:** patient fields, records linkage, reminder workflow, and clinical/mental-health refusal behavior.

### Pet Services

**Owner moment:** The owner knows every pet is different, but pet size, temperament, medication notes, boarding dates, and recurring walks are easy to lose across texts and forms.

**Necessary-evil jobs:** pet profile capture, booking duration, boarding ranges, recurring walks, care notes.

**DPF coworker help:** the coworker keeps pet context attached to the booking and turns special instructions into visible care tasks.

**Before/after block:** Before DPF, pet details live in scattered notes. After DPF, the pet profile travels with the appointment, stay, or walk.

**Short-video narrative:** Groomer opens DPF; coworker flags a large-dog duration, a medication note for boarding, and a recurring walk change; owner approves the schedule adjustment.

**Still-image prompt:** Realistic pet grooming or boarding desk with DPF pet profile and schedule cards for size, temperament, stay dates, and recurring care.

**Storyboard frame prompts:** named pet profile, grooming duration warning, boarding date range, owner approving care-note follow-up.

**UX substitution note:** Replace generic activity with pet records, date ranges, recurring walks, and care instructions.

**Test emphasis:** pet `ConfigurationItem`, boarding date ranges, recurring booking, and pet vocabulary.

### Food And Hospitality

**Owner moment:** The owner is cooking, serving, or preparing orders while reservations, catering quotes, allergen notes, custom orders, and shop purchases arrive through different paths.

**Necessary-evil jobs:** reservation readiness, party-size capture, catering quote details, allergen notes, custom-order follow-up.

**DPF coworker help:** the coworker separates bookings, quotes, and orders, then prepares the right next action for each.

**Before/after block:** Before DPF, every food request feels like another message to interpret. After DPF, reservations, catering inquiries, and orders land in the right workflow.

**Short-video narrative:** Owner checks DPF between prep tasks; coworker shows a large-party reservation, a catering quote missing guest count, and a bakery order ready for pickup.

**Still-image prompt:** Realistic cafe or catering kitchen with DPF workspace showing reservation, catering inquiry, bakery order, and allergen note cards.

**Storyboard frame prompts:** kitchen prep, reservation card, catering quote card, allergen/care note, owner approving customer follow-up.

**UX substitution note:** Replace generic cards with party-size bookings, catering guest-count inquiries, bakery orders, and allergen capture.

**Test emphasis:** mixed CTA behavior, party-size fields, event/guest-count fields, order flow, and dietary capture.

### Retail And Goods

**Owner moment:** The retail owner is merchandising, fulfilling, receiving, handling returns, and trying to keep stock aligned with demand across the shop floor and online orders.

**Necessary-evil jobs:** order triage, stock checks, receiving, returns, delivery dates, custom commissions, wholesale inquiries, repeat-buyer campaigns.

**DPF coworker help:** the coworker surfaces orders, low-stock exceptions, receiving tasks, returns, and campaign ideas based on the products and locations that matter.

**Before/after block:** Before DPF, stock and order work is scattered across systems and shelves. After DPF, the coworker turns orders, inventory, receiving, and returns into a short owner action list.

**Short-video narrative:** Owner notices a shelf gap; DPF shows low stock, online order, incoming receipt, return exception, and campaign draft; owner approves transfer or restock action.

**Still-image prompt:** Realistic retail owner in a small shop with DPF workspace showing products, SKUs, order tasks, low stock, receiving, returns, and location signals.

**Storyboard frame prompts:** shelf gap, low-stock card, receiving task, return decision, owner approving restock or transfer.

**UX substitution note:** `WorkspaceTwinHero` + `OperatorCockpit` + `WorkspaceTwinPanel`: replace generic activity with order tasks, low-stock SKUs, receiving, returns, location signals, and customer/order linkage.

**Test emphasis:** shop CTA, product/SKU vocabulary, order-to-customer linkage, wholesale inquiry exception, and delivery/custom-commission flows.

### Fitness And Recreation

**Owner moment:** The owner teaches classes or manages the floor while membership renewals, attendance dips, class capacity, and package follow-ups quietly decide revenue.

**Necessary-evil jobs:** membership renewal, attendance exceptions, class reminders, package depletion, churn signals.

**DPF coworker help:** the coworker watches retention, drafts member follow-ups, and flags classes or tiers needing action.

**Before/after block:** Before DPF, renewals and missed attendance are discovered late. After DPF, the coworker turns retention into today's action list.

**Short-video narrative:** Instructor finishes a class; DPF shows members nearing renewal, low attendance in a class, and a drafted reactivation message.

**Still-image prompt:** Realistic gym or studio owner with DPF membership board showing renewals, attendance gaps, class schedule, and reactivation draft.

**Storyboard frame prompts:** class in progress, DPF retention cards, owner approving reactivation message, class schedule filling.

**UX substitution note:** Replace generic activity with member renewals, class capacity, attendance, and package reminders.

**Test emphasis:** recurring billing language, member/student vocabulary, tiers, emergency contact/DOB, and class schedule.

### Education And Training

**Owner moment:** The owner teaches or coordinates instructors while parent/student details, learner level, pickup logistics, cohort schedules, and B2B training inquiries pile up.

**Necessary-evil jobs:** payer/learner separation, scheduling, instructor assignment, level tracking, safeguarding reminders, corporate inquiry scoping.

**DPF coworker help:** the coworker keeps learner context attached to the booking and prepares follow-ups for parents, students, instructors, or corporate buyers.

**Before/after block:** Before DPF, admin blurs parent, learner, instructor, and class details. After DPF, the coworker keeps each role clear.

**Short-video narrative:** Tutor checks DPF; coworker flags a missing learner level, a driving-school pickup detail, and a corporate training inquiry needing scoping.

**Still-image prompt:** Realistic tutoring or training center with DPF board showing learner profile, parent contact, instructor assignment, and corporate program inquiry.

**Storyboard frame prompts:** instructor preparing lesson, learner detail card, parent follow-up draft, corporate training brief.

**UX substitution note:** Replace generic cards with learner-vs-payer records, instructor assignment, pickup/location fields, and B2B program scoping.

**Test emphasis:** learner-vs-payer fields, instructor/location capture, safeguarding tone, and corporate-training vocabulary.

### Professional Services

**Owner moment:** The owner sells expertise but loses hours qualifying vague inquiries, writing proposals, tracking retainers, and collecting proof.

**Necessary-evil jobs:** qualification, proposal drafts, retainer/milestone tracking, proof assets, regulated advice boundaries.

**DPF coworker help:** the coworker structures intake, drafts a proposal outline, tracks engagement state, and keeps legal/accounting boundaries explicit.

**Before/after block:** Before DPF, expertise gets trapped behind admin. After DPF, the coworker turns a loose inquiry into a scoped engagement draft.

**Short-video narrative:** Advisor reviews DPF; coworker summarizes a new client inquiry, drafts a proposal outline, and flags a regulated-advice boundary for owner review.

**Still-image prompt:** Realistic professional-services office with DPF client engagement board showing inquiry brief, proposal draft, retainer status, and compliance prompt.

**Storyboard frame prompts:** client inquiry, coworker proposal draft, proof asset suggestion, owner approval boundary.

**UX substitution note:** Replace generic attention with scoped inquiries, proposal drafts, retainers, milestones, and proof prompts.

**Test emphasis:** clients/engagements vocabulary, regulated disclaimers, portfolio proof, and retainer/milestone finance framing.

### IT Managed Services - Required MSP Spotlight

**Owner moment:** The MSP owner is accountable for many client environments, but trust depends on keeping tickets, assets, agreements, and risks separated.

**Necessary-evil jobs:** ticket triage, client estate separation, agreement renewal, incident follow-up, improvement backlog.

**DPF coworker help:** the coworker keeps each client estate isolated and prepares the next service action without mixing client data.

**Before/after block:** Before DPF, client context switching creates risk. After DPF, every incident, asset, and agreement stays attached to the right client.

**Short-video narrative:** MSP owner opens DPF; coworker flags one client incident, one renewal, one stale asset, and one improvement proposal, all scoped by client.

**Still-image prompt:** Realistic MSP operations desk with DPF multi-client service board, separate client estate panels, incidents, assets, and agreement renewal cards.

**Storyboard frame prompts:** service desk, client estate separation, incident card, renewal card, owner approving client-safe action.

**UX substitution note:** Replace generic cards with per-client incidents, assets, agreements, and no-cross-client decision cards.

**Test emphasis:** strict estate separation, service-agreement activation, incident vocabulary, and no client data leakage.

### Nonprofit And Community

**Owner moment:** The director is fundraiser, program coordinator, volunteer wrangler, and reporting clerk, often after hours.

**Necessary-evil jobs:** donor thanks, receipts, volunteer shifts, beneficiary/program updates, grant/reporting notes, campaign drafts.

**DPF coworker help:** the coworker drafts donor follow-up, keeps programs and volunteers visible, and avoids turning supporters into customers.

**Before/after block:** Before DPF, mission work competes with donor admin. After DPF, the coworker prepares the thanks, receipts, and program follow-ups that keep support moving.

**Short-video narrative:** Director leaves a program site; DPF shows donation receipts, volunteer gaps, and a donor update draft awaiting approval.

**Still-image prompt:** Realistic nonprofit office or community program scene with DPF board showing donor thank-you draft, volunteer slots, program tasks, and receipt status.

**Storyboard frame prompts:** program work, donor thank-you card, volunteer gap, receipt status, director approving update.

**UX substitution note:** Replace generic attention with donors, volunteers, beneficiaries, program tasks, and receipts.

**Test emphasis:** donate CTA, receipt without invoice, donor/supporter vocabulary, cooperative governance where relevant.

### HOA And Property Management

**Owner moment:** The property manager or board member is balancing resident requests, dues questions, vendors, violations, reservations, and owner communication.

**Necessary-evil jobs:** request routing, property/unit context, violation follow-up, vendor tasks, amenity bookings, resident updates.

**DPF coworker help:** the coworker turns resident issues into routed actions and keeps the language civic/community-oriented, not sales-oriented.

**Before/after block:** Before DPF, requests scatter across email and text. After DPF, every request carries property context and an owner-ready next step.

**Short-video narrative:** Manager opens DPF; coworker shows urgent leak request, amenity reservation, dues question, and vendor follow-up.

**Still-image prompt:** Realistic property management office with DPF resident request board showing unit/address, urgency, vendor status, violation follow-up, and amenity booking.

**Storyboard frame prompts:** resident request, property context card, vendor assignment, amenity booking, manager approving update.

**UX substitution note:** Replace generic activity with resident/unit requests, urgency, vendor tasks, dues/covenant prompts, and audience switching.

**Test emphasis:** resident/homeowner vocabulary, property/unit/urgency capture, amenity booking, and landlord/tenant framing.

### Software Platform

**Owner moment:** The founder is selling, supporting, learning from users, and deciding what to build next in the same day.

**Necessary-evil jobs:** demo follow-up, pilot tracking, user feedback, backlog shaping, release communication, campaign proof.

**DPF coworker help:** the coworker turns customer signals into product learning and governed improvement work.

**Before/after block:** Before DPF, customer feedback sits apart from product work. After DPF, inquiries, pilots, backlog, and proof connect.

**Short-video narrative:** Founder reviews DPF; coworker links a demo request, pilot note, support issue, and backlog candidate to the product.

**Still-image prompt:** Realistic SaaS founder workspace with DPF product cockpit showing demo requests, pilots, support signals, backlog items, and campaign proof cards.

**Storyboard frame prompts:** demo request, customer signal, backlog creation, proof asset, founder approving product action.

**UX substitution note:** Replace generic cards with inquiry-to-inbox-to-backlog flow and digital-product association.

**Test emphasis:** inquiry-to-backlog linkage, product association, and no recursive DPF-as-container confusion.

### Banking And Financial Services

**Owner moment:** The operator wants growth, but every relationship-opening step carries disclosure, KYC, jurisdiction, and core-system boundaries.

**Necessary-evil jobs:** relationship intake, KYC readiness, disclosure prompts, follow-up, product education, compliant campaign review.

**DPF coworker help:** the coworker prepares engagement and relationship workflows while keeping regulated advice and money movement outside the promise.

**Before/after block:** Before DPF, growth and compliance live in different mental piles. After DPF, the coworker keeps relationship work prepared and clearly bounded.

**Short-video narrative:** Banker opens DPF; coworker shows an incomplete KYC checklist, disclosure pack, member/customer follow-up, and campaign draft requiring review.

**Still-image prompt:** Realistic community bank office with DPF relationship-opening board showing KYC checklist, disclosure pack, BIAN capability map, and safe campaign draft.

**Storyboard frame prompts:** branch conversation, KYC card, disclosure prompt, campaign review, operator approval.

**UX substitution note:** Replace generic attention with KYC/disclosure readiness, relationship intake, and regulated approval cards.

**Test emphasis:** BIAN perspective, FDIC/NCUA/NMLS packs, no cart/book/donate drift, and no rate/legal advice.

### Public Sector And Civic

**Owner moment:** The clerk, utility manager, or public-safety administrator serves residents under public obligations, not a normal sales funnel.

**Necessary-evil jobs:** 311 routing, permit intake, service requests, ratepayer questions, records requests, notices, sensitive-data refusals.

**DPF coworker help:** the coworker routes civic work and prepares communication while preserving statutory boundaries.

**Before/after block:** Before DPF, resident requests disappear into inboxes. After DPF, each request has a public-service path and a clear boundary.

**Short-video narrative:** Clerk opens DPF; coworker shows permit request, utility connection issue, records request, and a sensitive lookup refusal.

**Still-image prompt:** Realistic small-town municipal office with DPF resident-service board showing permit queue, utility service request, records request, and public meeting notice tasks.

**Storyboard frame prompts:** resident counter, civic request card, utility service card, records request, refusal/route card.

**UX substitution note:** Replace generic cards with residents/ratepayers, permits, 311, records requests, statutory-fee prompts, and public-safety refusals.

**Test emphasis:** resident/ratepayer vocabulary, statutory-fee framing, compliance placeholders, and law-enforcement CJI refusal.

### Automotive Services

**Owner moment:** The owner is in the field and the job depends on vehicle details, part availability, location, ETA, and trust.

**Necessary-evil jobs:** VIN/service capture, parts check, routing, ETA updates, calibration/bonding prompts, review follow-up.

**DPF coworker help:** the coworker prepares the mobile job, flags required details, drafts customer updates, and keeps emergency work distinct from scheduled service.

**Before/after block:** Before DPF, missing vehicle details slow the job after dispatch. After DPF, the coworker gets the vehicle, part, route, and customer update ready.

**Short-video narrative:** Mobile technician-owner opens DPF; coworker flags windshield SKU, ADAS calibration note, roadside ETA, and customer update.

**Still-image prompt:** Realistic mobile auto-service van with DPF tablet showing VIN/service details, parts, route, ETA, calibration note, and customer update draft.

**Storyboard frame prompts:** mobile van, vehicle detail card, route/ETA, calibration prompt, owner approving update.

**UX substitution note:** Replace generic attention with field-dispatch jobs, VIN/part details, roadside urgency, and certified-work prompts.

**Test emphasis:** field dispatch, VIN/part/calibration posture, roadside/locksmith emergency behavior, and honest diagnosis language.

### Moving And Logistics

**Owner moment:** The owner coordinates crews, trucks, estimates, routes, load details, paperwork, and anxious customers on a time-boxed day.

**Necessary-evil jobs:** route/load planning, crew capacity, estimate follow-up, chain-of-custody, disposal/manifest, status updates.

**DPF coworker help:** the coworker turns an inquiry into a route/load plan and keeps crew, truck, and customer updates visible.

**Before/after block:** Before DPF, moving-day surprises show up at the curb. After DPF, the coworker prepares crew, route, load, and communication before the truck rolls.

**Short-video narrative:** Owner checks DPF; coworker shows a heavy-load estimate, crew-hours warning, route constraint, and drafted arrival update.

**Still-image prompt:** Realistic moving company dispatch desk with DPF route/load board showing crew-hours, truck capacity, addresses, customer status updates, and disposal/manifest note.

**Storyboard frame prompts:** truck loading, route board, crew capacity card, customer update draft, owner approving plan.

**UX substitution note:** Replace generic attention with route/load planning, crew/truck capacity, B2B route accounts, and disposal/chain-of-custody prompts.

**Test emphasis:** field dispatch, route/load planning, B2B account routes, consolidated billing, and DOT/chain-of-custody prompts.

### Security Services

**Owner moment:** The owner sells trust and coverage, but the daily burden is posts, patrols, incidents, licenses, installs, and monitoring continuity.

**Necessary-evil jobs:** post assignment, patrol route, incident documentation, install follow-up, monitoring renewal, license prompts.

**DPF coworker help:** the coworker watches coverage and documents what needs review without fear-driven marketing or unsafe authority claims.

**Before/after block:** Before DPF, site coverage and incidents live in scattered logs. After DPF, the coworker keeps posts, patrols, installs, and renewals visible.

**Short-video narrative:** Owner opens DPF; coworker shows uncovered post, incident note needing review, install follow-up, and monitoring renewal.

**Still-image prompt:** Realistic security operations office with DPF site coverage board showing patrol posts, incident review, install tasks, license prompt, and monitoring renewal.

**Storyboard frame prompts:** patrol site board, uncovered post card, incident review card, install/monitoring handoff, owner approval.

**UX substitution note:** Replace generic activity with guard posts, patrol routes, incidents, alarm/CCTV installs, monitoring agreements, and licensing prompts.

**Test emphasis:** service agreements, post/patrol/incident vocabulary, low-voltage/licensing prompts, and credible tone.

### Real Estate And Construction

**Owner moment:** The builder-owner sells a high-trust project, then coordinates tours, selections, design consultations, milestones, subcontractors, draws, and warranty follow-up.

**Necessary-evil jobs:** tour booking, design consult prep, selections, milestone/draw readiness, subcontractor coordination, warranty prompts.

**DPF coworker help:** the coworker keeps the sales front door connected to the build project and flags draw or warranty items needing owner judgment.

**Before/after block:** Before DPF, model-home interest and build execution are disconnected. After DPF, the coworker ties tours, selections, milestones, and draws into one owner view.

**Short-video narrative:** Builder reviews DPF; coworker shows weekend model-home tours, design consult prep, draw milestone, and subcontractor task needing attention.

**Still-image prompt:** Realistic home-builder office or model home with DPF board showing model-home tours, selections, draw milestones, subcontractor tasks, and warranty follow-up.

**Storyboard frame prompts:** model-home tour, design consult card, draw milestone, subcontractor coordination, warranty follow-up.

**UX substitution note:** Replace generic attention with tour bookings, design consultations, project milestones, draw readiness, and build-team tasks.

**Test emphasis:** booking item plus inquiry CTA, projects module, milestone/draw billing readiness, and license/warranty framing.

### Media Production

**Owner moment:** The owner is creative lead and producer while budgets, briefs, crew, suites, assets, approvals, and deadlines all compete for attention.

**Necessary-evil jobs:** brief scoping, crew/suite capacity, review rounds, asset waits, approval chasing, rights/usage prompts.

**DPF coworker help:** the coworker turns the production timeline into visible bottlenecks and drafts approval nudges without promising creative or legal authority it does not have.

**Before/after block:** Before DPF, approvals hide in threads and deadlines drift. After DPF, the coworker shows what is waiting, who owes it, and what can move next.

**Short-video narrative:** Producer opens DPF; coworker shows missing client assets, review round overdue, crew conflict, and usage-rights prompt before delivery.

**Still-image prompt:** Realistic video production or post-production studio with DPF production timeline showing brief, deadline, crew/artists, review rounds, approval waits, and invoice milestone.

**Storyboard frame prompts:** studio timeline, missing asset card, approval draft, crew/suite conflict, owner approving client nudge.

**UX substitution note:** Replace generic activity with project brief, review/approval states, crew/suite capacity, deadline, and rights/usage prompts.

**Test emphasis:** project type/budget/deadline/brief fields, PIPELINE/timeline workspace posture, approval bottlenecks, and rights boundaries.

### Live Events And Venues

**Owner moment:** The venue or promoter owner lives by the calendar: dates, holds, capacity, staffing, access needs, contracts, guest experience, and settlement risk.

**Necessary-evil jobs:** date conflict checks, holds, private hire inquiries, ticket/package references, staffing readiness, accessibility needs, contract boundaries.

**DPF coworker help:** the coworker watches the calendar and flags conflicts, readiness gaps, and customer communication without claiming full ticketing or settlement.

**Before/after block:** Before DPF, date risk hides in separate calendars and emails. After DPF, the coworker shows holds, conflicts, readiness, and follow-up in one owner view.

**Short-video narrative:** Venue owner opens DPF; coworker shows date-hold conflict, private event inquiry, staffing gap, and access-needs follow-up.

**Still-image prompt:** Realistic live venue office or backstage planning table with DPF calendar showing holds, event packages, tickets references, staffing readiness, access needs, and promoter inquiry.

**Storyboard frame prompts:** event calendar, hold conflict card, staffing readiness, access-needs follow-up, owner approving inquiry response.

**UX substitution note:** Replace generic attention with dates, holds, capacity, staffing, access needs, and booking/ticket references.

**Test emphasis:** date/capacity/hold conflict handling, event vocabulary, purchase/inquiry references, weekend scheduling, and no seat-map/payment-rail overclaim.

### Rental And Shared Assets

**Owner moment:** The owner only earns when assets are reserved, used, returned, inspected, and available again. The day goes wrong when damage, late returns, or double-booking stay hidden.

**Necessary-evil jobs:** reservation readiness, checkout/return, inspection, damage notes, availability, utilization, member fairness for shared assets.

**DPF coworker help:** the coworker watches the reserve-use-return-inspect loop and turns fleet exceptions into owner actions.

**Before/after block:** Before DPF, asset availability is only as accurate as the last return note. After DPF, the coworker keeps reservations, returns, inspections, damage, and availability visible.

**Short-video narrative:** Rental owner opens DPF; coworker shows late return, inspection needed, damage note, high-utilization item, and one reservation conflict.

**Still-image prompt:** Realistic equipment rental yard or self-storage office with DPF asset board showing reservations, out/returned state, inspection queue, damage note, and utilization prompt.

**Storyboard frame prompts:** equipment yard, reservation card, return inspection, damage note, owner approving availability update.

**UX substitution note:** Replace generic cards with asset reservations, return/inspection states, damage, occupancy/utilization, and cooperative fairness where relevant.

**Test emphasis:** rental CTA, asset-pool vocabulary, reserve/use/return/inspect states, self-storage occupancy, production-equipment rental, and cooperative shared-machinery fairness.

## 5. Claim, UX Anchor, Source, And Permission Register

This register is part of the creative brief for every card above. "Current" is safe source-grounded positioning. "Planned" is allowed future-state creative direction only after the relevant implementation/audit evidence exists.

| Card | Current-state claim | Planned-state claim | UX anchor and replacement data | Source / proof references | Permission note |
| --- | --- | --- | --- | --- | --- |
| Dale - HVAC | DPF can be positioned around trades vocabulary, Build Studio dogfood, and the planned HVAC field-service need. | A field-service coworker proactively coordinates dispatch, truck stock, restock, and ETA actions. | `WorkspaceTwinHero` + `OperatorCockpit` + `OwnerDecisionCards`: urgent jobs, truck stock, technician load, restock, customer updates. | [Dale persona](../personas/dale-hvac.md); [owner positioning](../architecture/archetype-owner-positioning.md); audit Trades run. | Synthetic dogfood persona, not a customer-approved case study. |
| Linda - Dental | DPF can be positioned around dental-practice readiness, privacy-aware coworker help, and scheduler workflow. | A clinic coworker proactively maintains schedule readiness and queues safe follow-ups. | `WorkspaceTwinHero` + `OperatorCockpit` + `OwnerDecisionCards`: missing forms, failed reminders, no-show risk, practitioner load. | [Linda persona](../personas/linda-clinic.md); healthcare audit run; owner-positioning healthcare row. | Synthetic persona, not a customer-approved case study. |
| Marisol - Retail | DPF can be positioned around retail vocabulary, order tasks, inventory signals, and the merchandiser workspace need. | A merchandising coworker proactively coordinates stock, receiving, returns, transfers, and local campaigns. | `WorkspaceTwinHero` + `OperatorCockpit` + `WorkspaceTwinPanel`: orders, low stock, receiving, returns, location signals. | [Marisol persona](../personas/marisol-retail.md); retail audit run; owner-positioning retail row. | Synthetic persona, not a customer-approved case study. |
| Trades and maintenance | Current archetypes support trades-maintenance positioning, inquiry/quote framing, urgency/property capture expectations, and licensed-work guardrails. | Dedicated vertical coworker coordinates dispatch, customer updates, truck stock, recurring maintenance, and technician readiness. | `OperatorCockpit` + `OwnerDecisionCards`: urgent inquiries, quote readiness, dispatch, parts, customer-delay drafts. | Owner-positioning Trades row; audit Runs 1 and 19; value-stream §6.1. | Synthetic category story. |
| Beauty and personal care | Current archetypes support booking vocabulary, provider availability, duration variants, and appointment-checkout framing. | Coworker fills gaps, drafts reactivation messages, and watches no-show/rebooking risk. | `OperatorCockpit` + `OwnerDecisionCards`: open slots, no-show risk, rebooking reminders, provider availability. | Owner-positioning Beauty row; audit Run 2; value-stream §6.2. | Synthetic category story. |
| Healthcare and wellness | Current archetypes support healthcare-wellness vocabulary, patient/pet fields, booking readiness, and regulated boundary tests. | Coworker prepares encounter readiness across forms, reminders, load, follow-up, and compliance prompts. | `OperatorCockpit` + `OwnerDecisionCards`: patient readiness, forms, appointment reason, follow-up, privacy boundary prompts. | Owner-positioning Healthcare row; audit Runs 3 and 20; value-stream §6.3. | Synthetic category story. |
| Pet services | Current archetypes support pet-specific booking, pet record expectations, boarding/date-range and recurring-care tests. | Coworker keeps pet-specific care instructions and repeat care visible across bookings. | `WorkspaceTwinPanel` + `OwnerDecisionCards`: pet records, date ranges, recurring walks, care notes. | Owner-positioning Pet row; audit Runs 4 and 21; value-stream §6.4. | Synthetic category story. |
| Food and hospitality | Current archetypes support mixed reservation, inquiry, and purchase positioning with allergen/dietary capture as a trust surface. | Coworker separates reservation, catering, custom order, and shop workflows automatically. | `OperatorCockpit`: party-size bookings, catering guest count, bakery orders, allergen capture. | Owner-positioning Food row; audit Run 5; value-stream §6.5. | Synthetic category story. |
| Retail and goods | Current archetypes support shop CTA, catalog/order flow, wholesale inquiry exception, delivery/custom-commission expectations. | Coworker coordinates stock, receiving, returns, transfers, and demand-aware campaigns. | `WorkspaceTwinHero` + `OperatorCockpit` + `WorkspaceTwinPanel`: orders, SKUs, low stock, receiving, returns, location signals. | Owner-positioning Retail row; audit Run 6; value-stream §6.6; Marisol persona. | Synthetic category story. |
| Fitness and recreation | Current archetypes support membership/subscription language, member/student vocabulary, and class schedule expectations. | Coworker manages retention signals, attendance gaps, renewal reminders, and reactivation drafts. | `OperatorCockpit`: renewals, attendance, class capacity, package reminders. | Owner-positioning Fitness row; audit Run 7; value-stream §6.7. | Synthetic category story. |
| Education and training | Current archetypes support learner-vs-payer, instructor/location fields, and B2B corporate-training framing. | Coworker coordinates learner context, instructor assignment, safeguarding prompts, and corporate scoping. | `OwnerDecisionCards`: learner details, parent follow-up, instructor assignment, corporate inquiry. | Owner-positioning Education row; audit Run 8; value-stream §6.8. | Synthetic category story. |
| Professional services | Current archetypes support clients/engagements vocabulary, regulated disclaimers, portfolio proof, and retainer/milestone framing. | Coworker scopes inquiries, drafts proposals, tracks retainers, and maintains proof assets. | `OwnerDecisionCards`: inquiry briefs, proposal drafts, proof prompts, regulated boundary approvals. | Owner-positioning Professional Services row; audit Runs 9 and 22; value-stream §6.9. | Synthetic category story. |
| IT managed services spotlight | Current archetype supports MSP activation profile, service agreements, estate separation, and incident/helpdesk framing. | Coworker actively manages per-client incidents, assets, agreements, renewals, and improvement proposals. | `WorkspaceTwinPanel` + `OwnerDecisionCards`: per-client incidents, assets, agreements, no-cross-client actions. | Owner-positioning IT MSP row; audit Run 10; value-stream §6.10. | Synthetic `professional-services` leaf spotlight, not a separate category. |
| Nonprofit and community | Current archetypes support donation/inquiry membership framing, supporter vocabulary, receipt-not-invoice tests, and cooperative governance. | Coworker drafts donor thanks, volunteer coverage, program follow-ups, and grant/reporting notes. | `OperatorCockpit`: donors, volunteers, beneficiaries, program tasks, receipts. | Owner-positioning Nonprofit row; audit Runs 11 and 23; value-stream §6.11. | Synthetic category story. |
| HOA and property management | Current archetypes support resident/property vocabulary, unit/urgency capture, amenity booking, and dues/covenant framing. | Coworker routes resident issues, vendor tasks, violation follow-up, and landlord/tenant communications. | `OwnerDecisionCards`: resident/unit requests, urgency, vendor tasks, dues/covenant prompts. | Owner-positioning HOA row; audit Run 12; value-stream §6.12. | Synthetic category story. |
| Software platform | Current archetype supports inquiry-to-inbox-to-backlog meta-case and DPF-as-product positioning. | Coworker links customer signals to roadmap, campaigns, releases, and governed product changes. | `WorkspaceTwinHero` + `OwnerDecisionCards`: demos, pilots, support signals, backlog candidates. | Owner-positioning Software row; audit Run 0/13; value-stream §6.13. | Synthetic category story. |
| Banking and financial services | Current archetypes support BIAN-grounded relationship positioning, KYC/disclosure framing, and no-rate/no-legal-advice boundaries. | Coworker prepares relationship-opening workflows and compliant campaign review without moving money or replacing core banking. | `OwnerDecisionCards`: KYC checklist, disclosure readiness, relationship intake, campaign review. | Owner-positioning Banking row; audit Runs 14a-c; value-stream §6.14. | Synthetic category story. |
| Public sector and civic | Current archetypes support public-body vocabulary, statutory-fee framing, civic request flows, and CJI refusal boundaries. | Coworker routes resident services, permits, ratepayer issues, records requests, and public notices. | `OperatorCockpit` + `OwnerDecisionCards`: permits, 311, utility requests, records, refusal/route cards. | Owner-positioning Public Sector row; audit Runs 15-16; value-stream §6.15. | Synthetic category story. |
| Automotive services | Current archetypes support field-dispatch positioning, vehicle/service detail expectations, emergency-reactive leaves, and calibration/licensing prompts. | Coworker prepares VIN/part routing, ETA drafts, calibration notes, and mobile-service follow-up. | `OperatorCockpit`: field jobs, VIN/part details, roadside urgency, calibration/certification prompts. | Owner-positioning Automotive row; audit Run 24; value-stream §6.16. | Synthetic category story. |
| Moving and logistics | Current archetypes support field-dispatch, route/load planning, B2B account routes, and chain-of-custody/DOT prompts. | Coworker coordinates crew/truck capacity, estimates, route constraints, manifests, and customer updates. | `WorkspaceTwinPanel` + `OwnerDecisionCards`: route/load plans, crew/truck capacity, customer updates, chain-of-custody prompts. | Owner-positioning Moving row; audit Run 25; value-stream §6.17. | Synthetic category story. |
| Security services | Current archetypes support recurring agreements, post/patrol/incident vocabulary, install/monitoring composition, and licensing prompts. | Coworker watches coverage, incident review, install handoff, monitoring renewal, and credible marketing boundaries. | `OperatorCockpit`: guard posts, patrol routes, incident review, install tasks, monitoring renewals. | Owner-positioning Security row; audit Run 26; value-stream §6.18. | Synthetic category story. |
| Real estate and construction | Current archetypes support model-home/design-consult booking items, projects, draw readiness, and license/warranty framing. | Coworker coordinates tours, selections, milestones, subcontractors, draw readiness, and warranty follow-up. | `WorkspaceTwinHero` + `WorkspaceTwinPanel`: tour bookings, design consults, milestones, draw readiness, build-team tasks. | Owner-positioning Builder row; audit Run 27; value-stream §6.19. | Synthetic category story. |
| Media production | Current archetypes support project brief/deadline capture, scheduling defaults, timeline posture, and rights/usage boundaries. | Coworker manages approval bottlenecks, review rounds, crew/suite capacity, client nudges, and milestone handoff. | `WorkspaceTwinPanel` + `OwnerDecisionCards`: briefs, review states, asset waits, deadline, rights prompts. | Owner-positioning Media row; audit Run 28; value-stream §6.20. | Synthetic category story. |
| Live events and venues | Current archetypes support event vocabulary, date/capacity/hold conflict tests, purchase/inquiry references, and no-ticketing overclaim. | Coworker watches holds, conflict avoidance, staffing readiness, access needs, and booking/talent follow-up. | `WorkspaceTwinPanel` + `OwnerDecisionCards`: holds, capacity, staffing, access needs, ticket/package references. | Owner-positioning Events row; audit Run 29; value-stream §6.21. | Synthetic category story. |
| Rental and shared assets | Current archetypes support rental CTA, asset-pool vocabulary, reserve-use-return-inspect expectations, and storage/rental/cooperative variants. | Coworker manages availability, return inspections, damage notes, utilization prompts, and shared-asset fairness. | `OperatorCockpit` + `WorkspaceTwinPanel`: reservations, out/returned state, inspection, damage, utilization. | Owner-positioning Rental row; audit Run 17; value-stream §10.1. | Synthetic category story. |
