import { describe, expect, it } from "vitest";
import { customerProofTaskPresentation, requiresCustomerProof } from "./customer-proof";

describe("customer-proof instructions", () => {
  const task = { taskId: "old-task", title: "Customer Case Study: Closed-Won Outcomes", assetType: "case-study", brief: "Write about four customer outcomes.", status: "draft" };
  it("projects old claims as evidence collection without changing the stored row or identity", () => {
    const projected = customerProofTaskPresentation(task);
    expect(projected.taskId).toBe(task.taskId);
    expect(projected.title).toBe("Collect evidence for customer proof");
    expect(projected.brief).toContain("Customer outcomes are unverified");
    expect(projected.brief).toContain("Unverified original request: Customer Case Study");
    expect(task.title).toBe("Customer Case Study: Closed-Won Outcomes");
    expect(customerProofTaskPresentation(projected)).toEqual(projected);
  });
  it("allows labeled internal dogfooding but never uses it to clear customer claims", () => {
    expect(requiresCustomerProof({ title: "Internal dogfooding case study", assetType: "email", brief: "Describe the internal workflow." })).toBe(false);
    expect(requiresCustomerProof({ title: "Internal dogfooding case study", assetType: "email", brief: "Four customers reduced costs." })).toBe(true);
  });
  it.each(["Customer success story", "Client outcomes", "Closed-won results", "Testimonial", "case-study"])("holds the proof intent %s", title => {
    expect(requiresCustomerProof({ title, assetType: "email" })).toBe(true);
  });
  it("keeps ordinary and explicitly no-customer-claim instructions unchanged", () => {
    const ordinary = { title: "Service introduction", assetType: "email", brief: "Introduce the offer without customer result claims." };
    expect(customerProofTaskPresentation(ordinary)).toBe(ordinary);
  });
});
