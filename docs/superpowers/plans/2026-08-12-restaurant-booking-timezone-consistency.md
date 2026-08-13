# Restaurant booking timezone consistency

Backlog: BI-EFF5F220  
Capsule: WC-615F9773

## Outcome

Use the operator-pinned Operating Hours timezone for every Restaurant booking
surface and capacity decision. A selected 11:00 America/Chicago reservation
must remain 11:00 on confirmation and in the owner inbox, and an available
table must not be rejected because a legacy storefront default evaluates its
schedule in Europe/London.

## Implementation

1. Introduce one server-side resolver over `BusinessProfile.timezone`, composed
   with the existing pure Operating Hours timezone policy.
2. Route public calendar data, booking confirmation, owner inbox, and discrete
   hospitality capacity enforcement through that resolver.
3. Preserve fail-closed behavior for genuinely unavailable schedules and add a
   regression for the canonical 7:31 PM Chicago seating interval.
4. Run focused tests, guards, typecheck, semantic review, one governed pregate,
   protected PR/merge, normal self-upgrade, and live booking plus host seating
   reconciliation.

## Design grounding

The Operating Hours setting and `resolveOperatingHoursTimezone` are the
existing source of truth. This change removes parallel interpretation; it adds
no UI controls, copy, schema, migration, or visual styling.
