---
status: active
---

# HOA maintenance reports, slice 1: implementation plan (BI-246AC135)

**Design:** [HOA maintenance reports, slice 1](../specs/2026-10-02-hoa-maintenance-reports-design.md)
**Backlog:** `BI-246AC135` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` · workroom `WC-62AA177F`. Absorbs `BI-16040F24` and `BI-6F2883A1`.
**Shape:** large (raised from medium for public intake and personal data).

## Delivery

One PR. The tasks are ordered so each one leaves `main` working, but they ship together because the resident-facing value needs all of them: the queue appears, the form says where, and the status page answers the reference.

### Task 1: HOA and condo activation profiles

- `packages/storefront-templates/src/archetypes/hoa-property-management.ts`: one shared `ASSOCIATION_ACTIVATION` profile for `homeowners-association` and `condo-association`, defined as follows:
  - **Base:** `profileType: "standard"`, `modules: ["service-operations", "billing-readiness", "lifecycle-signals"]`, `billingReadinessMode: "prepared-not-prescribed"`, `customerGraph: "none"`, `estateSeparation: "shared"`.
  - **Axes:** services, physical, member, onsite-plus-portal, recurring-agreement, account-with-billing, no platform, member-owned.
  - **Portfolios:** minimal foundational; standard manufacture-and-deliver with `request-to-fulfill`; minimal for-employees; standard products-and-services.
  - **Overrides:** `service-request-311` required, with an HOA reason; `member-equity` not applicable.
- Test: derivation for both archetypes includes `service-request-311`, `member-governance` and `recurring-agreement-billing`, and excludes `member-equity` (AC-HMR-PROFILE-1).
- Before and after: record the derived capability list in the PR as the convergence note.

### Task 2: references and rate limiting (absorbs BI-6F2883A1 and BI-16040F24)

- `apps/web/lib/storefront/inquiry-reference.ts`: `makeInquiryRef(prefix)` builds Crockford base32 references (`INQ-XXXX-XXXX`, 40 bits). `createWithUniqueRef` retries up to three times on the unique constraint. Booking and order refs keep their own prefixes through the same helper.
- `apps/web/lib/storefront/inquiry-rate-limit.ts`: in-memory sliding windows keyed by `clientAddressKey`:
  - 5 per client per 10 minutes;
  - 200 per storefront per hour;
  - a honeypot field `website` that must be empty. A filled honeypot gets a fake success and no write.
- `submitInquiry` uses both. It reads the client key from `headers()`.
- Tests:
  - reference alphabet and format;
  - collision retry;
  - rate windows;
  - honeypot (AC-HMR-REF-1, AC-HMR-RATE-1).

### Task 3: where, location and "+1"

- The HOA and condo `formSchema` gain an optional `whereText` field ("Where is it?"). The inquiry form gains an optional **Use my location** control on storefronts whose archetype is HOA or condo. It stores `formData.location = { latitude, longitude }`, rounded to four decimals.
- `apps/web/lib/storefront/inquiry-duplicates.ts`:
  - `findNearbyOpenReports(storefrontId, requestType, location)`: open (`new` or `in-progress`), same type, last 30 days, within 30 m by `haversineMeters`.
  - `addSupporter(inquiryId, supporter)`: appends to `formData.supporters`.
- `submitInquiry` accepts `joinRef`. When set and still eligible, it adds the supporter and returns the existing reference. Otherwise it creates a new request.
- The form calls a public `checkNearbyReports` server action (rate-limited) before submitting when a location is present, and offers "+1".
- Tests: distance, type, age and status filters; the supporter append; join flow (AC-HMR-FORM-1, AC-HMR-DUP-1).

### Task 4: public status page

- `apps/web/app/(storefront)/s/[slug]/status/page.tsx`, with `// @exposure public` and a route sync. It reads `ref` and shows only the reference, the request type, the status label and the last-updated date. An unknown reference, or one from another storefront, shows the same "We couldn't find that reference".
- The "received" page links to it.
- Tests: projection shows no personal fields, and the not-found case is uniform (AC-HMR-STATUS-1).

### Task 5: staff queue

- `ServiceRequestRow` gains `whereText`, `mapHref` (when located) and `supporterCount`. The department filter falls back to `requestType`. The panel copy moves to i18n.
- Test: row mapping (AC-HMR-QUEUE-1).

### Task 5a: personal data retention and processing record (design §5.1)

- A scheduled redaction erases the reporter and supporter names, emails and phones, and the location, on HOA and condo requests closed more than 365 days ago. The window is read through the platform retention floors, so it can only grow. The request, its type, "Where is it?" text, status, dates and supporter count remain.
- Declare the new fields in the field-level asset registry.
- The HOA and condo archetypes seed a `DataProcessingActivity` for maintenance reports: purpose `customer-support`, status `review`, proposed bases as in design §5.1, and `residencyConstraints: ["install-local"]`.
- The queue's map link points at the install's own map.
- Tests: redaction leaves open and recent requests alone, erases the listed fields only, and is idempotent; the processing record is seeded once per archetype.

### Task 6: docs, UX fit, gates

- A user guide for resident reports and the status page; the request-queue doc gains HOA.
- UX-fit manifests for the form additions and the status page.
- Route baseline re-freeze where the sweep measures a change.
- Build gate and pregate. UX check on the contributor preview.

## Acceptance (quoted from the design)

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-HMR-PROFILE-1 | OBJ-HMR-QUEUE | `homeowners-association` and `condo-association` declare an activation profile whose derived capabilities include `service-request-311`, `member-governance` and `recurring-agreement-billing`, and exclude `member-equity`. |
| AC-HMR-FORM-1 | OBJ-HMR-REPORT | The HOA and condo maintenance forms accept an optional "Where is it?" text and an optional device location, which is stored rounded to four decimals. |
| AC-HMR-REF-1 | OBJ-HMR-REPORT | New inquiry references use Crockford base32 with no punctuation inside a segment. A reference collision retries rather than failing the submission. |
| AC-HMR-STATUS-1 | OBJ-HMR-SAFE | `/s/[slug]/status?ref=` shows only the reference, type, status and last-updated date, and the same "not found" for an unknown or other-storefront reference. |
| AC-HMR-DUP-1 | OBJ-HMR-REPORT | With a location, an open request of the same type within 30 m from the last 30 days is offered for "+1". Accepting records the supporter on the existing request and returns its reference. |
| AC-HMR-RATE-1 | OBJ-HMR-SAFE | Public inquiry submission refuses over 5 per client per 10 minutes or 200 per storefront per hour, and silently drops honeypot submissions. |
| AC-HMR-QUEUE-1 | OBJ-HMR-QUEUE | The request queue shows "Where is it?", a map link when located, and the supporter count. |

## Traceability

| Acceptance | Task | Evidence |
|---|---|---|
| AC-HMR-PROFILE-1 | Task 1 | derivation test |
| AC-HMR-FORM-1 | Task 3 | form field handling test |
| AC-HMR-REF-1 | Task 2 | reference format test |
| AC-HMR-STATUS-1 | Task 4 | status projection test |
| AC-HMR-DUP-1 | Task 3 | duplicate search test |
| AC-HMR-RATE-1 | Task 2 | rate window test |
| AC-HMR-QUEUE-1 | Task 5 | queue row mapping test |

## Backlog coverage

All tasks map to `BI-246AC135`, delivered atomically. `BI-16040F24` and `BI-6F2883A1` are absorbed and closed when this merges. Follow-ups (photos, reporter levels, verified residency, asset snapping, phone intake) are filed separately and are not covered here.
