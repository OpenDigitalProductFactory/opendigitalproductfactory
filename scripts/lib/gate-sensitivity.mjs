// scripts/lib/gate-sensitivity.mjs — canonical file-sensitivity and
// attestation constants for the UX-Fit and Spec/Plan/Doc gates (BI-2677A465).
//
// These regexes decide WHICH diffs each gate applies to. They used to live as
// module-private constants inside scripts/check-ux-fit-decision.mjs and
// scripts/check-spec-plan-doc.mjs, with hand-mirrored copies in the
// dpf-skill-pack precheck hooks ("Mirrors NEW_SOURCE_FILE_RE in …") — three
// copies, one drift away from a gate and its warning disagreeing. This module
// is the single source: the gate checkers import it, the gate-context pack
// derives prospective constraints from it, and a drift-guard test pins the
// skill-pack hooks' local mirrors to it (the hooks keep dependency-free copies
// because the pack is distributed outside this repo).

import { PR_TRAILER_NAMES } from "./pr-trailer-contract.mjs";

// ── Spec/Plan/Doc gate (scripts/check-spec-plan-doc.mjs) ─────────────────────

export const PROCESS_SPINE_ATTESTATION_RE = new RegExp(`${PR_TRAILER_NAMES.processSpine}:`, "i");

// What COUNTS as a substantial implementation surface (triggers the gate):
// NEW source modules and routes are a high-signal, low-false-positive marker
// of a new capability/contract that deserves a spec/plan/doc touch.
export const NEW_SOURCE_FILE_RE =
  /^(apps\/web\/lib\/.*\.(ts|tsx)|apps\/web\/app\/.*\/(page|route)\.(ts|tsx)|packages\/[^/]+\/src\/.*\.(ts|tsx)|packages\/db\/prisma\/migrations\/.*\/migration\.sql)$/;

// A large in-place rewrite of existing source is also substantial even with no
// new file: added non-test source lines across the diff beyond this threshold.
export const ADDED_SOURCE_LINE_THRESHOLD = 120;
export const SOURCE_LINE_FILE_RE = /^(apps\/web|packages\/[^/]+\/src)\/.*\.(ts|tsx)$/;

// What SATISFIES the gate (durable-knowledge artifact touched).
export const DOC_ARTIFACT_RE =
  /^(docs\/.*\.(md|html)|AGENTS\.md|.*\/AGENTS\.md|docs\/founder-kernel\/wiki\/principles\/.*\.md|packages\/dpf-skill-pack\/skills\/.*\/SKILL\.md|skills\/.*\.skill\.md)$/;

// ── UX-Fit gate (scripts/check-ux-fit-decision.mjs) ──────────────────────────

/**
 * RETIRED by BI-D967DEE0. The UX-Fit gate no longer reads any trailer — it requires a
 * measured manifest (`docs/ux-fit/<date>-<slug>.ux-fit.json`). This pattern is kept ONLY
 * so tooling can still RECOGNISE the dead trailer in order to warn about it (see
 * RETIRED_TRAILERS in scripts/pr-readiness/core.mjs). Do not gate on it.
 */
export const UX_FIT_ATTESTATION_RE = new RegExp(`${PR_TRAILER_NAMES.uxFitRetired}:`, "i");

// Added lines that introduce a user-facing control the operator must understand.
// Keep this list behavior-pinned to packages/dpf-skill-pack/hooks/ux-fit-precheck.mjs
// via scripts/gate-context.test.mjs; the hook mirror is dependency-free because
// the skill pack is distributed outside this repo.
export const UI_CONTROL_DESCRIPTION =
  "<input>, <select>, <textarea>, type=number|range|button|submit, <form>, <button>, " +
  "<a>/<Link>, <details>/<summary>, custom *Button/*Link/*Trigger/*Disclosure/*Toggle controls, " +
  "role=button/link/tab/switch/menuitem, aria-expanded, data-dpf-disclosure, or onClick";
export const UI_CONTROL_RE = new RegExp(
  [
    String.raw`<(?:input|select|textarea|form|button|a|details|summary)\b`,
    String.raw`<(?:Button|Link|Trigger|Disclosure|Toggle|Menu|Tab|Tabs|Accordion|Popover|Dialog|Drawer|Combobox|Command|Action)\b`,
    String.raw`<[A-Z][A-Za-z0-9]*(?:Button|Link|Trigger|Disclosure|Toggle|Menu|Tab|Tabs|Accordion|Popover|Dialog|Drawer|Combobox|Command|Action)\b`,
    String.raw`\btype=["'](?:number|range|button|submit)["']`,
    String.raw`\brole=["'](?:button|link|tab|switch|menuitem|checkbox|radio)["']`,
    String.raw`\baria-expanded=`,
    String.raw`\bdata-dpf-disclosure\b`,
    String.raw`\bonClick=`,
  ].join("|"),
  "i",
);
// A newly-added route is a new surface that deserves a fit review.
export const UX_ROUTE_FILE_RE = /app\/.*\/page\.tsx$/;
// Test/story scaffolding is never user-facing.
export const UX_EXCLUDE_RE = /\.(test|spec|stories)\.tsx$/;

// ── Source scopes for prospective guard guidance ───────────────────────────
// These predicates are also consumed by the guard scanners themselves. That
// keeps gate-context from maintaining a second, looser idea of which planned
// files the prose/style guards inspect.
export const PROSE_LINT_SOURCE_RE =
  /^apps\/web\/(?:app|components)\/.*\.(?:ts|tsx)$/;
export const STYLE_DRIFT_SOURCE_RE =
  /^apps\/web\/(?:app|components|lib|hooks)\/.*\.(?:ts|tsx|mts|cts)$/;

export function isProseLintSource(path) {
  return PROSE_LINT_SOURCE_RE.test(String(path ?? "").replace(/\\/g, "/")) &&
    !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path);
}

export function isStyleDriftSource(path) {
  return STYLE_DRIFT_SOURCE_RE.test(String(path ?? "").replace(/\\/g, "/")) &&
    !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path);
}
