import { describe, expect, it } from "vitest";
import { RESPONSE_FEEDBACK_SURFACE, projectResponseFeedbackSurface } from "./response-feedback-surface";
import type { ResponseFeedbackState } from "@/lib/routing/response-feedback";
const state: ResponseFeedbackState = { messageId: "m1", available: true, unavailableReason: null, value: false, source: "human", actorLabel: "Owner", acceptedAt: "2026-01-01T00:00:00.000Z", revision: 4, canWrite: false };
describe("exact response feedback authorized surface", () => {
  it("binds each disposition to one governed writer using server-projected message and revision", () => {
    expect(RESPONSE_FEEDBACK_SURFACE.actions).toHaveLength(3);
    for (const action of RESPONSE_FEEDBACK_SURFACE.actions) {
      expect(action).toMatchObject({ actionClass: "domain", tool: "record_response_feedback", argMap: { messageId: "feedback.message-id", expectedRevision: "feedback.revision" } });
      expect(action.inputSchema?.properties).toEqual({});
    }
  });
  it("projects protected human state with explicit provenance and exact version, no content or attempt id", () => {
    const view = projectResponseFeedbackSurface(state);
    expect(view.values).toMatchObject({ "feedback.message-id": "m1", "feedback.revision": 4, "feedback.value": false, "feedback.source": "human", "feedback.writable": false });
    expect(JSON.stringify(view)).not.toMatch(/attemptId|providerId|modelId|contentDigest/);
    expect(view.summary.highlights?.join(" ")).toContain("human");
    expect(view.revisionSeed).not.toBe(projectResponseFeedbackSurface({ ...state, revision: 5 }).revisionSeed);
  });
  it("does not present missing evidence as an available judgment or writable surface", () => {
    const view = projectResponseFeedbackSurface({ ...state, available: false, value: null, source: null, actorLabel: null, acceptedAt: null, revision: 0, canWrite: false, unavailableReason: "unavailable" });
    expect(view.values["feedback.writable"]).toBe(false);
    expect(view.summary.status).toBe("unavailable");
    expect(view.values["feedback.keep-value"]).toBe(true);
    expect(view.values["feedback.revise-value"]).toBe(false);
    expect(view.values["feedback.clear-value"]).toBeNull();
  });
});
