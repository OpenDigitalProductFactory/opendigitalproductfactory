import { describe, expect, it } from "vitest";

import {
  classifyApplication,
  describeInterest,
  summarizeAdoptionInterest,
  type ApplicationRow,
} from "./adoption-interest";

function application(over: Partial<ApplicationRow> & { animalRef: string; status: string }): ApplicationRow {
  return {
    animalProfileId: `profile-${over.animalRef}`,
    applicantName: null,
    submittedAt: new Date("2026-09-01T00:00:00Z"),
    ...over,
  };
}

describe("classifyApplication", () => {
  it("separates a committed adopter from a fresh enquiry", () => {
    expect(classifyApplication("approved")).toBe("scheduled");
    expect(classifyApplication("meet-and-greet")).toBe("scheduled");
    expect(classifyApplication("home-check")).toBe("scheduled");
    expect(classifyApplication("submitted")).toBe("interested");
    expect(classifyApplication("screening")).toBe("interested");
  });

  it("treats a closed or parked application as nobody coming", () => {
    for (const status of ["declined", "withdrawn", "waitlisted", "placed"]) {
      expect(classifyApplication(status)).toBeNull();
    }
  });
});

describe("summarizeAdoptionInterest", () => {
  it("lets the better news win when an animal has both", () => {
    const interest = summarizeAdoptionInterest([
      application({ animalRef: "a1", status: "submitted", applicantName: "Early Bird" }),
      application({ animalRef: "a1", status: "approved", applicantName: "Dana Whitlock" }),
    ]);

    expect(interest.get("a1")?.level).toBe("scheduled");
    expect(interest.get("a1")?.applicantName).toBe("Dana Whitlock");
  });

  it("prefers the longest-waiting applicant at the same level", () => {
    const interest = summarizeAdoptionInterest([
      application({
        animalRef: "a1",
        status: "submitted",
        applicantName: "Later",
        submittedAt: new Date("2026-09-02T00:00:00Z"),
      }),
      application({
        animalRef: "a1",
        status: "screening",
        applicantName: "Earlier",
        submittedAt: new Date("2026-08-02T00:00:00Z"),
      }),
    ]);

    expect(interest.get("a1")?.applicantName).toBe("Earlier");
  });

  it("records nothing for an animal whose applications have all closed", () => {
    const interest = summarizeAdoptionInterest([
      application({ animalRef: "a1", status: "declined" }),
      application({ animalRef: "a1", status: "withdrawn" }),
    ]);

    expect(interest.has("a1")).toBe(false);
  });
});

describe("describeInterest", () => {
  it("says who is coming when the shelter recorded a name", () => {
    expect(
      describeInterest({ level: "scheduled", applicantName: "Dana Whitlock", since: new Date() }),
    ).toBe("Dana Whitlock is coming for them");
    expect(describeInterest({ level: "scheduled", applicantName: null, since: new Date() })).toBe(
      "Adopter approved",
    );
    expect(describeInterest({ level: "interested", applicantName: null, since: new Date() })).toBe(
      "Someone has applied",
    );
    expect(describeInterest(undefined)).toBeNull();
  });
});
