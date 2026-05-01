import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client/client";
import { prisma } from "./client";
import type {
  TaxAuthorityCredential,
  TaxDecisionSnapshot,
  TaxLiabilityEntry,
  TaxRemittanceRun,
} from "../generated/client/client";

describe("tax remittance execution model shape", () => {
  it("registers the new execution models in the Prisma runtime model map", () => {
    expect("taxDecisionSnapshot" in prisma).toBe(true);
    expect("taxLiabilityEntry" in prisma).toBe(true);
    expect("taxAuthorityCredential" in prisma).toBe(true);
    expect("taxRemittanceRun" in prisma).toBe(true);
  });

  it("exposes decision snapshots for source transactions", () => {
    const snapshot: TaxDecisionSnapshot = {
      id: "snapshot-cuid",
      snapshotId: "TAX-SNAP-001",
      organizationTaxProfileId: "profile-cuid",
      registrationId: "registration-cuid",
      sourceType: "invoice",
      sourceId: "invoice-cuid",
      sourceLineItemId: "invoice-line-cuid",
      taxType: "sales_tax",
      taxCode: "standard",
      direction: "output",
      taxableAmount: new Prisma.Decimal("500.00"),
      taxRate: new Prisma.Decimal("8.25"),
      taxAmount: new Prisma.Decimal("41.25"),
      jurisdictionRefId: "TAX-JUR-US-TX",
      occurredAt: new Date("2026-04-30T00:00:00.000Z"),
      evidence: { customerRegion: "TX", sourceRef: "INV-1001" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(snapshot.sourceType).toBe("invoice");
    expect(snapshot.direction).toBe("output");
    expect(snapshot.taxAmount.toString()).toBe("41.25");
  });

  it("exposes liability entries that can tie snapshots into obligation periods", () => {
    const entry: TaxLiabilityEntry = {
      id: "entry-cuid",
      entryId: "TAX-LIAB-001",
      organizationTaxProfileId: "profile-cuid",
      registrationId: "registration-cuid",
      periodId: "period-cuid",
      decisionSnapshotId: "snapshot-cuid",
      sourceType: "invoice_tax",
      sourceId: "invoice-cuid",
      sourceLineItemId: "invoice-line-cuid",
      direction: "output",
      taxableAmount: new Prisma.Decimal("500.00"),
      taxAmount: new Prisma.Decimal("41.25"),
      currency: "USD",
      notes: null,
      occurredAt: new Date("2026-04-30T00:00:00.000Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(entry.sourceType).toBe("invoice_tax");
    expect(entry.direction).toBe("output");
    expect(entry.taxAmount.toString()).toBe("41.25");
  });

  it("exposes authority credentials and remittance runs", () => {
    const credential: TaxAuthorityCredential = {
      id: "credential-cuid",
      credentialId: "TAX-CRED-001",
      organizationTaxProfileId: "profile-cuid",
      registrationId: "registration-cuid",
      authorityName: "Texas Comptroller",
      portalBaseUrl: "https://comptroller.texas.gov/taxes/file-pay/",
      credentialOwnerMode: "business_shared",
      status: "verified",
      authMode: "portal_username_password",
      secretRef: "enc:abc123",
      mfaMode: "human_step_up",
      lastVerifiedAt: new Date("2026-04-30T00:00:00.000Z"),
      lastFailureAt: null,
      lastFailureReason: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const run: TaxRemittanceRun = {
      id: "run-cuid",
      runId: "TAX-RUN-001",
      periodId: "period-cuid",
      credentialId: credential.id,
      status: "blocked",
      executionMode: "portal_supervised",
      scheduledFor: new Date("2026-05-20T14:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      submittedAt: null,
      paidAt: null,
      confirmationRef: null,
      failureCode: "mfa_required",
      failureDetails: "Authority requires step-up approval before portal submit.",
      createdByAgentId: "finance-agent",
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(credential.status).toBe("verified");
    expect(run.status).toBe("blocked");
    expect(run.executionMode).toBe("portal_supervised");
  });

  it("accepts create inputs for execution automation models", () => {
    const snapshotCreate: Prisma.TaxDecisionSnapshotCreateInput = {
      snapshotId: "TAX-SNAP-002",
      sourceType: "invoice",
      sourceId: "invoice-cuid",
      taxType: "sales_tax",
      direction: "output",
      taxableAmount: new Prisma.Decimal("125.00"),
      taxAmount: new Prisma.Decimal("10.31"),
      jurisdictionRefId: "TAX-JUR-US-NY",
      occurredAt: new Date("2026-04-01T00:00:00.000Z"),
      organizationTaxProfile: { connect: { id: "profile-cuid" } },
      registration: { connect: { id: "registration-cuid" } },
    };

    const liabilityCreate: Prisma.TaxLiabilityEntryCreateInput = {
      entryId: "TAX-LIAB-002",
      sourceType: "manual_adjustment",
      sourceId: "adjustment-1",
      direction: "adjustment",
      taxableAmount: new Prisma.Decimal("0"),
      taxAmount: new Prisma.Decimal("-5.00"),
      currency: "USD",
      occurredAt: new Date("2026-04-02T00:00:00.000Z"),
      organizationTaxProfile: { connect: { id: "profile-cuid" } },
      registration: { connect: { id: "registration-cuid" } },
    };

    expect(snapshotCreate.sourceType).toBe("invoice");
    expect(liabilityCreate.sourceType).toBe("manual_adjustment");
  });
});
