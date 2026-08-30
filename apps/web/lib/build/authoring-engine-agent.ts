// apps/web/lib/build/authoring-engine-agent.ts
//
// BI-2D698C7B — which agent authored a design document?
//
// resolveInitiativeArtifact requires BOTH a unique author principal and a
// `savedByAgentId` on the revision:
//
//   if (!authorPrincipalId || !revision.savedByAgentId) {
//     return authorRequired("Build artifact author provenance is incomplete
//                            or ambiguous.");
//   }
//
// Every BuildArtifactRevision on the Pet Rescue install had
// `savedByAgentId = NULL` — 12 of 12 — because the ideate dispatch saves the
// design through saveBuildEvidence with an empty context, so `context?.agentId`
// is null. The engine that actually wrote the document is known at that call
// site and simply was not carried in. ARTIFACT_AUTHOR_REQUIRED could therefore
// never clear, and with it neither could the canonical design baseline.
//
// The registry (packages/db/data/agent_registry.json) holds one agent per
// external engine. There is no registered agent for the bundled local engine,
// and this deliberately does NOT invent one: a design whose author cannot be
// named truthfully must keep a null author rather than a fabricated one. The
// gate refusing such a revision is the correct outcome, not a bug to paper over.

/** Build engines that have a registered agent identity. */
const ENGINE_AGENT_IDS: Readonly<Record<string, string>> = {
  claude: "AGT-EXT-CLAUDE",
  codex: "AGT-EXT-CODEX",
  grok: "AGT-EXT-GROK",
};

/**
 * The agent id to record as the author of an artifact produced by `engine`.
 *
 * Returns null when the engine has no registered agent — the honest answer,
 * and the one that leaves the readiness gate free to refuse.
 */
export function authoringAgentIdForEngine(engine: string | null | undefined): string | null {
  if (!engine) return null;
  return ENGINE_AGENT_IDS[engine] ?? null;
}
