import { describe, it, expect } from "vitest";
import { classifyMemoryScope } from "./memory-scope";

describe("classifyMemoryScope", () => {
  it("routes business categories to org scope", () => {
    for (const category of ["decision", "constraint", "domain_context"]) {
      const d = classifyMemoryScope({ category, key: "cloud_provider", value: "AWS" });
      expect(d.scope).toBe("org");
      expect(d.sensitivity).toBe("normal");
    }
  });

  it("keeps preferences private (user scope)", () => {
    const d = classifyMemoryScope({ category: "preference", key: "review_style", value: "bullets" });
    expect(d.scope).toBe("user");
  });

  it("forces sensitive content to user scope regardless of category", () => {
    const salary = classifyMemoryScope({
      category: "domain_context",
      key: "employee_salary",
      value: "engineer pay is 90k",
    });
    expect(salary.scope).toBe("user");
    expect(salary.sensitivity).toBe("sensitive");

    const health = classifyMemoryScope({
      category: "constraint",
      key: "medical_note",
      value: "has a disability accommodation",
    });
    expect(health.scope).toBe("user");
    expect(health.sensitivity).toBe("sensitive");

    const secret = classifyMemoryScope({
      category: "decision",
      key: "api_key_rotation",
      value: "the production api key is rotated monthly",
    });
    expect(secret.sensitivity).toBe("sensitive");
    expect(secret.scope).toBe("user");
  });

  it("honors an explicit 'do not share' marker as sensitive", () => {
    const d = classifyMemoryScope({
      category: "decision",
      key: "vendor_choice",
      value: "chose Acme — confidential, do not share",
    });
    expect(d.sensitivity).toBe("sensitive");
    expect(d.scope).toBe("user");
  });

  it("defaults an unrecognized category to private", () => {
    const d = classifyMemoryScope({ category: "misc", key: "x", value: "y" });
    expect(d.scope).toBe("user");
  });

  it("a normal domain_context fact is shareable org-wide", () => {
    const d = classifyMemoryScope({
      category: "domain_context",
      key: "tech_stack",
      value: "Next.js + Postgres",
    });
    expect(d).toMatchObject({ scope: "org", sensitivity: "normal" });
  });
});
