---
status: draft
---

# HOA maintenance reports, slice 1: design (BI-246AC135)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-246AC135` (P4a) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | [Geographic footprint, coverage and live overlays](./2026-09-23-geographic-footprint-coverage-and-live-overlays-design.md) §3.3.1, §3.3.3, §9 |
| **Decisions** | Operator, 2026-10-02: ship basic reports now, ahead of the community layout (WWMD `DI-6095D4908751` was a near-tie; the operator chose `slice-web-core`). WWMD `DI-72007BACDB6C`: HOA and condo get the request queue through their own capability override (high confidence). WWMD `DI-29C0041EA64D`: assessments are modelled as recurring agreements (high confidence). |
| **Absorbs** | `BI-16040F24` (no rate limit on public inquiries) and `BI-6F2883A1` (weak inquiry references), because this slice depends on both |
| **Out of scope (follow-ups)** | Photos, which need a private anonymous upload path because `/api/media` serves images publicly by id. Reporter levels (confidential, public guest). Verified residency. Snapping a report to a lot or common asset, which needs the community layout `BI-FE286C27`. Phone intake. |

## 1. Problem

An HOA board or manager needs residents to report problems in the community: a broken light, a fallen branch, a leaking irrigation head. Today:

- The HOA and condo archetypes declare **no activation profile**, so they derive no capabilities. The request queue (`service-request-311`, `/service-requests`) never appears for them, and an association cannot opt into it either. This affects 35 archetypes in all and is filed as `BI-F7317B17`; this item fixes HOA and condo.
- The public "Maintenance Request" form takes name, email, unit/lot number and free text. It has no "where", no reference a resident can check, and no duplicate check, so five reports of one light are five rows.
- The public inquiry action has no rate limit (`BI-16040F24`). Its references can contain `-` and `_` and lose entropy when upper-cased (`BI-6F2883A1`).

## 2. What this slice delivers

1. **HOA and condo activation profiles.** `homeowners-association` and `condo-association` gain an activation profile.
   - **Axes:** services, physical, `primaryConsumer: member`, `onsite-plus-portal`, `commercialModel: recurring-agreement` (assessments), `provisioning: account-with-billing`, `platform: no`, `governance: member-owned`.
   - **Portfolios:** minimal foundational, standard manufacture-and-deliver (`request-to-fulfill`), minimal for-employees, standard products-and-services.
   - **Capability overrides:**
     - `service-request-311` required, with an HOA-specific reason;
     - `member-equity` not applicable, because co-op patronage does not apply to an association.
   - **Derived capabilities** (computed 2026-10-02):
     - customer accounts, member governance, membership eligibility;
     - service agreements, recurring-agreement billing, billing readiness;
     - the request queue;
     - recommended cyber and backup posture;
     - optional point of sale.

   `property-management-company` is a business serving owners. It stays with `BI-F7317B17`.
2. **"Where is it?" on the maintenance form.** The HOA and condo request forms gain:
   - an optional **Where is it?** text field (Open311 `address_string`);
   - an optional **Use my location** button. It asks the browser for the position once and stores it rounded to four decimals, about 11 m. Nothing is sent anywhere else.

   Location is optional because a resident may report from home about something they saw earlier.
3. **A strong public reference and a status page.**
   - References are generated from Crockford base32 (no I, L, O or U, and no punctuation), for example `INQ-7K2M-9QXD`, with a retry on the unique constraint. This fixes `BI-6F2883A1` for every storefront.
   - `/s/[slug]/status?ref=…` shows **only** the reference, the request type, the status (Received, In progress, Closed) and the last-updated date. It shows no name, email, message or location, so a guessed reference reveals nothing personal. This follows Open311's public lookup by `service_request_id`.
4. **Near-duplicate "+1".** When a location is given, the form first checks for open requests of the same type within 30 m from the last 30 days. If any exist, it offers "This looks like a report already open: add yours to it".
   - Accepting adds the reporter to that request (`formData.supporters`: name, email, time) and returns the existing reference.
   - Declining files a new request.

   Distance uses the existing `haversineMeters`.
5. **Rate limiting on public inquiries.** This fixes `BI-16040F24` for every storefront:
   - per client: 5 submissions per 10 minutes;
   - per storefront: 200 per hour;
   - a hidden honeypot field.

   The client key comes from `clientAddressKey`, as the hold route uses. Over the limit, the submitter sees "Too many requests. Please try again in a few minutes."
6. **The staff queue shows what is new.** The request queue groups by the request type (`requestType`) when there is no department. It shows the "Where is it?" text, a map link when a location exists, and "+n" for supporters.

## Objectives and acceptance

- **OBJ-HMR-QUEUE:** HOA and condo associations have the request queue and the capabilities their operating model implies, derived like every other archetype.
- **OBJ-HMR-REPORT:** A resident can say where a problem is, get a reference, check its status without logging in, and join an existing report instead of duplicating it.
- **OBJ-HMR-SAFE:** Public intake resists flooding, and the public status page reveals nothing personal.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-HMR-PROFILE-1 | OBJ-HMR-QUEUE | `homeowners-association` and `condo-association` declare an activation profile whose derived capabilities include `service-request-311`, `member-governance` and `recurring-agreement-billing`, and exclude `member-equity`. |
| AC-HMR-FORM-1 | OBJ-HMR-REPORT | The HOA and condo maintenance forms accept an optional "Where is it?" text and an optional device location, which is stored rounded to four decimals. |
| AC-HMR-REF-1 | OBJ-HMR-REPORT | New inquiry references use Crockford base32 with no punctuation inside a segment. A reference collision retries rather than failing the submission. |
| AC-HMR-STATUS-1 | OBJ-HMR-SAFE | `/s/[slug]/status?ref=` shows only the reference, type, status and last-updated date, and the same "not found" for an unknown or other-storefront reference. |
| AC-HMR-DUP-1 | OBJ-HMR-REPORT | With a location, an open request of the same type within 30 m from the last 30 days is offered for "+1". Accepting records the supporter on the existing request and returns its reference. |
| AC-HMR-RATE-1 | OBJ-HMR-SAFE | Public inquiry submission refuses over 5 per client per 10 minutes or 200 per storefront per hour, and silently drops honeypot submissions. |
| AC-HMR-QUEUE-1 | OBJ-HMR-QUEUE | The request queue shows "Where is it?", a map link when located, and the supporter count. |

## 3. Design choices and their reasons

| Choice | Alternatives rejected | Why |
|---|---|---|
| Ship basic reports before the community layout | Wait for `BI-FE286C27` | Operator decision 2026-10-02: residents get value sooner, and snapping arrives with the layout |
| Archetype capability override | `primaryConsumer: resident`; organization opt-in only | Residents of an HOA are members, not a jurisdiction's residents. Opt-in cannot work without a profile. WWMD `DI-72007BACDB6C` |
| Assessments as `recurring-agreement` | `account-based-fees` | Associations bill recurring assessments under their governing documents. WWMD `DI-29C0041EA64D` |
| Location rounded to about 11 m and stored in `formData` | Raw coordinates; a new location table | Enough for a 30 m duplicate check without storing a resident's exact position. `StorefrontInquiry.formData` already carries structured fields, so no migration is needed. |
| Status page shows no personal data | Show the message | A reference is a bearer token. Open311's public lookup exposes status, not the reporter. |
| Photos deferred | Reuse `/api/media` | It serves images publicly by id and requires a session. A resident's photo needs a private path, which is a follow-up. |

## 4. Research & Benchmarking

- **Open311 GeoReport v2** ([spec, archived](https://webarchive.library.unt.edu/web/20170118233000mp_/http://wiki.open311.org/GeoReport_v2)):
  - A service request must carry a location: `lat` and `long` in WGS84, or `address_string`, or `address_id`. `description`, `email` and `media_url` are optional.
  - Status is `open` or `closed`, with `status_notes`.
  - Clients look up a request publicly by `service_request_id`, with no key.

  DPF adopts the location-or-address rule (both are optional here because residents report from home), a public lookup by reference, and a small status vocabulary. It does not expose an Open311 API endpoint in this slice.
- **SeeClickFix** (parent spec §5): separates anonymous from guest reporting and moderates guest reports. DPF adopts "+1" on near-duplicates and defers reporter levels to a follow-up.
- **AppFolio, Buildium, Vantaca** (parent spec §5): residents submit maintenance requests through a portal or form, and staff track them as work orders. DPF keeps the storefront form as the resident entry point and the request queue as the staff surface.
- **Standards:** WGS84 coordinates (RFC 7946 order in storage), and Crockford base32 for human-readable references.

## 5. Security and privacy

- Rate limiting and a honeypot on every public inquiry (AC-HMR-RATE-1).
- The status page is the only unauthenticated read, and it shows no personal data.
- Location is opt-in, browser-prompted, rounded to about 11 m, and stored only on the request.
- A supporter's name and email are visible only to staff, as the original reporter's are.
- The staff queue keeps its existing permission check. Its status actions stay with the current guard.

## 6. Convergence

Existing HOA and condo installs gain the derived capabilities after self-upgrade. Required capabilities appear in setup and navigation; the organization can disable them, as with any required capability. No data is migrated. The convergence note goes in the PR.

## 7. Verification

- **Unit tests:**
  - derivation for both archetypes (AC-HMR-PROFILE-1);
  - reference format and collision retry;
  - status page projection;
  - duplicate search (distance, type, age, open only) and the "+1" write;
  - rate limiter windows and honeypot;
  - form field handling;
  - queue row mapping.
- **UX:**
  - the HOA maintenance form with and without a location;
  - the "+1" offer;
  - the status page;
  - the queue;
  - light and dark themes and phone width, on the contributor preview.
- **Build gate:** typecheck, affected tests, pregate.

## 8. Documentation impact

- `docs/user-guide/` storefront or customers area: how residents report, check status and "+1", and how staff see reports.
- The HOA archetype guide, if one exists: the capabilities HOA now derives.
