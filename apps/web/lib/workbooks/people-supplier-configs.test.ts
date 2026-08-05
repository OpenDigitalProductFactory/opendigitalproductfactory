import { describe, it, expect } from "vitest";
import {
  CUSTOMER_ACCOUNT_TABLE,
  EMPLOYEE_PROFILE_TABLE,
  SUPPLIER_TABLE,
  PEOPLE_SUPPLIER_TABLES,
} from "./people-supplier-configs";

function fields(t: { columns: { field: string }[] }): string[] {
  return t.columns.map((c) => c.field);
}

describe("people/supplier safe read-only grids", () => {
  it("exposes exactly three tables with unique entity types and label fields", () => {
    expect(PEOPLE_SUPPLIER_TABLES.map((t) => t.entityType)).toEqual([
      "customer_account",
      "employee_profile",
      "supplier",
    ]);
    for (const t of PEOPLE_SUPPLIER_TABLES) {
      expect(t.labelField).toBeTruthy();
      // the label + id fields must be in the column allow-list
      expect(fields(t)).toContain(t.idField);
      expect(fields(t)).toContain(t.labelField!);
    }
  });

  it("EMPLOYEE grid omits all compensation/PII fields (allow-list by omission)", () => {
    const FORBIDDEN = [
      "firstName",
      "middleName",
      "lastName",
      "personalEmail",
      "phoneWork",
      "phoneMobile",
      "phoneEmergency",
      "salary",
      "compensation",
      "ssn",
      "nationalId",
      "dateOfBirth",
      "addresses",
      "bankDetails",
      "endDate",
      "userId",
    ];
    const present = fields(EMPLOYEE_PROFILE_TABLE);
    for (const f of FORBIDDEN) expect(present).not.toContain(f);
    // displayName (not legal name parts) is how an employee is shown
    expect(present).toContain("displayName");
  });

  it("SUPPLIER grid omits tax/bank/address fields", () => {
    const present = fields(SUPPLIER_TABLE);
    for (const f of ["taxId", "bankDetails", "address"]) expect(present).not.toContain(f);
  });

  it("CUSTOMER grid omits financial/internal fields", () => {
    const present = fields(CUSTOMER_ACCOUNT_TABLE);
    for (const f of ["annualRevenue", "notes", "sourceSystem", "sourceId"]) {
      expect(present).not.toContain(f);
    }
  });

  it("SUPPLIER editable fields are a safe subset of columns (never id or sensitive)", () => {
    const cols = new Set(fields(SUPPLIER_TABLE));
    const editable = SUPPLIER_TABLE.editableFields ?? [];
    expect(editable.length).toBeGreaterThan(0);
    for (const f of editable) expect(cols.has(f)).toBe(true);
    expect(editable).not.toContain(SUPPLIER_TABLE.idField);
    for (const f of ["taxId", "bankDetails", "address"]) expect(editable).not.toContain(f);
  });

  it("CUSTOMER grid stays read-only (no manage capability exists)", () => {
    expect(CUSTOMER_ACCOUNT_TABLE.editableFields).toBeUndefined();
  });

  // BI-00CB9CCC: the People grid became editable. The allow-list is the safety
  // boundary — it must stay a subset of the already-safe columns, and it must not
  // reach the fields that carry domain rules a cell edit cannot honour.
  it("EMPLOYEE editable fields are a safe subset of columns (never id or sensitive)", () => {
    const cols = new Set(fields(EMPLOYEE_PROFILE_TABLE));
    const editable = EMPLOYEE_PROFILE_TABLE.editableFields ?? [];
    expect(editable.length).toBeGreaterThan(0);
    for (const f of editable) expect(cols.has(f)).toBe(true);
    expect(editable).not.toContain(EMPLOYEE_PROFILE_TABLE.idField);
    for (const f of ["compensation", "nationalId", "dateOfBirth", "bankDetails", "endDate", "userId"]) {
      expect(editable).not.toContain(f);
    }
  });

  it("EMPLOYEE status is not cell-editable — it is a governed lifecycle transition", () => {
    expect(EMPLOYEE_PROFILE_TABLE.editableFields).not.toContain("status");
    // ...but it is still readable/groupable, which is what the board view needs.
    expect(fields(EMPLOYEE_PROFILE_TABLE)).toContain("status");
  });
});
