---
status: draft
---

# HOA recurring common-area and tree maintenance, slice 1: design (BI-3DA6E1A0)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-3DA6E1A0` (P4c) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | Geographic footprint, coverage and live overlays design, §3.3.4 |
| **Decision** | WWMD `DI-F16F534632CC`: maintained features as site nodes plus recurring work engagements, high confidence, margin 2.52. It beat a new MaintainedFeature + VendorWorkOrder model and beat extending Resource. |
| **Settled earlier (honoured here)** | Layout default is the site-plan underlay (operator and WWMD, 2026-09-25). Vendor access is a signed, per-work-order, expiring, revocable no-login link for the job and a portal account for money (WWMD `link-for-work-portal-for-money`, 2026-09-25, margin 0.85). |
| **Out of scope (follow-ups)** | Slice 2: the vendor's per-work-order link, built to that decision and the W3C capability-URL guidance with its own security review, because the platform's existing reach link is a pointer and grants nothing. Later: a map image on the work order, per-feature photos, budgets and contracts |

## 1. Problem

An association maintains its common areas on schedules. Trees are trimmed yearly in the dormant season. Lawns are mowed weekly in season. Pools are checked twice a week. Ponds, lights, gates and playgrounds have their own cycles. Each job goes to a vendor, who needs to know exactly what is in scope: which trees, which strip of lawn.

DPF has the parts but not the whole:
- **Recurrence:** the one recurrence primitive (`RecurrenceSchedule`) and its occurrence materializer (`apps/web/lib/work-capture/work-engagement.ts`).
- **Drawing:** a scene layout that already stores points and polygons for the customer map (`OperationalSceneLayout`).
- **Vendors:** the `Supplier` record.

Missing: a record for a maintained feature, a link from a recurring job to a vendor, and anything that keeps future occurrences materialized.

## 2. What this slice delivers

1. **Maintained features are site nodes.** `CustomerSiteNode` gains:
   - `maintainedKind`, a new Prisma enum `MaintainedFeatureKind` with the values tree, lawn-zone, landscape-bed, pool, pond, playground, light, gate, fence, irrigation-zone and other. It is null for nodes that are not maintained features.
   - `attributes Json?`, for kind-specific facts such as species and size for a tree. These are attributes, not map layers.

   A community is a customer site, and its features are nodes under it.
2. **Where each feature is.** A feature's point (tree, light, gate) or boundary (lawn zone, pool enclosure, pond) is a placement on the install's territory layout, the one service areas already use, with `entityRef { kind: "maintained-feature", id: nodeId }`. Saving service areas already keeps other features' placements. Drawing reuses the click-to-add-corners interaction of service areas.
3. **Recurring plans.** A maintenance plan for a feature has:
   - a title, such as "Mow" or "Trim";
   - an RFC 5545 rule;
   - a time zone;
   - a start date;
   - an optional supplier.

   It is a parent `WorkEngagement` with a `RecurrenceSchedule` and `subjectRef` set to the node. `WorkEngagement` gains an optional `assignedSupplierId` referencing `Supplier`, which occurrences inherit. The plan editor offers common presets (weekly in season, twice weekly, yearly in a chosen month) and shows the next five dates before saving.
4. **Occurrences keep coming.** A scheduled job runs daily. It calls the existing `materializeRecurringInstances` to keep each active plan's occurrences materialized 60 days ahead. The function is idempotent through the unique `(recurrenceScheduleId, occurrenceAt)` key, so a missed day is caught up. Cancelling or overriding one occurrence uses the existing `exceptionState` and survives re-materialization.
5. **The work order.** Each occurrence has a printable work order, rendered by the document engine (`renderDocument`, PDF). It shows:
   - the community, the feature and its kind;
   - the job and its due date;
   - the supplier;
   - the boundary's corner coordinates, or the point.

   Staff send it to the vendor themselves. Nothing is sent automatically.
6. **The site plan underneath (the default layout).** An administrator uploads the community's site plan or plat as an image through the existing authenticated upload, then pins it by clicking its four corners on the map. The plan is stored as the territory layout's `underlayRef`, with the four corner coordinates, and MapLibre draws it as an image source under the features. It is served from the install's own origin, so the style still fetches nothing from a third party. A community without a plan uses the street map or the plain background, as the customer map already does. The site-plan underlay is the default the earlier decision set, and pinning it to real coordinates keeps every feature usable on the phone and on a vendor's work order. The cartesian renderer is not used, because its placements are fixed-size shapes and its zones are capped at six.
7. **On the customer map and the community page.** The customer map draws maintained features as their own layer, with the shape and a letter for the kind, so kind is never shown by colour alone. The community's site page lists features with their plans, next due date and supplier.

## Objectives and acceptance

- **OBJ-HRM-WHAT:** An association records what it maintains, as points or drawn boundaries on its community, with kind and attributes.
- **OBJ-HRM-WHEN:** Each feature's maintenance recurs on its own schedule and produces dated work assigned to a supplier, without anyone re-entering it.
- **OBJ-HRM-SCOPE:** A vendor gets a work order that states exactly which feature and boundary are in scope.

| Acceptance | Objective | Criterion |
|---|---|---|
| AC-HRM-FEATURE-1 | OBJ-HRM-WHAT | A customer site node with a `maintainedKind` and `attributes` can be created, edited and retired under a community site, and nodes without a kind are unaffected. |
| AC-HRM-UNDERLAY-1 | OBJ-HRM-WHAT | An uploaded site plan pinned by four corners is saved as the territory layout's underlay and drawn under the features from the install's own origin. A community without one keeps the street or plain background. |
| AC-HRM-PLACE-1 | OBJ-HRM-WHAT | A feature's point or boundary is saved as a territory-layout placement with `entityRef.kind` `maintained-feature`, survives a service-area save, and is drawn on the customer map with a kind letter. |
| AC-HRM-PLAN-1 | OBJ-HRM-WHEN | A plan with a valid RRULE, time zone, start and optional supplier is saved as a recurring WorkEngagement for the feature, and the editor shows the next five dates. An invalid rule is refused with the reason. |
| AC-HRM-MATERIALIZE-1 | OBJ-HRM-WHEN | The daily job materializes each active plan's occurrences 60 days ahead, idempotently. A cancelled or overridden occurrence stays so, and each occurrence carries the plan's supplier. |
| AC-HRM-ORDER-1 | OBJ-HRM-SCOPE | An occurrence's work order renders as a PDF naming the community, feature, kind, job, due date, supplier and the boundary corners or point. It is sent only by a staff action. |

## 3. Design choices and their reasons

- **Site nodes, not a new model.** WWMD scored a new MaintainedFeature model and extending Resource below this, on schema grounding and one-home-per-capability. A feature already sits in a community's site hierarchy, and Resource is bookable capacity.
- **A typed kind.** The rulebook makes closed-set strings into enums. The kind is a new nullable column rather than a retyping of the existing free-text `nodeType`, so existing nodes need no migration of their values.
- **Recurrence through the one primitive.** No parallel scheduler. The missing piece was only the job that keeps occurrences materialized.
- **Supplier on the engagement.** The work belongs to the occurrence. The supplier is the existing vendor record; a separate VendorWorkOrder would duplicate the engagement.
- **Vendor link in slice 2, as already decided.** The 2026-09-25 decision stands: a link for the job, a portal for money. The only stateless link in the platform today is explicitly a pointer, not an authorization, so the per-work-order link is built as its own slice with a security review rather than bolted onto it.
- **Site plan pinned onto the one map engine.** The site-plan default holds, and pinning by corners gives every feature real coordinates. That beats drawing on a free-floating image, which the phone and a vendor could not locate.

## 4. Research & Benchmarking

| Product | What it does | DPF adopts / rejects |
|---|---|---|
| **Odoo Maintenance** ([maintenance requests](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/maintenance/maintenance_requests.html)) | Corrective and preventive maintenance requests raised against equipment | **Adopt** dated requests generated per maintained item. DPF expresses recurrence as RFC 5545 rules, so seasonal and weekday patterns (mow weekly May–October) need no custom code |
| **Vantaca** (HOA, parent spec §5) | Work orders to vendors by email, with a portal for payments | **Adopt** staff-sent work orders. **Defer** the vendor link |
| **RFC 5545 RRULE** ([RFC](https://www.rfc-editor.org/rfc/rfc5545)) | The standard recurrence rule | **Adopt** through the existing `RecurrenceSchedule` |

Standards: RFC 5545 for recurrence, IANA time zones for local occurrence times, and GeoJSON RFC 7946 for points and boundaries.

## 5. Security and privacy

- No personal data. Features describe common property. A supplier's contact details stay on the existing `Supplier` record.
- Plans, features and work orders follow the customer-edit capability that already governs service areas. Reads follow the customer-view capability.
- Work orders are prepared, not sent.

## 6. Convergence

One additive migration:
- the `MaintainedFeatureKind` enum;
- two nullable columns on `CustomerSiteNode`;
- one nullable foreign key on `WorkEngagement`.

There is no backfill, and it applies to any data state. The daily job is registered like the other scheduled jobs and is idle with no plans. Everything ships through the canonical self-upgrade.

## 7. Verification

- **Unit tests:**
  - feature create, edit and retire (AC-HRM-FEATURE-1);
  - placement save and coexistence with a service-area save (AC-HRM-PLACE-1);
  - plan validation and next-five preview (AC-HRM-PLAN-1);
  - materialization horizon, idempotence, exceptions and supplier inheritance (AC-HRM-MATERIALIZE-1);
  - work order content (AC-HRM-ORDER-1).
  - site-plan pinning and the style's same-origin rule (AC-HRM-UNDERLAY-1);
- **UX:** on the contributor preview, pin a site plan, draw a lawn zone, add a weekly in-season mowing plan with a supplier, run the job, and open a work order.
- **Migration** applies cleanly.

## 8. Documentation impact

- A new `docs/user-guide/customers/common-area-maintenance.md`.
- The customer map guide gains the maintained features layer.
