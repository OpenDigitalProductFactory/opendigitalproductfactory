import { describe, it, expect } from "vitest";
import {
  parseDelimitedGrid,
  detectRosterMapping,
  mapRosterToEmployees,
} from "./roster-import";

describe("parseDelimitedGrid", () => {
  it("parses comma-delimited rows, trimming and unquoting", () => {
    const { columns, rows } = parseDelimitedGrid('First, Last ,"Email"\nAda,Lovelace,ada@x.io\n');
    expect(columns).toEqual(["First", "Last", "Email"]);
    expect(rows).toEqual([["Ada", "Lovelace", "ada@x.io"]]);
  });

  it("auto-detects tab delimiter and keeps every row (no 50-row sampling cap)", () => {
    const header = "Name\tEmail";
    const body = Array.from({ length: 75 }, (_, i) => `P${i}\tp${i}@x.io`).join("\n");
    const { columns, rows } = parseDelimitedGrid(`${header}\n${body}`);
    expect(columns).toEqual(["Name", "Email"]);
    expect(rows).toHaveLength(75);
  });

  it("returns empty for blank input", () => {
    expect(parseDelimitedGrid("")).toEqual({ columns: [], rows: [] });
  });
});

describe("detectRosterMapping", () => {
  it("maps standard headers", () => {
    const { mapping } = detectRosterMapping([
      "First Name",
      "Last Name",
      "Work Email",
      "Job Title",
      "Department",
      "Start Date",
    ]);
    expect(mapping).toMatchObject({
      firstName: 0,
      lastName: 1,
      workEmail: 2,
      title: 3,
      department: 4,
      startDate: 5,
    });
  });

  it("resolves synonyms (fname/lname, e-mail, dept, hire date)", () => {
    const { mapping } = detectRosterMapping(["fname", "lname", "e-mail", "dept", "Hire Date"]);
    expect(mapping).toMatchObject({ firstName: 0, lastName: 1, workEmail: 2, department: 3, startDate: 4 });
  });

  it("maps a single Name column to fullName and reports unmapped columns", () => {
    const { mapping, unmappedColumns } = detectRosterMapping(["Name", "Email", "Salary"]);
    expect(mapping.fullName).toBe(0);
    expect(mapping.workEmail).toBe(1);
    expect(unmappedColumns).toEqual(["Salary"]);
  });

  it("claims each column once (first role wins)", () => {
    // "email" should claim workEmail; a later "mail" column must not double-claim it.
    const { mapping } = detectRosterMapping(["email", "mail"]);
    expect(mapping.workEmail).toBe(0);
  });
});

describe("mapRosterToEmployees", () => {
  it("maps a standard roster into proposed employees", () => {
    const { proposed, summary } = mapRosterToEmployees(
      ["First Name", "Last Name", "Work Email", "Job Title", "Department", "Start Date"],
      [["Ada", "Lovelace", "ada@acme.io", "Engineer", "R&D", "2024-03-01"]],
    );
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      workEmail: "ada@acme.io",
      title: "Engineer",
      department: "R&D",
      startDate: "2024-03-01",
      issues: [],
      duplicateInFile: false,
    });
    expect(summary).toContain("1 employee ready");
  });

  it("splits a single full-name column and derives displayName", () => {
    const { proposed } = mapRosterToEmployees(
      ["Name", "Email"],
      [["Grace Brewster Hopper", "grace@navy.mil"], ["Cher", "cher@x.io"]],
    );
    expect(proposed[0]).toMatchObject({ firstName: "Grace", lastName: "Brewster Hopper", displayName: "Grace Brewster Hopper" });
    // single-token name → first only, still a usable displayName
    expect(proposed[1]).toMatchObject({ firstName: "Cher", lastName: "", displayName: "Cher" });
  });

  it("prefers an explicit displayName over derived first+last", () => {
    const { proposed } = mapRosterToEmployees(
      ["First", "Last", "Preferred Name"],
      [["Robert", "Smith", "Bob"]],
    );
    expect(proposed[0]!.displayName).toBe("Bob");
  });

  it("skips rows with no derivable name (counted, not proposed)", () => {
    const { proposed, skippedRows, summary } = mapRosterToEmployees(
      ["First", "Last", "Email"],
      [["Ada", "Lovelace", "ada@x.io"], ["", "", "ghost@x.io"]],
    );
    expect(proposed).toHaveLength(1);
    expect(skippedRows).toBe(1);
    expect(summary).toContain("1 row skipped");
  });

  it("flags duplicate work emails within the file but keeps both rows", () => {
    const { proposed, summary } = mapRosterToEmployees(
      ["Name", "Email"],
      [["A One", "dup@x.io"], ["A Two", "DUP@x.io"]],
    );
    expect(proposed[0]!.duplicateInFile).toBe(false);
    expect(proposed[1]!.duplicateInFile).toBe(true);
    expect(proposed[1]!.issues).toContain("duplicate work email in this file");
    expect(summary).toContain("1 duplicate email");
  });

  it("flags an invalid email and an unparseable start date without dropping the row", () => {
    const { proposed } = mapRosterToEmployees(
      ["Name", "Email", "Start Date"],
      [["Ada Lovelace", "not-an-email", "someday"]],
    );
    expect(proposed[0]!.issues.some((i) => i.includes("email looks invalid"))).toBe(true);
    expect(proposed[0]!.issues.some((i) => i.includes("unrecognized start date"))).toBe(true);
    expect(proposed[0]!.startDate).toBeNull();
  });

  it("leaves optional fields null when their columns are absent", () => {
    const { proposed } = mapRosterToEmployees(["Name"], [["Ada Lovelace"]]);
    expect(proposed[0]).toMatchObject({ workEmail: null, phoneWork: null, title: null, department: null, startDate: null });
  });
});
