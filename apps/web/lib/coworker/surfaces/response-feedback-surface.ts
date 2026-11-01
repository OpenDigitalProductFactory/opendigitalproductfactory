import type { SurfaceDefinition, SurfaceNodeDefinition } from "@dpf/types";
import type { ResponseFeedbackState } from "@/lib/routing/response-feedback";
import type { SurfaceLoaderResult } from "../authorized-surface-runtime";

export const RESPONSE_FEEDBACK_LOADER_ID = "response-feedback.view-model";
const record = (nodeId: string, accessibleName: string, rendered = true): SurfaceNodeDefinition => ({
  nodeId, accessibleName, kind: "record", parentId: "feedback", valuePolicy: "read", sensitivity: "confidential", rendered,
});
const choices = [
  { id: "keep", label: "Kept" }, { id: "revise", label: "Needs revision" }, { id: "clear", label: "Clear feedback" },
] as const;
export const RESPONSE_FEEDBACK_SURFACE: SurfaceDefinition = {
  contractVersion: "1.0", surfaceId: "coworker.response-feedback", label: "Response feedback",
  purpose: "Read or record an explicit disposition for an exact saved response. This is a keep preference, not a task quality score.",
  supportedModes: ["browser", "headless", "workroom", "scheduled", "background", "external", "mobile"],
  entryPoints: [{ kind: "resource", resourceType: "agent-message" }, { kind: "task-intent", intent: "record response feedback" }],
  loaderId: RESPONSE_FEEDBACK_LOADER_ID,
  nodes: [
    { nodeId: "feedback", kind: "surface", accessibleName: "Response feedback", valuePolicy: "none", sensitivity: "confidential" },
    record("feedback.message-id", "Saved response", false), record("feedback.revision", "Feedback revision", false),
    record("feedback.available", "Feedback available", false), record("feedback.writable", "Feedback writable", false),
    record("feedback.value", "Current disposition"), record("feedback.source", "Feedback source"),
    record("feedback.actor", "Feedback author"), record("feedback.accepted-at", "Feedback saved at"),
    { nodeId: "feedback.back-to-decision", parentId: "feedback", kind: "navigation", accessibleName: "Back to decision", valuePolicy: "none", sensitivity: "confidential" },
    { nodeId: "feedback.review-answer", parentId: "feedback", kind: "action", accessibleName: "Review answer", valuePolicy: "none", sensitivity: "confidential" },
    { nodeId: "feedback.reload", parentId: "feedback", kind: "action", accessibleName: "Reload feedback", valuePolicy: "none", sensitivity: "confidential" },
    ...choices.map(({ id, label }) => record(`feedback.${id}-value`, `${label} value`, false)),
    ...choices.map(({ id, label }): SurfaceNodeDefinition => ({ nodeId: `feedback.${id}`, parentId: "feedback", kind: "action", accessibleName: label,
      valuePolicy: "none", sensitivity: "confidential", when: { nodeId: "feedback.writable", equals: true } })),
  ],
  actions: choices.map(({ id, label }) => ({
    actionId: `feedback.${id}`, label, actionClass: "domain", tool: "record_response_feedback", risk: "low", confirmation: "none", idempotent: true,
    argMap: { messageId: "feedback.message-id", expectedRevision: "feedback.revision", value: `feedback.${id}-value` },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  })),
};

export function projectResponseFeedbackSurface(state: ResponseFeedbackState): SurfaceLoaderResult {
  const description = !state.available ? "Feedback unavailable for this response."
    : state.value === null ? "No current disposition." : state.value ? "Kept." : "Needs revision.";
  const provenance = state.source ? `${state.source} feedback${state.actorLabel ? ` by ${state.actorLabel}` : ""}.` : "No attributed feedback.";
  return {
    revisionSeed: JSON.stringify([state.messageId, state.available, state.revision, state.value, state.source, state.actorLabel, state.acceptedAt, state.canWrite]),
    summary: { label: "Response feedback", purpose: "Explicit disposition for an exact saved response.", status: state.available ? "ready" : "unavailable", highlights: [description, provenance, "Keep preference is separate from task quality evaluation."] },
    values: {
      "feedback.message-id": state.messageId, "feedback.revision": state.revision,
      "feedback.available": state.available, "feedback.writable": state.available && state.canWrite,
      "feedback.value": state.value, "feedback.source": state.source, "feedback.actor": state.actorLabel, "feedback.accepted-at": state.acceptedAt,
      "feedback.keep-value": true, "feedback.revise-value": false, "feedback.clear-value": null,
    },
    states: Object.fromEntries(choices.map(({ id }) => [`feedback.${id}`, { disabled: !state.available || !state.canWrite }])),
    help: { "feedback.back-to-decision": "Return to the same routing decision in its existing overlay without navigating or creating a nested modal.", "feedback.review-answer": "Explicit read: call get_response_feedback with this saved message id, the exact expectedAttemptId selected for investigation, and includeAnswer true. Routine surface state excludes answer text.", "feedback.reload": "Reload through surface_snapshot; this is a read, not a new judgment.", feedback: "Human feedback is protected. Coworkers may change only their own coworker judgment. Missing or edited producer evidence stays unavailable." },
  };
}
