import { describe, expect, it } from "vitest";
import { employeeCountryOfRecord, type CountryOfRecordClient } from "./country-of-record";

function client(rows: unknown[]): CountryOfRecordClient {
  return { employeeAddress: { findMany: async () => rows as never } };
}

function addr(iso2: string, isPrimary: boolean) {
  return { isPrimary, address: { city: { region: { country: { iso2 } } } } };
}

describe("employeeCountryOfRecord", () => {
  it("reads the country off the primary address", async () => {
    const got = await employeeCountryOfRecord(client([addr("US", true), addr("MX", false)]), "emp-1");
    expect(got).toBe("US");
  });

  it("uses a lone address even when nothing is flagged primary", async () => {
    expect(await employeeCountryOfRecord(client([addr("GB", false)]), "emp-1")).toBe("GB");
  });

  it("returns null when several addresses exist and none is primary", async () => {
    // Ambiguous. Picking the first row would pay someone against an arbitrary
    // address; falling back to an unscoped plan is the defensible answer.
    const got = await employeeCountryOfRecord(client([addr("US", false), addr("MX", false)]), "emp-1");
    expect(got).toBeNull();
  });

  it("returns null when several addresses are flagged primary", async () => {
    const got = await employeeCountryOfRecord(client([addr("US", true), addr("MX", true)]), "emp-1");
    expect(got).toBeNull();
  });

  it("returns null when the employee has no addresses at all", async () => {
    expect(await employeeCountryOfRecord(client([]), "emp-1")).toBeNull();
  });

  it("ignores address rows whose reference chain is incomplete", async () => {
    const rows = [{ isPrimary: true, address: null }, addr("MX", false)];
    expect(await employeeCountryOfRecord(client(rows), "emp-1")).toBe("MX");
  });

  it("normalises the stored code", async () => {
    expect(await employeeCountryOfRecord(client([addr(" mx ", true)]), "emp-1")).toBe("MX");
  });
});
