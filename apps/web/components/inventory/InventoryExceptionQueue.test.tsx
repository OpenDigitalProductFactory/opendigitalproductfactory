import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initial: T) => [initial, vi.fn()] as const,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/actions/inventory", () => ({
  acceptTriageRecommendation: vi.fn(),
  dismissEntity: vi.fn(),
  markTaxonomyGapForReview: vi.fn(),
  reassignTaxonomy: vi.fn(),
  requestDiscoveryEvidence: vi.fn(),
}));

import { InventoryExceptionQueue } from "./InventoryExceptionQueue";

describe("InventoryExceptionQueue", () => {
  it("renders grouped triage sections with separate confidence signals and evidence summary", () => {
    const html = renderToStaticMarkup(
      <InventoryExceptionQueue
        queues={{
          metrics: { total: 4, withDecision: 3 },
          humanReview: [
            {
              id: "entity-1",
              entityKey: "service:mystery-engine",
              entityType: "service",
              name: "Mystery Engine",
              attributionConfidence: 0.47,
              firstSeenAt: "2026-04-25T12:00:00Z",
              lastSeenAt: "2026-04-25T13:00:00Z",
              candidateTaxonomy: [
                { nodeId: "foundational/compute/servers", score: 0.63 },
              ],
              properties: { job: "mystery-engine" },
              latestDecision: {
                decisionId: "decision-1",
                outcome: "human-review",
                actorType: "agent",
                identityConfidence: 0.77,
                taxonomyConfidence: 0.63,
                evidenceCompleteness: 0.74,
                reproducibilityScore: 0.71,
                requiresHumanReview: true,
                evidencePacket: {
                  protocolEvidence: {
                    prometheusLabels: { job: "mystery-engine", instance: "srv-01" },
                  },
                },
              },
            },
          ],
          needsMoreEvidence: [
            {
              id: "entity-2",
              entityKey: "device:unknown",
              entityType: "device",
              name: "Unknown Device",
              attributionConfidence: 0.28,
              firstSeenAt: "2026-04-25T11:00:00Z",
              lastSeenAt: "2026-04-25T13:00:00Z",
              candidateTaxonomy: [],
              properties: { sysName: "unknown-device" },
              latestDecision: {
                decisionId: "decision-2",
                outcome: "needs-more-evidence",
                actorType: "agent",
                identityConfidence: 0.41,
                taxonomyConfidence: null,
                evidenceCompleteness: 0.34,
                reproducibilityScore: 0.29,
                requiresHumanReview: false,
                evidencePacket: {},
              },
            },
          ],
          taxonomyGaps: [
            {
              id: "entity-3",
              entityKey: "appliance:contoso",
              entityType: "appliance",
              name: "Contoso Edge",
              attributionConfidence: 0.71,
              firstSeenAt: "2026-04-24T10:00:00Z",
              lastSeenAt: "2026-04-25T13:00:00Z",
              candidateTaxonomy: [],
              properties: { sysDescr: "Contoso Edge X1000" },
              latestDecision: {
                decisionId: "decision-3",
                outcome: "taxonomy-gap",
                actorType: "agent",
                identityConfidence: 0.88,
                taxonomyConfidence: null,
                evidenceCompleteness: 0.82,
                reproducibilityScore: 0.86,
                requiresHumanReview: true,
                evidencePacket: {},
              },
            },
          ],
          autoAttributed: [
            {
              id: "entity-4",
              entityKey: "service:known",
              entityType: "service",
              name: "Known Service",
              attributionConfidence: 0.96,
              firstSeenAt: "2026-04-24T10:00:00Z",
              lastSeenAt: "2026-04-25T13:00:00Z",
              candidateTaxonomy: [
                { nodeId: "foundational/integration/services", score: 0.96 },
              ],
              properties: { job: "known-service" },
              latestDecision: {
                decisionId: "decision-4",
                outcome: "auto-attributed",
                actorType: "agent",
                identityConfidence: 0.97,
                taxonomyConfidence: 0.96,
                evidenceCompleteness: 0.93,
                reproducibilityScore: 0.94,
                requiresHumanReview: false,
                evidencePacket: {},
              },
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Triage Workbench");
    expect(html).toContain("Human Review");
    expect(html).toContain("Needs More Evidence");
    expect(html).toContain("Taxonomy Gaps");
    expect(html).toContain("Auto Attributed");
    expect(html).toContain("Identity");
    expect(html).toContain("Taxonomy");
    expect(html).toContain("Evidence");
    expect(html).toContain("Reproducible");
    expect(html).toContain("job: mystery-engine | instance: srv-01");
    expect(html).toContain("Accept recommendation");
    expect(html).toContain("Request evidence");
  });

  it("uses theme-aware classes instead of hardcoded gray or white utility colors", () => {
    const source = readFileSync(new URL("./InventoryExceptionQueue.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/text-gray-\d+/);
    expect(source).not.toMatch(/bg-white/);
    expect(source).not.toMatch(/border-gray-\d+/);
    expect(source).not.toMatch(/text-black/);
  });
});
