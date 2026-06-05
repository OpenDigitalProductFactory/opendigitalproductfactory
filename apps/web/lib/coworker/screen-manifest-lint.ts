// Pseudo-User Contract (spec §6.1) — ScreenManifest lint.
//
// Pure validation functions over manifests. Runs in the vitest suite (the
// "CI lint" referred to by BI-D9487754) by importing
// `apps/web/lib/coworker/manifests/index.ts`'s ALL_MANIFESTS and asserting
// `lintManifests(ALL_MANIFESTS).length === 0`. Each invariant carries a
// stable code so failure messages are scannable.
//
// Why not a separate Node script + workflow yaml: the validation depends
// on PLATFORM_TOOLS (TypeScript runtime constant from the same workspace),
// so the natural place to run it is the same vitest suite that already
// catches type-level breakage. The existing "Unit Tests" CI check covers
// it without a new workflow.
//
// BI-D9487754 / EP-COWORKER-INTERACTIVITY.

import { PLATFORM_TOOLS } from "../mcp-tools";

import type {
  DomainActionRef,
  FormDescriptor,
  NavigationDescriptor,
  PanelDescriptor,
  ScreenManifest,
  SelectionDescriptor,
} from "./screen-manifest-types";

export interface LintViolation {
  /** Surface owning the violation, or "<global>" for cross-manifest checks. */
  manifestId: string;
  /** Stable code, e.g. "MANIFEST-001". Used in test assertions. */
  code: string;
  /** Human-readable message. */
  message: string;
}

/** Validate a single manifest against the per-manifest invariants:
 *
 *  MANIFEST-001 — every domainAction.tool references a real PLATFORM_TOOLS entry
 *  MANIFEST-002 — every destructiveActions entry exists in domainActions
 *  MANIFEST-003 — every form.submit.tool references a real PLATFORM_TOOLS entry
 *  MANIFEST-004 — selection ids are unique within the manifest
 *  MANIFEST-005 — panel ids are unique within the manifest
 *  MANIFEST-006 — form ids are unique within the manifest
 *  MANIFEST-007 — navigation ids are unique within the manifest
 *  MANIFEST-008 — domainAction action ids are unique within the manifest
 *  MANIFEST-009 — every selection has a functional applySelection
 *  MANIFEST-010 — every navigation has a functional apply
 *  MANIFEST-011 — every panel has functional open/close/describeOpenState
 *  MANIFEST-012 — every form field has a functional setValue
 *  MANIFEST-013 — every domain action has a functional invoke
 *
 *  Returns a flat list of violations (never throws). */
export function lintManifest(manifest: ScreenManifest): LintViolation[] {
  const violations: LintViolation[] = [];
  const toolNames = new Set(PLATFORM_TOOLS.map((t) => t.name));

  // MANIFEST-001
  for (const action of manifest.domainActions) {
    if (!toolNames.has(action.tool)) {
      violations.push({
        manifestId: manifest.surfaceId,
        code: "MANIFEST-001",
        message: `domain action '${action.actionId}' references tool '${action.tool}' which is not in PLATFORM_TOOLS`,
      });
    }
  }

  // MANIFEST-002
  const actionIds = new Set(manifest.domainActions.map((a) => a.actionId));
  for (const da of manifest.destructiveActions) {
    if (!actionIds.has(da)) {
      violations.push({
        manifestId: manifest.surfaceId,
        code: "MANIFEST-002",
        message: `destructiveActions contains '${da}' which is not in domainActions`,
      });
    }
  }

  // MANIFEST-003
  for (const form of manifest.forms) {
    if (!toolNames.has(form.submit.tool)) {
      violations.push({
        manifestId: manifest.surfaceId,
        code: "MANIFEST-003",
        message: `form '${form.formId}' submit tool '${form.submit.tool}' is not in PLATFORM_TOOLS`,
      });
    }
  }

  // MANIFEST-004..008 — uniqueness within the manifest
  pushDuplicates(violations, manifest.surfaceId, "MANIFEST-004", "selectionId", manifest.selections.map((s) => s.selectionId));
  pushDuplicates(violations, manifest.surfaceId, "MANIFEST-005", "panelId", manifest.panels.map((p) => p.panelId));
  pushDuplicates(violations, manifest.surfaceId, "MANIFEST-006", "formId", manifest.forms.map((f) => f.formId));
  pushDuplicates(violations, manifest.surfaceId, "MANIFEST-007", "navigationId", manifest.navigations.map((n) => n.navigationId));
  pushDuplicates(violations, manifest.surfaceId, "MANIFEST-008", "actionId", manifest.domainActions.map((a) => a.actionId));

  // MANIFEST-009..013 — handlers must be functions. The chief-architect
  // review (2026-05-31) called out replacing the Storybook-based check
  // with a Vitest jsdom test; these `typeof === "function"` assertions
  // are what that test reduces to in practice. Running them inside the
  // page's render path is the v2 enhancement (BI for it not yet filed).
  for (const sel of manifest.selections) pushIfNotFunction(violations, manifest.surfaceId, "MANIFEST-009", `selection '${sel.selectionId}'`, "applySelection", sel.applySelection);
  for (const nav of manifest.navigations) pushIfNotFunction(violations, manifest.surfaceId, "MANIFEST-010", `navigation '${nav.navigationId}'`, "apply", nav.apply);
  for (const panel of manifest.panels) {
    pushIfNotFunction(violations, manifest.surfaceId, "MANIFEST-011", `panel '${panel.panelId}'`, "open", panel.open);
    pushIfNotFunction(violations, manifest.surfaceId, "MANIFEST-011", `panel '${panel.panelId}'`, "close", panel.close);
    pushIfNotFunction(violations, manifest.surfaceId, "MANIFEST-011", `panel '${panel.panelId}'`, "describeOpenState", panel.describeOpenState);
  }
  for (const form of manifest.forms) {
    for (const field of form.fields) {
      pushIfNotFunction(violations, manifest.surfaceId, "MANIFEST-012", `form '${form.formId}' field '${field.fieldId}'`, "setValue", field.setValue);
    }
  }
  for (const action of manifest.domainActions) {
    pushIfNotFunction(violations, manifest.surfaceId, "MANIFEST-013", `domain action '${action.actionId}'`, "invoke", action.invoke);
  }

  return violations;
}

/** Validate a list of manifests, including cross-manifest invariants:
 *
 *  MANIFEST-000 — every surfaceId is globally unique
 *
 *  Then runs lintManifest on each. */
export function lintManifests(manifests: ScreenManifest[]): LintViolation[] {
  const violations: LintViolation[] = [];
  pushDuplicates(violations, "<global>", "MANIFEST-000", "surfaceId", manifests.map((m) => m.surfaceId));
  for (const m of manifests) {
    violations.push(...lintManifest(m));
  }
  return violations;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pushDuplicates(
  violations: LintViolation[],
  manifestId: string,
  code: string,
  label: string,
  items: string[],
): void {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) dups.add(item);
    else seen.add(item);
  }
  if (dups.size > 0) {
    violations.push({
      manifestId,
      code,
      message: `duplicate ${label}: ${Array.from(dups).sort().join(", ")}`,
    });
  }
}

function pushIfNotFunction(
  violations: LintViolation[],
  manifestId: string,
  code: string,
  context: string,
  handlerName: string,
  handler: unknown,
): void {
  if (typeof handler !== "function") {
    violations.push({
      manifestId,
      code,
      message: `${context}: ${handlerName} is not a function (received ${typeof handler})`,
    });
  }
}

// Re-exports purely to make the lint API self-contained for consumers;
// avoids a second import line at the call site.
export type {
  DomainActionRef,
  FormDescriptor,
  NavigationDescriptor,
  PanelDescriptor,
  ScreenManifest,
  SelectionDescriptor,
};
