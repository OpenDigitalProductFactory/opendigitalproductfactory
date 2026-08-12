# Human principal backfill collision repair

Backlog coverage: `BI-2BD99239` · capsule `WC-53395A2B`.

## Outcome

Allow the canonical upgrade to apply the immutable human-principal backfill on installs where multiple people share an email label or display name, without deleting or rewriting source identity data.

## Delivery

1. Add a migration ordered immediately before the immutable failing migration. Project each missing `User` and unlinked `EmployeeProfile` by its stable source identifier, and attach linked employees to their user's principal.
2. Add a database regression with duplicate email and display-name fixtures, then execute both the preparation and immutable migration to prove four unique aliases and preserved superuser clearance.
3. Run focused tests, migration/data-impact guards, exact review and governed pregate; merge through the protected queue.
4. Perform one normal self-upgrade, obtain exact `CAN-TEST`, then resume the blocked Restaurant deployment and live seating acceptance.

## Documentation impact

No user-facing workflow changes. The plan and data-impact manifest carry the operational and governance record; platform support documentation needs no new host-specific entry because this is data-shape independent.
