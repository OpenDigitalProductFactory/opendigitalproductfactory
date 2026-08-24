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

    it("suppresses caution without observed selection degradation", () => {
      const assessment: ToolSurfaceAssessment = {
        toolCount: LOCAL_TOOL_SELECTION_CLIFF - 1,
        estDefinitionTokens: 2200,
        exceedsLocalCliff: false,
        windowShare: 0.16,
        zone: "caution",
      };

      expect(classifyToolSurfaceOverload(assessment)).toBeNull();
      expect(classifyToolSurfaceOverload(assessment, {
        total: 10,
        succeeded: 10,
        accuracy: 1,
        perTool: {},
      })).toBeNull();
    });

    it("classifies caution as minor only with observed selection degradation", () => {
      const need = classifyToolSurfaceOverload({
        toolCount: LOCAL_TOOL_SELECTION_CLIFF - 1,
        estDefinitionTokens: 2200,
        exceedsLocalCliff: false,
        windowShare: 0.16,
        zone: "caution",
      }, {
        total: 10,
        succeeded: 6,
        accuracy: 0.6,
        perTool: {},
      });

      expect(need).toMatchObject({
        kind: "tool",
        severity: "minor",
        evidenceJson: {
          toolCount: LOCAL_TOOL_SELECTION_CLIFF - 1,
          windowShare: 0.16,
          zone: "caution",
          exceedsLocalCliff: false,
          observedSelectionAccuracy: 0.6,
          observedSelectionSample: 10,
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

    // BI-3346DC28: a surface past the raw-count cliff with an UNKNOWN window is
    // only a PROXY for local-model overload. It must not fire on the count alone.
    const proxyOverload: ToolSurfaceAssessment = {
      toolCount: 68,
      estDefinitionTokens: 16000,
      exceedsLocalCliff: true,
      windowShare: null,
      zone: "overload",
    };

    it("suppresses a count-proxy overload when tool selection is demonstrably healthy", () => {
      const healthy: ToolSelectionAccuracy = { total: 20, succeeded: 20, accuracy: 1, perTool: {} };
      expect(classifyToolSurfaceOverload(proxyOverload, healthy)).toBeNull();
    });

    it("suppresses a count-proxy overload when there is no corroborating evidence", () => {
      expect(classifyToolSurfaceOverload(proxyOverload, null)).toBeNull();
      const tinySample: ToolSelectionAccuracy = { total: 1, succeeded: 0, accuracy: 0, perTool: {} };
      expect(classifyToolSurfaceOverload(proxyOverload, tinySample)).toBeNull();
    });

    it("fires a count-proxy overload only when selection is actually degrading", () => {
      const degraded: ToolSelectionAccuracy = { total: 10, succeeded: 6, accuracy: 0.6, perTool: {} };
      const need = classifyToolSurfaceOverload(proxyOverload, degraded);
      expect(need).toMatchObject({ kind: "tool", severity: "important" });
      expect(need?.evidenceJson).toMatchObject({ observedSelectionAccuracy: 0.6, observedSelectionSample: 10 });
    });

    it("fires a window-known overload directly — definitions crowd the real window", () => {
      const knownOverload: ToolSurfaceAssessment = {
        toolCount: 40,
        estDefinitionTokens: 9000,
        exceedsLocalCliff: true,
        windowShare: 0.4,
        zone: "overload",
      };
      // No selection evidence needed: windowShare is mechanistic, not a proxy.
      expect(classifyToolSurfaceOverload(knownOverload)).toMatchObject({
        kind: "tool",
        severity: "important",
      });
    });

    // BI-98D17D0B: an execution-derived surface (periodic-review fallback) omits
    // the attached-but-uncalled read baseline, so it is not a valid basis for an
    // overload assertion — the classifier must suppress every zone when the
    // surface does not reflect the attached set.
    it("suppresses overload/caution when the surface does not reflect the attached set", () => {
      const degraded: ToolSelectionAccuracy = { total: 10, succeeded: 6, accuracy: 0.6, perTool: {} };
      // Even a would-be degraded-selection proxy overload is suppressed…
      expect(classifyToolSurfaceOverload(proxyOverload, degraded, false)).toBeNull();
      // …and a would-be window-known overload is suppressed…
      const knownOverload: ToolSurfaceAssessment = {
        toolCount: 40, estDefinitionTokens: 9000, exceedsLocalCliff: true, windowShare: 0.4, zone: "overload",
      };
      expect(classifyToolSurfaceOverload(knownOverload, null, false)).toBeNull();
      // …and a caution surface is suppressed too.
      expect(
        classifyToolSurfaceOverload(
          { toolCount: 12, estDefinitionTokens: 2200, exceedsLocalCliff: false, windowShare: 0.16, zone: "caution" },
          null,
          false,
        ),
      ).toBeNull();
    });

    it("still fires for a real attached surface (surfaceReflectsAttached defaults true)", () => {
      const degraded: ToolSelectionAccuracy = { total: 10, succeeded: 6, accuracy: 0.6, perTool: {} };
      expect(classifyToolSurfaceOverload(proxyOverload, degraded, true)).toMatchObject({
        kind: "tool",
        severity: "important",
      });
    });
  });

  describe("classifyRepeatedSuccess", () => {
    const perfectAccuracy: ToolSelectionAccuracy = {
      total: 12,
      succeeded: 12,
      accuracy: 1,
      perTool: {
        create_workroom: { total: 4, succeeded: 4, accuracy: 1 },
        record_workroom_evidence: { total: 8, succeeded: 8, accuracy: 1 },
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
