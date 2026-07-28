import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyChangedFiles,
  decide,
  hasDesignGroundingEvidence,
} from "./check-design-grounding-decision.mjs";

test("recognizes design-grounding evidence with spec and code substrate", () => {
  const text = `## Design grounding

- Existing specs/plans reviewed:
  - docs/superpowers/specs/2026-06-23-human-attention-surface-design.md
- Current code substrate reviewed:
  - apps/web/lib/attention/aggregate.ts
- Decision:
  - extend existing Attention Surface contract`;

  assert.equal(hasDesignGroundingEvidence(text), true);
});

test("rejects a marker without code-substrate evidence", () => {
  const text = `Design-Grounding-Decision: reviewed docs/superpowers/specs/foo.md`;
  assert.equal(hasDesignGroundingEvidence(text), false);
});

test("classifies UX/workflow/queue/navigation/process-spine files", () => {
  const classified = classifyChangedFiles([
    "apps/web/app/(shell)/platform/ai/founder-review/page.tsx",
    "apps/web/lib/attention/aggregate.ts",
    "apps/web/lib/work-management/workspace-case-loader.ts",
    "packages/dpf-skill-pack/hooks/spec-plan-doc-precheck.mjs",
    "scripts/check-ux-fit-decision.mjs",
    "apps/web/lib/attention/aggregate.test.ts",
    "docs/superpowers/plans/foo.md",
  ]);

  assert.deepEqual(classified.designSensitive, [
    "apps/web/app/(shell)/platform/ai/founder-review/page.tsx",
    "apps/web/lib/attention/aggregate.ts",
    "apps/web/lib/work-management/workspace-case-loader.ts",
    "packages/dpf-skill-pack/hooks/spec-plan-doc-precheck.mjs",
    "scripts/check-ux-fit-decision.mjs",
  ]);
  assert.deepEqual(classified.evidenceFiles, ["docs/superpowers/plans/foo.md"]);
});

test("passes when no design-sensitive files changed", () => {
  const v = decide({
    changedFiles: ["apps/web/lib/math.ts", "scripts/maintenance.mjs"],
    evidenceText: "",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "no-design-sensitive-files");
});

test("fails when design-sensitive files changed without evidence", () => {
  const v = decide({
    changedFiles: ["apps/web/components/attention/AttentionInbox.tsx"],
    evidenceText: "Process-Spine-Decision: doc touch not needed",
  });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "missing-design-grounding");
});

test("passes when design-sensitive files changed with design-grounding evidence", () => {
  const v = decide({
    changedFiles: ["apps/web/components/attention/AttentionInbox.tsx"],
    evidenceText: `Design-Grounding-Decision: reviewed docs/superpowers/specs/2026-06-23-human-attention-surface-design.md and code substrate apps/web/lib/attention/aggregate.ts; localized copy-only fix.`,
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "design-grounding-evidence");
});

test("physical-twin changes require a current operational precedent or explicit no-precedent rationale", () => {
  const changedFiles = ["apps/web/components/twin/OperationalScene.tsx"];
  const grounding = `## Design grounding

- Existing specs/plans reviewed:
  - docs/superpowers/specs/operational-twin.md
- Current code substrate reviewed:
  - apps/web/components/twin/OperationalScene.tsx`;

  const missing = decide({ changedFiles, evidenceText: grounding });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing-operational-precedent");

  const sourced = decide({
    changedFiles,
    evidenceText: `${grounding}\nOperational-Precedent: restaurant-floor`,
  });
  assert.equal(sourced.ok, true);
  assert.equal(sourced.reason, "design-grounding-and-operational-precedent");

  const explicitAbsence = decide({
    changedFiles,
    evidenceText: `${grounding}\nOperational-Precedent: no-precedent (no incumbent spatial workflow exists; task-list fallback reviewed)`,
  });
  assert.equal(explicitAbsence.ok, true);
});
