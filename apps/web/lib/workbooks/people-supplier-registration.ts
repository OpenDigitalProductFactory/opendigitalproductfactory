// apps/web/lib/workbooks/people-supplier-registration.ts
//
// Registers the customer / people / supplier generic grids, attaching the governed
// write path where a config needs one (BI-00CB9CCC).
//
// This lives apart from people-supplier-configs.ts on purpose: that module is
// deliberately dependency-light (it imports one type) so the safe-field allow-lists
// stay unit-testable without dragging in Prisma or server actions. Wiring a domain
// action into it would forfeit that. It also lives apart from platform-tables.ts so
// the registry file stays a registry rather than accumulating per-entity write policy.

import { registerGenericReadTable } from "./generic-read-adapter";
import { PEOPLE_SUPPLIER_TABLES } from "./people-supplier-configs";
import { applyEmployeeProfileGridEdit } from "@/lib/actions/workforce";

/**
 * employee_profile is the one config here that must NOT use the generic raw-write
 * tier. EmployeeProfile owns a governed domain action, and every other write to it
 * lands an AuthorizationDecisionLog; a raw adapter write would edit people's records
 * with no audit trail. Attaching `writeThrough` makes a grid edit inherit the same
 * capability check, governance resolution, and audit entry as the form.
 *
 * Supplier keeps the raw-write tier: it has no domain action of its own.
 */
export function registerPeopleSupplierTables(): void {
  for (const cfg of PEOPLE_SUPPLIER_TABLES) {
    registerGenericReadTable(
      cfg.entityType === "employee_profile"
        ? { ...cfg, writeThrough: applyEmployeeProfileGridEdit }
        : cfg,
    );
  }
}
