# Healthcare Care Appointment Engine Implementation Plan

**Backlog item:** BI-HEALTHCARE-010
**Epic:** EP-HEALTHCARE-PRACTICE
**Authority design:** `docs/superpowers/specs/2026-07-15-healthcare-canonical-data-authority-design.md`

## Outcome

Add the healthcare scheduling authority that begins when a practice accepts a
public booking request. The existing `StorefrontBooking` remains the public
request and patient-facing projection. A linked `CareAppointment` becomes the
clinical workflow authority and coordinates the patient, visit type,
practitioners, location, rooms/equipment, preparation and recovery buffers,
status history, recurrence/recall, controlled overbooking, and synchronization
evidence.

This plan does not create a second person, calendar, encounter, document,
ledger, or audit authority.

## Existing substrate to preserve

- `StorefrontBooking` owns the public request, reserved provider slot,
  reschedule lineage, and customer-facing status.
- `BookingHold` owns short-lived public slot holds.
- `ServiceProvider` remains the scheduling projection for a future canonical
  practitioner role.
- `RecurrenceSchedule` is the RFC 5545 recurrence authority.
- `PatientProfile` is the organization-scoped patient role and patient-context
  RLS anchor.
- The existing PostgreSQL exclusion constraint remains authoritative for
  storefront provider-slot contention.

## Phase 1 — Typed scheduling contract and tests

1. Add closed TypeScript catalogs for appointment lifecycle, participant roles,
   FHIR R4 participant response states, resource types, allocation states, sync
   outcomes, and controlled overbooking.
2. Define valid lifecycle transitions:
   `proposed → pending → booked → arrived → fulfilled`, with `cancelled`,
   `no-show`, and `entered-in-error` exception paths.
3. Define a footprint calculator that includes preparation and recovery buffers.
4. Define acceptance and transition validators, including positive duration,
   version preconditions, required overbooking authorization, and immutable
   terminal states.
5. Write failing unit tests before implementation.

## Phase 2 — Tenant-safe persistence

1. Add `organizationId` to `StorefrontBooking` using expand/backfill/contract:
   nullable column, backfill from `StorefrontConfig`, fail loudly if any row
   cannot be resolved, then set `NOT NULL`.
2. Add the composite booking tenant key `(id, organizationId)` without changing
   the existing public booking identifier.
3. Add organization-scoped `CareVisitType`, `CareLocation`, `CareResource`,
   `CareSchedulingPolicy`, and `CareAppointment`.
4. Add organization-scoped appointment practitioner/resource allocations.
   Allocation rows carry the appointment footprint used by PostgreSQL exclusion
   constraints. Ordinary allocations cannot overlap; an explicitly authorized
   overbook allocation is excluded from the hard collision predicate and keeps
   its authorizer and reason.
5. Add append-only `CareAppointmentStatusEvent` and `AppointmentSyncEvent`
   evidence streams, including source and resulting versions.
6. Link recurrence through `RecurrenceSchedule`; reserve an external encounter
   reference only as a synchronization pointer until the canonical Encounter
   model lands under BI-HEALTHCARE-016.
7. Apply composite tenant foreign keys to every patient-bearing relationship.
8. Enable and force patient-context RLS on appointment and child tables.

## Phase 3 — Transactional repository

1. Accept a `StorefrontBooking` idempotently using the unique
   `(organizationId, storefrontBookingId)` relationship.
2. In one transaction:
   - establish organization and patient RLS context;
   - verify booking, patient, visit type, providers, location, resources, and
     scheduling policy belong to the organization;
   - create the appointment and allocations;
   - append the initial status event;
   - append the synchronization outcome.
3. Map PostgreSQL exclusion violations to a typed collision result; never hide
   or overwrite the conflicting allocation.
4. Transition with an optimistic version precondition and append-only status
   evidence.
5. Rescheduling creates a successor appointment and lineage rather than
   rewriting history.

## Phase 4 — Integration and architecture evidence

1. Pass `organizationId` through every existing storefront booking creation
   path without changing public booking behavior.
2. Add Prisma substrate and data-model mirror tests.
3. Classify new PHI-bearing tables at least `restricted`.
4. Verify migration safety, targeted tests, package typecheck, full production
   build, migration application, and exact-SHA merged-code tests in the governed
   `local-integration-ci` environment.
5. Record execution and external-development evidence against
   BI-HEALTHCARE-010 before marking it done.

## Deliberate follow-ons

- Staff receptionist and chairside UI: BI-HEALTHCARE-014.
- Patient self-service appointment projection: BI-HEALTHCARE-013.
- Pre-visit forms and in-room intake: BI-HEALTHCARE-012.
- Canonical Encounter relation and clinical charting: BI-HEALTHCARE-016.
- Practitioner credentialing and payer network participation:
  BI-HEALTHCARE-009 and BI-HEALTHCARE-006.

## Standards alignment

- [HL7 FHIR R4 Appointment](https://hl7.org/fhir/R4/appointment.html) supplies
  the lifecycle and participant-response
  vocabulary, and treats patient, practitioner role, location, and device as
  appointment actors.
- [HL7 FHIR R4 Slot](https://hl7.org/fhir/R4/slot.html) supplies free/busy and
  explicit overbook semantics. DPF
  retains `StorefrontBooking`/`BookingHold` as its public slot authority rather
  than persisting a parallel FHIR-shaped calendar.
- FHIR remains an integration projection; these tables are DPF's relational
  authority and do not duplicate raw FHIR resources.
