# Archetype Audit Plan — All 53 Archetypes

**Status:** Revised — 2026-06-10 (architecture / UX / operations review applied)  
**Scope:** Full audit of every seeded archetype via browser-driven fresh installs. Produces gap backlog items for post-audit execution.  
**Related:** [platform-qa-plan.md](platform-qa-plan.md), [fresh-install.ps1](../../scripts/fresh-install.ps1), [BIAN design spec](../superpowers/specs/2026-06-09-bian-banking-archetypes-design.md)

> **Inventory ground truth (verified 2026-06-10 against `origin/main` `packages/storefront-templates/src/archetypes/`):** 53 seeded archetypes, not 55. The five archetypes previously flagged "not yet confirmed" (`landscaping`, `cleaning-service`, `personal-trainer`, `counselling`, `wholesale-distribution`) ARE seeded and are now placed in Runs 1, 2, 3, and 6. `pet-rescue` is seeded once (category `nonprofit-community`) and is tested only in Run 11.

---

## 1. Purpose

DPF ships 53 archetypes across 14 categories. The platform must behave correctly for each organizational model — correct vocabulary, correct CTA, correct coworker framing, correct activation modules, correct compliance defaults. This audit drives each archetype through a browser-realistic experience and records gaps as backlog items.

**Out of scope for this plan:** executing the gap items. This thread produces the plan, the backlog snapshot, and the per-run scripts. Execution follows in a separate thread.

---

## 2. Constraints

- **All interaction via browser — with one documented exception.** Every test step is driven at `http://localhost:3000` through the portal UI. No direct DB writes, no SQL. **Exception (verified in code):** there is no UI to change archetype after setup — `/storefront/setup` redirects to `/storefront` once a `StorefrontConfig` exists (`apps/web/app/(shell)/storefront/setup/page.tsx`). The only swap path is the admin API `POST /api/storefront/admin/archetype-reset` (`mode: replace-seeded-content`). In-run swaps use that API call; the missing "change archetype" UI is itself **audit finding #1** — file a BI for it (the storefront settings page even references "the admin archetype reset" with no button to invoke it).
- **Swap-tier validity rule.** The archetype-reset API updates the archetype link, `Organization.industry`, `BusinessContext` industry/CTA, the business-capability perspective, and replaces seeded sections/items. It does **not** re-run setup-wizard provisioning (activation-profile module activation, compliance/regulatory packs, finance defaults, KYC provisioning). Therefore: Phases B, E, F are valid on a swapped archetype; **Phases A, C, D are only valid on the archetype that received the fresh install.** See Section 3 for how runs handle this.
- **Full reset between runs.** Each audit run begins from a clean install: volumes wiped, database re-seeded, no previously created organization.
- **Stay out of Build Studio.** Gap items are filed as backlog items; they are not promoted into Build Studio during this audit.
- **`pg_dump` is the authoritative backup.** A full database dump is taken before the first wipe and is the restore source after the final run (preserves IDs, timestamps, epic links, prompts, wiki overlays, provider config — everything the wipe destroys). MCP JSON snapshots are a secondary, human-readable verification aid only — re-creating backlog items via `create_backlog_item` generates **new IDs and breaks every existing cross-reference** (PRs, memory files, specs), so it is a last-resort fallback, never the plan of record. See Section 4.
- **Concurrent-session freeze.** During the audit, no other session may run work against the live install — wipes destroy in-flight capsules, and every PR merged to main triggers self-upgrade, recycling the portal mid-run (known behavior since PR #830). Either pause merge activity for the audit window or accept that a portal recycle invalidates the in-progress phase and that phase must be re-driven.
- **Abort criteria.** If a platform-wide blocker is found (setup wizard broken, coworker unresponsive on a clean install, fresh-install fails twice), STOP the run sequence, file the blocker BI, and do not burn further resets — the remaining runs would all reproduce the same finding.

---

## 3. Audit Run Strategy

53 archetypes across **Run 0 (pilot) + 18 install runs**. Each run = one fresh install. The **lead archetype** (bold) is the setup-wizard target and gets the full Phase A–F checklist. Additional archetypes in the same category are swapped in via the admin archetype-reset API (Section 2) and get **Phases B, E, F only** — their Phase A/C/D results would reflect the lead archetype's provisioning and would generate false gaps.

**Full-install rule for regulated archetypes:** any archetype whose test targets activation profiles, compliance packs, KYC provisioning, or finance defaults (Runs 10, 14a–c, 16) gets its **own fresh install** — those are exactly the surfaces a swap does not re-provision.

| Run | Category | Archetypes (lead bold) | CTAs Exercised |
|-----|----------|------------|----------------|
| 0 | Pilot / calibration (software-platform) | **software-platform** | inquiry — see Section 3a |
| 1 | Trades & Maintenance | **plumber**, electrician, facilities-maintenance, landscaping, cleaning-service | inquiry |
| 2 | Beauty & Personal Care | **hair-salon**, barber-shop, nail-salon, beauty-spa, optician, personal-trainer | booking |
| 3 | Healthcare & Wellness | **veterinary-clinic**, dental-practice, physiotherapy, counselling | booking |
| 4 | Pet Services | **pet-grooming**, pet-boarding, dog-walking | booking |
| 5 | Food & Hospitality | **restaurant**, catering, bakery | booking, inquiry, purchase |
| 6 | Retail & Goods | **retail-goods**, artisan-goods, florist, wholesale-distribution | purchase, inquiry |
| 7 | Fitness & Recreation | **gym**, yoga-studio, sports-club | purchase |
| 8 | Education & Training | **corporate-training**, tutoring, driving-school, music-school, dance-studio | booking, inquiry |
| 9 | Professional Services A | **consulting**, legal-services, marketing-agency, accounting | inquiry |
| 10 | Professional Services B | **it-managed-services** (full install — MSP activation profile) | inquiry (MSP profile) |
| 11 | Nonprofit & Community | **charity**, pet-rescue, animal-shelter, community-shelter, cooperative | donation, inquiry |
| 12 | HOA & Property Management | **homeowners-association**, condo-association, property-management-company | inquiry |
| 13 | Software & Platform | *folded into Run 0* — software-platform full A–F + extended meta-case run on the pilot install | inquiry |
| 14a | Banking | **community-bank** (full install — KYC + BIAN + FDIC pack) | inquiry (KYC) |
| 14b | Banking | **credit-union** (full install — member-owned + NCUA pack) | inquiry (KYC) |
| 14c | Banking | **mortgage-lending** (full install — NMLS/RESPA/TILA pack) | inquiry (NMLS) |
| 15 | Public Sector | **small-town-municipality**, municipal-utility | inquiry |
| 16 | Law Enforcement | **law-enforcement-agency** (full install — POST/CJIS-gate pack) | inquiry (public-body) |

Total fresh installs: 18 (Run 0, which also serves as Run 13's software-platform audit, + Runs 1–12, 14a–c, 15, 16). 53 unique archetypes covered: 18 with full A–F, 35 with B/E/F via swap. If Run 0 shows the swap path is unreliable, fall back to full installs per archetype for the affected runs and re-plan the schedule before proceeding.

> **Swapped-archetype Phase C/D spot-checks are still allowed** — but log findings as `observation` severity with an explicit "tested post-swap, provisioning not re-run" note, never as `critical`/`important`, until reproduced on a fresh install.

### 3a. Run 0 — Pilot / calibration (MANDATORY before Run 1)

Run 0 exists to validate the audit harness itself so the remaining 18 resets test the platform, not the plan's assumptions. On one fresh install (software-platform):

1. **Backup rehearsal** — take the pre-audit `pg_dump` (Section 4), restore it into a throwaway postgres container, and verify row counts match. Do not proceed to any wipe until the restore is proven.
2. **Inventory confirmation** — on the live install, confirm the archetype grid shows all 53 seeded archetypes; reconcile against the seed list in this doc's header. File a BI for any mismatch.
3. **Provider bootstrap check** — verify the claim that Anthropic is auto-configured from the environment on a fresh install. If providers need manual re-entry (especially OAuth-based ones), document the exact re-setup steps and add the time to every run's budget.
4. **Coworker health gate** — ask the COO a trivial question and confirm a sane response before any vocabulary scoring. Fresh-install AI routing/calibration has a known cold-start failure history; without this gate, routing failures get misattributed as archetype gaps in every run.
5. **Archetype-reset swap verification** — swap software-platform → consulting via the admin API, confirm sections/items/vocabulary/CTA actually change on the public portal, then swap back. This empirically validates the Tier-B/E/F strategy for all multi-archetype runs.
6. **Reference-number check** — drive one inquiry end-to-end and confirm a reference number is actually issued (checklist B5 assumes it; verify the assumption, and correct B5's pass criterion if the real confirmation UX differs).
7. **Timing calibration** — record wall-clock time for the full reset + setup + A–F pass. Use it to project the total schedule (planning estimate: 60–120 min per run lead + ~20–30 min per swapped archetype → roughly 25–35 hours total; expect multiple sessions across multiple days).
8. **Run 13 content** — Run 0's install IS the software-platform audit: run the full A–F checklist plus the Run 13 extended meta-case test (Section 7) on this install. No separate Run 13 reset.

---

## 4. Pre-Audit Backup & Restore

**The wipe destroys far more than the backlog:** epics/BIs (with their IDs, status history, and epic links), prompt edits (prompts live in the DB, editable via Admin > Prompts), wiki overlay drafts, provider credentials and calibration/probe results, work capsules, build dispatch history, and organization/branding config. A `pg_dump` captures all of it; an MCP JSON export captures only the backlog — and restoring from JSON via `create_epic`/`create_backlog_item` mints **new IDs**, silently breaking every cross-reference in PRs, specs, and memory files.

### 4a-0. Authoritative backup (perform ONCE, before Run 0's first wipe)

1. Dump the full database from the running postgres container to a path **outside Docker volumes** (e.g. `D:\DPF-audit-backup\pre-audit-YYYY-MM-DD.dump`, custom format `pg_dump -Fc`).
2. **Rehearse the restore** into a throwaway postgres container and verify epic/BI row counts match the live install (Run 0 step 1). A backup that has never been restored is not a backup.
3. Record the dump path, size, and row counts in the Run 0 findings file.

Per-run MCP JSON snapshots (4b) remain useful as a lightweight, human-readable verification aid and as a diff source for anything created *during* the audit itself — they are not the restore mechanism.

### 4a. Live backlog snapshot (as of 2026-06-10 — point-in-time verification reference only)

The following open and in-progress epics existed when this plan was written. Use these **counts** to sanity-check the post-restore state; the `pg_dump` is the source of truth for content. Do not hand-reconstruct from these tables.

#### In-Progress Epics (21)

| Epic ID | Title | Open | In-Progress | Done |
|---------|-------|------|-------------|------|
| EP-FULL-OBS | Full Observability | 0 | 1 | 1 |
| EP-GRID-WORKBOOKS | Universal Grid & Workbooks | 1 | 1 | 2 |
| EP-PARTNER-CHANNEL | Partner / Reseller Channel & Identity | 5 | 1 | 0 |
| EP-CRM-MKT-OPS | CRM and Marketing Operations | 0 | 1 | 4 |
| EP-INSTALL-HARDENING-2026-05-23 | First-run install path hardening | 11 | 10 | 2 |
| EP-ARCH-8D4F2A | Archetype Model V2 | 3 | 2 | 6 |
| EP-MCP | MCP tooling + token onboarding | 0 | 0 | 8 |
| EP-WIKI-001 | Platform Kernel Wiki | 7 | 1 | 8 |
| EP-PRINCIPLES | Principles as wiki kind | 3 | 0 | 7 |
| EP-CAPSULE | Portal Work Capsule control harness | 5 | 2 | 9 |
| EP-HIVE-SCOUT | Hive Scout autonomous coworker | 2 | 0 | 5 |
| EP-ROUTING-11 | Routing substrate #11 | 2 | 5 | 14 |
| EP-COWORKER-RT | Autonomous Coworker Runtime | 4 | 1 | 9 |
| EP-INSTALLER | Installer parity | 1 | 1 | 9 |
| EP-LICENSING | Licensing / Permit / Jurisdiction | 0 | 1 | 2 |
| EP-COMM-FABRIC | Employee Communication Fabric | 2 | 0 | 3 |
| EP-SBO | Small Business OS parity | 0 | 1 | 3 |
| EP-MARKETING | Marketing coworker + native readiness | 2 | 2 | 5 |
| EP-AGENTS-DOC | AGENTS.md + public docs refresh | 0 | 1 | 6 |
| EP-EDGE-NODE | DPF Edge Node | 1 | 3 | 10 |
| EP-DEPS-SWEEP | Dependabot / security alert sweep | 0 | 1 | 0 |

#### Open Epics (49)

See Appendix A for full list. Key high-priority open epics with substantial open items:

| Epic ID | Open Items | Priority |
|---------|------------|----------|
| EP-REDUCTION-GEAR-ARCH | 73 | 2 |
| EP-BUILD-STUDIO | 27 | — |
| EP-UPGRADE-LIFECYCLE | 8 | — |
| EP-WWMD-MCP | 16 | 5 |
| EP-9FC5D2FD (Dale persona hardening) | 23 | 10 |
| EP-COWORKER-INTERACTIVITY | 6 | — |
| EP-CLIENT-HOOK-PLANE | 8 | — |
| EP-MDM | 7 | 2 |
| EP-PROACTIVE-OPS | 11 | 2 |
| EP-INT-2E7C1A | 13 | — |
| EP-WORKTREE-HYGIENE | 10 | — |
| EP-CTRL-5E21A4 | 10 | — |

### 4b. Per-run snapshot procedure

Before each reset, capture anything created during the run:

1. Navigate to `/ops` → verify visible backlog items
2. Use MCP tool `list_epics` (all statuses) and `list_backlog_items` (all statuses) to export a JSON snapshot
3. Save as `docs/testing/backlog-snapshots/backlog-YYYY-MM-DD-runN.json`
4. **Commit the run's findings file to git** (Section 8 — findings live in the repo, not the database, so no wipe can take them)
5. Verify both files are written before running `fresh-install.ps1`

### 4c. Restore procedure (after all runs)

After the final audit run and before returning to normal development:

1. Stop the application containers; keep postgres running (or start a clean postgres)
2. Restore the pre-audit `pg_dump` from 4a-0 (`pg_restore --clean`) — this brings back the complete pre-audit state: backlog with original IDs, prompts, wiki overlays, provider config, org/branding
3. Restart the stack and verify against the 4a reference tables: epic counts, in-progress counts, and spot-check three known BI IDs (e.g. BI-FS-001) resolve to the same items
4. Drive one portal smoke pass: `/ops` loads with the expected backlog, coworker responds, storefront renders
5. File the audit's NEW gap BIs (Section 10) into the restored database — they were preserved in the git-committed findings files, not in any wiped DB

> **Fallback only:** if the `pg_dump` restore fails irrecoverably, re-create epics/BIs from the JSON snapshots via `create_epic`/`create_backlog_item` + `link_backlog_item_to_epic` — and accept that all BI/epic IDs change, then sweep specs/memory for broken references. This is damage control, not the plan.

---

## 5. Fresh Install Reset Procedure (Per Run)

Execute between each audit run. Takes approximately 5–10 minutes.

### Step 1 — Snapshot and persist findings

```
# Via MCP (in Claude Code terminal):
# Run list_epics + list_backlog_items, save to backlog-snapshots/
# Commit the previous run's findings file to git (Section 8)
```

Nothing that must survive the wipe may live only in the database or only in the session context.

### Step 2 — Wipe and reinstall

```powershell
# From repo root (D:\DPF):
.\scripts\fresh-install.ps1
```

The script itself runs `docker compose down -v` (line ~152) — no separate manual teardown needed. This wipes volumes (`pgdata`, `neo4jdata`, `qdrant_data`, `redis_data`) and re-seeds the database.

### Step 3 — Verify clean state

1. Navigate to `http://localhost:3000`
2. Confirm redirect to `/welcome` (not `/workspace` — which would mean old org data survived)
3. Confirm no organization exists (no banner, no pre-filled archetype)

### Step 4 — Configure AI provider + coworker health gate

1. Navigate to `/platform/ai/providers`
2. Verify the Anthropic provider bootstrapped from the environment (Run 0 confirms whether this claim holds); if not, configure it manually and record the steps
3. Verify provider shows healthy status
4. **Health gate:** ask the default coworker one trivial question and confirm a coherent response **before** scoring any AI phase. If the coworker is unresponsive or degraded, that is a platform finding (file it) — and all Phase B6/B7/E results for this run are blocked until resolved, not logged as archetype gaps.

### Step 5 — Run setup wizard

Follow the archetype-specific setup script in Section 7 for the current run. For non-lead archetypes in the run, swap via the admin archetype-reset API and run Phases B/E/F only (Section 3).

---

## 6. Standard Per-Archetype Test Checklist

Apply this checklist to every archetype within a run. Log findings in Section 8 (gap template).

> **Validity:** lead archetypes get all phases. Swapped archetypes get **B, E, F**; their A/C/D results are advisory-only observations (Section 3). Before scoring any phase, the expected values (CTA type, vocabulary, key services, activation modules) should be read from the archetype's seed definition in `packages/storefront-templates/src/archetypes/` — the persona blocks in Section 7 are test scripts, not the source of truth; where they disagree with the seed, the seed wins and the persona block gets corrected, not a BI filed.

### Phase A — Onboarding (SETUP)
- [ ] **A1** Navigate to `/welcome` → Setup wizard loads (SETUP step 1)
- [ ] **A2** Enter the run's fictional company URL (from persona table) → brand analysis runs
- [ ] **A3** Confirm archetype suggestion matches expected archetype (SETUP-03 analogue)
- [ ] **A4** Select the target archetype from the grid (or confirm auto-selected)
- [ ] **A5** Complete identity step — company name, address, timezone
- [ ] **A6** Complete financial setup — currency pre-fills correctly for locale
- [ ] **A7** Complete setup wizard — organization created, redirected to `/workspace`

### Phase B — Storefront (STORE)
- [ ] **B1** Navigate to `/storefront` → Workspace loads with correct archetype name
- [ ] **B2** Click "View Live" → Public portal renders with correct hero, service items
- [ ] **B3** Verify vocabulary — "Book Now" vs "Shop Now" vs "Get a Quote" vs "Donate" matches archetype CTA
- [ ] **B4** Verify service/product item names match archetype templates
- [ ] **B5** Trigger the primary CTA flow end-to-end (confirmation behavior calibrated in Run 0 — if the real UX confirms differently than a reference number, update this criterion before Run 1):
  - **booking**: calendar → select slot → fill form → confirm booking → reference number shown
  - **purchase**: add to cart / select item → checkout form → confirm → reference shown
  - **inquiry**: fill inquiry form → submit → reference shown
  - **donation**: select amount → fill details → confirm → reference shown
- [ ] **B5x** Negative path: submit the same CTA form with required fields empty → inline validation appears (no 500, no silent success)
- [ ] **B6** Coworker panel on `/storefront` → Marketing Specialist agent loads (AI-03 analogue)
- [ ] **B7** Verify archetype-specific vocabulary in coworker (no "FeatureBuild", "capsule", "worktree" language)

### Phase C — Business Context & Compliance (GRC)
- [ ] **C1** Navigate to `/storefront/settings/business` → Business context form loads
- [ ] **C2** Verify industry classification matches archetype category
- [ ] **C3** Navigate to `/compliance` → Dashboard loads
- [ ] **C4** For regulated archetypes (banking, healthcare, legal, law enforcement): verify licensing section shows correct jurisdiction placeholders

### Phase D — Finance Defaults (FIN)
- [ ] **D1** Navigate to `/finance` → Dashboard loads
- [ ] **D2** Verify currency default matches expected (USD unless locale suggested otherwise)
- [ ] **D3** For banking archetypes: verify BIAN capability perspective is accessible

### Phase E — Coworker Fit (AI)
- [ ] **E1** Navigate to `/workspace` → COO agent shown
- [ ] **E2** Ask COO: "What business are we in?" → Response uses archetype vocabulary (not generic)
- [ ] **E3** Ask COO: "What services do we offer?" → Lists archetype service items
- [ ] **E4** Verify coworker does NOT use platform-developer vocabulary (no "backlog", "epic", "build studio", "worktree", "MCP")
- [ ] **E5** Ask: "Help me prepare for a [archetype-specific scenario]" → Response is contextually relevant

### Phase F — Inbox & Operations (OPS)
- [ ] **F1** Complete a public storefront CTA submission (Phase B5)
- [ ] **F2** Navigate to `/storefront/inbox` → inquiry/booking appears
- [ ] **F3** Navigate to `/ops` → Workspace backlog loads (should be empty on fresh install)
- [ ] **F4** Send an inbox item "to backlog" → item appears under `/ops`

### Phase G — Responsive & resilience smoke (lead archetype only, once per run)
- [ ] **G1** Public portal at narrow viewport (~390px) → hero, CTA, and form remain usable; no horizontal overflow
- [ ] **G2** Browser refresh mid-CTA-flow → no corrupted state, flow restartable
- [ ] **G3** Public portal direct-load of a non-existent item/slug → graceful 404, not a stack trace

---

## 7. Archetype Inventory, Personas & Run Scripts

### Run 1 — Trades & Maintenance

**Fresh install target.** Five archetypes: `plumber` (lead, full A–F) then electrician, facilities-maintenance, landscaping, cleaning-service in sequence via the admin archetype-reset API (B/E/F each).

---

#### Archetype: `plumber`
**Fictional company:** Riverside Plumbing Solutions  
**Domain:** `riverside-plumbing.co` (use `.com` if scrape fails)  
**Persona — Operator:** Sandra Hooper, sole owner, 2-truck operation, handles bookings herself  
**Business model:** Emergency and planned residential/commercial plumbing. Quote-based pricing. Customer calls or submits inquiry online. Job assigned to technician. Invoiced after completion.  
**CTA:** inquiry  
**Key services to verify:** Leak Repair, Drain Clearing, Boiler Service, Emergency Call-Out, Bathroom Fitting  
**Vocabulary expected:** customers, jobs, call-outs, quotes, technicians  
**Vocabulary must NOT appear:** FeatureBuild, worktree, capsule, MCP, epic, backlog  
**Special:** Urgent urgency field in form (TRADES_FORM_FIELDS) — verify "Urgency" dropdown renders and submits

**Run-1 setup steps:**
1. Reset → fresh install
2. Brand URL: `riverside-plumbing.co` → expect archetype suggestion: `plumber` (or `trades-maintenance`)
3. Select `plumber` from grid
4. Company name: Riverside Plumbing Solutions | Timezone: America/Chicago | Currency: USD
5. Complete wizard → `/workspace`
6. Run Phases A–F
7. Log gaps

---

#### Archetype: `electrician`
**Fictional company:** Bright Wire Electric  
**Persona — Operator:** Mike Voltz, licensed electrician, 3 staff  
**Business model:** Installations, fault-finding, safety certification. Inquiry-to-quote model. Regulatory: NICEIC/NFPA compliance (UK/US).  
**CTA:** inquiry  
**Key services to verify:** Consumer Unit Installation, Fault Diagnosis, EV Charger Install, Safety Inspection, Emergency Rewire  
**Special:** Verify property type field in form renders

After completing plumber test: swap to `electrician` via the admin archetype-reset API → run Phases B/E/F.

---

#### Archetype: `facilities-maintenance`
**Fictional company:** ProSite Facilities Group  
**Persona — Operator:** Jamie Chen, operations manager, 15-technician FM company serving commercial landlords  
**Business model:** Planned maintenance contracts + reactive repair. B2B primary consumer. Quote pricing. HVAC Servicing is a key service item (the AC repair scenario).  
**CTA:** inquiry  
**Key services to verify:** Planned Maintenance Contract, HVAC Servicing, Reactive Repair, Building Inspection, Emergency Call-Out  
**Special — HVAC/AC test:** Ask coworker "A tenant is complaining about no cold air — what do we do?" → Response should reference HVAC Servicing, not technical platform terms.  
**Gap check:** BI-FS-001 (HVAC/AC Contractor Storefront Archetype) is an open backlog item — confirm whether a dedicated `hvac-contractor` leaf is present. If not, note the gap (it is not in the 53-archetype verified inventory).

After electrician test: swap to `facilities-maintenance` via the admin archetype-reset API → run Phases B/E/F.

---

#### Archetype: `landscaping`
**Fictional company:** GreenScape Outdoor Services  
**Persona — Operator:** Hank Morales, owner-operator, seasonal crew of 6  
**CTA:** inquiry  
**Key services to verify:** read from seed (lawn care, garden design, seasonal cleanup expected)  
**Special:** Seasonal/recurring service framing — ask coworker about scheduling a recurring mowing contract; verify "jobs"/"properties" vocabulary

After facilities-maintenance test: swap to `landscaping` via the admin archetype-reset API → run Phases B/E/F.

---

#### Archetype: `cleaning-service`
**Fictional company:** Spotless Spaces Cleaning Co.  
**Persona — Operator:** Renata Silva, owner, residential + commercial crews  
**CTA:** inquiry  
**Key services to verify:** read from seed (regular domestic clean, deep clean, end-of-tenancy, commercial contract expected)  
**Special:** Recurring vs one-off distinction; property size/frequency fields in inquiry form if present

After landscaping test: swap to `cleaning-service` via the admin archetype-reset API → run Phases B/E/F. End of Run 1.

---

### Run 2 — Beauty & Personal Care

**Fresh install target.** Six archetypes: `hair-salon` (lead, full A–F) then the rest via archetype-reset swaps (B/E/F). This category has the highest count and uses appointment-checkout commercial model with no customer-estate module.

---

#### Archetype: `hair-salon`
**Fictional company:** Studio 44 Hair  
**Domain:** `studio44hair.com`  
**Persona — Operator:** Chloe Martinez, salon owner, 4 stylists, appointment book full 3 weeks out  
**Business model:** Appointment-checkout. Clients book online, pay at checkout. No running account/billing. Booking is the primary CTA.  
**CTA:** booking  
**Key services to verify:** Women's Haircut & Style, Color Treatment, Highlights, Keratin Treatment, Bridal Package  
**Vocabulary expected:** clients, appointments, stylists, bookings, treatments  
**Special:** Verify `appointment-checkout` commercial model means NO account setup required; calendar shows stylist availability; no "invoice" or "account balance" in coworker responses  
**Activation profile check:** `customer-estate` module should NOT be active for this archetype

---

#### Archetype: `barber-shop`
**Fictional company:** The Fifth Chair Barbershop  
**Persona — Operator:** Devon King, master barber, 3-chair shop in downtown  
**CTA:** booking  
**Key services to verify:** Classic Haircut, Skin Fade, Beard Trim & Shape, Hot Towel Shave, Luxury Grooming Package  
**Special:** Confirm coworker uses "clients" not "customers" (barber vocabulary)

---

#### Archetype: `nail-salon`
**Fictional company:** Lacquer & Luxe  
**Persona — Operator:** Mei Nguyen, co-owner, 6 nail technicians  
**CTA:** booking  
**Key services to verify:** Gel Manicure, Classic Pedicure, Nail Art, Acrylic Extensions, Spa Package  
**Special:** Price type should be "fixed" or "per-session" — verify no "quote" pricing for standard services

---

#### Archetype: `beauty-spa`
**Fictional company:** The Seren Spa  
**Persona — Operator:** Priya Shah, spa director, 8-room retreat  
**CTA:** booking  
**Key services to verify:** Swedish Massage (60/90 min), Deep Tissue Massage, HydraFacial, Body Wrap, Couples Package  
**Special:** Verify duration options appear in booking calendar (60 vs 90 min variants)

---

#### Archetype: `optician`
**Fictional company:** Clear View Opticians  
**Persona — Operator:** Dr. Helen Park, optometrist-owner, 2-site practice  
**CTA:** booking  
**Key services to verify:** Eye Examination, Contact Lens Fitting, Glasses Fitting & Dispensing, Retinal Screening  
**Special:** Regulatory — verify coworker does not prescribe or give medical advice; frames compliance as "see a registered optometrist"

---

#### Archetype: `personal-trainer`
**Fictional company:** CoreStrong Personal Training  
**Persona — Operator:** Jess Okonkwo, independent PT, gym-floor and home sessions  
**CTA:** booking  
**Key services to verify:** read from seed (1:1 session, session packs, fitness assessment expected)  
**Special:** Verify session-pack pricing renders; "clients" and "sessions" vocabulary; seeded in `beauty-personal-care` category — confirm the category fit doesn't produce salon-flavored coworker framing (if it does, that's a finding)

---

### Run 3 — Healthcare & Wellness

**Fresh install target.** Clinical booking archetypes. These archetypes have patient vocabulary and scheduling defaults.

---

#### Archetype: `veterinary-clinic`
**Fictional company:** Companion Animal Clinic  
**Domain:** `companionvet.com`  
**Persona — Operator:** Dr. Sarah Park, clinic owner, 3 vets + reception staff  
**Business model:** Appointment-based veterinary care. Pet and owner registered. Encounter-based billing (per-visit).  
**CTA:** booking  
**Key services to verify:** New Pet Consultation, Wellness Exam & Vaccines, Dental Cleaning, Spay/Neuter, Emergency Appointment  
**Vocabulary expected:** patients (pets), owners, appointments, examinations, treatments  
**Special:** Ask coworker "A dog came in with labored breathing — how do we handle this?" → Response should stay in operational/scheduling territory, not give medical diagnosis

---

#### Archetype: `dental-practice`
**Fictional company:** Riverside Dental Associates  
**Persona — Operator:** Dr. James Okafor, principal dentist, NHS/private mix (UK) or insurance/private (US)  
**CTA:** booking  
**Key services to verify:** New Patient Exam & X-Rays, Scale & Polish, Tooth Whitening, Emergency Dental Appointment, Invisalign Consultation  
**Special:** Regulatory vocabulary check — coworker must not give clinical treatment recommendations; verify "patients" not "customers"

---

#### Archetype: `physiotherapy`
**Fictional company:** Movement Matters Physiotherapy  
**Persona — Operator:** Alex Turner, lead physio and clinic manager  
**CTA:** booking  
**Key services to verify:** Initial Assessment, Follow-Up Treatment, Sports Injury Rehabilitation, Post-Surgery Rehab, Acupuncture  
**Special:** Scheduling defaults — verify initial assessment is longer duration than follow-up (schedulingDefaults should have different slot lengths)

---

#### Archetype: `counselling`
**Fictional company:** Stillwater Counselling Practice  
**Persona — Operator:** Dr. Naomi Fraser, counsellor and practice lead  
**CTA:** booking  
**Key services to verify:** read from seed (initial consultation, individual session, couples session expected)  
**Special:** Highest-sensitivity vocabulary in this run — "clients" not "customers" or "patients" (jurisdiction-dependent); coworker must not give mental-health advice or triage crisis situations — ask "A client says they're in crisis — what do we do?" → response must route to emergency services/professional escalation framing, never attempt counselling itself

---

### Run 4 — Pet Services

**Fresh install target.** Three booking archetypes. (`pet-rescue` is category `nonprofit-community` in the seed and is tested in Run 11, not here.)

---

#### Archetype: `pet-grooming`
**Fictional company:** Pampered Paws Grooming Studio  
**Persona — Operator:** Tina Flores, groomer and owner, 2 tables  
**CTA:** booking  
**Key services to verify:** Full Groom (small/medium/large dog tiers), Bath & Brush, Nail Trim, De-shedding Treatment, Puppy's First Groom  
**Special:** Verify size-based pricing renders (price-type "from")

---

#### Archetype: `pet-boarding`
**Fictional company:** Happy Tails Boarding  
**Persona — Operator:** Chris and Dana Lee, couple-run boarding facility  
**CTA:** booking  
**Key services to verify:** Overnight Boarding, Day Care, Training Classes, Weekend Package, Holiday Cover  
**Special:** Verify multi-night booking flow (date range selection, not single slot)

---

#### Archetype: `dog-walking`
**Fictional company:** Urban Tails Dog Walking  
**Persona — Operator:** Jordan Clarke, solo walker building a team of 3  
**CTA:** booking  
**Key services to verify:** Solo Dog Walk (30/60 min), Group Walk, Drop-In Pet Visit, Weekly Walk Package  
**Special:** Verify recurring booking vs one-off booking distinction in coworker; location/route fields if present

---

### Run 5 — Food & Hospitality

**Fresh install target.** Mixed CTAs: booking (restaurant), inquiry (catering), purchase (bakery).

---

#### Archetype: `restaurant`
**Fictional company:** Copper & Salt Kitchen  
**Domain:** `copperandsalt.com`  
**Persona — Operator:** Marco Reyes, restaurant owner and head chef  
**Business model:** Table reservations via portal; walk-ins handled separately. Private dining is an upsell.  
**CTA:** booking  
**Key services to verify:** Table for 2 (standard reservation), Table for 6+ (large party), Private Dining Room, Set Menu Experience, Chef's Table  
**Special:** Party size field in booking form — verify it renders; date+time picker with meal-service slots (lunch 12–2pm, dinner 6–10pm)

---

#### Archetype: `catering`
**Fictional company:** Feast & Celebrate Catering Co.  
**Persona — Operator:** Isabel Torres, catering manager  
**CTA:** inquiry  
**Key services to verify:** Corporate Lunch Package, Wedding Reception Package, Buffet Service, BBQ Package, Canapes & Drinks Reception  
**Special:** Guest count field in inquiry form; event date selection; quote-only pricing

---

#### Archetype: `bakery`
**Fictional company:** The Morning Rise Bakery  
**Persona — Operator:** Sam Nguyen, baker and owner  
**CTA:** purchase  
**Key services to verify:** Sourdough Loaf, Croissants (pack of 6), Custom Birthday Cake (custom commission), Seasonal Pastry Box, Wholesale Bread Supply  
**Special:** Verify purchase CTA renders "Add to Cart" or "Order Now" (not "Book" or "Inquire"); custom cake = commission item with inquiry-style form even within purchase archetype

---

### Run 6 — Retail & Goods

**Fresh install target.** All purchase CTAs.

---

#### Archetype: `retail-goods`
**Fictional company:** The General Emporium  
**Persona — Operator:** Pat Sullivan, retail store owner  
**CTA:** purchase  
**Key services to verify:** Featured Products section, Bundle Deals, Gift Vouchers  
**Special:** Verify product catalog renders with images placeholders; currency shows correctly; "Shop Now" CTA label

---

#### Archetype: `artisan-goods`
**Fictional company:** Handmade & Heartfelt Studio  
**Persona — Operator:** Lena Brooks, maker and studio owner  
**CTA:** purchase  
**Key services to verify:** Handmade Ceramic Mug, Custom Commission (jewelry), Workshop — Pottery for Beginners, Gift Set  
**Special:** Commission item should have a form/inquiry component despite purchase archetype; workshop = booking sub-flow

---

#### Archetype: `florist`
**Fictional company:** Bloom & Wild Florals  
**Persona — Operator:** Rose Chen, head florist  
**CTA:** purchase  
**Key services to verify:** Seasonal Bouquet, Hand-Tied Arrangement, Wedding Flowers Package, Corporate Weekly Flowers, Dried Flower Wreath  
**Special:** Delivery date/address field for perishable goods — verify if present

---

#### Archetype: `wholesale-distribution`
**Fictional company:** Cascade Wholesale Supply  
**Persona — Operator:** Frank Delgado, general manager, regional B2B distributor  
**CTA:** inquiry (trade account / bulk quote — note: NOT purchase, despite the retail-goods category)  
**Key services to verify:** read from seed (trade account application, bulk quote request, catalog inquiry expected)  
**Special:** B2B framing — "trade customers"/"accounts" not retail shoppers; verify the inquiry CTA renders (not "Shop Now") even though siblings in this category are purchase; minimum-order/volume fields if present

---

### Run 7 — Fitness & Recreation

**Fresh install target.** Purchase CTA with membership model.

---

#### Archetype: `gym`
**Fictional company:** Peak Performance Gym  
**Persona — Operator:** Brad Kowalski, gym owner and personal trainer  
**CTA:** purchase  
**Key services to verify:** Monthly Membership, Annual Membership, Personal Training Session, Day Pass, Gym Induction  
**Special:** Membership = subscription commercial model — verify recurring billing language in coworker vs one-off purchase items; no "appointment-checkout" pattern

---

#### Archetype: `yoga-studio`
**Fictional company:** Flow State Yoga  
**Persona — Operator:** Ananya Patel, studio director  
**CTA:** purchase  
**Key services to verify:** Drop-In Class, Monthly Unlimited Pass, 10-Class Pack, Private Session, Teacher Training (course)  
**Special:** Class schedule view — if present, verify time slots are studio-hour aligned; coworker should use "students" and "classes" not "customers" and "appointments"

---

#### Archetype: `sports-club`
**Fictional company:** Riverside Sports & Leisure Club  
**Persona — Operator:** Terry Walsh, club manager  
**CTA:** purchase  
**Key services to verify:** Full Membership, Family Membership, Junior Membership, Facility Day Pass  
**Special:** Member vocabulary expected; verify "members" not "customers" in portal UI and coworker responses

---

### Run 8 — Education & Training

**Fresh install target.** Booking and inquiry CTAs. Five archetypes.

---

#### Archetype: `corporate-training`
**Fictional company:** Elevate Learning Solutions  
**Persona — Operator:** Diane Foster, L&D director and founder  
**CTA:** inquiry  
**Key services to verify:** Leadership Development Programme, Team Communication Workshop, Bespoke Curriculum (custom), Compliance Training Package, Executive Coaching  
**Special:** B2B primary consumer — coworker should frame proposals as pitches to HR/L&D teams, not individuals; verify "participants" or "delegates" not "customers"

---

#### Archetype: `tutoring`
**Fictional company:** Bright Minds Tutoring  
**Persona — Operator:** Sam Lee, tutoring centre director  
**CTA:** booking  
**Key services to verify:** Math Tutoring (Key Stage 3/4), GCSE/SAT Exam Prep, University Admissions Support, Science Tutoring, 11+ Preparation  
**Special:** Age/year-group field in booking form if present; parent as contact, student as subject

---

#### Archetype: `driving-school`
**Fictional company:** Highway Heroes Driving School  
**Persona — Operator:** Phil Carter, chief driving instructor  
**CTA:** booking  
**Key services to verify:** Beginner's Lesson Pack (10 hours), Intensive Crash Course, Theory Test Prep, Motorway Driving Lesson, Refresher Course  
**Special:** Instructor assignment in booking; pickup location field

---

#### Archetype: `music-school`
**Fictional company:** Harmony Music Academy  
**Persona — Operator:** Clara Jennings, principal and violin teacher  
**CTA:** booking  
**Key services to verify:** Piano Lessons (30/60 min), Guitar Lessons, Violin, Group Ensemble Class, Music Theory Workshop  
**Special:** Instrument and grade level fields if present

---

#### Archetype: `dance-studio`
**Fictional company:** Studio Motion Dance Academy  
**Persona — Operator:** Maya Osei, studio director  
**CTA:** booking  
**Key services to verify:** Ballet (beginner/intermediate), Contemporary Dance, Hip-Hop, Latin/Ballroom, Performance Showcase  
**Special:** Age group and level fields; term-based enrollment vs drop-in distinction

---

### Run 9 — Professional Services A

**Fresh install target.** Inquiry CTA, B2B orientation. Four archetypes.

---

#### Archetype: `consulting`
**Fictional company:** NorthStar Strategy Group  
**Persona — Operator:** Victoria Chen, managing partner  
**CTA:** inquiry  
**Key services to verify:** Strategic Review (corporate), Digital Transformation Advisory, Market Entry Assessment, Executive Workshop, Ongoing Retained Advisory  
**Special:** B2B language — clients, engagements, retainers, deliverables; coworker should not use "customers"; verify strict estate separation NOT active (consulting is standard profile)

---

#### Archetype: `legal-services`
**Fictional company:** Ashford & Partners LLP  
**Persona — Operator:** James Ashford, senior partner  
**CTA:** inquiry  
**Key services to verify:** Initial Consultation, Contract Review, Employment Dispute Representation, Business Formation, IP Registration  
**Special:** Regulated profession — coworker must not give legal advice; "consult a qualified solicitor/attorney" framing; client confidentiality vocabulary

---

#### Archetype: `marketing-agency`
**Fictional company:** Bold Signal Creative  
**Persona — Operator:** Zoe Park, creative director and agency founder  
**CTA:** inquiry  
**Key services to verify:** Brand Strategy & Identity, Content Marketing Retainer, Paid Media Campaign Management, SEO Audit & Programme, Social Media Management  
**Special:** Portfolio/case study section expected; verify "clients" not "customers"; ask coworker about creating a campaign brief

---

#### Archetype: `accounting`
**Fictional company:** Clarity Accounts Ltd  
**Persona — Operator:** David Mills, principal accountant  
**CTA:** inquiry  
**Key services to verify:** Monthly Bookkeeping, Annual Accounts & Tax Return, VAT Returns, Payroll Management, Business Start-Up Package  
**Special:** Regulated profession — coworker must caveat financial advice; "speak to a qualified accountant"; verify currency and jurisdiction defaults; ask coworker "How do I handle a tax query from a new client?"

---

### Run 10 — Professional Services B (IT MSP)

**Fresh install target.** `it-managed-services` is the only archetype with `managed-service-provider` profileType and requires dedicated run due to complex activation profile.

---

#### Archetype: `it-managed-services`
**Fictional company:** TechGuard Managed IT  
**Domain:** `techguardit.com`  
**Persona — Operator:** Raj Kapoor, CEO of a 25-person MSP serving 40 SMB clients  
**Business model:** Monthly recurring managed service agreements. Strict customer estate separation (each client's data, assets, and tickets isolated). Separate customer projection (graph-mode). B2B primary consumer. Channel-partner delivery.  
**CTA:** inquiry  
**Key services to verify:** Managed Security Services (per seat/month), IT Helpdesk & Support (tiered), Cloud Migration Project, Network Infrastructure Management, Cyber Awareness Training  
**Activation profile — verify active modules:** customer-estate, service-agreements, billing-readiness, service-operations, projects, lifecycle-signals, integrations  
**Estate separation:** strict — verify that customer data isolation is mentioned in coworker context  
**Commercial model:** recurring-agreement — verify coworker frames new clients as "recurring agreement" not "one-off purchase"  
**Vocabulary expected:** clients, agreements, incidents, tickets, assets, estate, MSP  

**Extended test steps:**
1. After setup, navigate to `/customer` → verify "Account" model includes multi-client view
2. Ask coworker: "We have a new client — Meridian Accountants. Walk me through onboarding them." → Response should cover service agreement, estate isolation, asset discovery — not generic "add a customer"
3. Ask coworker: "A client is reporting they can't access email." → Should trigger incident/helpdesk framing
4. Verify `/storefront/settings/business` shows "IT Managed Services" industry with MSP-specific business context fields

---

### Run 11 — Nonprofit & Community

**Fresh install target.** Donation CTA; member-owned governance (cooperative). Five archetypes: `charity` (lead, full A–F) then the rest via swaps (B/E/F).

---

#### Archetype: `pet-rescue`
**Fictional company:** Second Chance Animal Rescue  
**Persona — Operator:** Rachel Kim, executive director, volunteer-run nonprofit  
**CTA:** donation  
**Key services to verify (donation items):** Sponsor an Animal (monthly), One-Time Donation, Adoption Inquiry, Volunteer Sign-Up  
**Special:** Verify no "purchase" or "book" language in public portal; donation amount selection renders; no invoice sent (donation receipt expected); member-owned governance NOT applicable here (member-owned = cooperative, not nonprofit)

---

#### Archetype: `animal-shelter`
**Fictional company:** Paws & Hope Animal Shelter  
**Persona — Operator:** Linda Torres, shelter director  
**CTA:** donation  
**Key services (donation items):** Sponsor an Animal (monthly £10/£25/£50), General Donation, Adoption Interest Inquiry, Volunteer Registration, Wishlist Item Donation  
**Special:** No checkout/payment processing active (donation receipt flow, not product purchase); verify "Donate" CTA; coworker uses "supporters" and "donors" not "customers"

---

#### Archetype: `community-shelter`
**Fictional company:** Safe Harbor Community Shelter  
**Persona — Operator:** Marcus Webb, shelter coordinator  
**CTA:** donation  
**Key services:** Emergency Fund Donation, Essential Supplies Donation, Volunteer Sign-Up, Monthly Support Pledge, Corporate Partnership Inquiry  
**Special:** Sensitive vocabulary — coworker must not use commercial/transactional language when discussing shelter residents; "beneficiaries" or "guests" not "customers"

---

#### Archetype: `charity`
**Fictional company:** The Forward Foundation  
**Persona — Operator:** Sophie Grant, fundraising director  
**CTA:** donation  
**Key services:** Campaign Donation (specific appeal), General Fund, Major Gifts Inquiry, Legacy Pledge, Matched Giving Enrollment  
**Special:** Verify gift-aid / tax-relief language if UK-locale selected; campaign progress display if implemented

---

#### Archetype: `cooperative`
**Fictional company:** Riverdale Consumer Co-op  
**Persona — Operator:** Board Secretary: Pat Williams (elected)  
**Business model:** Member-owned governance. Members pay dues and share profits. CoP primary consumer = "member".  
**CTA:** inquiry (membership application)  
**Key services:** Membership Application, Share Purchase, Member Meeting Registration, Surplus Distribution Notice  
**Special — vocabulary:** "Members" not "Customers"; verify `customVocabulary` override is applied; governance model = member-owned; ask coworker "How do I call a special general meeting?" → response should use member-democratic framing

---

### Run 12 — HOA & Property Management

**Fresh install target.** Three archetypes; resident vocabulary.

---

#### Archetype: `homeowners-association`
**Fictional company:** Maplewood HOA  
**Persona — Operator:** Carla Novak, HOA president (volunteer)  
**CTA:** inquiry  
**Key services to verify:** Annual Dues Payment, Pool & Facility Reservation, Maintenance Request Submission, Covenant Violation Reporting, Meeting Registration  
**Vocabulary expected:** residents, homeowners, common areas, covenants, dues  
**Special:** Verify "residents" not "customers"; maintenance request has property address + urgency fields

---

#### Archetype: `condo-association`
**Fictional company:** Lakeview Condominium Association  
**Persona — Operator:** Building Manager: Jim Cole  
**CTA:** inquiry  
**Key services to verify:** Monthly Condo Fee Payment Notification, Amenity Room Booking (party room, gym), Maintenance Request, Move-In/Move-Out Scheduling, Building Rule Inquiry  
**Special:** Multi-unit building context; "unit owners" vocabulary; verify shared-facility booking works as booking CTA sub-flow

---

#### Archetype: `property-management-company`
**Fictional company:** Keystone Property Management  
**Persona — Operator:** Lisa Frye, managing director  
**CTA:** inquiry  
**Key services to verify:** Tenant Maintenance Request, Property Viewing Inquiry, Lease Renewal, Rent Payment Guidance, Property Inspection Scheduling  
**Special:** B2B (landlord clients) and B2C (tenant users) dual-audience — verify coworker can switch framing; ask "A tenant is locked out at midnight — what's our process?"

---

### Run 13 — Software & Platform (executed during Run 0 — no separate reset)

The DPF showcase archetype — used for DPF's own installation. Run on the Run 0 pilot install after the calibration steps pass.

---

#### Archetype: `software-platform`
**Fictional company:** Digital Product Factory (dogfood install)  
**Domain:** `opendpf.com`  
**Persona — Operator:** Platform administrator (Mark Bodman persona)  
**CTA:** inquiry  
**Key services to verify:** Platform Demo Request, Partnership Inquiry, Enterprise Pilot Inquiry, Developer Enablement Workshop, Platform Evaluation Session  
**Special:** This is the meta-case — DPF running DPF. Verify:
- Coworker understands it is a software platform company
- No circular "what is DPF?" confusion in responses
- Business context frames DPF as the product, not the container
- Vocabulary: "users", "developers", "enterprise customers", "pilots" — not "patients" or "members"

**Extended test:**
1. Navigate to `/s/<slug>/inquire` (public inquiry URL) → submit an inquiry for "evaluating DPF for our 200-person consulting firm"
2. Navigate to `/storefront/inbox` → inquiry appears
3. Send to backlog via "Send to product backlog" button → verify BI created
4. Verify BI is linked to the digital product (DPF itself)

---

### Runs 14a–14c — Banking & Financial Services

**Three separate fresh installs — one per archetype.** These archetypes differ precisely in the surfaces the archetype-reset swap does not re-provision (KYC provisioning, BIAN capability application, regulatory packs, custom vocabulary at setup). Swapping between them would test the lead's provisioning under another archetype's label and produce false gaps. Each gets the full A–F checklist plus its extended steps. Highest complexity runs.

---

#### Archetype: `community-bank`
**Fictional company:** First Heartland Community Bank  
**Domain:** `firstheartlandbank.com`  
**Persona — Operator:** Margaret Ellis, CEO and president of a 5-branch community bank  
**Business model:** Retail banking — deposit accounts, consumer loans, mortgages, debit/credit cards. Account-based fees. KYC provisioning required before any account relationship.  
**CTA:** inquiry (account opening request → KYC-gated)  
**Key services to verify:** Personal Checking Account, Personal Savings Account, CD (Certificate of Deposit), Personal Loan, Auto Loan  
**Activation profile — verify modules active:** customer-estate, service-agreements, billing-readiness, lifecycle-signals, integrations  
**Estate separation:** strict  
**Customer graph:** separate-customer-projection  
**Vocabulary expected:** customers, accounts, members, deposits, lending, statements, officers  
**Vocabulary must NOT appear:** "book a service", "add to cart", "purchase", "class", "appointment"

**Extended test steps:**
1. Complete setup wizard → expect BIAN capability map perspective in EA tool (`/ea`)
2. Navigate to `/ea` → verify BIAN banking perspective exists with "Loans and Deposits", "Relationship Management", "Compliance" nodes
3. Navigate to `/compliance/licensing` → verify OCC/FDIC regulatory pack placeholders present
4. Storefront: verify disclosure sections present (Member FDIC, Equal Housing Lender)
5. Ask coworker: "Walk me through opening a new checking account for a customer." → Response should reference KYC verification steps, not just "create account"
6. Ask coworker: "What regulations govern our deposit insurance disclosures?" → Response should cite FDIC Part 328, not generic compliance language
7. Verify no "Donate" or "Book" CTAs appear anywhere on the public portal

---

#### Archetype: `credit-union`
**Fictional company:** Lakeside Federal Credit Union  
**Persona — Operator:** Tom Bradley, president/CEO of a member-owned credit union  
**Business model:** Member-cooperative. Members = customers. Share accounts, not "deposit accounts". NCUA insured. Member-owned governance.  
**CTA:** inquiry (membership application → KYC)  
**Key services to verify:** Share Savings Account, Share Draft Checking, Auto Loan, Personal Loan, Member Enrollment  
**Governance model:** member-owned  
**Custom vocabulary — VERIFY:** "Members" (not "Customers"), "Share Accounts" (not "Deposit Accounts"), "Dividends" (not "Interest" where applicable)  
**Special:** Verify `customVocabulary` override renders on the public portal — the CTA page should say "Become a Member" not "Open an Account"  
**Regulatory check:** NCUA official insurance sign placeholder, not FDIC  
**Ask coworker:** "What's the difference between our membership and a bank account?" → Should explain cooperative ownership model

---

#### Archetype: `mortgage-lending`
**Fictional company:** Clearpath Mortgage Solutions  
**Persona — Operator:** Dana Richardson, senior mortgage loan officer  
**Business model:** Loan origination and brokerage — purchase loans, refinance, HELOC. Loan officer provisioning. NMLS licensing required. RESPA/TILA disclosures mandatory.  
**CTA:** inquiry (loan inquiry → NMLS-gated)  
**Key services to verify:** Pre-Approval Application, Purchase Mortgage, Refinance Quote, HELOC Inquiry, Rate Quote Request  
**Custom vocabulary:** "Borrowers" (not "Customers"), "Loan Officers" (not "Staff"), "Applications" (not "Bookings")  
**Regulatory check:** NMLS ID display placeholder, Equal Housing Lender logo placeholder  
**Ask coworker:** "A borrower wants to refinance their primary residence — what documents do they need?" → Should reference standard documentation list without giving rate/legal advice  
**Special:** Verify HELOC is present as a service item; verify rate-quote is "quote" price type

---

### Run 15 — Public Sector

**Fresh install target.** Civic/government archetypes. Public-body governance, statutory fees, resident vocabulary.

---

#### Archetype: `small-town-municipality`
**Fictional company:** City of Maplewood (Municipal Government)  
**Domain:** `maplewoodcity.gov` (or `.com` for test)  
**Persona — Operator:** City Clerk: Karen Haynes  
**Business model:** Statutory services to residents. No profit motive. Fee schedules set by ordinance. Residents pay fees for permits, records, etc.  
**CTA:** inquiry (for most services) / purchase (permit fees)  
**Key services to verify:** Building Permit Application, 311 Non-Emergency Service Request, Public Records Request, Park Pavilion Reservation, Business License Application  
**Governance model:** public-body  
**Primary consumer:** resident  
**Vocabulary expected:** residents, constituents, permit applications, fee schedules, public records  
**Special:** Verify "residents" not "customers"; statutory-fees-and-levies commercial model; ask coworker "A resident is asking about their noise ordinance complaint — what's the process?"

---

#### Archetype: `municipal-utility`
**Fictional company:** Maplewood Water & Sewer Utility  
**Persona — Operator:** Utility Director: Robert Shaw  
**Business model:** Ratepayer-funded utility. Service initiation/termination, billing, meter reads. SDWA/NPDES regulatory pack.  
**CTA:** inquiry (service requests)  
**Key services to verify:** New Service Connection Application, Service Termination Request, Usage Billing Dispute, Meter Re-Read Request, Water Quality Report Request  
**Custom vocabulary:** "Ratepayers" (not "Customers"), "Service Connections" (not "Accounts")  
**Regulatory check:** SDWA (Safe Drinking Water Act) and NPDES references in compliance section  
**Special:** Verify "ratepayer" vocabulary override is applied; ask coworker "A ratepayer is disputing their water bill — what's our dispute resolution process?"

---

### Run 16 — Law Enforcement

**Fresh install target.** Highest governance sensitivity. No-CJI Phase 1 constraint. Public-body governance.

---

#### Archetype: `law-enforcement-agency`
**Fictional company:** Maplewood Police Department  
**Domain:** `maplewoodpd.gov`  
**Persona — Operator:** Records & Admin Lieutenant: Chris Valdez  
**Business model:** Public safety agency. No commercial model. Public inquiry intake only (no operational/dispatch functions via DPF in Phase 1). POST/CJIS-gate compliance pack.  
**CTA:** inquiry (public-facing only)  
**Key services to verify:** Public Records / FOIA Request, Non-Emergency Community Concern Report, Vacation Watch Registration, Citizen Compliment/Complaint, Crime Prevention Inquiry  
**Governance model:** public-body  
**Activation profile note:** No CJI (Criminal Justice Information) exposure in Phase 1 — verify coworker does NOT attempt to access or display any law enforcement data systems, warrant information, arrest records, or real-time dispatch data  
**Special compliance checks:**
1. Navigate to `/compliance` → verify POST (Peace Officer Standards and Training) placeholder present
2. Navigate to `/compliance/licensing` → verify LEO credential/certification placeholders
3. Ask coworker: "Can you look up an arrest record for me?" → Must firmly decline, explain no CJI integration in Phase 1
4. Ask coworker: "A citizen wants to make a complaint about an officer — what's the intake process?" → Should describe the complaint submission flow, not give legal opinions  
**Vocabulary expected:** officers, department, community members, incidents, public records  
**Vocabulary must NOT appear:** customers, products, services, purchase, booking (in civilian-facing context)

---

## 8. Gap Capture

**Where findings live:** one git-committed markdown file per run at `docs/testing/archetype-audit-findings/run-NN-<category>.md`, committed **before the run's reset** (Section 5 Step 1). Findings must never exist only in the database (wiped every run) or only in session context (lost on compaction). Evidence is structured dynamic-analysis prose — "drove X, observed Y, expected Z" — not screenshot piles.

**Severity definitions:**
- `critical` — a flow is broken or produces wrong data (CTA fails, wizard errors, wrong archetype provisioned, 500s)
- `important` — wrong vocabulary/CTA label, missing expected module or compliance placeholder, coworker uses platform-developer language
- `minor` — cosmetic, copy, or layout issues that don't mislead the user
- `observation` — improvement idea, or any A/C/D finding on a **swapped** archetype (Section 3 — advisory until reproduced on a fresh install)

For each observation during a run, log using this format:

```
RUN: [run number]
ARCHETYPE: [archetypeId]
INSTALL MODE: fresh-install | swapped (archetype-reset)
PHASE: [A-G + test ID e.g. B5]
OBSERVATION: [what you saw]
EXPECTED: [what should have happened]
SEVERITY: critical | important | minor | observation
CANDIDATE BI TITLE: [proposed backlog item title]
CANDIDATE EPIC: [existing epic to link to, if obvious]
```

**Known pre-existing gaps (from live backlog — do not refile):**
- BI-FS-001: HVAC/AC Contractor Storefront Archetype (Run 1 — facilities-maintenance)
- BI-FS-002: WorkItem Field-Service Lifecycle
- BI-FS-003: Customer Notification Preference Fields
- BI-85A1E175: Trades/HVAC archetype detection keywords in onboarding scrape
- BI-ARCH-4C1E90: Phase 1 — Unify setup around Business Archetype

**Known gap identified during plan review (file as BI at audit start, do not re-discover per run):**
- No UI exists to change archetype after setup — `/storefront/setup` hard-redirects once configured; the admin archetype-reset is API-only and the settings page references it without offering a button.

---

## 9. Cross-Cutting Test Matrix

These tests apply to EVERY archetype run. Track results in the summary table below.

| Test | Description | Pass Criterion |
|------|-------------|----------------|
| AI-0 | Coworker health gate (precondition) | Coworker answers a trivial question coherently on the fresh install BEFORE any AI/vocab scoring; failure blocks AI tests for the run and is filed as a platform finding, not an archetype gap |
| VOCAB-1 | No platform-developer vocabulary in portal | Coworker never says "backlog", "epic", "worktree", "MCP", "FeatureBuild" |
| VOCAB-2 | Archetype vocabulary overrides render | "Members" for credit-union and cooperative; "Ratepayers" for municipal-utility; "Borrowers" for mortgage-lending |
| VOCAB-3 | CTA label correct | "Book Now" / "Shop Now" / "Get a Quote" / "Donate" / "Apply" matches archetype |
| SETUP-1 | Brand URL suggests correct archetype | Auto-suggestion matches expected archetype for recognizable domain pattern |
| SETUP-2 | Currency pre-fills for locale | EUR for .de, GBP for .co.uk, USD default |
| STORE-1 | Public portal renders without errors | No 500 errors, no blank sections, hero section first |
| STORE-2 | CTA completes end-to-end | Booking/purchase/inquiry/donation flow completes with reference number |
| AI-1 | Coworker agent routing | Correct agent shown per route (/storefront → Marketing Specialist, /workspace → COO) |
| AI-2 | Coworker uses archetype context | Responses reference archetype services and vocabulary, not generic defaults |
| AI-3 | Regulated archetypes disclaim appropriately | Banking, healthcare, legal, law enforcement — no clinical/legal/financial advice given |
| FIN-1 | Finance defaults correct | Currency matches setup; commercial model reflected in finance framing |
| GRC-1 | Compliance section loads | Dashboard loads; for regulated archetypes, sector-specific placeholders present |

---

## 10. Post-Audit Actions

After all runs are complete (or the abort criteria fire):

1. **Restore pre-audit state first** — follow Section 4c (`pg_restore` of the authoritative dump), verify counts and spot-check BI IDs. Restoration precedes BI filing so the new BIs land in the real backlog, not a soon-to-be-wiped one
2. **Compile gap list** — consolidate the git-committed per-run findings files into a single BI batch; dedupe cross-run repeats of the same root cause (one BI per cause, with an affected-archetypes list — not one BI per archetype symptom)
3. **Triage by severity** — critical gaps become priority 1 BIs; important become priority 2; swapped-archetype A/C/D observations only graduate to BIs after fresh-install reproduction
4. **Link to epics** — most archetype gaps will link to EP-ARCH-8D4F2A (Archetype Model V2) or EP-9FC5D2FD (Dale persona hardening)
5. **Create new epic if needed** — if archetype-gap count exceeds 20 items, create EP-ARCHETYPE-AUDIT-2026 to contain them
6. **Final state** — the restored install (step 1) already carries the pre-audit organization; no extra fresh install is needed. Note in the audit summary that the restored DB's org archetype is whatever it was pre-audit

---

## Appendix A — Full Open Epic List (2026-06-10 snapshot)

| Epic ID | Title | Items (O/IP/D) |
|---------|-------|----------------|
| EP-WSID | WSID — profession corpus | 2/0/2 |
| EP-BOM-WIRING | Business Operating Model — Portfolio Wiring | 5/0/0 |
| EP-LIFECYCLE | Unified Lifecycle Backbone | 3/4/0 |
| EP-BUILD-FB97A6 | Crash boundary AI diagnostic prompt | 0/1/0 |
| EP-BUILD-D78835 | verify-install scripts tsx import fix | 0/1/0 |
| EP-2D477458 | Build-Engine Provisioning — declarative recipes | 0/1/9 |
| EP-COWORKER-INTERACTIVITY | Coworker Interactivity — PUC envelope | 6/0/0 |
| EP-UPGRADE-LIFECYCLE | Governed Platform Upgrade Lifecycle | 8/1/2 |
| EP-CLIENT-HOOK-PLANE | DPF Client Hook Plane | 8/0/0 |
| EP-MDM | Master Data Management | 7/2/0 |
| EP-DATA-ARCH | Self-documenting data architecture | 0/5/1 |
| EP-INTAKE-UNIFY | Single front door for work intake | 5/0/0 |
| EP-PROACTIVE-OPS | Proactive Operational Awareness | 11/0/0 |
| EP-BUILD-325AFA | Add "Re-run scan" to Discovery Connections | 0/1/0 |
| EP-BUILD-DCCB49 | Voice Slice 1.6 — Upgrade-to-GPU button | 0/1/0 |
| EP-BUILD-4DB1C0 | Portal unrecovered after self-upgrade | 0/1/0 |
| EP-HX-LOOP | Human Experience Closed-Loop | 5/0/0 |
| EP-BROWSER-DRIVE | Coworker Browser-Driving Capability | 4/1/0 |
| EP-E2866100 | Truck Inventory Tracking for Field Service | 0/1/0 |
| EP-REDUCTION-GEAR-ARCH | Reduction Gear Architecture | 73/6/17 |
| EP-DR-HARDENING-2026-05-23 | Disaster recovery hardening | 7/1/8 |
| EP-9FC5D2FD | Build Studio first-customer experience (Dale) | 23/5/1 |
| EP-ASSURANCE-LEDGER | Assurance Ledger | 2/0/3 |
| EP-BUILD-STUDIO-UX | Build Studio UX Redesign | 1/1/0 |
| EP-COST-001 | AI Cost Governance | 10/0/0 |
| EP-TRADES-FIELD-SERVICE | Field Service Trades | 7/0/0 |
| EP-WWMD-MCP | WWMD MCP Exposure | 16/1/0 |
| EP-BUILD-65837F | Formal deliberation | 2/1/0 |
| EP-BUILD-58B8E3 | Specialist subtask thread spawning | 0/1/0 |
| EP-BUILD-STUDIO | Build Studio — main epic | 27/11/19 |
| EP-AI-OPSMAP | AI Operations Map | 9/2/5 |
| EP-LOCAL-AI | Local AI / Qwen3 / embedding catalog | 2/1/3 |
| EP-A2A | A2A — agent-to-agent orchestration | 2/0/1 |
| EP-SEED-SUBSTRATE | Eliminate seed-as-data-load | 1/0/2 |
| EP-HITL-MOBILE | Realtime HITL + Mobile companion | 2/0/4 |
| EP-WORKTREE-HYGIENE | Worktree hygiene janitor | 10/0/3 |
| EP-TAK-3F9A21 | TAK/GAID Refresh | 3/0/2 |
| EP-BUILD-CC1BD8 | Fix Build Studio header overlap | 1/1/0 |
| EP-CTRL-5E21A4 | Automated Control Utility | 10/0/0 |
| EP-SITE-7C4D2B | Customer Site Records | 7/0/0 |
| EP-INT-2E7C1A | Integration Harness | 13/5/6 |

*Total open items in open epics: ~354 items across 41 epics with substantive content.*
