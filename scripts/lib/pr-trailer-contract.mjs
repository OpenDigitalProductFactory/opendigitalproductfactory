// Canonical PR-body trailer names shared by prospective gate context,
// pre-PR readiness, and CI-facing sensitivity checks.
//
// Keep values colon-free. Consumers add punctuation appropriate to their
// output or matcher so parsing and author guidance cannot drift independently.

export const PR_TRAILER_NAMES = Object.freeze({
  processSpine: "Process-Spine-Decision",
  uxFitRetired: "UX-Fit-Decision",
  seedFit: "Seed-Fit-Decision",
  designGrounding: "Design-Grounding-Decision",
  docsImpact: "Docs-Impact-Decision",
  convergenceImpact: "Convergence-Impact-Decision",
  localCiEvidence: "Local-CI-Evidence",
  localCiOverride: "Local-CI-Override",
});

export const SUPPORTED_PR_TRAILERS = Object.freeze(Object.values(PR_TRAILER_NAMES));
