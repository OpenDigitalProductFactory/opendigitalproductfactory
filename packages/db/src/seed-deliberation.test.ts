import { describe, expect, it, vi } from "vitest";

import {
  parseFrontmatter,
  seedDeliberation,
} from "./seed-deliberation";

describe("parseFrontmatter", () => {
  it("parses deliberation frontmatter and markdown body", () => {
    const raw = `---
slug: review
name: Peer Review
status: active
purpose: Structured multi-agent critique before a gate.
defaultRoles:
  - author
  - reviewer
topologyTemplate:
  rootNodeType: review
activationPolicyHints:
  stageDefaults:
    - ideate
evidenceRequirements:
  retrievalRequired: true
outputContract:
  summary: merged recommendation
providerStrategyHints:
  strategyProfile: balanced
---
Pattern body`;

    const { frontmatter, body } = parseFrontmatter(raw);

    expect(frontmatter.slug).toBe("review");
    expect(frontmatter.name).toBe("Peer Review");
    expect(frontmatter.status).toBe("active");
    expect(frontmatter.purpose).toBe(
      "Structured multi-agent critique before a gate.",
    );
    expect(frontmatter.defaultRoles).toEqual(["author", "reviewer"]);
    expect(frontmatter.topologyTemplate).toEqual({
      rootNodeType: "review",
    });
    expect(frontmatter.activationPolicyHints).toEqual({
      stageDefaults: ["ideate"],
    });
    expect(frontmatter.evidenceRequirements).toEqual({
      retrievalRequired: true,
    });
    expect(frontmatter.outputContract).toEqual({
      summary: "merged recommendation",
    });
    expect(frontmatter.providerStrategyHints).toEqual({
      strategyProfile: "balanced",
    });
    expect(body).toBe("Pattern body");
  });
});

describe("seedDeliberation", () => {
  it("skips overridden patterns and updates non-overridden patterns", async () => {
    const prisma = {
      deliberationPattern: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: "pat-1",
            slug: "review",
            isOverridden: true,
          })
          .mockResolvedValueOnce({
            id: "pat-2",
            slug: "debate",
            isOverridden: false,
          }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
      deliberationRoleProfile: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };

    await seedDeliberation(prisma as never, [
      {
        slug: "review",
        name: "Peer Review",
        status: "active",
        purpose: "Structured critique",
        defaultRoles: ["author", "reviewer", "adjudicator"],
        topologyTemplate: { rootNodeType: "review" },
        activationPolicyHints: { stageDefaults: ["ideate", "plan"] },
        evidenceRequirements: { retrievalRequired: true },
        outputContract: { summary: "merged recommendation" },
        providerStrategyHints: { strategyProfile: "balanced" },
        content: "review body",
      },
      {
        slug: "debate",
        name: "Debate",
        status: "active",
        purpose: "Structured adversarial analysis",
        defaultRoles: ["debater", "skeptic", "adjudicator"],
        topologyTemplate: { rootNodeType: "review" },
        activationPolicyHints: { explicitTriggers: ["debate this"] },
        evidenceRequirements: { retrievalRequired: true },
        outputContract: { summary: "consensus or non-consensus" },
        providerStrategyHints: { strategyProfile: "high-assurance" },
        content: "debate body",
      },
    ]);

    expect(prisma.deliberationPattern.update).toHaveBeenCalledTimes(1);
    expect(prisma.deliberationPattern.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pat-2" },
      }),
    );
    expect(prisma.deliberationPattern.create).not.toHaveBeenCalled();
  });
});
