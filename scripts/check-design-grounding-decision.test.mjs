import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeDesignGroundingEvidence,
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

test("trivial no-contract-change path passes on marker + a reason, without spec/code tokens", () => {
  const v = decide({
    changedFiles: ["apps/web/components/attention/AttentionInbox.tsx"],
    evidenceText:
      "Design-Grounding-Decision: no-contract-change (localized copy-only label fix; no routing or contract change)",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "design-grounding-evidence");
});

test("trivial path with a too-short reason still fails", () => {
  const a = analyzeDesignGroundingEvidence("Design-Grounding-Decision: no-contract-change (typo)");
  assert.equal(a.trivial, false);
  assert.equal(a.ok, false);
});

test("analysis reports exactly which conditions are missing", () => {
  const specOnly = analyzeDesignGroundingEvidence(
    "Design-Grounding-Decision: reviewed docs/superpowers/specs/foo.md",
  );
  assert.deepEqual(specOnly.missing, ["code-evidence"]);
  assert.equal(specOnly.marker, true);
  assert.equal(specOnly.spec, true);
  assert.equal(specOnly.code, false);

  const nothing = analyzeDesignGroundingEvidence("just a normal PR body");
  assert.deepEqual(nothing.missing, ["marker", "spec-evidence", "code-evidence"]);
});

test("decide surfaces the missing components on failure", () => {
  const v = decide({
    changedFiles: ["apps/web/components/attention/AttentionInbox.tsx"],
    evidenceText: "Design-Grounding-Decision: reviewed docs/superpowers/specs/foo.md",
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["code-evidence"]);
});

test("broadened code evidence accepts a non-src package path and mcp packs", () => {
  const pkgPath = analyzeDesignGroundingEvidence(
    "Design-Grounding-Decision: reviewed specs/plans reviewed and packages/dpf-skill-pack/hooks/x.mjs",
  );
  assert.equal(pkgPath.ok, true);

  const mcpPacks = analyzeDesignGroundingEvidence(
    "## Design grounding\n- specs/plans reviewed\n- reviewed the mcp packs and their contracts",
  );
  assert.equal(mcpPacks.ok, true);
});

test("warns when the only grounding attestation lives in a changed diff-doc", () => {
  const changedFiles = ["apps/web/components/attention/AttentionInbox.tsx"];
  const groundingDoc = `## Design grounding
- Existing specs/plans reviewed:
  - docs/superpowers/specs/attention.md
- Current code substrate reviewed:
  - apps/web/lib/attention/aggregate.ts`;

  const diffDocOnly = decide({
    changedFiles,
    evidenceSources: { prBody: "", commits: "chore: tweak inbox copy", changedDocText: groundingDoc },
  });
  assert.equal(diffDocOnly.ok, true);
  assert.equal(diffDocOnly.warnDiffDocOnly, true);

  const durableTrailer = decide({
    changedFiles,
    evidenceSources: {
      prBody: groundingDoc,
      commits: "chore: tweak inbox copy",
      changedDocText: groundingDoc,
    },
  });
  assert.equal(durableTrailer.ok, true);
  assert.equal(durableTrailer.warnDiffDocOnly, false);
});
