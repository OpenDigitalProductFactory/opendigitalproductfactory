import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma } from "../generated/client/client";
import { prisma } from "./client";

describe("healthcare care intake Prisma substrate", () => {
  it("keeps packet identity subject-aware and generic evidence joins patient-optional", () => {
    const schema = readFileSync(
      resolve(__dirname, "../prisma/schema/verticals-care.prisma"),
      "utf8",
    );
    const packet = schema.slice(
      schema.indexOf("model CareIntakePacket {"),
      schema.indexOf("model CareIntakeResponse {"),
    );
    const response = schema.slice(
      schema.indexOf("model CareIntakeResponse {"),
      schema.indexOf("model CareIntakeAccessGrant {"),
    );
    const grant = schema.slice(
      schema.indexOf("model CareIntakeAccessGrant {"),
      schema.indexOf("model CareConsentAttestation {"),
    );
    const statusEvent = schema.slice(
      schema.indexOf("model CareIntakeStatusEvent {"),
    );
    const consent = schema.slice(
      schema.indexOf("model CareConsentAttestation {"),
      schema.indexOf("model CareCoverageEvidence {"),
    );

    expect(packet).toContain("subjectKindSlug");
    expect(packet).toContain("subjectRef");
    expect(packet).toMatch(/patientProfileId\s+String\?/);
    expect(packet).toContain("@@unique([id, organizationId])");
    expect(packet).toContain(
      '@@index([organizationId, subjectKindSlug, subjectRef, status], map: "CareIntakePacket_organizationId_subjectKindSlug_subjectRef_idx")',
    );
    expect(response).toMatch(/patientProfileId\s+String\?/);
    expect(response).toContain(
      "@relation(fields: [packetId, organizationId], references: [id, organizationId]",
    );
    expect(response).toContain("@@index([supersedesResponseId, organizationId])");
    expect(grant).toMatch(/patientProfileId\s+String\?/);
    expect(grant).toContain(
      "@relation(fields: [packetId, organizationId], references: [id, organizationId]",
    );
    expect(grant).toContain(
      "@relation(fields: [patientProfileId, organizationId], references: [id, organizationId]",
    );
    expect(statusEvent).toContain(
      "@relation(fields: [patientProfileId, organizationId], references: [id, organizationId]",
    );
    expect(consent).toContain(
      "@relation(fields: [packetId, organizationId, patientProfileId]",
    );
  });

  it("exposes tenant-safe intake authority and evidence streams", () => {
    expect(Prisma.ModelName.CareIntakePacket).toBe("CareIntakePacket");
    expect(Prisma.ModelName.CareIntakeResponse).toBe("CareIntakeResponse");
    expect(Prisma.ModelName.CareIntakeAccessGrant).toBe(
      "CareIntakeAccessGrant",
    );
    expect(Prisma.ModelName.CareConsentAttestation).toBe(
      "CareConsentAttestation",
    );
    expect(Prisma.ModelName.CareCoverageEvidence).toBe(
      "CareCoverageEvidence",
    );
    expect(Prisma.ModelName.CareIntakeException).toBe("CareIntakeException");
    expect(Prisma.ModelName.CareIntakeStatusEvent).toBe(
      "CareIntakeStatusEvent",
    );
    expect(prisma.careIntakePacket).toBeDefined();
    expect(prisma.careIntakeStatusEvent).toBeDefined();
  });
});
