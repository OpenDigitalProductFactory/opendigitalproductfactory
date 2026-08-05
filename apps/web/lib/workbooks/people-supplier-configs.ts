// Universal Grid & Workbooks — read-only generic grids for customers, people, and
// suppliers (EP-GRID-WORKBOOKS, Phase 2, BI-29E1F452).
//
// These are explicit field ALLOW-LISTS: sensitive fields (compensation, legal
// names beyond display name, personal contact, addresses, tax/bank details) are
// simply not listed, so they can never surface through the grid OR a reference
// lookup. Kept in a dedicated module (importing only the GenericTableConfig type)
// so the allow-lists are unit-testable without the heavy platform-tables chain.

import type { GenericTableConfig } from "./generic-read-adapter";

export const CUSTOMER_ACCOUNT_TABLE: GenericTableConfig = {
  entityType: "customer_account",
  prismaModel: "customerAccount",
  idField: "accountId",
  labelField: "name",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "accountId", name: "ID", fieldType: "text", width: 140 },
    { field: "name", name: "Name", fieldType: "text", width: 240 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "prospect", label: "Prospect" },
        { key: "qualified", label: "Qualified" },
        { key: "onboarding", label: "Onboarding" },
        { key: "active", label: "Active" },
        { key: "at_risk", label: "At risk" },
        { key: "suspended", label: "Suspended" },
        { key: "closed", label: "Closed" },
      ],
    },
    { field: "industry", name: "Industry", fieldType: "text", width: 160 },
    { field: "website", name: "Website", fieldType: "url", width: 200 },
    { field: "employeeCount", name: "Employees", fieldType: "number", width: 110 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

export const EMPLOYEE_PROFILE_TABLE: GenericTableConfig = {
  entityType: "employee_profile",
  prismaModel: "employeeProfile",
  idField: "employeeId",
  labelField: "displayName",
  orderBy: { field: "updatedAt", dir: "desc" },
  // Safe org-directory fields ONLY — no legal names beyond display name, no
  // personal contact, no compensation, no addresses, no termination dates.
  //
  // Editable inline (BI-00CB9CCC), but NOT via the raw-write tier: EmployeeProfile
  // owns a governed domain action, so the write-through is attached at registration
  // (platform-tables.ts) and every grid edit lands an AuthorizationDecisionLog just
  // like the form does.
  //
  // `status` is deliberately excluded. A status change is a lifecycle transition —
  // it is guarded by validateLifecycleTransition and carries EmploymentEvent
  // semantics that a cell edit cannot express. It stays on the lifecycle control.
  editableFields: ["displayName", "workEmail", "timezone", "startDate"],
  columns: [
    { field: "employeeId", name: "ID", fieldType: "text", width: 140 },
    { field: "displayName", name: "Name", fieldType: "text", width: 200 },
    { field: "workEmail", name: "Work email", fieldType: "email", width: 220 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "onboarding", label: "Onboarding" },
        { key: "active", label: "Active" },
        { key: "on_leave", label: "On leave" },
        { key: "offboarding", label: "Offboarding" },
        { key: "terminated", label: "Terminated" },
      ],
    },
    { field: "timezone", name: "Timezone", fieldType: "text", width: 150 },
    { field: "startDate", name: "Start date", fieldType: "date", width: 130 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

export const SUPPLIER_TABLE: GenericTableConfig = {
  entityType: "supplier",
  prismaModel: "supplier",
  idField: "supplierId",
  labelField: "name",
  orderBy: { field: "updatedAt", dir: "desc" },
  // Validated raw-write tier (no bespoke Supplier domain action exists). Editable
  // safe fields only — taxId/bankDetails/address are excluded by omission and so
  // can never be written here either. Each write still goes through validateCell.
  editableFields: ["name", "contactName", "email", "phone", "paymentTerms", "defaultCurrency", "status"],
  // Excludes taxId, bankDetails, address (sensitive) by omission.
  columns: [
    { field: "supplierId", name: "ID", fieldType: "text", width: 140 },
    { field: "name", name: "Name", fieldType: "text", width: 220 },
    { field: "contactName", name: "Contact", fieldType: "text", width: 160 },
    { field: "email", name: "Email", fieldType: "email", width: 200 },
    { field: "phone", name: "Phone", fieldType: "text", width: 140 },
    { field: "paymentTerms", name: "Payment terms", fieldType: "text", width: 130 },
    { field: "defaultCurrency", name: "Currency", fieldType: "text", width: 90 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 120,
      groupable: true,
      options: [
        { key: "active", label: "Active" },
        { key: "inactive", label: "Inactive" },
      ],
    },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

/** All BI-29E1F452 safe read-only grids. */
export const PEOPLE_SUPPLIER_TABLES: GenericTableConfig[] = [
  CUSTOMER_ACCOUNT_TABLE,
  EMPLOYEE_PROFILE_TABLE,
  SUPPLIER_TABLE,
];
