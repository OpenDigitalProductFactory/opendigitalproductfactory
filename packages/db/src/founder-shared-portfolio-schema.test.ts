
import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();

describe("founder shared portfolio ownership", () => {
  it("adds only clustering records around the existing mirror and backlog authorities", () => {
    expect(schema).toContain("model FounderDemandCluster {");
    expect(schema).toContain("model FounderDemandClusterMember {");
    expect(schema).toMatch(/model FounderDemandCluster \{[\s\S]*canonicalBacklogItem\s+BacklogItem\?/);
    expect(schema).toMatch(/model FounderDemandClusterMember \{[\s\S]*mirrorRefs\s+String\[\]/);
    expect(schema).not.toContain("model FounderBacklogItem {");
  });

  it("deduplicates immutable origins while retaining every observed route", () => {
    expect(schema).toMatch(
      /model FounderDemandClusterMember \{[\s\S]*@@unique\(\[originInstallationId, envelopeId\]\)/,
    );
    expect(schema).toMatch(/model FounderDemandClusterMember \{[\s\S]*routeAttestations\s+Json/);
  });

  it("keeps Hive intake durable and forge delivery independently retryable", () => {
    expect(schema).toMatch(/model HiveContributionLedger \{[\s\S]*resultBundle\s+Json\?/);
    expect(schema).toMatch(/model HiveContributionLedger \{[\s\S]*sourceReceipt\s+String\?\s+@unique/);
    expect(schema).toMatch(/model HiveContributionLedger \{[\s\S]*deliveryStatus\s+String/);
    expect(schema).toMatch(/model HiveContributionLedger \{[\s\S]*nextDeliveryAt\s+DateTime\?/);
  });
});
