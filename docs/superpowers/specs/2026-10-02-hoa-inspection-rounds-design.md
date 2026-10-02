---
status: draft
---

# HOA violation inspection rounds, slice 1: design (BI-1B3DED34)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-1B3DED34` (P4b) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | Geographic footprint, coverage and live overlays design, §3.3.1–§3.3.2 |
| **Decision** | WWMD `DI-36B601BE81BF`: case-first online round, high confidence, margin 1.51. It beat building offline dynamic forms first, and beat new Violation, Round and Rule models. |
| **Depends on** | the phone map (`BI-3DAE2169`, in review) and customer sites geocoded through `Address` (`BI-560128FB`, shipped) |
| **Out of scope (follow-ups)** | Offline rounds and sync (the mutation queue exists but is unused); fines and hearings; per-lot status markers on the map; the dynamic-form camera, signature and location fields (`EP-528CF32A`) |

## 1. Problem

An association's inspector drives or walks the community and records violations: the lot, the rule broken, a photo and a note. A notice then goes to the homeowner with a cure deadline. At the deadline the inspector goes back. The violation is either resolved or escalated.

None of this exists in DPF today:
- There is no violation or inspection work-case source.
- The phone's photo capture is a stub that returns a 1×1 image (`apps/mobile/src/features/job-evidence/imageSource.ts`).
- Nothing links a finding to the association's governing documents.

## 2. What this slice delivers

1. **A governed work-case source, `hoa-violation`.** It is added to the work-case source registry (`apps/web/lib/work-management/source-registry.ts`) with its trigger, transitions, receipt policy, room projection and tool grants. Each violation is a `WorkItem` with `sourceType: "hoa-violation"`, so no new model is added. The finding sits in the item's evidence:
   - the customer site of the lot;
   - the cited rule: a governing document plus section text;
   - a note;
   - photos, each with the time it was taken and the device location rounded to 5 decimals.

   The finding is visible to staff with the work-case capability, never to residents.
2. **Cited rules.** The association's governing documents (CC&Rs, rules and regulations) are ordinary `Document` records tagged `governing-document`. A finding cites one of them and quotes the section. No rules model is added. The citation is stored by document id, version and quoted text, so it stays true after the document changes.
3. **Cure and re-inspection.** Recording a notice sets the case's cure deadline (`dueAt`). It also creates a child `WorkItem` (`parentItemId`), "Re-inspect", due on that date. At re-inspection the inspector records one of two outcomes:
   - **Cured:** both items close.
   - **Not cured:** the case is escalated, with the reason. Escalation is the existing `escalated` status, and fines and hearings are later work.
4. **Homeowner notice.** "Prepare notice" renders a letter through the document engine (`renderDocument`, letter family). The letter names the lot, the rule and its quoted section, the date observed, the photos and the cure deadline. Staff review it and send it themselves. Nothing is sent automatically.
5. **The round on the phone.** A **Round** screen sits in the Expo app's work area and builds on the phone map:
   - The inspector's location is followed on the map. Lots (geocoded customer sites) are listed nearest first, and open violations are marked on each lot by letter.
   - Tapping a lot starts a finding with the rule picker, the camera, a note and **Save**.
   - Real capture through `expo-camera` replaces the stub at `setImageCapture`, so job evidence gets real photos too.
   - Saving uploads the photos and creates the case. It is online only in this slice. Without a connection, Save is disabled and says why.
6. **On the web.** The cases appear in the existing work-case views, with the finding, photos, cited rule, notice and re-inspection.

## Objectives and acceptance

- **OBJ-HIR-CAPTURE:** An inspector records a violation on the phone at the lot, with photo, cited rule, note and location, in one short flow.
- **OBJ-HIR-CURE:** A violation moves from notice through cure deadline to re-inspection, and ends resolved or escalated, on one case.
- **OBJ-HIR-CARE:** Findings, photos and reporters are visible only to staff, and a citation stays true when the rules change.

| Acceptance | Objective | Criterion |
|---|---|---|
| AC-HIR-SOURCE-1 | OBJ-HIR-CURE | `hoa-violation` is a registered work-case source whose items carry the finding in evidence, and no new Prisma model is added. |
| AC-HIR-CITE-1 | OBJ-HIR-CARE | A finding cites a `governing-document` Document by id, version and quoted section, and shows that citation unchanged after the document is revised. |
| AC-HIR-CURE-1 | OBJ-HIR-CURE | Recording a notice sets the case's cure deadline and creates a child re-inspection item due then. Recording Cured closes both; Not cured escalates the case with a reason. |
| AC-HIR-NOTICE-1 | OBJ-HIR-CURE | Prepare notice renders a letter naming the lot, rule and section, date observed and cure deadline. Nothing is sent without a staff action. |
| AC-HIR-PHONE-1 | OBJ-HIR-CAPTURE | The phone Round screen lists lots nearest first from the device position, starts a finding from a lot, and saves a case with real camera photos carrying capture time and rounded location. Save is disabled offline, with the reason shown. |
| AC-HIR-PRIVACY-1 | OBJ-HIR-CARE | Violation cases and their photos are readable only with the work-case capability. No resident-facing route or projection returns them. |

## 3. Design choices and their reasons

- **A work-case source, not a model.** The parent spec and the HOA operations plan both say violations are Work Cases in the `violation` category. The source registry is the governed way to add a case type. It brings transitions, receipts and room projection without a parallel lifecycle.
- **Documents for rules.** Associations already hold their CC&Rs as documents. A rules model would duplicate them and drift from the text the homeowner actually signed.
- **Online first.** Offline rounds need the dynamic-form and sync work. WWMD scored waiting for that well below shipping the online round now, and the offline queue can wrap the same save call later.
- **Notice prepared, not sent.** A notice is an outbound, legally significant act toward a neighbour. Staff send it.

## 4. Research & Benchmarking

| Product | What it does | DPF adopts / rejects |
|---|---|---|
| **Smartwebs Mobile Offline** ([App Store](https://apps.apple.com/us/app/smartwebs-mobile-offline/id823768927)) | Drive-by inspection over a map with one house per lot; Tracking, Recenter, Legend; a "C" marks a violation in cure ([guide](https://solutions.smartwebs.com/en-us/smartwebs-solutions/user-guide-violations-)) | **Adopt** the round over a map with follow-me and lot tap-through. **Defer** offline. **Reject** colour-only status: every marker carries a letter |
| **HOALife** ([inspector guide](https://help.hoalife.com/article/w6nwuyupj0-mobile-inspector-app-user-guide)) | Mobile inspector app that tells a new violation from a previous one, with notes and photos | **Adopt** showing a lot's open violations before a new finding is recorded, so duplicates are avoided |
| **Vantaca** | Separate markers for violations, work orders, architectural requests and closings (parent spec §3.3.2) | **Adopt** the idea, later: per-lot layered markers are a follow-up once cases exist |

Standards: there is no common standard for violation cure workflows. The flow and its timelines come from each association's governing documents and state law, which is why the cure deadline is set per notice and the letter is the association's own template. Photo location follows GeoJSON RFC 7946 coordinate order.

## 5. Security and privacy

- A violation is a dispute between neighbours. Cases, photos and any reporter identity are staff-only (AC-HIR-PRIVACY-1).
- Photo location is rounded to 5 decimals, about 1 m, and is stored only on the photo.
- Notices are prepared, never sent automatically.
- Photos use the existing authenticated upload route, and the phone uses its bearer token.

## 6. Convergence

Code and a registry entry only, with no migration. It reaches existing installs through the canonical self-upgrade. The phone change ships with the next app build.

## 7. Verification

- **Unit tests:**
  - the source entry and its evidence shape (AC-HIR-SOURCE-1);
  - citation pinning (AC-HIR-CITE-1);
  - the notice, cure and escalation transitions (AC-HIR-CURE-1);
  - letter content (AC-HIR-NOTICE-1);
  - the capability check on every read path (AC-HIR-PRIVACY-1);
  - the phone Round screen with the map and camera mocked (AC-HIR-PHONE-1).
- **UX:**
  - on the contributor preview, create a case from the web and follow it through notice and re-inspection;
  - on the iOS simulator, record a finding from the Round screen.

## 8. Documentation impact

- A new `docs/user-guide/customers/violation-inspections.md`.
- The mobile section of the customer map guide gains the Round screen.
