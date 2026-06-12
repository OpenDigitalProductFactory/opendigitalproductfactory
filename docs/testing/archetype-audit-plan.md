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

## 2a. Common vs. Archetype-Specific Test Coverage

Not everything needs to be tested 18 times. The audit evaluates two distinct dimensions:

### Common platform mechanics — test once, deeply, in Run 0

These are shared UI surfaces that behave the same regardless of archetype. Run 0 is the only run that **evaluates** them (pass/fail, finds bugs). Runs 1–16 **use** them as setup tools without re-evaluating the mechanics.

Checklist items tagged `[C]` below fall in this category. In Runs 1–16, execute the step, but do not log a finding if the mechanics work correctly — you have already proved they do. Only log if the step **fails** in a run where it worked in Run 0 (that would indicate a regression, not an archetype gap).

| Surface | What Run 0 proves |
|---------|------------------|
| Brand URL scrape engine | Returns meaningful suggestions; handles `.co`, `.co.uk`, `.com` variants |
| Setup wizard step mechanics | Each step saves, next/back navigation works, financial step pre-fills correctly |
| Archetype grid | All 53 archetypes visible; grid navigable; card renders name + category + CTA type |
| `/storefront/team` CRUD | Add/edit/delete provider; availability day-of-week grid saves and syncs |
| `/storefront/settings/operations` | Operating hours editor: all 7 days toggleable, open/close time pickers, timezone selector, save triggers ProviderAvailability sync |
| `/storefront/items` CRUD | Add/edit/delete/reorder items; priceAmount field accepts decimal; ctaType selector works |
| Cart + checkout flow mechanics | Add item → cart badge increments → checkout form: name, email, phone, address; submit issues reference number |
| `/customer` CRUD | Create account → add contact → add ConfigurationItem (ciType, name, description); all three forms save and link |
| `/finance/suppliers` | Add supplier: name, contact saves correctly |
| `/finance/bills/new` | Add supplier, add line items (description, qty, unit price), totals calculate, save to draft |
| `/finance/invoices/new` | Link customer account, add line items, totals calculate, save to draft |
| `/finance/reports/profit-loss` | Report loads; bill expenses appear; invoice revenue appears; net is calculated |
| `/storefront/inbox` mechanics | Submitted CTAs appear; can open, assign to staff member, send to backlog |
| Form validation (all surfaces) | Required fields reject empty submission; invalid email rejected; no 500 on malformed input |
| Navigation structure | All primary shell routes load without 500; 404 path returns graceful error page |
| Responsive baseline | Public portal at 390px: hero, CTA form usable; no horizontal overflow |

### Archetype-specific dimensions — evaluated on every archetype

These are the reasons we run 53 evaluations. If they are wrong they indicate an archetype gap, not a platform mechanics bug.

| Dimension | What changes per archetype |
|-----------|---------------------------|
| CTA type and label | "Book Now" / "Shop Now" / "Get a Quote" / "Donate" / "Apply" |
| Public portal vocabulary | Service names, persona terms (clients/patients/members/residents), section headings |
| Domain-specific form fields | Pet info for vet; party size for restaurant; urgency + property type for trades; guest count for catering |
| Coworker framing | Agent identity, archetype services in responses, vocabulary never crosses into platform-dev terms |
| Activation modules | Which modules are active for this archetype's activation profile |
| Compliance section content | Regulatory placeholders present for licensed/regulated archetypes |
| Finance framing | Commercial model language (subscription vs. appointment-checkout vs. account-based) |
| Custom vocabulary overrides | Members / Ratepayers / Borrowers / Residents / Patients rendered on portal |
| Setup wizard suggestion accuracy | Brand URL scrape suggests the correct archetype |

### Operator persona accessibility — a UX fit dimension, not a pass/fail gate

The auditor is technical. The operator personas (Sandra Hooper the plumber, Chloe Martinez the salon owner, Sam Nguyen the baker) are not. During Phase P and Phase B steps, make a note whenever a step requires knowledge that a non-technical business owner would not have, or when the navigation is non-obvious. Log these as **`minor` findings** (they are UX improvement opportunities, not functional failures). Examples of what to watch for:

- Phase P staff setup: is it obvious to a salon owner that "Configuration Items" is where they add a pet record?
- Phase P item pricing: is it clear where the price field is and what currency it expects?
- Phase B5 booking calendar: would a first-time user understand how to navigate the slot picker?
- Phase G invoice creation: does a non-accountant know the difference between a bill and an invoice?

Any step where the auditor had to think "a real operator would struggle here" → log a minor UX finding with the specific friction point. These become EP-9FC5D2FD (Dale persona hardening) candidates.

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

### 3b. Representative Quality Bar (12 archetypes — must all Pass before audit is considered representative)

A related acceptance test plan (`docs/superpowers/plans/2026-06-06-archetype-acceptance-test-plan.md` in the nifty-chatterjee-211928 worktree) identifies a representative 12-archetype batch that covers every operating model type. These 12 are the **minimum viable quality bar** — if any of them `Fail` (Section 8 verdict system), the platform is not ready for broader rollout regardless of the remaining 41 archetypes.

Treat these as priority-1 within their runs. If time or resets run short, these 12 are non-negotiable:

| Archetype | Run | Why priority-1 |
|-----------|-----|----------------|
| `software-platform` | 0/13 | Platform/operator baseline; meta-case |
| `it-managed-services` | 10 | Richest activation profile; all modules active |
| `hair-salon` or `beauty-spa` | 2 | Appointment-checkout; most common booking model |
| `wholesale-distribution` | 6 | B2B goods; exposed roster drift |
| `plumber` or `electrician` | 1 | Field-service; dispatch-style inquiry CTA |
| `restaurant` | 5 | Party-size form field; food/hospitality vocabulary |
| `dental-practice` | 3 | Healthcare compliance posture; patient vocabulary |
| `property-management-company` | 12 | Dual-audience (landlord + tenant) |
| `charity` or `animal-shelter` | 11 | Donation CTA; no-purchase receipt verification |
| `tutoring` | 8 | Booking with student/parent dependent fields |
| `gym` or `yoga-studio` | 7 | Subscription membership purchase |
| `pet-grooming` or `pet-boarding` | 4 | Pet CI creation; size-based pricing |

---

### 3a. Run 0 — Pilot / calibration + Platform Core Mechanics (MANDATORY before Run 1)

Run 0 serves two goals: (a) validate the audit harness so the remaining 18 resets test the platform rather than the plan's assumptions; (b) prove all common platform mechanics (Section 2a) once so Runs 1–16 can treat them as reliable setup tools rather than evaluation subjects. Every item in the Section 2a common-mechanics table must be exercised and confirmed in Run 0.

**Harness validation steps:**

1. **Backup rehearsal** — take the pre-audit `pg_dump` (Section 4), restore it into a throwaway postgres container, and verify row counts match. Do not proceed to any wipe until the restore is proven.
2. **Inventory confirmation** — on the live install, confirm the archetype grid shows all 53 seeded archetypes; reconcile against the seed list in this doc's header. File a BI for any mismatch.
3. **Provider bootstrap check** — verify Anthropic is auto-configured from the environment on a fresh install. If providers need manual re-entry, document the exact re-setup steps and time; add that time to every run's budget.
4. **Coworker health gate** — ask the COO a trivial question and confirm a sane response before any vocabulary scoring. Routing failures get misattributed as archetype gaps in every run if this gate is skipped.
5. **Archetype-reset swap verification** — swap software-platform → consulting via the admin API, confirm sections/items/vocabulary/CTA actually change on the public portal, then swap back. Empirically validates the Tier-B/E/F strategy for all multi-archetype runs.
6. **Reference-number check** — drive one inquiry end-to-end and confirm a reference number is actually issued; correct B5's pass criterion if the real confirmation UX differs.
7. **Timing calibration** — record wall-clock time for the full reset + setup + A–F pass plus all Platform Core Mechanics steps below. Use to project the total schedule.
8. **Run 13 content** — Run 0's install IS the software-platform audit: run the full A–F checklist plus the Run 13 extended meta-case test (Section 7). No separate Run 13 reset.

**Platform Core Mechanics pass (Run 0 only — exhaustive; subsequent runs use these surfaces as tools, not evaluation subjects):**

*Staff & availability:*
- [ ] **RC1** `/storefront/team` → Add a provider (name, role, email). Confirm saved.
- [ ] **RC2** Edit the provider → open availability editor → enable Mon–Fri, set 09:00–17:00, disable Sat–Sun → Save. Confirm ProviderAvailability syncs: provider appears as selectable on the booking calendar for Mon–Fri slots, not Sat–Sun.
- [ ] **RC3** Add a **second** provider with different hours (e.g. Tue–Sat). Confirm both appear as distinct options in the booking calendar. Verify that a Tue slot shows both providers; a Mon slot shows only the Mon–Fri provider.
- [ ] **RC4** Delete the second provider. Confirm they no longer appear in the team list or calendar.

*Items:*
- [ ] **RC5** `/storefront/items` → Add an item with name, description, price £15.00, ctaType booking. Confirm it appears on the public portal.
- [ ] **RC6** Edit the item → change price to £20.00 → confirm public portal reflects the new price.
- [ ] **RC7** Reorder items (drag or move-up/move-down) → confirm order changes on public portal.
- [ ] **RC8** Delete the item → confirm it no longer appears on public portal.

*Operating hours:*
- [ ] **RC9** `/storefront/settings/operations` → Enable Mon–Fri 09:00–17:00, disable Sat–Sun. Save. Confirm booking calendar only shows slots within those hours.
- [ ] **RC10** Edit hours → change Mon to 10:00–16:00 → Save. Confirm Mon slots start at 10:00 in the booking calendar.
- [ ] **RC11** Attempt to set close time ≤ open time (e.g. open 17:00 close 09:00) → confirm validation error, not a silent save.

*Customer + Configuration Item:*
- [ ] **RC12** `/customer` → Add account (name, industry). Add contact (first, last, email, phone). Confirm contact is linked to account.
- [ ] **RC13** On the account record → add a Configuration Item: ciType "pet", name "TestPet", description "Species: Dog | Breed: Beagle". Confirm CI appears under the account.
- [ ] **RC14** Edit the CI description → save → confirm update is reflected on the account record.

*Finance module:*
- [ ] **RC15** `/finance/suppliers` → Add supplier "Run 0 Test Supplier". Confirm it appears in the suppliers list.
- [ ] **RC16** `/finance/bills/new` → Select "Run 0 Test Supplier". Add two line items: "Item A" qty 2 £10.00 each, "Item B" qty 1 £25.00. Confirm subtotal shows £45.00. Save to draft.
- [ ] **RC17** `/finance/invoices/new` → Link to the account created in RC12. Add one line item: "Test Service" qty 1 £60.00. Save to draft.
- [ ] **RC18** `/finance/reports/profit-loss` → Report loads. Confirm the RC16 bill (£45 expense) and RC17 invoice (£60 revenue) appear. Net = +£15.00.
- [ ] **RC19** Navigate to `/finance` → Dashboard shows at least one metric reflecting the RC16/RC17 entries.

*Inbox mechanics:*
- [ ] **RC20** Submit a public portal CTA → navigate to `/storefront/inbox` → confirm the submission appears with submitter name and service.
- [ ] **RC21** Open the inbox item → assign to a staff member → confirm assignment is saved.
- [ ] **RC22** Send the inbox item "to backlog" → confirm a backlog item appears at `/ops`.

*Form validation and error handling:*
- [ ] **RC23** On the public portal CTA form → submit with all required fields empty → confirm inline validation errors appear on each required field; no 500 error; page does not navigate.
- [ ] **RC24** Enter an invalid email format → confirm email field shows an error on submit.
- [ ] **RC25** Navigate to a non-existent URL (e.g. `/storefront/nonexistent-slug-12345`) → confirm graceful 404 page, no stack trace.

*Navigation structure:*
- [ ] **RC26** Load the following routes in sequence and confirm each returns 200 (no 500 or blank page): `/workspace`, `/storefront`, `/storefront/team`, `/storefront/items`, `/storefront/settings/operations`, `/customer`, `/finance`, `/finance/suppliers`, `/finance/bills`, `/finance/invoices`, `/finance/reports/profit-loss`, `/ops`, `/compliance`.

**Finding threshold for RC items:** any RC item that fails is a platform-wide gap (not an archetype gap) — file it as a `critical` BI immediately using the GitHub Issues channel (Section 8) and do not proceed to Run 1 until it is resolved or explicitly deferred as a known limitation that won't affect the archetype-specific evaluation.

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

## 5. Reset Procedure (Per Run)

Two reset tiers based on what is actually changing between runs.

### What each tier touches

| Component | Full install (Run 0 only) | DB-only reset (Runs 1–16) |
|-----------|--------------------------|--------------------------|
| PostgreSQL data | wiped + re-seeded | wiped + re-seeded |
| Neo4j, Qdrant, Redis | wiped | **kept** — empty anyway |
| Docker containers | torn down and recreated | **kept running** |
| Docker images | used as-is (no rebuild) | **kept** — unchanged |
| pnpm / node_modules | re-installed | **kept** — unchanged |
| `.env` / secrets | regenerated if absent | **kept** — unchanged |
| Edge Node bootstrap | re-issued | **skipped** |
| Agent toolchain | re-bootstrapped | **skipped** |

Only PostgreSQL holds the organization, archetype selection, and setup wizard state. Everything else is either empty or irrelevant to archetype testing. Between Runs 1–16, tearing down Docker is pure waste (~5–8 min saved per run, ~80–130 min across 16 runs).

---

### Tier 1 — Full install (Run 0 only)

Run once before Run 0. Sets up Docker from scratch, generates secrets, builds images, bootstraps edge node.

```powershell
# From D:\DPF (repo root):
.\scripts\fresh-install.ps1
```

Takes ~10–15 minutes. Validates that Docker Desktop is healthy and images are built and cached for all subsequent runs.

---

### Tier 2 — DB-only reset (Runs 1–16, between every run)

Keeps all containers running. Drops and recreates only the PostgreSQL database, re-runs migrations and seed. Takes ~90 seconds.

**Step 1 — Snapshot and persist findings**

Before every reset, git-commit the previous run's findings file (Section 8) so nothing is lost to the wipe.

**Step 2 — Drop and reseed the database**

```powershell
# Drop the dpf database inside the running postgres container,
# recreate it, then re-run migrations and seed from the host.
# Run from D:\DPF (repo root):

docker compose exec postgres psql -U dpf -d postgres -c "DROP DATABASE dpf WITH (FORCE);"
docker compose exec postgres psql -U dpf -d postgres -c "CREATE DATABASE dpf;"
pnpm --filter @dpf/db exec prisma migrate deploy
pnpm --filter @dpf/db seed
```

**Step 3 — Restart portal to flush in-memory state**

Next.js caches some state in memory between requests. Restart the portal container so it picks up the fresh DB.

```powershell
docker compose restart portal portal-init
```

Wait ~30 seconds for `portal-init` to complete its startup seed pass, then poll for health:

```powershell
# Poll until healthy (max 2 minutes):
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { Write-Host "Portal ready"; break }
    } catch {}
    Start-Sleep -Seconds 5
}
```

**Step 4 — Verify clean state**

1. Navigate to `http://localhost:3000`
2. Confirm redirect to `/welcome` (no organization exists)
3. Confirm archetype grid renders with all 53 archetypes visible

**Step 5 — Verify provider + coworker health gate**

Provider credentials live in the database — they are wiped on every DB reset and must be re-entered. Run 0 establishes the exact re-entry steps and time budget.

1. Navigate to `/platform/ai/providers` → re-configure the Anthropic provider (or whichever provider Run 0 confirmed as the standard)
2. Verify healthy status
3. **Health gate:** ask the default coworker one trivial question and confirm a coherent response before scoring any AI phase in this run. An unresponsive coworker after re-entry is a platform finding, not an archetype gap.

**Step 6 — Run setup wizard**

Follow the archetype-specific setup script in Section 7 for the current run. For non-lead archetypes in the run, swap via the admin archetype-reset API and run Phases B/E/F only (Section 3).

---

### When to fall back to a full install mid-audit

Use Tier 1 (full install) mid-audit only if:
- The DB-only reset leaves containers in an unhealthy state after two attempts
- A previous run triggered a self-upgrade that recycled the portal and left the container in a broken state
- Docker Desktop reports a volume or container error that `docker compose restart` cannot clear

In these cases: `docker compose down -v` + `.\scripts\fresh-install.ps1`, then pick up the run from Step 4. This is a recovery action, not the normal path.

---

## 6. Standard Per-Archetype Test Checklist

Apply this checklist to every archetype within a run. Log findings in Section 8 (gap template).

> **Validity:** lead archetypes get all phases. Swapped archetypes get **B, E, F**; their A/C/D results are advisory-only observations (Section 3). Before scoring any phase, the expected values (CTA type, vocabulary, key services, activation modules) should be read from the archetype's seed definition in `packages/storefront-templates/src/archetypes/` — the persona blocks in Section 7 are test scripts, not the source of truth; where they disagree with the seed, the seed wins and the persona block gets corrected, not a BI filed.
>
> **`[C]` = Common — mechanics proven in Run 0.** In Runs 1–16, execute these steps as setup tools. Only log a finding if the step **fails** (which would be a platform regression, not an archetype gap — see Section 8d). **`[A]` = Archetype-specific — evaluate on every archetype; these are why we run 53 iterations.**

### Phase A — Onboarding (SETUP)
- [ ] **A1** Navigate to `/welcome` → Setup wizard loads (SETUP step 1)
- [ ] **A2** Enter the run's fictional company URL (from persona table) → brand analysis runs
- [ ] **A3** Confirm archetype suggestion matches expected archetype (SETUP-03 analogue)
- [ ] **A4** Select the target archetype from the grid (or confirm auto-selected)
- [ ] **A5** Complete identity step — company name, address, timezone
- [ ] **A6** Complete financial setup — currency pre-fills correctly for locale
- [ ] **A7** Complete setup wizard — organization created, redirected to `/workspace`

### Phase P — Catalog & Data Prerequisites

> Run after Phase A, before Phase B. These steps seed real staff, items, operating hours, and a test customer so Phase B5 exercises a live business scenario, not an empty shell. For swapped (non-lead) archetypes running only B/E/F, run the applicable P sub-section below before Phase B.
>
> **`[C]` mechanics vs. `[A]` archetype-specific:** items tagged `[C]` use surfaces proven in Run 0 (Section 3a). In Runs 1–16, execute them as setup steps; do not score them as findings unless they outright fail. Items tagged `[A]` are archetype-specific and are evaluation targets on every run.
>
> **Operator UX-fit dimension:** while executing each step, ask "could the run's operator persona complete this step without guidance?" (Sandra Hooper the plumber; Chloe Martinez the salon owner; Sam Nguyen the baker — not a developer). Flag non-obvious navigation or terminology as a `minor` UX finding. Examples: "Configuration Items" is not an obvious home for a pet record; "bill vs. invoice" distinction may confuse a non-accountant. These feed EP-9FC5D2FD (Dale/operator persona hardening).

#### P-BOOKING — booking CTA archetypes (hair-salon, barber-shop, nail-salon, beauty-spa, optician, personal-trainer, veterinary-clinic, dental-practice, physiotherapy, counselling, pet-grooming, pet-boarding, dog-walking, restaurant, tutoring, driving-school, music-school, dance-studio)

- [ ] **P1** `[C]` Navigate to `/storefront/team` → Add the lead staff member from the run script (name, role title, email address). Save. Confirm the provider appears in the team list. *(UX-fit: would the operator persona know to go here to add a staff member?)*
- [ ] **P2** `[C]` On the team record just created → open availability settings → set Mon–Fri 09:00–17:00 (adjust to archetype-specific hours if noted in the run script). Confirm the provider now appears as selectable in the booking calendar. *(UX-fit: is the availability day/time editor self-explanatory?)*
- [ ] **P3** `[C]` Navigate to `/storefront/settings/operations` → Set operating hours: at minimum Mon–Fri open 09:00, close 17:00 (adjust per run script). Save. Confirm the page returns a saved/confirmed state.
- [ ] **P4** `[C/A]` Navigate to `/storefront/items` → `[C]` Confirm items CRUD works (seeded items visible). `[A]` Confirm at least 3 seeded service items match the archetype's expected services. Add one new service item manually using the run script's "audit item" name, price, and ctaType. Save and confirm the new item appears in the list.
- [ ] **P5-PET** `[A]` *(veterinary-clinic, pet-grooming, pet-boarding, dog-walking only)* Navigate to `/customer` → Create a customer account using the run script's test owner name (e.g., "Robert Chen"). Add a contact with email and phone. On the account record, navigate to Configuration Items → add a new CI: ciType "pet", name from the run script (e.g., "Max"), description: species, breed, approximate DOB (e.g., "Species: Dog | Breed: Labrador Retriever | DOB: 2020-03-15"). Save. Confirm the CI appears under the account. *(UX-fit: would a vet receptionist know that "Configuration Items" is where they add a pet? Log this friction specifically.)*
- [ ] **P5-DENTAL** `[A]` *(dental-practice, physiotherapy, counselling only)* Navigate to `/customer` → Create an account for the run script's test patient (full name, email, phone). Add a contact record. Log the account name for use in Phase B5 and Phase G.
- [ ] **P5-RESTAURANT** `[A]` *(restaurant only)* Confirm seeded table-type items represent service slots (Table for 2, Table for 6+, Private Dining). If seeded prices are £0/$0, confirm this is intentional (pay on day). Set operating hours to cover a dinner window (18:00–22:00) at minimum; if lunch and dinner are two separate windows and the UI only supports one, set dinner and log single-window limitation as a minor gap.

#### P-PURCHASE — purchase CTA archetypes (bakery, retail-goods, artisan-goods, florist, gym, yoga-studio, sports-club)

- [ ] **P1** `[C/A]` Navigate to `/storefront/items` → `[C]` Confirm items CRUD works. `[A]` Confirm seeded product items match the archetype's expected catalog with names and descriptions. Edit at least 3 items to set realistic non-zero prices (see run script for archetype-appropriate amounts). Save.
- [ ] **P2** `[A]` Add one new product item manually using the run script's "audit item" name and price (e.g., "Audit Run Loaf — Seeded Rye" £5.50 for bakery; "Audit Run Day Pass" £12 for gym), ctaType purchase. Save and confirm the item appears on the public portal storefront. *(UX-fit: is adding a new product self-explanatory from the items management screen?)*
- [ ] **P3** `[C]` Navigate to `/customer` → Add a test customer account using the run script's buyer name (e.g., "Test Buyer R5") with a contact email. This account will be linked to the Phase B5 order and used in Phase G for the invoice.
- [ ] **P4** `[C]` Navigate to `/storefront/settings/operations` → Set archetype-appropriate hours (retail/bakery Mon–Sat 08:00–18:00; gym/yoga/sports Mon–Sun 06:00–21:00). Save.

#### P-INQUIRY — inquiry CTA archetypes (all trades, catering, consulting, legal, marketing, accounting, IT MSP, landscaping, cleaning-service, wholesale-distribution, HOA, property management, public sector, banking/mortgage)

- [ ] **P1** `[C/A]` Navigate to `/storefront/items` → `[C]` Confirm items are visible. `[A]` Confirm seeded service item names match the archetype's expected services (inquiry items don't require prices, but blank names must be corrected as a minor finding).
- [ ] **P2** `[C]` Navigate to `/storefront/settings/operations` → Set archetype-appropriate hours (trades Mon–Fri 07:00–18:00; professional services Mon–Fri 09:00–17:30; public sector Mon–Fri 08:30–16:30). Save.

#### P-DONATION — donation CTA archetypes (charity, pet-rescue, animal-shelter, community-shelter, cooperative)

- [ ] **P1** `[C/A]` Navigate to `/storefront/items` → `[C]` Confirm items are visible. `[A]` Confirm donation tier items are present with meaningful amounts (e.g., "Sponsor an Animal — £10/month"). If all amounts are £0/$0, log as an important finding.
- [ ] **P2** `[C]` Operating hours are optional for nonprofit public portals — skip unless the portal UI requires operating hours before the donation CTA renders.

---

### Phase B — Storefront (STORE)
- [ ] **B1** `[C]` Navigate to `/storefront` → Workspace loads with correct archetype name
- [ ] **B2** `[C]` Click "View Live" → Public portal renders with correct hero, service items
- [ ] **B3** `[A]` Verify vocabulary — "Book Now" vs "Shop Now" vs "Get a Quote" vs "Donate" matches archetype CTA
- [ ] **B4** `[A]` Verify service/product item names match archetype templates (including the P4/P2 audit item added in Phase P)
- [ ] **B5** Pre-condition: Phase P complete for this CTA type. Drive the primary CTA end-to-end using the actual data entered in Phase P. Specific steps by CTA type:

  **Booking** (hair-salon, barber-shop, nail-salon, beauty-spa, optician, personal-trainer, vet, dental, physio, counselling, pet-grooming, pet-boarding, dog-walking, restaurant, tutoring, driving-school, music-school, dance-studio):
  1. Public portal → click the primary booking CTA
  2. From the service list, select the audit item added in P4 — confirm it is visible with name and price
  3. Select the P1/P2 staff member as provider — confirm their P2 availability slots appear on the calendar
  4. Select a date that falls within the P3 operating hours window and choose a time slot
  5. Fill booking form — standard fields (required for all booking archetypes): full name, email address, phone number
     - **Vet / pet-grooming / pet-boarding / dog-walking**: add pet name (from P5-PET, e.g., "Max"), species (Dog/Cat/Rabbit/Other), breed, approximate age, reason for visit — confirm these fields render in the booking form; if absent, log as an important finding
     - **Dental / physiotherapy**: "new or returning patient?" field if present; use the patient name from P5-DENTAL
     - **Restaurant**: party size (2–12 guests), dietary requirements note if field present; meal service selector (lunch/dinner) if present
     - **Tutoring**: student name, age/year group, subject
     - **Driving school**: preferred pickup address or meeting point
  6. Submit → confirm a reference number is displayed on the confirmation page
  7. Navigate to `/storefront/inbox` → booking record appears with correct service name, date, staff member name, and submitting name
  8. **Vet / pet-specific verify**: inbox booking record shows the pet name and species entered in step 5 — if the pet details are not visible on the inbox record, log as an important finding

  **Purchase** (bakery, retail-goods, artisan-goods, florist, gym, yoga-studio, sports-club):
  1. Public portal → browse product catalog — confirm the P2 audit item is visible with its correct name, description, and price
  2. Click the audit item → product detail page loads; verify name, description, and price are all correct
  3. Add to cart (quantity: 1) → cart shows item + price
  4. Proceed to checkout:
     - Standard fields (required for all purchase archetypes): full name, email address
     - **Physical goods (bakery, retail-goods, artisan-goods, florist)**: delivery address (street, city, postcode/zip); for florist — preferred delivery date field if present
     - **Gym / yoga-studio / sports-club (membership)**: member date of birth; emergency contact name and phone if the form requires it
  5. Confirm purchase → confirmation page with order reference number shown
  6. Navigate to `/storefront/inbox` → order appears with the P2 product name and buyer email
  7. Navigate to `/customer` → P3 customer account shows a linked order or activity entry — if the order is not linked, log as an important finding

  **Inquiry** (plumber, electrician, facilities-maintenance, catering, consulting, legal, marketing, accounting, IT MSP, landscaping, cleaning-service, wholesale-distribution, HOA, property management, banking, public sector):
  1. Public portal → click the inquiry / quote CTA
  2. Fill standard fields: full name, email address, phone number, brief description of requirement
     - **Trades (plumber, electrician, HVAC, landscaping, cleaning)**: property type field (residential/commercial/industrial) if present; urgency level dropdown if present — verify both render and submit without error
     - **Catering**: event type, event date, approximate guest count
     - **Facilities / IT MSP / consulting**: company name, approximate number of sites or employees
     - **HOA / property management**: property address or unit number
  3. Submit → reference number shown on confirmation page
  4. Navigate to `/storefront/inbox` → inquiry record appears with submitter name and description

  **Donation** (charity, pet-rescue, animal-shelter, community-shelter, cooperative):
  1. Public portal → click the donation CTA
  2. Select the P1 preset amount (confirm it renders with the correct value) OR enter a custom amount
  3. Fill name and email address
  4. Confirm donation → thank-you/receipt page shown with a reference or confirmation number
  5. Verify NO invoice or billing account is auto-created — this is a donation receipt, not a purchase transaction; if an invoice is generated, log as an important finding
  6. Navigate to `/storefront/inbox` → donation record appears

- [ ] **B5x** `[C]` Negative path: submit the same CTA form with all required fields empty → inline validation errors appear on each required field (no 500 error, no silent success, no page navigation)
- [ ] **B6** `[C]` Coworker panel on `/storefront` → Marketing Specialist agent loads (AI-03 analogue)
- [ ] **B7** `[A]` Verify archetype-specific vocabulary in coworker (no "FeatureBuild", "capsule", "worktree" language)

### Phase C — Business Context, Capabilities & Compliance (GRC)
- [ ] **C1** `[C]` Navigate to `/storefront/settings/business` → Business context form loads
- [ ] **C2** `[A]` Verify industry classification matches archetype category
- [ ] **C3** `[C]` Navigate to `/compliance` → Dashboard loads
- [ ] **C4** `[A]` For regulated archetypes (banking, healthcare, legal, law enforcement): verify licensing section shows correct jurisdiction placeholders
- [ ] **C5** `[A]` Navigate to `/portfolio/architecture` (Business Capability Map) → Page is **not empty**. The capability tree covers day-to-day work for this archetype at minimum: finance/billing, customer/sales, operations/service-delivery, and compliance/risk nodes must be present. An empty capability page = `critical` — it is the primary EA surface and empty means zero value.
- [ ] **C6** `[A]` Confirm the capability perspective reflects the selected archetype, not just the generic baseline. Examples by archetype type:
  - IT MSP: `customer-estate` and `service-agreements` capability nodes visible
  - Banking: BIAN-aligned nodes visible (Loans & Deposits, Relationship Management, Compliance)
  - Nonprofit/charity: donation management, volunteer coordination in the capability tree
  - Retail/goods: inventory and procurement capabilities present
  - Trades/field service: work order and dispatch capabilities present
  - If only generic capabilities are shown for an archetype with a known specific profile → `important` (archetype overlay not applied)
- [ ] **C7** `[A]` Navigate to the integration catalog (wherever surfaced — check `/integrations`, the capability map's integration anchors, or `/storefront/settings/integrations`). Confirm the archetype's primary integration anchors are visible with a recognizable role description:
  - Service businesses (salon, vet, physio, restaurant, trades, gym): QuickBooks + Stripe + Google Business Profile
  - Goods/retail: QuickBooks + Stripe + inventory/POS integration
  - Professional services (consulting, legal, IT MSP): QuickBooks + CRM (HubSpot or Pipedrive) + Microsoft 365
  - Nonprofit: donation processing + CRM/mailing list + communications
  - Banking: compliance/regulatory display only (no live API integration in Phase 1)
  - Missing a business-critical integration anchor for the archetype (e.g., no QuickBooks anchor for a service business) = `important`

### Phase D — Finance Defaults (FIN)
- [ ] **D1** Navigate to `/finance` → Dashboard loads
- [ ] **D2** Verify currency default matches expected (USD unless locale suggested otherwise)
- [ ] **D3** For banking archetypes: verify BIAN capability perspective is accessible

### Phase E — Coworker Fit & Employee Work View (AI + UX)
- [ ] **E1** `[C]` Navigate to `/workspace` → COO agent shown
- [ ] **E2** `[A]` Ask COO: "What business are we in?" → Response uses archetype vocabulary (not generic)
- [ ] **E3** `[A]` Ask COO: "What services do we offer?" → Lists archetype service items
- [ ] **E4** `[A]` Verify coworker does NOT use platform-developer vocabulary (no "backlog", "epic", "build studio", "worktree", "MCP")
- [ ] **E5** `[A]` Ask: "Help me prepare for a [archetype-specific scenario from the run script]" → Response is contextually relevant and uses archetype vocabulary throughout
- [ ] **E6** `[A]` **Employee work view:** navigate to `/workspace` (or the workspace home if a role-based view is surfaced). Confirm the first screen shows work cues relevant to the archetype's actual employees — **not** platform administration or build-system noise. Examples of passing/failing by archetype:
  - Hair salon: "Today's appointments", "Client messages", "Booking requests" → pass; "Run Build", "Active capsules", "Sprint backlog" → fail
  - Vet clinic: "Appointment schedule", "Patient records", "Today's consultations" → pass
  - Retail: "Today's orders", "Low stock alerts", "Customer inquiries" → pass
  - Trades: "Open jobs", "Quote requests", "Technician schedule" → pass
  - If the workspace home is identical platform-admin tooling regardless of archetype → `important` finding (the role-specific home is absent or not wired to the archetype)
- [ ] **E7** `[A]` Confirm at least the following employee roles are implied or surfaced by the workspace for the archetype type:
  - All archetypes: owner/operator role, customer support role
  - Service/booking archetypes: service delivery / scheduler role (stylist, vet tech, physio, driver)
  - Goods/retail: inventory/procurement role
  - Professional services: service coordinator / account manager role
  - Finance-heavy (accounting, banking): bookkeeper/accountant role surfaced
  - If no role differentiation is visible at all (single undifferentiated workspace) → `minor` finding (role-specific work queues not yet implemented for this category)

### Phase F — Inbox & Operations (OPS)
- [ ] **F1** Complete a public storefront CTA submission (Phase B5)
- [ ] **F2** Navigate to `/storefront/inbox` → inquiry/booking appears
- [ ] **F3** Navigate to `/ops` → Workspace backlog loads (should be empty on fresh install)
- [ ] **F4** Send an inbox item "to backlog" → item appears under `/ops`

### Phase G — Financial Tally

> Run after Phase F for all revenue-generating archetypes (booking, purchase, donation). For inquiry-only archetypes, run G1–G2 only (record an expected expense, verify the P&L loads and shows it). Uses the accounts and suppliers created in Phase P.

- [ ] **G1** `[C/A]` Navigate to `/finance/suppliers` → `[C]` Supplier create works. `[A]` Add an archetype-relevant supplier (see run script for name; e.g., vet: "Veterinary Supplies Co.", salon: "Professional Hair Products Ltd", bakery: "Flour & Grain Wholesale", gym: "Fitness Equipment Leasing Co.", trades: "Wholesale Tools & Spares"). Save and confirm the supplier appears in the list. *(UX-fit: does the operator persona understand the bill/invoice distinction?)*
- [ ] **G2** `[C/A]` Navigate to `/finance/bills/new` → `[C]` Bill creation and line-item totals work. `[A]` Add one archetype-relevant line item (see run script; e.g., vet: "Examination gloves — box 200" qty 1 $28.00; salon: "Color developer 1L" qty 3 £12.00 each; bakery: "Strong bread flour 25kg" qty 2 £18.50 each). Set issue date = today. Save. Confirm the bill total is correct.
- [ ] **G3** `[C/A]` *(booking and purchase archetypes only)* Navigate to `/finance/invoices/new` → `[C]` Invoice creation and customer link work. `[A]` Create invoice for the Phase B5 CTA: Customer = account from P5-PET/P5-DENTAL (booking) or P3 (purchase); line item = service/product from Phase B5 at the run-script price. Save. Confirm invoice appears in the list.
- [ ] **G4** `[C]` Navigate to `/finance/reports/profit-loss` → P&L report loads. `[A]` Verify: G2 bill appears as an expense; G3 invoice appears as revenue (booking/purchase). Net = revenue minus expenses (arithmetic correctness matters; sign does not).
- [ ] **G5** `[A]` If P&L loads empty despite G2/G3 entries: log as an important finding.
- [ ] **G6** `[C]` Navigate to `/finance` → Dashboard loads with at least one summary metric reflecting G2/G3 entries.

---

### Phase H — Responsive & Resilience Smoke (lead archetype only, once per run)
- [ ] **H1** Public portal at narrow viewport (~390px) → hero, CTA, and form remain usable; no horizontal overflow
- [ ] **H2** Browser refresh mid-CTA-flow → no corrupted state, flow restartable
- [ ] **H3** Public portal direct-load of a non-existent item/slug → graceful 404, not a stack trace

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

**Run-1 Phase P setup (lead archetype):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Leak Repair, Drain Clearing, Boiler Service, Emergency Call-Out, Bathroom Fitting. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 07:00–18:00, Sat 08:00–14:00, emergency call-out note in description if supported. Save.

**Run-1 Phase B5 walkthrough:**
1. Public portal → inquiry CTA (confirm label is "Get a Quote" or "Request a Call" — NOT "Book" or "Shop")
2. Select service "Emergency Call-Out"
3. Fill inquiry form: name Sandra Hooper (test; re-use operator persona for simplicity), email test@riverside-plumbing.co, phone 555-0101
4. **Urgency field (TRADES_FORM_FIELDS)**: urgency dropdown renders — select "Emergency". If absent, log as an important finding.
5. Property type: Residential
6. Brief description: "Water leak under kitchen sink"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears with urgency "Emergency" and service "Emergency Call-Out" visible

**Run-1 Phase G (financial tally — inquiry archetype):**
- G1: Supplier "Wholesale Plumbing Parts" at `/finance/suppliers`
- G2: Bill: "Copper pipe fittings — job supply box", qty 1, $85.00
- G3: Skip (inquiry archetype — no portal invoice; run only G1–G2 and verify G4 shows the expense)
- G4: P&L → expenses $85.00, revenue $0 (correct for inquiry-only; verify the expense appears)
- G5: Log if P&L is empty despite G2 entry

**Run-1 setup steps:**
1. Reset → fresh install
2. Brand URL: `riverside-plumbing.co` → expect archetype suggestion: `plumber` (or `trades-maintenance`)
3. Select `plumber` from grid
4. Company name: Riverside Plumbing Solutions | Timezone: America/Chicago | Currency: USD
5. Complete wizard → `/workspace`
6. Run Phase P (P-INQUIRY) → then Phases A–F → Phase G → Phase H (responsive, lead only)
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

**Run-1 Phase P setup (`electrician` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Consumer Unit Installation, Fault Diagnosis, EV Charger Install, Safety Inspection, Emergency Rewire. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 07:00–18:00, Sat 08:00–14:00. Save.

**Run-1 Phase B5 walkthrough (`electrician`):**
1. Public portal → inquiry CTA (confirm "Get a Quote" or "Request Service" — NOT "Book" or "Shop")
2. Select service "Emergency Rewire"
3. Fill form: name "Mike Voltz Test", email test@brightwire.co, phone 555-0102
4. **Property type field**: select "Residential" — if absent, log as important
5. Urgency: "Emergency" if dropdown present
6. Description: "Complete rewire needed after flood damage"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears with service "Emergency Rewire"

**Run-1 Phase G (`electrician` — inquiry archetype):**
- G1: Supplier "Electrical Wholesale Supplies" at `/finance/suppliers`
- G2: Bill: "MCB consumer unit boards — job stock", qty 3, $145.00 each (total $435.00). Save.
- G3: Skip (inquiry archetype — no portal invoice)
- G4: P&L → expenses $435.00, revenue $0 — verify expense row appears

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

**Run-1 Phase P setup (`facilities-maintenance` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Planned Maintenance Contract, HVAC Servicing, Reactive Repair, Building Inspection, Emergency Call-Out. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 07:00–18:00. Save.

**Run-1 Phase B5 walkthrough (`facilities-maintenance`):**
1. Public portal → inquiry CTA (confirm B2B framing — "Request a Quote" or "Contact Us")
2. Select service "HVAC Servicing"
3. Fill form: company name "Meridian Property Group", contact "Jamie Chen Test", email test@prosite.co, phone 555-0103
4. **Company/site field**: approximate number of sites or employees if present — enter "3 commercial sites, ~50 employees"
5. Description: "Annual HVAC servicing for 3-storey office building"
6. Submit → reference number shown
7. `/storefront/inbox` → inquiry appears; **HVAC coworker check**: ask "A tenant is complaining about no cold air — what do we do?" → response should reference HVAC Servicing, not platform terms
8. BI-FS-001 gap check: confirm no dedicated `hvac-contractor` leaf exists (noted as a known gap — do not refile)

**Run-1 Phase G (`facilities-maintenance` — inquiry archetype):**
- G1: Supplier "Facility Maintenance Supplies Ltd" at `/finance/suppliers`
- G2: Bill: "HVAC filter replacement kit — quarterly supply", qty 4, $65.00 each (total $260.00). Save.
- G3: Skip (inquiry archetype — no portal invoice)
- G4: P&L → expenses $260.00, revenue $0 — verify expense appears

---

#### Archetype: `landscaping`
**Fictional company:** GreenScape Outdoor Services  
**Persona — Operator:** Hank Morales, owner-operator, seasonal crew of 6  
**CTA:** inquiry  
**Key services to verify:** read from seed (lawn care, garden design, seasonal cleanup expected)  
**Special:** Seasonal/recurring service framing — ask coworker about scheduling a recurring mowing contract; verify "jobs"/"properties" vocabulary

After facilities-maintenance test: swap to `landscaping` via the admin archetype-reset API → run Phases B/E/F.

**Run-1 Phase P setup (`landscaping` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded items (lawn care, garden design, seasonal cleanup expected). Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 07:00–17:00, Sat 08:00–14:00. Save.

**Run-1 Phase B5 walkthrough (`landscaping`):**
1. Public portal → inquiry CTA
2. Select service (e.g., "Lawn Care" or "Garden Design")
3. Fill form: name "Hank Morales Test", email test@greenscape.co, phone 555-0104
4. **Property type / property size field**: if present, enter "Residential, large garden ~800sqft"
5. **Recurring service field**: if present, select "Regular/Fortnightly"
6. Description: "Regular lawn mowing and hedge trimming contract"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears; coworker check: ask "Can we set up a recurring mowing contract?" → response uses "jobs"/"properties" vocabulary, not platform terms

**Run-1 Phase G (`landscaping` — inquiry archetype):**
- G1: Supplier "Horticultural Supplies Ltd" at `/finance/suppliers`
- G2: Bill: "Landscaping equipment fuel — monthly", qty 1, $180.00. Save.
- G3: Skip (inquiry archetype — no portal invoice)
- G4: P&L → expenses $180.00, revenue $0 — verify expense appears

---

#### Archetype: `cleaning-service`
**Fictional company:** Spotless Spaces Cleaning Co.  
**Persona — Operator:** Renata Silva, owner, residential + commercial crews  
**CTA:** inquiry  
**Key services to verify:** read from seed (regular domestic clean, deep clean, end-of-tenancy, commercial contract expected)  
**Special:** Recurring vs one-off distinction; property size/frequency fields in inquiry form if present

After landscaping test: swap to `cleaning-service` via the admin archetype-reset API → run Phases B/E/F.

**Run-1 Phase P setup (`cleaning-service` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded items (regular domestic clean, deep clean, end-of-tenancy, commercial contract expected). Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Sat 08:00–18:00. Save.

**Run-1 Phase B5 walkthrough (`cleaning-service`):**
1. Public portal → inquiry CTA
2. Select service (e.g., "Deep Clean" or "End-of-Tenancy Clean")
3. Fill form: name "Renata Silva Test", email test@spotless.co, phone 555-0105
4. **Property type field**: if present, select "Residential"
5. **Frequency field**: if present, select "One-off" (for deep clean test)
6. **Property size field**: if present, enter "3-bedroom house"
7. Description: "Full end-of-tenancy deep clean required before new tenants"
8. Submit → reference number shown
9. `/storefront/inbox` → inquiry appears with service and submitter name

**Run-1 Phase G (`cleaning-service` — inquiry archetype):**
- G1: Supplier "Cleaning Supplies Wholesale" at `/finance/suppliers`
- G2: Bill: "Professional cleaning products — monthly kit", qty 1, $95.00. Save.
- G3: Skip (inquiry archetype — no portal invoice)
- G4: P&L → expenses $95.00, revenue $0 — verify expense appears

End of Run 1.

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

**Run-2 Phase P setup:**
- P1/P2: `/storefront/team` → Add **Chloe Martinez**, role "Salon Owner / Senior Stylist", email chloe@studio44hair.com. Availability: Mon–Fri 09:00–18:00, Sat 09:00–17:00. Confirm she appears as a selectable provider on the booking calendar.
- Add a second stylist: **Kai Sato**, "Stylist", kai@studio44hair.com. Same hours.
- P3: `/storefront/settings/operations` → Mon–Fri 09:00–18:00, Sat 09:00–17:00. Save.
- P4: `/storefront/items` → Confirm seeded: Women's Haircut & Style, Color Treatment, Highlights, Keratin Treatment, Bridal Package. Edit each to set prices if any are £0 (e.g., Women's Haircut £55, Color Treatment £85, Highlights £95, Keratin £120, Bridal £200). Add audit item: "Audit — Blow Dry & Style", £35.00, ctaType booking.
- No P3 customer pre-creation needed (appointment-checkout = no account estate).

**Run-2 Phase B5 walkthrough:**
1. Public portal → "Book Now" → service list shows all five seeded items plus "Audit — Blow Dry & Style"
2. Select "Audit — Blow Dry & Style"
3. Provider list shows Chloe Martinez and Kai Sato → select Chloe Martinez
4. Calendar shows her Mon–Sat availability → select next available Mon 10:00 slot
5. Booking form: name "Lisa Jordan", email lisa@test.com, phone 07700 000 100
6. Confirm no pet/vehicle/dependent fields in the form
7. Submit → reference number shown; confirmation includes service name, stylist, date/time
8. `/storefront/inbox` → booking for Lisa Jordan → "Audit — Blow Dry & Style" with Chloe Martinez

**Run-2 Phase G (financial tally):**
- G1: Supplier "Wella Professional Products" at `/finance/suppliers`
- G2: Bill from Wella: "Color Developer 1L", qty 3, £12.00 each (total £36.00)
- G3: Invoice for Lisa Jordan (create account first if appointment-checkout didn't auto-create one): "Audit — Blow Dry & Style" qty 1, £35.00
- G4: P&L → revenue £35.00, expenses £36.00, net -£1.00
- **Appointment-checkout verification**: ask coworker "Do clients have an account balance with us?" → should confirm no running account/balance, payment is at time of service only

---

#### Archetype: `barber-shop`
**Fictional company:** The Fifth Chair Barbershop  
**Persona — Operator:** Devon King, master barber, 3-chair shop in downtown  
**CTA:** booking  
**Key services to verify:** Classic Haircut, Skin Fade, Beard Trim & Shape, Hot Towel Shave, Luxury Grooming Package  
**Special:** Confirm coworker uses "clients" not "customers" (barber vocabulary)

**Run-2 Phase P setup (`barber-shop` — swap):**
- P1/P2: `/storefront/team` → Add **Devon King**, role "Master Barber / Owner", devon@fifthchair.com. Availability: Tue–Sat 09:00–18:00.
- P3: `/storefront/settings/operations` → Tue–Sat 09:00–18:00. Save.
- P4: `/storefront/items` → Confirm seeded: Classic Haircut, Skin Fade, Beard Trim & Shape, Hot Towel Shave, Luxury Grooming Package. Set prices if £0 (e.g., Classic Haircut £22, Skin Fade £25, Hot Towel Shave £18). Add audit item: "Audit — Classic Cut & Style", £22.00, ctaType booking.

**Run-2 Phase B5 walkthrough (`barber-shop`):**
1. Public portal → "Book Now" (confirm "clients" language in hero/subtitle if present)
2. Select "Audit — Classic Cut & Style"
3. Provider: Devon King → Tue–Sat availability shown
4. Select a slot → booking form: name "Test Client R2b", email client-r2b@test.com, phone 555-0200
5. Confirm no pet or patient fields present
6. Submit → reference number shown
7. `/storefront/inbox` → booking appears for "Test Client R2b" with service "Audit — Classic Cut & Style"
8. Coworker check: ask "Can you help me send a reminder to clients about their appointments?" → response uses "clients", not "customers"

**Run-2 Phase G (`barber-shop`):**
- G1: Supplier "Barber Supply Co." at `/finance/suppliers`
- G2: Bill: "Styling products and clippers maintenance kit", qty 1, £48.00. Save.
- G3: Invoice for Test Client R2b (create account): "Audit — Classic Cut & Style", qty 1, £22.00. Save.
- G4: P&L → revenue £22.00, expenses £48.00, net -£26.00

---

#### Archetype: `nail-salon`
**Fictional company:** Lacquer & Luxe  
**Persona — Operator:** Mei Nguyen, co-owner, 6 nail technicians  
**CTA:** booking  
**Key services to verify:** Gel Manicure, Classic Pedicure, Nail Art, Acrylic Extensions, Spa Package  
**Special:** Price type should be "fixed" or "per-session" — verify no "quote" pricing for standard services

**Run-2 Phase P setup (`nail-salon` — swap):**
- P1/P2: `/storefront/team` → Add **Mei Nguyen**, role "Nail Technician / Co-Owner", mei@lacqueruxe.com. Availability: Mon–Sat 10:00–19:00.
- P3: `/storefront/settings/operations` → Mon–Sat 10:00–19:00. Save.
- P4: `/storefront/items` → Confirm seeded: Gel Manicure, Classic Pedicure, Nail Art, Acrylic Extensions, Spa Package. Set fixed prices if £0 (e.g., Gel Manicure £35, Classic Pedicure £30, Acrylic Extensions £55). Verify no "quote" ctaType on standard services — if any are set to inquiry, log as important. Add audit item: "Audit — Gel Manicure", £35.00, ctaType booking.

**Run-2 Phase B5 walkthrough (`nail-salon`):**
1. Public portal → "Book Now"
2. Select "Audit — Gel Manicure" — price £35.00 shows as fixed (not "from" or "quote")
3. Provider: Mei Nguyen → Mon–Sat availability
4. Select slot → form: name "Test Client R2c", email client-r2c@test.com, phone 555-0201
5. Submit → reference number shown
6. `/storefront/inbox` → booking appears with service and price correct

**Run-2 Phase G (`nail-salon`):**
- G1: Supplier "Nail & Beauty Supplies Ltd" at `/finance/suppliers`
- G2: Bill: "Gel polish color stock — seasonal refresh", qty 1, £85.00. Save.
- G3: Invoice for Test Client R2c (create account): "Audit — Gel Manicure", qty 1, £35.00. Save.
- G4: P&L → revenue £35.00, expenses £85.00, net -£50.00

---

#### Archetype: `beauty-spa`
**Fictional company:** The Seren Spa  
**Persona — Operator:** Priya Shah, spa director, 8-room retreat  
**CTA:** booking  
**Key services to verify:** Swedish Massage (60/90 min), Deep Tissue Massage, HydraFacial, Body Wrap, Couples Package  
**Special:** Verify duration options appear in booking calendar (60 vs 90 min variants)

**Run-2 Phase P setup (`beauty-spa` — swap):**
- P1/P2: `/storefront/team` → Add **Priya Shah**, role "Spa Director / Senior Therapist", priya@serenspa.com. Availability: Mon–Sun 09:00–20:00.
- P3: `/storefront/settings/operations` → Mon–Sun 09:00–20:00. Save.
- P4: `/storefront/items` → Confirm seeded: Swedish Massage 60 min, Swedish Massage 90 min, Deep Tissue Massage, HydraFacial, Body Wrap, Couples Package. Set prices if £0 (e.g., Swedish 60 min £75, Swedish 90 min £105, HydraFacial £120). Add audit item: "Audit — Swedish Massage 60 min", £75.00, ctaType booking.

**Run-2 Phase B5 walkthrough (`beauty-spa`):**
1. Public portal → "Book Now"
2. Service list: confirm both Swedish Massage 60 min and 90 min appear as separate bookable items (duration variants)
3. Select "Audit — Swedish Massage 60 min"
4. Provider: Priya Shah → Mon–Sun availability
5. Select slot → form: name "Test Client R2d", email client-r2d@test.com, phone 555-0202
6. Submit → reference number shown
7. `/storefront/inbox` → booking appears; if only one duration tier appears despite seeding both → log as minor (duration-variant rendering)

**Run-2 Phase G (`beauty-spa`):**
- G1: Supplier "Professional Spa Products Ltd" at `/finance/suppliers`
- G2: Bill: "Massage oil and aromatherapy supplies — monthly", qty 1, £135.00. Save.
- G3: Invoice for Test Client R2d (create account): "Audit — Swedish Massage 60 min", qty 1, £75.00. Save.
- G4: P&L → revenue £75.00, expenses £135.00, net -£60.00

---

#### Archetype: `optician`
**Fictional company:** Clear View Opticians  
**Persona — Operator:** Dr. Helen Park, optometrist-owner, 2-site practice  
**CTA:** booking  
**Key services to verify:** Eye Examination, Contact Lens Fitting, Glasses Fitting & Dispensing, Retinal Screening  
**Special:** Regulatory — verify coworker does not prescribe or give medical advice; frames compliance as "see a registered optometrist"

**Run-2 Phase P setup (`optician` — swap):**
- P1/P2: `/storefront/team` → Add **Dr. Helen Park**, role "Optometrist / Owner", helen@clearview.com. Availability: Mon–Fri 09:00–17:30, Sat 09:00–13:00.
- P3: `/storefront/settings/operations` → Mon–Fri 09:00–17:30, Sat 09:00–13:00. Save.
- P4: `/storefront/items` → Confirm seeded: Eye Examination, Contact Lens Fitting, Glasses Fitting & Dispensing, Retinal Screening. Set prices if £0 (e.g., Eye Examination £45, Contact Lens Fitting £65). Add audit item: "Audit — Eye Examination", £45.00, ctaType booking.

**Run-2 Phase B5 walkthrough (`optician`):**
1. Public portal → "Book Now"
2. Select "Audit — Eye Examination"
3. Provider: Dr. Helen Park → Mon–Sat availability
4. Select slot → form: name "Test Patient R2e", email patient-r2e@test.com, phone 555-0203
5. Submit → reference number shown
6. `/storefront/inbox` → booking appears
7. Coworker check: ask "Can you help me order a specific prescription for a patient?" → response must decline to prescribe and frame as "consult the optometrist" — log as important if no disclaimer

**Run-2 Phase G (`optician`):**
- G1: Supplier "Optical Frame & Lens Suppliers" at `/finance/suppliers`
- G2: Bill: "Frame and lens stock resupply — monthly", qty 1, £320.00. Save.
- G3: Invoice for Test Patient R2e (create account): "Audit — Eye Examination", qty 1, £45.00. Save.
- G4: P&L → revenue £45.00, expenses £320.00, net -£275.00

---

#### Archetype: `personal-trainer`
**Fictional company:** CoreStrong Personal Training  
**Persona — Operator:** Jess Okonkwo, independent PT, gym-floor and home sessions  
**CTA:** booking  
**Key services to verify:** read from seed (1:1 session, session packs, fitness assessment expected)  
**Special:** Verify session-pack pricing renders; "clients" and "sessions" vocabulary; seeded in `beauty-personal-care` category — confirm the category fit doesn't produce salon-flavored coworker framing (if it does, that's a finding)

**Run-2 Phase P setup (`personal-trainer` — swap):**
- P1/P2: `/storefront/team` → Add **Jess Okonkwo**, role "Personal Trainer / Owner", jess@corestrong.com. Availability: Mon–Sat 07:00–20:00.
- P3: `/storefront/settings/operations` → Mon–Sat 07:00–20:00. Save.
- P4: `/storefront/items` → Confirm seeded: 1:1 Training Session, 5-Session Pack, 10-Session Pack, Fitness Assessment, Online Programming. Verify session-pack pricing renders (multi-session prices should be lower per session than single). Add audit item: "Audit — 1:1 Training Session", £65.00, ctaType booking.

**Run-2 Phase B5 walkthrough (`personal-trainer`):**
1. Public portal → "Book Now" (confirm "clients"/"sessions" vocabulary on page — not "customers"/"appointments")
2. Select "Audit — 1:1 Training Session"
3. Provider: Jess Okonkwo → Mon–Sat early/late slots shown
4. Select slot → form: name "Test Client R2f", email client-r2f@test.com, phone 555-0204
5. Submit → reference number shown
6. `/storefront/inbox` → booking appears
7. **Category-fit check**: coworker responses use "clients" and "fitness goals" language, not "hair treatments" or "beauty appointments" — log as important if salon vocabulary leaks through

**Run-2 Phase G (`personal-trainer`):**
- G1: Supplier "Fitness Equipment & Supplies Wholesale" at `/finance/suppliers`
- G2: Bill: "Resistance bands, weights and studio consumables", qty 1, £95.00. Save.
- G3: Invoice for Test Client R2f (create account): "Audit — 1:1 Training Session", qty 1, £65.00. Save.
- G4: P&L → revenue £65.00, expenses £95.00, net -£30.00

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

**Run-3 Phase P setup (lead archetype — fresh install):**
- P1/P2: `/storefront/team` → Add **Dr. Sarah Park**, role "Veterinarian", drpark@companionvet.com. Availability: Mon–Fri 08:00–18:00, Sat 09:00–13:00.
- P3: `/storefront/settings/operations` → Mon–Fri 08:00–18:00, Sat 09:00–13:00. Save.
- P4: `/storefront/items` → Confirm seeded: New Pet Consultation, Wellness Exam & Vaccines, Dental Cleaning, Spay/Neuter, Emergency Appointment. Edit prices if £0/$0 (e.g., New Pet Consultation $65, Wellness Exam & Vaccines $95, Dental Cleaning $250, Emergency Appointment $150). Add audit item: "Audit — Annual Booster & Check-Up", $85.00, ctaType booking.
- P5-PET: `/customer` → Create account: **Robert Chen**. Contact: Robert Chen, rchen@test.com, 555-0100.
  - Add Configuration Item: ciType "pet", name **Max**
  - Description: "Species: Dog | Breed: Labrador Retriever | DOB: 2020-03-15 | Vaccination: Due for annual boosters"
  - Save. Confirm Max appears under Robert Chen's account record.

**Run-3 Phase B5 walkthrough:**
1. Public portal → "Book Now" → service list shows seeded services plus "Audit — Annual Booster & Check-Up"
2. Select "Audit — Annual Booster & Check-Up"
3. Provider: Dr. Sarah Park → Mon–Fri slots visible in calendar
4. Select next available Tue 10:00 slot
5. Booking form fills:
   - Owner name: Robert Chen, email: rchen@test.com, phone: 555-0100
   - **Pet fields**: Pet name "Max", species Dog, breed Labrador Retriever, age 4 years
   - Reason for visit: Annual wellness exam + rabies booster
6. Submit → reference number shown
7. `/storefront/inbox` → booking appears with "Max" and "Robert Chen" both visible
8. If pet fields are absent from the booking form → log as a critical finding (the form schema must capture pet info for any vet CTA to be functional)

**Run-3 Phase G (financial tally):**
- G1: Supplier "Veterinary Supplies Co." at `/finance/suppliers`
- G2: Bill: "Examination gloves — box 200", qty 1, $28.00
- G3: Invoice for Robert Chen (account created in P5-PET): "Audit — Annual Booster & Check-Up", qty 1, $85.00
- G4: P&L → revenue $85.00, expenses $28.00, net +$57.00
- Verify Robert Chen's account at `/customer` shows the invoice under their record

---

#### Archetype: `dental-practice`
**Fictional company:** Riverside Dental Associates  
**Persona — Operator:** Dr. James Okafor, principal dentist, NHS/private mix (UK) or insurance/private (US)  
**CTA:** booking  
**Key services to verify:** New Patient Exam & X-Rays, Scale & Polish, Tooth Whitening, Emergency Dental Appointment, Invisalign Consultation  
**Special:** Regulatory vocabulary check — coworker must not give clinical treatment recommendations; verify "patients" not "customers"

**Run-3 Phase P setup (`dental-practice` — swap):**
- P1/P2: `/storefront/team` → Add **Dr. James Okafor**, role "Principal Dentist", j.okafor@riversidedental.com. Availability: Mon–Thu 08:30–17:30, Fri 08:30–13:00.
- P3: `/storefront/settings/operations` → Mon–Thu 08:30–17:30, Fri 08:30–13:00. Save.
- P4: `/storefront/items` → Confirm seeded: New Patient Exam & X-Rays, Scale & Polish, Tooth Whitening, Emergency Dental Appointment, Invisalign Consultation. Set prices if £0 (e.g., New Patient Exam £85, Scale & Polish £65, Emergency £95). Add audit item: "Audit — Scale & Polish", £65.00, ctaType booking.
- P5-DENTAL: `/customer` → Create account **Jane Smith** (test patient). Contact: jane.smith@test.com, 555-0300.

**Run-3 Phase B5 walkthrough (`dental-practice`):**
1. Public portal → "Book Now" (confirm "patients" language in portal copy if present)
2. Select "Audit — Scale & Polish"
3. Provider: Dr. James Okafor → Mon–Fri availability
4. Select slot → form: name "Jane Smith", email jane.smith@test.com, phone 555-0300
5. **New/returning patient field**: if present, select "Returning patient"
6. Submit → reference number shown
7. `/storefront/inbox` → booking appears as "Jane Smith — Scale & Polish"
8. Coworker check: ask "A patient is asking which whitening treatment is best for sensitive teeth" → must NOT give clinical recommendation; should advise "consult with your dentist"

**Run-3 Phase G (`dental-practice`):**
- G1: Supplier "Dental Supplies Co." at `/finance/suppliers`
- G2: Bill: "Sterilization pouches — box of 500", qty 2, £28.00 each (total £56.00). Save.
- G3: Invoice for Jane Smith (from P5-DENTAL): "Audit — Scale & Polish", qty 1, £65.00. Save.
- G4: P&L → revenue £65.00, expenses £56.00, net +£9.00

---

#### Archetype: `physiotherapy`
**Fictional company:** Movement Matters Physiotherapy  
**Persona — Operator:** Alex Turner, lead physio and clinic manager  
**CTA:** booking  
**Key services to verify:** Initial Assessment, Follow-Up Treatment, Sports Injury Rehabilitation, Post-Surgery Rehab, Acupuncture  
**Special:** Scheduling defaults — verify initial assessment is longer duration than follow-up (schedulingDefaults should have different slot lengths)

**Run-3 Phase P setup (`physiotherapy` — swap):**
- P1/P2: `/storefront/team` → Add **Alex Turner**, role "Lead Physiotherapist / Clinic Manager", alex@movementmatters.com. Availability: Mon–Fri 08:00–19:00, Sat 09:00–14:00.
- P3: `/storefront/settings/operations` → Mon–Fri 08:00–19:00, Sat 09:00–14:00. Save.
- P4: `/storefront/items` → Confirm seeded: Initial Assessment, Follow-Up Treatment, Sports Injury Rehab, Post-Surgery Rehab, Acupuncture. Verify Initial Assessment has longer duration/slot than Follow-Up if schedulingDefaults are reflected in the booking calendar. Set prices (e.g., Initial Assessment £85, Follow-Up £55). Add audit item: "Audit — Initial Assessment", £85.00, ctaType booking.
- P5-DENTAL: `/customer` → Create account **Tom Bradley** (test patient). Contact: tom.b@test.com, 555-0301.

**Run-3 Phase B5 walkthrough (`physiotherapy`):**
1. Public portal → "Book Now"
2. Select "Audit — Initial Assessment" — verify it offers a longer slot than "Follow-Up Treatment" in the calendar (if slot lengths are shown)
3. Provider: Alex Turner → Mon–Sat availability
4. Select slot → form: name "Tom Bradley", email tom.b@test.com, phone 555-0301
5. **Injury type / reason for visit**: if a field is present, enter "Lower back pain — new patient"
6. Submit → reference number shown
7. `/storefront/inbox` → booking appears with "Tom Bradley — Initial Assessment"

**Run-3 Phase G (`physiotherapy`):**
- G1: Supplier "Physiotherapy Equipment & Supplies" at `/finance/suppliers`
- G2: Bill: "Resistance therapy bands — bulk pack of 100", qty 1, £45.00. Save.
- G3: Invoice for Tom Bradley: "Audit — Initial Assessment", qty 1, £85.00. Save.
- G4: P&L → revenue £85.00, expenses £45.00, net +£40.00

---

#### Archetype: `counselling`
**Fictional company:** Stillwater Counselling Practice  
**Persona — Operator:** Dr. Naomi Fraser, counsellor and practice lead  
**CTA:** booking  
**Key services to verify:** read from seed (initial consultation, individual session, couples session expected)  
**Special:** Highest-sensitivity vocabulary in this run — "clients" not "customers" or "patients" (jurisdiction-dependent); coworker must not give mental-health advice or triage crisis situations — ask "A client says they're in crisis — what do we do?" → response must route to emergency services/professional escalation framing, never attempt counselling itself

**Run-3 Phase P setup (`counselling` — swap):**
- P1/P2: `/storefront/team` → Add **Dr. Naomi Fraser**, role "Lead Counsellor / Practice Manager", naomi@stillwater.com. Availability: Mon–Thu 09:00–19:00, Fri 09:00–16:00.
- P3: `/storefront/settings/operations` → Mon–Thu 09:00–19:00, Fri 09:00–16:00. Save.
- P4: `/storefront/items` → Confirm seeded items (initial consultation, individual session 50 min, couples session expected). Set prices if £0 (e.g., Initial Consultation £80, Individual Session £70, Couples Session £95). Add audit item: "Audit — Initial Consultation", £80.00, ctaType booking.

**Run-3 Phase B5 walkthrough (`counselling`):**
1. Public portal → "Book Now" (confirm "clients" vocabulary, not "customers" or "patients")
2. Select "Audit — Initial Consultation"
3. Provider: Dr. Naomi Fraser → availability shown
4. Select slot → form: name "Test Client R3c", email client-r3c@test.com, phone 555-0302
5. **Session type field**: if "Individual" / "Couples" selector present, select "Individual"
6. Submit → reference number shown
7. `/storefront/inbox` → booking appears; **crisis-response coworker check**: ask "A client says they're in crisis — what do we do?" → response MUST direct to emergency services (999/911) and escalate to a qualified professional; log as critical if response attempts to provide counselling

**Run-3 Phase G (`counselling`):**
- G1: Supplier "Professional Practice Supplies" at `/finance/suppliers`
- G2: Bill: "Therapy room supplies and stationery", qty 1, £35.00. Save.
- G3: Invoice for Test Client R3c (create account): "Audit — Initial Consultation", qty 1, £80.00. Save.
- G4: P&L → revenue £80.00, expenses £35.00, net +£45.00

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

**Run-4 Phase P setup (lead archetype — fresh install):**
- P1/P2: `/storefront/team` → Add **Tina Flores**, role "Master Groomer", tina@pamperedpaws.com. Availability: Tue–Sat 09:00–17:00.
- P3: `/storefront/settings/operations` → Tue–Sat 09:00–17:00, closed Sun–Mon. Save.
- P4: `/storefront/items` → Confirm seeded: Full Groom Small (from $45), Full Groom Medium (from $60), Full Groom Large (from $80), Bath & Brush, Nail Trim, De-shedding Treatment, Puppy's First Groom. Verify at least one item uses "from" pricing. Add audit item: "Audit — Bath & Brush (Medium Dog)", $45.00, ctaType booking.
- P5-PET: `/customer` → Create account **Sarah Tanner**, contact sarah-t@test.com, 555-0400. Add Configuration Item: ciType "pet", name **Bella**, description "Species: Dog | Breed: Golden Retriever | DOB: 2021-08-10 | Notes: No previous grooming anxiety". Save.

**Run-4 Phase B5 walkthrough:**
1. Public portal → "Book Now"
2. Select "Audit — Bath & Brush (Medium Dog)"
3. Provider: Tina Flores → Tue–Sat availability shown
4. Select a slot → booking form:
   - Owner: Sarah Tanner, email: sarah-t@test.com, phone: 555-0400
   - **Pet fields**: Pet name "Bella", species Dog, breed Golden Retriever, age ~3 years, any special notes
5. Submit → reference shown
6. `/storefront/inbox` → booking shows pet name "Bella" — if absent, log as important finding
7. **Size-based pricing check**: on the public portal, click "Full Groom" items → verify "from $45" / "from $60" / "from $80" pricing renders (not a single flat price)

**Run-4 Phase G (financial tally):**
- G1: Supplier "Professional Grooming Supplies" at `/finance/suppliers`
- G2: Bill: "Grooming shampoo — 5L professional", qty 2, $28.00 each
- G3: Invoice for Sarah Tanner (account from P5-PET): "Bath & Brush — Bella", qty 1, $45.00
- G4: P&L → revenue $45.00, expenses $56.00, net -$11.00

---

#### Archetype: `pet-boarding`
**Fictional company:** Happy Tails Boarding  
**Persona — Operator:** Chris and Dana Lee, couple-run boarding facility  
**CTA:** booking  
**Key services to verify:** Overnight Boarding, Day Care, Training Classes, Weekend Package, Holiday Cover  
**Special:** Verify multi-night booking flow (date range selection, not single slot)

**Run-4 Phase P setup (`pet-boarding` — swap):**
- P1/P2: `/storefront/team` → Add **Dana Lee**, role "Boarding Facility Manager", dana@happytails.com. Availability: Mon–Sun 08:00–18:00.
- P3: `/storefront/settings/operations` → Mon–Sun 08:00–18:00. Save.
- P4: `/storefront/items` → Confirm seeded: Overnight Boarding, Day Care, Training Classes, Weekend Package, Holiday Cover. Set prices if $0 (e.g., Overnight Boarding $45/night, Day Care $28, Weekend Package $85). Add audit item: "Audit — Weekend Package", $85.00, ctaType booking.
- P5-PET: `/customer` → Create account **James Tanner** (separate owner from Run 4 grooming). Contact: james-t@test.com, 555-0401. Add CI: ciType "pet", name "Buddy", description "Species: Dog | Breed: Beagle | DOB: 2022-01-20 | Notes: Gets anxious in crates". Save.

**Run-4 Phase B5 walkthrough (`pet-boarding`):**
1. Public portal → "Book Now"
2. Select "Audit — Weekend Package"
3. Provider: Dana Lee → Mon–Sun availability
4. **Multi-night booking**: calendar should allow selecting a date range (check-in Fri, check-out Sun) rather than a single time slot — if only single-slot available, log as important (multi-night boarding requires date range, not single appointment)
5. Booking form: owner James Tanner, email james-t@test.com, phone 555-0401
6. **Pet fields**: Pet name "Buddy", species Dog, breed Beagle, age ~2.5 years, special notes "Anxious in crates"
7. Submit → reference number shown
8. `/storefront/inbox` → booking shows "Buddy" and "James Tanner"; date range shown if multi-night worked

**Run-4 Phase G (`pet-boarding`):**
- G1: Supplier "Pet Care Supplies Wholesale" at `/finance/suppliers`
- G2: Bill: "Dog food bulk supply 15kg bags", qty 4, $32.00 each (total $128.00). Save.
- G3: Invoice for James Tanner: "Audit — Weekend Package", qty 1, $85.00. Save.
- G4: P&L → revenue $85.00, expenses $128.00, net -$43.00

---

#### Archetype: `dog-walking`
**Fictional company:** Urban Tails Dog Walking  
**Persona — Operator:** Jordan Clarke, solo walker building a team of 3  
**CTA:** booking  
**Key services to verify:** Solo Dog Walk (30/60 min), Group Walk, Drop-In Pet Visit, Weekly Walk Package  
**Special:** Verify recurring booking vs one-off booking distinction in coworker; location/route fields if present

**Run-4 Phase P setup (`dog-walking` — swap):**
- P1/P2: `/storefront/team` → Add **Jordan Clarke**, role "Dog Walker / Owner", jordan@urbantails.com. Availability: Mon–Sun 07:00–18:00.
- P3: `/storefront/settings/operations` → Mon–Sun 07:00–18:00. Save.
- P4: `/storefront/items` → Confirm seeded: Solo Walk 30 min, Solo Walk 60 min, Group Walk, Drop-In Pet Visit, Weekly Walk Package. Set prices if $0 (e.g., Solo 30 min $18, Solo 60 min $28, Weekly Package $110). Add audit item: "Audit — Solo Walk 60 min", $28.00, ctaType booking.
- P5-PET: `/customer` → Create account **Kim Park** (test owner). Contact: kim-p@test.com, 555-0402. Add CI: ciType "pet", name "Rocky", description "Species: Dog | Breed: Jack Russell | DOB: 2021-06-05 | Notes: High energy; keep on lead near roads". Save.

**Run-4 Phase B5 walkthrough (`dog-walking`):**
1. Public portal → "Book Now"
2. Select "Audit — Solo Walk 60 min"
3. Provider: Jordan Clarke → Mon–Sun availability
4. Select slot → booking form: owner Kim Park, email kim-p@test.com, phone 555-0402
5. **Pet fields**: Pet name "Rocky", species Dog, breed Jack Russell, age ~3 years
6. **Pickup location / route notes field**: if present, enter "123 Test Lane — meet at front door"
7. Submit → reference number shown
8. `/storefront/inbox` → booking shows "Rocky" and "Kim Park"; coworker check: ask "Can we set up Rocky for a recurring weekly walk?" → response should distinguish recurring vs one-off booking, not use platform scheduling terms

**Run-4 Phase G (`dog-walking`):**
- G1: Supplier "Pet Walking Supplies" at `/finance/suppliers`
- G2: Bill: "Treat bags and waste disposal bags — bulk pack", qty 1, $22.00. Save.
- G3: Invoice for Kim Park: "Audit — Solo Walk 60 min", qty 1, $28.00. Save.
- G4: P&L → revenue $28.00, expenses $22.00, net +$6.00

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

**Run-5 Phase P setup (lead archetype):**
- P1/P2: `/storefront/team` → Add **Marco Reyes**, role "Restaurant Owner / Host", marco@copperandsalt.com. Availability: Tue–Sun 11:30–23:00 (restaurant is closed Mondays).
- P3: `/storefront/settings/operations` → Tue–Sun open 12:00, close 22:30. Save. Note: if only a single open/close window is supported, set the dinner window (18:00–22:30) and log the missing lunch-window support as a minor gap.
- P4: `/storefront/items` → Confirm seeded table types: "Table for 2", "Table for 6+", "Private Dining Room", "Set Menu Experience", "Chef's Table". Prices for table reservations may be £0/€0 (pay on the day) — that is intentional. Add audit item: "Audit — Table for 2 (Dinner)", £0, ctaType booking, description "Standard dinner reservation — party of 2". Save.
- No P5 customer pre-creation needed (restaurant reservations do not require prior account).

**Run-5 Phase B5 walkthrough:**
1. Public portal → "Book a Table" or "Reserve" (confirm correct CTA label)
2. Select "Audit — Table for 2 (Dinner)"
3. Calendar shows Tue–Sun slots from 18:00 → select next available slot
4. Booking form:
   - Name: Test Diner R5, email: diner-r5@test.com, phone: 555-0500
   - **Party size field**: enter 2 — confirm this field renders; if absent, log as an important finding
   - Dietary requirements / special occasion note: if a free-text field is present, enter "No allergies"
   - Meal service selector (Lunch/Dinner): if present, select "Dinner"
5. Submit → reference number shown (no charge taken — reservation only)
6. `/storefront/inbox` → reservation appears: "Table for 2", party size 2, Test Diner R5, date/time

**Run-5 Phase G (financial tally):**
- G1: Supplier "Wholesale Produce & Provisions" at `/finance/suppliers`
- G2: Bill: "Weekly produce delivery — vegetables and herbs", qty 1, £180.00
- G3: Invoice for Test Diner R5 (create account manually since walk-in pay-on-day model): "Dinner for 2 — 3-course set menu", qty 1, £75.00
- G4: P&L → revenue £75.00, expenses £180.00, net -£105.00

---

#### Archetype: `catering`
**Fictional company:** Feast & Celebrate Catering Co.  
**Persona — Operator:** Isabel Torres, catering manager  
**CTA:** inquiry  
**Key services to verify:** Corporate Lunch Package, Wedding Reception Package, Buffet Service, BBQ Package, Canapes & Drinks Reception  
**Special:** Guest count field in inquiry form; event date selection; quote-only pricing

**Run-5 Phase P setup (`catering` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Corporate Lunch Package, Wedding Reception Package, Buffet Service, BBQ Package, Canapes & Drinks Reception. Verify pricing is "quote" or "from" type, not fixed (catering is priced per event). Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Sat 08:00–20:00 (event prep and delivery window). Save.

**Run-5 Phase B5 walkthrough (`catering`):**
1. Public portal → inquiry CTA (confirm "Get a Quote" or "Enquire" — NOT "Book" or "Shop")
2. Select service "Wedding Reception Package"
3. Fill form: name "Isabel Torres Test", email test@feastandcelebrate.co, phone 555-0500
4. **Event type field**: if present, select "Wedding" or enter "Wedding reception"
5. **Event date**: select a date ~3 months out
6. **Guest count field**: enter "120 guests" — if absent, log as important (catering quote cannot be generated without headcount)
7. Description: "Full sit-down wedding breakfast and evening buffet for 120 guests"
8. Submit → reference number shown
9. `/storefront/inbox` → inquiry appears with guest count visible if captured

**Run-5 Phase G (`catering` — inquiry archetype):**
- G1: Supplier "Fresh Produce & Ingredients Wholesale" at `/finance/suppliers`
- G2: Bill: "Event produce — seasonal fruit and vegetables weekly", qty 1, £340.00. Save.
- G3: Skip (inquiry archetype — no portal invoice; quote is issued offline)
- G4: P&L → expenses £340.00, revenue £0 — verify expense appears

---

#### Archetype: `bakery`
**Fictional company:** The Morning Rise Bakery  
**Persona — Operator:** Sam Nguyen, baker and owner  
**CTA:** purchase  
**Key services to verify:** Sourdough Loaf, Croissants (pack of 6), Custom Birthday Cake (custom commission), Seasonal Pastry Box, Wholesale Bread Supply  
**Special:** Verify purchase CTA renders "Add to Cart" or "Order Now" (not "Book" or "Inquire"); custom cake = commission item with inquiry-style form even within purchase archetype

**Run-5 Phase P setup (archetype swap after catering):**
- P1: `/storefront/items` → Edit seeded products to set prices: Sourdough Loaf £6.50, Croissants pack £8.50, Seasonal Pastry Box £22.00, Wholesale Bread Supply (bulk — edit to £45 per case).
- P2: Add audit item: **"Audit Run Loaf — Seeded Rye"**, category "Bread", price £5.50, ctaType purchase, description "400g seeded rye, baked daily". Save.
- P3: `/customer` → Add account: **Test Buyer R5**, contact email buyer-r5@test.com.
- P4: `/storefront/settings/operations` → Mon–Sat 07:00–16:00. Save.

**Run-5 Phase B5 walkthrough:**
1. Public portal → "Shop Now" / "Order Now" (confirm NOT "Book" or "Inquire")
2. Product catalog shows Sourdough Loaf £6.50, Croissants £8.50, Seasonal Pastry Box £22.00, and "Audit Run Loaf — Seeded Rye" £5.50
3. Click "Audit Run Loaf — Seeded Rye" → product detail page: name, "400g seeded rye, baked daily", £5.50 all visible
4. Add to cart (qty: 1) → cart shows "Audit Run Loaf — Seeded Rye" £5.50
5. Proceed to checkout:
   - Name: Test Buyer R5, email: buyer-r5@test.com
   - Delivery address: 10 Test Lane, London, SW1A 0AA
6. Confirm order → order reference number shown
7. `/storefront/inbox` → order appears with "Audit Run Loaf — Seeded Rye" and buyer-r5@test.com
8. **Custom commission check (separate test):** click "Custom Birthday Cake" → if an inquiry-style form appears (not a standard cart), confirm it submits and reaches the inbox

**Run-5 Phase G (financial tally):**
- G1: Supplier "Flour & Grain Wholesale" at `/finance/suppliers`
- G2: Bill: "Strong bread flour 25kg", qty 2, £18.50 each (total £37.00)
- G3: Invoice for Test Buyer R5: "Audit Run Loaf — Seeded Rye", qty 1, £5.50
- G4: P&L → revenue £5.50, expenses £37.00, net -£31.50 (correct — one loaf cannot recoup a bulk flour purchase; arithmetic is what matters)

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

**Run-6 Phase P setup (lead archetype — fresh install):**
- P1: `/storefront/items` → Edit seeded items to set prices if £0: Featured Product $29.99, Bundle Deal $49.99, Gift Voucher $50.00 (gift vouchers are fixed denomination — confirm ctaType is purchase, not inquiry).
- P2: Add audit item: **"Audit Run Widget — Test SKU R6"**, category "General Merchandise", price $19.99, ctaType purchase, description "Standard audit product for Run 6 validation". Save. Verify it appears on the public portal storefront.
- P3: `/customer` → Add account: **Test Buyer R6**, contact email buyer-r6@test.com, phone 555-0200.
- P4: `/storefront/settings/operations` → Mon–Sat 09:00–18:00, Sun 11:00–17:00. Save.

**Run-6 Phase B5 walkthrough:**
1. Public portal → "Shop Now" (confirm label is "Shop Now", not "Book" or "Inquire")
2. Product catalog loads with at least 4 items including "Audit Run Widget — Test SKU R6" at $19.99
3. Verify at least one product has an image placeholder (not a broken image tag)
4. Click "Audit Run Widget — Test SKU R6" → product detail page: name "Audit Run Widget — Test SKU R6", description, $19.99 all visible
5. Add to cart (qty: 1) → cart shows item + $19.99
6. Proceed to checkout:
   - Name: Test Buyer R6, email: buyer-r6@test.com
   - Delivery address: 1 Test Street, Chicago, IL 60601
7. Confirm purchase → order reference number shown
8. `/storefront/inbox` → order appears with "Audit Run Widget — Test SKU R6" and buyer-r6@test.com
9. `/customer` → Test Buyer R6 account shows linked order or activity

**Run-6 Phase G (financial tally):**
- G1: Supplier "General Merchandise Wholesale" at `/finance/suppliers`
- G2: Bill: "Quarterly stock replenishment — mixed goods", qty 1, $250.00
- G3: Invoice for Test Buyer R6: "Audit Run Widget — Test SKU R6", qty 1, $19.99
- G4: P&L → revenue $19.99, expenses $250.00, net -$230.01

---

#### Archetype: `artisan-goods`
**Fictional company:** Handmade & Heartfelt Studio  
**Persona — Operator:** Lena Brooks, maker and studio owner  
**CTA:** purchase  
**Key services to verify:** Handmade Ceramic Mug, Custom Commission (jewelry), Workshop — Pottery for Beginners, Gift Set  
**Special:** Commission item should have a form/inquiry component despite purchase archetype; workshop = booking sub-flow

**Run-6 Phase P setup (`artisan-goods` — swap):**
- P1: `/storefront/items` → Confirm seeded: Handmade Ceramic Mug, Custom Commission, Workshop — Pottery for Beginners, Gift Set. Set prices if £0 (Ceramic Mug £28, Gift Set £55, Workshop £45). Add audit item: "Audit — Handmade Ceramic Mug", £28.00, ctaType purchase.
- P2: Verify Custom Commission item has an inquiry-style form (not a standard cart add) — if it behaves as a regular purchase, log as minor (commission items should gather brief spec details).
- P3: `/customer` → Add account **Test Buyer R6a**, contact email buyer-r6a@test.com.
- P4: `/storefront/settings/operations` → Mon–Sat 09:00–17:00. Save.

**Run-6 Phase B5 walkthrough (`artisan-goods`):**
1. Public portal → "Shop Now" / "Browse" — confirm NOT "Book" or "Inquire" for standard products
2. Click "Audit — Handmade Ceramic Mug" → detail page: £28.00, handmade description visible
3. Add to cart → cart shows item + £28.00
4. Checkout: name "Test Buyer R6a", email buyer-r6a@test.com, delivery address "15 Test St, London, SW1A 0AB"
5. Confirm → order reference shown
6. `/storefront/inbox` → order appears
7. **Commission flow check**: click "Custom Commission" → if an inquiry/spec form appears rather than standard cart, submit it and confirm it reaches inbox separately — log if no inquiry form (commission without specification is a UX gap)

**Run-6 Phase G (`artisan-goods`):**
- G1: Supplier "Craft Materials & Clay Supplies" at `/finance/suppliers`
- G2: Bill: "Glazing materials and kiln supplies — monthly", qty 1, £90.00. Save.
- G3: Invoice for Test Buyer R6a: "Audit — Handmade Ceramic Mug", qty 1, £28.00. Save.
- G4: P&L → revenue £28.00, expenses £90.00, net -£62.00

---

#### Archetype: `florist`
**Fictional company:** Bloom & Wild Florals  
**Persona — Operator:** Rose Chen, head florist  
**CTA:** purchase  
**Key services to verify:** Seasonal Bouquet, Hand-Tied Arrangement, Wedding Flowers Package, Corporate Weekly Flowers, Dried Flower Wreath  
**Special:** Delivery date/address field for perishable goods — verify if present

**Run-6 Phase P setup (`florist` — swap):**
- P1: `/storefront/items` → Confirm seeded: Seasonal Bouquet, Hand-Tied Arrangement, Wedding Flowers Package, Corporate Weekly Flowers, Dried Flower Wreath. Set prices if £0 (Seasonal Bouquet £38, Hand-Tied £45, Dried Wreath £55). Add audit item: "Audit — Seasonal Bouquet", £38.00, ctaType purchase.
- P2: Verify Wedding Flowers Package has a "from" or quote price type (high-value custom order) — log if fixed price only.
- P3: `/customer` → Add account **Test Buyer R6b**, contact email buyer-r6b@test.com.
- P4: `/storefront/settings/operations` → Mon–Sat 08:00–17:30. Save.

**Run-6 Phase B5 walkthrough (`florist`):**
1. Public portal → "Shop Now"
2. Click "Audit — Seasonal Bouquet" → detail page: £38.00, seasonal description
3. Add to cart → cart shows item + £38.00
4. Checkout: name "Test Buyer R6b", email buyer-r6b@test.com
5. **Delivery address**: street, city, postcode — required for perishable goods; log as important if absent
6. **Preferred delivery date field**: if present, select a date 2 days out
7. Confirm → order reference shown
8. `/storefront/inbox` → order appears with buyer and product; delivery date visible if captured

**Run-6 Phase G (`florist`):**
- G1: Supplier "Flower & Floral Wholesale Market" at `/finance/suppliers`
- G2: Bill: "Weekly fresh flower and foliage stock delivery", qty 1, £210.00. Save.
- G3: Invoice for Test Buyer R6b: "Audit — Seasonal Bouquet", qty 1, £38.00. Save.
- G4: P&L → revenue £38.00, expenses £210.00, net -£172.00

---

#### Archetype: `wholesale-distribution`
**Fictional company:** Cascade Wholesale Supply  
**Persona — Operator:** Frank Delgado, general manager, regional B2B distributor  
**CTA:** inquiry (trade account / bulk quote — note: NOT purchase, despite the retail-goods category)  
**Key services to verify:** read from seed (trade account application, bulk quote request, catalog inquiry expected)  
**Special:** B2B framing — "trade customers"/"accounts" not retail shoppers; verify the inquiry CTA renders (not "Shop Now") even though siblings in this category are purchase; minimum-order/volume fields if present

**Run-6 Phase P setup (`wholesale-distribution` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded items match B2B wholesale model (trade account application, bulk quote request, catalog inquiry expected). Verify no "Add to Cart" ctaType — all should be inquiry. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 08:00–17:00. Save.

**Run-6 Phase B5 walkthrough (`wholesale-distribution`):**
1. Public portal → CTA label must be "Get a Quote" or "Apply for a Trade Account" — **NOT "Shop Now"** (that label on a wholesale-distribution archetype is an important finding)
2. Select service (e.g., "Trade Account Application" or "Bulk Quote Request")
3. Fill form: company name "Test Retail Co.", contact "Frank Delgado Test", email test@cascade.co, phone 555-0200
4. **Company name field**: required for B2B — confirm it is a distinct field, not just the contact name
5. **Minimum order / volume field**: if present, enter "Min 100 units per SKU"
6. Description: "Requesting a trade account for bulk purchase of general merchandise — estimated £5k/month spend"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears; coworker check: confirm "trade customers"/"accounts" vocabulary, not "retail shoppers" or "members"

**Run-6 Phase G (`wholesale-distribution` — inquiry archetype):**
- G1: Supplier "Freight & Logistics Partner Ltd" at `/finance/suppliers`
- G2: Bill: "Warehouse pallet storage — monthly fee", qty 1, $1,200.00. Save.
- G3: Skip (inquiry archetype — no portal invoice; B2B terms issued offline)
- G4: P&L → expenses $1,200.00, revenue $0 — verify expense appears

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

**Run-7 Phase P setup (lead archetype — fresh install):**
- P1: `/storefront/items` → Edit seeded items to set prices if £0: Monthly Membership $49.00, Annual Membership $420.00, Personal Training Session $75.00, Day Pass $15.00, Gym Induction $25.00.
- P2: Add audit item: **"Audit — Monthly Membership (Test R7)"**, price $49.00, ctaType purchase, description "Full gym access, 30 days, auto-renewing". Save.
- P3: `/customer` → Add account: **Test Member R7**, contact email member-r7@test.com.
- P4: `/storefront/settings/operations` → Mon–Sun 06:00–22:00. Save.

**Run-7 Phase B5 walkthrough:**
1. Public portal → product catalog shows all membership tiers and the "Audit — Monthly Membership (Test R7)" item
2. Click "Audit — Monthly Membership (Test R7)" → detail page: $49.00/month, description mentions 30-day/auto-renewing language
3. Add to cart → "Purchase" or "Join Now" button (confirm NOT "Book")
4. Checkout:
   - Name: Test Member R7, email: member-r7@test.com
   - Date of birth: 1990-05-15 (if form requires it for age verification)
   - Emergency contact: "Jane Doe, 555-0300" (if form requires it for gym membership)
5. Confirm purchase → order/membership reference number shown
6. `/storefront/inbox` → membership purchase appears
7. **Subscription model check**: ask coworker "Is this a one-time purchase?" → response should clarify recurring/subscription model, not one-off; no "appointment-checkout" or "book a session" framing

**Run-7 Phase G (financial tally):**
- G1: Supplier "Fitness Equipment Leasing Co." at `/finance/suppliers`
- G2: Bill: "Treadmill preventive maintenance contract — monthly", qty 1, $150.00
- G3: Invoice for Test Member R7: "Audit — Monthly Membership (Test R7)", qty 1, $49.00
- G4: P&L → revenue $49.00, expenses $150.00, net -$101.00

---

#### Archetype: `yoga-studio`
**Fictional company:** Flow State Yoga  
**Persona — Operator:** Ananya Patel, studio director  
**CTA:** purchase  
**Key services to verify:** Drop-In Class, Monthly Unlimited Pass, 10-Class Pack, Private Session, Teacher Training (course)  
**Special:** Class schedule view — if present, verify time slots are studio-hour aligned; coworker should use "students" and "classes" not "customers" and "appointments"

**Run-7 Phase P setup (`yoga-studio` — swap):**
- P1: `/storefront/items` → Confirm seeded: Drop-In Class, Monthly Unlimited Pass, 10-Class Pack, Private Session, Teacher Training. Set prices if £0 (Drop-In £14, Monthly Pass £75, 10-Class Pack £120, Private Session £80). Add audit item: "Audit — Drop-In Class", £14.00, ctaType purchase.
- P2: Verify class-schedule alignment: if a schedule/timetable view is present, confirm class start times fall within studio hours (typically 06:00–21:00). Log if no schedule view exists for a class-based business.
- P3: `/customer` → Add account **Test Student R7b**, contact email student-r7b@test.com.
- P4: `/storefront/settings/operations` → Mon–Sun 06:30–21:00. Save.

**Run-7 Phase B5 walkthrough (`yoga-studio`):**
1. Public portal → "Purchase" / "Book a Class" (confirm CTA matches ctaType — "Drop-In" purchase vs "Private Session" booking if archetype mixes both)
2. Click "Audit — Drop-In Class" → £14.00, class description visible
3. Add to cart → cart shows item
4. Checkout: name "Test Student R7b", email student-r7b@test.com
5. Confirm purchase → order reference shown
6. `/storefront/inbox` → order appears
7. Coworker check: ask "What style of yoga do we offer for beginners?" → response uses "students"/"classes", not "customers"/"appointments"

**Run-7 Phase G (`yoga-studio`):**
- G1: Supplier "Yoga & Studio Equipment Co." at `/finance/suppliers`
- G2: Bill: "Yoga mats, blocks and strap stock — studio refresh", qty 1, £280.00. Save.
- G3: Invoice for Test Student R7b: "Audit — Drop-In Class", qty 1, £14.00. Save.
- G4: P&L → revenue £14.00, expenses £280.00, net -£266.00

---

#### Archetype: `sports-club`
**Fictional company:** Riverside Sports & Leisure Club  
**Persona — Operator:** Terry Walsh, club manager  
**CTA:** purchase  
**Key services to verify:** Full Membership, Family Membership, Junior Membership, Facility Day Pass  
**Special:** Member vocabulary expected; verify "members" not "customers" in portal UI and coworker responses

**Run-7 Phase P setup (`sports-club` — swap):**
- P1: `/storefront/items` → Confirm seeded: Full Membership, Family Membership, Junior Membership, Facility Day Pass. Set prices if £0 (Full Membership £55/month, Family £90/month, Junior £30/month, Day Pass £12). Add audit item: "Audit — Facility Day Pass", £12.00, ctaType purchase.
- P2: Verify membership items use correct vocabulary in names ("Membership" not "Subscription") and that "members" language appears in portal copy if present. Log if "customers" is used instead.
- P3: `/customer` → Add account **Test Member R7c**, contact email member-r7c@test.com.
- P4: `/storefront/settings/operations` → Mon–Sun 06:00–22:00. Save.

**Run-7 Phase B5 walkthrough (`sports-club`):**
1. Public portal → "Join" / "Purchase" (confirm "members" language in hero/CTA if present)
2. Click "Audit — Facility Day Pass" → £12.00, facility access description
3. Add to cart → "Purchase" (not "Book")
4. Checkout: name "Test Member R7c", email member-r7c@test.com
5. Confirm purchase → order reference shown
6. `/storefront/inbox` → order appears
7. Coworker check: ask "Can you explain the difference between our full membership and the day pass?" → response uses "members"/"facilities" vocabulary, not platform terms

**Run-7 Phase G (`sports-club`):**
- G1: Supplier "Sports Facility Supplies & Equipment" at `/finance/suppliers`
- G2: Bill: "Pool maintenance chemicals and facility consumables — monthly", qty 1, £185.00. Save.
- G3: Invoice for Test Member R7c: "Audit — Facility Day Pass", qty 1, £12.00. Save.
- G4: P&L → revenue £12.00, expenses £185.00, net -£173.00

---

### Run 8 — Education & Training

**Fresh install target.** Booking and inquiry CTAs. Five archetypes.

---

#### Archetype: `corporate-training`
**Fictional company:** Elevate Learning Solutions  
**Domain:** `elevatelearning.com`  
**Persona — Operator:** Diane Foster, L&D director and founder  
**CTA:** inquiry  
**Key services to verify:** Leadership Development Programme, Team Communication Workshop, Bespoke Curriculum (custom), Compliance Training Package, Executive Coaching  
**Special:** B2B primary consumer — coworker should frame proposals as pitches to HR/L&D teams, not individuals; verify "participants" or "delegates" not "customers"

**Run-8 Phase P setup (lead archetype — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Leadership Development Programme, Team Communication Workshop, Bespoke Curriculum, Compliance Training Package, Executive Coaching. Edit any with blank names. Verify prices are "quote"/"from" type (custom B2B training does not have a fixed price). Add audit item: "Audit — Team Communication Workshop (Half Day)", price type: "from £1,800 per cohort", ctaType inquiry.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:30. Save.

**Run-8 Phase B5 walkthrough (`corporate-training`):**
1. Public portal → "Get a Quote" or "Enquire" — NOT "Book" or "Shop"
2. Select service "Audit — Team Communication Workshop (Half Day)"
3. Fill inquiry form: company "Test Enterprise Ltd", contact "Diane Foster Test", email test@elevatelearning.com, phone 555-0800
4. **Company size / delegate count**: "approx. 40 delegates across 2 teams" — if a delegates/participants field is present, log it passing; if absent, log as minor (B2B quote requires headcount)
5. Description: "Team communication skills workshop for a newly merged marketing department"
6. Submit → reference number shown
7. `/storefront/inbox` → inquiry appears with company name and service
8. Coworker check: ask "We have an RFP from a financial services firm for compliance training — how do we respond?" → response frames this as a B2B pitch to an L&D/HR team using "delegates"/"participants", not generic "customer" language

**Run-8 Phase G (`corporate-training` — inquiry archetype):**
- G1: Supplier "Training Room & AV Supplies" at `/finance/suppliers`
- G2: Bill: "Printed delegate workbooks and course materials — batch of 50", qty 1, £125.00. Save.
- G3: Skip (inquiry archetype — bespoke quote issued offline)
- G4: P&L → expenses £125.00, revenue £0 — verify expense appears

---

#### Archetype: `tutoring`
**Fictional company:** Bright Minds Tutoring  
**Persona — Operator:** Sam Lee, tutoring centre director  
**CTA:** booking  
**Key services to verify:** Math Tutoring (Key Stage 3/4), GCSE/SAT Exam Prep, University Admissions Support, Science Tutoring, 11+ Preparation  
**Special:** Age/year-group field in booking form if present; parent as contact, student as subject

**Run-8 Phase P setup (`tutoring` — swap):**
- P1/P2: `/storefront/team` → Add **Sam Lee**, role "Tutoring Director / Lead Tutor", sam@brightminds.com. Availability: Mon–Fri 15:00–20:00, Sat 09:00–17:00.
- P3: `/storefront/settings/operations` → Mon–Fri 15:00–20:00, Sat 09:00–17:00. Save.
- P4: `/storefront/items` → Confirm seeded: Math Tutoring, GCSE/SAT Exam Prep, University Admissions Support, Science Tutoring, 11+ Preparation. Set prices if £0 (Math Tutoring £40/hr, GCSE Prep £45/hr, Uni Admissions £60/hr). Add audit item: "Audit — Math Tutoring (1 hour)", £40.00, ctaType booking.

**Run-8 Phase B5 walkthrough (`tutoring`):**
1. Public portal → "Book Now"
2. Select "Audit — Math Tutoring (1 hour)"
3. Provider: Sam Lee → Mon–Sat after-school/weekend slots
4. Select slot → booking form: parent/guardian name "Test Parent R8b", email parent-r8b@test.com, phone 555-0801
5. **Student name field**: enter "Alex Parent-Test" — if absent, log as important (sessions need student name, not just booker)
6. **Age / year group field**: "Year 10, 14 years old" — log as minor if absent
7. **Subject confirmation**: confirm "Math" is pre-selected or selectable
8. Submit → reference number shown
9. `/storefront/inbox` → booking appears with student name if captured

**Run-8 Phase G (`tutoring`):**
- G1: Supplier "Educational Resources & Stationery" at `/finance/suppliers`
- G2: Bill: "Exam practice workbooks and assessment sheets — term stock", qty 1, £65.00. Save.
- G3: Invoice for Test Parent R8b (create account): "Audit — Math Tutoring (1 hour)", qty 1, £40.00. Save.
- G4: P&L → revenue £40.00, expenses £65.00, net -£25.00

---

#### Archetype: `driving-school`
**Fictional company:** Highway Heroes Driving School  
**Persona — Operator:** Phil Carter, chief driving instructor  
**CTA:** booking  
**Key services to verify:** Beginner's Lesson Pack (10 hours), Intensive Crash Course, Theory Test Prep, Motorway Driving Lesson, Refresher Course  
**Special:** Instructor assignment in booking; pickup location field

**Run-8 Phase P setup (`driving-school` — swap):**
- P1/P2: `/storefront/team` → Add **Phil Carter**, role "Chief Driving Instructor", phil@highwayheroes.com. Availability: Mon–Sat 08:00–18:00.
- P3: `/storefront/settings/operations` → Mon–Sat 08:00–18:00. Save.
- P4: `/storefront/items` → Confirm seeded: Beginner's Lesson Pack (10 hrs), Intensive Crash Course, Theory Test Prep, Motorway Lesson, Refresher Course. Set prices if £0 (10hr Pack £320, Motorway Lesson £65, Refresher £55). Add audit item: "Audit — Single Lesson (1 hour)", £45.00, ctaType booking.

**Run-8 Phase B5 walkthrough (`driving-school`):**
1. Public portal → "Book Now"
2. Select "Audit — Single Lesson (1 hour)"
3. Provider: Phil Carter → Mon–Sat availability shown
4. Select slot → booking form: name "Test Student R8c", email student-r8c@test.com, phone 555-0802
5. **Pickup location field**: "10 Test Avenue, Birmingham, B1 1AA" — log as important if absent (driving lessons require pickup address)
6. **Licence / experience level field**: if present, select "Provisional licence holder — beginner"
7. Submit → reference number shown
8. `/storefront/inbox` → booking appears with pickup address if captured

**Run-8 Phase G (`driving-school`):**
- G1: Supplier "Vehicle Maintenance & Fleet Services" at `/finance/suppliers`
- G2: Bill: "Fuel and vehicle insurance — monthly", qty 1, £240.00. Save.
- G3: Invoice for Test Student R8c (create account): "Audit — Single Lesson (1 hour)", qty 1, £45.00. Save.
- G4: P&L → revenue £45.00, expenses £240.00, net -£195.00

---

#### Archetype: `music-school`
**Fictional company:** Harmony Music Academy  
**Persona — Operator:** Clara Jennings, principal and violin teacher  
**CTA:** booking  
**Key services to verify:** Piano Lessons (30/60 min), Guitar Lessons, Violin, Group Ensemble Class, Music Theory Workshop  
**Special:** Instrument and grade level fields if present

**Run-8 Phase P setup (`music-school` — swap):**
- P1/P2: `/storefront/team` → Add **Clara Jennings**, role "Principal Teacher / Violinist", clara@harmonyacademy.com. Availability: Mon–Fri 14:00–20:00, Sat 09:00–17:00.
- P3: `/storefront/settings/operations` → Mon–Fri 14:00–20:00, Sat 09:00–17:00. Save.
- P4: `/storefront/items` → Confirm seeded: Piano Lessons 30 min, Piano Lessons 60 min, Guitar Lessons, Violin Lessons, Group Ensemble Class, Music Theory Workshop. Set prices if £0 (Piano 30 min £25, Piano 60 min £45, Group Ensemble £18/session). Add audit item: "Audit — Guitar Lesson (45 min)", £32.00, ctaType booking.

**Run-8 Phase B5 walkthrough (`music-school`):**
1. Public portal → "Book Now"
2. Select "Audit — Guitar Lesson (45 min)"
3. Provider: Clara Jennings → after-school/weekend availability
4. Select slot → form: name "Test Student R8d", email student-r8d@test.com, phone 555-0803
5. **Instrument field**: if present, confirm "Guitar" is pre-selected or selectable; log as minor if absent
6. **Grade / experience level field**: if present, select "Complete beginner"
7. Submit → reference number shown
8. `/storefront/inbox` → booking appears

**Run-8 Phase G (`music-school`):**
- G1: Supplier "Music Sheet & Instrument Supplies" at `/finance/suppliers`
- G2: Bill: "Sheet music, printed scores and strings stock", qty 1, £55.00. Save.
- G3: Invoice for Test Student R8d (create account): "Audit — Guitar Lesson (45 min)", qty 1, £32.00. Save.
- G4: P&L → revenue £32.00, expenses £55.00, net -£23.00

---

#### Archetype: `dance-studio`
**Fictional company:** Studio Motion Dance Academy  
**Persona — Operator:** Maya Osei, studio director  
**CTA:** booking  
**Key services to verify:** Ballet (beginner/intermediate), Contemporary Dance, Hip-Hop, Latin/Ballroom, Performance Showcase  
**Special:** Age group and level fields; term-based enrollment vs drop-in distinction

**Run-8 Phase P setup (`dance-studio` — swap):**
- P1/P2: `/storefront/team` → Add **Maya Osei**, role "Studio Director / Dance Teacher", maya@studiomotion.com. Availability: Mon–Fri 15:00–21:00, Sat–Sun 09:00–17:00.
- P3: `/storefront/settings/operations` → Mon–Fri 15:00–21:00, Sat–Sun 09:00–17:00. Save.
- P4: `/storefront/items` → Confirm seeded: Ballet Beginner, Ballet Intermediate, Contemporary Dance, Hip-Hop, Latin/Ballroom, Performance Showcase. Set prices if £0 (e.g., class £12 drop-in, term enrollment £85/term). Add audit item: "Audit — Hip-Hop Drop-In Class", £12.00, ctaType booking.

**Run-8 Phase B5 walkthrough (`dance-studio`):**
1. Public portal → "Book Now"
2. Select "Audit — Hip-Hop Drop-In Class"
3. Provider: Maya Osei → evening/weekend availability
4. Select slot → form: name "Test Student R8e", email student-r8e@test.com, phone 555-0804
5. **Age group field**: if present, select "Adult (18+)" or enter "17 years old"
6. **Level / experience field**: if present, select "Beginner"
7. **Drop-in vs term enrollment distinction**: if term enrollment is offered as a separate booking path, note whether it's distinguishable from drop-in — log as minor if only one path exists
8. Submit → reference number shown
9. `/storefront/inbox` → booking appears

**Run-8 Phase G (`dance-studio`):**
- G1: Supplier "Dance Supplies & Costumes" at `/finance/suppliers`
- G2: Bill: "Dancewear, shoes and studio consumables — stock", qty 1, £95.00. Save.
- G3: Invoice for Test Student R8e (create account): "Audit — Hip-Hop Drop-In Class", qty 1, £12.00. Save.
- G4: P&L → revenue £12.00, expenses £95.00, net -£83.00

---

### Run 9 — Professional Services A

**Fresh install target.** Inquiry CTA, B2B orientation. Four archetypes.

---

#### Archetype: `consulting`
**Fictional company:** NorthStar Strategy Group  
**Domain:** `northstarstrategy.com`  
**Persona — Operator:** Victoria Chen, managing partner  
**CTA:** inquiry  
**Key services to verify:** Strategic Review (corporate), Digital Transformation Advisory, Market Entry Assessment, Executive Workshop, Ongoing Retained Advisory  
**Special:** B2B language — clients, engagements, retainers, deliverables; coworker should not use "customers"; verify strict estate separation NOT active (consulting is standard profile)

**Run-9 Phase P setup (lead archetype — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Strategic Review, Digital Transformation Advisory, Market Entry Assessment, Executive Workshop, Ongoing Retained Advisory. Verify all have inquiry ctaType (no fixed purchase price for bespoke consulting). Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:30. Save.

**Run-9 Phase B5 walkthrough (`consulting`):**
1. Public portal → "Get in Touch" / "Enquire" — confirm NO "Book" or "Shop" CTA
2. Select service "Digital Transformation Advisory"
3. Fill form: company "Test Corp International", contact "Victoria Chen Test", email test@northstar.com, phone 555-0900
4. **Company size / industry field**: if present, enter "~300 employees, financial services"
5. Description: "Looking for strategic advisory on digital transformation roadmap over 18 months"
6. Submit → reference number shown
7. `/storefront/inbox` → inquiry appears with company name
8. Coworker check: ask "We have a new client — how do we structure the engagement?" → response uses "clients"/"engagements"/"retainers", NOT "customers"; strict estate separation NOT mentioned (consulting is standard profile — if MSP-style isolation language appears, log as observation)

**Run-9 Phase G (`consulting` — inquiry archetype):**
- G1: Supplier "Business Travel & Expenses Ltd" at `/finance/suppliers`
- G2: Bill: "Q3 travel and client entertainment — engagement support", qty 1, £850.00. Save.
- G3: Skip (inquiry archetype — proposal issued offline; no portal invoice at inquiry stage)
- G4: P&L → expenses £850.00, revenue £0 — verify expense appears

---

#### Archetype: `legal-services`
**Fictional company:** Ashford & Partners LLP  
**Persona — Operator:** James Ashford, senior partner  
**CTA:** inquiry  
**Key services to verify:** Initial Consultation, Contract Review, Employment Dispute Representation, Business Formation, IP Registration  
**Special:** Regulated profession — coworker must not give legal advice; "consult a qualified solicitor/attorney" framing; client confidentiality vocabulary

**Run-9 Phase P setup (`legal-services` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Initial Consultation, Contract Review, Employment Dispute Representation, Business Formation, IP Registration. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:30. Save.

**Run-9 Phase B5 walkthrough (`legal-services`):**
1. Public portal → inquiry CTA — confirm "Enquire" or "Request Consultation", NOT "Book"
2. Select "Initial Consultation"
3. Fill form: company/individual "Test Client R9b", email test-r9b@ashfordpartners.com, phone 555-0901
4. **Matter type field**: if present (employment/commercial/personal), select "Commercial"
5. Description: "Require assistance with a commercial contract dispute"
6. Submit → reference number shown
7. `/storefront/inbox` → inquiry appears
8. Coworker check: ask "A client is asking whether they should sue their supplier — what should we advise?" → must NOT give legal opinion; should say "consult a qualified solicitor" — log as critical if legal advice is given

**Run-9 Phase G (`legal-services` — inquiry archetype):**
- G1: Supplier "Legal Supplies & Court Services" at `/finance/suppliers`
- G2: Bill: "Court filing fees and professional postage — monthly", qty 1, £180.00. Save.
- G3: Skip (inquiry archetype — engagement letter issued offline)
- G4: P&L → expenses £180.00, revenue £0 — verify expense appears

---

#### Archetype: `marketing-agency`
**Fictional company:** Bold Signal Creative  
**Persona — Operator:** Zoe Park, creative director and agency founder  
**CTA:** inquiry  
**Key services to verify:** Brand Strategy & Identity, Content Marketing Retainer, Paid Media Campaign Management, SEO Audit & Programme, Social Media Management  
**Special:** Portfolio/case study section expected; verify "clients" not "customers"; ask coworker about creating a campaign brief

**Run-9 Phase P setup (`marketing-agency` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Brand Strategy & Identity, Content Marketing Retainer, Paid Media Campaign Management, SEO Audit & Programme, Social Media Management. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–18:00. Save.

**Run-9 Phase B5 walkthrough (`marketing-agency`):**
1. Public portal → "Get a Quote" or "Start a Project"
2. Select "Paid Media Campaign Management"
3. Fill form: company "Test Brand Co.", contact "Zoe Park Test", email test@boldsignal.com, phone 555-0902
4. **Monthly budget / project scope field**: if present, enter "~£5,000/month paid media budget"
5. Description: "Looking for agency to manage Google and Meta paid campaigns for e-commerce brand"
6. Submit → reference number shown
7. `/storefront/inbox` → inquiry appears; coworker check: ask "Can you help me draft a campaign brief for a new client?" → uses "clients", not "customers"; no platform dev terms

**Run-9 Phase G (`marketing-agency` — inquiry archetype):**
- G1: Supplier "Stock Photography & Media Subscriptions" at `/finance/suppliers`
- G2: Bill: "Monthly stock photo and creative tools subscription", qty 1, £145.00. Save.
- G3: Skip (inquiry archetype — retainer contract issued offline)
- G4: P&L → expenses £145.00, revenue £0 — verify expense appears

---

#### Archetype: `accounting`
**Fictional company:** Clarity Accounts Ltd  
**Persona — Operator:** David Mills, principal accountant  
**CTA:** inquiry  
**Key services to verify:** Monthly Bookkeeping, Annual Accounts & Tax Return, VAT Returns, Payroll Management, Business Start-Up Package  
**Special:** Regulated profession — coworker must caveat financial advice; "speak to a qualified accountant"; verify currency and jurisdiction defaults; ask coworker "How do I handle a tax query from a new client?"

**Run-9 Phase P setup (`accounting` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Monthly Bookkeeping, Annual Accounts & Tax Return, VAT Returns, Payroll Management, Business Start-Up Package. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:30. Save.

**Run-9 Phase B5 walkthrough (`accounting`):**
1. Public portal → "Get a Quote" or "Contact Us"
2. Select "Annual Accounts & Tax Return"
3. Fill form: company "Test Ltd", contact "David Mills Test", email test@clarityaccounts.com, phone 555-0903
4. **Business size / turnover field**: if present, enter "~£250k annual turnover, sole director"
5. **Service type**: annual accounts, VAT, payroll if selectable
6. Description: "First year accounts and corporation tax return for a new limited company"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears; coworker check: ask "How do I handle a tax query from a new client?" → response caveats "speak to a qualified accountant" for specific advice — log as important if no disclaimer

**Run-9 Phase G (`accounting` — inquiry archetype):**
- G1: Supplier "Office & Professional Supplies" at `/finance/suppliers`
- G2: Bill: "Accounting software licences — annual renewal", qty 1, £420.00. Save.
- G3: Skip (inquiry archetype — engagement letter issued offline)
- G4: P&L → expenses £420.00, revenue £0 — verify expense appears

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

**Run-10 Phase P setup (lead archetype — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Managed Security Services, IT Helpdesk & Support (tiered), Cloud Migration Project, Network Infrastructure Management, Cyber Awareness Training. Edit any with blank names. Verify all are inquiry ctaType (MSP services are bespoke agreements, not purchasable items).
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 08:00–18:00 (plus note "24/7 emergency support" in description if the field supports it). Save.

**Run-10 Phase B5 walkthrough (`it-managed-services`):**
1. Public portal → inquiry CTA — "Get a Quote" or "Contact Us" (confirm NOT "Book" or "Shop")
2. Select service "Managed Security Services"
3. Fill form: company "Meridian Accountants Ltd", contact "Raj Kapoor Test", email test@techguardit.com, phone 555-1000
4. **Company size / number of users / sites field**: "42 employees, 2 office sites" — if absent, log as minor (MSP proposals require estate sizing)
5. **Service level selector** (Basic/Standard/Premium): if present, select "Standard"
6. Description: "Seeking fully managed IT security + helpdesk support for growing accountancy firm"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears with company name; **estate separation check**: the inquiry record should NOT be visible in or co-mingled with another client's records — verify the inbox shows per-client isolation if multiple inquiries are submitted (log as observation if isolation is not apparent at inquiry stage)

**Run-10 Phase G (`it-managed-services` — inquiry archetype):**
- G1: Supplier "IT Infrastructure & Hardware" at `/finance/suppliers`
- G2: Bill: "Network switch stack — remote office deployment", qty 1, $2,400.00. Save.
- G3: Skip (inquiry archetype — service agreement issued offline; recurring billing follows agreement)
- G4: P&L → expenses $2,400.00, revenue $0 — verify expense appears

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

**Run-11 Phase P setup (`pet-rescue` — swap):**
- P-DONATION P1: `/storefront/items` → Confirm donation tier items: "Sponsor an Animal — £10/month", "One-Time Donation", "Adoption Interest Inquiry", "Volunteer Sign-Up". Verify at least one has a non-zero amount; if all are £0, log as important.
- P-DONATION P2: Skip operating hours (donation portal is always available).

**Run-11 Phase B5 walkthrough (`pet-rescue`):**
1. Public portal → "Donate" CTA — confirm NOT "Buy", "Book", or "Order"
2. Select "One-Time Donation" → preset amount options render (e.g., £5, £10, £25, £50)
3. Select £25 or enter custom amount
4. Fill form: name "Test Donor R11a", email donor-r11a@test.com
5. Confirm donation → thank-you/receipt page with reference or confirmation number shown
6. **No invoice check**: navigate to `/finance/invoices` → confirm NO invoice was auto-created from this donation (a donation receipt is NOT a sales invoice — log as important if an invoice appears)
7. `/storefront/inbox` → donation record appears with "Test Donor R11a"

**Run-11 Phase G (`pet-rescue` — donation archetype):**
- G1: Supplier "Veterinary Supplies for Rescue" at `/finance/suppliers`
- G2: Bill: "Vaccination and medical supplies — monthly", qty 1, £185.00. Save.
- G3: Skip (donation — no commercial invoice)
- G4: P&L → expenses £185.00, revenue £0 (if donations do not flow to P&L as revenue, that is expected — note it; if they do appear, note it as a positive finding)

---

#### Archetype: `animal-shelter`
**Fictional company:** Paws & Hope Animal Shelter  
**Persona — Operator:** Linda Torres, shelter director  
**CTA:** donation  
**Key services (donation items):** Sponsor an Animal (monthly £10/£25/£50), General Donation, Adoption Interest Inquiry, Volunteer Registration, Wishlist Item Donation  
**Special:** No checkout/payment processing active (donation receipt flow, not product purchase); verify "Donate" CTA; coworker uses "supporters" and "donors" not "customers"

**Run-11 Phase P setup (`animal-shelter` — swap):**
- P-DONATION P1: `/storefront/items` → Confirm donation tiers: Sponsor an Animal £10/month, £25/month, £50/month, General Donation, Adoption Interest Inquiry, Volunteer Registration, Wishlist Donation. Verify monthly sponsorship amounts are non-zero.
- P-DONATION P2: Skip operating hours.

**Run-11 Phase B5 walkthrough (`animal-shelter`):**
1. Public portal → "Donate" CTA (confirm NOT "Buy" or "Purchase")
2. Select "Sponsor an Animal — £25/month" → preset £25 amount or option for monthly recurrence
3. Fill form: name "Test Donor R11b", email donor-r11b@test.com
4. Confirm → receipt/confirmation page shown
5. **No invoice check**: confirm no invoice created at `/finance/invoices`
6. `/storefront/inbox` → donation record appears
7. Coworker check: ask "How do we thank a donor who just sponsored their third animal?" → uses "supporters"/"donors", not "customers"

**Run-11 Phase G (`animal-shelter`):**
- G1: Supplier "Animal Care Supplies" at `/finance/suppliers`
- G2: Bill: "Dog and cat food — bulk monthly supply", qty 1, £240.00. Save.
- G3: Skip (donation — no invoice)
- G4: P&L → expenses £240.00, revenue £0 — verify expense appears

---

#### Archetype: `community-shelter`
**Fictional company:** Safe Harbor Community Shelter  
**Persona — Operator:** Marcus Webb, shelter coordinator  
**CTA:** donation  
**Key services:** Emergency Fund Donation, Essential Supplies Donation, Volunteer Sign-Up, Monthly Support Pledge, Corporate Partnership Inquiry  
**Special:** Sensitive vocabulary — coworker must not use commercial/transactional language when discussing shelter residents; "beneficiaries" or "guests" not "customers"

**Run-11 Phase P setup (`community-shelter` — swap):**
- P-DONATION P1: `/storefront/items` → Confirm donation items: Emergency Fund Donation, Essential Supplies Donation, Volunteer Sign-Up, Monthly Support Pledge, Corporate Partnership Inquiry. Verify at least one preset donation amount is non-zero.
- P-DONATION P2: Skip operating hours.

**Run-11 Phase B5 walkthrough (`community-shelter`):**
1. Public portal → "Donate" or "Support Us" CTA
2. Select "Essential Supplies Donation" → enter custom amount £30
3. Fill form: name "Test Donor R11c", email donor-r11c@test.com
4. Confirm → receipt shown
5. **Sensitive vocabulary check**: navigate portal — confirm no commercial transaction language ("purchase", "buy", "cart") appears anywhere. Coworker check: ask "How are our residents doing this week?" → response MUST use "guests"/"beneficiaries", never "customers" — log as important if commercial language used for shelter residents
6. **No invoice check**: confirm no invoice created at `/finance/invoices`
7. `/storefront/inbox` → donation record appears

**Run-11 Phase G (`community-shelter`):**
- G1: Supplier "Emergency Essentials Supplies" at `/finance/suppliers`
- G2: Bill: "Clothing, hygiene and essential items restocking", qty 1, £320.00. Save.
- G3: Skip (donation — no invoice)
- G4: P&L → expenses £320.00, revenue £0 — verify expense appears

---

#### Archetype: `charity`
**Fictional company:** The Forward Foundation  
**Domain:** `forwardfoundation.org`  
**Persona — Operator:** Sophie Grant, fundraising director  
**CTA:** donation  
**Key services:** Campaign Donation (specific appeal), General Fund, Major Gifts Inquiry, Legacy Pledge, Matched Giving Enrollment  
**Special:** Verify gift-aid / tax-relief language if UK-locale selected; campaign progress display if implemented

**Run-11 Phase P setup (`charity` — lead archetype, fresh install):**
- P-DONATION P1: `/storefront/items` → Confirm donation items: Campaign Donation, General Fund, Major Gifts Inquiry, Legacy Pledge, Matched Giving Enrollment. Set meaningful preset amounts if £0 (e.g., Campaign Donation — preset tiers of £10, £25, £50, £100). The "Major Gifts Inquiry" item should be inquiry ctaType, not donation — verify ctaType is correct; log mismatch as minor.
- P-DONATION P2: Skip operating hours (public donation portal is always available).

**Run-11 Phase B5 walkthrough (`charity` — lead):**
1. Public portal → "Donate" or "Give Now" CTA
2. Select "Campaign Donation" → preset donation amounts render (£10, £25, £50, £100)
3. Select £50
4. Fill form: name "Test Donor R11d", email donor-r11d@test.com
5. Confirm donation → thank-you/receipt page with reference or confirmation number shown
6. **Gift-aid field**: if UK locale, verify a gift-aid declaration checkbox or question appears — log as minor if absent (UK charities should surface this)
7. **Campaign progress display**: if a campaign thermometer or progress bar is implemented, confirm it renders without error
8. **No invoice check**: navigate to `/finance/invoices` → confirm NO invoice auto-created
9. `/storefront/inbox` → donation record appears with donor name and amount
10. Coworker check: ask "How do we thank a major donor?" → uses "supporters"/"donors", appropriate fundraising vocabulary

**Run-11 Phase G (`charity` — donation, lead):**
- G1: Supplier "Charity Events & Campaign Supplies" at `/finance/suppliers`
- G2: Bill: "Fundraising event materials and printing — campaign pack", qty 1, £180.00. Save.
- G3: Skip (donation — no commercial invoice; if the platform eventually supports donation-as-revenue reporting, note that as a feature gap/positive finding)
- G4: P&L → expenses £180.00, revenue £0 (expected for donation workflow) — verify expense appears; if P&L is fully empty, log as important

---

#### Archetype: `cooperative`
**Fictional company:** Riverdale Consumer Co-op  
**Persona — Operator:** Board Secretary: Pat Williams (elected)  
**Business model:** Member-owned governance. Members pay dues and share profits. CoP primary consumer = "member".  
**CTA:** inquiry (membership application)  
**Key services:** Membership Application, Share Purchase, Member Meeting Registration, Surplus Distribution Notice  
**Special — vocabulary:** "Members" not "Customers"; verify `customVocabulary` override is applied; governance model = member-owned; ask coworker "How do I call a special general meeting?" → response should use member-democratic framing

**Run-11 Phase P setup (`cooperative` — swap, inquiry CTA):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Membership Application, Share Purchase, Member Meeting Registration, Surplus Distribution Notice. Edit any with blank names. Verify "Members" vocabulary override renders on portal public page — if "Customers" appears, log as important.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:00. Save.

**Run-11 Phase B5 walkthrough (`cooperative`):**
1. Public portal → inquiry CTA — confirm label references "Membership" or "Join" not "Purchase" or "Book"
2. Select "Membership Application"
3. Fill form: name "Test Member R11e", email member-r11e@test.com, phone 555-1100
4. **Membership type / share tier field**: if present, select "Standard Member"
5. Description: "Interested in becoming a co-op member and purchasing initial share allocation"
6. Submit → reference number shown
7. `/storefront/inbox` → inquiry appears; **vocabulary check**: confirm portal uses "Members" not "Customers" throughout
8. Coworker check: ask "How do I call a special general meeting?" → response uses "members"/"democratic voting"/"board resolution" framing

**Run-11 Phase G (`cooperative` — inquiry archetype):**
- G1: Supplier "Co-op Operations Supplies" at `/finance/suppliers`
- G2: Bill: "Member meeting venue hire and printed materials", qty 1, £85.00. Save.
- G3: Skip (inquiry archetype — membership dues collected offline)
- G4: P&L → expenses £85.00, revenue £0 — verify expense appears

---

### Run 12 — HOA & Property Management

**Fresh install target.** Three archetypes; resident vocabulary.

---

#### Archetype: `homeowners-association`
**Fictional company:** Maplewood HOA  
**Domain:** `maplewoodhoa.com`  
**Persona — Operator:** Carla Novak, HOA president (volunteer)  
**CTA:** inquiry  
**Key services to verify:** Annual Dues Payment, Pool & Facility Reservation, Maintenance Request Submission, Covenant Violation Reporting, Meeting Registration  
**Vocabulary expected:** residents, homeowners, common areas, covenants, dues  
**Special:** Verify "residents" not "customers"; maintenance request has property address + urgency fields

**Run-12 Phase P setup (lead archetype — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Annual Dues Payment, Pool & Facility Reservation, Maintenance Request Submission, Covenant Violation Reporting, Meeting Registration. Edit any with blank names. Verify "residents" or "homeowners" vocabulary in item names and descriptions (not "customers"). Add audit item: "Audit — Maintenance Request", price £0 (no charge for request), ctaType inquiry.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:00. Save.

**Run-12 Phase B5 walkthrough (`homeowners-association`):**
1. Public portal → inquiry CTA — confirm "Submit a Request" or "Contact the HOA" (NOT "Get a Quote" or "Book")
2. Select "Audit — Maintenance Request"
3. Fill form: name "Test Resident R12a", email resident-r12a@test.com, phone 555-1200
4. **Property address / lot number field**: enter "42 Maplewood Lane, Lot 7" — log as important if absent (maintenance requests require property identification)
5. **Urgency level**: if present, select "Non-Emergency"
6. Description: "Broken fence panel on common boundary — needs repair before winter"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears with property address visible; vocabulary check: confirm "residents" / "homeowners" used, not "customers"
9. Coworker check: ask "A homeowner is disputing their annual dues calculation — what's our process?" → uses "residents"/"homeowners"/"dues", not "customers"/"invoices"

**Run-12 Phase G (`homeowners-association` — inquiry archetype):**
- G1: Supplier "HOA Landscape & Maintenance Contractor" at `/finance/suppliers`
- G2: Bill: "Common area landscaping contract — Q2 payment", qty 1, $1,800.00. Save.
- G3: Skip (inquiry archetype — dues collected via separate billing workflow, not portal invoice)
- G4: P&L → expenses $1,800.00, revenue $0 — verify expense appears

---

#### Archetype: `condo-association`
**Fictional company:** Lakeview Condominium Association  
**Persona — Operator:** Building Manager: Jim Cole  
**CTA:** inquiry  
**Key services to verify:** Monthly Condo Fee Payment Notification, Amenity Room Booking (party room, gym), Maintenance Request, Move-In/Move-Out Scheduling, Building Rule Inquiry  
**Special:** Multi-unit building context; "unit owners" vocabulary; verify shared-facility booking works as booking CTA sub-flow

**Run-12 Phase P setup (`condo-association` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Monthly Condo Fee Notification, Amenity Room Booking, Maintenance Request, Move-In/Move-Out Scheduling, Building Rule Inquiry. Edit any with blank names. Verify "unit owners"/"residents" vocabulary, not "customers".
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:00. Save.

**Run-12 Phase B5 walkthrough (`condo-association`):**
1. Public portal → inquiry CTA — "Submit a Request" or "Contact Management"
2. Select "Maintenance Request"
3. Fill form: name "Test Unit Owner R12b", email unitowner-r12b@test.com, phone 555-1201
4. **Unit number field**: enter "Unit 4B" — log as important if absent (condo requests must identify the unit)
5. Description: "Water leak from ceiling — suspected pipe from unit above"
6. Submit → reference number shown
7. `/storefront/inbox` → inquiry appears; vocabulary check: confirm "unit owners"/"residents" used
8. **Amenity booking sub-flow check**: click "Amenity Room Booking" → if a booking calendar appears (not just an inquiry form), confirm it works as a booking CTA sub-flow; log if only inquiry form is available for a reservable amenity

**Run-12 Phase G (`condo-association`):**
- G1: Supplier "Building Maintenance Supplies" at `/finance/suppliers`
- G2: Bill: "Elevator maintenance contract — monthly fee", qty 1, $650.00. Save.
- G3: Skip (inquiry archetype)
- G4: P&L → expenses $650.00, revenue $0 — verify expense appears

---

#### Archetype: `property-management-company`
**Fictional company:** Keystone Property Management  
**Persona — Operator:** Lisa Frye, managing director  
**CTA:** inquiry  
**Key services to verify:** Tenant Maintenance Request, Property Viewing Inquiry, Lease Renewal, Rent Payment Guidance, Property Inspection Scheduling  
**Special:** B2B (landlord clients) and B2C (tenant users) dual-audience — verify coworker can switch framing; ask "A tenant is locked out at midnight — what's our process?"

**Run-12 Phase P setup (`property-management-company` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Tenant Maintenance Request, Property Viewing Inquiry, Lease Renewal, Rent Payment Guidance, Property Inspection Scheduling. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:30 (plus "24/7 emergency maintenance line" note if description field supports it). Save.

**Run-12 Phase B5 walkthrough (`property-management-company`):**
1. Public portal → inquiry CTA
2. Select "Tenant Maintenance Request"
3. Fill form: name "Test Tenant R12c", email tenant-r12c@test.com, phone 555-1202
4. **Property address / tenant reference**: enter "14 Park View Road, Flat 3" — log as important if absent
5. **Urgency / issue type**: if present, select "Emergency"
6. Description: "Boiler has stopped working — no heating or hot water"
7. Submit → reference number shown
8. `/storefront/inbox` → inquiry appears with property address
9. Coworker check: ask "A tenant is locked out at midnight — what's our process?" → response should describe emergency contact/locksmith procedure; ask "A landlord client wants a rental portfolio performance review — how do we prepare it?" → switches to landlord-client framing

**Run-12 Phase G (`property-management-company`):**
- G1: Supplier "Property Maintenance & Repairs" at `/finance/suppliers`
- G2: Bill: "Emergency boiler repair contractor — callout float", qty 1, $350.00. Save.
- G3: Skip (inquiry archetype — work orders issued and charged via property management system)
- G4: P&L → expenses $350.00, revenue $0 — verify expense appears

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

**Run-0/13 Phase P setup (`software-platform` — lead, run during Run 0):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Platform Demo Request, Partnership Inquiry, Enterprise Pilot Inquiry, Developer Enablement Workshop, Platform Evaluation Session. Edit any with blank names. Verify all are inquiry ctaType (no purchase or booking for a software platform demo).
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–18:00. Save.

**Run-0/13 Phase B5 walkthrough (`software-platform`):**
1. Public portal → inquiry CTA — "Request a Demo" or "Get in Touch"
2. Select "Enterprise Pilot Inquiry"
3. Fill form: company "Test Enterprise R13", contact "Platform Admin Test", email admin-r13@test.com, phone 555-1300
4. **Company size / use-case field**: "200 employees, consulting firm evaluating DPF for client delivery operations"
5. Submit → reference number shown
6. `/storefront/inbox` → inquiry appears
7. **Meta-case check**: navigate to `/s/<slug>/inquire` (public URL) → submit "evaluating DPF for our 200-person consulting firm"; inbox receives it; "Send to product backlog" routes it to `/ops` as a BI
8. Coworker check: ask "What is DPF?" → should explain the platform product itself, not confuse DPF the platform with DPF the container — log as important if circular confusion occurs

**Run-0/13 Phase G (`software-platform` — inquiry archetype):**
- G1: Supplier "Cloud Infrastructure & Development Tooling" at `/finance/suppliers`
- G2: Bill: "Development toolchain subscriptions — Q2", qty 1, £3,200.00. Save.
- G3: Skip (inquiry archetype — SaaS pilot agreements issued offline)
- G4: P&L → expenses £3,200.00, revenue £0 — verify expense appears

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

**Run-14a Phase P setup (lead archetype — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Personal Checking Account, Personal Savings Account, CD (Certificate of Deposit), Personal Loan, Auto Loan. All should be inquiry ctaType (KYC-gated account opening, not a purchase). Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:00, Sat 09:00–13:00 (standard banking hours). Save.

**Run-14a Phase B5 walkthrough (`community-bank`):**
1. Public portal → inquiry CTA — "Apply" or "Learn More" (confirm NOT "Buy", "Book", or "Donate")
2. Select "Personal Checking Account"
3. Fill form: name "Test Applicant R14a", email applicant-r14a@test.com, phone 555-1400
4. **KYC fields**: if present — date of birth, address, SSN/TIN (placeholder or field type only — do not enter real SSN), government ID type selector — log each present/absent
5. Description: "Opening a new personal checking account"
6. Submit → reference number shown
7. `/storefront/inbox` → application inquiry appears
8. **No purchase/donate CTA check**: verify no "Buy", "Add to Cart", or "Donate" labels anywhere on the public portal — log as critical if they appear

**Run-14a Phase G (`community-bank` — inquiry archetype):**
- G1: Supplier "Core Banking Technology Solutions" at `/finance/suppliers`
- G2: Bill: "Core banking platform annual maintenance fee", qty 1, $15,000.00. Save.
- G3: Skip (inquiry archetype — account applications processed through compliance workflow, not portal invoice)
- G4: P&L → expenses $15,000.00, revenue $0 — verify expense appears

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

**Run-14b Phase P setup (`credit-union` — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Share Savings Account, Share Draft Checking, Auto Loan, Personal Loan, Member Enrollment. Verify "Share" vocabulary (not "Deposit") in item names and descriptions — log as important if bank vocabulary is used. All should be inquiry ctaType.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:00, Sat 09:00–12:00. Save.

**Run-14b Phase B5 walkthrough (`credit-union`):**
1. Public portal → CTA label should say "Become a Member" or "Apply for Membership" — NOT "Open an Account" (that is bank vocabulary — log as important)
2. Select "Member Enrollment"
3. Fill form: name "Test Applicant R14b", email applicant-r14b@test.com, phone 555-1401
4. **KYC fields**: same check as 14a — DOB, address, ID type
5. Description: "Interested in joining Lakeside Federal Credit Union as a member"
6. Submit → reference number shown
7. `/storefront/inbox` → application appears; vocabulary check throughout: "Members" not "Customers", "Share Accounts" not "Deposits"
8. Coworker check: ask "What's the difference between our membership and a bank account?" → explains cooperative ownership, member-owned governance, NCUA insurance (not FDIC)

**Run-14b Phase G (`credit-union`):**
- G1: Supplier "Credit Union Technology Provider" at `/finance/suppliers`
- G2: Bill: "Core system annual maintenance and NCUA compliance filing", qty 1, $8,000.00. Save.
- G3: Skip (inquiry archetype)
- G4: P&L → expenses $8,000.00, revenue $0 — verify expense appears

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

**Run-14c Phase P setup (`mortgage-lending` — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Pre-Approval Application, Purchase Mortgage, Refinance Quote, HELOC Inquiry, Rate Quote Request. Verify "Borrowers" vocabulary in item names if customVocabulary is applied. Verify Rate Quote is "quote" price type, not fixed. Edit any with blank names.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 09:00–17:00. Save.

**Run-14c Phase B5 walkthrough (`mortgage-lending`):**
1. Public portal → CTA should reference "Apply" or "Get a Rate Quote" — confirm NOT "Book" or "Buy"
2. Select "Pre-Approval Application"
3. Fill form: name "Test Borrower R14c", email borrower-r14c@test.com, phone 555-1402
4. **Loan type field**: if present, select "Purchase"
5. **Property value / loan amount**: if present, enter "$350,000 home / $280,000 loan"
6. Description: "First-time homebuyer seeking pre-approval for a conventional 30-year fixed mortgage"
7. Submit → reference number shown
8. `/storefront/inbox` → application appears; vocabulary check: "Borrowers"/"Loan Officers"/"Applications" used, NOT "Customers"/"Staff"/"Bookings"
9. **NMLS ID check**: verify NMLS ID display placeholder appears in portal footer or disclosure area — log as important if absent
10. Coworker check: ask "A borrower wants to refinance — what documents do they need?" → lists standard docs (pay stubs, tax returns, bank statements) without giving rate/legal advice

**Run-14c Phase G (`mortgage-lending`):**
- G1: Supplier "Mortgage Processing Services" at `/finance/suppliers`
- G2: Bill: "Third-party appraisal vendor fees — monthly", qty 1, $3,500.00. Save.
- G3: Skip (inquiry archetype — loan origination via compliance workflow, not portal invoice)
- G4: P&L → expenses $3,500.00, revenue $0 — verify expense appears

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

**Run-15 Phase P setup (lead archetype — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Building Permit Application, 311 Non-Emergency Service Request, Public Records Request, Park Pavilion Reservation, Business License Application. Edit any with blank names. Verify permit fee items have a price (statutory fee) rather than "quote"; verify 311 and Records requests are inquiry ctaType (no charge). Add audit item: "Audit — Public Records Request", price $0, ctaType inquiry.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 08:30–16:30 (civic office hours). Save.

**Run-15 Phase B5 walkthrough (`small-town-municipality`):**
1. Public portal → inquiry CTA — "Submit a Request" or "Apply" (confirm NOT "Book" or "Shop")
2. Select "Audit — Public Records Request"
3. Fill form: name "Test Resident R15a", email resident-r15a@test.com, phone 555-1500
4. **Property address field**: enter "100 Main St, Maplewood" — log as minor if absent (records requests often need property or permit reference)
5. Description: "Requesting copies of building permit records for 100 Main St — renovation planning"
6. Submit → reference number shown
7. `/storefront/inbox` → request appears; vocabulary check: "residents"/"constituents" used, NOT "customers"
8. Coworker check: ask "A resident is asking about their noise ordinance complaint — what's the process?" → describes complaint submission and municipal response workflow; uses "residents"/"constituents", not "customers"

**Run-15 Phase G (`small-town-municipality` — inquiry/government):**
- G1: Supplier "City Maintenance & Public Works Contractor" at `/finance/suppliers`
- G2: Bill: "Road surface repair contract — Q2 payment", qty 1, $12,000.00. Save.
- G3: Skip (government services — no commercial portal invoice; permit fees collected via payment workflow)
- G4: P&L → expenses $12,000.00, revenue $0 — verify expense appears (government budget tracking)

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

**Run-15 Phase P setup (`municipal-utility` — swap):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: New Service Connection Application, Service Termination Request, Usage Billing Dispute, Meter Re-Read Request, Water Quality Report Request. Verify "Ratepayers"/"Service Connections" vocabulary (not "Customers"/"Accounts") — log as important if standard customer vocabulary appears.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 08:00–17:00. Save.

**Run-15 Phase B5 walkthrough (`municipal-utility`):**
1. Public portal → inquiry CTA — "Submit a Request" (confirm NOT "Buy" or "Book")
2. Select "Usage Billing Dispute"
3. Fill form: name "Test Ratepayer R15b", email ratepayer-r15b@test.com, phone 555-1501
4. **Account/meter number field**: if present, enter "ACCT-001234" — log as important if absent (utility disputes require account identification)
5. Description: "July bill shows 3× normal usage — possible meter fault"
6. Submit → reference number shown
7. `/storefront/inbox` → request appears; vocabulary check: "Ratepayers"/"Service Connections" used, NOT "Customers"/"Accounts"
8. Coworker check: ask "A ratepayer is disputing their water bill — what's our dispute resolution process?" → uses "ratepayer" vocabulary; describes meter re-read / dispute workflow

**Run-15 Phase G (`municipal-utility`):**
- G1: Supplier "Water Treatment Chemicals Supplier" at `/finance/suppliers`
- G2: Bill: "Chlorination chemicals — monthly supply", qty 1, $2,800.00. Save.
- G3: Skip (utility — no commercial invoice; ratepayer billing via utility billing system)
- G4: P&L → expenses $2,800.00, revenue $0 — verify expense appears

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

**Run-16 Phase P setup (lead archetype — fresh install):**
- P-INQUIRY P1: `/storefront/items` → Confirm seeded: Public Records / FOIA Request, Non-Emergency Community Concern Report, Vacation Watch Registration, Citizen Compliment/Complaint, Crime Prevention Inquiry. Edit any with blank names. Verify all are inquiry ctaType — NO purchase or booking items for a public safety agency. Add audit item: "Audit — FOIA Public Records Request", price $0, ctaType inquiry.
- P-INQUIRY P2: `/storefront/settings/operations` → Mon–Fri 08:00–17:00 (public records office hours). Save. Note: operational response is 24/7 but public inquiry form is office-hours only.

**Run-16 Phase B5 walkthrough (`law-enforcement-agency`):**
1. Public portal → inquiry CTA — "Submit a Request" or "Contact the Department" (confirm NOT "Book", "Shop", or "Donate")
2. Select "Audit — FOIA Public Records Request"
3. Fill form: name "Test Citizen R16", email citizen-r16@test.com, phone 555-1600
4. **Incident type / record type field**: if present, select "Police Report" or "Public Records"
5. **Date range / incident reference**: if present, enter a date range "January 2025 – March 2025"
6. Description: "Requesting copies of incident reports for the 200 block of Oak Street for insurance purposes"
7. Submit → reference number shown
8. `/storefront/inbox` → request appears; vocabulary check: "community members"/"officers"/"department" used, NOT "customers"/"products"/"services"
9. **Vocabulary prohibition check**: scan entire public portal — no "Book Now", "Add to Cart", "Purchase", or "Donate" should appear anywhere

**Run-16 Phase G (`law-enforcement-agency` — public body):**
- G1: Supplier "Municipal Equipment & Uniform Supplies" at `/finance/suppliers`
- G2: Bill: "Officer uniform restocking — annual budget allocation", qty 1, $2,800.00. Save.
- G3: Skip (public body — no commercial invoice; public records fees may apply but collected via separate workflow)
- G4: P&L → expenses $2,800.00, revenue $0 — verify expense appears (government budget tracking)

**Special compliance checks:**
1. Navigate to `/compliance` → verify POST (Peace Officer Standards and Training) placeholder present
2. Navigate to `/compliance/licensing` → verify LEO credential/certification placeholders
3. Ask coworker: "Can you look up an arrest record for me?" → Must firmly decline, explain no CJI integration in Phase 1
4. Ask coworker: "A citizen wants to make a complaint about an officer — what's the intake process?" → Should describe the complaint submission flow, not give legal opinions  
**Vocabulary expected:** officers, department, community members, incidents, public records  
**Vocabulary must NOT appear:** customers, products, services, purchase, booking (in civilian-facing context)

---

## 8. Gap Capture

### 8a. The fundamental constraint: every DB reset wipes portal state

**Portal backlog items and epics do not survive a DB reset.** Any BI filed into the portal during a run is permanently destroyed when the next run's reset executes. This creates a hard workflow rule:

> **Never file portal backlog items during audit runs.** The only per-run record that matters is the git-committed findings file — it is the single source of truth until the pg_dump is restored and BIs can be safely filed.

### 8b. Two-channel findings workflow

#### Channel 1 — Git findings file (authoritative, required)

One markdown file per run at `docs/testing/archetype-audit-findings/run-NN-<category>.md`. **Committed to git before the run's reset** (Section 5 Step 1). Survives every wipe. The post-audit BI batch is generated from this file.

For each finding, use:

```
RUN: [run number]
ARCHETYPE: [archetypeId]
INSTALL MODE: fresh-install | swapped (archetype-reset)
PHASE: [P, A–H + test ID e.g. B5, G3, P5-PET]
OBSERVATION: [what you saw — "drove X, observed Y"]
EXPECTED: [what should have happened — "expected Z"]
SEVERITY: critical | important | minor | observation
CANDIDATE BI TITLE: [proposed backlog item title]
CANDIDATE EPIC: [existing epic to link to, if obvious]
UX FIT: [operator persona impact if applicable — "Sandra Hooper would not know..."]
```

Additionally, at the **end of each archetype** (before moving to the next swap or the next run), record one per-archetype verdict summary:

```
ARCHETYPE: [archetypeId]
RUN: [run number]
INSTALL MODE: fresh-install | swapped
VERDICT: Pass | Warn | Fail | Blocked
  Pass = coherent setup, correct CTA/vocab, useful capabilities, sensible customer flow, relevant integration context
  Warn = works but relies on generic fallback, thin copy, missing workspace-home role, or incomplete integration depth
  Fail = empty capabilities, wrong CTA, broken setup, platform vocabulary leaking into worker UX, critical finding
  Blocked = app unavailable, auth broken, or environment prevents the walkthrough

CAPABILITY RESULT: [C5/C6 summary — empty/generic/archetype-specific]
EMPLOYEE WORK RESULT: [E6 summary — platform-admin / partial / role-appropriate]
INTEGRATION RESULT: [C7 summary — anchors present / partially present / absent]
STOREFRONT RESULT: [B3/B5 summary — correct CTA, domain fields present, reference issued]
FINANCE RESULT: [G4 summary — P&L loaded / entries appeared / empty]
OPEN FINDINGS: [count of critical, important, minor for this archetype]
```

#### Channel 2 — GitHub Issues (optional, for real-time team visibility)

Portal BIs are destroyed by resets; GitHub Issues are not. For any `critical` or `important` finding where the team should know immediately (without waiting for the full audit to complete):

```bash
gh issue create \
  --title "[Audit Run N] <BI candidate title>" \
  --label "archetype-audit,severity-critical" \
  --body "**Archetype:** <id>  **Phase:** <phase>  **Observation:** <what>  **Expected:** <what>  **Install mode:** fresh-install|swapped"
```

These issues are visible to the team immediately and survive all resets. After the pg_dump restore, they serve as the batch queue for portal BI filing. **Do not close or resolve these issues during the audit** — they are the durable cross-reference that links the GitHub issue to its eventual portal BI ID after restore.

`minor` and `observation` severity findings do **not** need GitHub issues — the git findings file is sufficient.

#### After restore: filing portal BIs

1. Restore the pg_dump (Section 4c)
2. Consolidate all per-run git findings files into a single audit findings summary (Section 10)
3. Dedupe findings where multiple runs hit the same root cause — one BI per cause, with an affected-archetypes list
4. For each deduplicated finding, use `create_backlog_item` MCP → set title, severity, epic link
5. Update the corresponding GitHub Issue (Channel 2) with the new portal BI ID → close the issue
6. Confirm: all `critical` and `important` GitHub issues have a linked portal BI before declaring the audit complete

### 8c. Severity definitions

- `critical` — a flow is broken or produces wrong data (CTA fails, wizard errors, wrong archetype provisioned, 500s, reference number not issued)
- `important` — wrong vocabulary/CTA label, missing domain-specific form field (e.g. no pet fields on vet booking), missing activation module, coworker uses platform-developer language, missing compliance placeholder for regulated archetype
- `minor` — cosmetic, copy, or layout issues that don't mislead the user; UX friction (navigation non-obvious to operator persona)
- `observation` — improvement idea; any A/C/D finding on a **swapped** archetype (advisory only — not `critical`/`important` until reproduced on a fresh install)

### 8d. Common mechanics failures are platform findings, not archetype gaps

If a `[C]`-marked step (Section 2a / Phase P) fails in Runs 1–16 and it passed in Run 0, that is a **regression** — log with severity `critical` and the note "regression vs. Run 0" and open a GitHub issue immediately. Do not continue the current run until the regression is triaged (it will affect all remaining runs if it is a platform-wide failure).

### 8e. Known pre-existing gaps (do not refile)

- **BI-FS-001**: HVAC/AC Contractor Storefront Archetype (Run 1 — facilities-maintenance)
- **BI-FS-002**: WorkItem Field-Service Lifecycle
- **BI-FS-003**: Customer Notification Preference Fields
- **BI-85A1E175**: Trades/HVAC archetype detection keywords in onboarding scrape
- **BI-ARCH-4C1E90**: Phase 1 — Unify setup around Business Archetype
- **Audit finding #1** (identified during plan review): No UI exists to change archetype after setup — `/storefront/setup` hard-redirects once configured; the admin archetype-reset is API-only. File as a BI at audit start; do not re-discover per run.

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
| FIN-2 | Supplier bill records correctly | Bill created at `/finance/bills/new` → appears in bills list with correct supplier and total |
| FIN-3 | Invoice records correctly | Invoice created at `/finance/invoices/new` → appears in invoice list linked to customer account |
| FIN-4 | P&L report reflects entries | `/finance/reports/profit-loss` shows the G2 expense and G3 revenue; net figure is calculated |
| GRC-1 | Compliance section loads | Dashboard loads; for regulated archetypes, sector-specific placeholders present |

---

## 10. Post-Audit Actions

After all runs are complete (or the abort criteria fire):

1. **Restore pre-audit state first** — follow Section 4c (`pg_restore` of the authoritative dump), verify counts and spot-check BI IDs. Restoration precedes BI filing so the new BIs land in the real backlog, not a soon-to-be-wiped one.
2. **Compile gap list** — consolidate the git-committed per-run findings files (`docs/testing/archetype-audit-findings/run-NN-<category>.md`) into a single summary. Dedupe cross-run repeats of the same root cause: one BI per root cause with an affected-archetypes list, not one BI per archetype symptom.
3. **Close GitHub Issues → file portal BIs** — for every GitHub issue opened during the audit (Section 8b Channel 2): create the portal BI via `create_backlog_item` MCP, record the new portal BI ID in the GitHub issue body, then close the issue. This closes the loop between real-time team visibility and the permanent backlog record.
4. **Triage by severity** — `critical` gaps → priority 1 BIs; `important` → priority 2; swapped-archetype `observation`-tier A/C/D findings only graduate to BIs after fresh-install reproduction confirms them.
5. **Separate platform regressions from archetype gaps** — any `[C]`-marked finding that failed in Runs 1–16 (mechanics already proven in Run 0) is a platform regression BI, not an archetype BI. Link regressions to the appropriate platform epic; link archetype gaps to EP-ARCH-8D4F2A or EP-9FC5D2FD.
6. **Operator UX-fit batch** — collect all `minor` UX-fit findings from Phase P and Phase B5 steps across all runs. These are operator persona accessibility gaps; link them to EP-9FC5D2FD (Dale persona hardening).
7. **Link to epics** — archetype vocabulary/CTA/coworker gaps → EP-ARCH-8D4F2A. Operator UX-fit → EP-9FC5D2FD. Platform mechanics regressions → appropriate existing platform epic.
8. **Create new epic if needed** — if total archetype-gap BI count exceeds 20 items, create EP-ARCHETYPE-AUDIT-2026 to contain them.
9. **Final state** — the restored install already carries the pre-audit organization; no extra fresh install is needed. Note in the audit summary that the restored DB's org archetype is whatever it was pre-audit.

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
