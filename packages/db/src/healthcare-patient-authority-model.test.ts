import { describe, expect, it } from "vitest";

import { Prisma } from "../generated/client/client";
import { prisma } from "./client";

describe("healthcare patient authority Prisma substrate", () => {
  it("exposes patient role, authority, and consent directive models", () => {
    expect(Prisma.ModelName.PatientProfile).toBe("PatientProfile");
    expect(Prisma.ModelName.PatientAuthority).toBe("PatientAuthority");
    expect(Prisma.ModelName.PatientConsentDirective).toBe(
      "PatientConsentDirective",
    );
    expect(prisma.patientProfile).toBeDefined();
    expect(prisma.patientAuthority).toBeDefined();
    expect(prisma.patientConsentDirective).toBeDefined();
  });

  it("extends authorization decisions with explicit patient context", () => {
    const where: Prisma.AuthorizationDecisionLogWhereInput = {
      organizationId: "org-a",
      patientSubjectPrincipalId: "principal-patient",
      patientAuthorityId: "authority-row-id",
      patientConsentDirectiveId: "directive-row-id",
      purposeOfUse: "patient-support",
    };

    expect(where).toMatchObject({
      organizationId: "org-a",
      patientSubjectPrincipalId: "principal-patient",
      patientAuthorityId: "authority-row-id",
      patientConsentDirectiveId: "directive-row-id",
      purposeOfUse: "patient-support",
    });
  });
});
