import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHiveMindCandidates } from "./hive-mind-resolver";
import type { PortalContextDb } from "./db-types";
import type { PortalContextEnvelope } from "./types";

type WorkProjection = PortalContextEnvelope["work"];

describe("resolveHiveMindCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports only tool grant keys as required activation grants", async () => {
    const candidates = await resolveHiveMindCandidates({
      routeDomain: "Build Studio",
      work: activeBuildWork(),
      attention: [
        {
          kind: "missing_evidence",
          severity: "warning",
          message: "Evidence is missing.",
        },
      ],
      db: dbWithAgents([
        {
          agentId: "AGT-REVIEW",
          name: "Build Evidence Reviewer",
          description: "Reviews promotion evidence for Build Studio.",
          valueStream: "integrate",
          role: "reviewer",
          skills: [
            {
              label: "Review evidence",
              description: "Review promotion evidence.",
              capability: "view_platform",
              taskType: "verification",
            },
          ],
          toolGrants: [],
        },
      ]),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.requiredGrantKeys).toEqual([]);
  });

  it("logs transitional keyword role inference once per agent when no typed role is present", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = dbWithAgents([
      {
        agentId: "AGT-INFER-ROLE",
        name: "Context Review Specialist",
        description: "Reviews Build Studio evidence and promotion handoffs.",
        valueStream: "integrate",
        skills: [],
        toolGrants: [{ grantKey: "release_gate_create" }],
      },
    ]);

    await resolveHiveMindCandidates({
      routeDomain: "Build Studio",
      work: activeBuildWork(),
      attention: [
        {
          kind: "missing_evidence",
          severity: "warning",
          message: "Evidence is missing.",
        },
      ],
      db,
    });
    await resolveHiveMindCandidates({
      routeDomain: "Build Studio",
      work: activeBuildWork(),
      attention: [
        {
          kind: "missing_evidence",
          severity: "warning",
          message: "Evidence is missing.",
        },
      ],
      db,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("AGT-INFER-ROLE");
  });
});

function activeBuildWork(): WorkProjection {
  return {
    backlogItem: null,
    epic: null,
    capsule: null,
    featureBuild: {
      buildId: "FB-123",
      title: "Build",
      phase: "build",
      status: "working",
      evidenceComplete: false,
      href: "/build?buildId=FB-123",
    },
    taskRun: null,
    agentThread: null,
    branch: null,
  };
}

function dbWithAgents(agents: Array<Record<string, unknown>>): PortalContextDb {
  return {
    agent: {
      findMany: vi.fn().mockResolvedValue(agents),
    },
  } as unknown as PortalContextDb;
}
