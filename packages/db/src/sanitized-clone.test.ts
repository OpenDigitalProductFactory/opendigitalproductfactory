import { describe, it, expect } from "vitest";
import {
  obfuscateName,
  obfuscateEmail,
  obfuscatePhone,
  obfuscateField,
  shouldCopyTable,
  shouldObfuscateTable,
  shouldSkipTable,
} from "./sanitized-clone";

describe("obfuscation", () => {
  it("generates deterministic dev names from input", () => {
    const name1 = obfuscateName("Jane Smith", 1);
    const name2 = obfuscateName("Jane Smith", 1);
    expect(name1).toBe(name2);
    expect(name1).toBe("Dev User 001");
  });

  it("generates unique names for different indices", () => {
    expect(obfuscateName("Alice", 1)).not.toBe(obfuscateName("Bob", 2));
  });

  it("obfuscates email deterministically", () => {
    const email = obfuscateEmail("jane@example.com", 1);
    expect(email).toBe("dev001@dpf.test");
  });

  it("obfuscates phone", () => {
    const phone = obfuscatePhone("+1-555-123-4567", 1);
    expect(phone).toBe("555-0001");
  });

  it("handles null/undefined fields", () => {
    expect(obfuscateField(null, "name", 1)).toBeNull();
    expect(obfuscateField(undefined, "name", 1)).toBeUndefined();
  });
});

describe("table classification helpers", () => {
  it("public and internal tables should be copied", () => {
    expect(shouldCopyTable("TaxonomyNode")).toBe(true);
    expect(shouldCopyTable("Portfolio")).toBe(true);
  });

  it("confidential tables should be obfuscated", () => {
    expect(shouldObfuscateTable("User")).toBe(true);
    expect(shouldObfuscateTable("EmployeeProfile")).toBe(true);
  });

  it("restricted tables should be skipped", () => {
    expect(shouldSkipTable("CredentialEntry")).toBe(true);
    expect(shouldSkipTable("ApiToken")).toBe(true);
  });

  it("unknown tables default to confidential (obfuscate)", () => {
    expect(shouldObfuscateTable("SomeNewTable")).toBe(true);
    expect(shouldCopyTable("SomeNewTable")).toBe(false);
    expect(shouldSkipTable("SomeNewTable")).toBe(false);
  });
});
