import { describe, expect, it } from "vitest";

import type {
  ToolSelectionAccuracy,
  ToolSurfaceAssessment,
} from "@/lib/tak/context-economy-metrics";
import { LOCAL_TOOL_SELECTION_CLIFF } from "@/lib/tak/context-economy-metrics";

import {
  classifyGrantDenial,
  classifyRepeatedSuccess,
  classifyToolSurfaceOverload,
} from "./classifiers";

describe("pattern observer classifiers", () => {
  describe("classifyGrantDenial", () => {
    it("returns null when repeated denial evidence is below the threshold", () => {
      const need = classifyGrantDenial({
        deniedTool: "create_backlog_item",
        missingCapability: "backlog.write",
        denialMessages: [
          "forbidden_grant: agent lacks backlog.write",
          "forbidden grant: agent lacks backlog.write",
        ],
        threshold: 3,
      });

      expect(need).toBeNull();
    });

    it("classifies repeated forbidden grant text as an important grant need", () => {
      const need = classifyGrantDenial({
        deniedTool: "create_backlog_item",
        missingCapability: "backlog.write",
        denialMessages: [
          "forbidden_grant: agent lacks backlog.write",
          "forbidden grant: agent lacks backlog.write",
          "missing capability backlog.write",
        ],
        threshold: 3,
      });

      expect(need).toMatchObject({
        kind: "grant",
        severity: "important",
        evidenceJson: {
          deniedTool: "create_backlog_item",
          missingCapability: "backlog.write",
          count: 3,
        },
      });
      expect(need?.need).toContain("backlog.write");
      expect(need?.blocks).toContain("create_backlog_item");
    });

    it("recognizes insufficient token scope denial text", () => {
      const need = classifyGrantDenial({
        deniedTool: "record_execution_evidence",
        missingCapability: "write token",
        denialMessages: [
          "insufficient_token_scope: requiredScope write",
          "insufficient_token_scope: requiredScope write",
        ],
        threshold: 2,
      });

      expect(need?.kind).toBe("grant");
      expect(need?.evidenceJson?.count).toBe(2);
    });
  });

  describe("classifyToolSurfaceOverload", () => {
    it("classifies overload assessments as important tool needs", () => {
      const assessment: ToolSurfaceAssessment = {
        toolCount: LOCAL_TOOL_SELECTION_CLIFF + 2,
        estDefinitionTokens: 5200,
        exceedsLocalCliff: true,
        windowShare: 0.31,
        zone: "overload",
      };

      const need = classifyToolSurfaceOverload(assessment);

      expect(need).toMatchObject({
        kind: "tool",
        severity: "important",
        evidenceJson: assessment,
      });
      expect(need?.blocks).toContain("tool surface");
    });

    it("classifies near-cliff caution assessments as minor tool needs", () => {
      const need = classifyToolSurfaceOverload({
        toolCount: LOCAL_TOOL_SELECTION_CLIFF - 1,
        estDefinitionTokens: 2200,
        exceedsLocalCliff: false,
        windowShare: 0.16,
        zone: "caution",
      });

      expect(need).toMatchObject({
        kind: "tool",
        severity: "minor",
        evidenceJson: {
          toolCount: LOCAL_TOOL_SELECTION_CLIFF - 1,
          windowShare: 0.16,
          zone: "caution",
          exceedsLocalCliff: false,
        },
      });
    });

    it("returns null for lean assessments and conservative caution signals", () => {
      expect(
        classifyToolSurfaceOverload({
          toolCount: 4,
          estDefinitionTokens: 500,
          exceedsLocalCliff: false,
          windowShare: null,
          zone: "lean",
        }),
      ).toBeNull();

      expect(
        classifyToolSurfaceOverload({
          toolCount: 8,
          estDefinitionTokens: 900,
          exceedsLocalCliff: false,
          windowShare: null,
          zone: "caution",
        }),
      ).toBeNull();
    });
  });

  describe("classifyRepeatedSuccess", () => {
    const perfectAccuracy: ToolSelectionAccuracy = {
      total: 12,
      succeeded: 12,
      accuracy: 1,
      perTool: {
        create_work_capsule: { total: 4, succeeded: 4, accuracy: 1 },
        record_capsule_evidence: { total: 8, succeeded: 8, accuracy: 1 },
      },
    };

    it("returns null below the repeated successful workflow threshold", () => {
      const need = classifyRepeatedSuccess({
        workflowName: "capsule handoff evidence loop",
        repetitionCount: 2,
        threshold: 3,
        ceremonyScore: 0.9,
        accuracy: perfectAccuracy,
      });

      expect(need).toBeNull();
    });

    it("classifies high-ceremony repeated success as a minor proceduralization code need", () => {
      const need = classifyRepeatedSuccess({
        workflowName: "capsule handoff evidence loop",
        repetitionCount: 4,
        threshold: 3,
        ceremonyScore: 0.85,
        accuracy: perfectAccuracy,
      });

      expect(need).toMatchObject({
        kind: "code",
        severity: "minor",
        evidenceJson: {
          workflowName: "capsule handoff evidence loop",
          repetitionCount: 4,
          threshold: 3,
          ceremonyScore: 0.85,
          accuracy: 1,
        },
      });
      expect(need?.need).toContain("proceduralize");
    });

    it("returns null when the repeated workflow is not reliably successful", () => {
      const need = classifyRepeatedSuccess({
        workflowName: "capsule handoff evidence loop",
        repetitionCount: 4,
        threshold: 3,
        ceremonyScore: 0.9,
        accuracy: { ...perfectAccuracy, succeeded: 9, accuracy: 0.75 },
      });

      expect(need).toBeNull();
    });
  });
});
