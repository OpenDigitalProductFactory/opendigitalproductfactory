import { describe, expect, it } from "vitest";
import {
  isSubmissionType,
  resultRouteFor,
  resultHeading,
  whatHappensNextSteps,
  responseChannelCopy,
  responseTimeCopy,
  SUBMISSION_TYPES,
  type SubmissionType,
} from "./submission-result-content";

describe("isSubmissionType", () => {
  it("accepts the four supported types", () => {
    for (const t of ["inquiry", "booking", "order", "donation"]) {
      expect(isSubmissionType(t)).toBe(true);
    }
  });
  it("rejects unknown types (e.g. checkout plumbing)", () => {
    expect(isSubmissionType("checkout")).toBe(false);
    expect(isSubmissionType("")).toBe(false);
  });
});

describe("resultRouteFor — named result routes, never /checkout", () => {
  it("maps each type to a result-named route", () => {
    expect(resultRouteFor("inquiry")).toBe("inquiry/received");
    expect(resultRouteFor("booking")).toBe("booking/confirmed");
    expect(resultRouteFor("order")).toBe("order/received");
    expect(resultRouteFor("donation")).toBe("donation/received");
  });
  it("no route reuses the checkout segment", () => {
    for (const t of SUBMISSION_TYPES) {
      expect(resultRouteFor(t)).not.toContain("checkout");
    }
  });
});

describe("resultHeading", () => {
  it("gives a customer-facing heading per type", () => {
    expect(resultHeading("booking").heading).toMatch(/reserved/i);
    expect(resultHeading("inquiry").heading).toMatch(/enquiry/i);
    expect(resultHeading("order").heading.length).toBeGreaterThan(0);
    expect(resultHeading("donation").heading).toMatch(/thank/i);
  });
});

describe("whatHappensNextSteps", () => {
  it("returns ordered, brand-personalised steps", () => {
    const steps = whatHappensNextSteps("inquiry", "Bella Trattoria");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps[0]).toContain("Bella Trattoria");
  });
  it("booking steps reassure that no online payment is taken", () => {
    const steps = whatHappensNextSteps("booking", "Bella Trattoria");
    expect(steps.join(" ")).toMatch(/no payment/i);
  });
});

describe("responseChannelCopy", () => {
  it("names the customer email when known", () => {
    expect(responseChannelCopy("guest@example.com")).toContain("guest@example.com");
  });
  it("falls back gracefully when no email is known", () => {
    expect(responseChannelCopy(null)).toMatch(/contact details/i);
  });
});

describe("responseTimeCopy", () => {
  it("states an aim, not a fabricated guarantee", () => {
    const copy = responseTimeCopy("inquiry");
    expect(copy).toMatch(/aim/i);
    expect(copy).toMatch(/business day/i);
  });
  it("uses reservation wording for bookings", () => {
    expect(responseTimeCopy("booking")).toMatch(/reservation/i);
  });
});

describe("SUBMISSION_TYPES coverage", () => {
  it("every type resolves through the full copy contract without throwing", () => {
    for (const t of SUBMISSION_TYPES as readonly SubmissionType[]) {
      expect(() => {
        resultHeading(t);
        whatHappensNextSteps(t, "Org");
        responseTimeCopy(t);
        resultRouteFor(t);
      }).not.toThrow();
    }
  });
});
